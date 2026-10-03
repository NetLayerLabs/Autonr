// Real-product footage for the Autonr demo video. Playwright drives Google Chrome through the
// dashboard of a fresh scaffold, one BEAT at a time, and every beat becomes public/clips/<beat>.mp4
// plus an entry in public/clips/meta.json that tells the editor what is on screen and when.
//
//   node scripts/capture.mjs <beat> [<beat> ...]     record beats against BASE_URL (default 127.0.0.1:3440)
//   DPR=2 PROMOTE=1 node scripts/capture.mjs home     film at 3200x1800 straight into public/clips
//   node scripts/capture.mjs recut <beat>            rebuild a clip from its kept frames
//   node scripts/capture.mjs list                    list the beats
//
// Frames come from the DevTools screencast as high-quality JPEGs with their own timestamps, so text
// stays sharp and marks line up exactly. A pointer and a click ring are injected into every page, the
// mouse travels an eased arc before each click, and scrolling is an eased glide. Dev rehearsals write
// to clips/tmp/dev-clips and never touch public/clips unless PROMOTE=1.
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TARGET = process.env.TARGET === 'prod' ? 'prod' : 'dev'
const BASE = process.env.BASE_URL || 'http://127.0.0.1:3440'
const TMP = path.join(ROOT, 'clips/tmp')
const PUBLIC_CLIPS = path.join(ROOT, 'public/clips')
// CLIPS_OUT sends the finished mp4 and its meta.json somewhere else entirely (probes, experiments).
const OUT = process.env.CLIPS_OUT
  ? path.resolve(ROOT, process.env.CLIPS_OUT)
  : TARGET === 'prod' || process.env.PROMOTE
    ? PUBLIC_CLIPS
    : path.join(TMP, 'dev-clips')
const AUTH = path.join(TMP, 'auth.json')
const STATE = path.join(TMP, `state-${TARGET}.json`)
const SIZE = { width: 1600, height: 900 }
// Optional supersampling. The page is always laid out as the same 1600x900 CSS viewport -- every
// coordinate, mark, glide and region below is unchanged -- but DPR=2 renders and screencasts it at
// device scale 2, so the clip is 3200x1800 and a push-in has real pixels to enlarge instead of
// interpolated ones. DPR unset (or 1) behaves exactly as it always has.
const DPR = Number(process.env.DPR ?? 1) || 1
const FRAME = { width: Math.round(SIZE.width * DPR), height: Math.round(SIZE.height * DPR) }
const JPEG_QUALITY = Number(process.env.JPEG_QUALITY ?? 92) || 92
const CRF = process.env.CRF ?? '15'
for (const dir of [TMP, OUT, PUBLIC_CLIPS]) fs.mkdirSync(dir, { recursive: true })

// Frames and session.json live beside the beat; a non-default scale gets its own folder so a probe
// can never clobber the frames a real take left behind (`recut` finds the matching one).
const sessionDir = (beat) => path.join(TMP, 'sessions', `${TARGET}${DPR === 1 ? '' : `-dpr${DPR}`}-${beat}`)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const readJson = (file, fallback) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback)
const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 1))
const state = readJson(STATE, {})
const saveState = () => writeJson(STATE, state)
const round = (n) => Math.round(n * 100) / 100


