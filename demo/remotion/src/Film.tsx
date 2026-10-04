import React from 'react'
import { AbsoluteFill, Audio, Img, Sequence, interpolate, staticFile, useCurrentFrame } from 'remotion'
import TIMING from './timing.json'
import META from '../public/clips/meta.json'
import { C, CLAMP, EASE, SPRING, TYPE, inter, mono, sp, tween } from './theme'
import { Captions, Drift, Glass, Honest, In, Mark, Pane, Pill, PillFlight, RecordCard, RiseLine, Tick, TypeOn } from './kit'

/* ------------------------------------------------------------------ timing */

type SceneT = (typeof TIMING.scenes)[number]
const SCENES = TIMING.scenes
export const FILM_FRAMES = TIMING.totalFrames
const sceneOf = (id: string) => SCENES.find((s) => s.id === id) as SceneT

/** The frame (scene-relative) at which a word starts: the n-th match of a word beginning with `w`. */
const cue = (s: SceneT, w: string, n = 0) => {
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, '')
  const hits = s.words.filter((x) => norm(x.word).startsWith(norm(w)))
  if (!hits[n]) throw new Error(`no word "${w}" #${n} in ${s.id}`)
  return hits[n].start
}

/** Seconds into a clip at which a logged moment happens. */
const moment = (clip: keyof typeof META.clips, name: string) => (META.clips[clip].moments as Record<string, number>)[name]

/** The scene-time to start a clip from, so that `name` lands on scene frame `at`. */
const startFor = (clip: keyof typeof META.clips, name: string, at: number) => Math.max(0, moment(clip, name) - at / 30)

/* The footage pane used by the full-width scenes, and the one that leaves a column for notes. */
const PANE = { x: 210, y: 46, w: 1500 }
const SIDE = { x: 90, y: 150, w: 1180 }

/* ------------------------------------------------------------- the record */

const RECORD_ROWS = [
  { k: 'action', v: 'sell $5.00 of WHBAR' },
  { k: 'market', v: 'WHBAR $0.10211 · Supra 46 bps' },
  { k: 'reasoning', v: '"Operator requested a sell of $5.00…"', v2: '"operator requested a sell of $5.00…"' },
  { k: 'hash', v: 'keccak256 0x6b0b…9c71' },
]
const SEAL = 'HCS · topic 0.0.10821549 · message 19'

/* ================================================================= scenes */

