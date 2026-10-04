// The score -> public/audio/music.mp3: one ElevenLabs Music call whose parts land on the film's scene cuts
// (src/timing.json), then levelled to audio.json music.lufs. Cached by the plan's hash; FORCE=1 regenerates.
import fs from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'

for (const file of [process.env.ELEVEN_ENV, '.env', '/Users/mrnetwork/Syntura/video/.env'].filter(Boolean)) {
  if (!fs.existsSync(file)) continue
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z_]+)\s*=\s*(.*?)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}
const T = JSON.parse(fs.readFileSync('src/timing.json', 'utf8'))
const M = JSON.parse(fs.readFileSync('audio.json', 'utf8')).music
const sceneAt = (id) => T.scenes.find((s) => s.id === id).from / T.fps
const total = T.totalFrames / T.fps
const cuts = M.parts.map((p) => sceneAt(p.from))
const plan = {
  positive_global_styles: [M.prefix, `${M.bpm} BPM`],
  negative_global_styles: M.negative,
  sections: M.parts.map((p, i) => ({
    section_name: p.name,
    positive_local_styles: p.styles,
    negative_local_styles: [],
    duration_ms: Math.round(((i + 1 < cuts.length ? cuts[i + 1] : total + 0.5) - cuts[i]) * 1000),
    lines: [],
  })),
}
fs.mkdirSync('.cache', { recursive: true })
const hash = createHash('sha1').update(JSON.stringify(plan)).digest('hex').slice(0, 10)
const raw = `.cache/music-${hash}.mp3`
if (!fs.existsSync(raw) || process.env.FORCE) {
  console.log('generating', plan.sections.map((s) => `${s.section_name} ${(s.duration_ms / 1000).toFixed(1)}s`).join(' | '))
  const res = await fetch('https://api.elevenlabs.io/v1/music?output_format=mp3_44100_192', {
    method: 'POST',
    headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ composition_plan: plan, model_id: M.model, respect_sections_durations: true }),
  })
  if (!res.ok) throw new Error(`music: ${res.status} ${(await res.text()).slice(0, 300)}`)
  fs.writeFileSync(raw, Buffer.from(await res.arrayBuffer()))
}
const dur = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString())
console.log(`raw ${dur(raw).toFixed(2)} s for a ${total.toFixed(2)} s film`)
const lufs = (f) => {
  const r = spawnSync('ffmpeg', ['-nostats', '-i', f, '-af', 'ebur128', '-f', 'null', '-'], { encoding: 'utf8' })
  return Number(r.stderr.slice(r.stderr.lastIndexOf('Summary:')).match(/I:\s+(-?[\d.]+) LUFS/)[1])
}
const gain = M.lufs - lufs(raw)
fs.mkdirSync('public/audio', { recursive: true })
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-af', `volume=${gain.toFixed(2)}dB,apad,atrim=0:${(total + 1).toFixed(3)}`, '-b:a', '256k', 'public/audio/music.mp3'])
console.log(`levelled ${gain >= 0 ? '+' : ''}${gain.toFixed(1)} dB to ${M.lufs} LUFS -> public/audio/music.mp3`)
