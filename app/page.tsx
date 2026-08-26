"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import CameraStage from "@/components/CameraStage";
import MenuScreen from "@/components/MenuScreen";
import GameScreen from "@/components/GameScreen";
import ResultsScreen, { type RunResult } from "@/components/ResultsScreen";
import {
  SixtySevenDetector,
  observeHands,
  selectPair,
  type HandObservation,
  type Side,
} from "@/lib/detector";
import { drawMarkers, type Marker } from "@/lib/draw";
import { useHandTracking, type TrackerFrame } from "@/lib/useHandTracking";
import { DEFAULT_SETTINGS, loadLeaderboard, saveScore, saveSettings, type ScoreEntry } from "@/lib/storage";
import { useLeaderboard, useSettings } from "@/lib/useStore";
import { countBlip, countdownBlip, finishJingle, primeAudio } from "@/lib/audio";

type Phase = "menu" | "countdown" | "playing" | "results";

interface Hud {
  handsVisible: number;
  side: Side | null;
  signal: number;
  threshold: number;
  halfway: boolean;
  rate: number;
  /** 0..1 — how much of each swing the camera is actually resolving. */
  quality: number;
  fps: number;
  solo: boolean;
}

const EMPTY_HUD: Hud = {
  handsVisible: 0,
  side: null,
  signal: 0,
  threshold: DEFAULT_SETTINGS.sensitivity,
  halfway: false,
  rate: 0,
  quality: 0,
  fps: 0,
  solo: false,
};

/** One dot per detected hand: solid for the counted pair, faint for the rest. */
function markersFor(observed: HandObservation[], tracked: HandObservation[]): Marker[] {
  const topIndex =
    tracked.length >= 2
      ? tracked.reduce((best, o) => (o.y < best.y ? o : best), tracked[0]).index
      : null;
  return observed.map((o) => ({
    x: o.x,
    y: o.y,
    scale: o.scale,
    role: !tracked.some((t) => t.index === o.index)
      ? ("ignored" as const)
      : o.index === topIndex
        ? ("top" as const)
        : ("tracked" as const),
  }));
}

