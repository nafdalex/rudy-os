/**
 * Surviving a lost WebGL context.
 *
 * Chromium caps how many WebGL contexts one renderer process may hold (~16) and,
 * when a new one pushes past the cap, it EVICTS THE OLDEST — logging only
 * "WARNING: Too many active WebGL contexts. Oldest context will be lost."
 *
 * The office floor's context is created at app startup, so it is always the
 * oldest one alive. Every terminal xterm opens takes another context
 * (@xterm/addon-webgl), so on a busy floor — enough agents, or a second window —
 * the office is the first thing evicted. Pixi does not notice: no exception, no
 * rejected promise, no failure banner. The canvas simply stops drawing and the
 * office goes blank until the app is restarted. That is the blank-office bug.
 *
 * xterm already handles this by falling back to its DOM renderer. Pixi has no
 * such fallback, so the scene has to be rebuilt instead. This module is only the
 * event wiring, kept separate from OfficeFloor so the recovery policy — cancel
 * the event, debounce, cap the retries, give up loudly — is testable against a
 * plain EventTarget with no browser, no GPU and no Pixi.
 */

export interface GlRecoveryOptions {
  /** Rebuild attempts before we stop fighting for a context. */
  maxRebuilds?: number;
  /** Wait before rebuilding: the eviction arrives mid-storm (several contexts
   *  are usually created at once), and claiming one back immediately just races
   *  the terminals that displaced us. */
  delayMs?: number;
  /** Rebuild the scene (in OfficeFloor: bump the effect's generation dep). */
  onRebuild: () => void;
  /** Called once, when the retry budget is spent — the caller should say
   *  something visible rather than leaving a silently blank canvas. */
  onGiveUp?: () => void;
  /** Injectable for tests. */
  schedule?: (fn: () => void, ms: number) => unknown;
  log?: (msg: string) => void;
}

export const DEFAULT_MAX_REBUILDS = 3;
export const DEFAULT_REBUILD_DELAY_MS = 1500;

/** Listen for context loss on `canvas` and rebuild. Returns an uninstall fn;
 *  call it from the effect cleanup so a torn-down scene stops responding. */
export function installContextLossRecovery(
  canvas: EventTarget,
  opts: GlRecoveryOptions
): () => void {
  const max = opts.maxRebuilds ?? DEFAULT_MAX_REBUILDS;
  const delay = opts.delayMs ?? DEFAULT_REBUILD_DELAY_MS;
  const schedule = opts.schedule ?? ((fn, ms) => setTimeout(fn, ms));
  const log = opts.log ?? ((m: string) => console.warn(m));

  let rebuilds = 0;
  let live = true;

  const onLost = (e: Event) => {
    // WITHOUT preventDefault the browser will never hand the context back — the
    // canvas is dead for good. This one line is the difference between a
    // recoverable scene and a permanently blank one.
    e.preventDefault();
    if (!live) return;
    if (rebuilds >= max) {
      log(`[OfficeFloor] WebGL context lost again after ${max} rebuilds, too many live contexts on this floor; giving up until restart`);
      opts.onGiveUp?.();
      live = false;
      return;
    }
    rebuilds += 1;
    log(`[OfficeFloor] WebGL context lost (Chromium evicted the oldest context), rebuilding the scene, attempt ${rebuilds}/${max}`);
    schedule(() => { if (live) opts.onRebuild(); }, delay);
  };

  canvas.addEventListener('webglcontextlost', onLost as EventListener, false);
  return () => {
    live = false;
    canvas.removeEventListener('webglcontextlost', onLost as EventListener, false);
  };
}
