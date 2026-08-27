import { useSyncExternalStore } from 'react';

/** The terminal zoom level, shared by every component that should scale with it.
 *
 *  It used to be component-local state inside PtyTerminalView, persisted to
 *  localStorage. That kept the xterm panes in sync only because each one read the
 *  stored value at mount — anything OUTSIDE the terminal (notably the message
 *  composer) could not follow the user's Cmd +/- at all, so on a large display the
 *  terminal text grew while the box you type into stayed at its hardcoded 13px.
 *  Holding the value in one module with subscribers makes the zoom a first-class
 *  app-wide setting: PtyTerminalView writes it, anyone can read it live. */

export const DEFAULT_TERMINAL_FONT_SIZE = 12;
export const MIN_TERMINAL_FONT_SIZE = 8;
export const MAX_TERMINAL_FONT_SIZE = 40;

const LS_FONT_SIZE = 'cth.ptyFontSize';

function load(): number {
  try {
    const n = parseInt(window.localStorage.getItem(LS_FONT_SIZE) ?? '', 10);
    if (!Number.isNaN(n) && n >= MIN_TERMINAL_FONT_SIZE && n <= MAX_TERMINAL_FONT_SIZE) return n;
  } catch { /* noop */ }
  return DEFAULT_TERMINAL_FONT_SIZE;
}

let current = load();
const listeners = new Set<() => void>();

export function getTerminalFontSize(): number {
  return current;
}

/** Set the shared zoom level (clamped) and persist it. No-op when unchanged, so
 *  a redundant set can't churn every subscriber's effects. */
export function setTerminalFontSize(next: number): number {
  const clamped = Math.min(MAX_TERMINAL_FONT_SIZE, Math.max(MIN_TERMINAL_FONT_SIZE, Math.round(next)));
  if (clamped === current) return current;
  current = clamped;
  try { window.localStorage.setItem(LS_FONT_SIZE, String(clamped)); } catch { /* noop */ }
  for (const l of [...listeners]) l();
  return clamped;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Live terminal font size. Re-renders the caller whenever the zoom changes,
 *  wherever it was changed from. */
export function useTerminalFontSize(): number {
  return useSyncExternalStore(subscribe, getTerminalFontSize, getTerminalFontSize);
}
