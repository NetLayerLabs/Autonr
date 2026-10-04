import React from 'react'
import { AbsoluteFill, Freeze, OffthreadVideo, interpolate, interpolateColors, staticFile, useCurrentFrame } from 'remotion'
import clipManifest from './clips.json'
import { C, CLAMP, EASE, FPS, SPRING, TYPE, inter, mono, rimGradient, serif, sp, tween } from './theme'

/* ------------------------------------------------------------------- glass */

export const Rim: React.FC<{ radius?: number; a?: number; rgb?: string; width?: number }> = ({ radius = 22, a = 0.45, rgb = '255,255,255', width = 1.4 }) => (
  <div
    style={{
      position: 'absolute',
      inset: 0,
      borderRadius: radius,
      pointerEvents: 'none',
      padding: width,
      background: rimGradient(a, rgb),
      WebkitMask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
      WebkitMaskComposite: 'xor',
      maskComposite: 'exclude',
    }}
  />
)

const RIM_RGB = { white: '255,255,255', violet: '186,176,240', rose: '226,180,180' }
export type Tone = keyof typeof RIM_RGB

/** Liquid glass: a near-transparent fill, an inset highlight, the rim, and a soft float shadow. */
export const Glass: React.FC<{
  x?: number
  y?: number
  w?: number | string
  h?: number | string
  radius?: number
  kind?: 'clear' | 'card'
  tone?: Tone
  rimA?: number
  style?: React.CSSProperties
  children?: React.ReactNode
}> = ({ x, y, w, h, radius = 22, kind = 'card', tone = 'white', rimA, style, children }) => (
  <div
    style={{
      position: x !== undefined || y !== undefined ? 'absolute' : 'relative',
      left: x,
      top: y,
      width: w,
      height: h,
      borderRadius: radius,
      background: kind === 'card' ? 'linear-gradient(180deg, rgba(15,15,15,0.92), rgba(9,9,9,0.92))' : 'rgba(255,255,255,0.02)',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.10), 0 30px 80px rgba(0,0,0,0.45)',
      ...style,
    }}
  >
    {children}
    <Rim radius={radius} rgb={RIM_RGB[tone]} a={rimA ?? (tone === 'white' ? 0.45 : 0.8)} />
  </div>
)

/** Every hold breathes: a slow push from 1.00 to 1.02 with a little counter-drift. */
export const Drift: React.FC<{ dur: number; children: React.ReactNode; amount?: number; dx?: number }> = ({ dur, children, amount = 0.02, dx = -18 }) => {
  const f = useCurrentFrame()
  const p = tween(f, 0, dur, 0, 1, EASE.inOut)
  return <AbsoluteFill style={{ transform: `translateX(${dx * p}px) scale(${1 + amount * p})` }}>{children}</AbsoluteFill>
}

/* -------------------------------------------------------------------- type */

/** The serif italic accent word. Four in the whole film. */
export const Accent: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <span style={{ fontFamily: serif, fontStyle: 'italic', fontWeight: 400, letterSpacing: '-0.01em', ...style }}>{children}</span>
)

/**
 * A headline whose words rise out of their own baselines on cue. `words` carries the frame each word
 * arrives; the accent word rises a little further, then a violet rule draws itself under it.
 */
