const { test } = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const {
  parseTriggerRequest,
  parseEvery,
  TRIGGER_REQUEST_MIN_INTERVAL_MS,
  TRIGGER_REQUEST_MAX_INTERVAL_MS
} = loadTs('src/main/triggerRequests.ts');

test('parseEvery understands minutes, unit strings and words', () => {
  assert.equal(parseEvery(30), 30 * 60_000);
  assert.equal(parseEvery('30m'), 30 * 60_000);
  assert.equal(parseEvery('2h'), 2 * 3_600_000);
  assert.equal(parseEvery('1d'), 86_400_000);
  assert.equal(parseEvery('hourly'), 3_600_000);
  assert.equal(parseEvery('daily'), 24 * 3_600_000);
  assert.equal(parseEvery('soon'), null);
  assert.equal(parseEvery(-5), null);
  assert.equal(parseEvery(undefined), null);
});

test('a minimal valid request becomes an armed boss mission marked BY RUDY', () => {
  const res = parseTriggerRequest({ label: 'nightly audit', prompt: 'run the audit', every: '24h' }, 'trg-x1');
  assert.equal(res.ok, true);
  assert.deepEqual(res.mission, {
    id: 'trg-x1',
    label: 'nightly audit',
    intervalMs: 24 * 3_600_000,
    to: 'boss',
    body: 'run the audit',
    enabled: true,
    origin: 'rudy'
  });
});

test('weekly form: days + time replace every', () => {
  const res = parseTriggerRequest(
    { label: 'standup', prompt: 'post the standup', days: [5, 1, 3, 1], time: '07:30', to: 'broadcast' },
    'trg-w'
  );
  assert.equal(res.ok, true);
  assert.deepEqual(res.mission.weekly, { days: [1, 3, 5], minute: 7 * 60 + 30 });
  assert.equal(res.mission.to, 'broadcast');
  // intervalMs stays on the record so the UI can switch back to interval mode.
  assert.equal(res.mission.intervalMs > 0, true);
});

test('rejects missing label/prompt, bad cadence, bad time, non-objects', () => {
  assert.equal(parseTriggerRequest(null, 'i').ok, false);
  assert.equal(parseTriggerRequest([], 'i').ok, false);
  assert.equal(parseTriggerRequest({ prompt: 'p', every: '1h' }, 'i').ok, false);
  assert.equal(parseTriggerRequest({ label: 'l', every: '1h' }, 'i').ok, false);
  assert.equal(parseTriggerRequest({ label: 'l', prompt: 'p' }, 'i').ok, false);
  assert.equal(parseTriggerRequest({ label: 'l', prompt: 'p', every: 'whenever' }, 'i').ok, false);
  assert.equal(parseTriggerRequest({ label: 'l', prompt: 'p', days: [9], time: '07:00' }, 'i').ok, false);
  assert.equal(parseTriggerRequest({ label: 'l', prompt: 'p', days: [1], time: '25:00' }, 'i').ok, false);
});

test('cadence guardrails: floor 5m, ceiling 7d', () => {
  const fast = parseTriggerRequest({ label: 'l', prompt: 'p', every: '1m' }, 'i');
  assert.equal(fast.ok, false);
  const slow = parseTriggerRequest({ label: 'l', prompt: 'p', every: '30d' }, 'i');
  assert.equal(slow.ok, false);
  const floor = parseTriggerRequest({ label: 'l', prompt: 'p', every: 5 }, 'i');
  assert.equal(floor.ok, true);
  assert.equal(floor.mission.intervalMs, TRIGGER_REQUEST_MIN_INTERVAL_MS);
  const ceil = parseTriggerRequest({ label: 'l', prompt: 'p', every: '7d' }, 'i');
  assert.equal(ceil.ok, true);
  assert.equal(ceil.mission.intervalMs, TRIGGER_REQUEST_MAX_INTERVAL_MS);
});

test('enabled: false is honored; overlong fields are rejected', () => {
  const off = parseTriggerRequest({ label: 'l', prompt: 'p', every: '1h', enabled: false }, 'i');
  assert.equal(off.ok, true);
  assert.equal(off.mission.enabled, false);
  assert.equal(parseTriggerRequest({ label: 'x'.repeat(81), prompt: 'p', every: '1h' }, 'i').ok, false);
  assert.equal(parseTriggerRequest({ label: 'l', prompt: 'x'.repeat(4001), every: '1h' }, 'i').ok, false);
});
