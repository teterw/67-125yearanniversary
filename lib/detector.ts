import type { CountMode } from "./storage";

/**
 * Counts "six-sevens" from two-handed landmark data.
 *
 * The gesture is the scale-weighing motion: palms up, one hand rises while the
 * other drops, then they trade places. We reduce each hand to a palm centre and
 * watch which one is on top. Every change of the top hand is a swap; a full
 * six-seven is two swaps (up on "six", back on "seven").
 *
 * Several things keep that honest across real conditions:
 *
 *  - every threshold is measured in **palm lengths**, not frame height, so the
 *    same settings work whether you are at the keyboard or across the room;
 *  - both hand positions are **smoothed** with a frame-rate-independent EMA, so
 *    landmark jitter doesn't rattle the state machine;
 *  - the separation is measured against a slow-moving **baseline**, so resting
 *    with one hand naturally higher doesn't bias every swap.
 *
 * When more than two hands are in shot — a bystander, a reflection, someone
 * walking past — `selectPair` keeps the pair nearest the camera, since apparent
 * hand size is a direct proxy for distance.
 *
 * ## Surviving a slow camera
 *
 * A 30 fps webcam looking at a fast six-seven gets three or four samples of each
 * half-swing, and the ones taken mid-flight are motion-blurred badly enough that
 * the model loses a hand outright. Four mechanisms keep the count honest when
 * that happens, all gated behind `adaptive`:
 *
 *  - **Auto-gain.** The travel threshold follows the swing the player is
 *    actually producing (`AUTO_GAIN` times the recent peak), floored at a
 *    fraction of the Travel setting. Sparse sampling rarely catches the true
 *    peak of a swing, so a fixed threshold quietly stops being reachable as the
 *    frame rate drops; one derived from what was measured does not.
 *  - **One-hand fallback.** The motion is antisymmetric about a centre line, so
 *    a single visible hand carries the whole signal. When blur takes one hand
 *    out, the other is mirrored about the tracked centre and counting continues.
 *  - **Speed-aware smoothing.** An EMA attenuates anything oscillating near its
 *    own time constant, so smoothing sized for jitter can halve the very swing
 *    being thresholded. The constant is capped against the player's tempo.
 *  - **Sub-frame crossing times.** Swaps are timestamped where the signal
 *    actually crossed between two samples, not at the frame that noticed. At
 *    30 fps that is worth up to 33 ms per rep, on the tempo estimate and on the
 *    finishing time alike.
 *
 * On top of that, `prediction` keeps the count on the beat. Once a steady tempo
 * is established, a swap that is overdue while the camera has nothing useful to
 * say — hands out of frame, or the signal sitting in the dead zone — is counted
 * anyway.
 */

export interface DetectorConfig {
  /** Vertical separation required to flip sides, in palm lengths. */
  sensitivity: number;
  cooldownMs: number;
  countMode: CountMode;
  /** 0 = raw landmarks, 1 = heaviest smoothing. */
  smoothing: number;
  /** Fill in overdue swaps from the established tempo. */
  prediction: boolean;
  /** Auto-gain, one-hand fallback and speed-aware smoothing. */
  adaptive: boolean;
}

export type Side = "L" | "R";

export interface DetectorFrame {
  count: number;
  /** True on the frame a point was awarded. */
  scored: boolean;
  /** When the scoring swap crossed, interpolated between samples. */
  scoredAt: number;
  /** Which hand is currently on top, or null before the first lock-on. */
  side: Side | null;
  /** Mid-way through a six-seven — one swap landed, one to go (cycle mode). */
  halfway: boolean;
  /** Baselined separation in palm lengths; positive means the right hand is up. */
  signal: number;
  /** Separation currently required to flip sides — auto-gain moves this. */
  threshold: number;
  handsVisible: number;
  /** The hands actually being counted, after the closest-pair filter. */
  tracked: HandObservation[];
  /** This frame's swap came from the tempo, not from the camera. */
  predicted: boolean;
  /** A usable tempo is established, so prediction can step in if needed. */
  onBeat: boolean;
  /** Counting from one hand, with its partner mirrored about the centre line. */
  solo: boolean;
  /** Measured detection rate, in frames per second. */
  fps: number;
  /** 0..1 — how well the camera is keeping up with the motion. */
  quality: number;
}