export type RiseWord = { text: string; at: number; accent?: boolean; br?: boolean }
export const RiseLine: React.FC<{ words: RiseWord[]; size?: number; color?: string; align?: 'left' | 'center'; out?: number; rule?: boolean }> = ({
  words,
  size = 96,
  color = C.hero,
  align = 'left',
  out,
  rule = true,
}) => {
  const f = useCurrentFrame()
  const fade = out === undefined ? 1 : 1 - tween(f, out, out + 10, 0, 1, EASE.in)
  const lines: RiseWord[][] = [[]]
  for (const w of words) {
    if (w.br) lines.push([])
    lines[lines.length - 1].push(w)
  }
  return (
    <div style={{ fontFamily: inter, fontWeight: 500, fontSize: size, letterSpacing: '-0.035em', lineHeight: 1.06, color, textAlign: align, opacity: fade }}>
      {lines.map((line, li) => (
        <div key={li} style={{ whiteSpace: 'nowrap' }}>
          {line.map((w, i) => {
            const s = sp(f, w.at - 2, w.accent ? SPRING.accent : SPRING.text)
            const travel = (w.accent ? 1.2 : 0.9) * size
            const ul = tween(f, w.at + 6, w.at + 24, 0, 1, EASE.inOut)
            return (
              <span key={i} style={{ display: 'inline-block', overflow: 'hidden', padding: '0.06em 0.06em 0.3em', margin: '-0.06em -0.06em -0.3em', verticalAlign: 'bottom' }}>
                <span style={{ display: 'inline-block', position: 'relative', transform: `translateY(${interpolate(s, [0, 1], [travel, 0])}px)` }}>
                  {w.accent ? <Accent style={{ fontSize: size * 1.3, lineHeight: 0.8 }}>{w.text}</Accent> : w.text}
                  {w.accent && rule ? (
                    <span style={{ position: 'absolute', left: '4%', bottom: -size * 0.06, height: Math.max(3, size / 26), width: `${92 * ul}%`, background: C.violet, borderRadius: 4 }} />
                  ) : null}
                </span>
                {i < line.length - 1 ? ' ' : ''}
              </span>
            )
          })}
        </div>
      ))}
    </div>
  )
}

/** Mono text typed on at 20 characters a second; each character fades in over two frames. */
export const TypeOn: React.FC<{ text: string; at: number; cps?: number; caret?: boolean; style?: React.CSSProperties; caretColor?: string; until?: number }> = ({
  text,
  at,
  cps = 20,
  caret = false,
  style,
  caretColor = C.ink,
  until,
}) => {
  const f = useCurrentFrame()
  const per = FPS / cps
  const done = at + text.length * per
  const blinkOn = Math.floor((f - done) / 15) % 2 === 0
  return (
    <span style={{ fontFamily: mono, whiteSpace: 'pre', ...style }}>
      {[...text].map((ch, i) => (
        <span key={i} style={{ opacity: tween(f, at + i * per, at + i * per + 2, 0, 1, EASE.out) }}>
          {ch}
        </span>
      ))}
      {caret && f >= at && (until === undefined || f < until) && (f < done || blinkOn) ? (
        <span style={{ display: 'inline-block', width: '0.55em', height: '1.05em', marginLeft: 2, background: caretColor, verticalAlign: '-0.15em' }} />
      ) : null}
    </span>
  )
}

/** Fade and rise in on a frame. */
export const In: React.FC<{ at: number; children: React.ReactNode; dy?: number; out?: number; style?: React.CSSProperties }> = ({ at, children, dy = 14, out, style }) => {
  const f = useCurrentFrame()
  const p = sp(f, at, SPRING.ui)
  const o = out === undefined ? 1 : 1 - tween(f, out, out + 10, 0, 1)
  return <div style={{ opacity: Math.min(1, p * 1.4) * o, transform: `translateY(${(1 - p) * dy}px)`, ...style }}>{children}</div>
}

/* ------------------------------------------------------------------ pills */

export type PillTone = 'violet' | 'rose' | 'plain'
export const Pill: React.FC<{ tone?: PillTone; size?: number; children: React.ReactNode; monoText?: boolean; dot?: boolean }> = ({ tone = 'plain', size = 22, children, monoText = false, dot = true }) => {
  const fg = tone === 'violet' ? C.violet : tone === 'rose' ? C.rose : 'hsl(0,0%,86%)'
  const bg = tone === 'violet' ? C.violetBg : tone === 'rose' ? C.roseBg : 'rgba(255,255,255,0.06)'
  const ring = tone === 'violet' ? 'hsla(250,40%,72%,0.4)' : tone === 'rose' ? 'hsla(0,26%,70%,0.3)' : 'rgba(255,255,255,0.14)'
  const dotC = tone === 'violet' ? C.violetDot : tone === 'rose' ? C.rose : '#DBDBDB'
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: size * 0.45,
        height: size * 1.8,
        padding: `0 ${size * 0.7}px`,
        borderRadius: 999,
        background: bg,
        boxShadow: `inset 0 0 0 1.5px ${ring}`,
        fontFamily: monoText ? mono : inter,
        fontWeight: 500,
        fontSize: size,
        color: fg,
        whiteSpace: 'nowrap',
      }}
    >
      {dot ? <span style={{ width: size * 0.3, height: size * 0.3, borderRadius: 99, background: dotC, boxShadow: tone === 'violet' ? `0 0 10px ${C.violetDot}` : 'none' }} /> : null}
      {children}
    </span>
  )
}

