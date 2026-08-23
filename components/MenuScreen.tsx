"use client";

import Link from "next/link";
import Leaderboard from "./Leaderboard";
import type { ScoreEntry, Settings } from "@/lib/storage";

interface Props {
  settings: Settings;
  board: ScoreEntry[];
  onStart: () => void;
  canStart: boolean;
  handsVisible: number;
}

export default function MenuScreen({ settings, board, onStart, canStart, handsVisible }: Props) {
  const best = board[0];

  return (
    <div className="animate-rise flex h-full w-full flex-col items-center justify-center gap-7 overflow-y-auto scroll-thin px-5 py-8">
      <header className="text-center">
        <p className="text-[11px] font-semibold uppercase tracking-[0.42em] text-white/45">
          Anniversary Edition
        </p>
        <h1 className="glow-text mt-2 bg-gradient-to-b from-white via-[#c8f6ff] to-[#22e0ff] bg-clip-text text-7xl font-black leading-none tracking-tighter text-transparent sm:text-8xl">
          6 · 7
        </h1>
        <p className="mt-3 max-w-sm text-sm leading-relaxed text-white/60">
          Palms up, both hands in frame. Rock them like a scale — up, down, up —
          and the camera counts every six-seven you land.
        </p>
      </header>

      <div className="flex flex-col items-center gap-3">
        <button
          type="button"
          onClick={onStart}
          disabled={!canStart}
          className="glow-ring group relative rounded-full bg-gradient-to-r from-[#22e0ff] to-[#ff2fb0] px-14 py-4 text-lg font-black uppercase tracking-[0.2em] text-[#05050a] transition enabled:hover:scale-[1.03] enabled:active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Start
        </button>

        <p className="h-5 text-xs text-white/45">
          {!canStart ? (
            "Waiting for the camera…"
          ) : handsVisible >= 2 ? (
            <span className="text-[#22e0ff]">Both hands detected — go.</span>
          ) : (
            `${settings.roundSeconds}s round · show both hands to the camera`
          )}
        </p>
      </div>

      <section className="panel w-full max-w-md rounded-2xl p-5">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-xs font-bold uppercase tracking-[0.25em] text-white/55">Leaderboard</h2>
          {best && (
            <span className="text-xs text-white/40">
              best <span className="font-mono font-bold text-[#ffd23f]">{best.score}</span> by {best.name}
            </span>
          )}
        </div>
        <Leaderboard entries={board} limit={6} />
      </section>

      <Link
        href="/settings"
        className="rounded-full border border-white/15 px-5 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white/65 transition hover:border-white/35 hover:text-white"
      >
        Settings
      </Link>
    </div>
  );
}
