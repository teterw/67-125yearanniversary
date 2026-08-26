# 67 × 125

A camera-tracked six-seven race, for the 125th anniversary of Saint Gabriel's
College (125 ปี คณะเซนต์คาเบรียล). Show both palms to the webcam, rock your hands
like a scale, and land **125 six-sevens as fast as you can**. The clock stops on
the 125th; the leaderboard is ordered by time, fastest first.

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
2. **Race** — a 3-2-1 countdown, then a count-up clock, your progress toward
   125, your live pace with a projected finish, and a tilt bar showing which
   hand the tracker thinks is on top. The clock stops by itself on the target.
   `End run` (or `Esc`) gives up early.

A single dot marks each hand the camera found: gold on whichever is currently
on top, cyan on the other, and a faint ring on anything the closest-pair filter
decided not to count. No skeleton — just enough to see what is being tracked.
3. **Results** — your time, where it lands on the board, the gap to the leader,
   and a name field to save it. The board preview shows your row slotted into
   place before you commit. Only finished runs go on the board; stopping at 90
   of 125 is not a time.

`Space` starts a run from the menu or the results screen.

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
- **Horizontal hand association.** Each frame's detections are matched to the
  previous frame's **x** instead of being sorted left-to-right, so hands drifting
  close together can't flip labels and invent a swap. Matching on 2D distance
  here is a trap worth naming: the hands travel vertically and sit a fixed
  distance apart horizontally, so as soon as the vertical travel exceeds the gap
  between the hands, a hand at the top of its swing is *closer* to where its
  partner was than to where it was itself. The labels swap, the signal inverts,
  and the count stops — the bigger the rep, the worse it gets. Which hand is
  which is a question about x, and only about x.
- **Closest-pair selection.** If more than two hands are ever in shot,
  `selectPair` keeps the two most likely to be yours: both large (apparent palm
  size is a direct proxy for distance), similar in size to each other (one
  person's hands sit at one distance, so a near hand paired with a far one is
  probably two people), and near whatever was being tracked a moment ago.
- **A dead zone and a debounce.** Hands must clear the travel threshold to flip
  sides, and swaps closer together than the cooldown are ignored.

A hand briefly leaving the frame holds the current state, so a dropped landmark
doesn't cost you a rep — but after 1.5 s the tracker forgets which side it was
on, rather than reading the next acquisition as a swap that never happened. It
keeps the baseline and centre line through that blackout: those describe how you
are standing, not where you are in a rep, and re-deriving them from the first
frame after a blackout anchors "neutral" to an extreme, which kills counting for
as long as the baseline takes to recover.

Inference runs on `requestVideoFrameCallback` where available, so it fires once
per decoded camera frame instead of once per repaint.

## When the camera can't keep up

This is the part that decides whether a race is winnable. A 30 fps webcam gets
three or four looks at each half-swing of a fast six-seven, and the ones taken
mid-flight are blurred badly enough that the model loses a hand outright — so
the naive version of this app stops counting exactly when you start trying.

Two settings cover it, both on by default.

### Blur & low-FPS assist

Four mechanisms, all in the detector:

- **Auto-gain.** The travel threshold follows the swing you are actually
  producing — 45% of the recent peak, floored at 40% of the Travel setting,
  which becomes a ceiling rather than a fixed bar. Sparse sampling rarely
  catches the true peak of a swing, so a fixed threshold quietly stops being
  reachable as the frame rate drops; one derived from what was measured does
  not.
- **One-hand fallback.** The gesture is antisymmetric about a centre line, so a
  single visible hand carries the whole signal. When blur takes one hand out,
  the other is mirrored about the tracked centre and counting continues for up
  to 1.2 s. The centre only ever updates from a real pair, so a long one-handed
  stretch can't drift the estimate it depends on.
- **Speed-aware smoothing.** An EMA attenuates anything oscillating near its own
  time constant — at 200 ms half-swings, the default smoothing halves the very
  signal being thresholded. The time constant is capped at a fifth of your
  measured half-period, so smoothing eases off as you speed up.
- **Sub-frame crossing times.** A swap is timestamped where the signal actually
  crossed between two samples, not at the frame that noticed. That feeds both
  the tempo estimate and the finishing time.

### Rhythm assist

Once you've settled into a tempo, a swap that's overdue against the beat is
counted even though the camera didn't confirm it. It only fires where there's
nothing to contradict it: hands out of frame, or the signal sitting in the dead
zone mid-flight. A clear reading always wins. Three bounds keep it from running
away:

