"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import CameraStage from "@/components/CameraStage";
import MenuScreen from "@/components/MenuScreen";
import GameScreen from "@/components/GameScreen";
import ResultsScreen, { type RunResult } from "@/components/ResultsScreen";
import { SixtySevenDetector, observeHands, type Side } from "@/lib/detector";
import { clearCanvas, drawHands } from "@/lib/draw";
import { useHandTracking, type TrackerFrame } from "@/lib/useHandTracking";
import { DEFAULT_SETTINGS, loadLeaderboard, saveScore, saveSettings, type ScoreEntry } from "@/lib/storage";
import { useLeaderboard, useSettings } from "@/lib/useStore";
import { countBlip, countdownBlip, finishJingle, primeAudio } from "@/lib/audio";

type Phase = "menu" | "countdown" | "playing" | "results";

interface Hud {
  handsVisible: number;
  side: Side | null;
  signal: number;
  halfway: boolean;
  rate: number;
}

const EMPTY_HUD: Hud = { handsVisible: 0, side: null, signal: 0, halfway: false, rate: 0 };

export default function Home() {
  const settings = useSettings();
  const board = useLeaderboard();
  const [phase, setPhase] = useState<Phase>("menu");
  const [count, setCount] = useState(0);
  const [pulse, setPulse] = useState(0);
  const [timeLeft, setTimeLeft] = useState(DEFAULT_SETTINGS.roundSeconds);
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

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  if (detectorRef.current === null) {
    detectorRef.current = new SixtySevenDetector({
      sensitivity: DEFAULT_SETTINGS.sensitivity,
      cooldownMs: DEFAULT_SETTINGS.cooldownMs,
      countMode: DEFAULT_SETTINGS.countMode,
      smoothing: DEFAULT_SETTINGS.smoothing,
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
    });
  }, [settings.sensitivity, settings.cooldownMs, settings.countMode, settings.smoothing]);

  /* ------------------------------------------------------------ frame loop */

  const handleFrame = useCallback(({ hands, time }: TrackerFrame) => {
    const detector = detectorRef.current;
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!detector) return;

    const aspect = video && video.videoHeight ? video.videoWidth / video.videoHeight : 16 / 9;
    const observed = observeHands(hands, aspect);

    // Highlight whichever hand is currently on top.
    const top = observed.reduce<typeof observed[number] | null>(
      (best, o) => (best === null || o.y < best.y ? o : best),
      null,
    );

    if (canvas && video) {
      drawHands(canvas, video, hands, {
        showSkeleton: settingsRef.current.showSkeleton,
        topIndex: observed.length >= 2 && top ? top.index : null,
        dim: phaseRef.current !== "playing",
      });
    }

    const handsVisible = Math.min(2, observed.length);

    if (phaseRef.current !== "playing") {
      // Menu/results only need a coarse "are your hands in frame" readout.
      if (time - hudAtRef.current > 200) {
        hudAtRef.current = time;
        setHud((prev) => (prev.handsVisible === handsVisible ? prev : { ...EMPTY_HUD, handsVisible }));
      }
      return;
    }

    const frame = detector.update(observed, time);

    if (frame.scored) {
      setCount(frame.count);
      setPulse((p) => p + 1);
      if (settingsRef.current.sound) countBlip(frame.count);
    }

    if (time - hudAtRef.current > 80) {
      hudAtRef.current = time;
      setHud({
        handsVisible: frame.handsVisible,
        side: frame.side,
        signal: frame.signal,
        halfway: frame.halfway,
        rate: detector.rate(time),
      });
    }
  }, []);

  const { status, error, retry } = useHandTracking({
    deviceId: settings.deviceId,
    videoRef,
    onFrame: handleFrame,
  });

  /* --------------------------------------------------------- game lifecycle */

  const finishRound = useCallback(() => {
    if (phaseRef.current !== "playing") return;
    const detector = detectorRef.current!;
    const current = settingsRef.current;
    setRun({
      score: detector.count,
      roundSeconds: current.roundSeconds,
      peakRate: detector.peakRate(),
      countMode: current.countMode,
    });
    setBoardBefore(loadLeaderboard());
    setSaved(null);
    setHud(EMPTY_HUD);
    go("results");
    if (current.sound) finishJingle();
  }, [go]);

  const startGame = useCallback(() => {
    primeAudio();
    const current = settingsRef.current;
    detectorRef.current?.setConfig({
      sensitivity: current.sensitivity,
      cooldownMs: current.cooldownMs,
      countMode: current.countMode,
      smoothing: current.smoothing,
    });
    detectorRef.current?.reset();
    setCount(0);
    setPulse(0);
    setHud(EMPTY_HUD);
    setTimeLeft(current.roundSeconds);
    if (current.countdownSeconds > 0) {
      setCountdown(current.countdownSeconds);
      go("countdown");
    } else {
      go("playing");
    }
  }, [go]);

  const backToMenu = useCallback(() => {
    setHud(EMPTY_HUD);
    setTimeLeft(settingsRef.current.roundSeconds);
    go("menu");
  }, [go]);

  // Countdown ticks down, then hands off to the round.
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

  // Round clock.
  useEffect(() => {
    if (phase !== "playing") return;
    const duration = settingsRef.current.roundSeconds;
    const startedAt = performance.now();
    setTimeLeft(duration);
    const id = window.setInterval(() => {
      const remaining = Math.max(0, duration - (performance.now() - startedAt) / 1000);
      setTimeLeft(remaining);
      if (remaining <= 0) finishRound();
    }, 100);
    return () => window.clearInterval(id);
  }, [phase, finishRound]);

  // Skeleton overlay is stale the moment tracking stops drawing it.
  useEffect(() => {
    if (!settings.showSkeleton) clearCanvas(canvasRef.current);
  }, [settings.showSkeleton]);

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
        if (phaseRef.current === "playing") finishRound();
        else if (phaseRef.current !== "menu") backToMenu();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [startGame, finishRound, backToMenu, status]);

  /* ------------------------------------------------------------------ save */

  const handleSave = useCallback(
    (name: string) => {
      if (!run) return;
      const result = saveScore({
        name,
        score: run.score,
        roundSeconds: run.roundSeconds,
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
            pulse={pulse}
            timeLeft={timeLeft}
            roundSeconds={settings.roundSeconds}
            handsVisible={hud.handsVisible}
            side={hud.side}
            signal={hud.signal}
            sensitivity={settings.sensitivity}
            mirror={settings.mirror}
            halfway={hud.halfway}
            rate={hud.rate}
            onAbort={finishRound}
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
