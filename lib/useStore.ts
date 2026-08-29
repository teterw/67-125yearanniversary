"use client";

import { useSyncExternalStore } from "react";
import {
  BOARD_EVENT,
  DEFAULT_SETTINGS,
  SETTINGS_EVENT,
  loadLeaderboard,
  loadSettings,
  syncLeaderboard,
  type ScoreEntry,
  type Settings,
} from "./storage";

/**
 * localStorage is an external store, so React reads it through
 * useSyncExternalStore rather than mirroring it into state. Writes anywhere in
 * the app dispatch the events below; every subscribed component re-reads.
 */

const EMPTY_BOARD: ScoreEntry[] = [];

function makeStore<T>(read: () => T, serverValue: T, event: string, onFirstSubscribe?: () => void) {
  let cache: T | null = null;
  const listeners = new Set<() => void>();

  const invalidate = () => {
    cache = null;
    for (const listener of listeners) listener();
  };

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (listeners.size === 1) {
        window.addEventListener(event, invalidate);
        // Fires when another tab writes; keeps two open windows in step.
        window.addEventListener("storage", invalidate);
        onFirstSubscribe?.();
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          window.removeEventListener(event, invalidate);
          window.removeEventListener("storage", invalidate);
        }
      };
    },
    // Cached so the identity stays stable between writes.
    getSnapshot: (): T => (cache ??= read()),
    getServerSnapshot: () => serverValue,
  };
}

const settingsStore = makeStore<Settings>(loadSettings, DEFAULT_SETTINGS, SETTINGS_EVENT);
/** Refetch cadence while someone is looking at a board, so a rival's new time shows up. */
const BOARD_POLL_MS = 15000;
let boardPoll: number | null = null;

const boardStore = makeStore<ScoreEntry[]>(loadLeaderboard, EMPTY_BOARD, BOARD_EVENT, () => {
  const pull = () => void syncLeaderboard().catch(() => {});
  pull();
  if (boardPoll === null) boardPoll = window.setInterval(pull, BOARD_POLL_MS);
});

export function useSettings(): Settings {
  return useSyncExternalStore(
    settingsStore.subscribe,
    settingsStore.getSnapshot,
    settingsStore.getServerSnapshot,
  );
}

export function useLeaderboard(): ScoreEntry[] {
  return useSyncExternalStore(
    boardStore.subscribe,
    boardStore.getSnapshot,
    boardStore.getServerSnapshot,
  );
}