- **A tempo must exist.** Three or more recent swap intervals, with a median
  absolute deviation under 35% of the median. (MAD rather than range: on a slow
  camera one late frame stretches a single interval, and range would throw away
  an otherwise good tempo because of it.)
- **The swap must be late.** Nothing fires until 1.35x the expected interval.
- **Two in a row, maximum.** Stop moving and the count stops within one 67, then
  waits for the camera again.

Predicted swaps advance to the *beat* rather than to now, so they stay in phase
and a late real swap can still land on the next one. They also never feed the
tempo estimate or the auto-gain — only camera-confirmed swaps do, so neither
assist can reinforce itself.

### Capture

Motion blur, not resolution, is what loses a fast hand, and a shorter exposure
is what fixes it. So `lib/useHandTracking.ts` asks for 60 fps at 960x540 rather
than the prettier 1280x720, which most webcams will only deliver at 30. On top
of that:

- **Two hands, not four.** In `VIDEO` mode MediaPipe re-runs the palm detector
  whenever it is tracking fewer hands than `numHands`, so asking for four when
  two are present pays for full detection on *every* frame. That is the most
  expensive line in the pipeline, and the frames it costs are exactly the frames
  a fast rep needs.
- **Timestamps that always advance.** `detectForVideo` rejects a timestamp it
  has already seen, and browsers that coarsen `performance.now()` for
  fingerprinting can hand out the same reading twice; the loop forces each one
  past the last. The stale-frame check that goes with it runs *only* on the
  `requestAnimationFrame` path — `requestVideoFrameCallback` already fires once
  per decoded frame, and some browsers quantise `currentTime` too, so testing it
  there throws away frames that were genuinely new.

- **Adaptive input scaling.** The hand model works from a small crop, so pushing
  a 960px frame at it is mostly wasted upload. When a `detectForVideo` call
  starts costing more than 18 ms, the frame handed to MediaPipe is downscaled a
  step (to 80%, 65%, 50%) and scaled back up when there's headroom. Landmarks
  are normalized, so nothing downstream notices.
- **One capture retune.** A feed still under 24 fps after 2.5 s gets a single
  `applyConstraints` attempt at 640x360, which usually comes with a shorter
  exposure as well as more frames.

The live frame rate, the cost per inference and the current input scale are all
shown in **Settings → Live test**, and the race screen puts up a `24 fps · thin
tracking` chip when the camera is getting fewer than about three looks at each
swing. If you see that, more light on your hands is the single most effective
fix — webcams lengthen exposure in dim rooms, and a long exposure is exactly
what smears a moving hand into nothing.

### Measured

Both assists were benchmarked against a synthetic gesture, sampled at a given
frame rate, with hands dropped while moving fast enough to blur. Six-sevens
counted out of a true 20-second run:

| Scenario | Both off | Rhythm only | Blur assist only | Both on |
| --- | --- | --- | --- | --- |
| 30 fps, clean, 200/min *(66 true)* | 66 | 66 | 66 | 66 |
| 30 fps, blur, 200/min *(66)* | 66 | 66 | 66 | 66 |
| 30 fps, blur, 300/min *(100)* | 2 | 0 | 22 | **39** |
| 15 fps, blur, 250/min *(83)* | 53 | 51 | 68 | **75** |
| One hand gone 900 ms *(33)* | 30 | 31 | **33** | **33** |
| Hands held still, heavy jitter *(0)* | 0 | 0 | 0 | 0 |

On a clean feed every configuration counts the same — the assists are inert when
tracking is already working — and none of them invent reps out of jitter.

A second bench models the report that started all of this: *big, fast reps count
worse than small, slow ones*. Both hands are fastest at the same instant, so both
blur out together and only the turnarounds — where the hand is momentarily still
and sharp — ever resolve. Moves counted at 30 fps over 20 seconds, in the default
every-swap mode:

| Gesture | Before | After |
| --- | --- | --- |
| small & slow — 0.04 travel, 900 ms *(44)* | 44 | 44 |
| medium — 0.09 travel, 500 ms *(80)* | 79 | 79 |
| big & fast — 0.16 travel, 320 ms *(124)* | **0** | **122** |
| huge & fast — 0.22 travel, 260 ms *(152)* | **0** | **147** |
| flat out — 0.24 travel, 220 ms *(180)* | 0 | 70 |

The zeroes were the association bug, not blur: past roughly 0.3 frame widths of
travel the labels inverted and stayed inverted. *Flat out* is 4.5 moves a second
with the hands resolvable barely a tenth of the time — undersampled past the
point anything can fix.

