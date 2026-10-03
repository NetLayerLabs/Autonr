import React from 'react'
import {
  AbsoluteFill,
  Freeze,
  OffthreadVideo,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion'
import { loadFont as loadSora } from '@remotion/google-fonts/Sora'
import { loadFont as loadInter } from '@remotion/google-fonts/Inter'
import { loadFont as loadJetBrains } from '@remotion/google-fonts/JetBrainsMono'
import clipManifest from './clips.json'

/**
 * Shared furniture for the Autonr demo.
 *
 * Autonr is an operator's console for a vault that does not trust its own agent, so the film is
 * set like one: a near-black ground, a single violet accent that is Hedera's, a geometric sans
 * for the words and a mono for everything that is a hash, an amount or a command. Motion is
 * unhurried: things rise a short way and settle, rules draw themselves, nothing bounces.
 */

/* ------------------------------------------------------------------ palette */

export const INK = '#0B0D14'
export const INK_2 = '#11141D'
export const CARD = '#171B26'
export const LINE = '#2A2F3D'
export const TEXT = '#F3F4F8'
export const TEXT_SOFT = '#AEB3C2'
export const TEXT_FAINT = '#6E7484'
export const VIOLET = '#8259EF'
export const VIOLET_SOFT = '#A78BFA'
export const VIOLET_TINT = 'rgba(130,89,239,.16)'
export const MINT = '#34D399'
export const MINT_TINT = 'rgba(52,211,153,.14)'
export const AMBER = '#F5B73C'
export const AMBER_TINT = 'rgba(245,183,60,.14)'
export const ROSE = '#F87171'
export const ROSE_TINT = 'rgba(248,113,113,.14)'

/* -------------------------------------------------------------------- fonts */

const sora = loadSora('normal', { weights: ['400', '500', '600', '700'], subsets: ['latin'] })
const inter = loadInter('normal', { weights: ['400', '500', '600'], subsets: ['latin'] })
const mono = loadJetBrains('normal', { weights: ['400', '500', '600'], subsets: ['latin'] })

export const DISPLAY = `${sora.fontFamily}, ui-sans-serif, system-ui, sans-serif`
export const SANS = `${inter.fontFamily}, ui-sans-serif, system-ui, sans-serif`
export const MONO = `${mono.fontFamily}, ui-monospace, "SF Mono", Menlo, monospace`

export const SITE = 'localhost:3000'

/* ------------------------------------------------------------------- motion */

const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

export const easeOut = (p: number) => 1 - Math.pow(1 - p, 3)
export const easeInOut = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2)

export const useProgress = (delay = 0, dur = 22) => {
  const f = useCurrentFrame()
  return easeOut(interpolate(f, [delay, delay + dur], [0, 1], CLAMP))
}

export const useRise = (delay = 0, distance = 22, out?: number) => {
  const f = useCurrentFrame()
  const pin = easeOut(interpolate(f, [delay, delay + 22], [0, 1], CLAMP))
  const pout = out === undefined ? 0 : easeInOut(interpolate(f, [out, out + 14], [0, 1], CLAMP))
  return {
    opacity: pin * (1 - pout),
    transform: `translateY(${(1 - pin) * distance - pout * 12}px)`,
  }
}

export const Rise: React.FC<{
  children: React.ReactNode
  delay?: number
  distance?: number
  out?: number
  style?: React.CSSProperties
}> = ({ children, delay = 0, distance = 22, out, style }) => (
  <div style={{ ...useRise(delay, distance, out), ...style }}>{children}</div>
)

