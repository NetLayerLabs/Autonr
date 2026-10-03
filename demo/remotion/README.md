# The Autonr demo video

How `out/autonr-demo.mp4` was made. It is about 3 minutes, and every dashboard shot in it is real
screen capture of a fresh npm scaffold of this template, served with `next start` and pointed at the
live testnet reference deployment. The terminal scenes replay the real output of `agent:tick`,
`verify` and `agent:red-team` from the same session (trade #8, HCS message 19). No mockups.

```
npm install
npm run vo              # narration via ElevenLabs (key read from an env file outside the repo)
npm run capture home proof tamper playground audit owner   # film the dashboard beats (DPR=2 PROMOTE=1)
npm run studio          # preview in Remotion Studio
npm run render          # 1080p master -> out/autonr-demo.mp4, then loudness + colour tags
```

## What is in here

| | |
|---|---|
| `src/Autonr.tsx` | The eleven scenes, one per section of narration, plus the trade diagram and the terminal. |
| `src/ui.tsx` | The design system: palette, type, `BrowserFrame` and its camera, `Terminal`, cards and chips. |
| `scripts/capture.mjs` | Films the dashboard through the Chrome DevTools screencast with an injected pointer. |
| `scripts/clips-manifest.mjs` | Measures the footage into `src/clips.json` so the bundle knows what exists. |
| `scripts/finish.mjs` | Loudness (-14 LUFS) and colour tags, audio only; the video stream is hashed, not re-encoded. |
| `vo-gen.js` | The narration script and the ElevenLabs call that generates it. |
| `public/brand/` | The Hedera icon and lockup, as shipped in the scaffold's `public/` folder. |

The footage (`public/clips/*.mp4`), the narration (`public/vo/*.mp3`) and the rendered master are not
committed. `vo-gen.js` reads `ELEVENLABS_API_KEY` from `ELEVEN_ENV` or a local `.env`, never from the repo.
