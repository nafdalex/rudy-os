/**
 * The IDE's shared bar chrome.
 *
 * These three style objects were previously private to IdePanel, which was fine
 * while IdePanel rendered every pane itself. The image preview renders its own
 * bar, and a second copy of "padding 3px 8px, cream-200, ink-700 hairline" would
 * drift the moment either file was touched — the two bars sit directly on top of
 * each other in the same tab strip, so any drift is immediately visible. One
 * definition, imported by both.
 *
 * Every colour is a token, never a literal: the app ships a light AND a dark
 * theme that swap by redefining these variables, so a hardcoded hex here would
 * look correct in exactly one of them.
 */
import type { CSSProperties } from 'react';

/** The horizontal bar above an editor / preview body. */
export const ideBarStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, padding: '3px 8px',
  background: 'var(--cth-cream-200)', borderBottom: '1px solid var(--cth-ink-700)',
  fontFamily: 'var(--cth-font-ui)', fontSize: 12, color: 'var(--cth-ink-700)'
};

/** Square, borderless button that holds only an icon. */
export const ideIconBtn: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  padding: 0, width: 18, height: 18, background: 'transparent', border: 'none',
  cursor: 'pointer', color: 'var(--cth-ink-500)'
};

/** Small labelled button used for bar actions (save, copy path, view toggles). */
export const ideTextBtn: CSSProperties = {
  padding: '0 6px', height: 20, fontFamily: 'var(--cth-font-ui)', fontSize: 12,
  color: 'var(--cth-ink-900)', background: 'var(--cth-cream-100)', border: 'none',
  boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)', cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 4
};
