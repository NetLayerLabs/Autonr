import { Easing, interpolate, spring } from 'remotion'
import { loadFont as loadInter } from '@remotion/google-fonts/Inter'
import { loadFont as loadSerif } from '@remotion/google-fonts/InstrumentSerif'
import { loadFont as loadMono } from '@remotion/google-fonts/JetBrainsMono'

/**
 * The Autonr film is set in the same language as the dashboard: black, white type, one muted violet that
 * means "enforced / verified", one rose that means "refused / failed". The saturated violet of the logo
 * appears only in the logo. Inter for words, JetBrains Mono for data, Instrument Serif italic on four words.
 */
export const inter = loadInter('normal', { weights: ['400', '500', '600'], subsets: ['latin'] }).fontFamily
export const serif = loadSerif('italic', { weights: ['400'], subsets: ['latin'] }).fontFamily
export const mono = loadMono('normal', { weights: ['400', '500'], subsets: ['latin'] }).fontFamily

export const W = 1920
export const H = 1080
export const FPS = 30

export const C = {
  bg: '#000000',
  ink: '#FFFFFF',
  hero: '#F1F3F5',
  body: '#A6A6A6',
  dim: '#7A7A7A',
  faint: '#474747',
  card: '#0D0D0D',
  line: '#333333',
  hair: 'rgba(255,255,255,0.14)',
  /** enforced / verified / accepted */
  violet: 'hsl(250, 38%, 78%)',
  violetDot: 'hsl(250, 45%, 74%)',
  violetRim: 'hsl(250, 40%, 66%)',
  violetBg: 'hsla(250, 35%, 55%, 0.16)',
  /** refused / failed */
  rose: 'hsl(0, 30%, 76%)',
  roseBg: 'hsla(0, 26%, 70%, 0.12)',
  /** the logo, and nothing else */
  brand: '#5B2EFB',
}

export const TYPE = {
  caps: { fontFamily: inter, fontWeight: 500, fontSize: 15, letterSpacing: '0.16em', textTransform: 'uppercase' as const, color: C.body },
  label: { fontFamily: mono, fontWeight: 500, fontSize: 21, color: 'rgba(255,255,255,0.6)', fontVariantNumeric: 'tabular-nums' as const },
  row: { fontFamily: mono, fontWeight: 400, fontSize: 25, letterSpacing: '-0.01em', fontVariantNumeric: 'tabular-nums' as const },
  small: { fontFamily: inter, fontWeight: 400, fontSize: 22, color: C.body, letterSpacing: '-0.005em', lineHeight: 1.4 },
  caption: { fontFamily: inter, fontWeight: 500, fontSize: 40, letterSpacing: '-0.012em', lineHeight: 1.2 },
}

export const SPRING = {
  text: { stiffness: 160, damping: 22 },
  accent: { stiffness: 120, damping: 16 },
  ui: { stiffness: 200, damping: 23 },
  object: { stiffness: 40, damping: 9 },
  pop: { stiffness: 220, damping: 22 },
}

export const EASE = {
  inOut: Easing.bezier(0.65, 0, 0.35, 1),
  out: Easing.out(Easing.cubic),
  in: Easing.in(Easing.cubic),
  expoIn: Easing.in(Easing.exp),
  expoOut: Easing.out(Easing.exp),
  back: Easing.out(Easing.back(1.2)),
  site: Easing.bezier(0.22, 1, 0.36, 1),
}

export const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

/** 0..1 spring progress starting at frame `at`. */
export const sp = (f: number, at: number, config: { stiffness: number; damping: number } = SPRING.text) =>
  f < at ? 0 : spring({ frame: f - at, fps: FPS, config: { mass: 1, ...config } })

/** Eased tween from `a` to `b` between frames `f0` and `f1`. */
export const tween = (f: number, f0: number, f1: number, a = 0, b = 1, easing = EASE.inOut) =>
  interpolate(f, [f0, Math.max(f0 + 0.001, f1)], [a, b], { ...CLAMP, easing })

/** The Veir rim: a 1.4px ring that is bright at the top and bottom edges and clear at the sides. */
export const rimGradient = (a = 0.45, rgb = '255,255,255') =>
  `linear-gradient(180deg, rgba(${rgb},${a}) 0%, rgba(${rgb},${a / 3}) 20%, rgba(${rgb},0) 40%, rgba(${rgb},0) 60%, rgba(${rgb},${a / 3}) 80%, rgba(${rgb},${a}) 100%)`