/* Frame 0 is the thumbnail: the promise, and the record the whole film is about, still empty. */
const Hook: React.FC<{ s: SceneT }> = ({ s }) => {
  const f = useCurrentFrame()
  const blink = Math.floor(f / 15) % 2 === 0
  return (
    <Drift dur={s.durationInFrames}>
      <div style={{ position: 'absolute', left: 150, top: 330 }}>
        <RiseLine
          size={104}
          words={[
            { text: 'Let', at: -40 },
            { text: 'an', at: -40 },
            { text: 'AI', at: -40 },
            { text: 'agent', at: -40 },
            { text: 'trade.', at: -40 },
            { text: 'Never', at: -40, br: true },
            { text: 'trust', at: -40, accent: true },
            { text: 'it.', at: -40 },
          ]}
        />
      </div>
      <div style={{ position: 'absolute', left: 1180, top: 300 }}>
        <Glass w={600} radius={24} style={{ padding: '30px 34px 28px' }}>
          <div style={{ ...TYPE.caps, marginBottom: 18 }}>Decision record</div>
          {['action', 'market', 'reasoning', 'hash'].map((k, i) => (
            <div key={k} style={{ display: 'grid', gridTemplateColumns: '170px 1fr', alignItems: 'center', minHeight: 52, borderTop: i ? '1px dashed hsla(0,0%,20%,0.7)' : 'none' }}>
              <div style={{ fontFamily: inter, fontSize: 19, fontWeight: 500, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.09em' }}>{k}</div>
              <div style={{ height: 22, borderRadius: 6, background: 'rgba(255,255,255,0.05)', width: [220, 300, 340, 260][i], position: 'relative' }}>
                {i === 0 && blink ? <span style={{ position: 'absolute', left: 0, top: -2, width: 12, height: 26, background: C.ink }} /> : null}
              </div>
            </div>
          ))}
        </Glass>
      </div>
    </Drift>
  )
}

/* An agent with the keys: every row of its record is the agent's own word. */
const Problem: React.FC<{ s: SceneT }> = ({ s }) => (
  <Drift dur={s.durationInFrames}>
    <div style={{ position: 'absolute', left: 580, top: 230 }}>
      <RecordCard
        w={760}
        title="An agent with the keys"
        tag="unguarded"
        tone="rose"
        toneAt={cue(s, 'empty')}
        rows={[
          { k: 'keys', v: 'held by the agent', at: cue(s, 'keys') },
          { k: 'price', v: 'set by the agent', at: cue(s, 'one') },
          { k: 'minimum', v: '0', at: cue(s, 'empty'), state: 'tampered', stateAt: cue(s, 'empty') + 6 },
          { k: 'why', v: '"trust me"', at: cue(s, 'word'), state: 'tampered', stateAt: cue(s, 'word') + 8 },
        ]}
      />
    </div>
  </Drift>
)

/* The split. Three parties, drawn as glass and hairlines; each lights as it is named. */
type NodeSpec = { id: string; x: number; y: number; w?: number; title: string; sub: string; at: number; tone?: 'violet' | 'white' }
const NodeBox: React.FC<{ n: NodeSpec; mark?: boolean }> = ({ n, mark }) => {
  const f = useCurrentFrame()
  const on = sp(f, n.at, SPRING.ui)
  const w = n.w ?? 380
  return (
    <div style={{ position: 'absolute', left: n.x, top: n.y, opacity: 0.32 + 0.68 * on }}>
      <Glass w={w} h={128} radius={20} tone={n.tone === 'violet' && on > 0.5 ? 'violet' : 'white'} rimA={n.tone === 'violet' && on > 0.5 ? 0.85 : 0.3 + 0.3 * on} style={{ padding: '0 28px', display: 'flex', alignItems: 'center', gap: 20 }}>
        {mark ? <Mark size={58} /> : null}
        <div>
          <div style={{ fontFamily: inter, fontWeight: 500, fontSize: 30, letterSpacing: '-0.015em', color: C.hero }}>{n.title}</div>
          <div style={{ fontFamily: inter, fontSize: 21, color: n.tone === 'violet' && on > 0.5 ? C.violet : C.body, marginTop: 4 }}>{n.sub}</div>
        </div>
      </Glass>
    </div>
  )
}

/** A hairline that draws itself from one node edge to another, with a bright travelling tip. */
const Thread: React.FC<{ from: [number, number]; to: [number, number]; at: number; frames?: number; label?: string; pulseAt?: number }> = ({ from, to, at, frames = 18, label, pulseAt }) => {
  const f = useCurrentFrame()
  const p = tween(f, at, at + frames, 0, 1, EASE.inOut)
  if (p <= 0) return null
  const x = from[0] + (to[0] - from[0]) * p
  const y = from[1] + (to[1] - from[1]) * p
  const q = pulseAt === undefined ? -1 : tween(f, pulseAt, pulseAt + 22, 0, 1, EASE.inOut)
  return (
    <svg style={{ position: 'absolute', inset: 0, width: 1920, height: 1080, overflow: 'visible' }}>
      <defs>
        <linearGradient id={`th${from[0]}${to[1]}`} x1={from[0]} y1={from[1]} x2={to[0]} y2={to[1]} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="rgba(255,255,255,0.10)" />
          <stop offset="0.5" stopColor="rgba(255,255,255,0.55)" />
          <stop offset="1" stopColor="rgba(255,255,255,0.10)" />
        </linearGradient>
      </defs>
      <line x1={from[0]} y1={from[1]} x2={x} y2={y} stroke={`url(#th${from[0]}${to[1]})`} strokeWidth={1.6} />
      {p < 1 ? <circle cx={x} cy={y} r={3.5} fill="#fff" /> : null}
      {q > 0 && q < 1 ? <circle cx={from[0] + (to[0] - from[0]) * q} cy={from[1] + (to[1] - from[1]) * q} r={6} fill={C.violetDot} style={{ filter: `drop-shadow(0 0 8px ${C.violetDot})` }} /> : null}
      {label && p > 0.9 ? (
        <text x={(from[0] + to[0]) / 2} y={(from[1] + to[1]) / 2 - 14} textAnchor="middle" fill={C.dim} fontFamily={mono} fontSize={19} opacity={tween(f, at + frames - 4, at + frames + 8)}>
          {label}
        </text>
      ) : null}
    </svg>
  )
}

const Answer: React.FC<{ s: SceneT }> = ({ s }) => {
  const agent: NodeSpec = { id: 'agent', x: 150, y: 420, title: 'AI agent', sub: 'decides whether', at: cue(s, 'agent') }
  const vault: NodeSpec = { id: 'vault', x: 720, y: 420, w: 440, title: 'AgentVault', sub: 'enforces both', at: cue(s, 'enforces'), tone: 'violet' }
  const chainlink: NodeSpec = { id: 'cl', x: 1370, y: 170, title: 'Chainlink', sub: 'prices each leg', at: cue(s, 'chainlink') }
  const supra: NodeSpec = { id: 'su', x: 1370, y: 420, title: 'Supra', sub: 'must agree', at: cue(s, 'supra') }
  const dex: NodeSpec = { id: 'dex', x: 1370, y: 670, title: 'SaucerSwap V2', sub: 'executes, only then', at: cue(s, 'moves') }
  return (
    <Drift dur={s.durationInFrames}>
      <Thread from={[530, 484]} to={[720, 484]} at={cue(s, 'whether')} label="whether" />
      <Thread from={[1160, 470]} to={[1370, 234]} at={cue(s, 'chainlink') + 4} />
      <Thread from={[1160, 484]} to={[1370, 484]} at={cue(s, 'supra') + 4} label="price" />
      <Thread from={[1160, 500]} to={[1370, 734]} at={cue(s, 'token')} pulseAt={cue(s, 'moves')} />
      {[agent, chainlink, supra, dex].map((n) => (
        <NodeBox key={n.id} n={n} />
      ))}
      <NodeBox n={vault} mark />
    </Drift>
  )
}

/* The record is written, then sealed on HCS: first, and only by the agent's key. */
const Record: React.FC<{ s: SceneT }> = ({ s }) => {
  const at = [cue(s, 'writes'), cue(s, 'down'), cue(s, 'why'), cue(s, 'publishes')]
  return (
    <Drift dur={s.durationInFrames}>
      <div style={{ position: 'absolute', left: 170, top: 230 }}>
        <RecordCard w={900} rows={RECORD_ROWS.map((r, i) => ({ k: r.k, v: r.v, at: at[i] }))} sealAt={cue(s, 'first')} seal={SEAL} />
      </div>
      <In at={cue(s, 'consensus')} style={{ position: 'absolute', left: 1160, top: 268, width: 600 }}>
        <Glass w={600} radius={20} kind="clear" style={{ padding: '26px 30px' }}>
          <div style={{ fontFamily: inter, fontSize: 28, lineHeight: 1.35, color: C.body }}>
            <span style={{ color: C.ink }}>Hedera Consensus Service:</span> an ordered, timestamped, public log. Nobody can edit it afterwards.
          </div>
        </Glass>
      </In>
      <In at={cue(s, 'only')} style={{ position: 'absolute', left: 1160, top: 520 }}>
        <Pill tone="violet" monoText size={22}>
          submit key · agent 0.0.10821548 only
        </Pill>
      </In>
    </Drift>
  )
}

/* The vault is asked to trade, citing the record; it re-reads the oracles and sets the minimum itself. */
const Vault: React.FC<{ s: SceneT }> = ({ s }) => {
  const sealed = RECORD_ROWS.map((r) => ({ k: r.k, v: r.v, at: -200 }))
  return (
    <Drift dur={s.durationInFrames} amount={0.012}>
      <div style={{ position: 'absolute', left: 90, top: 200, transform: 'scale(0.78)', transformOrigin: 'top left' }}>
        <RecordCard w={900} rows={sealed} sealAt={-200} seal={SEAL} enter={-30} />
      </div>
      <div style={{ position: 'absolute', left: 900, top: 96 }}>
        <RecordCard
          w={930}
          enter={cue(s, 'asks')}
          title="AgentVault.executeSwap"
          tag="the vault checks"
          keyW={230}
          rows={[
            { k: 'request', v: 'sell 48.9668 WHBAR → USDC', at: cue(s, 'trade') },
            { k: 'cites hash', v: '0x6b0b…9c71', at: cue(s, 'hash') + 18 },
            { k: 'cites seq', v: 'message 19', at: cue(s, 'number') + 18 },
            { k: 'chainlink', v: 'WHBAR $0.10211, fresh', at: cue(s, 'oracles'), state: 'verified', stateAt: cue(s, 'oracles') + 10 },
            { k: 'supra', v: '46 bps apart, limit 150', at: cue(s, 'itself'), state: 'verified', stateAt: cue(s, 'itself') + 10 },
            { k: 'limits', v: '$5 ≤ $25 cap · $5 of $100 today', at: cue(s, 'limits'), state: 'verified', stateAt: cue(s, 'limits') + 10 },
            { k: 'minimum out', v: '4.850145 USDC, set by the vault', at: cue(s, 'minimum'), state: 'verified', stateAt: cue(s, 'accept') },
          ]}
        />
      </div>
      <PillFlight from={{ x: 470, y: 488 }} to={{ x: 1340, y: 254 }} at={cue(s, 'hash')} label="0x6b0b…9c71" />
      <PillFlight from={{ x: 300, y: 568 }} to={{ x: 1290, y: 306 }} at={cue(s, 'number')} label="#19" />
      <In at={cue(s, 'never')} style={{ position: 'absolute', left: 900, top: 760 }}>
        <Pill tone="violet" size={24}>
          price from the oracles, never from the agent
        </Pill>
      </In>
    </Drift>
  )
}

/* Trade #8, on the live dashboard. */
const Swap: React.FC<{ s: SceneT }> = ({ s }) => (
  <AbsoluteFill>
    <Pane
      clip="home"
      {...PANE}
      startFrom={startFor('home', 'trades table', 24)}
      freezeAt={70}
      keys={[{ at: 0, cx: 800, cy: 450, z: 1.0 }, { at: cue(s, 'sold'), cx: 800, cy: 330, z: 1.35 }, { at: cue(s, 'trade') - 6, cx: 700, cy: 270, z: 1.6 }]}
    />
    <Honest at={cue(s, 'testnet')} x={PANE.x + 6} y={4}>
      recorded live · Hedera testnet
    </Honest>
    <In at={cue(s, 'trade')} style={{ position: 'absolute', left: PANE.x + 6, top: PANE.y + 860 }}>
      <Pill tone="violet" monoText size={22}>
        trade 8 · 48.9668 WHBAR → 92.4245 USDC
      </Pill>
    </In>
  </AbsoluteFill>
)

/* Twelve checks, from public data only. */
const Proof: React.FC<{ s: SceneT }> = ({ s }) => (
  <AbsoluteFill>
    <Pane
      clip="proof"
      {...SIDE}
      startFrom={startFor('proof', 'checks list', cue(s, 'twelve'))}
      keys={[
        { at: 0, cx: 800, cy: 450, z: 1.0 },
        { at: cue(s, 'twelve') + 10, cx: 620, cy: 450, z: 1.3 },
        { at: cue(s, 'one') - 10, cx: 800, cy: 450, z: 1.08 },
      ]}
    />
    <Honest at={cue(s, 'public')} x={SIDE.x} y={SIDE.y - 46}>
      /proof · Mirror Node data only, no keys
    </Honest>
    <div style={{ position: 'absolute', left: 1330, top: 230, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 22 }}>
      <In at={cue(s, 'twelve')}>
        <Pill tone="violet" size={24}>
          12 of 12 checks pass
        </Pill>
      </In>
      <In at={cue(s, 'matches')}>
        <Pill tone="violet" monoText size={21}>
          bytes match the committed hash
        </Pill>
      </In>
      <In at={cue(s, 'seconds')}>
        <Pill tone="violet" monoText size={21}>
          published 3.84 s before the trade
        </Pill>
      </In>
      <In at={cue(s, 'signed')}>
        <Pill tone="violet" monoText size={21}>
          one key: 0.0.10821548
        </Pill>
      </In>
    </div>
  </AbsoluteFill>
)

/* One letter changed, and the proof fails: footage first, then the record itself. */
const Tamper: React.FC<{ s: SceneT }> = ({ s }) => {
  const f = useCurrentFrame()
  const cut = cue(s, 'fails') + 30
  const rows = RECORD_ROWS.map((r) => ({
    k: r.k,
    v: r.v,
    v2: r.v2,
    at: -200,
    state: r.k === 'reasoning' ? ('tampered' as const) : r.k === 'hash' ? ('tampered' as const) : undefined,
    stateAt: r.k === 'reasoning' ? cut + 26 : cut + 40,
  }))
  return (
    <AbsoluteFill>
      {f < cut ? (
        <>
          <Pane clip="tamper" {...PANE} y={96} startFrom={startFor('tamper', 'flipped one byte', cue(s, 'fails') - 6)} keys={[{ at: 0, cx: 760, cy: 400, z: 1.25 }, { at: cue(s, 'fails') - 4, cx: 820, cy: 430, z: 1.4 }]} />
          <Honest at={4} x={PANE.x + 6} y={40}>
            /proof · tamper lab
          </Honest>
        </>
      ) : (
        <Drift dur={s.durationInFrames - cut} amount={0.015}>
          <div style={{ position: 'absolute', left: 150, top: 200 }}>
            <RiseLine
              size={88}
              words={[
                { text: 'One', at: cut + 2 },
                { text: 'letter.', at: cut + 6 },
                { text: 'The', at: cut + 14, br: true },
                { text: 'proof', at: cut + 18 },
                { text: 'fails.', at: cut + 24, accent: true },
              ]}
            />
          </div>
          <div style={{ position: 'absolute', left: 1000, top: 250 }}>
            <RecordCard w={800} rows={rows} sealAt={-200} seal={SEAL} enter={cut - 30} tone="rose" toneAt={cut + 40} />
          </div>
        </Drift>
      )}
    </AbsoluteFill>
  )
}

/* Six forbidden requests at the live vault; six custom errors. */
const Guard: React.FC<{ s: SceneT }> = ({ s }) => {
  const f = useCurrentFrame()
  const runAt = cue(s, 'rules') - 10
  const attacks = [
    ['Too large', 'TradeTooLarge', cue(s, 'too')],
    ['Wrong token', 'TokenNotAllowed', cue(s, 'wrong', 0)],
    ['Wrong pool', 'PoolFeeNotAllowed', cue(s, 'wrong', 1)],
    ['No reasoning', 'ReasoningRequired', cue(s, 'no')],
    ['Old reasoning', 'ReasoningOutOfOrder', cue(s, 'old')],
    ['Wrong caller', 'NotAgent', cue(s, 'wrong', 2)],
  ] as const
  const count = attacks.filter((a) => f >= a[2] + 8).length
  return (
    <Drift dur={s.durationInFrames} amount={0.01}>
      <Pane clip="playground" x={80} y={150} w={1080} startFrom={startFor('playground', 'run all', runAt)} keys={[{ at: 0, cx: 800, cy: 430, z: 1.12 }]} />
      <div style={{ position: 'absolute', left: 1230, top: 150, width: 610 }}>
        {attacks.map(([attack, error, at]) => (
          <In key={error} at={at} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 82, borderBottom: '1px solid hsla(0,0%,20%,0.45)' }}>
            <div style={{ fontFamily: inter, fontWeight: 500, fontSize: 29, color: C.hero, letterSpacing: '-0.01em' }}>{attack}</div>
            <Pill tone="rose" monoText size={19}>
              {error}
            </Pill>
          </In>
        ))}
        <In at={cue(s, 'six')} style={{ marginTop: 34, display: 'flex', alignItems: 'baseline', gap: 18 }}>
          <span style={{ fontFamily: mono, fontWeight: 500, fontSize: 64, letterSpacing: '-0.04em', color: C.hero }}>{count} / 6</span>
          <span style={{ fontFamily: inter, fontSize: 26, color: C.body }}>refused, by the vault itself</span>
        </In>
      </div>
    </Drift>
  )
}