export type Anchors = { left: HandObservation; right: HandObservation } | null;

export interface HandObservation {
  /** Index back into the landmark array this came from. -1 when synthesized. */
  index: number;
  x: number;
  y: number;
  /** Palm length, in frame-height units — the reference for every threshold. */
  scale: number;
}

/** Guards against a divide-by-zero when a hand is detected almost edge-on. */
const MIN_SCALE = 0.015;
/**
 * Hands gone this long: forget which side we were on rather than read the next
 * acquisition as a swap that never happened. Generous, because at speed both
 * hands blur out together — they are moving fastest at exactly the same moment —
 * and a blackout through a whole swing is normal, not a sign the player left.
 */
const STALE_MS = 1500;
/** Beyond this gap, last frame's positions are too old to match against. */
const REASSOCIATE_MS = 350;
const BASELINE_TAU_MS = 2500;
const CENTER_TAU_MS = 2500;
const SMOOTHING_MAX_TAU_MS = 120;

/** Swap intervals kept for the tempo estimate. */
const TEMPO_WINDOW = 6;
/** Below three intervals there is no tempo, only a coincidence. */
const TEMPO_MIN_SAMPLES = 3;
/** Median absolute deviation, over the median, past which the tempo is junk. */
const TEMPO_MAX_SPREAD = 0.35;
/** Gaps outside this band aren't part of a rhythm. */
const TEMPO_MIN_MS = 60;
const TEMPO_MAX_MS = 2000;
/** How overdue a swap must be before the tempo fills it in. */
const PREDICT_GRACE = 0.35;
/** Consecutive predictions allowed before real evidence is required again. */
const MAX_PREDICTED_RUN = 2;

/** Fraction of the measured swing that has to be travelled to call a swap. */
const AUTO_GAIN = 0.45;
/** Floor under the auto-gained threshold, as a fraction of the Travel setting. */
const AUTO_MIN = 0.4;
/** Weight of each new half-swing in the running amplitude estimate. */
const AMPLITUDE_ALPHA = 0.35;
/** Smoothing time constant, capped at this fraction of a half-cycle. */
const SMOOTHING_CYCLE_FRAC = 0.2;
/** How long the mirrored partner stays usable after the pair was last seen. */
const SOLO_MS = 1200;
/** Samples per half-swing at which tracking is considered comfortable. */
const QUALITY_SAMPLES = 5;

/** How much better a re-labelling must look before the hands are re-labelled. */
const RELABEL_MARGIN = 0.7;

/** How hard a depth mismatch counts against a pair (one person, one distance). */
const SIZE_MISMATCH_PENALTY = 0.5;
/** How much sticking to the hands we were already on is worth. */
const CONTINUITY_BONUS = 0.6;
/** Combined movement, in frame widths, past which continuity counts for nothing. */
const CONTINUITY_RADIUS = 0.5;