// ---------------------------------------------------------------------------------------------
// The pointer. Runs in every document before the app's own scripts.
// ---------------------------------------------------------------------------------------------
function pointerScript() {
  if (window.__autonrPointer) return
  window.__autonrPointer = true
  const KEY = '__autonr_pointer_xy'
  let x = 800
  let y = 450
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY) || 'null')
    if (saved) [x, y] = saved
  } catch {}
  const el = document.createElement('div')
  el.setAttribute('aria-hidden', 'true')
  el.style.cssText =
    'position:fixed;left:0;top:0;width:26px;height:26px;z-index:2147483647;pointer-events:none;' +
    'will-change:transform;filter:drop-shadow(0 2px 3px rgba(28,38,33,.35));'
  el.innerHTML =
    '<svg width="26" height="26" viewBox="0 0 26 26" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M4 2.5 L4 20.5 L8.9 16.2 L12.2 23.6 L15.4 22.2 L12.2 14.9 L18.8 14.6 Z" ' +
    'fill="#111827" stroke="#ffffff" stroke-width="1.6" stroke-linejoin="round"/></svg>'
  const place = () => (el.style.transform = `translate(${x - 4}px, ${y - 2.5}px)`)
  place()
  const attach = () => {
    if (!document.documentElement) return false
    document.documentElement.appendChild(el)
    return true
  }
  if (!attach()) document.addEventListener('DOMContentLoaded', attach, { once: true })
  // Some apps replace the whole body; keep the pointer attached.
  setInterval(() => !el.isConnected && attach(), 500)

  window.__autonrRing = (rx = x, ry = y) => {
    const ring = document.createElement('div')
    ring.style.cssText =
      `position:fixed;left:${rx - 22}px;top:${ry - 22}px;width:44px;height:44px;border-radius:50%;` +
      'border:3px solid #8259ef;background:rgba(130,89,239,.18);z-index:2147483646;pointer-events:none;'
    document.documentElement.appendChild(ring)
    ring
      .animate(
        [
          { transform: 'scale(.25)', opacity: 0.95 },
          { transform: 'scale(1.25)', opacity: 0 },
        ],
        { duration: 520, easing: 'cubic-bezier(.2,.7,.2,1)' },
      )
      .finished.then(() => ring.remove(), () => ring.remove())
  }
  window.addEventListener(
    'mousemove',
    (e) => {
      x = e.clientX
      y = e.clientY
      place()
      try {
        sessionStorage.setItem(KEY, JSON.stringify([x, y]))
      } catch {}
    },
    true,
  )
  window.addEventListener('mousedown', (e) => window.__autonrRing(e.clientX, e.clientY), true)

  // The app scrolls new arrivals into view by itself. While filming a conversation the camera
  // does that instead (set window.__autonrHoldScroll), so what the narration is about stays put.
  const nativeScrollIntoView = Element.prototype.scrollIntoView
  Element.prototype.scrollIntoView = function (...args) {
    if (window.__autonrHoldScroll) return
    return nativeScrollIntoView.apply(this, args)
  }

  // Eased scrolling from inside the page. `target` null means the window.
  window.__autonrGlide = (container, to, ms) =>
    new Promise((resolve) => {
      const isWin = !container
      const from = isWin ? window.scrollY : container.scrollTop
      const max = isWin
        ? document.documentElement.scrollHeight - window.innerHeight
        : container.scrollHeight - container.clientHeight
      const goal = Math.max(0, Math.min(max, to))
      if (Math.abs(goal - from) < 2) return resolve(goal)
      const t0 = performance.now()
      const ease = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2)
      const tick = (now) => {
        const p = Math.min(1, (now - t0) / ms)
        const v = from + (goal - from) * ease(p)
        if (isWin) window.scrollTo({ top: v, behavior: 'instant' })
        else container.scrollTop = v
        if (p < 1) requestAnimationFrame(tick)
        else resolve(goal)
      }
      requestAnimationFrame(tick)
    })
  window.__autonrScroller = (el) => {
    for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
      const style = getComputedStyle(node)
      if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 4) return node
    }
    return null
  }
}

