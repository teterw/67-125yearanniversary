"use client";

import { useMemo, useState } from "react";
import Leaderboard from "./Leaderboard";
import { AnniversaryMark } from "./Logo";
import { formatTime, projectedRank, unitLabel, type CountMode, type ScoreEntry } from "@/lib/storage";

export interface RunResult {
  /** Time to the target, in milliseconds. Only meaningful when `completed`. */
  timeMs: number;
  target: number;
  /** Six-sevens landed — equal to `target` on a completed run. */
  count: number;
  /** False when the run was stopped before reaching the target. */
  completed: boolean;
  peakRate: number;
  countMode: CountMode;
}

interface Props {
  run: RunResult;
  /** Board as it stood before this run was saved. */
  board: ScoreEntry[];
  defaultName: string;
  saved: { id: string; rank: number; board: ScoreEntry[] } | null;
  onSave: (name: string) => void;
  onPlayAgain: () => void;
  onMenu: () => void;
}

const PENDING_ID = "__pending";

/** A shortfall, worded as a duration — "1.20s" under a minute, "1:04.30" over. */
function gapLabel(ms: number) {
  const text = formatTime(ms);
  return ms < 60000 ? `${text}s` : text;
}

export default function ResultsScreen({
  run,
  board,
  defaultName,
  saved,
  onSave,
  onPlayAgain,
  onMenu,
}: Props) {
  const [name, setName] = useState(defaultName);
  const unit = unitLabel(run.countMode);

  const rank = saved ? saved.rank : projectedRank(board, run.timeMs);
  const leader = board[0];
  /** Average 67s per minute across the whole run. */
  const average = run.timeMs > 0 ? (run.count / run.timeMs) * 60000 : 0;

  // Before saving, slot a ghost row in at the position this time would take.
  const display = useMemo(() => {
    if (saved) return saved.board;
    const ghost: ScoreEntry = {
      id: PENDING_ID,
      name: name.trim() || "You",
      timeMs: run.timeMs,
      target: run.target,
      peakRate: run.peakRate,
      countMode: run.countMode,
      date: new Date().toISOString(),
    };
    const next = [...board];
    next.splice(rank - 1, 0, ghost);
    return next;
  }, [saved, board, name, run, rank]);

  const headline = (() => {
    if (!run.completed) {
      return run.count === 0 ? `No ${unit} landed.` : `Stopped at ${run.count} of ${run.target}.`;
    }
    if (rank === 1) return leader ? "New record — fastest on the board." : "First on the board.";
    if (leader) return `${gapLabel(run.timeMs - leader.timeMs)} behind ${leader.name}.`;
    return "Nice run.";
  })();

  return (
    <div className="animate-rise flex h-full w-full flex-col items-center justify-center gap-6 overflow-y-auto scroll-thin px-5 py-8">
      <div className="flex flex-col items-center text-center">
        <AnniversaryMark size={64} className="mb-3" />
        <p className="text-[11px] font-semibold uppercase tracking-[0.42em] text-white/45">
          {run.completed ? `${run.target} ${unit}` : "Unfinished"}
        </p>
        <p
          className={`glow-text mt-1 bg-gradient-to-b bg-clip-text font-mono text-7xl font-black leading-none tabular-nums text-transparent sm:text-8xl ${
            run.completed ? "from-white via-[#f4e6c9] to-[#d3a860]" : "from-white/70 to-white/30"
          }`}
        >
          {run.completed ? formatTime(run.timeMs) : `${run.count}/${run.target}`}
        </p>
        <p className="mt-1 text-xs font-bold uppercase tracking-[0.35em] text-white/50">
          {run.completed ? "finish time" : unit}
        </p>
        <p className="mt-4 text-base font-semibold text-white/85">{headline}</p>
      </div>

      {run.completed && (
        <div className="grid w-full max-w-md grid-cols-3 gap-2.5">
          <Stat label="Rank" value={`#${rank}`} accent="#e0bc7c" />
          <Stat label="Average" value={`${Math.round(average)}/min`} accent="#5d6fe3" />
          <Stat label="Peak" value={`${Math.round(run.peakRate)}/min`} accent="#e4454f" />
        </div>
      )}

      <section className="panel w-full max-w-md rounded-2xl p-5">
        <h2 className="mb-3 text-xs font-bold uppercase tracking-[0.25em] text-white/55">
          {saved || !run.completed ? "Leaderboard" : "Where you'd land"}
        </h2>
        <Leaderboard
          entries={run.completed ? display : board}
          limit={8}
          highlightId={saved ? saved.id : PENDING_ID}
          emptyLabel="Nothing on the board yet."
        />
      </section>

      {!run.completed ? (
        <p className="max-w-md text-center text-sm text-white/50">
          Only finished runs go on the board — the clock has to stop on {run.target}.
        </p>
      ) : saved ? (
        <p className="text-sm text-[#5d6fe3]">Saved to the leaderboard.</p>
      ) : (
        <form
          className="flex w-full max-w-md gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            onSave(name);
          }}
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={20}
            placeholder="Your name"
            aria-label="Your name"
            autoComplete="off"
            className="min-w-0 flex-1 rounded-full border border-white/15 bg-white/5 px-5 py-3 text-sm outline-none transition placeholder:text-white/30 focus:border-[#5d6fe3]/70"
          />
          <button
            type="submit"
            className="shrink-0 rounded-full bg-gradient-to-r from-[#3a4bbf] via-[#5d6fe3] to-[#e4454f] px-6 py-3 text-sm font-black uppercase tracking-[0.15em] text-white transition hover:scale-[1.03] active:scale-95"
          >
            Save
          </button>
        </form>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onPlayAgain}
          className="rounded-full bg-white/10 px-7 py-2.5 text-xs font-bold uppercase tracking-[0.2em] transition hover:bg-white/20"
        >
          {run.completed ? "Race again" : "Try again"}
        </button>
        <button
          type="button"
          onClick={onMenu}
          className="rounded-full border border-white/15 px-7 py-2.5 text-xs font-bold uppercase tracking-[0.2em] text-white/65 transition hover:border-white/35 hover:text-white"
        >
          Menu
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="panel rounded-xl px-3 py-3 text-center">
      <p className="text-[9px] uppercase tracking-[0.2em] text-white/40">{label}</p>
      <p className="mt-1 font-mono text-xl font-black tabular-nums" style={{ color: accent }}>
        {value}
      </p>
    </div>
  );
}