/** A pill that lifts off one place and lands on another along a shallow arc, with a short trail. */
export const PillFlight: React.FC<{ from: { x: number; y: number }; to: { x: number; y: number }; at: number; frames?: number; arc?: number; hold?: number; label: string; tone?: PillTone }> = ({
  from,
  to,
  at,
  frames = 20,
  arc = 120,
  hold = 30,
  label,
  tone = 'violet',
}) => {
  const f = useCurrentFrame()
  const pos = (t: number) => {
    const p = tween(t, at, at + frames, 0, 1, EASE.inOut)
    return { x: from.x + (to.x - from.x) * p, y: from.y + (to.y - from.y) * p - 4 * arc * p * (1 - p), s: interpolate(p, [0.75, 1], [1, 0.9], CLAMP) }
  }
  const pop = tween(f, at - 6, at, 0, 1, EASE.out)
  const fade = 1 - tween(f, at + frames + hold, at + frames + hold + 8, 0, 1, EASE.in)
  if (f < at - 6 || fade <= 0) return null
  const pill = (q: ReturnType<typeof pos>, o: number, key: string) => (
    <div key={key} style={{ position: 'absolute', left: q.x, top: q.y, transform: `translate(-50%, -50%) scale(${q.s * (0.9 + 0.1 * pop)})`, opacity: o }}>
      <Pill tone={tone} monoText size={22}>
        {label}
      </Pill>
    </div>
  )
  const flying = f > at && f < at + frames
  return (
    <>
      {flying ? [0.9, 0.6, 0.3].map((lag, i) => pill(pos(f - lag * 3), [0.1, 0.18, 0.3][i] * fade, `t${i}`)) : null}
      {pill(pos(f), pop * fade, 'p')}
    </>
  )
}

/* --------------------------------------------------------------- captions */

type Word = { word: string; start: number; end: number }

/** Sentence and clause chunks of at most `max` words. */
const chunk = (words: Word[], max = 9): Word[][] => {
  const out: Word[][] = []
  let cur: Word[] = []
  for (const w of words) {
    cur.push(w)
    const stop = /[.!?]$/.test(w.word) || (/[,:;]$/.test(w.word) && cur.length >= 4) || cur.length >= max
    if (stop) {
      out.push(cur)
      cur = []
    }
  }
  if (cur.length) out.push(cur)
  return out
}

