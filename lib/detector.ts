import type { CountMode } from "./storage";

/**
 * Counts "six-sevens" from two-handed landmark data.
 *
 * The gesture is the scale-weighing motion: palms up, one hand rises while the
 * other drops, then they trade places. We reduce each hand to a palm centre and
 * watch which one is on top. Every change of the top hand is a swap; a full
 * six-seven is two swaps (up on "six", back on "seven").
 *
 * Three things keep that honest across real conditions:
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
 * On top of that, `prediction` keeps the count on the beat. Once a steady tempo
 * is established, a swap that is overdue while the camera has nothing useful to
 * say — hands out of frame, or the signal sitting in the dead zone — is counted
 * anyway. Motion blur and dropped frames stop showing up as missed reps.
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
}

export type Side = "L" | "R";

export interface DetectorFrame {
  count: number;
  /** True on the frame a point was awarded. */
  scored: boolean;
  /** Which hand is currently on top, or null before the first lock-on. */
  side: Side | null;
  /** 0..1 progress through the current six-seven (cycle mode only). */
  halfway: boolean;
  /** Baselined separation in palm lengths; positive means the right hand is up. */
  signal: number;
  handsVisible: number;
  /** The hands actually being counted, after the closest-pair filter. */
  tracked: HandObservation[];
  /** This frame's swap came from the tempo, not from the camera. */
  predicted: boolean;
  /** A usable tempo is established, so prediction can step in if needed. */
  onBeat: boolean;
}

export type Anchors = { left: HandObservation; right: HandObservation } | null;

export interface HandObservation {
  /** Index back into the landmark array this came from. */
  index: number;
  x: number;
  y: number;
  /** Palm length, in frame-height units — the reference for every threshold. */
  scale: number;
}

/** Guards against a divide-by-zero when a hand is detected almost edge-on. */
const MIN_SCALE = 0.015;
/** Hands gone this long: drop the baseline rather than invent a swap on return. */
const STALE_MS = 700;
/** Beyond this gap, last frame's positions are too old to match against. */
const REASSOCIATE_MS = 350;
const BASELINE_TAU_MS = 2500;
const SMOOTHING_MAX_TAU_MS = 120;

/** Swap intervals kept for the tempo estimate. */
const TEMPO_WINDOW = 6;
/** Below three intervals there is no tempo, only a coincidence. */
const TEMPO_MIN_SAMPLES = 3;
/** Spread across the window, relative to the median, before the tempo is junk. */
const TEMPO_MAX_SPREAD = 0.6;
/** Gaps outside this band aren't part of a rhythm. */
const TEMPO_MIN_MS = 60;
const TEMPO_MAX_MS = 2000;
/** How overdue a swap must be before the tempo fills it in. */
const PREDICT_GRACE = 0.35;
/** Consecutive predictions allowed before real evidence is required again. */
const MAX_PREDICTED_RUN = 2;

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