// ---------------------------------------------------------------------------------------------
// A recording session: one browser, one page, a screencast, marks and compressible ranges.
// ---------------------------------------------------------------------------------------------
async function openSession(beat, { auth = true } = {}) {
  const dir = sessionDir(beat)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  // --force-device-scale-factor is not belt-and-braces with the context's deviceScaleFactor, it is
  // the whole trick. Setting deviceScaleFactor alone makes Chrome *render* at 2x, but the DevTools
  // screencast (and Page.captureScreenshot) still hand back a frame downscaled to the CSS viewport,
  // so the extra detail is thrown away before it reaches us. Forcing the scale factor at launch
  // makes the screencast itself 3200x1800. Measured on the dev site: both flags -> 3200x1800 at
  // ~60 fps; deviceScaleFactor alone, at any maxWidth -> 1600x900.
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--lang=en-US', ...(DPR === 1 ? [] : [`--force-device-scale-factor=${DPR}`])],
  })
  const ctx = await browser.newContext({
    viewport: SIZE,
    deviceScaleFactor: DPR,
    locale: 'en-US',
    timezoneId: 'Europe/Rome',
    storageState: auth && fs.existsSync(AUTH) ? AUTH : undefined,
  })
  await ctx.addInitScript(pointerScript)
  const page = await ctx.newPage()
  page.setDefaultTimeout(20_000)

  const cdp = await ctx.newCDPSession(page)
  const frames = []
  const writes = []
  cdp.on('Page.screencastFrame', (frame) => {
    const file = `f${String(frames.length).padStart(6, '0')}.jpg`
    frames.push({ file, t: frame.metadata.timestamp })
    writes.push(fs.promises.writeFile(path.join(dir, file), Buffer.from(frame.data, 'base64')))
    cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {})
  })
  await cdp.send('Page.startScreencast', {
    format: 'jpeg',
    quality: JPEG_QUALITY,
    // Device pixels, not CSS pixels: at DPR 2 the surface is 3200x1800 and a smaller cap here would
    // quietly hand back a downscaled frame, which is the very thing this is meant to avoid.
    maxWidth: FRAME.width,
    maxHeight: FRAME.height,
    everyNthFrame: 1,
  })

  const now = () => Date.now() / 1000
  const s = {
    beat,
    page,
    ctx,
    dir,
    marks: [],
    ranges: [],
    notes: [],
    mouse: { x: 800, y: 450 },
    mark(name) {
      s.marks.push({ name, t: now() })
      console.log(`  [${beat}] ${name}`)
    },
    regions: {},
    /**
     * Where something is on screen, so the editor can punch in on it. Always CSS pixels in the
     * 1600x900 space that ui.tsx's SRC_W/SRC_H and FOCUS rectangles use, whatever DPR the clip
     * was filmed at -- a 3200x1800 clip is the same picture, just denser.
     */
    async region(name, locator) {
      const box = await locator.first().boundingBox({ timeout: 1500 }).catch(() => null)
      if (box) s.regions[name] = { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height), at: now() }
    },
    note(text) {
      s.notes.push(text)
      console.log(`  [${beat}] note: ${text}`)
    },
    /** Run a slow step; when the clip is cut the middle of it is sped up to about `to` seconds. */
    async compress(name, fn, { lead = 2, tail = 1, to = 3.5 } = {}) {
      const t0 = now()
      const result = await fn()
      const t1 = now()
      const a = t0 + lead
      const b = t1 - tail
      if (b - a > to + 1) s.ranges.push({ name, a, b, to })
      return result
    },
    async finish({ shows, saveAuth = auth } = {}) {
      // Nothing here may hang: a take on production cannot be repeated. The frames and marks are
      // written to disk first, so `recut` can always rebuild the clip.
      const within = (label, promise, ms = 12_000) => {
        let timer
        const timeout = new Promise((resolve) => {
          timer = setTimeout(() => {
            console.log(`  [${beat}] finish: "${label}" timed out, moving on`)
            resolve(undefined)
          }, ms)
        })
        return Promise.race([promise, timeout])
          .catch((error) => console.log(`  [${beat}] finish: "${label}" failed: ${error.message.split('\n')[0]}`))
          .finally(() => clearTimeout(timer))
      }
      const endWall = now()
      const errors = await within(
        'toasts',
        page.locator('[data-sonner-toast][data-type="error"]').allInnerTexts(),
        4000,
      )
      if (Array.isArray(errors) && errors.length) s.note(`error toast on screen at the end: ${errors.join(' | ')}`)
      await within('stop screencast', cdp.send('Page.stopScreencast'), 5000)
      await Promise.all(writes)
      const session = { beat, target: TARGET, shows, frames, marks: s.marks, ranges: s.ranges, notes: s.notes, regions: s.regions, endWall }
      writeJson(path.join(dir, 'session.json'), session)
      if (saveAuth) await within('storage state', ctx.storageState({ path: AUTH }))
      await within('close context', ctx.close(), 6000)
      await within('close browser', browser.close(), 4000)
      return cut(session, dir)
    },
    async abort(error) {
      console.log(`  [${beat}] FAILED: ${String(error?.message ?? error).split('\n')[0]}`)
      await page.screenshot({ path: path.join(TMP, `fail-${TARGET}-${beat}.png`) }).catch(() => {})
      await cdp.send('Page.stopScreencast').catch(() => {})
      await Promise.all(writes).catch(() => {})
      await ctx.close().catch(() => {})
      await browser.close().catch(() => {})
    },
  }
  return s
}