/* The testnet pool is mispriced: the guard lets the sell through and refuses the buy. */
const Reality: React.FC<{ s: SceneT }> = ({ s }) => {
  const card = (tone: 'violet' | 'rose', title: string, lines: string[], verdict: string, at: number, verdictAt: number) => (
    <In at={at}>
      <Glass w={700} radius={24} tone={tone} style={{ padding: '30px 36px' }}>
        <div style={{ fontFamily: inter, fontWeight: 500, fontSize: 40, letterSpacing: '-0.02em', color: C.hero }}>{title}</div>
        <div style={{ marginTop: 16 }}>
          {lines.map((l) => (
            <div key={l} style={{ ...TYPE.row, fontSize: 23, color: C.body, lineHeight: 1.7 }}>
              {l}
            </div>
          ))}
        </div>
        <In at={verdictAt} style={{ marginTop: 20 }}>
          <Pill tone={tone} size={24}>
            {verdict}
          </Pill>
        </In>
      </Glass>
    </In>
  )
  return (
    <Drift dur={s.durationInFrames}>
      <In at={cue(s, 'pool')} style={{ position: 'absolute', left: 0, right: 0, top: 160, textAlign: 'center' }}>
        <span style={{ ...TYPE.row, fontSize: 30, color: C.hero }}>
          pool <span style={{ color: C.rose }}>$1.8822</span>
          <span style={{ color: C.faint }}>{'  ·  '}</span>
          oracles <span style={{ color: C.violet }}>$0.10151</span>
          <span style={{ color: C.faint }}>{'  ·  '}</span>
          18.5×
        </span>
      </In>
      <div style={{ position: 'absolute', left: 230, top: 300 }}>
        {card('violet', 'Sell $1 of WHBAR', ['9.851 WHBAR in', '18.465 USDC out', 'vault minimum 0.970 USDC'], 'accepted', cue(s, 'sells'), cue(s, 'pass'))}
      </div>
      <div style={{ position: 'absolute', left: 990, top: 300 }}>
        {card('rose', 'Buy $1 of WHBAR', ['1.000 USDC in', '0.530 WHBAR out', 'vault minimum 9.555 WHBAR'], 'refused: the oracles say no', cue(s, 'buys'), cue(s, 'refused'))}
      </div>
    </Drift>
  )
}