export const Hairline: React.FC<{
  delay?: number
  width?: number | string
  color?: string
  weight?: number
  out?: number
  origin?: 'left' | 'right'
}> = ({ delay = 0, width = '100%', color = LINE, weight = 2, out, origin = 'left' }) => {
  const f = useCurrentFrame()
  const p = easeInOut(interpolate(f, [delay, delay + 26], [0, 1], CLAMP))
  const o = out === undefined ? 1 : 1 - interpolate(f, [out, out + 14], [0, 1], CLAMP)
  return (
    <div
      style={{ width, height: weight, background: color, opacity: o, transform: `scaleX(${p})`, transformOrigin: `${origin} center` }}
    />
  )
}

export const Reveal: React.FC<{
  children: React.ReactNode
  delay?: number
  dur?: number
  from?: 'below' | 'above'
  out?: number
  style?: React.CSSProperties
}> = ({ children, delay = 0, dur = 24, from = 'below', out, style }) => {
  const f = useCurrentFrame()
  const pin = easeOut(interpolate(f, [delay, delay + dur], [0, 1], CLAMP))
  const pout = out === undefined ? 0 : easeInOut(interpolate(f, [out, out + 16], [0, 1], CLAMP))
  const sign = from === 'below' ? 1 : -1
  const shift = (1 - pin) * 104 * sign + pout * 104 * sign
  return (
    <div style={{ overflow: 'hidden', paddingBottom: 4, marginBottom: -4, ...style }}>
      <div style={{ transform: `translateY(${shift}%)`, opacity: Math.min(1, pin * 3) }}>{children}</div>
    </div>
  )
}

/* ----------------------------------------------------------------- backdrop */

/** Near-black ground with a violet bloom that drifts, a fine grid, and a vignette. */
export const Backdrop: React.FC<{ bloom?: 'left' | 'right' | 'center' | 'none'; grid?: boolean }> = ({
  bloom = 'right',
  grid = true,
}) => {
  const f = useCurrentFrame()
  const drift = Math.sin(f / 150) * 40
  const pos = bloom === 'left' ? '18% 30%' : bloom === 'center' ? '50% 42%' : '82% 28%'
  return (
    <AbsoluteFill style={{ background: INK }}>
      {bloom !== 'none' && (
        <AbsoluteFill
          style={{
            background: `radial-gradient(60% 55% at ${pos}, rgba(130,89,239,.34) 0%, rgba(130,89,239,.08) 45%, rgba(11,13,20,0) 70%)`,
            transform: `translateX(${drift}px)`,
          }}
        />
      )}
      {grid && (
        <AbsoluteFill
          style={{
            backgroundImage:
              'linear-gradient(rgba(243,244,248,.045) 1px, transparent 1px), linear-gradient(90deg, rgba(243,244,248,.045) 1px, transparent 1px)',
            backgroundSize: '64px 64px',
            maskImage: 'radial-gradient(ellipse at center, rgba(0,0,0,1) 30%, rgba(0,0,0,0) 85%)',
          }}
        />
      )}
      <AbsoluteFill style={{ background: 'radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,.55) 100%)' }} />
    </AbsoluteFill>
  )
}

/* --------------------------------------------------------------------- type */

export const Eyebrow: React.FC<{ children: React.ReactNode; delay?: number; color?: string; size?: number; out?: number }> = ({
  children,
  delay = 0,
  color = VIOLET_SOFT,
  size = 22,
  out,
}) => (
  <div
    style={{
      ...useRise(delay, 12, out),
      fontFamily: SANS,
      fontSize: size,
      fontWeight: 600,
      letterSpacing: '0.22em',
      textTransform: 'uppercase',
      whiteSpace: 'nowrap',
      color,
    }}
  >
    {children}
  </div>
)