/** EMA weight for a step of `dt` ms toward a time constant of `tau` ms. */
function emaWeight(dt: number, tau: number) {
  return tau <= 0 ? 1 : 1 - Math.exp(-dt / tau);
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

export class SixtySevenDetector {
  private config: DetectorConfig;
  private yLeft: number | null = null;
  private yRight: number | null = null;
  private baseline: number | null = null;
  /** Slow mean of the two palm heights — the line the hands pivot around. */
  private center: number | null = null;
  private prevLeft: HandObservation | null = null;
  private prevRight: HandObservation | null = null;
  private side: Side | null = null;
  private swaps = 0;
  private lastSwapAt = 0;
  private lastFrameAt = 0;
  private lastSeenAt = 0;
  /** Last frame both hands were genuinely detected — what solo mode leans on. */
  private lastPairAt = 0;
  private signal = 0;
  private prevSignal: number | null = null;
  private prevSignalAt = 0;
  private tracked: HandObservation[] = [];
  /** Intervals between recent camera-confirmed swaps, for the tempo estimate. */
  private intervals: number[] = [];
  private predictedRun = 0;
  /** Timestamps of awarded points, for the live and peak rate readouts. */
  private hits: number[] = [];
  /** Largest excursion seen on the current side, feeding the amplitude estimate. */
  private peak = 0;
  /** Running estimate of how far the player's swing actually travels. */
  private amplitude: number | null = null;
  private fps = 0;

  count = 0;

  constructor(config: DetectorConfig) {
    this.config = config;
  }

  setConfig(config: DetectorConfig) {
    this.config = config;
  }

  reset() {
    this.forget();
    this.intervals = [];
    this.predictedRun = 0;
    this.lastSwapAt = 0;
    this.lastFrameAt = 0;
    this.lastSeenAt = 0;
    this.hits = [];
    this.baseline = null;
    this.center = null;
    this.amplitude = null;
    this.fps = 0;
    this.count = 0;
  }

  /**
   * Drops tracking state but keeps the score — and keeps `baseline`/`center`,
   * which describe how the player is standing rather than where they are in a
   * rep. Re-deriving those from the first frame after a blackout was the worst
   * bug in here: that frame lands mid-swing, so an extreme became "neutral" and
   * counting died for the two and a half seconds the baseline took to recover.
   */
  private forget() {
    this.yLeft = null;
    this.yRight = null;
    this.prevLeft = null;
    this.prevRight = null;
    this.side = null;
    this.swaps = 0;
    this.signal = 0;
    this.prevSignal = null;
    this.prevSignalAt = 0;
    this.predictedRun = 0;
    this.peak = 0;
    this.lastPairAt = 0;
    this.tracked = [];
  }

  update(observations: HandObservation[], now: number): DetectorFrame {
    const dt = this.lastFrameAt === 0 ? 16 : Math.min(250, now - this.lastFrameAt);
    this.lastFrameAt = now;
    const instant = 1000 / dt;
    this.fps = this.fps === 0 ? instant : this.fps + emaWeight(dt, 1000) * (instant - this.fps);

    // Ignore everyone else in shot before deciding anything.
    const pair = selectPair(observations, this.anchors(now));
    this.tracked = pair;

    let left: HandObservation | null = null;
    let right: HandObservation | null = null;
    let solo = false;

    if (pair.length >= 2) {
      [left, right] = this.associate(pair, now);
      this.lastSeenAt = now;
      this.lastPairAt = now;
      // The centre line only ever comes from a real pair, so a long one-handed
      // stretch can't drift the very estimate it depends on.
      const mid = (left.y + right.y) / 2;
      const ck = emaWeight(dt, CENTER_TAU_MS);
      this.center = this.center === null ? mid : this.center + ck * (mid - this.center);
    } else if (pair.length === 1 && this.canGoSolo(now)) {
      // One hand blurred out. The gesture is antisymmetric about the centre
      // line, so the hand still in frame carries the whole signal on its own —
      // mirror it and keep counting rather than stalling until both come back.
      const seen = pair[0];
      const isLeft = xGap(seen, this.prevLeft!) <= xGap(seen, this.prevRight!);
      const partner: HandObservation = {
        index: -1,
        x: (isLeft ? this.prevRight! : this.prevLeft!).x,
        y: 2 * this.center! - seen.y,
        scale: seen.scale,
      };
      left = isLeft ? seen : partner;
      right = isLeft ? partner : seen;
      this.lastSeenAt = now;
      solo = true;
    }

    if (left === null || right === null) {
      // A hand blinking out mid-rep shouldn't cost the rep, but a long absence
      // means the next reading is unrelated to the last one.
      if (this.lastSeenAt > 0 && now - this.lastSeenAt > STALE_MS) this.forget();
      const guess = this.predict(now);
      this.glide(dt);
      return this.frame(guess.scored, pair.length, guess.swapped, false, guess.at);
    }

    this.prevLeft = left;
    this.prevRight = right;

    const scale = Math.max(MIN_SCALE, (left.scale + right.scale) / 2);
    const k = emaWeight(dt, this.smoothingTau());
    this.yLeft = this.yLeft === null ? left.y : this.yLeft + k * (left.y - this.yLeft);
    this.yRight = this.yRight === null ? right.y : this.yRight + k * (right.y - this.yRight);

    // Positive = the right-hand-side hand is higher (y grows downward).
    const raw = (this.yLeft - this.yRight) / scale;
    // Neutral is hands level, not wherever they happened to be on the first
    // frame the camera resolved — mid-rep, that frame is an extreme.
    if (this.baseline === null) this.baseline = 0;
    this.baseline += emaWeight(dt, BASELINE_TAU_MS) * (raw - this.baseline);
    this.signal = raw - this.baseline;

    const { cooldownMs, countMode } = this.config;
    const threshold = this.threshold();

    // Track how far this half-swing actually got, so auto-gain has something to
    // gain against.
    if (this.side === "R" && this.signal > 0) this.peak = Math.max(this.peak, this.signal);
    else if (this.side === "L" && this.signal < 0) this.peak = Math.max(this.peak, -this.signal);

    let next: Side | null = this.side;
    if (this.signal > threshold) next = "R";
    else if (this.signal < -threshold) next = "L";

    let scored = false;
    let predicted = false;
    let scoredAt = now;

    if (next !== null && next !== this.side) {
      const crossedAt = this.crossingTime(now, next === "R" ? threshold : -threshold);
      if (this.side === null) {
        // First lock-on establishes which side we started on — no point yet.
        this.side = next;
        this.peak = 0;
      } else if (crossedAt - this.lastSwapAt >= cooldownMs) {
        this.noteAmplitude();
        this.noteTempo(crossedAt);
        this.side = next;
        this.lastSwapAt = crossedAt;
        this.swaps += 1;
        if (countMode === "swap" || this.swaps % 2 === 0) {
          this.count += 1;
          this.hits.push(crossedAt);
          scored = true;
          scoredAt = crossedAt;
        }
      }
    } else if (Math.abs(this.signal) < threshold) {
      // The hands are mid-flight and the camera can't call it. If a swap is
      // overdue against the established tempo, the rhythm calls it instead.
      const guess = this.predict(now);
      scored = guess.scored;
      predicted = guess.swapped;
      scoredAt = guess.at;
    }

    this.prevSignal = this.signal;
    this.prevSignalAt = now;

    return this.frame(scored, solo ? 1 : 2, predicted, solo, scoredAt);
  }

  /** Whether the mirrored-partner trick has everything it needs right now. */
  private canGoSolo(now: number) {
    return (
      this.config.adaptive &&
      this.center !== null &&
      this.prevLeft !== null &&
      this.prevRight !== null &&
      this.lastPairAt > 0 &&
      now - this.lastPairAt <= SOLO_MS
    );
  }

  /**
   * Separation required to flip sides. With auto-gain off this is exactly the
   * Travel setting; with it on the setting becomes a ceiling and the working
   * threshold follows the swing the camera is actually resolving — which is
   * what keeps a slow feed from quietly falling below the bar on fast reps.
   */
  private threshold() {
    const { sensitivity, adaptive } = this.config;
    if (!adaptive || this.amplitude === null) return sensitivity;
    return clamp(AUTO_GAIN * this.amplitude, sensitivity * AUTO_MIN, sensitivity);
  }

  /**
   * Smoothing time constant. An EMA attenuates anything oscillating near its own
   * time constant, so smoothing sized for landmark jitter shrinks the very
   * signal being thresholded once reps get fast. Cap it against the tempo.
   */
  private smoothingTau() {
    const tau = this.config.smoothing * SMOOTHING_MAX_TAU_MS;
    if (!this.config.adaptive) return tau;
    const period = this.period;
    return period === null ? tau : Math.min(tau, period * SMOOTHING_CYCLE_FRAC);
  }

  /**
   * Where the signal crossed `level`, somewhere between the previous sample and
   * this one. The frame that notices a swap can be most of a frame late, which
   * lands on the tempo estimate and on the finishing time alike.
   */
  private crossingTime(now: number, level: number) {
    if (this.prevSignal === null || this.prevSignalAt === 0) return now;
    const span = this.signal - this.prevSignal;
    if (span === 0) return now;
    const frac = (level - this.prevSignal) / span;
    if (!Number.isFinite(frac)) return now;
    return this.prevSignalAt + clamp(frac, 0, 1) * (now - this.prevSignalAt);
  }

  /** Folds the half-swing just completed into the amplitude estimate. */
  private noteAmplitude() {
    if (this.peak > 0) {
      this.amplitude =
        this.amplitude === null
          ? this.peak
          : this.amplitude + AMPLITUDE_ALPHA * (this.peak - this.amplitude);
    }
    this.peak = 0;
  }

  /** Records the gap since the last swap, so the tempo tracks the player. */
  private noteTempo(at: number) {
    const gap = at - this.lastSwapAt;
    if (this.lastSwapAt > 0 && gap >= TEMPO_MIN_MS && gap <= TEMPO_MAX_MS) {
      this.intervals.push(gap);
      if (this.intervals.length > TEMPO_WINDOW) this.intervals.shift();
    } else {
      // A long pause means the old tempo no longer describes what's happening.
      this.intervals = [];
    }
    this.predictedRun = 0;
  }

  /**
   * Median swap interval, or null when the tempo is too ragged to trust.
   *
   * Spread is a median absolute deviation rather than the full range: on a slow
   * camera one late frame stretches a single interval, and range would throw
   * away an otherwise perfectly good tempo because of it.
   */
  private get period(): number | null {
    if (this.intervals.length < TEMPO_MIN_SAMPLES) return null;
    const sorted = [...this.intervals].sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1];
    if (median <= 0) return null;
    const deviations = sorted.map((v) => Math.abs(v - median)).sort((a, b) => a - b);
    const mad = deviations[deviations.length >> 1];
    return mad / median <= TEMPO_MAX_SPREAD ? median : null;
  }

  /**
   * Fills in a swap the camera missed. Only ever runs where there is nothing to
   * contradict it, and stops after `MAX_PREDICTED_RUN` in a row so a player who
   * simply stopped doesn't keep scoring.
   */
  private predict(now: number): { swapped: boolean; scored: boolean; at: number } {
    const still = { swapped: false, scored: false, at: now };
    if (!this.config.prediction || this.side === null) return still;
    if (this.predictedRun >= MAX_PREDICTED_RUN) return still;

    const period = this.period;
    if (period === null) return still;

    const due = this.lastSwapAt + period;
    if (now < due + period * PREDICT_GRACE) return still;

    this.side = this.side === "L" ? "R" : "L";
    // Advance to the beat rather than to now, so predictions stay in phase and
    // a late real swap can still land on the next one.
    this.lastSwapAt = due;
    this.predictedRun += 1;
    this.swaps += 1;
    // A guessed swing is no evidence of how far the hands travelled.
    this.peak = 0;

    if (this.config.countMode === "swap" || this.swaps % 2 === 0) {
      this.count += 1;
      this.hits.push(due);
      return { swapped: true, scored: true, at: due };
    }
    return { swapped: true, scored: false, at: due };
  }

  /**
   * With no hands to measure, ease the reported separation toward the side the
   * tempo believes we're on, so the on-screen meter keeps moving instead of
   * freezing mid-swing.
   */
  private glide(dt: number) {
    const period = this.period;
    if (this.side === null || period === null) return;
    const target = (this.side === "R" ? 1 : -1) * this.threshold() * 1.4;
    this.signal += emaWeight(dt, period / 2) * (target - this.signal);
  }

  /** Last frame's hand positions, or null once they're too stale to match on. */
  private anchors(now: number): Anchors {
    if (this.prevLeft === null || this.prevRight === null) return null;
    if (now - this.lastSeenAt > REASSOCIATE_MS) return null;
    return { left: this.prevLeft, right: this.prevRight };
  }

  /**
   * Decides which detection is the left-hand-side hand. Matching against last
   * frame's x survives hands drifting close together, where a bare left-to-right
   * sort would flip the labels and invent a swap.
   *
   * Labels only matter in so far as they stay put — an assignment that is
   * consistently "wrong" still yields the right signal, while one that flips
   * inverts it — so re-labelling has to clear a margin, not just a tie.
   */
  private associate(
    observations: HandObservation[],
    now: number,
  ): [HandObservation, HandObservation] {
    const [a, b] = observations;
    const anchors = this.anchors(now);
    if (!anchors) return a.x <= b.x ? [a, b] : [b, a];

    const keep = xGap(a, anchors.left) + xGap(b, anchors.right);
    const swapped = xGap(b, anchors.left) + xGap(a, anchors.right);
    return swapped < keep * RELABEL_MARGIN ? [b, a] : [a, b];
  }

  /**
   * How much of each half-swing the camera is resolving, 0..1. Frame rate alone
   * doesn't say much — 30 fps is plenty for slow reps and thin for fast ones —
   * so once a tempo exists this is samples per half-swing.
   */
  private get quality() {
    const period = this.period;
    if (period === null) return clamp(this.fps / 30, 0, 1);
    return clamp((this.fps * period) / 1000 / QUALITY_SAMPLES, 0, 1);
  }

  private frame(
    scored: boolean,
    handsVisible: number,
    predicted = false,
    solo = false,
    scoredAt = this.lastFrameAt,
  ): DetectorFrame {
    return {
      count: this.count,
      scored,
      scoredAt,
      side: this.side,
      halfway: this.config.countMode === "cycle" && this.swaps % 2 === 1,
      signal: this.signal,
      threshold: this.threshold(),
      handsVisible,
      tracked: this.tracked,
      predicted,
      onBeat: this.config.prediction && this.period !== null,
      solo,
      fps: this.fps,
      quality: this.quality,
    };
  }

  /** 67s per minute over the trailing `windowMs`. */
  rate(now: number, windowMs = 4000) {
    const cutoff = now - windowMs;
    let recent = 0;
    for (let i = this.hits.length - 1; i >= 0 && this.hits[i] >= cutoff; i--) recent++;
    return (recent / windowMs) * 60000;
  }

  /** Best trailing rate seen during the run. */
  peakRate(windowMs = 4000) {
    let peak = 0;
    let start = 0;
    for (let i = 0; i < this.hits.length; i++) {
      while (this.hits[i] - this.hits[start] > windowMs) start++;
      peak = Math.max(peak, ((i - start + 1) / windowMs) * 60000);
    }
    return peak;
  }
}

