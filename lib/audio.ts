"use client";

/** Tiny WebAudio blip generator — avoids shipping any audio files. */

let ctx: AudioContext | null = null;

function context(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** Call from a user gesture so later blips aren't blocked by autoplay policy. */
export function primeAudio() {
  context();
}

export function blip(freq: number, durationMs = 90, gain = 0.12, type: OscillatorType = "square") {
  const ac = context();
  if (!ac) return;
  const osc = ac.createOscillator();
  const amp = ac.createGain();
  const now = ac.currentTime;
  const dur = durationMs / 1000;

  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);
  amp.gain.setValueAtTime(0, now);
  amp.gain.linearRampToValueAtTime(gain, now + 0.01);
  amp.gain.exponentialRampToValueAtTime(0.0001, now + dur);

  osc.connect(amp).connect(ac.destination);
  osc.start(now);
  osc.stop(now + dur + 0.02);
}

/** Every 25th rep gets a fanfare — four of them stand between you and 125. */
const MILESTONE_EVERY = 25;

/** Rising two-tone on every count, so the rhythm is audible without looking. */
export function countBlip(count: number, target: number) {
  const milestone = count % MILESTONE_EVERY === 0 && count !== target;
  blip(milestone ? 880 : 620 + (count % 8) * 25, milestone ? 160 : 70, milestone ? 0.16 : 0.1);
  if (milestone) window.setTimeout(() => blip(1320, 200, 0.14), 90);
}

export function countdownBlip(remaining: number) {
  blip(remaining === 0 ? 990 : 440, remaining === 0 ? 260 : 120, 0.14, "triangle");
}

export function finishJingle() {
  [523, 659, 784, 1046].forEach((f, i) => window.setTimeout(() => blip(f, 180, 0.13, "triangle"), i * 110));
}