/* The gapless audit. */
const Audit: React.FC<{ s: SceneT }> = ({ s }) => (
  <AbsoluteFill>
    <Pane clip="audit" {...SIDE} startFrom={startFor('audit', 'no gaps', cue(s, 'gaps'))} keys={[{ at: 0, cx: 800, cy: 450, z: 1.0 }, { at: cue(s, 'gaps'), cx: 760, cy: 380, z: 1.25 }]} />
    <Honest at={cue(s, 'log')} x={SIDE.x} y={SIDE.y - 46}>
      /audit · topic 0.0.10821549, messages 1 to 19
    </Honest>
    <div style={{ position: 'absolute', left: 1330, top: 260, display: 'flex', flexDirection: 'column', gap: 22 }}>
      <In at={cue(s, 'gaps')}>
        <span style={{ fontFamily: mono, fontWeight: 500, fontSize: 64, letterSpacing: '-0.04em', color: C.hero }}>0 gaps</span>
      </In>
      <In at={cue(s, 'every')}>
        <Pill tone="violet" monoText size={22}>
          8 trades · 8 decisions
        </Pill>
      </In>
      <In at={cue(s, 'published')}>
        <Pill tone="violet" monoText size={22}>
          each decision published first
        </Pill>
      </In>
    </div>
  </AbsoluteFill>
)

