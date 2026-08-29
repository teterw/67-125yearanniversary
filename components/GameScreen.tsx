"use client";

import type { Side } from "@/lib/detector";
import { formatTime, unitLabel, type CountMode } from "@/lib/storage";

interface Props {
  count: number;
  /** Counts needed to stop the clock. */
  target: number;
  countMode: CountMode;
  /** Bumped on every scored rep to retrigger the pop animation. */
  pulse: number;
  /** Milliseconds since the clock started. */
  elapsed: number;
  handsVisible: number;
  side: Side | null;
  /** Baselined hand separation in palm lengths. */
  signal: number;
  /** What that separation currently has to beat — auto-gain moves it. */
  threshold: number;
  /** The feed is CSS-flipped when mirrored, so the tilt bar has to flip too. */
  mirror: boolean;
  halfway: boolean;
  rate: number;
  /** 0..1 — how much of each swing the camera is resolving. */
  quality: number;
  fps: number;
  /** Counting from one hand while the other is lost to blur. */
  solo: boolean;
  onAbort: () => void;
}

/** Below this, the camera is losing enough of the motion to be worth saying so. */
const THIN = 0.55;

export default function GameScreen({
  count,
  target,
  countMode,
  pulse,
  elapsed,
  handsVisible,
  side,
  signal,
  threshold,
  mirror,
  halfway,
  rate,
  quality,
  fps,
  solo,
  onAbort,
}: Props) {
  const progress = Math.max(0, Math.min(1, count / target));
  const remaining = Math.max(0, target - count);
  const closing = remaining <= 10;
  // Map hand separation onto a -1..1 tilt bar, saturating at 2x the threshold.
  const raw = Math.max(-1, Math.min(1, signal / (Math.max(0.01, threshold) * 2)));
  const tilt = mirror ? -raw : raw;
  // `side` is in raw-frame terms; mirroring swaps which edge of the screen it is.
  const shown = side === null ? null : mirror ? (side === "L" ? "R" : "L") : side;
  // Straight-line projection from the pace so far — the only honest guess there is.
  const projected = count > 0 && remaining > 0 ? (elapsed / count) * target : null;
  const unit = unitLabel(countMode);

  return (
    <div className="pointer-events-none thai flex h-full w-full flex-col justify-between p-5 sm:p-8">
      <div className="flex items-start justify-between gap-4">
        <div className="panel rounded-2xl px-4 py-2.5">
          <p className="text-xs leading-relaxed text-white/50">เวลา</p>
          <p
            className={`font-mono text-3xl font-black tabular-nums leading-none ${
              closing ? "text-[#e0bc7c]" : "text-white"
            }`}
          >
            {formatTime(elapsed)}
          </p>
        </div>

        <div className="panel rounded-2xl px-4 py-2.5 text-right">
          <p className="text-xs leading-relaxed text-white/50">จังหวะ</p>
          <p className="font-mono text-3xl font-black tabular-nums leading-none text-[#5d6fe3]">
            {Math.round(rate)}
          </p>
          <p className="text-[11px] leading-relaxed text-white/40">
            {projected ? `คาดว่าจบ ~${formatTime(projected)}` : `${unit} / นาที`}
          </p>
        </div>
      </div>

      <div className="relative flex flex-col items-center">
        <div
          className="pointer-events-none absolute -inset-x-10 -inset-y-8"
          style={{
            background:
              "radial-gradient(closest-side, rgba(7,10,24,0.62) 0%, rgba(7,10,24,0.28) 55%, transparent 100%)",
          }}
        />
        <p
          key={pulse}
          className={`glow-text relative font-mono text-[24vw] font-black leading-none tabular-nums sm:text-[16vw] ${
            pulse > 0 ? "animate-pop" : ""
          }`}
        >
          {count}
        </p>
        <p className="relative -mt-2 font-mono text-sm font-bold tracking-[0.3em] text-white/55">
          / {target}
        </p>
        <p className="relative mt-1 text-sm font-semibold leading-relaxed text-white/50">
          {closing && remaining > 0 ? `อีก ${remaining} ${unit}` : unit}
        </p>

        {handsVisible < 2 && !solo && (
          <p className="relative mt-5 rounded-full bg-[#e4454f]/30 px-4 py-1.5 text-sm font-semibold leading-relaxed text-[#f5969c] ring-1 ring-[#e4454f]/40">
            ยกมือทั้งสองข้างให้กล้องเห็น
          </p>
        )}
        {solo && (
          <p className="relative mt-5 rounded-full bg-black/50 px-4 py-1.5 text-sm font-semibold leading-relaxed text-[#5d6fe3]">
            เห็นมือข้างเดียว — ยังนับต่อ
          </p>
        )}
        {handsVisible >= 2 && halfway && (
          <p className="relative mt-5 rounded-full bg-black/50 px-4 py-1.5 text-sm font-semibold leading-relaxed text-[#e0bc7c]">
            …แล้วสลับกลับ
          </p>
        )}
      </div>

      <div className="space-y-4">
        <div className="mx-auto w-full max-w-md">
          <div className="relative h-2.5 overflow-hidden rounded-full bg-white/10">
            <div className="absolute inset-y-0 left-1/2 w-px bg-white/30" />
            <div
              className="absolute inset-y-0 rounded-full transition-[left,right] duration-75"
              style={{
                left: tilt < 0 ? `${50 + tilt * 50}%` : "50%",
                right: tilt > 0 ? `${50 - tilt * 50}%` : "50%",
                background:
                  shown === "L" ? "#5d6fe3" : shown === "R" ? "#e4454f" : "rgba(255,255,255,0.35)",
              }}
            />
          </div>
          <div className="mt-1.5 flex justify-between text-[11px] leading-relaxed text-white/40">
            <span className={shown === "L" ? "text-[#5d6fe3]" : ""}>มือซ้ายขึ้น</span>
            <span className={shown === "R" ? "text-[#e4454f]" : ""}>มือขวาขึ้น</span>
          </div>
        </div>

        {/* Progress toward 125, with a tick at each 25. */}
        <div className="relative mx-auto w-full max-w-md">
          <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full transition-[width] duration-200 ease-out"
              style={{
                width: `${progress * 100}%`,
                background: closing ? "#e0bc7c" : "linear-gradient(90deg,#5d6fe3,#e4454f)",
              }}
            />
          </div>
          {[0.2, 0.4, 0.6, 0.8].map((at) => (
            <span
              key={at}
              className="absolute top-0 h-1.5 w-px bg-[#070a18]/70"
              style={{ left: `${at * 100}%` }}
            />
          ))}
        </div>

        <div className="flex items-center justify-center gap-3">
          {quality > 0 && quality < THIN && (
            <span className="rounded-full bg-[#e0bc7c]/15 px-3 py-1 text-[11px] font-semibold leading-relaxed text-[#e0bc7c] ring-1 ring-[#e0bc7c]/30">
              {Math.round(fps)} fps · กล้องตามไม่ค่อยทัน
            </span>
          )}
          <button
            type="button"
            onClick={onAbort}
            className="pointer-events-auto rounded-full border border-white/15 px-5 py-1.5 text-xs font-semibold leading-relaxed text-white/55 transition hover:border-white/35 hover:text-white"
          >
            จบรอบ
          </button>
        </div>
      </div>
    </div>
  );
}