export default function Home() {
  const settings = useSettings();
  const board = useLeaderboard();
  const [phase, setPhase] = useState<Phase>("menu");
  const [count, setCount] = useState(0);
  const [pulse, setPulse] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [countdown, setCountdown] = useState(0);
  const [hud, setHud] = useState<Hud>(EMPTY_HUD);
  const [run, setRun] = useState<RunResult | null>(null);
  const [boardBefore, setBoardBefore] = useState<ScoreEntry[]>([]);
  const [saved, setSaved] = useState<{ id: string; rank: number; board: ScoreEntry[] } | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const detectorRef = useRef<SixtySevenDetector | null>(null);
  const phaseRef = useRef<Phase>("menu");
  const settingsRef = useRef(settings);
  const hudAtRef = useRef(0);
  /** performance.now() the clock started, on the same timebase as the detector. */
  const startedAtRef = useRef(0);
  /** Held in a ref so the frame loop can end the race without being re-created. */
  const finishRef = useRef<(completed: boolean, at: number) => void>(() => {});

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  if (detectorRef.current === null) {
    detectorRef.current = new SixtySevenDetector({
      sensitivity: DEFAULT_SETTINGS.sensitivity,
      cooldownMs: DEFAULT_SETTINGS.cooldownMs,
      countMode: DEFAULT_SETTINGS.countMode,
      smoothing: DEFAULT_SETTINGS.smoothing,
      prediction: DEFAULT_SETTINGS.prediction,
      adaptive: DEFAULT_SETTINGS.adaptive,
    });
  }

  const go = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  useEffect(() => {
    detectorRef.current?.setConfig({
      sensitivity: settings.sensitivity,
      cooldownMs: settings.cooldownMs,
      countMode: settings.countMode,
      smoothing: settings.smoothing,
      prediction: settings.prediction,
      adaptive: settings.adaptive,
    });
  }, [
    settings.sensitivity,
    settings.cooldownMs,
    settings.countMode,
    settings.smoothing,
    settings.prediction,
    settings.adaptive,
  ]);

  /* ------------------------------------------------------------ frame loop */

  const handleFrame = useCallback(({ hands, time }: TrackerFrame) => {
    const detector = detectorRef.current;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!detector) return;

    const aspect = video && video.videoHeight ? video.videoWidth / video.videoHeight : 16 / 9;
    const observed = observeHands(hands, aspect);
    const paint = (tracked: HandObservation[]) => {
      if (canvas && video) drawMarkers(canvas, video, markersFor(observed, tracked));
    };

    if (phaseRef.current !== "playing") {
      // Off the clock the detector must not run, so the same closest-pair rule
      // runs standalone just to show which hands would be counted.
      const tracked = selectPair(observed);
      paint(tracked);
      if (time - hudAtRef.current > 200) {
        hudAtRef.current = time;
        const handsVisible = Math.min(2, tracked.length);
        setHud((prev) => (prev.handsVisible === handsVisible ? prev : { ...EMPTY_HUD, handsVisible }));
      }
      return;
    }

    const frame = detector.update(observed, time);
    paint(frame.tracked);

    const target = settingsRef.current.target;
    if (frame.scored) {
      setCount(frame.count);
      setPulse((p) => p + 1);
      if (settingsRef.current.sound) countBlip(frame.count, target);
      if (frame.count >= target) {
        // Stop on the interpolated crossing of the last rep, not on the frame
        // that happened to notice it — that is up to a frame of free time.
        finishRef.current(true, frame.scoredAt);
        return;
      }
    }

    if (time - hudAtRef.current > 80) {
      hudAtRef.current = time;
      setHud({
        handsVisible: frame.handsVisible,
        side: frame.side,
        signal: frame.signal,
        threshold: frame.threshold,
        halfway: frame.halfway,
        rate: detector.rate(time),
        quality: frame.quality,
        fps: frame.fps,
        solo: frame.solo,
      });
    }
  }, []);

  const { status, error, retry } = useHandTracking({
    deviceId: settings.deviceId,
    videoRef,
    onFrame: handleFrame,
  });

  /* --------------------------------------------------------- run lifecycle */

  const finishRun = useCallback(
    (completed: boolean, at: number) => {
      if (phaseRef.current !== "playing") return;
      const detector = detectorRef.current!;
      const current = settingsRef.current;
      const timeMs = Math.max(0, at - startedAtRef.current);
      setElapsed(timeMs);
      setRun({
        timeMs,
        target: current.target,
        count: detector.count,
        completed,
        peakRate: detector.peakRate(),
        countMode: current.countMode,
      });
      setBoardBefore(loadLeaderboard());
      setSaved(null);
      setHud(EMPTY_HUD);
      go("results");
      if (current.sound && completed) finishJingle();
    },
    [go],
  );

  useEffect(() => {
    finishRef.current = finishRun;
  }, [finishRun]);

  const abortRun = useCallback(() => finishRun(false, performance.now()), [finishRun]);

  const startGame = useCallback(() => {
    primeAudio();
    const current = settingsRef.current;
    detectorRef.current?.setConfig({
      sensitivity: current.sensitivity,
      cooldownMs: current.cooldownMs,
      countMode: current.countMode,
      smoothing: current.smoothing,
      prediction: current.prediction,
      adaptive: current.adaptive,
    });
    detectorRef.current?.reset();
    setCount(0);
    setPulse(0);
    setHud(EMPTY_HUD);
    setElapsed(0);
    if (current.countdownSeconds > 0) {
      setCountdown(current.countdownSeconds);
      go("countdown");
    } else {
      go("playing");
    }
  }, [go]);

  const backToMenu = useCallback(() => {
    setHud(EMPTY_HUD);
    setElapsed(0);
    go("menu");
  }, [go]);

  // Countdown ticks down, then hands off to the race.
  useEffect(() => {
    if (phase !== "countdown") return;
    if (settingsRef.current.sound) countdownBlip(countdown);
    if (countdown <= 0) {
      const t = window.setTimeout(() => go("playing"), 420);
      return () => window.clearTimeout(t);
    }
    const t = window.setTimeout(() => setCountdown((c) => c - 1), 800);
    return () => window.clearTimeout(t);
  }, [phase, countdown, go]);

  // The clock. It counts up now — the race ends when the 125th 67 lands, so the
  // display just tracks the same timebase the detector timestamps swaps on.
  useEffect(() => {
    if (phase !== "playing") return;
    // `elapsed` was already zeroed on start; the interval owns it from here.
    startedAtRef.current = performance.now();
    const id = window.setInterval(() => {
      setElapsed(performance.now() - startedAtRef.current);
    }, 50);
    return () => window.clearInterval(id);
  }, [phase]);

  /* -------------------------------------------------------------- shortcuts */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "SELECT" || target.isContentEditable)) {
        return;
      }
      if (e.code === "Space" && (phaseRef.current === "menu" || phaseRef.current === "results")) {
        e.preventDefault();
        if (status === "ready") startGame();
      }
      if (e.code === "Escape") {
        if (phaseRef.current === "playing") abortRun();
        else if (phaseRef.current !== "menu") backToMenu();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [startGame, abortRun, backToMenu, status]);

  /* ------------------------------------------------------------------ save */

  const handleSave = useCallback(
    (name: string) => {
      if (!run || !run.completed) return;
      const result = saveScore({
        name,
        timeMs: run.timeMs,
        target: run.target,
        peakRate: run.peakRate,
        countMode: run.countMode,
      });
      setSaved({ id: result.entry.id, rank: result.rank, board: result.board });
      const trimmed = name.trim().slice(0, 20);
      if (trimmed && trimmed !== settingsRef.current.playerName) {
        saveSettings({ ...settingsRef.current, playerName: trimmed });
      }
    },
    [run],
  );

  /* ----------------------------------------------------------------- render */

  return (
    <main className="relative h-dvh w-full overflow-hidden">
      <CameraStage
        videoRef={videoRef}
        canvasRef={canvasRef}
        mirror={settings.mirror}
        status={status}
        error={error}
        onRetry={retry}
        dim={phase !== "playing"}
      />

      <div className="absolute inset-0">
        {phase === "menu" && (
          <MenuScreen
            settings={settings}
            board={board}
            onStart={startGame}
            canStart={status === "ready"}
            handsVisible={hud.handsVisible}
          />
        )}

        {phase === "countdown" && (
          <div className="flex h-full w-full flex-col items-center justify-center">
            <p
              key={countdown}
              className="glow-text animate-punch font-mono text-[30vw] font-black leading-none sm:text-[18vw]"
            >
              {countdown > 0 ? countdown : "67!"}
            </p>
            <p className="text-sm font-bold uppercase tracking-[0.4em] text-white/60">
              palms up · both hands
            </p>
          </div>
        )}

        {phase === "playing" && (
          <GameScreen
            count={count}
            target={settings.target}
            countMode={settings.countMode}
            pulse={pulse}
            elapsed={elapsed}
            handsVisible={hud.handsVisible}
            side={hud.side}
            signal={hud.signal}
            threshold={hud.threshold}
            mirror={settings.mirror}
            halfway={hud.halfway}
            rate={hud.rate}
            quality={hud.quality}
            fps={hud.fps}
            solo={hud.solo}
            onAbort={abortRun}
          />
        )}

        {phase === "results" && run && (
          <ResultsScreen
            run={run}
            board={boardBefore}
            defaultName={settings.playerName}
            saved={saved}
            onSave={handleSave}
            onPlayAgain={startGame}
            onMenu={backToMenu}
          />
        )}
      </div>
    </main>
  );
}
