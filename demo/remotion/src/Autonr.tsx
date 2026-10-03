import React from 'react'
import { AbsoluteFill, Audio, Sequence, interpolate, staticFile, useCurrentFrame } from 'remotion'
import durations from '../public/vo/durations.json'
import {
  AMBER, Backdrop, Body, BrowserFrame, Caption, Card, Chip, DISPLAY, Eyebrow, Focus, Hairline, Headline,
  HederaLockup, HederaMark, LINE, Lockup, Logos, MINT, MONO, ProgressRail, Reveal, Rise, ROSE, SANS,
  StepNumber, TEXT, TEXT_FAINT, TEXT_SOFT, Terminal, TermLine, VIOLET, VIOLET_SOFT, easeInOut, easeOut, useProgress,
} from './ui'

/* ------------------------------------------------------------------- timing */

export const FPS = 30
const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

/** Frames of picture before the voice starts in every scene. */
const LEAD = 8
/** Seconds of air after the voice ends, per scene. */
const TAIL: Record<string, number> = { v00: 1.4, v10: 2.6 }
const TAIL_DEFAULT = 0.7
/** The narration masters quiet; finish.mjs lands the final loudness, this keeps a re-render honest. */
const VO_GAIN = 2
const FADE = 12

const IDS = ['v00', 'v01', 'v02', 'v03', 'v04', 'v05', 'v06', 'v07', 'v08', 'v09', 'v10'] as const
type Id = (typeof IDS)[number]
const VO = durations as Record<Id, number>

const SCENES = IDS.map((id) => ({ id, dur: LEAD + Math.round((VO[id] + (TAIL[id] ?? TAIL_DEFAULT)) * FPS) }))
const STARTS = SCENES.reduce<number[]>((a, _, i) => [...a, i === 0 ? 0 : a[i - 1] + SCENES[i - 1].dur], [])
export const AUTONR_DURATION = SCENES.reduce((n, sc) => n + sc.dur, 0)
const durOf = (id: Id) => SCENES[IDS.indexOf(id)].dur

/** Narration seconds to scene frames. Every cue below is written in narration seconds. */
const at = (s: number) => LEAD + Math.round(s * FPS)
/** Narration seconds to scene seconds, for BrowserFrame shots and focus. */
const sec = (narration: number) => narration + LEAD / FPS

/** A focus rectangle aimed like a camera: centre point and zoom, in the 1600x900 page space. */
const box = (cx: number, cy: number, z: number): [number, number, number, number] => [cx - 736 / z, cy - 414 / z, 1472 / z, 828 / z]

/* ------------------------------------------------------------------ layouts */

/** Text column on the left, the browser window on the right. */
const Side: React.FC<{
  step?: number
  eyebrow: string
  lines: React.ComponentProps<typeof Headline>['lines']
  children?: React.ReactNode
  foot?: React.ReactNode
  frame: React.ReactNode
  out?: number
  frameW?: number
  colW?: number
}> = ({ step, eyebrow, lines, children, foot, frame, out, frameW = 1210, colW = 520 }) => (
  <AbsoluteFill>
    <div style={{ position: 'absolute', left: 96, top: 110, width: colW }}>
      {step !== undefined && (
        <>
          <StepNumber n={step} delay={2} out={out} />
          <div style={{ height: 22 }} />
        </>
      )}
      <Eyebrow delay={6} out={out}>{eyebrow}</Eyebrow>
      <div style={{ height: 18 }} />
      <Headline lines={lines} delay={10} size={54} out={out} />
      <div style={{ height: 34 }} />
      {children}
    </div>
    <div style={{ position: 'absolute', left: 96, bottom: 90, width: 540 }}>{foot}</div>
    <div style={{ position: 'absolute', right: 72, top: 0, bottom: 0, width: frameW, display: 'flex', alignItems: 'center' }}>{frame}</div>
  </AbsoluteFill>
)