/** One line at a time, lit word by word as it is spoken: upcoming words wait at 40%. */
export const Captions: React.FC<{ words: Word[]; top?: number; width?: number; cx?: number }> = ({ words, top = 948, width = 1600, cx = 960 }) => {
  const f = useCurrentFrame()
  if (!words.length) return null
  const chunks = chunk(words)
  let shown = chunks[0]
  for (const c of chunks) if (f >= c[0].start - 3) shown = c
  const first = words[0].start
  const last = words[words.length - 1].end
  const op = interpolate(f, [first - 4, first + 4, last + 8, last + 18], [0, 1, 1, 0], CLAMP)
  return (
    <div style={{ position: 'absolute', left: cx - width / 2, top, width, height: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: op, pointerEvents: 'none' }}>
      <div style={{ ...TYPE.caption, whiteSpace: 'nowrap', textShadow: '0 2px 14px rgba(0,0,0,0.85)' }}>
        {shown.map((wd, i) => {
          const t = interpolate(f, [wd.start - 3, wd.start + 2], [0, 1], CLAMP)
          return (
            <span key={i} style={{ color: interpolateColors(t, [0, 1], [C.body, C.ink]), opacity: 0.4 + 0.6 * t }}>
              {wd.word}
              {i < shown.length - 1 ? ' ' : ''}
            </span>
          )
        })}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------ the record */

/**
 * The film's spine: the agent's decision record, as it is published to HCS. Rows type on, the record is
 * sealed with its topic and sequence, later a row is verified (violet) or tampered with (rose).
 */
export type RecordRow = { k: string; v: string; at: number; state?: 'plain' | 'verified' | 'tampered'; stateAt?: number; v2?: string }
export const RecordCard: React.FC<{
  rows: RecordRow[]
  title?: string
  sealAt?: number
  seal?: string
  w?: number
  enter?: number
  tone?: Tone
  toneAt?: number
  tag?: string
  keyW?: number
}> = ({ rows, title = 'Decision record', sealAt, seal, w = 760, enter = 0, tone = 'white', toneAt = 0, tag = 'autonr.decision/v1', keyW = 170 }) => {
  const f = useCurrentFrame()
  const p = sp(f, enter, SPRING.ui)
  const sealed = sealAt !== undefined ? sp(f, sealAt, SPRING.pop) : 0
  const curTone: Tone = f >= toneAt ? tone : 'white'
  return (
    <div style={{ opacity: Math.min(1, p * 1.3), transform: `translateY(${(1 - p) * 24}px)` }}>
      <Glass w={w} radius={24} tone={curTone} style={{ padding: '30px 34px 28px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <div style={{ ...TYPE.caps }}>{title}</div>
          <div style={{ ...TYPE.label, fontSize: 18, color: C.dim }}>{tag}</div>
        </div>
        {rows.map((r, i) => {
          const verified = r.state === 'verified' && r.stateAt !== undefined && f >= r.stateAt
          const tampered = r.state === 'tampered' && r.stateAt !== undefined && f >= r.stateAt
          const swap = r.v2 !== undefined && tampered
          const flash = tampered ? tween(f, r.stateAt!, r.stateAt! + 8, 1, 0) : 0
          return (
            <div
              key={r.k}
              style={{
                display: 'grid',
                gridTemplateColumns: `${keyW}px 1fr 34px`,
                alignItems: 'center',
                minHeight: 52,
                borderTop: i === 0 ? 'none' : '1px dashed hsla(0,0%,20%,0.7)',
                background: flash > 0 ? `rgba(226,180,180,${0.12 * flash})` : 'transparent',
              }}
            >
              <div style={{ fontFamily: inter, fontSize: 19, fontWeight: 500, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.09em' }}>{r.k}</div>
              <div style={{ ...TYPE.row, fontSize: 23, color: tampered ? C.rose : verified ? C.violet : C.hero, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {f < r.at ? null : swap ? <span>{r.v2}</span> : <TypeOn text={r.v} at={r.at} cps={40} />}
              </div>
              <div style={{ justifySelf: 'end' }}>
                {verified ? <Tick at={r.stateAt!} /> : tampered ? <Cross at={r.stateAt!} /> : null}
              </div>
            </div>
          )
        })}
        {seal ? (
          <div style={{ marginTop: 18, height: 44, opacity: sealed, transform: `scale(${0.92 + 0.08 * sealed})`, transformOrigin: 'left center' }}>
            <Pill tone="violet" monoText size={20}>
              {seal}
            </Pill>
          </div>
        ) : null}
      </Glass>
    </div>
  )
}

export const Tick: React.FC<{ at: number; size?: number }> = ({ at, size = 26 }) => {
  const f = useCurrentFrame()
  const p = tween(f, at, at + 10, 0, 1, EASE.out)
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" style={{ opacity: p }}>
      <circle cx="13" cy="13" r="12" fill={C.violetBg} stroke={C.violet} strokeWidth="1.4" />
      <path d="M7.5 13.4 L11.3 17 L18.5 9.3" stroke={C.violet} strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="20" strokeDashoffset={20 * (1 - p)} />
    </svg>
  )
}

export const Cross: React.FC<{ at: number; size?: number }> = ({ at, size = 26 }) => {
  const f = useCurrentFrame()
  const p = tween(f, at, at + 10, 0, 1, EASE.out)
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" style={{ opacity: p }}>
      <circle cx="13" cy="13" r="12" fill={C.roseBg} stroke={C.rose} strokeWidth="1.4" />
      <path d="M9 9 L17 17 M17 9 L9 17" stroke={C.rose} strokeWidth="2.2" strokeLinecap="round" strokeDasharray="12" strokeDashoffset={12 * (1 - p)} />
    </svg>
  )
}

/* ----------------------------------------------------------- footage pane */

export const SRC_W = 1600
export const SRC_H = 900
type Cam = { cx: number; cy: number; z: number }
export type CamKey = { at: number; cx: number; cy: number; z: number }

const manifest = clipManifest as Record<string, { duration: number | null; width?: number | null }>
export const hasClip = (name: string) => Object.prototype.hasOwnProperty.call(manifest, name)

/**
 * Footage of the dashboard in a frameless glass pane: no browser chrome. A virtual camera glides between
 * keys (page centre in the 1600x900 page space, and zoom) with log-space zoom so pushes feel even.
 */
export const Pane: React.FC<{
  clip: string
  x: number
  y: number
  w: number
  startFrom?: number
  rate?: number
  keys?: CamKey[]
  move?: number
  enter?: number
  freezeAt?: number
}> = ({ clip, x, y, w, startFrom = 0, rate = 1, keys = [], move = 22, enter = 0, freezeAt }) => {
  const f = useCurrentFrame()
  const h = (w * SRC_H) / SRC_W
  const k = w / SRC_W
  const sorted = [{ at: -1000, cx: SRC_W / 2, cy: SRC_H / 2, z: 1 }, ...keys].sort((a, b) => a.at - b.at)
  let cam: Cam = sorted[0]
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i]
    const b = sorted[i + 1]
    if (!b || f < b.at) {
      cam = a
      break
    }
    if (f < b.at + move) {
      const p = tween(f, b.at, b.at + move, 0, 1, EASE.inOut)
      cam = { cx: a.cx + (b.cx - a.cx) * p, cy: a.cy + (b.cy - a.cy) * p, z: Math.exp(Math.log(a.z) + (Math.log(b.z) - Math.log(a.z)) * p) }
      break
    }
    cam = b
  }
  const half = { w: SRC_W / 2 / cam.z, h: SRC_H / 2 / cam.z }
  const cx = Math.min(SRC_W - half.w, Math.max(half.w, cam.cx))
  const cy = Math.min(SRC_H - half.h, Math.max(half.h, cam.cy))
  const tx = w / 2 - cx * k * cam.z
  const ty = h / 2 - cy * k * cam.z
  const p = sp(f, enter, SPRING.ui)
  const length = manifest[clip]?.duration ?? null
  const last = length === null ? Infinity : Math.max(0, Math.floor(((length - startFrom) / rate - 0.2) * FPS))
  const frame = Math.min(freezeAt ?? Infinity, Math.min(Math.max(0, f), last))
  return (
    <div style={{ position: 'absolute', left: x, top: y, width: w, height: h, opacity: Math.min(1, p * 1.3), transform: `translateY(${(1 - p) * 26}px)` }}>
      <div style={{ position: 'absolute', inset: 0, borderRadius: 24, overflow: 'hidden', background: '#050505', boxShadow: '0 40px 100px rgba(0,0,0,0.6)' }}>
        <div style={{ position: 'absolute', left: 0, top: 0, width: w, height: h, transform: `translate(${tx}px, ${ty}px) scale(${cam.z})`, transformOrigin: '0 0' }}>
          {hasClip(clip) ? (
            <Freeze frame={frame}>
              <OffthreadVideo src={staticFile(`clips/${clip}.mp4`)} startFrom={Math.round(startFrom * FPS)} playbackRate={rate} muted style={{ width: '100%', height: '100%', display: 'block' }} />
            </Freeze>
          ) : (
            <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', fontFamily: mono, fontSize: 32, color: C.dim }}>clips/{clip}.mp4</AbsoluteFill>
          )}
        </div>
      </div>
      <Rim radius={24} a={0.38} />
    </div>
  )
}

/** A mono note that sits on the footage: what the viewer is looking at, honestly labelled. */
export const Honest: React.FC<{ at: number; children: React.ReactNode; x: number; y: number; out?: number }> = ({ at, children, x, y, out }) => {
  const f = useCurrentFrame()
  const p = tween(f, at, at + 12, 0, 1, EASE.out)
  const o = out === undefined ? 1 : 1 - tween(f, out, out + 10, 0, 1)
  return (
    <div style={{ position: 'absolute', left: x, top: y, opacity: p * o }}>
      <div style={{ ...TYPE.label, fontSize: 20, color: 'rgba(255,255,255,0.62)', textShadow: '0 0 12px #000, 0 0 24px #000' }}>{children}</div>
      <div style={{ height: 1, marginTop: 8, width: `${100 * tween(f, at + 4, at + 22, 0, 1)}%`, background: 'rgba(255,255,255,0.3)' }} />
    </div>
  )
}

/* ---------------------------------------------------------------- the mark */

/** The Autonr mark drawn live, so it can assemble: the brackets close in on the bar. */
export const Mark: React.FC<{ size?: number; close?: number; bar?: number; white?: boolean }> = ({ size = 200, close = 1, bar = 1, white = false }) => {
  const gap = (1 - close) * 260
  const fillL = white ? '#FFFFFF' : 'url(#am-g)'
  return (
    <svg width={size} height={(size * 783) / 802} viewBox="226 236 802 783" style={{ overflow: 'visible' }}>
      <defs>
        <linearGradient id="am-g" x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0" stopColor="#6A40FB" />
          <stop offset="1" stopColor="#4A18FD" />
        </linearGradient>
        <linearGradient id="am-bar" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7B52FB" />
          <stop offset="1" stopColor="#4511FB" />
        </linearGradient>
        <linearGradient id="am-fl" x1="1" y1="0" x2="0.2" y2="1">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity={white ? 0 : 0.17} />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity={white ? 0 : 0.05} />
        </linearGradient>
        <linearGradient id="am-fr" x1="0" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity={white ? 0 : 0.17} />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity={white ? 0 : 0.05} />
        </linearGradient>
        <mask id="am-ml" maskUnits="userSpaceOnUse" x="-200" y="200" width="1500" height="860">
          <path d="M448 256 V462.5 L387 498.5 V756.5 L448 792.5 V999 L246 877 V378 Z" fill="#fff" stroke="#fff" strokeWidth="14" strokeLinejoin="round" />
        </mask>
        <mask id="am-mr" maskUnits="userSpaceOnUse" x="-200" y="200" width="1500" height="860">
          <path d="M806 256 V462.5 L867 498.5 V756.5 L806 792.5 V999 L1008 877 V378 Z" fill="#fff" stroke="#fff" strokeWidth="14" strokeLinejoin="round" />
        </mask>
      </defs>
      <g transform={`translate(${-gap} 0)`} opacity={Math.min(1, close * 3)}>
        <path d="M448 256 V462.5 L387 498.5 V756.5 L448 792.5 V999 L246 877 V378 Z" fill={fillL} stroke={fillL} strokeWidth="14" strokeLinejoin="round" />
        <path d="M180 200 H470 V449.5 L387 498.5 L180 322 Z" fill="url(#am-fl)" mask="url(#am-ml)" />
      </g>
      <g transform={`translate(${gap} 0)`} opacity={Math.min(1, close * 3)}>
        <path d="M806 256 V462.5 L867 498.5 V756.5 L806 792.5 V999 L1008 877 V378 Z" fill={fillL} stroke={fillL} strokeWidth="14" strokeLinejoin="round" />
        <path d="M1074 200 H784 V449.5 L867 498.5 L1074 322 Z" fill="url(#am-fr)" mask="url(#am-mr)" />
      </g>
      <g transform={`translate(627 627) scale(${bar} 1) translate(-627 -627)`} opacity={Math.min(1, bar * 2)}>
        <rect x="448" y="572" width="359" height="110" rx="9" fill={white ? '#FFFFFF' : 'url(#am-bar)'} />
      </g>
    </svg>
  )
}
