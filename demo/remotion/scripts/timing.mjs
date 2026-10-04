// Scene lengths from the narration: lead + voice + hold, in frames. Writes src/timing.json with every
// word's absolute frame, so the film cues picture and sound to spoken words.
import fs from 'node:fs'

const FPS = 30
const script = JSON.parse(fs.readFileSync('script.json', 'utf8'))
const vo = JSON.parse(fs.readFileSync('public/audio/vo/words.json', 'utf8'))

/** Frames of picture before the voice, and seconds of picture after it. Holds are where the film breathes. */
const LEAD = { hook: 36, close: 24 }
const HOLD = { problem: 1.2, answer: 2.4, record: 2.6, vault: 2.0, swap: 2.6, proof: 3.0, tamper: 4.2, guard: 2.6, reality: 2.0, audit: 2.6, stack: 2.2 }

let from = 0
const scenes = script.scenes.map((s) => {
  const t = vo[s.id]
  const lead = LEAD[s.id] ?? 12
  const natural = lead + Math.round((t.duration + (HOLD[s.id] ?? 1.0)) * FPS)
  const durationInFrames = Math.max(natural, s.minFrames ?? 0)
  const words = t.words.map((w) => ({ word: w.w, start: lead + Math.round(w.start * FPS), end: lead + Math.round(w.end * FPS) }))
  const scene = { id: s.id, from, durationInFrames, voFrom: lead, voFrames: Math.ceil(t.duration * FPS), words }
  from += durationInFrames
  return scene
})
const timing = { fps: FPS, totalFrames: from, scenes }
fs.writeFileSync('src/timing.json', JSON.stringify(timing, null, 1))
const spoken = scenes.reduce((n, s) => n + s.voFrames, 0)
for (const s of scenes) console.log(`${s.id.padEnd(8)} ${(s.from / FPS).toFixed(1).padStart(6)}s  ${(s.durationInFrames / FPS).toFixed(1)}s`)
console.log(`total ${(from / FPS).toFixed(1)} s, unnarrated ${(100 * (1 - spoken / from)).toFixed(0)}%`)
