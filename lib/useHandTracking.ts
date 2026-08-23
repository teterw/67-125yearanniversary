"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { HandLandmarker, NormalizedLandmark } from "@mediapipe/tasks-vision";

export type TrackerStatus = "idle" | "starting" | "loading" | "ready" | "error";

export interface TrackerFrame {
  hands: NormalizedLandmark[][];
  /** performance.now() of this frame. */
  time: number;
}

interface Options {
  deviceId: string | null;
  /** The <video> the stream is attached to; owned by the caller so it can be rendered. */
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Held in a ref internally, so changing the callback never restarts the camera. */
  onFrame: (frame: TrackerFrame) => void;
}

const WASM_PATH = "/mediapipe/wasm";
const MODEL_PATH = "/mediapipe/models/hand_landmarker.task";

function describeCameraError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Camera access was blocked. Allow it in your browser's site settings, then reload.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No camera found. Plug one in (or pick a different device in Settings) and reload.";
    case "NotReadableError":
      return "The camera is already in use by another app. Close it and reload.";
    default:
      return err instanceof Error ? err.message : "Could not start the camera.";
  }
}

/**
 * Owns the webcam stream and the MediaPipe hand landmarker, and pushes every
 * processed frame to `onFrame`. The video element is created by the caller and
 * handed back through the returned ref.
 */
export function useHandTracking({ deviceId, videoRef, onFrame }: Options) {
  const onFrameRef = useRef(onFrame);
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const rafRef = useRef<number | null>(null);
  const vfcRef = useRef<number | null>(null);
  const lastVideoTimeRef = useRef(-1);

  const [status, setStatus] = useState<TrackerStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    onFrameRef.current = onFrame;
  }, [onFrame]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;

    const element = videoRef.current;

    async function start() {
      const video = element;
      if (!video) return;

      setError(null);
      setStatus("starting");

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: deviceId
            ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
            : { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
      } catch (err) {
        if (!cancelled) {
          setError(describeCameraError(err));
          setStatus("error");
        }
        return;
      }

      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      video.srcObject = stream;
      try {
        await video.play();
      } catch {
        // Autoplay rejection on a muted inline video is recoverable — the
        // loop below waits for readyState anyway.
      }

      if (cancelled) return;
      setStatus("loading");

      try {
        const { FilesetResolver, HandLandmarker } = await import("@mediapipe/tasks-vision");
        const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
        const base = {
          // Detect more than the two we need, so `selectPair` can discard
          // bystanders instead of MediaPipe silently picking their hands.
          numHands: 4,
          runningMode: "VIDEO" as const,
          // Deliberately loose: the six-seven gesture moves fast enough to blur
          // frames, and stricter thresholds drop a hand mid-rep.
          minHandDetectionConfidence: 0.4,
          minHandPresenceConfidence: 0.4,
          minTrackingConfidence: 0.4,
        };
        let landmarker: HandLandmarker;
        try {
          landmarker = await HandLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: MODEL_PATH, delegate: "GPU" },
            ...base,
          });
        } catch {
          // Some Linux/WebGL setups can't take the GPU delegate.
          landmarker = await HandLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: MODEL_PATH, delegate: "CPU" },
            ...base,
          });
        }

        if (cancelled) {
          landmarker.close();
          return;
        }
        landmarkerRef.current = landmarker;
        setStatus("ready");
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load the hand tracking model.");
          setStatus("error");
        }
        return;
      }

      const process = () => {
        const el = videoRef.current;
        const landmarker = landmarkerRef.current;
        if (!el || !landmarker || el.readyState < 2) return;

        // detectForVideo rejects repeated timestamps, so skip stale frames.
        if (el.currentTime === lastVideoTimeRef.current) return;
        lastVideoTimeRef.current = el.currentTime;

        const time = performance.now();
        try {
          const result = landmarker.detectForVideo(el, time);
          onFrameRef.current({ hands: result.landmarks ?? [], time });
        } catch {
          // A dropped frame is not worth tearing the session down.
        }
      };

      // requestVideoFrameCallback fires once per decoded camera frame, so we
      // never run inference twice on the same image or miss one between paints.
      const useVideoCallback = typeof video.requestVideoFrameCallback === "function";
      if (useVideoCallback) {
        const onVideoFrame = () => {
          vfcRef.current = video.requestVideoFrameCallback(onVideoFrame);
          process();
        };
        vfcRef.current = video.requestVideoFrameCallback(onVideoFrame);
      } else {
        const tick = () => {
          rafRef.current = requestAnimationFrame(tick);
          process();
        };
        rafRef.current = requestAnimationFrame(tick);
      }
    }

    void start();

    return () => {
      cancelled = true;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      if (vfcRef.current !== null) element?.cancelVideoFrameCallback?.(vfcRef.current);
      vfcRef.current = null;
      lastVideoTimeRef.current = -1;
      landmarkerRef.current?.close();
      landmarkerRef.current = null;
      stream?.getTracks().forEach((t) => t.stop());
      if (element) element.srcObject = null;
    };
  }, [deviceId, attempt, videoRef]);

  return { status, error, retry };
}

/** Camera picker data for the settings page. Labels need an active grant. */
export async function listCameras(): Promise<MediaDeviceInfo[]> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return [];
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === "videoinput");
  } catch {
    return [];
  }
}
