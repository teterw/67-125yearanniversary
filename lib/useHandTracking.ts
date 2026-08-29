"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { NormalizedLandmark, PoseLandmarker } from "@mediapipe/tasks-vision";

export type TrackerStatus = "idle" | "starting" | "loading" | "ready" | "error";

export type Delegate = "GPU" | "CPU";

export interface TrackerFrame {
  /** One 33-point body per detected person (we ask for one). */
  poses: NormalizedLandmark[][];
  /** performance.now() of this frame. */
  time: number;
  /** Measured detection rate. */
  fps: number;
  /** Smoothed cost of one `detectForVideo` call. */
  inferenceMs: number;
  /** Current downscale applied to the frame before inference, 0..1. */
  inputScale: number;
}

interface Options {
  deviceId: string | null;
  /** The <video> the stream is attached to; owned by the caller so it can be rendered. */
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Held in a ref internally, so changing the callback never restarts the camera. */
  onFrame: (frame: TrackerFrame) => void;
}

const WASM_PATH = "/mediapipe/wasm";
const MODEL_PATH = "/mediapipe/models/pose_landmarker_lite.task";

/**
 * Capture is deliberately not maxed out. Motion blur, not resolution, is what
 * loses a fast hand, and a shorter exposure is what fixes it — so we ask for the
 * highest frame rate the camera will give and only as many pixels as the model
 * can actually use. 1280x720 at 30 fps looks nicer and tracks worse.
 */
const IDEAL_WIDTH = 960;
const IDEAL_HEIGHT = 540;
const IDEAL_FPS = 60;

/** Fallback capture, tried once when the camera can't keep up at the ideal. */
const FALLBACK_WIDTH = 640;
const FALLBACK_HEIGHT = 360;
/** Below this measured rate, drop resolution to buy frames. */
const SLOW_FPS = 24;
/** How long to watch before deciding the feed is slow. */
const RETUNE_AFTER_MS = 2500;

/** Steps the inference input is scaled through when we fall behind. */
const SCALE_STEPS = [1, 0.8, 0.65, 0.5];
/** Inference slower than this is eating frames; scale the input down. */
const SCALE_DOWN_MS = 18;
/** Comfortably under budget: try a sharper input again. */
const SCALE_UP_MS = 9;
/** Minimum gap between scale changes, so it can't oscillate every frame. */
const SCALE_HOLD_MS = 800;

function describeCameraError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "กล้องถูกปิดกั้น กรุณาอนุญาตการใช้กล้องในตั้งค่าของเบราว์เซอร์ แล้วโหลดหน้าใหม่";
    case "NotFoundError":
    case "OverconstrainedError":
      return "ไม่พบกล้อง กรุณาเสียบกล้อง (หรือเลือกอุปกรณ์อื่นในตั้งค่า) แล้วโหลดหน้าใหม่";
    case "NotReadableError":
      return "กล้องกำลังถูกใช้งานโดยแอปอื่น กรุณาปิดแอปนั้นแล้วโหลดหน้าใหม่";
    default:
      return err instanceof Error ? err.message : "เปิดกล้องไม่สำเร็จ";
  }
}

/**
 * Owns the webcam stream and the MediaPipe hand landmarker, and pushes every
 * processed frame to `onFrame`. The video element is created by the caller and
 * handed back through the returned ref.
 *
 * Two things here exist purely to keep the detection rate up on modest hardware:
 * the frame handed to MediaPipe is downscaled when inference starts eating the
 * frame budget (the model works from a 256px crop, so a 960px upload is mostly
 * wasted bandwidth), and a feed that still can't reach 24 fps gets one attempt
 * at a lower capture resolution. Both are reported back on every frame so the UI
 * can say so out loud instead of just counting badly.
 */
