/**
 * The blank-office bug.
 *
 * Chromium caps live WebGL contexts per renderer process (~16) and evicts the
 * OLDEST when a new one pushes past the cap. The office floor's context is
 * created at app startup, so it is always the oldest; every terminal xterm opens
 * takes another one (@xterm/addon-webgl). On a busy floor the office is evicted,
 * Pixi says nothing at all, and the canvas is blank until the app restarts.
 *
 * CONFIRMED against the shipped v0.3.5 build over CDP: creating 24 extra WebGL
 * contexts produced "WARNING: Too many active WebGL contexts. Oldest context will
 * be lost." and fired `webglcontextlost` on the office canvas, while the terminal
 * logged its own graceful "[terminal] webgl context lost — falling back to DOM
 * renderer". The office had no such fallback. These tests pin the one it has now.
 */
const test = require('node:test');
const assert = require('node:assert');
const load = require('./load-ts.cjs');

const {
  installContextLossRecovery, DEFAULT_MAX_REBUILDS, DEFAULT_REBUILD_DELAY_MS
} = load('src/renderer/src/scene/office/glRecovery.ts');

/** A canvas stand-in: EventTarget is all the recovery code touches. */
function fakeCanvas() { return new EventTarget(); }
function lose(canvas) {
  // cancelable so defaultPrevented actually reports whether preventDefault ran —
  // that call is what allows the browser to hand the context back at all.
  const e = new Event('webglcontextlost', { cancelable: true });
  canvas.dispatchEvent(e);
  return e;
}
/** Collect scheduled callbacks instead of waiting on real timers. */
function fakeClock() {
  const queue = [];
  return {
    schedule: (fn, ms) => { queue.push({ fn, ms }); return queue.length; },
    runAll: () => { const q = queue.splice(0); q.forEach((j) => j.fn()); return q; },
    get pending() { return queue.length; },
    get delays() { return queue.map((j) => j.ms); }
  };
}

test('a lost context rebuilds the scene instead of leaving it blank', () => {
  const canvas = fakeCanvas();
  const clock = fakeClock();
  let rebuilds = 0;
  installContextLossRecovery(canvas, { onRebuild: () => rebuilds++, schedule: clock.schedule, log: () => {} });

  lose(canvas);
  assert.equal(rebuilds, 0, 'rebuild must be deferred, not immediate');
  assert.equal(clock.pending, 1);
  clock.runAll();
  assert.equal(rebuilds, 1, 'the scene never came back');
});

test('preventDefault is called — without it the context is gone for good', () => {
  const canvas = fakeCanvas();
  installContextLossRecovery(canvas, { onRebuild: () => {}, schedule: () => {}, log: () => {} });
  assert.equal(lose(canvas).defaultPrevented, true);
});

test('the rebuild is delayed so it does not race the eviction storm', () => {
  const canvas = fakeCanvas();
  const clock = fakeClock();
  installContextLossRecovery(canvas, { onRebuild: () => {}, schedule: clock.schedule, log: () => {} });
  lose(canvas);
  // Several contexts are usually created at once; claiming one straight back
  // just loses it again to the next terminal in the same burst.
  assert.ok(clock.delays[0] >= 500, `rebuild delay too short: ${clock.delays[0]}`);
  assert.equal(clock.delays[0], DEFAULT_REBUILD_DELAY_MS);
});

test('retries are capped, then it gives up LOUDLY rather than staying blank', () => {
  const canvas = fakeCanvas();
  const clock = fakeClock();
  let rebuilds = 0, gaveUp = 0;
  const logs = [];
  installContextLossRecovery(canvas, {
    onRebuild: () => rebuilds++, onGiveUp: () => gaveUp++,
    schedule: clock.schedule, log: (m) => logs.push(m)
  });

  for (let i = 0; i < DEFAULT_MAX_REBUILDS; i++) { lose(canvas); clock.runAll(); }
  assert.equal(rebuilds, DEFAULT_MAX_REBUILDS);
  assert.equal(gaveUp, 0, 'gave up while it still had budget');

  lose(canvas);
  clock.runAll();
  assert.equal(gaveUp, 1, 'a silently blank canvas is the bug — it must surface');
  assert.equal(rebuilds, DEFAULT_MAX_REBUILDS, 'kept rebuilding past the cap');

  // And it stays given-up: no infinite fight for a context we cannot keep.
  lose(canvas); clock.runAll();
  assert.equal(gaveUp, 1);
  assert.equal(rebuilds, DEFAULT_MAX_REBUILDS);
  assert.ok(logs.some((m) => /giving up/i.test(m)), 'nothing explains the blank floor');
});

test('uninstalling stops recovery — a torn-down scene must not resurrect itself', () => {
  const canvas = fakeCanvas();
  const clock = fakeClock();
  let rebuilds = 0;
  const off = installContextLossRecovery(canvas, { onRebuild: () => rebuilds++, schedule: clock.schedule, log: () => {} });

  // Loss already in flight when the component unmounts: the queued rebuild must
  // not fire against a destroyed Pixi app.
  lose(canvas);
  off();
  clock.runAll();
  assert.equal(rebuilds, 0, 'rebuilt after teardown');

  lose(canvas);
  assert.equal(clock.pending, 0, 'still listening after uninstall');
});

test('recovery survives repeated losses across rebuilds, one budget per install', () => {
  const canvas = fakeCanvas();
  const clock = fakeClock();
  let rebuilds = 0;
  installContextLossRecovery(canvas, { onRebuild: () => rebuilds++, schedule: clock.schedule, log: () => {}, maxRebuilds: 1 });
  lose(canvas); clock.runAll();
  assert.equal(rebuilds, 1);
  // A fresh install (what the next mount does) gets its own budget.
  const canvas2 = fakeCanvas();
  installContextLossRecovery(canvas2, { onRebuild: () => rebuilds++, schedule: clock.schedule, log: () => {}, maxRebuilds: 1 });
  lose(canvas2); clock.runAll();
  assert.equal(rebuilds, 2);
});