function dist2(p: { x: number; y: number }, q: { x: number; y: number }) {
  return (p.x - q.x) ** 2 + (p.y - q.y) ** 2;
}

function gap(p: { x: number; y: number }, q: { x: number; y: number }) {
  return Math.sqrt(dist2(p, q));
}

/**
 * Horizontal distance, which is the only honest evidence of *which hand is
 * which*.
 *
 * Matching hands to last frame's positions in 2D looks reasonable and is
 * catastrophically wrong for this gesture. The hands travel vertically and sit
 * a fixed distance apart horizontally, so once the vertical travel exceeds the
 * horizontal gap between the hands, a hand at the top of its swing is *closer*
 * to where its partner was than to where it was itself. The labels swap, the
 * signal inverts, and the count stops dead — the bigger the rep, the worse it
 * gets. Which is exactly backwards from what a player expects.
 */
function xGap(p: { x: number }, q: { x: number }) {
  return Math.abs(p.x - q.x);
}

/**
 * Picks the two hands most likely to be the player's when the camera sees more
 * than two — a bystander, someone walking behind, a hand in a mirror.
 *
 * A pair scores well when both hands are large (apparent palm size is a direct
 * proxy for distance from the camera), when the two are a similar size (one
 * person's hands sit at roughly one distance, so a big hand paired with a
 * distant one is probably two different people), and when it matches whatever
 * was being tracked a moment ago.
 *
 * `anchors` is last frame's pair, or null when there is nothing to stick to.
 */
