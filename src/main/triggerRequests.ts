/**
 * TRIGGER REQUESTS — the file protocol that lets the boss create schedules.
 *
 * The triggers UI is renderer-owned IPC, which the boss (a CLI in a pty) cannot
 * reach. So schedules get the same door workers got: the boss drops ONE JSON
 * file into HIVE_ROOT/trigger-requests/, the watcher in index.ts validates it
 * with `parseTriggerRequest` below, merges the result into `config.missions`,
 * and archives the file to `.done/` (or `.failed/` with a sidecar note).
 *
 * Shape (documented for the boss in PROTOCOL.md, "Scheduling a trigger"):
 *   {
 *     "label":  "nightly repo audit",              required, <= 80 chars
 *     "prompt": "Run the audit skill and ...",     required, <= 4000 chars
 *     "to":     "boss",                            optional, default "boss"
 *     "every":  "24h" | "30m" | 90,                interval form (number = minutes)
 *     "days":   [1,2,3,4,5], "time": "07:30",      weekly form (replaces `every`)
 *     "enabled": true                              optional, default true
 *   }
 *
 * Validation is deliberately pure (no fs, no Date.now) so tests can cover every
 * rejection path without a hive on disk.
 */

import type { ScheduledMission } from './config';

/** Guardrails: a runaway boss must not be able to arm a machine-gun schedule. */
export const TRIGGER_REQUEST_MIN_INTERVAL_MS = 5 * 60_000; // 5 minutes
export const TRIGGER_REQUEST_MAX_INTERVAL_MS = 7 * 24 * 3_600_000; // a week
const MAX_LABEL = 80;
const MAX_PROMPT = 4000;

export type TriggerRequestResult =
  | { ok: true; mission: ScheduledMission }
  | { ok: false; error: string };

/** '30m' / '2h' / '1d' / 'daily' / plain minutes → ms, or null when unreadable. */
export function parseEvery(every: unknown): number | null {
  if (typeof every === 'number' && Number.isFinite(every) && every > 0) {
    return Math.round(every * 60_000);
  }
  if (typeof every !== 'string') return null;
  const t = every.trim().toLowerCase();
  if (t === 'daily') return 24 * 3_600_000;
  if (t === 'hourly') return 3_600_000;
  const m = /^(\d+(?:\.\d+)?)\s*(m|min|h|hr|d)$/.exec(t);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = m[2][0];
  return Math.round(n * (unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000));
}

/** 'HH:MM' → minute-of-day, or null. */
function parseTime(time: unknown): number | null {
  if (typeof time !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Validate one dropped request into a ready-to-persist mission.
 *
 * `id` comes from the request FILENAME (trg-<basename>) so re-dropping the same
 * file updates the same mission instead of stacking duplicates.
 */
export function parseTriggerRequest(raw: unknown, id: string): TriggerRequestResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'request must be a JSON object' };
  }
  const r = raw as Record<string, unknown>;

  const label = typeof r.label === 'string' ? r.label.trim() : '';
  if (!label) return { ok: false, error: 'missing "label"' };
  if (label.length > MAX_LABEL) return { ok: false, error: `"label" longer than ${MAX_LABEL} chars` };

  const prompt = typeof r.prompt === 'string' ? r.prompt.trim() : '';
  if (!prompt) return { ok: false, error: 'missing "prompt"' };
  if (prompt.length > MAX_PROMPT) return { ok: false, error: `"prompt" longer than ${MAX_PROMPT} chars` };

  const to = typeof r.to === 'string' && r.to.trim() ? r.to.trim() : 'boss';

  // Weekly form wins when present; otherwise the interval form is required.
  let weekly: ScheduledMission['weekly'];
  let intervalMs: number;
  if (r.days !== undefined || r.time !== undefined) {
    const days = Array.isArray(r.days)
      ? [...new Set(r.days.filter((d): d is number => typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= 6))]
      : [];
    if (!days.length) return { ok: false, error: '"days" must list weekdays 0-6 (0 = Sunday)' };
    const minute = parseTime(r.time);
    if (minute === null) return { ok: false, error: '"time" must be "HH:MM" (24h)' };
    weekly = { days: days.sort((a, b) => a - b), minute };
    // Kept on the record so switching the mission back to interval mode in the
    // UI restores a sane cadence (mirrors the SCHEDULES panel behaviour).
    intervalMs = 24 * 3_600_000;
  } else {
    const ms = parseEvery(r.every);
    if (ms === null) return { ok: false, error: '"every" must be minutes, "30m", "2h", "1d", "hourly" or "daily" (or use "days"+"time")' };
    if (ms < TRIGGER_REQUEST_MIN_INTERVAL_MS) return { ok: false, error: 'shortest allowed cadence is 5m' };
    if (ms > TRIGGER_REQUEST_MAX_INTERVAL_MS) return { ok: false, error: 'longest allowed cadence is 7d — use "days"+"time" for weekly slots' };
    intervalMs = ms;
  }

  const enabled = typeof r.enabled === 'boolean' ? r.enabled : true;

  return {
    ok: true,
    mission: {
      id,
      label,
      intervalMs,
      ...(weekly ? { weekly } : {}),
      to,
      body: prompt,
      enabled,
      origin: 'rudy'
    }
  };
}
