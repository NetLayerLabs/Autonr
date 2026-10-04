// Narration with word timings, from ElevenLabs text-to-speech/with-timestamps.
//   node scripts/voiceover.mjs          every scene
//   ONLY=proof node scripts/voiceover.mjs
// The key is read from ELEVEN_ENV, a local .env, or the shared video env file outside this repo.
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'

const ENV_FILES = [process.env.ELEVEN_ENV, '.env', '/Users/mrnetwork/Syntura/video/.env'].filter(Boolean)
for (const file of ENV_FILES) {
  if (!fs.existsSync(file)) continue
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z_]+)\s*=\s*(.*?)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}
const key = process.env.ELEVENLABS_API_KEY
if (!key) throw new Error('No ELEVENLABS_API_KEY found. Set ELEVEN_ENV to an env file that has it.')

const script = JSON.parse(fs.readFileSync('script.json', 'utf8'))
const only = process.env.ONLY
fs.mkdirSync('public/audio/vo', { recursive: true })
const timingsFile = 'public/audio/vo/words.json'
const timings = fs.existsSync(timingsFile) ? JSON.parse(fs.readFileSync(timingsFile, 'utf8')) : {}

/** Characters with times -> spoken words with times. */
function wordsOf(alignment) {
  const { characters: ch, character_start_times_seconds: s, character_end_times_seconds: e } = alignment
  const words = []
  let cur = null
  for (let i = 0; i < ch.length; i++) {
    if (/\s/.test(ch[i])) { if (cur) words.push(cur); cur = null; continue }
    if (!cur) cur = { w: '', start: s[i], end: e[i] }
    cur.w += ch[i]
    cur.end = e[i]
  }
  if (cur) words.push(cur)
  return words
}

/** The caption shows `text`; the voice reads `say`. Map display words onto spoken words one to one. */
function displayWords(scene, spoken) {
  const shown = scene.text.split(/\s+/)
  if (shown.length !== spoken.length) throw new Error(`${scene.id}: ${shown.length} display words vs ${spoken.length} spoken`)
  return shown.map((w, i) => ({ w, start: +spoken[i].start.toFixed(3), end: +spoken[i].end.toFixed(3) }))
}

for (const scene of script.scenes) {
  if (only && scene.id !== only) continue
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${script.voice}/with-timestamps?output_format=mp3_44100_192`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'content-type': 'application/json' },
    body: JSON.stringify({ text: scene.say ?? scene.text, model_id: script.model, voice_settings: script.settings }),
  })
  if (!res.ok) throw new Error(`${scene.id}: ${res.status} ${(await res.text()).slice(0, 200)}`)
  const body = await res.json()
  const file = `public/audio/vo/${scene.id}.mp3`
  fs.writeFileSync(file, Buffer.from(body.audio_base64, 'base64'))
  const duration = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim())
  const words = displayWords(scene, wordsOf(body.alignment))
  const rate = scene.text.length / duration
  timings[scene.id] = { duration: +duration.toFixed(3), words }
  console.log(`${scene.id.padEnd(8)} ${duration.toFixed(2)} s  ${words.length} words  ${rate.toFixed(1)} chars/s`)
}
fs.writeFileSync(timingsFile, JSON.stringify(timings, null, 1))
const total = Object.values(timings).reduce((n, t) => n + t.duration, 0)
console.log('narration total', total.toFixed(1), 's')