export function selectPair(
  observations: HandObservation[],
  anchors: Anchors = null,
): HandObservation[] {
  if (observations.length <= 2) return observations.slice();

  let maxScale = 0;
  for (const o of observations) maxScale = Math.max(maxScale, o.scale);
  if (maxScale <= 0) return observations.slice(0, 2);

  let best: HandObservation[] = observations.slice(0, 2);
  let bestScore = -Infinity;

  for (let i = 0; i < observations.length; i++) {
    for (let j = i + 1; j < observations.length; j++) {
      const a = observations[i];
      const b = observations[j];
      let score =
        (a.scale + b.scale) / (2 * maxScale) -
        SIZE_MISMATCH_PENALTY * (Math.abs(a.scale - b.scale) / maxScale);

      if (anchors) {
        // Either assignment of this pair to last frame's slots will do.
        const straight = gap(a, anchors.left) + gap(b, anchors.right);
        const crossed = gap(b, anchors.left) + gap(a, anchors.right);
        const moved = Math.min(straight, crossed);
        score += CONTINUITY_BONUS * Math.max(0, 1 - moved / CONTINUITY_RADIUS);
      }

      if (score > bestScore) {
        bestScore = score;
        best = [a, b];
      }
    }
  }

  return best;
}

/** MediaPipe hand landmark indices that bound the palm. */
const PALM_POINTS = [0, 5, 9, 13, 17];
const WRIST = 0;
const MIDDLE_MCP = 9;

