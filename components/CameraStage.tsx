"use client";

import type { RefObject } from "react";
import type { TrackerStatus } from "@/lib/useHandTracking";

interface Props {
  videoRef: RefObject<HTMLVideoElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  mirror: boolean;
  status: TrackerStatus;
  error: string | null;
  onRetry: () => void;
  /** Darkens the feed behind menu/result overlays so text stays readable. */
  dim: boolean;
}

const STATUS_LABEL: Record<TrackerStatus, string> = {
  idle: "Waking up…",
  starting: "Asking for the camera…",
  loading: "Loading hand tracking…",
  ready: "",
  error: "",
};

export default function CameraStage({
  videoRef,
  canvasRef,
  mirror,
  status,
  error,
  onRetry,
  dim,
}: Props) {
  const flip = mirror ? "scaleX(-1)" : "none";

  return (
    <div className="absolute inset-0 overflow-hidden bg-[#05050a]">
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        className="absolute inset-0 h-full w-full object-cover"
        style={{ transform: flip }}
      />
      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute inset-0 h-full w-full object-cover"
        style={{ transform: flip }}
      />

      {/* Always-on scrim: keeps the HUD legible over a bright, busy feed. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, rgba(5,5,10,0.7) 0%, rgba(5,5,10,0.18) 26%, rgba(5,5,10,0.18) 62%, rgba(5,5,10,0.8) 100%)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 transition-opacity duration-500"
        style={{
          opacity: dim ? 1 : 0,
          background:
            "radial-gradient(120% 90% at 50% 30%, rgba(5,5,10,0.35) 0%, rgba(5,5,10,0.82) 62%, rgba(5,5,10,0.95) 100%)",
        }}
      />

      {status !== "ready" && status !== "error" && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex items-center gap-3 rounded-full panel px-5 py-2.5 text-sm text-white/70">
            <span className="h-2.5 w-2.5 animate-ping rounded-full bg-[#22e0ff]" />
            {STATUS_LABEL[status]}
          </div>
        </div>
      )}

      {status === "error" && (
        <div className="absolute inset-0 flex items-center justify-center p-6">
          <div className="panel max-w-sm rounded-2xl p-6 text-center">
            <p className="text-lg font-semibold text-[#ff2fb0]">Camera unavailable</p>
            <p className="mt-2 text-sm leading-relaxed text-white/65">{error}</p>
            <button
              type="button"
              onClick={onRetry}
              className="mt-5 rounded-full bg-white/10 px-5 py-2 text-sm font-semibold transition hover:bg-white/20"
            >
              Try again
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