/** Turn a session's frames into <beat>.mp4: cut to [start, end], compress ranges, 30 fps H.264. */
function cut(session, dir) {
  const { beat, frames, marks, ranges } = session
  const startMark = marks.find((m) => m.name === 'start')
  const endMark = [...marks].reverse().find((m) => m.name === 'end')
  const T0 = startMark ? startMark.t : frames[0].t
  const T1 = endMark ? endMark.t : session.endWall
  const live = ranges.filter((r) => r.b > T0 && r.a < T1).sort((x, y) => x.a - y.a)

  // Wall-clock time -> clip time. Inside a compressed range time runs at to/(b-a).
  const mapTime = (t) => {
    let out = 0
    let cursor = T0
    const clamped = Math.max(T0, Math.min(T1, t))
    for (const r of live) {
      if (clamped <= r.a) break
      out += r.a - cursor
      const inside = Math.min(clamped, r.b) - r.a
      out += inside * (r.to / (r.b - r.a))
      cursor = r.b
      if (clamped <= r.b) return out
    }
    return out + (clamped - cursor)
  }

  // The frame on screen at T0 is the last one at or before it.
  let first = 0
  for (let i = 0; i < frames.length; i++) if (frames[i].t <= T0) first = i
  const used = frames.slice(first).filter((f, i) => i === 0 || f.t < T1)
  const lines = []
  for (let i = 0; i < used.length; i++) {
    const at = mapTime(used[i].t)
    const next = i + 1 < used.length ? mapTime(used[i + 1].t) : mapTime(T1)
    const duration = Math.max(0.001, next - at)
    lines.push(`file '${path.join(dir, used[i].file)}'`, `duration ${duration.toFixed(4)}`)
  }
  lines.push(`file '${path.join(dir, used[used.length - 1].file)}'`)
  const list = path.join(dir, 'concat.txt')
  fs.writeFileSync(list, lines.join('\n'))

  // What the screencast actually delivered. Scaling 1600x900 frames up to a 3200x1800 clip would
  // look like a win in ffprobe and like nothing at all on screen, so say so instead of faking it.
  const probed = execFileSync('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height',
    '-of', 'csv=p=0', path.join(dir, used[0].file),
  ]).toString().trim()
  if (probed !== `${FRAME.width},${FRAME.height}`) {
    console.log(`  [${beat}] WARNING: frames are ${probed.replace(',', 'x')} but the clip is being written at ${FRAME.width}x${FRAME.height}.`)
    console.log(`  [${beat}]          Nothing is gained by enlarging them; check --force-device-scale-factor.`)
  }

  const target = path.join(OUT, `${beat}.mp4`)
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list,
    '-vf', `fps=30,scale=${FRAME.width}:${FRAME.height}:flags=lanczos:in_range=full:out_range=tv,format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', CRF, '-movflags', '+faststart',
    '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-an', target,
  ])
  const duration = Number(
    execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', target])
      .toString()
      .trim(),
  )

  const moments = {}
  for (const m of marks) {
    if (m.name === 'start' || m.name === 'end' || m.t < T0 || m.t > T1) continue
    moments[m.name] = round(mapTime(m.t))
  }
  const entry = {
    file: `clips/${beat}.mp4`,
    duration: round(duration),
    size: `${FRAME.width}x${FRAME.height}`,
    fps: 30,
    // Only said out loud when it is not the historical 1x, so default meta.json stays byte-identical.
    ...(DPR === 1 ? {} : { dpr: DPR, sourceSpace: `${SIZE.width}x${SIZE.height} CSS pixels (FOCUS rectangles use these)` }),
    recordedOn: 'a fresh npm scaffold of NetLayerLabs/Autonr, served with next start, showing the live testnet reference deployment',
    shows: session.shows ?? '',
    spedUp: live.map((r) => ({
      what: r.name,
      clipFrom: round(mapTime(r.a)),
      clipTo: round(mapTime(r.b)),
      realSeconds: round(r.b - r.a),
      factor: round((r.b - r.a) / r.to),
    })),
    moments,
    regions: Object.fromEntries(
      Object.entries(session.regions ?? {}).map(([name, r]) => [name, { x: r.x, y: r.y, w: r.w, h: r.h, validFrom: round(mapTime(r.at)) }]),
    ),
    notes: session.notes,
  }
  const metaFile = path.join(OUT, 'meta.json')
  const meta = readJson(metaFile, { about: 'Beat clips for the Autonr demo. Times are seconds within each clip.', clips: {} })
  meta.clips[beat] = entry
  writeJson(metaFile, meta)
  console.log(`${beat}: ${duration.toFixed(1)}s -> ${path.relative(ROOT, target)}  (${used.length} frames)`)
  return entry
}

// ---------------------------------------------------------------------------------------------
// Acting: pointer travel, clicks, typing, glides.
// ---------------------------------------------------------------------------------------------
async function moveTo(s, x, y, { ms } = {}) {
  const from = { ...s.mouse }
  const dist = Math.hypot(x - from.x, y - from.y)
  if (dist < 2) return
  const duration = ms ?? Math.min(950, Math.max(320, dist * 0.95))
  const steps = Math.max(12, Math.round(duration / 14))
  // A slight arc reads as a hand, a straight line reads as a script.
  const bow = Math.min(40, dist * 0.08) * (x > from.x ? -1 : 1)
  const t0 = Date.now()
  for (let i = 1; i <= steps; i++) {
    const p = i / steps
    const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2
    const arc = Math.sin(Math.PI * e) * bow
    await s.page.mouse.move(from.x + (x - from.x) * e, from.y + (y - from.y) * e + arc)
    const due = t0 + (duration * i) / steps
    const wait = due - Date.now()
    if (wait > 0) await sleep(wait)
  }
  s.mouse = { x, y }
}

/**
 * Park the pointer in the empty space just past the END OF THE TEXT, not on top of it.
 *
 * A bounding box is the wrong thing to measure here: a paragraph's box is as wide as its column,
 * so "right edge + gap" lands off the card even though the last line stops half way. Measuring the
 * element's client rects gives one rect per rendered line, so the last one ends where the words
 * actually end and the gap after it is genuinely blank. Take 1's worst habit was resting the
 * pointer on the very sentence the editor then enlarged; this is the fix for that.
 */
async function parkBeside(s, locator, { gap = 40, dy = 0, maxX = 1566, ms = 900 } = {}) {
  const spot = await locator
    .first()
    .evaluate((el, g) => {
      const range = document.createRange()
      range.selectNodeContents(el)
      const lines = [...range.getClientRects()].filter((r) => r.width > 2 && r.height > 2)
      const last = lines[lines.length - 1]
      const box = last ?? el.getBoundingClientRect()
      return { x: box.right + g, y: box.top + box.height / 2 }
    }, gap)
    .catch(() => null)
  if (!spot) return false
  await moveTo(s, Math.min(maxX, spot.x), spot.y + dy, { ms })
  return true
}

/** Glide so the element sits at `at` (0 top, 1 bottom) of its scroll container, if it is not comfortably in view. */
async function bringIntoView(s, locator, { at = 0.5, ms = 900, force = false } = {}) {
  await locator.waitFor({ state: 'visible' })
  await locator.evaluate(
    async (el, { at, ms, force }) => {
      const scroller = window.__autonrScroller(el)
      const box = el.getBoundingClientRect()
      const view = scroller ? scroller.getBoundingClientRect() : { top: 0, height: window.innerHeight }
      const mid = box.top + box.height / 2 - view.top
      const comfortable = box.top - view.top > 90 && box.bottom - view.top < view.height - 110
      if (comfortable && !force) return
      const delta = mid - view.height * at
      const from = scroller ? scroller.scrollTop : window.scrollY
      await window.__autonrGlide(scroller, from + delta, ms)
    },
    { at, ms, force },
  )
  await sleep(250)
}

async function centreOf(locator, { dx = 0, dy = 0 } = {}) {
  const box = await locator.boundingBox()
  if (!box) throw new Error('element has no box')
  return { x: box.x + box.width / 2 + dx, y: box.y + box.height / 2 + dy }
}

async function hover(s, locator, opts = {}) {
  await bringIntoView(s, locator, opts)
  const { x, y } = await centreOf(locator, opts)
  await moveTo(s, x, y)
}

async function click(s, locator, opts = {}) {
  await hover(s, locator, opts)
  await sleep(opts.dwell ?? 260)
  await s.page.mouse.down()
  await sleep(70)
  await s.page.mouse.up()
  await sleep(opts.after ?? 350)
}

async function type(s, locator, text, { delay = 45, enter = false, after = 380, ...opts } = {}) {
  await click(s, locator, { after: 200, ...opts })
  // Some fields arrive with a starting value; typing replaces it, as a person would.
  if ((await locator.inputValue().catch(() => '')) !== '') {
    await s.page.keyboard.press('ControlOrMeta+A')
    await sleep(220)
  }
  await s.page.keyboard.type(text, { delay })
  if (enter) {
    await sleep(160)
    await s.page.keyboard.press('Enter')
  }
  await sleep(after)
}

/** A native <select> opens an OS popup the recording cannot see, so point at it and set the value. */
async function choose(s, locator, value) {
  await hover(s, locator)
  await sleep(250)
  await s.page.evaluate(() => window.__autonrRing())
  await sleep(180)
  await locator.selectOption(value)
  await sleep(450)
}

const glideWindow = (s, to, ms) => s.page.evaluate(([to, ms]) => window.__autonrGlide(null, to, ms), [to, ms])

async function settle(page) {
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.evaluate(() => document.fonts.ready).catch(() => {})
}



// ---------------------------------------------------------------------------------------------
// The beats.
// ---------------------------------------------------------------------------------------------

const TX = '0xa5d79bc371a83602877b87a6d66112131b003140ee33c2b84d40fea6cf7a2b7c'
const navLink = (page, label) => page.locator('header').getByRole('link', { name: label, exact: true }).first()

async function openPage(s, route) {
  const { page } = s
  await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' })
  await settle(page)
  // Live panels poll the API; give the first round a moment to land so no skeleton is on camera.
  await sleep(2500)
}

const BEATS = {
  /** Mission control: hero, the oracle and vault panels, a glide through the decision log to the trades. */
  async home() {
    const s = await openSession('home', { auth: false })
    try {
      const { page } = s
      await openPage(s, '/')
      await page.mouse.move(1180, 520)
      s.mouse = { x: 1180, y: 520 }
      await sleep(600)
      s.mark('start')
      await sleep(2400)
      const oracle = page.getByText('Oracle consensus', { exact: true }).first()
      await bringIntoView(s, oracle, { at: 0.18, ms: 1400, force: true })
      s.mark('oracle panel')
      await s.region('oracle', oracle.locator('xpath=ancestor::section[1] | xpath=ancestor::div[contains(@class,"card")][1]'))
      await moveTo(s, 560, 560, { ms: 700 })
      await sleep(3800)
      const vault = page.getByText('AgentVault state, policy and limits').first()
      await s.region('vault', vault.locator('xpath=ancestor::section[1]'))
      await moveTo(s, 1180, 620, { ms: 800 })
      s.mark('vault panel')
      await sleep(3600)
      const log = page.getByText('Decision log', { exact: true }).first()
      await bringIntoView(s, log, { at: 0.12, ms: 1500, force: true })
      s.mark('decision log')
      await moveTo(s, 1100, 520, { ms: 700 })
      await sleep(3500)
      const trades = page.getByText('Trades', { exact: true }).first()
      await bringIntoView(s, trades, { at: 0.15, ms: 1500, force: true })
      s.mark('trades table')
      await sleep(2500)
      const verify = page.getByRole('link', { name: 'Verify' }).first()
      await hover(s, verify)
      s.mark('pointer on Verify')
      await sleep(1600)
      s.mark('end')
      return await s.finish({ saveAuth: false, shows: 'Mission control: oracle consensus, vault panel, decision log, trades, pointer on Verify.' })
    } catch (error) { await s.abort(error); throw error }
  },

  /** The proof page for trade #8: verdict, the twelve checks, the timeline, the X-ray. */
  async proof() {
    const s = await openSession('proof', { auth: false })
    try {
      const { page } = s
      await openPage(s, `/proof/${TX}`)
      await page.getByText('12 checks passed').first().waitFor({ timeout: 30_000 }).catch(() => {})
      await sleep(800)
      await page.mouse.move(1200, 600)
      s.mouse = { x: 1200, y: 600 }
      s.mark('start')
      await sleep(3000)
      const checks = page.getByText('Checks', { exact: true }).first()
      await bringIntoView(s, checks, { at: 0.1, ms: 1500, force: true })
      s.mark('checks list')
      await moveTo(s, 1250, 520, { ms: 800 })
      await sleep(4500)
      await glideWindow(s, await page.evaluate(() => window.scrollY + 520), 1600)
      s.mark('more checks')
      await sleep(3000)
      const xray = page.getByText(/Trade X-ray/i).first()
      await bringIntoView(s, xray, { at: 0.12, ms: 1600, force: true })
      s.mark('x-ray')
      await moveTo(s, 1200, 560, { ms: 800 })
      await sleep(5000)
      s.mark('end')
      return await s.finish({ saveAuth: false, shows: 'Proof page: verified banner, the checks, the Trade X-ray call trace.' })
    } catch (error) { await s.abort(error); throw error }
  },

  /** The Tamper lab: flip one byte, watch verified turn to failed. */
  async tamper() {
    const s = await openSession('tamper', { auth: false })
    try {
      const { page } = s
      await openPage(s, `/proof/${TX}`)
      await page.getByText('12 checks passed').first().waitFor({ timeout: 30_000 }).catch(() => {})
      const lab = page.getByText('Tamper lab', { exact: true }).first()
      await lab.evaluate((el) => el.scrollIntoView({ block: 'start', behavior: 'instant' }))
      await page.evaluate(() => window.scrollBy(0, -80))
      await sleep(900)
      await page.mouse.move(1200, 700)
      s.mouse = { x: 1200, y: 700 }
      s.mark('start')
      await sleep(2200)
      const flip = page.getByRole('button', { name: 'Flip one byte of the message' })
      await click(s, flip, { after: 400 })
      s.mark('flipped one byte')
      await sleep(5500)
      s.mark('end')
      return await s.finish({ saveAuth: false, shows: 'Tamper lab: Flip one byte, the verdict turns from verified to failed on hash-match.' })
    } catch (error) { await s.abort(error); throw error }
  },

  /** The playground: Run all 6, every card refused with its custom error. */
  async playground() {
    const s = await openSession('playground', { auth: false })
    try {
      const { page } = s
      await openPage(s, '/playground')
      await page.mouse.move(1200, 640)
      s.mouse = { x: 1200, y: 640 }
      s.mark('start')
      await sleep(2000)
      const run = page.getByRole('button', { name: /Run all/ })
      await click(s, run, { after: 300 })
      s.mark('run all')
      await page.getByText('refused as expected').nth(5).waitFor({ timeout: 60_000 })
      s.mark('all six refused')
      await moveTo(s, 1240, 620, { ms: 900 })
      await sleep(4200)
      s.mark('end')
      return await s.finish({ saveAuth: false, shows: 'Guardrail playground: Run all 6, each card refused with its custom error, live from the vault.' })
    } catch (error) { await s.abort(error); throw error }
  },

  /** The audit page: no gaps, eight trades, eight matched. */
  async audit() {
    const s = await openSession('audit', { auth: false })
    try {
      const { page } = s
      await openPage(s, '/audit')
      await page.getByText(/No gaps/).first().waitFor({ timeout: 60_000 }).catch(() => {})
      await page.mouse.move(1200, 700)
      s.mouse = { x: 1200, y: 700 }
      s.mark('start')
      await sleep(2000)
      await moveTo(s, 700, 430, { ms: 900 })
      s.mark('no gaps')
      await sleep(5000)
      s.mark('end')
      return await s.finish({ saveAuth: false, shows: 'Audit page: no gaps, trade events matched to decision records.' })
    } catch (error) { await s.abort(error); throw error }
  },

  /** The owner console, read-only, with the policy the vault enforces. */
  async owner() {
    const s = await openSession('owner', { auth: false })
    try {
      const { page } = s
      await openPage(s, '/owner')
      await page.mouse.move(1200, 640)
      s.mouse = { x: 1200, y: 640 }
      s.mark('start')
      await sleep(1500)
      const policy = page.getByText('Risk policy', { exact: true }).first()
      await bringIntoView(s, policy, { at: 0.2, ms: 1300, force: true })
      s.mark('policy')
      await moveTo(s, 900, 560, { ms: 800 })
      await sleep(4500)
      s.mark('end')
      return await s.finish({ saveAuth: false, shows: 'Owner console: pause switch, risk policy, tokens, pool fee tier.' })
    } catch (error) { await s.abort(error); throw error }
  },
}

// ---------------------------------------------------------------------------------------------
const args = process.argv.slice(2)
if (args.length === 0 || args[0] === 'list') {
  console.log(`beats: ${Object.keys(BEATS).join(', ')}\nBASE=${BASE}\nclips -> ${path.relative(ROOT, OUT)}\nDPR=${DPR} -> ${FRAME.width}x${FRAME.height}`)
} else if (args[0] === 'recut') {
  for (const beat of args.slice(1)) {
    const dir = sessionDir(beat)
    cut(readJson(path.join(dir, 'session.json')), dir)
  }
} else {
  console.log(`BASE=${BASE}`)
  for (const beat of args) {
    if (!BEATS[beat]) throw new Error(`Unknown beat "${beat}". Try: ${Object.keys(BEATS).join(', ')}`)
    await BEATS[beat]()
  }
  process.exit(0)
}
