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
  saving: boolean;
  saveError: string | null;
  onSave: (name: string) => void;
  onPlayAgain: () => void;
  onMenu: () => void;
}

const PENDING_ID = "__pending";

/** A shortfall, worded as a duration — "1.20 วิ" under a minute, "1:04.30" over. */
function gapLabel(ms: number) {
  const text = formatTime(ms);
  return ms < 60000 ? `${text} วิ` : text;
}

export default function ResultsScreen({
  run,
  board,
  defaultName,
  saved,
  saving,
  saveError,
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
      name: name.trim() || "คุณ",
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
      return run.count === 0 ? `ยังไม่ได้สัก${unit}เลย` : `หยุดที่ ${run.count} จาก ${run.target}`;
    }
    if (rank === 1) return leader ? "สถิติใหม่ — เร็วที่สุดบนกระดาน!" : "คนแรกบนกระดาน!";
    if (leader) return `ช้ากว่า ${leader.name} อยู่ ${gapLabel(run.timeMs - leader.timeMs)}`;
    return "ทำได้ดีมาก";
  })();

  return (
    <div className="animate-rise thai flex h-full w-full flex-col items-center justify-center gap-6 overflow-y-auto scroll-thin px-5 py-8">
      <div className="flex flex-col items-center text-center">
        <AnniversaryMark size={64} className="mb-3" />
        <p className="text-sm font-medium leading-relaxed text-white/50">
          {run.completed ? `${run.target} ${unit}` : "ยังไม่จบรอบ"}
        </p>
        <p
          className={`glow-text mt-1 bg-gradient-to-b bg-clip-text font-mono text-7xl font-black leading-none tabular-nums text-transparent sm:text-8xl ${
            run.completed ? "from-white via-[#f4e6c9] to-[#d3a860]" : "from-white/70 to-white/30"
          }`}
        >
          {run.completed ? formatTime(run.timeMs) : `${run.count}/${run.target}`}
        </p>
        <p className="mt-2 text-sm font-semibold leading-relaxed text-white/55">
          {run.completed ? "เวลาที่ทำได้" : unit}
        </p>
        <p className="mt-3 text-lg font-semibold leading-relaxed text-white/85">{headline}</p>
      </div>

      {run.completed && (
        <div className="grid w-full max-w-md grid-cols-3 gap-2.5">
          <Stat label="อันดับ" value={`#${rank}`} accent="#e0bc7c" />
          <Stat label="เฉลี่ย" value={`${Math.round(average)}/นาที`} accent="#5d6fe3" />
          <Stat label="สูงสุด" value={`${Math.round(run.peakRate)}/นาที`} accent="#e4454f" />
        </div>
      )}

      <section className="panel w-full max-w-md rounded-2xl p-5">
        <h2 className="mb-3 text-sm font-bold leading-snug text-white/60">
          {saved || !run.completed ? "กระดานผู้นำ" : "อันดับที่คุณจะได้"}
        </h2>
        <Leaderboard
          entries={run.completed ? display : board}
          limit={8}
          highlightId={saved ? saved.id : PENDING_ID}
          emptyLabel="ยังไม่มีสถิติบนกระดาน"
        />
      </section>

      {!run.completed ? (
        <p className="max-w-md text-center text-sm leading-[1.8] text-white/50">
          เฉพาะรอบที่ทำครบเท่านั้นที่ได้ขึ้นกระดาน — นาฬิกาต้องหยุดที่ {run.target} {unit}
        </p>
      ) : saved ? (
        <p className="text-sm leading-relaxed text-[#5d6fe3]">บันทึกลงกระดานรวมแล้ว</p>
      ) : (
        <form
          className="flex w-full max-w-md flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            onSave(name);
          }}
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={20}
            placeholder="ชื่อของคุณ"
            aria-label="ชื่อของคุณ"
            autoComplete="off"
            className="min-w-0 flex-1 rounded-full border border-white/15 bg-white/5 px-5 py-3 text-sm leading-relaxed outline-none transition placeholder:text-white/30 focus:border-[#5d6fe3]/70"
          />
          <button
            type="submit"
            disabled={saving}
            className="shrink-0 rounded-full bg-gradient-to-r from-[#3a4bbf] via-[#5d6fe3] to-[#e4454f] px-6 py-3 text-sm font-bold leading-relaxed text-white transition enabled:hover:scale-[1.03] enabled:active:scale-95 disabled:opacity-60"
          >
            {saving ? "กำลังบันทึก…" : "บันทึก"}
          </button>
          {saveError && (
            <p className="w-full text-center text-xs leading-relaxed text-[#f5969c]">
              บันทึกไม่สำเร็จ: {saveError} — ลองกดอีกครั้ง
            </p>
          )}
        </form>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onPlayAgain}
          className="rounded-full bg-white/10 px-7 py-2.5 text-sm font-bold leading-relaxed transition hover:bg-white/20"
        >
          {run.completed ? "แข่งอีกครั้ง" : "ลองใหม่"}
        </button>
        <button
          type="button"
          onClick={onMenu}
          className="rounded-full border border-white/15 px-7 py-2.5 text-sm font-bold leading-relaxed text-white/65 transition hover:border-white/35 hover:text-white"
        >
          หน้าหลัก
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="panel rounded-xl px-3 py-3 text-center">
      <p className="text-[11px] leading-relaxed text-white/45">{label}</p>
      <p className="mt-0.5 font-mono text-xl font-black leading-tight tabular-nums" style={{ color: accent }}>
        {value}
      </p>
    </div>
  );
}
