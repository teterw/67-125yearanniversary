"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SixtySevenDetector, observeHands } from "@/lib/detector";
import { drawMarkers } from "@/lib/draw";
import { useHandTracking, type TrackerFrame } from "@/lib/useHandTracking";
import type { Settings } from "@/lib/storage";

/**
 * Calibration widget for the settings page: runs the real detector against a
 * live feed so sensitivity and cooldown can be tuned by feel, without the
 * result going anywhere near the leaderboard.
 */
export default function CameraPreview({ settings }: { settings: Settings }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const detectorRef = useRef<SixtySevenDetector | null>(null);
  const settingsRef = useRef(settings);
  const hudAtRef = useRef(0);

  const [count, setCount] = useState(0);
  const [tilt, setTilt] = useState(0);
  const [hands, setHands] = useState(0);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  if (detectorRef.current === null) {
    detectorRef.current = new SixtySevenDetector({
      sensitivity: settings.sensitivity,
      cooldownMs: settings.cooldownMs,
      countMode: settings.countMode,
      smoothing: settings.smoothing,
      prediction: settings.prediction,
    });
  }

  useEffect(() => {
    detectorRef.current?.setConfig({
      sensitivity: settings.sensitivity,
      cooldownMs: settings.cooldownMs,
      countMode: settings.countMode,
      smoothing: settings.smoothing,
      prediction: settings.prediction,
    });
  }, [
    settings.sensitivity,
    settings.cooldownMs,
    settings.countMode,
    settings.smoothing,
    settings.prediction,
  ]);

  const handleFrame = useCallback(({ hands: detected, time }: TrackerFrame) => {
    const detector = detectorRef.current;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!detector) return;

    const aspect = video && video.videoHeight ? video.videoWidth / video.videoHeight : 16 / 9;
    const observed = observeHands(detected, aspect);
    const frame = detector.update(observed, time);

    if (canvas && video) {
      const topIndex =
        frame.tracked.length >= 2
          ? frame.tracked.reduce((best, o) => (o.y < best.y ? o : best), frame.tracked[0]).index
          : null;
      drawMarkers(
        canvas,
        video,
        observed.map((o) => ({
          x: o.x,
          y: o.y,
          scale: o.scale,
          role: !frame.tracked.some((t) => t.index === o.index)
            ? ("ignored" as const)
            : o.index === topIndex
              ? ("top" as const)
              : ("tracked" as const),
        })),
      );
    }
    if (frame.scored) setCount(frame.count);
    if (time - hudAtRef.current > 80) {
      hudAtRef.current = time;
      setHands(frame.handsVisible);
      const raw = Math.max(-1, Math.min(1, frame.signal / (settingsRef.current.sensitivity * 2)));
      setTilt(settingsRef.current.mirror ? -raw : raw);
    }
  }, []);

  const { status, error, retry } = useHandTracking({
    deviceId: settings.deviceId,
    videoRef,
    onFrame: handleFrame,
  });

  const flip = settings.mirror ? "scaleX(-1)" : "none";

  return (
    <div className="space-y-3">
      <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black ring-1 ring-white/10">
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
        <div className="absolute left-3 top-3 rounded-lg bg-black/60 px-3 py-1.5 font-mono text-2xl font-black tabular-nums text-[#22e0ff]">
          {count}
        </div>
        {status !== "ready" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/70 px-4 text-center text-xs text-white/70">
            {status === "error" ? (
              <div>
                <p className="text-[#ff2fb0]">{error}</p>
                <button
                  type="button"
                  onClick={retry}
                  className="mt-3 rounded-full bg-white/10 px-4 py-1.5 font-semibold text-white transition hover:bg-white/20"
                >
                  Try again
                </button>
              </div>
            ) : (
              "Starting camera…"
            )}
          </div>
        )}
      </div>

      <div>
        <div className="relative h-2 overflow-hidden rounded-full bg-white/10">
          <div className="absolute inset-y-0 left-1/2 w-px bg-white/30" />
          <div
            className="absolute inset-y-0 rounded-full bg-[#22e0ff] transition-[left,right] duration-75"
            style={{
              left: tilt < 0 ? `${50 + tilt * 50}%` : "50%",
              right: tilt > 0 ? `${50 - tilt * 50}%` : "50%",
            }}
          />
        </div>
        <p className="mt-2 text-xs text-white/45">
          {hands < 2
            ? "Show both hands to test."
            : "Rock your hands — the bar swings, and the counter should tick once per six-seven."}
        </p>
      </div>

      <button
        type="button"
        onClick={() => {
          detectorRef.current?.reset();
          setCount(0);
        }}
        className="rounded-full border border-white/15 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.15em] text-white/60 transition hover:border-white/35 hover:text-white"
      >
        Reset test counter
      </button>
    </div>
  );
}