/**
 * Reduces raw landmarks to one palm centre and palm length per hand.
 *
 * `aspect` (frame width / height) converts x into the same units as y, so the
 * palm length stays constant as the hand rotates.
 */
export function observeHands(
  hands: { x: number; y: number }[][],
  aspect: number,
): HandObservation[] {
  const out: HandObservation[] = [];
  hands.forEach((hand, index) => {
    if (hand.length < 21) return;
    let x = 0;
    let y = 0;
    for (const i of PALM_POINTS) {
      x += hand[i].x;
      y += hand[i].y;
    }
    const dx = (hand[MIDDLE_MCP].x - hand[WRIST].x) * aspect;
    const dy = hand[MIDDLE_MCP].y - hand[WRIST].y;
    out.push({
      index,
      x: x / PALM_POINTS.length,
      y: y / PALM_POINTS.length,
      scale: Math.hypot(dx, dy),
    });
  });
  return out;
}

/* ------------------------------------------------------------------- pose */

/** MediaPipe pose landmark indices. */
const L_SHOULDER = 11;
const R_SHOULDER = 12;
const L_WRIST = 15;
const R_WRIST = 16;
const L_HIP = 23;
const R_HIP = 24;

/** A wrist the model is less sure about than this is treated as out of frame. */
const WRIST_VISIBILITY = 0.45;
/**
 * A torso is about five palm lengths, so scaling the torso by this keeps every
 * threshold in the palm-length units the settings were tuned in.
 */
