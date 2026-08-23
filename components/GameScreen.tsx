"use client";

import type { Side } from "@/lib/detector";

interface Props {
  count: number;
  /** Bumped on every scored rep to retrigger the pop animation. */
  pulse: number;
  timeLeft: number;
  roundSeconds: number;
  handsVisible: number;
  side: Side | null;
  /** Baselined hand separation in palm lengths. */
  signal: number;
  sensitivity: number;
  /** The feed is CSS-flipped when mirrored, so the tilt bar has to flip too. */
  mirror: boolean;
  halfway: boolean;
  rate: number;
  onAbort: () => void;
}

export default function GameScreen({
  count,
  pulse,
  timeLeft,
  roundSeconds,
  handsVisible,
  side,
  signal,
  sensitivity,
  mirror,
  halfway,
  rate,
  onAbort,
}: Props) {
  const progress = Math.max(0, Math.min(1, timeLeft / roundSeconds));
  const urgent = timeLeft <= 5;
  // Map hand separation onto a -1..1 tilt bar, saturating at 3x the threshold.
  const raw = Math.max(-1, Math.min(1, signal / (sensitivity * 2)));
  const tilt = mirror ? -raw : raw;
  // `side` is in raw-frame terms; mirroring swaps which edge of the screen it is.
  const shown = side === null ? null : mirror ? (side === "L" ? "R" : "L") : side;

  return (
    <div className="pointer-events-none flex h-full w-full flex-col justify-between p-5 sm:p-8">
      <div className="flex items-start justify-between gap-4">
        <div className="panel rounded-2xl px-4 py-2.5">
          <p className="text-[10px] uppercase tracking-[0.28em] text-white/45">Time</p>
          <p
            className={`font-mono text-3xl font-black tabular-nums leading-none ${
              urgent ? "text-[#ff2fb0]" : "text-white"
            }`}
          >
            {timeLeft.toFixed(1)}
          </p>
        </div>

        <div className="panel rounded-2xl px-4 py-2.5 text-right">
          <p className="text-[10px] uppercase tracking-[0.28em] text-white/45">Pace</p>
          <p className="font-mono text-3xl font-black tabular-nums leading-none text-[#22e0ff]">
            {Math.round(rate)}
          </p>
          <p className="text-[10px] text-white/35">67s / min</p>
        </div>
      </div>

      <div className="relative flex flex-col items-center">
        <div
          className="pointer-events-none absolute -inset-x-10 -inset-y-8"
          style={{
            background:
              "radial-gradient(closest-side, rgba(5,5,10,0.62) 0%, rgba(5,5,10,0.28) 55%, transparent 100%)",
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
        <p className="relative -mt-2 text-xs font-bold uppercase tracking-[0.4em] text-white/60">
          six-sevens
        </p>

        {handsVisible < 2 && (
          <p className="relative mt-5 rounded-full bg-[#ff2fb0]/30 px-4 py-1.5 text-sm font-semibold text-[#ff8ad4] ring-1 ring-[#ff2fb0]/40">
            Show both hands
          </p>
        )}
        {handsVisible >= 2 && halfway && (
          <p className="relative mt-5 rounded-full bg-black/50 px-4 py-1.5 text-sm font-semibold text-[#ffd23f]">
            …and back
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
                  shown === "L" ? "#22e0ff" : shown === "R" ? "#ff2fb0" : "rgba(255,255,255,0.35)",
              }}
            />
          </div>
          <div className="mt-1.5 flex justify-between text-[10px] uppercase tracking-[0.25em] text-white/35">
            <span className={shown === "L" ? "text-[#22e0ff]" : ""}>left up</span>
            <span className={shown === "R" ? "text-[#ff2fb0]" : ""}>right up</span>
          </div>
        </div>

        <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full transition-[width] duration-100 ease-linear"
            style={{
              width: `${progress * 100}%`,
              background: urgent ? "#ff2fb0" : "linear-gradient(90deg,#22e0ff,#ff2fb0)",
            }}
          />
        </div>

        <div className="flex justify-center">
          <button
            type="button"
            onClick={onAbort}
            className="pointer-events-auto rounded-full border border-white/15 px-5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-white/55 transition hover:border-white/35 hover:text-white"
          >
            End round
          </button>
        </div>
      </div>
    </div>
  );
}
