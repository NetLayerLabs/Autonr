// Narration for the Autonr demo, generated with ElevenLabs.
//   node vo-gen.js              all sections
//   VO_ONLY=v03 node vo-gen.js  one section
// The key and voice are read from an env file OUTSIDE this repo, so no secret is ever written here.
const fs = require('fs')
const { execFileSync } = require('child_process')
const ENV_FILES = [process.env.ELEVEN_ENV, '.env', '/Users/mrnetwork/Syntura/video/.env'].filter(Boolean)
for (const file of ENV_FILES) {
  if (!fs.existsSync(file)) continue
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z_]+)\s*=\s*(.*?)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}
const key = process.env.ELEVENLABS_API_KEY
if (!key) { console.error('No ELEVENLABS_API_KEY found. Set ELEVEN_ENV to an env file that has it.'); process.exit(1) }
const VOICE = process.env.ELEVENLABS_VOICE || 'CwhRBWXzGAHq8TQ4Fs17'
const MODEL = 'eleven_multilingual_v2'

// Eleven sections, about 190 s of speech. Every sentence is something the footage shows or the
// public chain records. Numbers are the real ones from the testnet reference deployment.
const SECTIONS = [
  ['00', "Autonr. Let an AI agent trade on Hedera, without trusting it."],
  ['01', "An AI agent that holds the keys and sets its own prices is one hallucination away from draining a vault. And afterwards, all you have is its word for why it traded."],
  ['02', "Autonr splits the job in three. The agent only decides whether to trade. Two oracle networks decide the price: Chainlink prices each leg, and Supra has to agree. And a vault on Hedera enforces both, before a single token moves."],
  ['03', "This is one scaffold-hbar template. One command gives you the vault, the agent, a verifier, and this dashboard, already pointed at a live deployment on testnet. Chainlink and Supra, read straight from the oracle contracts, eleven basis points apart."],
  ['04', "Here is one decision. The agent reads the oracles and the vault, decides to sell five dollars of WHBAR, and simulates the trade first. Then, before anything is signed, it publishes its full reasoning to a Hedera Consensus Service topic that only its own key can write to."],
  ['05', "Only then does it call the vault, carrying the hash of that message and its sequence number. The vault re-reads Chainlink and Supra itself, checks the caps, derives the minimum output on its own, and swaps on SaucerSwap V2. The agent never supplied a price."],
  ['06', "Anyone can check that trade from public data alone. Twelve checks, from the Mirror Node: the message bytes match the committed hash, the decision reached consensus five seconds before the trade, one key signed both, and the oracle readings match the chain."],
  ['07', "The Trade X-ray shows the call trace inside that one transaction: the vault read Chainlink, then Supra, then swapped. And the Tamper lab proves the proof. Flip one byte of the published reasoning, and the verdict turns from verified to failed."],
  ['08', "What if the agent misbehaves? The playground asks the live vault to break each rule. An oversized trade, an unlisted token, a wrong fee tier, a trade with no published reasoning, a replayed one, a caller that is not the agent. The vault refuses every one, with its own custom error."],
  ['09', "The testnet pool prices HBAR twenty times above the market. Sells pass the guard. Buys are refused by the oracle-derived minimum, and the agent holds, and says why. The guard works. And the audit page proves there are no gaps: every trade maps to exactly one earlier decision."],
  ['10', "Hedera Consensus Service holds the reasoning. The Smart Contract Service enforces the policy. The Token Service moves the funds. Chainlink and Supra set the price, SaucerSwap executes, and a Hedera Agent Kit plugin lets any agent trade this way. Autonr. One command away."],
]

const only = process.env.VO_ONLY ? process.env.VO_ONLY.replace(/^v/, '') : null
const todo = SECTIONS.filter(([id]) => !only || id === only)
console.log('characters:', todo.reduce((n, s) => n + s[1].length, 0), 'in', todo.length, 'sections')
fs.mkdirSync('public/vo', { recursive: true })

;(async () => {
  for (const [id, text] of todo) {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}`, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'content-type': 'application/json', accept: 'audio/mpeg' },
      body: JSON.stringify({
        text, model_id: MODEL,
        voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0.0, use_speaker_boost: true },
      }),
    })
    if (!res.ok) { console.error(`v${id}: ${res.status} ${(await res.text()).slice(0, 200)}`); continue }
    const buf = Buffer.from(await res.arrayBuffer())
    fs.writeFileSync(`public/vo/v${id}.mp3`, buf)
    console.log(`v${id}: ${(buf.length / 1024).toFixed(0)}kb`)
  }
  // Measured lengths, read by the film to time every scene.
  const durations = {}
  for (const f of fs.readdirSync('public/vo').filter((f) => f.endsWith('.mp3')).sort()) {
    const d = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', `public/vo/${f}`]).toString().trim()
    durations[f.replace('.mp3', '')] = Math.round(Number(d) * 100) / 100
  }
  fs.writeFileSync('public/vo/durations.json', JSON.stringify(durations, null, 1))
  console.log('total narration:', Object.values(durations).reduce((a, b) => a + b, 0).toFixed(1), 's')
})()
