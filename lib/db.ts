import { neon } from "@neondatabase/serverless";
import type { CountMode, ScoreEntry } from "./storage";

/**
 * Server-only Neon access for the shared leaderboard. One table, created on
 * first use so a fresh database needs no migration step.
 */

const MAX_ENTRIES = 100;

function sql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return neon(url);
}

let ready: Promise<void> | null = null;

function ensureTable() {
  ready ??= (async () => {
    await sql()`
      CREATE TABLE IF NOT EXISTS scores (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        time_ms    INTEGER NOT NULL,
        target     INTEGER NOT NULL,
        peak_rate  REAL NOT NULL DEFAULT 0,
        count_mode TEXT NOT NULL DEFAULT 'swap',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    await sql()`CREATE INDEX IF NOT EXISTS scores_time_idx ON scores (time_ms ASC, created_at DESC)`;
  })().catch((err) => {
    ready = null;
    throw err;
  });
  return ready;
}

interface Row {
  id: string;
  name: string;
  time_ms: number;
  target: number;
  peak_rate: number;
  count_mode: string;
  created_at: string | Date;
}

function toEntry(r: Row): ScoreEntry {
  return {
    id: r.id,
    name: r.name,
    timeMs: r.time_ms,
    target: r.target,
    peakRate: r.peak_rate,
    countMode: r.count_mode === "cycle" ? "cycle" : "swap",
    date: new Date(r.created_at).toISOString(),
  };
}

/** Fastest first; newest wins a tie so a fresh personal best visibly moves up. */
export async function listScores(): Promise<ScoreEntry[]> {
  await ensureTable();
  const rows = (await sql()`
    SELECT * FROM scores ORDER BY time_ms ASC, created_at DESC LIMIT ${MAX_ENTRIES}
  `) as Row[];
  return rows.map(toEntry);
}

export async function insertScore(input: {
  name: string;
  timeMs: number;
  target: number;
  peakRate: number;
  countMode: CountMode;
}): Promise<ScoreEntry> {
  await ensureTable();
  const id = crypto.randomUUID();
  const rows = (await sql()`
    INSERT INTO scores (id, name, time_ms, target, peak_rate, count_mode)
    VALUES (${id}, ${input.name}, ${Math.round(input.timeMs)}, ${input.target}, ${input.peakRate}, ${input.countMode})
    RETURNING *
  `) as Row[];
  return toEntry(rows[0]);
}

export async function deleteScore(id: string) {
  await ensureTable();
  await sql()`DELETE FROM scores WHERE id = ${id}`;
}

export async function deleteAllScores() {
  await ensureTable();
  await sql()`DELETE FROM scores`;
}
