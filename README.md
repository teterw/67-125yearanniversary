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

A single dot marks each hand the camera found: gold on whichever is currently
on top, cyan on the other, and a faint ring on anything the closest-pair filter
decided not to count. No skeleton — just enough to see what is being tracked.
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
- **Closest-pair selection.** MediaPipe is asked for up to four hands, and
  `selectPair` keeps the two most likely to be yours: both large (apparent palm
  size is a direct proxy for distance), similar in size to each other (one
  person's hands sit at one distance, so a near hand paired with a far one is
  probably two people), and near whatever was being tracked a moment ago. A
  bystander waving out of phase behind you doesn't touch the score.
- **A dead zone and a debounce.** Hands must clear the travel threshold to flip
  sides, and swaps closer together than the cooldown are ignored.

A hand briefly leaving the frame holds the current state, so a dropped landmark
doesn't cost you a rep — but after 700 ms the tracker forgets, rather than
reading the next acquisition as a swap that never happened.

Inference runs on `requestVideoFrameCallback` where available, so it fires once
per decoded camera frame instead of once per repaint.

### Rhythm assist

Hand tracking loses reps at speed: fast motion blurs frames, and a blurred hand
is a hand the model can't find. **Rhythm assist** (on by default) closes that
gap. Once you've settled into a tempo, a swap that's overdue against the beat is
counted even though the camera didn't confirm it — so a fast run feels like it
tracks every swap.

It only fires where there's nothing to contradict it: hands out of frame, or the
signal sitting in the dead zone mid-flight. A clear reading always wins. Three
bounds keep it from running away:

- **A tempo must exist.** Three or more recent swap intervals, with a spread
  under 60% of the median. Ragged timing predicts nothing.
- **The swap must be late.** Nothing fires until 1.35x the expected interval.
- **Two in a row, maximum.** Stop moving and the count stops within one 67, then
  waits for the camera again.

Predicted swaps advance to the *beat* rather than to now, so they stay in phase
and a late real swap can still land on the next one. They also never feed the
tempo estimate — only camera-confirmed swaps do, so predictions can't reinforce
themselves.

Measured on a simulated round of 12 reps with the camera blind for 900 ms in the
middle: **9 counted with it off, 11 with it on**. On a clean feed both count 12 —
the assist is inert when tracking is working.

Turn it off in Settings to count only what the camera actually sees.

## Settings

Every change saves immediately and is picked up on your next visit — there's no
save button and nothing to confirm.

`/settings` covers the player name, round length, countdown, what counts as one
(full 6-7 vs. every swap), camera device, mirroring, rhythm assist, sound, and
leaderboard management.

Three detection dials, all live-previewable:

| Dial | Raise it when | Lower it when |
| --- | --- | --- |
| **Travel** (palm lengths) | small movements are counting on their own | full reps aren't registering |
| **Smoothing** | the count flickers or jumps | fast reps feel late |
| **Debounce** (ms) | one rep sometimes scores twice | genuinely fast reps get dropped |

The **Live test** panel runs the real detector against a preview feed, so you
can tune all three by feel without touching your scores.

Defaults are set for easy scoring: **0.32** palm lengths of travel and a **70 ms**
debounce, so short, lazy reps still register. Raise Travel if stray movement
starts counting on its own.

Because settings persist, changing a default in the code does **not** change what
an existing browser uses. Drag the slider, or hit **Reset settings**, to pick up
new defaults.

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
