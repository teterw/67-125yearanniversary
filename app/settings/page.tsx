"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import CameraPreview from "@/components/CameraPreview";
import Leaderboard from "@/components/Leaderboard";
import {
  clearLeaderboard,
  removeScore,
  resetSettings,
  saveSettings,
  type Settings,
} from "@/lib/storage";
import { listCameras } from "@/lib/useHandTracking";
import { useLeaderboard, useSettings } from "@/lib/useStore";

const ROUND_PRESETS = [15, 30, 60, 120];
const COUNTDOWN_PRESETS = [0, 3, 5];

export default function SettingsPage() {
  const settings = useSettings();
  const board = useLeaderboard();
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [testing, setTesting] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    // Labels only come back once a camera grant exists for this origin.
    void listCameras().then(setCameras);
  }, []);

  // Each change writes straight through; the store notifies every reader.
  const update = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    saveSettings({ ...settings, [key]: value });

  return (
    <div className="h-dvh overflow-y-auto scroll-thin bg-[#05050a]">
      <div className="mx-auto max-w-2xl px-5 py-10">
        <header className="mb-8 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black tracking-tight">Settings</h1>
            <p className="mt-1 text-sm text-white/50">Tuned per browser, stored locally.</p>
          </div>
          <Link
            href="/"
            className="shrink-0 rounded-full bg-gradient-to-r from-[#22e0ff] to-[#ff2fb0] px-5 py-2.5 text-xs font-black uppercase tracking-[0.15em] text-[#05050a] transition hover:scale-[1.03]"
          >
            Back to game
          </Link>
        </header>

        <Section title="Player">
          <Row label="Name" hint="Pre-filled when you save a score.">
            <input
              value={settings.playerName}
              onChange={(e) => update("playerName", e.target.value.slice(0, 20))}
              maxLength={20}
              placeholder="ANON"
              className="w-44 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm outline-none transition placeholder:text-white/25 focus:border-[#22e0ff]/70"
            />
          </Row>
        </Section>

        <Section title="Round">
          <Row label="Length" hint="How long a round lasts.">
            <div className="flex flex-wrap items-center gap-1.5">
              {ROUND_PRESETS.map((s) => (
                <Chip
                  key={s}
                  active={settings.roundSeconds === s}
                  onClick={() => update("roundSeconds", s)}
                >
                  {s}s
                </Chip>
              ))}
              <input
                type="number"
                min={5}
                max={300}
                value={settings.roundSeconds}
                onChange={(e) =>
                  update("roundSeconds", Math.min(300, Math.max(5, Number(e.target.value) || 5)))
                }
                aria-label="Custom round length in seconds"
                className="w-20 rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 text-sm outline-none focus:border-[#22e0ff]/70"
              />
            </div>
          </Row>

          <Row label="Countdown" hint="Seconds of 3-2-1 before the clock starts.">
            <div className="flex gap-1.5">
              {COUNTDOWN_PRESETS.map((s) => (
                <Chip
                  key={s}
                  active={settings.countdownSeconds === s}
                  onClick={() => update("countdownSeconds", s)}
                >
                  {s === 0 ? "Off" : `${s}s`}
                </Chip>
              ))}
            </div>
          </Row>

          <Row
            label="What counts as one"
            hint={
              settings.countMode === "cycle"
                ? "A full six-seven: hands swap and swap back."
                : "Every single hand alternation scores."
            }
          >
            <div className="flex gap-1.5">
              <Chip active={settings.countMode === "cycle"} onClick={() => update("countMode", "cycle")}>
                Full 6-7
              </Chip>
              <Chip active={settings.countMode === "swap"} onClick={() => update("countMode", "swap")}>
                Every swap
              </Chip>
            </div>
          </Row>
        </Section>

        <Section title="Detection">
          <Row
            label="Travel"
            hint="How far your hands must separate before a swap registers, in palm lengths. Lower scores more easily; too low and jitter counts on its own. Measured against your hand size, so it holds at any distance from the camera."
          >
            <Slider
              min={0.1}
              max={1.5}
              step={0.05}
              value={settings.sensitivity}
              onChange={(v) => update("sensitivity", v)}
              format={(v) => `${v.toFixed(2)}x`}
            />
          </Row>

          <Row
            label="Smoothing"
            hint="Steadies jittery landmarks. Raise it if the count flickers, lower it if fast reps feel late."
          >
            <Slider
              min={0}
              max={1}
              step={0.05}
              value={settings.smoothing}
              onChange={(v) => update("smoothing", v)}
              format={(v) => (v === 0 ? "off" : `${Math.round(v * 100)}%`)}
            />
          </Row>

          <Row label="Debounce" hint="Minimum gap between swaps. Raise it if jitter double-counts.">
            <Slider
              min={30}
              max={400}
              step={10}
              value={settings.cooldownMs}
              onChange={(v) => update("cooldownMs", v)}
              format={(v) => `${v} ms`}
            />
          </Row>

          <Row label="Camera" hint="Which device to capture from.">
            <select
              value={settings.deviceId ?? ""}
              onChange={(e) => update("deviceId", e.target.value || null)}
              className="w-56 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm outline-none focus:border-[#22e0ff]/70"
            >
              <option value="">Default camera</option>
              {cameras.map((c, i) => (
                <option key={c.deviceId} value={c.deviceId}>
                  {c.label || `Camera ${i + 1}`}
                </option>
              ))}
            </select>
          </Row>

          <Toggle
            label="Rhythm assist"
            hint="Once you settle into a tempo, a swap the camera misses is filled in from the beat instead of dropped. Turn it off to count only what the camera actually sees."
            value={settings.prediction}
            onChange={(v) => update("prediction", v)}
          />

          <Row label="Live test" hint="Try the detector without touching your scores.">
            <Chip active={testing} onClick={() => setTesting((t) => !t)}>
              {testing ? "Stop" : "Start"}
            </Chip>
          </Row>

          {testing && (
            <div className="pt-2">
              <CameraPreview settings={settings} />
            </div>
          )}
        </Section>

        <Section title="Display & sound">
          <Toggle
            label="Mirror the camera"
            hint="Selfie view — your right hand appears on the right."
            value={settings.mirror}
            onChange={(v) => update("mirror", v)}
          />
          <Toggle
            label="Sound effects"
            hint="Blip on every count, jingle at the finish."
            value={settings.sound}
            onChange={(v) => update("sound", v)}
          />
        </Section>

        <Section title="Leaderboard">
          <Leaderboard
            entries={board}
            limit={100}
            emptyLabel="Nothing saved yet."
            onRemove={(id) => removeScore(id)}
          />
          <div className="flex flex-wrap gap-2 pt-4">
            <button
              type="button"
              onClick={() => {
                if (!confirmClear) {
                  setConfirmClear(true);
                  return;
                }
                clearLeaderboard();
                setConfirmClear(false);
              }}
              onBlur={() => setConfirmClear(false)}
              className={`rounded-full px-5 py-2 text-xs font-bold uppercase tracking-[0.15em] transition ${
                confirmClear
                  ? "bg-red-500 text-white"
                  : "border border-red-400/40 text-red-300 hover:bg-red-500/15"
              }`}
            >
              {confirmClear ? "Tap again to erase" : "Clear leaderboard"}
            </button>
            <button
              type="button"
              onClick={() => resetSettings()}
              className="rounded-full border border-white/15 px-5 py-2 text-xs font-bold uppercase tracking-[0.15em] text-white/60 transition hover:border-white/35 hover:text-white"
            >
              Reset settings
            </button>
          </div>
        </Section>

        <p className="pb-6 pt-2 text-center text-xs text-white/30">
          Scores and settings live in this browser&apos;s local storage only.
        </p>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel mb-5 rounded-2xl p-5">
      <h2 className="mb-4 text-xs font-bold uppercase tracking-[0.25em] text-white/55">{title}</h2>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{label}</p>
        {hint && <p className="mt-0.5 text-xs leading-relaxed text-white/40">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-lg px-3 py-1.5 text-xs font-bold uppercase tracking-[0.1em] transition ${
        active
          ? "bg-[#22e0ff] text-[#05050a]"
          : "border border-white/15 text-white/60 hover:border-white/35 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

function Slider({
  min,
  max,
  step,
  value,
  onChange,
  format,
}: {
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
}) {
  return (
    <div className="flex w-56 items-center gap-3">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-white/15 accent-[#22e0ff]"
      />
      <span className="w-14 shrink-0 text-right font-mono text-xs tabular-nums text-white/60">
        {format(value)}
      </span>
    </div>
  );
}

function Toggle({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <Row label={label} hint={hint}>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label={label}
        onClick={() => onChange(!value)}
        className={`relative h-7 w-12 rounded-full transition ${value ? "bg-[#22e0ff]" : "bg-white/15"}`}
      >
        <span
          className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-all ${
            value ? "left-6" : "left-1"
          }`}
        />
      </button>
    </Row>
  );
}
