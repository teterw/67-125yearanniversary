"use client";

import { useMemo, useState } from "react";
import Leaderboard from "./Leaderboard";
import { projectedRank, type CountMode, type ScoreEntry } from "@/lib/storage";

export interface RunResult {
  score: number;
  roundSeconds: number;
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

  const rank = saved ? saved.rank : projectedRank(board, run.score);
  const leader = board[0];
  const beaten = board.filter((e) => e.score < run.score).length;

  // Before saving, slot a ghost row in at the position this run would take.
  const display = useMemo(() => {
    if (saved) return saved.board;
    const ghost: ScoreEntry = {
      id: PENDING_ID,
      name: name.trim() || "You",
      score: run.score,
      roundSeconds: run.roundSeconds,
      peakRate: run.peakRate,
      countMode: run.countMode,
      date: new Date().toISOString(),
    };
    const next = [...board];
    next.splice(rank - 1, 0, ghost);
    return next;
  }, [saved, board, name, run, rank]);

  const headline = (() => {
    if (run.score === 0) return "No six-sevens landed.";
    if (rank === 1) return leader ? "New record — top of the board." : "First on the board.";
    if (leader) {
      const gap = leader.score - run.score;
      return `${gap} short of ${leader.name}'s ${leader.score}.`;
    }
    return "Nice run.";
  })();

  return (
    <div className="animate-rise flex h-full w-full flex-col items-center justify-center gap-6 overflow-y-auto scroll-thin px-5 py-8">
      <div className="text-center">
        <p className="text-[11px] font-semibold uppercase tracking-[0.42em] text-white/45">
          {run.roundSeconds}s round
        </p>
        <p className="glow-text mt-1 bg-gradient-to-b from-white to-[#22e0ff] bg-clip-text font-mono text-8xl font-black leading-none tabular-nums text-transparent">
          {run.score}
        </p>
        <p className="mt-1 text-xs font-bold uppercase tracking-[0.35em] text-white/50">six-sevens</p>
        <p className="mt-4 text-base font-semibold text-white/85">{headline}</p>
      </div>

      <div className="grid w-full max-w-md grid-cols-3 gap-2.5">
        <Stat label="Rank" value={`#${rank}`} accent="#ffd23f" />
        <Stat label="Peak pace" value={`${Math.round(run.peakRate)}/min`} accent="#22e0ff" />
        <Stat label="Beaten" value={`${beaten}`} accent="#ff2fb0" />
      </div>

      <section className="panel w-full max-w-md rounded-2xl p-5">
        <h2 className="mb-3 text-xs font-bold uppercase tracking-[0.25em] text-white/55">
          {saved ? "Leaderboard" : "Where you'd land"}
        </h2>
        <Leaderboard
          entries={display}
          limit={8}
          highlightId={saved ? saved.id : PENDING_ID}
          emptyLabel="Nothing on the board yet."
        />
      </section>

      {saved ? (
        <p className="text-sm text-[#22e0ff]">Saved to the leaderboard.</p>
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
            className="min-w-0 flex-1 rounded-full border border-white/15 bg-white/5 px-5 py-3 text-sm outline-none transition placeholder:text-white/30 focus:border-[#22e0ff]/70"
          />
          <button
            type="submit"
            className="shrink-0 rounded-full bg-gradient-to-r from-[#22e0ff] to-[#ff2fb0] px-6 py-3 text-sm font-black uppercase tracking-[0.15em] text-[#05050a] transition hover:scale-[1.03] active:scale-95"
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
          Play again
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