/* The same picture as the split, now named for what Hedera does in it. */
const Stack: React.FC<{ s: SceneT }> = ({ s }) => {
  const f = useCurrentFrame()
  const nodes: NodeSpec[] = [
    { id: 'hcs', x: 150, y: 250, w: 520, title: 'Consensus Service', sub: 'holds the reasoning', at: cue(s, 'consensus'), tone: 'violet' },
    { id: 'hscs', x: 700, y: 470, w: 520, title: 'Smart contract', sub: 'enforces the policy', at: cue(s, 'contract'), tone: 'violet' },
    { id: 'hts', x: 1250, y: 250, w: 520, title: 'Token Service', sub: 'moves the funds', at: cue(s, 'token'), tone: 'violet' },
    { id: 'hak', x: 700, y: 720, w: 520, title: 'Hedera Agent Kit', sub: 'any agent, the same rules', at: cue(s, 'agent', 0), tone: 'white' },
  ]
  return (
    <Drift dur={s.durationInFrames}>
      <div style={{ position: 'absolute', left: 150, top: 120, opacity: tween(f, 4, 20) }}>
        <Img src={staticFile('brand/hedera-lockup-white.svg')} style={{ height: 40, opacity: 0.85 }} />
      </div>
      <Thread from={[670, 314]} to={[820, 470]} at={cue(s, 'contract') - 6} />
      <Thread from={[1220, 534]} to={[1360, 378]} at={cue(s, 'token') - 4} />
      <Thread from={[960, 720]} to={[960, 598]} at={cue(s, 'agent', 0) + 6} />
      {nodes.map((n) => (
        <NodeBox key={n.id} n={n} mark={n.id === 'hscs'} />
      ))}
      <In at={cue(s, 'way') - 20} style={{ position: 'absolute', left: 1250, top: 760, display: 'flex', gap: 12 }}>
        {['Chainlink', 'Supra', 'SaucerSwap V2'].map((x) => (
          <Pill key={x} size={20}>
            {x}
          </Pill>
        ))}
      </In>
    </Drift>
  )
}