export type HeadLine = string | { em: string }
export const Headline: React.FC<{
  lines: HeadLine[]
  delay?: number
  size?: number
  color?: string
  emColor?: string
  stagger?: number
  out?: number
  align?: 'left' | 'center'
  weight?: number
}> = ({ lines, delay = 0, size = 72, color = TEXT, emColor = VIOLET_SOFT, stagger = 6, out, align = 'left', weight = 600 }) => (
  <div style={{ fontFamily: DISPLAY, fontSize: size, lineHeight: 1.1, letterSpacing: '-0.025em', fontWeight: weight, color, textAlign: align }}>
    {lines.map((l, i) => (
      <Reveal key={i} delay={delay + i * stagger} out={out} style={{ paddingBottom: size * 0.18, marginBottom: -size * 0.18 }}>
        {typeof l === 'string' ? <span>{l}</span> : <span style={{ color: emColor }}>{l.em}</span>}
      </Reveal>
    ))}
  </div>
)

export const Body: React.FC<{ children: React.ReactNode; delay?: number; size?: number; color?: string; out?: number; width?: number }> = ({
  children,
  delay = 0,
  size = 27,
  color = TEXT_SOFT,
  out,
  width,
}) => (
  <div style={{ ...useRise(delay, 16, out), fontFamily: SANS, fontSize: size, lineHeight: 1.45, color, width }}>{children}</div>
)

export const StepNumber: React.FC<{ n: number | string; delay?: number; size?: number; out?: number }> = ({ n, delay = 0, size = 96, out }) => (
  <div
    style={{
      ...useRise(delay, 14, out),
      fontFamily: DISPLAY,
      fontSize: size,
      fontWeight: 700,
      lineHeight: 1,
      letterSpacing: '-0.04em',
      color: VIOLET,
      opacity: 0.9,
    }}
  >
    {String(n).padStart(2, '0')}
  </div>
)

/* ------------------------------------------------------------------- brand */

/** The Hedera "H" mark, as shipped in the scaffold's public folder. */
export const HederaMark: React.FC<{ height?: number; style?: React.CSSProperties }> = ({ height = 48, style }) => (
  <img src={staticFile('brand/hedera-icon-white.svg')} style={{ height, width: 'auto', display: 'block', ...style }} />
)

export const HederaLockup: React.FC<{ height?: number; style?: React.CSSProperties }> = ({ height = 40, style }) => (
  <img src={staticFile('brand/hedera-lockup-white.svg')} style={{ height, width: 'auto', display: 'block', ...style }} />
)

/** The Autonr wordmark: a violet square with the mark's "A" cut, and the name. */
export const Lockup: React.FC<{ height?: number; delay?: number }> = ({ height = 120, delay = 0 }) => {
  const p = useProgress(delay, 26)
  const q = useProgress(delay + 8, 24)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: height * 0.26 }}>
      <div
        style={{
          width: height,
          height,
          borderRadius: height * 0.26,
          background: `linear-gradient(135deg, ${VIOLET} 0%, #5B3BD3 100%)`,
          boxShadow: '0 30px 60px -20px rgba(130,89,239,.6)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transform: `scale(${0.6 + 0.4 * p}) rotate(${(1 - p) * -8}deg)`,
          opacity: p,
        }}
      >
        <svg width={height * 0.56} height={height * 0.56} viewBox="0 0 100 100">
          <path d="M50 10 L88 88 L70 88 L50 46 L30 88 L12 88 Z" fill="#fff" />
          <rect x="35" y="68" width="30" height="9" rx="2" fill="#fff" />
        </svg>
      </div>
      <div style={{ overflow: 'hidden' }}>
        <div
          style={{
            fontFamily: DISPLAY,
            fontSize: height * 0.78,
            fontWeight: 700,
            letterSpacing: '-0.035em',
            color: TEXT,
            lineHeight: 1,
            transform: `translateX(${(1 - q) * -30}px)`,
            opacity: q,
          }}
        >
          Autonr
        </div>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------- cards */

