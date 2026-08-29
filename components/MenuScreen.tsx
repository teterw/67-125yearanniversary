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
        <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.42em] text-[#e0bc7c]">
          125th anniversary · 1901–2026
        </p>
        <h1 className="glow-text num-tight mt-2 bg-gradient-to-b from-white via-[#f4e6c9] to-[#d3a860] bg-clip-text font-mono text-6xl font-black leading-none text-transparent sm:text-7xl">
          6 · 7
        </h1>
        <p className="mt-1 font-mono text-lg font-black tracking-[0.35em] text-white/55">
          ×{settings.target}
        </p>
        <p className="thai mt-3 max-w-sm text-[15px] leading-[1.8] text-white/65">
          หงายฝ่ามือ ยกมือทั้งสองข้างให้อยู่ในกล้อง แล้วแกว่งสลับขึ้น-ลงเหมือนตาชั่ง
          กล้องจะนับ{settings.countMode === "swap" ? "ทุกครั้งที่สลับมือ" : "ทุกรอบ 6-7 ที่ทำครบ"}{" "}
          นาฬิกาหยุดเมื่อครบ {settings.target} ครั้ง — ใครเร็วที่สุดได้ขึ้นกระดาน
        </p>
      </header>

      <div className="flex flex-col items-center gap-3">
        <button
          type="button"
          onClick={onStart}
          disabled={!canStart}
          className="glow-ring thai group relative rounded-full bg-gradient-to-r from-[#3a4bbf] via-[#5d6fe3] to-[#e4454f] px-14 py-4 text-xl font-bold leading-snug text-white transition enabled:hover:scale-[1.03] enabled:active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
        >
          เริ่มเล่น
        </button>

        <p className="thai h-6 text-sm leading-relaxed text-white/50">
          {!canStart ? (
            "กำลังรอกล้อง…"
          ) : handsVisible >= 2 ? (
            <span className="text-[#8f9cf0]">เห็นมือทั้งสองข้างแล้ว — เริ่มได้เลย</span>
          ) : (
            `แข่งให้ครบ ${settings.target} ครั้ง · ยกมือทั้งสองข้างให้กล้องเห็น`
          )}
        </p>
      </div>

      <section className="panel w-full max-w-md rounded-2xl p-5">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="thai text-sm font-bold leading-snug text-white/60">กระดานผู้นำ</h2>
          {best && (
            <span className="thai text-xs leading-relaxed text-white/45">
              สถิติดีสุด{" "}
              <span className="font-mono font-bold text-[#e0bc7c]">{formatTime(best.timeMs)}</span> โดย{" "}
              {best.name}
            </span>
          )}
        </div>
        <Leaderboard entries={board} limit={6} />
      </section>

      <Contributors />

      <Link
        href="/settings"
        className="thai rounded-full border border-white/15 px-5 py-2 text-sm font-medium leading-snug text-white/65 transition hover:border-[#e0bc7c]/50 hover:text-white"
      >
        ตั้งค่า
      </Link>
    </div>
  );
}
