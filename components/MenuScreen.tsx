"use client";

import Link from "next/link";
import Leaderboard from "./Leaderboard";
import { AnniversaryMark, Contributors } from "./Logo";
import { formatTime, type ScoreEntry, type Settings } from "@/lib/storage";

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
    <div className="animate-rise flex h-full w-full flex-col items-center justify-center gap-6 overflow-y-auto scroll-thin px-5 py-8">
      <header className="flex flex-col items-center text-center">
        <AnniversaryMark size={138} priority />
        <p className="mt-4 text-[10px] font-semibold uppercase tracking-[0.42em] text-[#e0bc7c]">
          125th anniversary · 1901–2026
        </p>
        <h1 className="glow-text mt-2 bg-gradient-to-b from-white via-[#f4e6c9] to-[#d3a860] bg-clip-text text-6xl font-black leading-none tracking-tighter text-transparent sm:text-7xl">
          6 · 7
        </h1>
        <p className="mt-1 font-mono text-lg font-black tracking-[0.35em] text-white/55">
          ×{settings.target}
        </p>
        <p className="mt-3 max-w-sm text-sm leading-relaxed text-white/60">
          Palms up, both hands in frame. Rock them like a scale — up, down, up.
          The camera counts{" "}
          {settings.countMode === "swap" ? "every move" : "every six-seven you land"}; the
          clock stops on {settings.target}. Fastest time takes the board.
        </p>
      </header>

      <div className="flex flex-col items-center gap-3">
        <button
          type="button"
          onClick={onStart}
          disabled={!canStart}
          className="glow-ring group relative rounded-full bg-gradient-to-r from-[#3a4bbf] via-[#5d6fe3] to-[#e4454f] px-14 py-4 text-lg font-black uppercase tracking-[0.2em] text-white transition enabled:hover:scale-[1.03] enabled:active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Start
        </button>

        <p className="h-5 text-xs text-white/45">
          {!canStart ? (
            "Waiting for the camera…"
          ) : handsVisible >= 2 ? (
            <span className="text-[#8f9cf0]">Both hands detected — go.</span>
          ) : (
            `Race to ${settings.target} · show both hands to the camera`
          )}
        </p>
      </div>

      <section className="panel w-full max-w-md rounded-2xl p-5">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-xs font-bold uppercase tracking-[0.25em] text-white/55">Leaderboard</h2>
          {best && (
            <span className="text-xs text-white/40">
              best <span className="font-mono font-bold text-[#e0bc7c]">{formatTime(best.timeMs)}</span> by{" "}
              {best.name}
            </span>
          )}
        </div>
        <Leaderboard entries={board} limit={6} />
      </section>

      <Contributors />

      <Link
        href="/settings"
        className="rounded-full border border-white/15 px-5 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white/65 transition hover:border-[#e0bc7c]/50 hover:text-white"
      >
        Settings
      </Link>
    </div>
  );
}