export const Card: React.FC<{
  children: React.ReactNode
  delay?: number
  out?: number
  width?: number | string
  pad?: number
  style?: React.CSSProperties
  tone?: 'card' | 'violet' | 'mint' | 'rose' | 'amber'
}> = ({ children, delay = 0, out, width, pad = 28, style, tone = 'card' }) => {
  const tint = { card: CARD, violet: VIOLET_TINT, mint: MINT_TINT, rose: ROSE_TINT, amber: AMBER_TINT }[tone]
  const edge = { card: LINE, violet: 'rgba(130,89,239,.5)', mint: 'rgba(52,211,153,.5)', rose: 'rgba(248,113,113,.5)', amber: 'rgba(245,183,60,.5)' }[tone]
  return (
    <div
      style={{
        ...useRise(delay, 18, out),
        width,
        padding: pad,
        borderRadius: 18,
        background: tint,
        border: `1.5px solid ${edge}`,
        boxShadow: '0 40px 80px -40px rgba(0,0,0,.7)',
        ...style,
      }}
    >
      {children}
    </div>
  )
}

export const Chip: React.FC<{
  children: React.ReactNode
  delay?: number
  tone?: 'violet' | 'mint' | 'rose' | 'amber' | 'plain'
  out?: number
  size?: number
  mono?: boolean
}> = ({ children, delay = 0, tone = 'plain', out, size = 22, mono = false }) => {
  const fg = { violet: VIOLET_SOFT, mint: MINT, rose: ROSE, amber: AMBER, plain: TEXT_SOFT }[tone]
  const bg = { violet: VIOLET_TINT, mint: MINT_TINT, rose: ROSE_TINT, amber: AMBER_TINT, plain: 'rgba(243,244,248,.06)' }[tone]
  return (
    <div
      style={{
        ...useRise(delay, 10, out),
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        height: size * 1.9,
        padding: `0 ${size * 0.8}px`,
        borderRadius: 99,
        background: bg,
        border: `1.5px solid ${fg}44`,
        fontFamily: mono ? MONO : SANS,
        fontSize: size,
        fontWeight: 600,
        color: fg,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </div>
  )
}

/** A quiet "powered by" row used on the close. */
export const Logos: React.FC<{ names: string[]; delay?: number }> = ({ names, delay = 0 }) => (
  <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
    {names.map((n, i) => (
      <Chip key={n} delay={delay + i * 4} tone="plain" size={23}>
        {n}
      </Chip>
    ))}
  </div>
)

/* ------------------------------------------------------------------ caption */

/** A lower-third caption: a violet pip and one line. */
export const Caption: React.FC<{ children: React.ReactNode; delay?: number; out?: number; width?: number }> = ({ children, delay = 0, out, width = 1100 }) => (
  <div style={{ ...useRise(delay, 14, out), display: 'flex', alignItems: 'center', gap: 16, width }}>
    <div style={{ width: 10, height: 10, borderRadius: 99, background: VIOLET, boxShadow: `0 0 18px ${VIOLET}` }} />
    <div style={{ fontFamily: SANS, fontSize: 26, color: TEXT_SOFT, lineHeight: 1.3 }}>{children}</div>
  </div>
)

/* ------------------------------------------------------------ progress rail */

export const ProgressRail: React.FC<{ total: number }> = ({ total }) => {
  const f = useCurrentFrame()
  const p = Math.min(1, f / total)
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 5, background: 'rgba(243,244,248,.06)' }}>
      <div style={{ width: `${p * 100}%`, height: '100%', background: `linear-gradient(90deg, ${VIOLET} 0%, ${VIOLET_SOFT} 100%)` }} />
    </div>
  )
}

/* ---------------------------------------------------------------- terminal */

/**
 * A terminal that types its lines out. Each line arrives at a given second; a line
 * can be marked as the command (violet prompt) or as a highlight (mint).
 */
