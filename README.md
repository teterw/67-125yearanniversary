# 67 Counter

A camera-tracked six-seven counter. Show both palms to the webcam, rock your
hands like a scale, and the app counts every 6-7 you land — then drops your
score onto a leaderboard stored in your browser.

## Running it

```bash
npm run dev     # http://localhost:3000
npm run build && npm start
```

Chrome, Edge, Firefox or Safari, on `localhost` or HTTPS (`getUserMedia` needs a
secure context). The camera feed and every frame of tracking stay on-device —
nothing is uploaded, and there is no backend.

## The three steps

1. **Menu** — the live camera sits behind a start button and the current
   leaderboard. Start unlocks once the camera and the hand model are both up.
2. **Round** — a 3-2-1 countdown, then a full-screen counter, the round clock,
   your live pace, and a tilt bar showing which hand the tracker thinks is on
   top. `End round` (or `Esc`) stops early.
3. **Results** — your score, where it lands on the board, the gap to the leader,
   and a name field to save it. The board preview shows your row slotted into
   place before you commit.

`Space` starts a round from the menu or the results screen.

## How the counting works

`lib/detector.ts` reduces each detected hand to a palm centre and watches which
one is higher. Every change of the top hand is a *swap*; by default a full
six-seven is two swaps (up on "six", back on "seven").

Five things keep that honest in real conditions:

- **Palm-length units.** Every threshold is measured against your own hand size
  (wrist to middle knuckle, aspect-corrected so it survives rotation) rather
  than a fraction of the frame. The same settings work at the keyboard and
  across the room; an absolute threshold silently stops counting once you sit
  far enough back.
- **A moving baseline.** Separation is measured against a slow EMA of itself,
  so resting with one hand habitually higher doesn't bias every swap. Without
  it, a large enough resting offset can keep the signal from ever reaching the
  far threshold at all.
- **Smoothing.** Both hand positions run through a frame-rate-independent EMA,
  so landmark jitter doesn't rattle the state machine. Time-constant based, so
  15 fps and 60 fps behave the same.
- **Temporal hand association.** Each frame's detections are matched to the
  previous frame's positions instead of being sorted by x, so hands drifting
  close together can't flip labels and invent a swap.
- **A dead zone and a debounce.** Hands must clear the travel threshold to flip
  sides, and swaps closer together than the cooldown are ignored.

A hand briefly leaving the frame holds the current state, so a dropped landmark
doesn't cost you a rep — but after 700 ms the tracker forgets, rather than
reading the next acquisition as a swap that never happened.

Inference runs on `requestVideoFrameCallback` where available, so it fires once
per decoded camera frame instead of once per repaint.

## Settings

`/settings` covers the player name, round length, countdown, what counts as one
(full 6-7 vs. every swap), camera device, mirroring, the skeleton overlay,
sound, and leaderboard management.

Three detection dials, all live-previewable:

| Dial | Raise it when | Lower it when |
| --- | --- | --- |
| **Travel** (palm lengths) | small movements are counting on their own | full reps aren't registering |
| **Smoothing** | the count flickers or jumps | fast reps feel late |
| **Debounce** (ms) | one rep sometimes scores twice | genuinely fast reps get dropped |

The **Live test** panel runs the real detector against a preview feed, so you
can tune all three by feel without touching your scores.

## Storage

Two localStorage keys, both versioned:

- `sixtyseven.settings.v2`
- `sixtyseven.leaderboard.v1` — top 100 entries

A `v1` settings record is migrated on read. Everything carries over except
`sensitivity`, which used to be a fraction of frame height and would be a
nonsensical threshold in palm lengths.

React reads them through `useSyncExternalStore` (`lib/useStore.ts`), so a write
anywhere in the app refreshes every screen, including a second open tab.

## Tracking assets

MediaPipe Tasks Vision is vendored rather than pulled from a CDN, so the app
works offline:

- `public/mediapipe/wasm/` — copied from `node_modules/@mediapipe/tasks-vision/wasm`
- `public/mediapipe/models/hand_landmarker.task` — the float16 hand landmarker

If you bump `@mediapipe/tasks-vision`, re-copy the wasm directory to match.
The GPU delegate is tried first and falls back to CPU when WebGL is unavailable.

Re-vendor both with:

```bash
npm run vendor:mediapipe
```

That directory is ~30 MB. If you would rather not commit it, add
`public/mediapipe/` to `.gitignore` and run the script after cloning.