/* The close: the brackets close in on the bar, the name, the line, and the one command. */
const Close: React.FC<{ s: SceneT }> = ({ s }) => {
  const f = useCurrentFrame()
  const close = sp(f, 6, SPRING.object)
  const bar = sp(f, 18, SPRING.ui)
  const word = sp(f, cue(s, 'autonr') - 2, SPRING.text)
  const cmdAt = cue(s, 'enforced') + 40
  const cmd = 'npx create-scaffold-hbar@latest my-autonr --template NetLayerLabs/Autonr'
  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 250, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 46 }}>
        <Mark size={190} close={close} bar={bar} />
        <div style={{ overflow: 'hidden', padding: '10px 0' }}>
          <Img src={staticFile('brand/autonr-word-paper.png')} style={{ height: 150, transform: `translateY(${(1 - word) * 170}px)`, display: 'block' }} />
        </div>
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 520, display: 'flex', justifyContent: 'center' }}>
        <RiseLine
          size={64}
          align="center"
          color={C.body}
          words={[
            { text: 'Autonomy,', at: cue(s, 'autonomy') },
            { text: 'enforced.', at: cue(s, 'enforced'), accent: true },
          ]}
        />
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 730, textAlign: 'center' }}>
        <TypeOn text={cmd} at={cmdAt} cps={36} caret caretColor={C.violet} style={{ fontSize: 34, color: C.hero, fontWeight: 500 }} />
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 812, textAlign: 'center', opacity: tween(f, cmdAt + 70, cmdAt + 90) }}>
        <span style={{ fontFamily: inter, fontSize: 24, color: C.dim }}>github.com/NetLayerLabs/Autonr · MIT · built on Hedera</span>
      </div>
    </AbsoluteFill>
  )
}

