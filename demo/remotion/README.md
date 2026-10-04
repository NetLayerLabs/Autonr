# The Autonr demo video

How `out/autonr-demo.mp4` was made: 2 min 36 s, 1080p, −14 LUFS. It follows the dashboard's own design language
(black, white type, one muted violet for "verified", rose for "refused") and every dashboard shot in it is real screen
capture of a fresh npm scaffold of this template pointed at the live testnet reference deployment (trade 8, HCS
message 19). No mockups, no browser chrome.

```
npm install
npm run vo                     # narration + word timings (ElevenLabs, text-to-speech/with-timestamps)
npm run timing                 # scene lengths from the narration -> src/timing.json
npm run music                  # one ElevenLabs Music call, sections cut to the scenes, -22 LUFS bed
DPR=2 PROMOTE=1 npm run capture -- home proof tamper playground audit   # film the dashboard at 3200x1800
npm run studio                 # preview
npm run render                 # master -> out/autonr-demo.mp4, then loudness and colour tags
```

| | |
|---|---|
| `script.json` | What the captions show (`text`) and what the voice reads (`say`), per scene. |
| `audio.json` | The score's plan: style prompt and one part per scene group. |
| `src/Film.tsx` | The thirteen scenes, cued to spoken words (`cue(scene, "word")`), the SFX list and the mix. |
| `src/kit.tsx` | Glass and rim, captions, rise-line headlines, type-on, the decision-record card, the footage pane and its camera, pills, the live Autonr mark. |
| `src/theme.ts` | Palette, type, springs and easing. |
| `scripts/capture.mjs` | Films the dashboard through the DevTools screencast (Playwright's headless shell), with an injected pointer. |
| `scripts/finish.mjs` | Loudness to −14 LUFS and bt709 tags; the video stream is hashed, never re-encoded. |
| `public/brand/` | The Autonr mark (vector), wordmark cut-outs, and the Hedera lockup. |

The spine of the film is the agent's decision record: it is written, sealed on HCS, cited by the vault, verified, and
turns rose when one letter of it is changed. Narration, music, SFX and footage are generated or filmed, and not
committed. The scripts read `ELEVENLABS_API_KEY` from `ELEVEN_ENV`, a local `.env`, or a shared env file outside the
repository, never from the repo.