export type TermLine = { t: number; text: string; kind?: 'cmd' | 'out' | 'ok' | 'dim' | 'warn' }
export const Terminal: React.FC<{
  lines: TermLine[]
  title?: string
  width?: number
  height?: number
  delay?: number
  fontSize?: number
}> = ({ lines, title = 'autonr', width = 1200, height = 620, delay = 0, fontSize = 23 }) => {
  const f = useCurrentFrame()
  const { fps } = useVideoConfig()
  const enter = easeOut(interpolate(f, [delay, delay + 24], [0, 1], CLAMP))
  const sec = f / fps
  const typed = lines
    .filter((l) => sec >= l.t)
    .map((l) => {
      const age = sec - l.t
      // Commands type character by character; output lines arrive whole.
      const n = l.kind === 'cmd' ? Math.min(l.text.length, Math.floor(age * 38)) : l.text.length
      return { ...l, shown: l.text.slice(0, n), done: n >= l.text.length }
    })
  const last = typed[typed.length - 1]
  const cursorOn = Math.floor(f / 16) % 2 === 0
  const color = (k?: TermLine['kind']) =>
    k === 'cmd' ? TEXT : k === 'ok' ? MINT : k === 'dim' ? TEXT_FAINT : k === 'warn' ? AMBER : TEXT_SOFT
  return (
    <div
      style={{
        width,
        height,
        opacity: enter,
        transform: `translateY(${(1 - enter) * 24}px)`,
        borderRadius: 16,
        background: '#0D1017',
        border: `1.5px solid ${LINE}`,
        boxShadow: '0 60px 120px -50px rgba(0,0,0,.85), 0 0 0 1px rgba(130,89,239,.12)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ height: 46, display: 'flex', alignItems: 'center', padding: '0 18px', gap: 8, background: '#12161F', borderBottom: `1px solid ${LINE}` }}>
        {['#FF5F57', '#FEBC2E', '#28C840'].map((c) => (
          <span key={c} style={{ width: 12, height: 12, borderRadius: 99, background: c }} />
        ))}
        <span style={{ marginLeft: 14, fontFamily: SANS, fontSize: 18, color: TEXT_FAINT }}>{title}</span>
      </div>
      <div style={{ padding: '22px 28px', fontFamily: MONO, fontSize, lineHeight: 1.5, flex: 1, overflow: 'hidden' }}>
        {typed.map((l, i) => (
          <div key={i} style={{ color: color(l.kind), whiteSpace: 'pre', display: 'flex' }}>
            {l.kind === 'cmd' && <span style={{ color: VIOLET_SOFT, marginRight: 12 }}>$</span>}
            <span>{l.shown}</span>
            {i === typed.length - 1 && l.kind === 'cmd' && !l.done && cursorOn && (
              <span style={{ display: 'inline-block', width: 11, height: fontSize * 1.1, background: TEXT, marginLeft: 2, verticalAlign: 'text-bottom' }} />
            )}
          </div>
        ))}
        {last?.done && last.kind !== 'cmd' && cursorOn && (
          <div style={{ color: VIOLET_SOFT }}>
            $ <span style={{ display: 'inline-block', width: 11, height: fontSize * 1.1, background: TEXT, verticalAlign: 'text-bottom' }} />
          </div>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------ browser frame */

export const SRC_W = 1600
export const SRC_H = 900

export type Focus = {
  rect: [number, number, number, number]
  from: number
  to: number
  move?: number
  maxZoom?: number
  maxMag?: number
}

export type Shot = {
  clip: string
  at?: number
  startFrom?: number
  playbackRate?: number
  freeze?: boolean
  path?: string
  fast?: boolean
  dissolve?: number
}

type Cam = { cx: number; cy: number; z: number }
const FULL: Cam = { cx: SRC_W / 2, cy: SRC_H / 2, z: 1 }

const camFor = (fo: Focus, zCap: number, capFor: (m: number) => number): Cam => {
  const [x, y, w, h] = fo.rect
  const cap = fo.maxMag === undefined ? zCap : capFor(fo.maxMag)
  const z = Math.max(1, Math.min(fo.maxZoom ?? 4, cap, Math.min(SRC_W / w, SRC_H / h) * 0.92))
  const half = { w: SRC_W / 2 / z, h: SRC_H / 2 / z }
  return {
    z,
    cx: Math.min(SRC_W - half.w, Math.max(half.w, x + w / 2)),
    cy: Math.min(SRC_H - half.h, Math.max(half.h, y + h / 2)),
  }
}

const cameraAt = (t: number, focus: Focus[], zCap: number, capFor: (m: number) => number): Cam => {
  const sorted = [...focus].sort((a, b) => a.from - b.from)
  const open = sorted[0] && sorted[0].from <= 0 ? camFor(sorted[0], zCap, capFor) : FULL
  const keys: { t: number; c: Cam }[] = [{ t: 0, c: open }]
  sorted.forEach((fo, i) => {
    const move = fo.move ?? 1.2
    const last = keys[keys.length - 1]
    keys.push({ t: Math.max(fo.from, last.t), c: last.c })
    keys.push({ t: Math.max(fo.from, last.t) + move, c: camFor(fo, zCap, capFor) })
    keys.push({ t: Math.max(fo.to, fo.from + move), c: camFor(fo, zCap, capFor) })
    const next = sorted[i + 1]
    if (!next || next.from > fo.to + move) keys.push({ t: fo.to + move, c: FULL })
  })
  for (let i = keys.length - 1; i >= 0; i--) {
    if (t >= keys[i].t) {
      const a = keys[i]
      const b = keys[i + 1]
      if (!b || b.t === a.t) return a.c
      const p = easeInOut(Math.min(1, (t - a.t) / (b.t - a.t)))
      return { cx: a.c.cx + (b.c.cx - a.c.cx) * p, cy: a.c.cy + (b.c.cy - a.c.cy) * p, z: a.c.z + (b.c.z - a.c.z) * p }
    }
  }
  return FULL
}

const manifest = clipManifest as Record<string, { duration: number | null; width?: number | null }>
export const hasClip = (name: string) => Object.prototype.hasOwnProperty.call(manifest, name)
export const dprOf = (name: string) => (manifest[name]?.width ?? SRC_W) / SRC_W

const ShotVideo: React.FC<{ shot: Shot }> = ({ shot }) => {
  const f = useCurrentFrame()
  const { fps } = useVideoConfig()
  const rate = shot.playbackRate ?? 1
  const start = shot.startFrom ?? 0
  const length = manifest[shot.clip]?.duration ?? null
  const lastFrame = length === null ? Infinity : Math.max(0, Math.floor(((length - start) / rate - 0.2) * fps))
  return (
    <Freeze frame={shot.freeze ? 0 : Math.min(f, lastFrame)}>
      <OffthreadVideo
        src={staticFile(`clips/${shot.clip}.mp4`)}
        startFrom={Math.round(start * fps)}
        playbackRate={rate}
        muted
        style={{ width: '100%', height: '100%', display: 'block', objectFit: 'cover' }}
      />
    </Freeze>
  )
}

const MissingClip: React.FC<{ name: string }> = ({ name }) => (
  <AbsoluteFill style={{ background: INK_2, alignItems: 'center', justifyContent: 'center' }}>
    <div style={{ fontFamily: MONO, fontSize: 40, color: TEXT_FAINT }}>clips/{name}.mp4</div>
  </AbsoluteFill>
)

export const BrowserFrame: React.FC<{
  shots: Shot[]
  width?: number
  delay?: number
  dur?: number
  pushIn?: [number, number]
  focus?: Focus[]
  origin?: string
  maxMag?: number
}> = ({ shots, width = 1260, delay = 0, dur = 360, pushIn = [1, 1.03], focus = [], origin = 'center center', maxMag }) => {
  const f = useCurrentFrame()
  const { fps } = useVideoConfig()
  const enter = easeOut(interpolate(f, [delay, delay + 26], [0, 1], CLAMP))
  const push = interpolate(f, [0, dur], pushIn, CLAMP)
  const BAR = 48
  const vw = width
  const vh = (width * SRC_H) / SRC_W
  const k = vw / SRC_W
  const auto = Math.min(...shots.map((sh) => (dprOf(sh.clip) >= 2 ? 2 : 1.4)))
  const capFor = (m: number) => m / (k * pushIn[1])
  const cam = cameraAt(f / fps, focus, capFor(maxMag ?? auto), capFor)
  const tx = vw / 2 - cam.cx * k * cam.z
  const ty = vh / 2 - cam.cy * k * cam.z
  const cuts = shots.map((sh) => Math.round((sh.at ?? 0) * fps))
  let active = 0
  cuts.forEach((c, i) => {
    if (f >= c) active = i
  })
  const fadeOf = (i: number) => (i === 0 ? 0 : Math.round(shots[i].dissolve ?? 8))

  return (
    <div
      style={{
        width,
        opacity: enter,
        transform: `translateY(${(1 - enter) * 30}px) scale(${push})`,
        transformOrigin: origin,
        borderRadius: 16,
        overflow: 'hidden',
        background: INK_2,
        border: `1.5px solid ${LINE}`,
        boxShadow: '0 80px 140px -60px rgba(0,0,0,.9), 0 0 0 1px rgba(130,89,239,.10), 0 30px 60px -30px rgba(130,89,239,.25)',
      }}
    >
      <div style={{ height: BAR, display: 'flex', alignItems: 'center', padding: '0 20px', background: '#12161F', borderBottom: `1px solid ${LINE}`, position: 'relative' }}>
        <div style={{ display: 'flex', gap: 9 }}>
          {['#FF5F57', '#FEBC2E', '#28C840'].map((c) => (
            <span key={c} style={{ width: 13, height: 13, borderRadius: 99, background: c }} />
          ))}
        </div>
        <div
          style={{
            position: 'absolute',
            left: '50%',
            transform: 'translateX(-50%)',
            height: 32,
            minWidth: 480,
            padding: '0 20px',
            borderRadius: 99,
            background: INK,
            border: `1px solid ${LINE}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            fontFamily: MONO,
            fontSize: 19,
            color: TEXT_SOFT,
          }}
        >
          <svg width="12" height="14" viewBox="0 0 13 15" fill="none">
            <rect x="1" y="6.4" width="11" height="7.6" rx="2" fill={VIOLET_SOFT} />
            <path d="M3.6 6.4V4.3a2.9 2.9 0 015.8 0v2.1" stroke={VIOLET_SOFT} strokeWidth="1.6" />
          </svg>
          <span>
            {SITE}
            <span style={{ color: TEXT_FAINT }}>{shots[active]?.path ?? ''}</span>
          </span>
        </div>
      </div>
      <div style={{ width: vw, height: vh, position: 'relative', overflow: 'hidden', background: INK_2 }}>
        <div style={{ position: 'absolute', left: 0, top: 0, width: vw, height: vh, transform: `translate(${tx}px, ${ty}px) scale(${cam.z})`, transformOrigin: '0 0' }}>
          {shots.map((sh, i) => {
            const fade = fadeOf(i)
            const from = cuts[i]
            const until = i + 1 < shots.length ? cuts[i + 1] + fadeOf(i + 1) : Infinity
            if (f < from || f > until) return null
            const o = fade <= 0 ? 1 : interpolate(f, [from, from + fade], [0, 1], CLAMP)
            return (
              <AbsoluteFill key={`${sh.clip}-${i}`} style={{ opacity: o }}>
                {hasClip(sh.clip) ? (
                  <Sequence from={from} layout="none">
                    <ShotVideo shot={sh} />
                  </Sequence>
                ) : (
                  <MissingClip name={sh.clip} />
                )}
              </AbsoluteFill>
            )
          })}
        </div>
      </div>
    </div>
  )
}