const COMPONENTS: Record<string, React.FC<{ s: SceneT }>> = {
  hook: Hook,
  problem: Problem,
  answer: Answer,
  record: Record,
  vault: Vault,
  swap: Swap,
  proof: Proof,
  tamper: Tamper,
  guard: Guard,
  reality: Reality,
  audit: Audit,
  stack: Stack,
  close: Close,
}

/** Captions are parked where the picture carries the words itself. */
const NO_CAPTIONS = new Set(['hook', 'close'])

/* =================================================================== sound */

type Fx = { at: number; file: string; vol: number }
const abs = (id: string, rel: number) => sceneOf(id).from + rel
const fx = (id: string, rel: number, file: string, vol = 0.5): Fx => ({ at: abs(id, rel) - 2, file, vol })

const SFX: Fx[] = (() => {
  const s = (id: string) => sceneOf(id)
  const out: Fx[] = [
    fx('hook', 2, 'air_swell', 0.35),
    fx('problem', cue(s('problem'), 'empty'), 'leak_tone', 0.6),
    fx('answer', cue(s('answer'), 'agent'), 'glass_tap', 0.35),
    fx('answer', cue(s('answer'), 'chainlink'), 'glass_tap', 0.35),
    fx('answer', cue(s('answer'), 'supra'), 'glass_tap', 0.35),
    fx('answer', cue(s('answer'), 'enforces'), 'glass_settle', 0.45),
    fx('answer', cue(s('answer'), 'moves'), 'pill_slide', 0.35),
    fx('record', cue(s('record'), 'writes'), 'key_ticks', 0.3),
    fx('record', cue(s('record'), 'first'), 'glass_seal', 0.6),
    fx('record', cue(s('record'), 'only'), 'dot_pop', 0.4),
    fx('vault', cue(s('vault'), 'asks'), 'glass_lift', 0.35),
    fx('vault', cue(s('vault'), 'hash'), 'pill_slide', 0.4),
    fx('vault', cue(s('vault'), 'hash') + 20, 'pill_land', 0.45),
    fx('vault', cue(s('vault'), 'number'), 'pill_slide', 0.4),
    fx('vault', cue(s('vault'), 'number') + 20, 'pill_land', 0.45),
    fx('vault', cue(s('vault'), 'oracles') + 10, 'glass_tap', 0.3),
    fx('vault', cue(s('vault'), 'itself') + 10, 'glass_tap', 0.3),
    fx('vault', cue(s('vault'), 'limits') + 10, 'glass_tap', 0.3),
    fx('vault', cue(s('vault'), 'accept'), 'glass_tap', 0.35),
    fx('vault', cue(s('vault'), 'never'), 'soft_hit', 0.4),
    fx('swap', cue(s('swap'), 'trade'), 'glass_settle', 0.4),
    fx('proof', cue(s('proof'), 'twelve'), 'dot_pop', 0.4),
    fx('proof', cue(s('proof'), 'matches'), 'glass_tap', 0.3),
    fx('proof', cue(s('proof'), 'seconds'), 'glass_tap', 0.3),
    fx('proof', cue(s('proof'), 'signed'), 'glass_tap', 0.3),
    fx('tamper', cue(s('tamper'), 'fails') - 6, 'glass_turn', 0.45),
    fx('tamper', cue(s('tamper'), 'fails') + 30, 'block_thump', 0.5),
    fx('tamper', cue(s('tamper'), 'fails') + 56, 'leak_tone', 0.55),
    fx('guard', cue(s('guard'), 'six', 1), 'soft_hit', 0.45),
    fx('reality', cue(s('reality'), 'pass'), 'glass_tap', 0.35),
    fx('reality', cue(s('reality'), 'refused'), 'leak_tone', 0.5),
    fx('audit', cue(s('audit'), 'exactly'), 'glass_settle', 0.4),
    fx('stack', cue(s('stack'), 'consensus'), 'glass_tap', 0.3),
    fx('stack', cue(s('stack'), 'contract'), 'glass_tap', 0.3),
    fx('stack', cue(s('stack'), 'token'), 'glass_tap', 0.3),
    fx('close', 4, 'glass_lift', 0.4),
    fx('close', 22, 'glass_seal', 0.6),
  ]
  for (const w of ['too', 'token', 'pool', 'reasoning', 'old', 'caller']) {
    const g = s('guard')
    const at = w === 'token' ? cue(g, 'token') : w === 'pool' ? cue(g, 'pool') : w === 'reasoning' ? cue(g, 'reasoning', 0) : w === 'caller' ? cue(g, 'caller') : cue(g, w)
    out.push(fx('guard', at, 'pill_land', 0.4))
  }
  const c = s('close')
  out.push(fx('close', cue(c, 'enforced') + 40 + Math.round(('npx create-scaffold-hbar@latest my-autonr --template NetLayerLabs/Autonr'.length * 30) / 36), 'soft_hit', 0.45))
  return out
})()

