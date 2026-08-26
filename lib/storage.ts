"use client";

/**
 * Persistence layer. Everything lives in localStorage — no server, no account.
 * Both keys are versioned so a future schema change can migrate instead of crash.
 */

export type CountMode = "cycle" | "swap";

/** The anniversary: 125 years, 125 six-sevens. */
export const ANNIVERSARY_TARGET = 125;

export interface Settings {
  /** Pre-filled on the results screen when saving a time. */
  playerName: string;
  /** Six-sevens to complete before the clock stops. */
  target: number;
  /**
   * How far apart the hands must travel before a swap registers, measured in
   * palm lengths so the same value works at any distance from the camera.
   * Lower = twitchier, higher = you have to commit. With `adaptive` on this is
   * the ceiling rather than a fixed bar.
   */
  sensitivity: number;
  /** Landmark smoothing, 0 (raw) to 1 (heaviest). Trades lag for steadiness. */
  smoothing: number;
  /**
   * "swap" = every hand alternation scores, which is the default: it is what a
   * player reads as "a move", and it halves what a dropped frame can cost.
   * "cycle" = a full six-seven, two swaps.
   */
  countMode: CountMode;
  mirror: boolean;
  /** Fill in swaps the camera missed, from the tempo you've established. */
  prediction: boolean;
  /** Auto-gain and one-hand tracking, for cameras that can't keep up. */
  adaptive: boolean;
  sound: boolean;
  countdownSeconds: number;
  /** Minimum ms between two swaps — kills landmark jitter double-counts. */
  cooldownMs: number;
  deviceId: string | null;
}

export interface ScoreEntry {
  id: string;
  name: string;
  /** Time taken to reach `target`, in milliseconds. Lower is better. */
  timeMs: number;
  /** Six-sevens the run was racing to — 125 for an anniversary run. */
  target: number;
  /** Best 67s-per-minute rate hit during the run. */
  peakRate: number;
  countMode: CountMode;
  date: string;
}

export const DEFAULT_SETTINGS: Settings = {
  playerName: "",
  target: ANNIVERSARY_TARGET,
  sensitivity: 0.32,
  smoothing: 0.35,
  countMode: "swap",
  mirror: true,
  prediction: true,
  adaptive: true,
  sound: true,
  countdownSeconds: 3,
  cooldownMs: 70,
  deviceId: null,
};

const SETTINGS_KEY = "sixtyseven.settings.v4";
/** v3 and older kept a count mode that is no longer the one we ship. */
const LEGACY_SETTINGS_KEYS = [
  "sixtyseven.settings.v3",
  "sixtyseven.settings.v2",
  "sixtyseven.settings.v1",
];
/** v1 held counts scored in a fixed round — not comparable with a race time. */
const BOARD_KEY = "sixtyseven.leaderboard.v2";
const MAX_ENTRIES = 100;

export const SETTINGS_EVENT = "sixtyseven:settings";
export const BOARD_EVENT = "sixtyseven:leaderboard";

function readJSON<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJSON(key: string, value: unknown, event: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode / quota — the run still plays, it just won't be remembered.
  }
  window.dispatchEvent(new CustomEvent(event));
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