/** Footage first: the window takes the width, a strip beneath carries the step and title. */
const Wide: React.FC<{ step: number; eyebrow: string; title: string; note?: React.ReactNode; frame: React.ReactNode; right?: React.ReactNode }> = ({
  step, eyebrow, title, note, frame, right,
}) => (
  <AbsoluteFill>
    <div style={{ position: 'absolute', left: (1920 - 1440) / 2, top: 26 }}>{frame}</div>
    <div style={{ position: 'absolute', left: 240, right: 240, top: 892, height: 170, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
        <StepNumber n={step} delay={4} size={104} />
        <div>
          <Eyebrow delay={8} size={20}>{eyebrow}</Eyebrow>
          <div style={{ height: 6 }} />
          <Reveal delay={12}>
            <div style={{ fontFamily: DISPLAY, fontSize: 36, fontWeight: 600, letterSpacing: '-0.02em', color: TEXT, whiteSpace: 'nowrap' }}>{title}</div>
          </Reveal>
          <div style={{ height: 8 }} />
          <div style={{ position: 'relative', height: 44 }}>{note}</div>
        </div>
      </div>
      <div style={{ width: 520, position: 'relative', flexShrink: 0 }}>{right}</div>
    </div>
  </AbsoluteFill>
)

const Note: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ position: 'absolute', left: 0, top: 0, display: 'flex', alignItems: 'center', gap: 12, whiteSpace: 'nowrap' }}>{children}</div>
)

/* ------------------------------------------------------- the trade diagram */

/**
 * The one picture the whole film is about: agent, oracles, vault, DEX, and the HCS topic that
 * sits in front of the trade. Drawn once; each scene lights up the part it is talking about.
 */
type NodeKey = 'agent' | 'hcs' | 'vault' | 'chainlink' | 'supra' | 'dex' | 'verifier'
const NODES: Record<NodeKey, { x: number; y: number; label: string; sub: string; w?: number }> = {
  agent: { x: 150, y: 420, label: 'AI agent', sub: 'decides whether' },
  hcs: { x: 560, y: 160, label: 'HCS topic', sub: 'reasoning, first', w: 300 },
  vault: { x: 620, y: 420, label: 'AgentVault', sub: 'enforces both', w: 320 },
  chainlink: { x: 1100, y: 200, label: 'Chainlink', sub: 'prices each leg' },
  supra: { x: 1100, y: 420, label: 'Supra', sub: 'must agree' },
  dex: { x: 1100, y: 640, label: 'SaucerSwap V2', sub: 'executes', w: 300 },
  verifier: { x: 560, y: 680, label: 'Verifier', sub: 'Mirror Node only', w: 300 },
}
const NW = 270
const NH = 110