export function useHandTracking({ deviceId, videoRef, onFrame }: Options) {
  const onFrameRef = useRef(onFrame);
  const landmarkerRef = useRef<PoseLandmarker | null>(null);
  const rafRef = useRef<number | null>(null);
  const vfcRef = useRef<number | null>(null);
  const lastVideoTimeRef = useRef(-1);

  const [status, setStatus] = useState<TrackerStatus>("idle");
  const [delegate, setDelegate] = useState<Delegate | null>(null);
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

      const size = {
        width: { ideal: IDEAL_WIDTH },
        height: { ideal: IDEAL_HEIGHT },
        frameRate: { ideal: IDEAL_FPS },
      };

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: deviceId ? { deviceId: { exact: deviceId }, ...size } : { facingMode: "user", ...size },
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
        const { FilesetResolver, PoseLandmarker } = await import("@mediapipe/tasks-vision");
        const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
        const base = {
          // Pose, not hands. The palm detector loses a motion-blurred hand
          // outright, and every lost hand is a lost sample. The body model
          // keeps a wrist estimate through blur because it anchors on the
          // torso and arms, which barely move — so the wrists track a fast
          // six-seven at the camera's full frame rate.
          numPoses: 1,
          runningMode: "VIDEO" as const,
          minPoseDetectionConfidence: 0.5,
          minPosePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
          outputSegmentationMasks: false,
        };
        let landmarker: PoseLandmarker;
        let chosen: Delegate = "GPU";
        try {
          landmarker = await PoseLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: MODEL_PATH, delegate: "GPU" },
            ...base,
          });
        } catch {
          // Some WebGL setups can't take the GPU delegate — and some browsers
          // withhold it as a fingerprinting defence, which is worth being able
          // to see, since the CPU fallback is several times slower.
          chosen = "CPU";
          landmarker = await PoseLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: MODEL_PATH, delegate: "CPU" },
            ...base,
          });
        }
        setDelegate(chosen);

        if (cancelled) {
          landmarker.close();
          return;
        }
        landmarkerRef.current = landmarker;
        setStatus("ready");
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "โหลดโมเดลติดตามท่าทางไม่สำเร็จ");
          setStatus("error");
        }
        return;
      }

      /* ------------------------------------------------ keeping the rate up */

      const work = document.createElement("canvas");
      const workCtx = work.getContext("2d", { alpha: false, willReadFrequently: false });

      let fps = 0;
      let inferenceMs = 0;
      let step = 0;
      let lastStepAt = 0;
      let lastAt = 0;
      let lastStamp = 0;
      let retunedAt = 0;
      let retuned = false;

      /** Copies the frame into a smaller canvas so MediaPipe uploads less. */
      const downscaled = (el: HTMLVideoElement, scale: number) => {
        if (!workCtx) return el;
        const w = Math.max(160, Math.round(el.videoWidth * scale));
        const h = Math.max(90, Math.round(el.videoHeight * scale));
        if (work.width !== w || work.height !== h) {
          work.width = w;
          work.height = h;
        }
        workCtx.drawImage(el, 0, 0, w, h);
        return work;
      };

      /**
       * One attempt at a cheaper capture format when the feed is genuinely slow.
       * Lower resolution usually comes with a shorter exposure, so this buys
       * sharper hands as well as more frames.
       */
      const retune = (now: number) => {
        if (retuned || fps === 0 || fps >= SLOW_FPS) return;
        if (retunedAt === 0) retunedAt = now;
        if (now - retunedAt < RETUNE_AFTER_MS) return;
        retuned = true;
        const track = stream?.getVideoTracks()[0];
        void track
          ?.applyConstraints({
            width: { ideal: FALLBACK_WIDTH },
            height: { ideal: FALLBACK_HEIGHT },
            frameRate: { ideal: IDEAL_FPS },
          })
          .catch(() => {
            // The camera kept what it had; the input downscale still applies.
          });
      };

      const process = (dedupe: boolean) => {
        const el = videoRef.current;
        const landmarker = landmarkerRef.current;
        if (!el || !landmarker || el.readyState < 2) return;

        // Only the repaint-driven path can be handed the same image twice.
        // requestVideoFrameCallback fires once per *decoded* frame, and some
        // browsers quantise currentTime for fingerprinting — testing it there
        // throws away frames that were genuinely new.
        if (dedupe) {
          if (el.currentTime === lastVideoTimeRef.current) return;
          lastVideoTimeRef.current = el.currentTime;
        }

        // detectForVideo rejects a timestamp it has already seen, and browsers
        // that coarsen performance.now() can hand us the same reading twice.
        const clock = performance.now();
        const time = clock > lastStamp ? clock : lastStamp + 1;
        lastStamp = time;
        if (lastAt > 0) {
          const instant = 1000 / Math.max(1, Math.min(250, time - lastAt));
          fps = fps === 0 ? instant : fps + 0.1 * (instant - fps);
        }
        lastAt = time;

        const scale = SCALE_STEPS[step];
        try {
          const source = scale < 0.99 ? downscaled(el, scale) : el;
          const result = landmarker.detectForVideo(source, time);
          const took = performance.now() - time;
          inferenceMs = inferenceMs === 0 ? took : inferenceMs + 0.2 * (took - inferenceMs);
          onFrameRef.current({
            poses: result.landmarks ?? [],
            time,
            fps,
            inferenceMs,
            inputScale: scale,
          });
        } catch {
          // A dropped frame is not worth tearing the session down.
        }

        // Trade sharpness for rate, one step at a time and never twice in a row
        // in under SCALE_HOLD_MS, so a single slow frame can't start a slide.
        if (time - lastStepAt > SCALE_HOLD_MS) {
          if (inferenceMs > SCALE_DOWN_MS && step < SCALE_STEPS.length - 1) {
            step += 1;
            lastStepAt = time;
          } else if (inferenceMs < SCALE_UP_MS && step > 0) {
            step -= 1;
            lastStepAt = time;
          }
        }
        retune(time);
      };

      // requestVideoFrameCallback fires once per decoded camera frame, so we
      // never run inference twice on the same image or miss one between paints.
      const useVideoCallback = typeof video.requestVideoFrameCallback === "function";
      if (useVideoCallback) {
        const onVideoFrame = () => {
          vfcRef.current = video.requestVideoFrameCallback(onVideoFrame);
          process(false);
        };
        vfcRef.current = video.requestVideoFrameCallback(onVideoFrame);
      } else {
        const tick = () => {
          rafRef.current = requestAnimationFrame(tick);
          process(true);
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

  return { status, error, retry, delegate };
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