export class SixtySevenDetector {
  private config: DetectorConfig;
  private yLeft: number | null = null;
  private yRight: number | null = null;
  private baseline: number | null = null;
  private prevLeft: HandObservation | null = null;
  private prevRight: HandObservation | null = null;
  private side: Side | null = null;
  private swaps = 0;
  private lastSwapAt = 0;
  private lastFrameAt = 0;
  private lastSeenAt = 0;
  private signal = 0;
  private tracked: HandObservation[] = [];
  /** Intervals between recent camera-confirmed swaps, for the tempo estimate. */
  private intervals: number[] = [];
  private predictedRun = 0;
  /** Timestamps of awarded points, for the live and peak rate readouts. */
  private hits: number[] = [];

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
    this.count = 0;
  }

  /** Drops tracking state but keeps the score. */
  private forget() {
    this.yLeft = null;
    this.yRight = null;
    this.baseline = null;
    this.prevLeft = null;
    this.prevRight = null;
    this.side = null;
    this.swaps = 0;
    this.signal = 0;
    this.predictedRun = 0;
    this.tracked = [];
  }

  update(observations: HandObservation[], now: number): DetectorFrame {
    const dt = this.lastFrameAt === 0 ? 16 : Math.min(250, now - this.lastFrameAt);
    this.lastFrameAt = now;

    // Ignore everyone else in shot before deciding anything.
    const pair = selectPair(observations, this.anchors(now));
    this.tracked = pair;

    if (pair.length < 2) {
      // A hand blinking out mid-rep shouldn't cost the rep, but a long absence
      // means the next reading is unrelated to the last one.
      if (this.lastSeenAt > 0 && now - this.lastSeenAt > STALE_MS) this.forget();
      const guess = this.predict(now);
      this.glide(dt);
      return this.frame(guess.scored, pair.length, guess.swapped);
    }

    const [left, right] = this.associate(pair, now);
    this.lastSeenAt = now;
    this.prevLeft = left;
    this.prevRight = right;

    const scale = Math.max(MIN_SCALE, (left.scale + right.scale) / 2);
    const k = emaWeight(dt, this.config.smoothing * SMOOTHING_MAX_TAU_MS);
    this.yLeft = this.yLeft === null ? left.y : this.yLeft + k * (left.y - this.yLeft);
    this.yRight = this.yRight === null ? right.y : this.yRight + k * (right.y - this.yRight);

    // Positive = the right-hand-side hand is higher (y grows downward).
    const raw = (this.yLeft - this.yRight) / scale;
    const bk = emaWeight(dt, BASELINE_TAU_MS);
    this.baseline = this.baseline === null ? raw : this.baseline + bk * (raw - this.baseline);
    this.signal = raw - this.baseline;

    const { sensitivity, cooldownMs, countMode } = this.config;
    let next: Side | null = this.side;
    if (this.signal > sensitivity) next = "R";
    else if (this.signal < -sensitivity) next = "L";

    let scored = false;
    let predicted = false;

    if (next !== null && next !== this.side) {
      if (this.side === null) {
        // First lock-on establishes which side we started on — no point yet.
        this.side = next;
      } else if (now - this.lastSwapAt >= cooldownMs) {
        this.noteTempo(now);
        this.side = next;
        this.lastSwapAt = now;
        this.swaps += 1;
        if (countMode === "swap" || this.swaps % 2 === 0) {
          this.count += 1;
          this.hits.push(now);
          scored = true;
        }
      }
    } else if (Math.abs(this.signal) < sensitivity) {
      // The hands are mid-flight and the camera can't call it. If a swap is
      // overdue against the established tempo, the rhythm calls it instead.
      const guess = this.predict(now);
      scored = guess.scored;
      predicted = guess.swapped;
    }

    return this.frame(scored, 2, predicted);
  }

  /** Records the gap since the last swap, so the tempo tracks the player. */
  private noteTempo(now: number) {
    const gap = now - this.lastSwapAt;
    if (this.lastSwapAt > 0 && gap >= TEMPO_MIN_MS && gap <= TEMPO_MAX_MS) {
      this.intervals.push(gap);
      if (this.intervals.length > TEMPO_WINDOW) this.intervals.shift();
    } else {
      // A long pause means the old tempo no longer describes what's happening.
      this.intervals = [];
    }
    this.predictedRun = 0;
  }

  /** Median swap interval, or null when the tempo is too ragged to trust. */
  private get period(): number | null {
    if (this.intervals.length < TEMPO_MIN_SAMPLES) return null;
    const sorted = [...this.intervals].sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1];
    if (median <= 0) return null;
    const spread = (sorted[sorted.length - 1] - sorted[0]) / median;
    return spread <= TEMPO_MAX_SPREAD ? median : null;
  }

  /**
   * Fills in a swap the camera missed. Only ever runs where there is nothing to
   * contradict it, and stops after `MAX_PREDICTED_RUN` in a row so a player who
   * simply stopped doesn't keep scoring.
   */
  private predict(now: number): { swapped: boolean; scored: boolean } {
    const still = { swapped: false, scored: false };
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

    if (this.config.countMode === "swap" || this.swaps % 2 === 0) {
      this.count += 1;
      this.hits.push(now);
      return { swapped: true, scored: true };
    }
    return { swapped: true, scored: false };
  }

  /**
   * With no hands to measure, ease the reported separation toward the side the
   * tempo believes we're on, so the on-screen meter keeps moving instead of
   * freezing mid-swing.
   */
  private glide(dt: number) {
    const period = this.period;
    if (this.side === null || period === null) return;
    const target = (this.side === "R" ? 1 : -1) * this.config.sensitivity * 1.4;
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
   * frame's positions survives hands drifting close together, where sorting on
   * x alone would flip the labels and invent a swap.
   */
  private associate(observations: HandObservation[], now: number): [HandObservation, HandObservation] {
    const [a, b] = observations;
    const anchors = this.anchors(now);
    if (!anchors) return a.x <= b.x ? [a, b] : [b, a];

    const keep = dist2(a, anchors.left) + dist2(b, anchors.right);
    const swapped = dist2(b, anchors.left) + dist2(a, anchors.right);
    return keep <= swapped ? [a, b] : [b, a];
  }

  private frame(scored: boolean, handsVisible: number, predicted = false): DetectorFrame {
    return {
      count: this.count,
      scored,
      side: this.side,
      halfway: this.config.countMode === "cycle" && this.swaps % 2 === 1,
      signal: this.signal,
      handsVisible,
      tracked: this.tracked,
      predicted,
      onBeat: this.config.prediction && this.period !== null,
    };
  }

  /** 67s per minute over the trailing `windowMs`. */
  rate(now: number, windowMs = 4000) {
    const cutoff = now - windowMs;
    let recent = 0;
    for (let i = this.hits.length - 1; i >= 0 && this.hits[i] >= cutoff; i--) recent++;
    return (recent / windowMs) * 60000;
  }

  /** Best trailing rate seen during the round. */
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