const Diagram: React.FC<{
  /** Which nodes are lit, and from what narration second each lights. */
  lit: Partial<Record<NodeKey, number>>
  /** Links drawn, as [from, to, narration second, label?]. */
  links: [NodeKey, NodeKey, number, string?][]
  /** A moving pulse along a link: [from, to, start second, duration]. */
  pulses?: [NodeKey, NodeKey, number, number][]
  delay?: number
  scale?: number
}> = ({ lit, links, pulses = [], delay = 0, scale = 1 }) => {
  const f = useCurrentFrame()
  const enter = easeOut(interpolate(f, [delay, delay + 24], [0, 1], CLAMP))
  const centre = (k: NodeKey) => ({ x: NODES[k].x + (NODES[k].w ?? NW) / 2, y: NODES[k].y + NH / 2 })
  const edge = (a: NodeKey, b: NodeKey) => {
    const ca = centre(a)
    const cb = centre(b)
    const wa = (NODES[a].w ?? NW) / 2
    const wb = (NODES[b].w ?? NW) / 2
    const dx = cb.x - ca.x
    const dy = cb.y - ca.y
    const horizontal = Math.abs(dx) > Math.abs(dy) * 1.2
    const from = horizontal ? { x: ca.x + Math.sign(dx) * wa, y: ca.y } : { x: ca.x, y: ca.y + Math.sign(dy) * (NH / 2) }
    const to = horizontal ? { x: cb.x - Math.sign(dx) * wb, y: cb.y } : { x: cb.x, y: cb.y - Math.sign(dy) * (NH / 2) }
    return { from, to }
  }
  return (
    <div style={{ position: 'relative', width: 1420, height: 820, opacity: enter, transform: `scale(${scale}) translateY(${(1 - enter) * 20}px)`, transformOrigin: 'center' }}>
      <svg width={1420} height={820} style={{ position: 'absolute', left: 0, top: 0 }}>
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill={VIOLET_SOFT} />
          </marker>
        </defs>
        {links.map(([a, b, t, label], i) => {
          const p = easeInOut(interpolate(f, [at(t), at(t) + 22], [0, 1], CLAMP))
          if (p <= 0) return null
          const { from, to } = edge(a, b)
          const x2 = from.x + (to.x - from.x) * p
          const y2 = from.y + (to.y - from.y) * p
          return (
            <g key={i}>
              <line x1={from.x} y1={from.y} x2={x2} y2={y2} stroke={VIOLET_SOFT} strokeWidth={3} strokeOpacity={0.85} markerEnd={p > 0.95 ? 'url(#arrow)' : undefined} />
              {label && p > 0.9 && (
                <text x={(from.x + to.x) / 2} y={(from.y + to.y) / 2 - 12} fill={TEXT_SOFT} fontFamily={SANS} fontSize={19} textAnchor="middle" opacity={interpolate(f, [at(t) + 20, at(t) + 32], [0, 1], CLAMP)}>
                  {label}
                </text>
              )}
            </g>
          )
        })}
        {pulses.map(([a, b, t, d], i) => {
          const p = interpolate(f, [at(t), at(t) + d * FPS], [0, 1], CLAMP)
          if (p <= 0 || p >= 1) return null
          const { from, to } = edge(a, b)
          const e = easeInOut(p)
          return <circle key={`p${i}`} cx={from.x + (to.x - from.x) * e} cy={from.y + (to.y - from.y) * e} r={9} fill={MINT} style={{ filter: `drop-shadow(0 0 10px ${MINT})` }} />
        })}
      </svg>
      {(Object.keys(NODES) as NodeKey[]).map((k) => {
        const n = NODES[k]
        const since = lit[k]
        const on = since === undefined ? 0 : easeOut(interpolate(f, [at(since), at(since) + 18], [0, 1], CLAMP))
        const hed = k === 'hcs' || k === 'vault'
        return (
          <div
            key={k}
            style={{
              position: 'absolute',
              left: n.x,
              top: n.y,
              width: n.w ?? NW,
              height: NH,
              borderRadius: 16,
              background: on > 0 ? `rgba(130,89,239,${0.1 + on * 0.14})` : 'rgba(23,27,38,.9)',
              border: `1.5px solid ${on > 0 ? `rgba(167,139,250,${0.35 + on * 0.6})` : LINE}`,
              boxShadow: on > 0 ? `0 0 ${40 * on}px rgba(130,89,239,${0.35 * on})` : 'none',
              transform: `scale(${1 + on * 0.04})`,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              padding: '0 22px',
              gap: 4,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {hed && <HederaMark height={22} style={{ opacity: 0.9 }} />}
              <div style={{ fontFamily: DISPLAY, fontSize: 26, fontWeight: 600, color: on > 0 ? TEXT : TEXT_SOFT, letterSpacing: '-0.01em' }}>{n.label}</div>
            </div>
            <div style={{ fontFamily: SANS, fontSize: 19, color: on > 0 ? VIOLET_SOFT : TEXT_FAINT }}>{n.sub}</div>
          </div>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------ check ticks */

/** The twelve verifier checks ticking green one after another. */
const CHECKS = [
  'Trade transaction succeeded', 'Emitter is a genuine AgentVault', 'Receipt names the decision topic', 'Decision message exists',
  'Message bytes match the committed hash', 'Decision published before the trade', 'One key signed decision and trade',
  'Decision is a valid trade record', 'Decision matches the executed trade', 'Oracle readings match the chain',
  'Oracles read before the swap, in one tx', 'Execution within the slippage policy',
]
const CheckList: React.FC<{ from: number; every?: number; fail?: number; failAt?: number; width?: number }> = ({ from, every = 0.42, fail, failAt, width = 560 }) => {
  const f = useCurrentFrame()
  return (
    <div style={{ width, display: 'flex', flexDirection: 'column', gap: 9 }}>
      {CHECKS.map((c, i) => {
        const t = at(from + i * every)
        const p = easeOut(interpolate(f, [t, t + 10], [0, 1], CLAMP))
        const failed = fail === i && failAt !== undefined && f >= at(failAt)
        const fp = failed ? easeOut(interpolate(f, [at(failAt!), at(failAt!) + 10], [0, 1], CLAMP)) : 0
        const color = failed ? ROSE : MINT
        return (
          <div key={c} style={{ display: 'flex', alignItems: 'center', gap: 12, opacity: p, transform: `translateX(${(1 - p) * 12}px)` }}>
            <div style={{ width: 24, height: 24, borderRadius: 99, background: failed ? `rgba(248,113,113,${0.25 + fp * 0.3})` : 'rgba(52,211,153,.18)', border: `1.5px solid ${color}`, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `scale(${1 + fp * 0.18})` }}>
              {failed ? (
                <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 2 L10 10 M10 2 L2 10" stroke={ROSE} strokeWidth="2.2" strokeLinecap="round" /></svg>
              ) : (
                <svg width="13" height="11" viewBox="0 0 13 11"><path d="M1.5 5.5 L5 9 L11.5 1.8" stroke={MINT} strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
              )}
            </div>
            <div style={{ fontFamily: SANS, fontSize: 21, color: failed ? ROSE : TEXT_SOFT, fontWeight: failed ? 600 : 400 }}>{c}</div>
          </div>
        )
      })}
    </div>
  )
}

/* ================================================================== scenes */

/* S00: title. */
const S00: React.FC = () => (
  <AbsoluteFill>
    <Backdrop bloom="center" />
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
      <Lockup height={150} delay={4} />
      <div style={{ height: 36 }} />
      <Hairline delay={30} width={520} color={VIOLET} weight={2} />
      <div style={{ height: 30 }} />
      <Headline lines={['Let an AI agent trade on Hedera.', { em: 'Without trusting it.' }]} delay={36} size={52} align="center" weight={500} />
    </AbsoluteFill>
    <div style={{ position: 'absolute', bottom: 60, left: 0, right: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 18 }}>
      <Rise delay={52}><div style={{ fontFamily: SANS, fontSize: 21, color: TEXT_FAINT, letterSpacing: '0.18em', textTransform: 'uppercase' }}>A scaffold-hbar template for</div></Rise>
      <Rise delay={56}><HederaLockup height={34} style={{ opacity: 0.9 }} /></Rise>
    </div>
  </AbsoluteFill>
)

/* S01: the problem. One hallucination away. */
const S01: React.FC = () => {
  const f = useCurrentFrame()
  const shake = f > at(3.2) && f < at(4.4) ? Math.sin(f * 1.7) * 3 : 0
  return (
    <AbsoluteFill>
      <Backdrop bloom="left" />
      <div style={{ position: 'absolute', left: 120, top: 150, width: 820 }}>
        <Eyebrow delay={4} color={ROSE}>The problem</Eyebrow>
        <div style={{ height: 22 }} />
        <Headline lines={['An agent with the keys', 'is one hallucination away', { em: 'from draining a vault.' }]} delay={8} size={64} emColor={ROSE} />
        <div style={{ height: 40 }} />
        <Body delay={at(6.2)} size={28} width={760}>And afterwards, all you have is its word for why it traded.</Body>
      </div>
      <div style={{ position: 'absolute', right: 150, top: 230, transform: `translateX(${shake}px)` }}>
        <Card delay={at(0.8)} tone="rose" width={620} pad={32}>
          <div style={{ fontFamily: MONO, fontSize: 21, color: ROSE, letterSpacing: '0.1em' }}>UNTRUSTED AGENT</div>
          <div style={{ height: 18 }} />
          {[
            ['holds the keys', at(1.4)],
            ['sets its own price', at(2.2)],
            ['minimum output: 0', at(3.0)],
            ['reasoning: "trust me"', at(6.6)],
          ].map(([t, d]) => (
            <Rise key={String(t)} delay={Number(d)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 0', borderBottom: `1px solid rgba(248,113,113,.18)` }}>
                <div style={{ width: 10, height: 10, borderRadius: 99, background: ROSE }} />
                <div style={{ fontFamily: MONO, fontSize: 25, color: TEXT }}>{t}</div>
              </div>
            </Rise>
          ))}
        </Card>
      </div>
    </AbsoluteFill>
  )
}

/* S02: the split. The diagram lights up in three parts. */
const S02: React.FC = () => (
  <AbsoluteFill>
    <Backdrop bloom="right" />
    <div style={{ position: 'absolute', left: 110, top: 96, width: 1700 }}>
      <Eyebrow delay={4}>The design</Eyebrow>
      <div style={{ height: 14 }} />
      <Headline lines={['Three jobs. Three parties. Nothing trusted twice.']} delay={8} size={48} />
    </div>
    <div style={{ position: 'absolute', left: 250, top: 200 }}>
      <Diagram
        delay={14}
        lit={{ agent: 1.6, chainlink: 4.6, supra: 6.6, vault: 9.6, dex: 12.4 }}
        links={[
          ['agent', 'vault', 2.6, 'whether'],
          ['vault', 'chainlink', 5.2, 'price each leg'],
          ['vault', 'supra', 7.2, 'must agree'],
          ['vault', 'dex', 12.8, 'only then'],
        ]}
      />
    </div>
    <div style={{ position: 'absolute', right: 110, top: 108, display: 'flex', gap: 14 }}>
      <Chip delay={at(2)} tone="violet">Agent: whether</Chip>
      <Chip delay={at(5)} tone="violet">Chainlink + Supra: at what price</Chip>
      <Chip delay={at(9.8)} tone="violet">Vault: enforces both, on-chain</Chip>
    </div>
  </AbsoluteFill>
)

/* S03: one command, the dashboard. */
const S03: React.FC = () => (
  <Side
    step={1}
    eyebrow="One command"
    lines={['The whole stack,', 'already live.']}
    frame={
      <BrowserFrame
        dur={durOf('v03')}
        shots={[{ clip: 'home', path: '/', startFrom: 0 }]}
        focus={[{ rect: box(792, 785, 1.75), from: sec(10.2), to: sec(15.6), move: 1.4 }]}
      />
    }
    foot={<Caption delay={at(10.4)} width={520}>Chainlink and Supra, read from the oracle contracts.</Caption>}
  >
    <Rise delay={at(1.0)}>
      <div style={{ fontFamily: MONO, fontSize: 19, color: TEXT, background: '#0D1017', border: `1px solid ${LINE}`, borderRadius: 12, padding: '14px 18px', lineHeight: 1.5 }}>
        <span style={{ color: VIOLET_SOFT }}>$ </span>npx create-scaffold-hbar@latest my-autonr<br />
        <span style={{ color: TEXT_FAINT }}>    --template NetLayerLabs/Autonr</span>
      </div>
    </Rise>
    <div style={{ height: 26 }} />
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {['AgentVault, Foundry', 'Agent runtime, TypeScript', 'Verifier CLI', 'Next.js dashboard'].map((t, i) => (
        <Rise key={t} delay={at(3.2 + i * 0.5)}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontFamily: SANS, fontSize: 24, color: TEXT_SOFT }}>
            <div style={{ width: 8, height: 8, borderRadius: 99, background: VIOLET }} />
            {t}
          </div>
        </Rise>
      ))}
    </div>
  </Side>
)

/* S04: one decision, the tick, reasoning first. */
const TICK: TermLine[] = [
  { t: 0.2, text: 'npm run agent:tick -- --sell 5', kind: 'cmd' },
  { t: 1.6, text: 'tick on testnet: vault 0x037b…a472, agent 0.0.10821548', kind: 'dim' },
  { t: 2.4, text: '  market    WHBAR $0.10211 (chainlink), Supra 46 bps apart; USDC $0.99997 (supra)' },
  { t: 3.4, text: '  vault     60.56 WHBAR ($6.18) + 470.33 USDC ($470.31); 7 trades so far' },
  { t: 5.0, text: '  decision  sell $5.00 of WHBAR' },
  { t: 7.2, text: '  pool      SaucerSwap pays 92.424532 USDC; the vault\'s minimum is 4.850145 USDC' },
  { t: 8.6, text: '  simulate  vault accepts at block 41320892' },
  { t: 11.4, text: '  publish   trade record is message 19 on topic 0.0.10821549', kind: 'ok' },
]
const S04: React.FC = () => (
  <AbsoluteFill>
    <Backdrop bloom="left" />
    <div style={{ position: 'absolute', left: 96, top: 100, width: 1700 }}>
      <StepNumber n={2} delay={2} />
      <div style={{ height: 18 }} />
      <Eyebrow delay={6}>One decision</Eyebrow>
      <div style={{ height: 14 }} />
      <Headline lines={['Reasoning goes to HCS before anything is signed.']} delay={10} size={46} />
    </div>
    <div style={{ position: 'absolute', left: 96, top: 360 }}>
      <Terminal lines={TICK} width={980} height={420} delay={at(0)} fontSize={19} title="autonr — agent" />
    </div>
    <div style={{ position: 'absolute', right: 40, top: 330, transform: 'scale(0.56)', transformOrigin: 'top right' }}>
      <Diagram
        delay={at(0.6)}
        lit={{ agent: 0.8, chainlink: 2.4, supra: 2.6, hcs: 11.2 }}
        links={[['agent', 'chainlink', 2.2], ['agent', 'supra', 2.5], ['agent', 'hcs', 11.0, 'message 19']]}
        pulses={[['agent', 'hcs', 11.3, 1.4]]}
      />
    </div>
    <div style={{ position: 'absolute', left: 96, bottom: 70 }}>
      <Caption delay={at(13.6)} width={1100}>Only the agent's key can write to that topic.</Caption>
    </div>
  </AbsoluteFill>
)

/* S05: then the vault. */
const TICK2: TermLine[] = [
  { t: 0.0, text: '  publish   trade record is message 19 on topic 0.0.10821549', kind: 'ok' },
  { t: 0.3, text: '  execute   executeSwap(request, keccak256(message), 19)' },
  { t: 6.0, text: '              vault reads Chainlink, then Supra, checks caps' },
  { t: 9.0, text: '              derives amountOutMinimum = 4.850145 USDC' },
  { t: 11.2, text: '              SaucerSwap V2 exactInput' },
  { t: 13.0, text: '  trade 8    48.9668 WHBAR -> 92.424532 USDC', kind: 'ok' },
  { t: 14.0, text: '  trade     https://hashscan.io/testnet/transaction/0xa5d79bc3…2b7c', kind: 'dim' },
]
const S05: React.FC = () => (
  <AbsoluteFill>
    <Backdrop bloom="right" />
    <div style={{ position: 'absolute', left: 96, top: 100, width: 1700 }}>
      <StepNumber n={3} delay={2} />
      <div style={{ height: 18 }} />
      <Eyebrow delay={6}>Then the vault</Eyebrow>
      <div style={{ height: 14 }} />
      <Headline lines={['The agent never supplied a price.']} delay={10} size={46} />
    </div>
    <div style={{ position: 'absolute', left: 96, top: 360 }}>
      <Terminal lines={TICK2} width={980} height={400} delay={at(0)} fontSize={19} title="autonr — agent" />
    </div>
    <div style={{ position: 'absolute', right: 40, top: 330, transform: 'scale(0.56)', transformOrigin: 'top right' }}>
      <Diagram
        delay={at(0)}
        lit={{ agent: 0, hcs: 0, vault: 0.6, chainlink: 5.6, supra: 7.0, dex: 11.2 }}
        links={[['agent', 'hcs', 0], ['agent', 'vault', 0.4, 'hash + seq'], ['vault', 'chainlink', 5.6], ['vault', 'supra', 7.0], ['vault', 'dex', 11.2, 'minimum out']]}
        pulses={[['agent', 'vault', 0.6, 1.2], ['vault', 'chainlink', 5.8, 1.0], ['vault', 'supra', 7.2, 1.0], ['vault', 'dex', 11.4, 1.2]]}
      />
    </div>
    <div style={{ position: 'absolute', left: 96, bottom: 70, display: 'flex', gap: 14 }}>
      <Chip delay={at(6.4)} tone="violet">Chainlink + Supra re-read on-chain</Chip>
      <Chip delay={at(9.2)} tone="violet">caps, cooldown, fee tier</Chip>
      <Chip delay={at(13.2)} tone="mint">trade #8 executed</Chip>
    </div>
  </AbsoluteFill>
)

/* S06: the verifier, twelve checks from public data. */
const S06: React.FC = () => (
  <Side
    step={4}
    eyebrow="Anyone can check it"
    lines={['Twelve checks, from', 'the Mirror Node alone.']}
    colW={560}
    frameW={1180}
    frame={
      <BrowserFrame
        dur={durOf('v06')}
        shots={[{ clip: 'proof', path: '/proof/0xa5d7…2b7c', startFrom: 0 }]}
        focus={[
          { rect: box(760, 420, 1.3), from: sec(3.0), to: sec(9.0), move: 1.3 },
          { rect: box(760, 460, 1.3), from: sec(9.6), to: sec(15.0), move: 1.2 },
        ]}
      />
    }
    foot={<Caption delay={at(8.2)} width={560}>Published 3.84 s before the trade reached consensus.</Caption>}
  >
    <CheckList from={2.4} every={0.5} />
  </Side>
)

/* S07: X-ray and the tamper lab. */
const S07: React.FC = () => (
  <Wide
    step={5}
    eyebrow="Prove the proof"
    title="Flip one byte. Verified becomes failed."
    note={
      <>
        <Note><Chip delay={at(1.0)} tone="violet" size={20}>Trade X-ray: Chainlink → Supra → swap, one transaction</Chip></Note>
      </>
    }
    right={
      <div style={{ position: 'absolute', right: 0, top: -10 }}>
        <Rise delay={at(9.6)}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <Chip tone="mint" size={22}>verified</Chip>
            <div style={{ fontFamily: SANS, fontSize: 26, color: TEXT_FAINT }}>→</div>
            <Chip tone="rose" size={22} delay={at(11.0)}>failed · hash-match</Chip>
          </div>
        </Rise>
      </div>
    }
    frame={
      <BrowserFrame
        width={1440}
        dur={durOf('v07')}
        shots={[
          { clip: 'proof', path: '/proof/0xa5d7…2b7c', startFrom: 16.4 },
          { clip: 'tamper', path: '/proof/0xa5d7…2b7c', at: sec(6.4), dissolve: 10, startFrom: 0 },
        ]}
        focus={[{ rect: box(800, 470, 1.35), from: sec(0.4), to: sec(5.6), move: 1.2 }]}
      />
    }
  />
)

/* S08: the playground. */
const S08: React.FC = () => (
  <Wide
    step={6}
    eyebrow="What if the agent misbehaves"
    title="Six attacks on the live vault. Six refusals."
    note={
      <Note>
        {['TradeTooLarge', 'TokenNotAllowed', 'PoolFeeNotAllowed', 'ReasoningRequired', 'ReasoningOutOfOrder', 'NotAgent'].map((e, i) => (
          <Chip key={e} delay={at(5.6 + i * 1.9)} tone="rose" size={18} mono>{e}</Chip>
        ))}
      </Note>
    }
    frame={
      <BrowserFrame
        width={1440}
        dur={durOf('v08')}
        shots={[{ clip: 'playground', path: '/playground', startFrom: 0 }]}
        focus={[{ rect: box(800, 470, 1.12), from: sec(6.0), to: sec(18.0), move: 1.4 }]}
      />
    }
  />
)

/* S09: testnet reality and the audit. */
const S09: React.FC = () => (
  <Side
    step={7}
    eyebrow="The guard, working"
    lines={['Sells pass.', 'Buys are refused.', { em: 'No gaps in the log.' }]}
    colW={560}
    frameW={1180}
    frame={
      <BrowserFrame
        dur={durOf('v09')}
        shots={[
          { clip: 'home', path: '/', startFrom: 15.2 },
          { clip: 'audit', path: '/audit', at: sec(12.2), dissolve: 0, startFrom: 0.6 },
        ]}
        focus={[
          { rect: box(760, 400, 1.5), from: sec(1.0), to: sec(10.6), move: 1.3 },
          { rect: box(800, 330, 1.45), from: sec(13.6), to: sec(19.0), move: 1.2 },
        ]}
      />
    }
    foot={<Caption delay={at(14.0)} width={560}>Every trade maps to exactly one earlier decision.</Caption>}
  >
    <Card delay={at(1.2)} tone="amber" width={540} pad={24}>
      <div style={{ fontFamily: SANS, fontSize: 20, color: AMBER, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Testnet pool</div>
      <div style={{ height: 8 }} />
      <div style={{ fontFamily: MONO, fontSize: 24, color: TEXT }}>WHBAR $1.92 in the pool</div>
      <div style={{ fontFamily: MONO, fontSize: 24, color: TEXT_SOFT }}>vs $0.102 at the oracles</div>
    </Card>
    <div style={{ height: 16 }} />
    <div style={{ display: 'flex', gap: 12 }}>
      <Chip delay={at(4.0)} tone="mint">$1 sell: accepted</Chip>
      <Chip delay={at(5.6)} tone="rose">$1 buy: refused</Chip>
    </div>
  </Side>
)

/* S10: the close. */
const S10: React.FC = () => {
  const f = useCurrentFrame()
  const outAt = at(14.2)
  return (
    <AbsoluteFill>
      <Backdrop bloom="center" />
      <div style={{ position: 'absolute', left: 120, top: 300, width: 1680 }}>
        <Eyebrow delay={4} out={outAt}>Built on Hedera</Eyebrow>
        <div style={{ height: 22 }} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 22 }}>
          {[
            ['Consensus Service', 'holds the reasoning', 0.4],
            ['Smart Contract Service', 'enforces the policy', 2.0],
            ['Token Service', 'moves the funds', 3.8],
          ].map(([a, b, d]) => (
            <Card key={String(a)} delay={at(Number(d))} out={outAt} tone="violet" pad={26}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <HederaMark height={26} />
                <div style={{ fontFamily: DISPLAY, fontSize: 28, fontWeight: 600, color: TEXT }}>{a}</div>
              </div>
              <div style={{ height: 6 }} />
              <div style={{ fontFamily: SANS, fontSize: 22, color: VIOLET_SOFT }}>{b}</div>
            </Card>
          ))}
        </div>
        <div style={{ height: 30 }} />
        <Rise delay={at(6.0)} out={outAt}>
          <Logos names={['Chainlink', 'Supra', 'SaucerSwap V2', 'Hedera Agent Kit', 'Hedera Harness']} delay={at(6.0)} />
        </Rise>
      </div>
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', opacity: interpolate(f, [outAt + 10, outAt + 30], [0, 1], CLAMP) }}>
        <Lockup height={150} delay={outAt + 12} />
        <div style={{ height: 30 }} />
        <Rise delay={outAt + 30}>
          <div style={{ fontFamily: MONO, fontSize: 28, color: TEXT_SOFT }}>npx create-scaffold-hbar@latest my-autonr --template NetLayerLabs/Autonr</div>
        </Rise>
        <div style={{ height: 18 }} />
        <Rise delay={outAt + 40}>
          <div style={{ fontFamily: SANS, fontSize: 22, color: TEXT_FAINT }}>github.com/NetLayerLabs/Autonr · MIT</div>
        </Rise>
      </AbsoluteFill>
    </AbsoluteFill>
  )
}

/* ==================================================================== film */

const SCENE_COMPONENTS: Record<Id, React.FC> = { v00: S00, v01: S01, v02: S02, v03: S03, v04: S04, v05: S05, v06: S06, v07: S07, v08: S08, v09: S09, v10: S10 }

const Scene: React.FC<{ id: Id; index: number }> = ({ id, index }) => {
  const f = useCurrentFrame()
  const dur = durOf(id)
  const fadeIn = index === 0 ? 0 : FADE
  const o = Math.min(fadeIn === 0 ? 1 : interpolate(f, [0, fadeIn], [0, 1], CLAMP), interpolate(f, [dur - FADE, dur], [1, 0], CLAMP))
  const C = SCENE_COMPONENTS[id]
  return (
    <AbsoluteFill style={{ opacity: o }}>
      <C />
      <Sequence from={LEAD} layout="none">
        <Audio src={staticFile(`vo/${id}.mp3`)} volume={VO_GAIN} />
      </Sequence>
    </AbsoluteFill>
  )
}

export const Autonr: React.FC = () => (
  <AbsoluteFill style={{ background: '#0B0D14' }}>
    {SCENES.map((sc, i) => (
      <Sequence key={sc.id} from={STARTS[i]} durationInFrames={sc.dur + FADE} layout="none">
        <Scene id={sc.id} index={i} />
      </Sequence>
    ))}
    <ProgressRail total={AUTONR_DURATION} />
  </AbsoluteFill>
)