const TORSO_TO_PALM = 0.2;
/** Fallback when the hips are out of shot: shoulder width ≈ 0.55 torso. */
const SHOULDERS_TO_TORSO = 1.8;

interface PoseLandmark {
  x: number;
  y: number;
  visibility?: number;
}

/**
 * Reduces a 33-point body to the two wrists, scaled by the torso.
 *
 * Pose landmarks are always emitted, even for a wrist far out of frame, so
 * each is gated on the model's own visibility score; a wrist below the bar is
 * simply not returned and the detector treats it as a hand it can't see.
 *
 * `aspect` (frame width / height) converts x into the same units as y, so the
 * torso length holds as the player turns.
 */
export function observePose(pose: PoseLandmark[] | undefined, aspect: number): HandObservation[] {
  if (!pose || pose.length < 25) return [];
  const span = (a: PoseLandmark, b: PoseLandmark) =>
    Math.hypot((a.x - b.x) * aspect, a.y - b.y);
  const seen = (p: PoseLandmark, min: number) => (p.visibility ?? 1) >= min;

  const ls = pose[L_SHOULDER];
  const rs = pose[R_SHOULDER];
  const lh = pose[L_HIP];
  const rh = pose[R_HIP];
  if (!seen(ls, 0.3) || !seen(rs, 0.3)) return [];

  // Torso length: shoulder midpoint to hip midpoint. Hips are often below the
  // bottom edge at a desk, so fall back to shoulder width when they're gone.
  let torso: number;
  if (seen(lh, 0.3) && seen(rh, 0.3)) {
    torso = span(
      { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 },
      { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 },
    );
  } else {
    torso = span(ls, rs) * SHOULDERS_TO_TORSO;
  }
  const scale = Math.max(MIN_SCALE, torso * TORSO_TO_PALM);

  const out: HandObservation[] = [];
  const wrists: [number, PoseLandmark][] = [
    [L_WRIST, pose[L_WRIST]],
    [R_WRIST, pose[R_WRIST]],
  ];
  for (const [index, w] of wrists) {
    if (!seen(w, WRIST_VISIBILITY)) continue;
    if (w.x < -0.05 || w.x > 1.05 || w.y < -0.05 || w.y > 1.05) continue;
    out.push({ index, x: w.x, y: w.y, scale });
  }
  return out;
}