const VO_GAIN = 1
const MUSIC_BED = 0.85
const MUSIC_DUCKED = 0.3
const LINES = SCENES.map((s) => [s.from + s.voFrom, s.from + s.voFrom + s.voFrames] as const)
const DUCK: number[] = (() => {
  const v = new Array<number>(FILM_FRAMES + 1).fill(0)
  for (let f = 0; f <= FILM_FRAMES; f++) {
    let d = 0
    for (const [a, b] of LINES) d = Math.max(d, interpolate(f, [a - 10, a, b, b + 14], [0, 1, 1, 0], CLAMP))
    v[f] = d
  }
  return v
})()
const musicVolume = (f: number) => {
  const fadeIn = interpolate(f, [0, 20], [0, 1], CLAMP)
  const fadeOut = interpolate(f, [FILM_FRAMES - 50, FILM_FRAMES], [1, 0], CLAMP)
  return (MUSIC_BED - (MUSIC_BED - MUSIC_DUCKED) * DUCK[Math.min(FILM_FRAMES, Math.max(0, f))]) * fadeIn * fadeOut
}

/* ==================================================================== film */

export const Film: React.FC = () => (
  <AbsoluteFill style={{ background: C.bg }}>
    {SCENES.map((s) => {
      const Comp = COMPONENTS[s.id]
      return (
        <Sequence key={s.id} from={s.from} durationInFrames={s.durationInFrames} premountFor={30}>
          <AbsoluteFill>
            <Comp s={s} />
            {NO_CAPTIONS.has(s.id) ? null : <Captions words={s.words} />}
          </AbsoluteFill>
          <Sequence from={s.voFrom} layout="none">
            <Audio src={staticFile(`audio/vo/${s.id}.mp3`)} volume={VO_GAIN} />
          </Sequence>
        </Sequence>
      )
    })}
    <Audio src={staticFile('audio/music.mp3')} volume={musicVolume} />
    {SFX.map((x, i) => (
      <Sequence key={`fx${i}`} from={Math.max(0, x.at)} durationInFrames={150} layout="none">
        <Audio src={staticFile(`audio/sfx/${x.file}.mp3`)} volume={x.vol} />
      </Sequence>
    ))}
  </AbsoluteFill>
)
