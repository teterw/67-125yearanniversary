"use client";

import { formatTime, type ScoreEntry } from "@/lib/storage";

const MEDALS = ["#e0bc7c", "#cfd7e3", "#e08a4a"];

function formatDate(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

interface Props {
  entries: ScoreEntry[];
  limit?: number;
  /** Highlights the row for a just-saved run. */
  highlightId?: string | null;
  emptyLabel?: string;
  onRemove?: (id: string) => void;
}

export default function Leaderboard({
  entries,
  limit = 8,
  highlightId = null,
  emptyLabel = "No times yet — the board is yours to take.",
  onRemove,
}: Props) {
  const shown = entries.slice(0, limit);

  if (shown.length === 0) {
    return (
      <p className="px-1 py-6 text-center text-sm text-white/45">{emptyLabel}</p>
    );
  }

  return (
    <ol className="scroll-thin max-h-72 space-y-1 overflow-y-auto pr-1">
      {shown.map((entry, i) => {
        const isMe = entry.id === highlightId;
        return (
          <li
            key={entry.id}
            className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition ${
              isMe ? "bg-[#5d6fe3]/15 ring-1 ring-[#5d6fe3]/60" : "bg-white/[0.04] hover:bg-white/[0.07]"
            }`}
          >
            <span
              className="w-6 shrink-0 text-right font-mono text-xs font-bold"
              style={{ color: MEDALS[i] ?? "rgba(255,255,255,0.4)" }}
            >
              {i + 1}
            </span>
            <span className="min-w-0 flex-1 truncate font-medium">
              {entry.name}
              {isMe && <span className="ml-2 text-[10px] uppercase tracking-widest text-[#5d6fe3]">you</span>}
            </span>
            <span className="shrink-0 text-[11px] tabular-nums text-white/35">
              {entry.target} · {formatDate(entry.date)}
            </span>
            <span className="w-20 shrink-0 text-right font-mono text-base font-bold tabular-nums text-white">
              {formatTime(entry.timeMs)}
            </span>
            {onRemove && (
              <button
                type="button"
                onClick={() => onRemove(entry.id)}
                aria-label={`Remove ${entry.name}'s score`}
                className="shrink-0 rounded-md px-1.5 text-white/30 transition hover:bg-red-500/20 hover:text-red-300"
              >
                ×
              </button>
            )}
          </li>
        );
      })}
    </ol>
  );
}