Label stability was checked separately, since matching on x is only safe if it
survives hands held close together. At horizontal gaps from 0.30 down to 0.03
frame widths, with jitter, the count is exact — 124 of 124 every time.

Finishing times hold up across cameras too: the same 125-rep gesture timed at
15, 30, 60 and 120 fps lands within 21 ms of a 480 fps reference on a 50-second
race, so a slower laptop doesn't cost you the leaderboard.

## Settings

Every change saves immediately and is picked up on your next visit — there's no
save button and nothing to confirm.

`/settings` covers the player name, the target (125 by default, with 67/25/10
for practice), countdown, what counts as one, camera device, mirroring, both
assists, sound, and leaderboard management.

**What counts as one** defaults to *every swap*: each hand alternation scores, so
125 is 125 moves. It reads the way a player counts out loud, and it halves what
any single dropped frame can cost — in full-6-7 mode a lost swap doesn't just
cost a rep, it inverts which swap the next one is. Switch to **Full 6-7** for two
swaps per point.

Three detection dials, all live-previewable:

| Dial | Raise it when | Lower it when |
| --- | --- | --- |
| **Travel** (palm lengths) | small movements are counting on their own | full reps aren't registering |
| **Smoothing** | the count flickers or jumps | fast reps feel late |
| **Debounce** (ms) | one rep sometimes scores twice | genuinely fast reps get dropped |

The **Live test** panel runs the real detector against a preview feed, so you
can tune all three by feel without touching your times.

Defaults are set for easy scoring: **0.32** palm lengths of travel and a **70 ms**
debounce, so short, lazy reps still register. Raise Travel if stray movement
starts counting on its own.

Because settings persist, changing a default in the code does **not** change what
an existing browser uses. Drag the slider, or hit **Reset settings**, to pick up
new defaults.

## Storage

Two localStorage keys, both versioned:

- `sixtyseven.settings.v4`
- `sixtyseven.leaderboard.v2` — top 100 times

Older settings records are migrated on read, minus whatever a new default has to
be allowed to reach you: a `v3` record carries over except `countMode`, since the
default moved to every-swap and a stored preference nobody set on purpose would
hide that; a `v2` record additionally drops its round length, which no longer
means anything; a `v1` record also drops `sensitivity`, which used to be a
fraction of frame height and would be a nonsensical threshold in palm lengths.

The `v1` leaderboard is deliberately *not* migrated. It held six-sevens scored
inside a fixed round — a different quantity from a race time, with no honest
conversion between them. It stays on disk, unread, in case you want it.

React reads both through `useSyncExternalStore` (`lib/useStore.ts`), so a write
anywhere in the app refreshes every screen, including a second open tab.

## If it feels slow

**Settings → Live test** prints the live frame rate, the cost of one inference,
the current input scale and which delegate MediaPipe got — for example
`38 fps · 7.4 ms · 80% · GPU`.

`CPU` is the number to look for. The GPU delegate is tried first and falls back
to CPU only when it cannot be created, which some browsers force by withholding
WebGL as a fingerprinting defence — Brave's Shields do this on default settings,
and the CPU fallback is several times slower for identical work. If one browser
lags and another doesn't, compare the delegate in both before touching anything
else; lowering the site's shields/fingerprinting setting usually restores it.

## Branding

The palette is lifted straight off the anniversary mark — royal `#243084`, crimson
`#c02424`, gold `#c0a878` — tinted only as far as legibility on a dark stage
requires, and declared once in `app/globals.css`:

| Token | Value | Where it lands |
| --- | --- | --- |
| `--color-ink` | `#070a18` | the navy ground, under a soft blue wash |
| `--color-royal` | `#5d6fe3` | left hand, buttons, focus, tracked dots |
| `--color-crimson` | `#e4454f` | right hand, warnings, the far end of every gradient |
| `--color-gold` | `#e0bc7c` | the anniversary line, milestones, the top-hand dot, first place |

The two halves of the mark do real work: the hand on the left of frame is royal,
the hand on the right is crimson, and the tilt bar swings between them.

Three logos live in `public/logos/`, trimmed and resized from the originals:

- `anniversary-125.png` — the 125th anniversary mark, hero of the menu and a
  small coin on the results and settings screens
- `act-1961.png`, `act-innotech.png` — the crests in the *presented by* row

The mark carries black ring text, so on this background it sits on its own light
coin (`.coin` in `globals.css`) rather than being recoloured. `app/favicon.ico`
and `app/icon.png` are generated from the same artwork.

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
