"use client";

/**
 * Persistence layer. Everything lives in localStorage — no server, no account.
 * Both keys are versioned so a future schema change can migrate instead of crash.
 */

export type CountMode = "cycle" | "swap";

export interface Settings {
  /** Pre-filled on the results screen when saving a score. */
  playerName: string;
  roundSeconds: number;
  /**
   * How far apart the hands must travel before a swap registers, measured in
   * palm lengths so the same value works at any distance from the camera.
   * Lower = twitchier, higher = you have to commit.
   */
  sensitivity: number;
  /** Landmark smoothing, 0 (raw) to 1 (heaviest). Trades lag for steadiness. */
  smoothing: number;
  /** "cycle" = a full six-seven (two swaps). "swap" = every hand alternation. */
  countMode: CountMode;
  mirror: boolean;
  showSkeleton: boolean;
  sound: boolean;
  countdownSeconds: number;
  /** Minimum ms between two swaps — kills landmark jitter double-counts. */
  cooldownMs: number;
  deviceId: string | null;
}

export interface ScoreEntry {
  id: string;
  name: string;
  score: number;
  roundSeconds: number;
  /** Best 67s-per-minute rate hit during the round. */
  peakRate: number;
  countMode: CountMode;
  date: string;
}

export const DEFAULT_SETTINGS: Settings = {
  playerName: "",
  roundSeconds: 30,
  sensitivity: 0.55,
  smoothing: 0.35,
  countMode: "cycle",
  mirror: true,
  showSkeleton: true,
  sound: true,
  countdownSeconds: 3,
  cooldownMs: 90,
  deviceId: null,
};

const SETTINGS_KEY = "sixtyseven.settings.v2";
/** v1 measured sensitivity in frame heights; v2 measures it in palm lengths. */
const LEGACY_SETTINGS_KEY = "sixtyseven.settings.v1";
const BOARD_KEY = "sixtyseven.leaderboard.v1";
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
    // Private mode / quota — the round still plays, it just won't be remembered.
  }
  window.dispatchEvent(new CustomEvent(event));
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

export function loadSettings(): Settings {
  const current = readJSON<Partial<Settings>>(SETTINGS_KEY);
  const stored = current ?? readJSON<Partial<Settings>>(LEGACY_SETTINGS_KEY);
  if (!stored) return { ...DEFAULT_SETTINGS };
  // Everything in a v1 record carries over except sensitivity, which was in
  // frame heights — reusing that number would give a wildly twitchy threshold.
  const migrating = current === null;
  return {
    playerName:
      typeof stored.playerName === "string" ? stored.playerName.slice(0, 20) : DEFAULT_SETTINGS.playerName,
    roundSeconds: clamp(Number(stored.roundSeconds) || DEFAULT_SETTINGS.roundSeconds, 5, 300),
    sensitivity: migrating
      ? DEFAULT_SETTINGS.sensitivity
      : clamp(Number(stored.sensitivity) || DEFAULT_SETTINGS.sensitivity, 0.15, 1.5),
    smoothing: clamp(Number(stored.smoothing ?? DEFAULT_SETTINGS.smoothing), 0, 1),
    countMode: stored.countMode === "swap" ? "swap" : "cycle",
    mirror: stored.mirror ?? DEFAULT_SETTINGS.mirror,
    showSkeleton: stored.showSkeleton ?? DEFAULT_SETTINGS.showSkeleton,
    sound: stored.sound ?? DEFAULT_SETTINGS.sound,
    countdownSeconds: clamp(Number(stored.countdownSeconds ?? DEFAULT_SETTINGS.countdownSeconds), 0, 10),
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
    .filter((e) => e && typeof e.score === "number" && Number.isFinite(e.score))
    .sort(sortEntries);
}

/** Newest wins a tie so a fresh personal best visibly moves up the board. */
function sortEntries(a: ScoreEntry, b: ScoreEntry) {
  if (b.score !== a.score) return b.score - a.score;
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

/** Where `score` would land on the current board, 1-indexed, without saving. */
export function projectedRank(board: ScoreEntry[], score: number) {
  return board.filter((e) => e.score > score).length + 1;
}