export function loadSettings(): Settings {
  let from = SETTINGS_KEY;
  let stored = readJSON<Partial<Settings>>(SETTINGS_KEY);
  for (const key of LEGACY_SETTINGS_KEYS) {
    if (stored) break;
    from = key;
    stored = readJSON<Partial<Settings>>(key);
  }
  if (!stored) return { ...DEFAULT_SETTINGS };
  const migrating = from !== SETTINGS_KEY;
  // A v1 record measured sensitivity in frame heights; reusing that number as a
  // palm-length threshold would give a wildly twitchy bar, so it starts fresh.
  const legacySensitivity = from === "sixtyseven.settings.v1";
  return {
    playerName:
      typeof stored.playerName === "string"
        ? stored.playerName.slice(0, 20)
        : DEFAULT_SETTINGS.playerName,
    target: clamp(Math.round(Number(stored.target) || DEFAULT_SETTINGS.target), 1, 999),
    sensitivity: legacySensitivity
      ? DEFAULT_SETTINGS.sensitivity
      : clamp(Number(stored.sensitivity) || DEFAULT_SETTINGS.sensitivity, 0.1, 1.5),
    smoothing: clamp(Number(stored.smoothing ?? DEFAULT_SETTINGS.smoothing), 0, 1),
    // Deliberately not carried over: the default moved from "cycle" to "swap",
    // and a stored preference nobody set on purpose would hide that.
    countMode: migrating ? DEFAULT_SETTINGS.countMode : stored.countMode === "cycle" ? "cycle" : "swap",
    mirror: stored.mirror ?? DEFAULT_SETTINGS.mirror,
    prediction: stored.prediction ?? DEFAULT_SETTINGS.prediction,
    adaptive: stored.adaptive ?? DEFAULT_SETTINGS.adaptive,
    sound: stored.sound ?? DEFAULT_SETTINGS.sound,
    countdownSeconds: clamp(
      Number(stored.countdownSeconds ?? DEFAULT_SETTINGS.countdownSeconds),
      0,
      10,
    ),
    cooldownMs: clamp(Number(stored.cooldownMs) || DEFAULT_SETTINGS.cooldownMs, 30, 500),
    deviceId: typeof stored.deviceId === "string" ? stored.deviceId : null,
  };
}

export function saveSettings(settings: Settings) {
  writeJSON(SETTINGS_KEY, settings, SETTINGS_EVENT);
}

export function resetSettings(): Settings {
  const fresh = { ...DEFAULT_SETTINGS };
  saveSettings(fresh);
  return fresh;
}

export function loadLeaderboard(): ScoreEntry[] {
  const stored = readJSON<ScoreEntry[]>(BOARD_KEY);
  if (!Array.isArray(stored)) return [];
  return stored
    .filter((e) => e && typeof e.timeMs === "number" && Number.isFinite(e.timeMs) && e.timeMs > 0)
    .sort(sortEntries);
}

/** Fastest first. Newest wins a tie so a fresh personal best visibly moves up. */
function sortEntries(a: ScoreEntry, b: ScoreEntry) {
  if (a.timeMs !== b.timeMs) return a.timeMs - b.timeMs;
  return Date.parse(b.date) - Date.parse(a.date);
}

export interface SaveResult {
  board: ScoreEntry[];
  rank: number;
  entry: ScoreEntry;
}

export function saveScore(entry: Omit<ScoreEntry, "id" | "date">): SaveResult {
  const full: ScoreEntry = {
    ...entry,
    name: entry.name.trim().slice(0, 20) || "ANON",
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    date: new Date().toISOString(),
  };
  const board = [...loadLeaderboard(), full].sort(sortEntries).slice(0, MAX_ENTRIES);
  writeJSON(BOARD_KEY, board, BOARD_EVENT);
  return { board, rank: board.findIndex((e) => e.id === full.id) + 1, entry: full };
}

export function clearLeaderboard() {
  writeJSON(BOARD_KEY, [], BOARD_EVENT);
}

export function removeScore(id: string): ScoreEntry[] {
  const board = loadLeaderboard().filter((e) => e.id !== id);
  writeJSON(BOARD_KEY, board, BOARD_EVENT);
  return board;
}

/** Where `timeMs` would land on the current board, 1-indexed, without saving. */
export function projectedRank(board: ScoreEntry[], timeMs: number) {
  return board.filter((e) => e.timeMs < timeMs).length + 1;
}

/** What one count is called — the swap default counts moves, not full six-sevens. */
export function unitLabel(mode: CountMode) {
  return mode === "swap" ? "moves" : "six-sevens";
}

/**
 * Race times as `12.34` under a minute and `1:23.45` over it — short enough to
 * read at a glance, precise enough to separate two players on the same run.
 */
export function formatTime(ms: number) {
  const total = Math.max(0, ms) / 1000;
  const minutes = Math.floor(total / 60);
  const seconds = total - minutes * 60;
  if (minutes === 0) return seconds.toFixed(2);
  return `${minutes}:${seconds.toFixed(2).padStart(5, "0")}`;
}
