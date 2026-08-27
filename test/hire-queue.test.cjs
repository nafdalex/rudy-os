'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const {
  EMPTY_HIRE_QUEUE,
  clearHireQueue,
  enqueueHires,
  finishCurrentHire,
  hireQueueProgress
} = loadTs('src/shared/hireQueue.ts');

const hire = (name) => ({ spec: 'rudy-os/hire@1', name });

test('queued hires preserve arrival order across batches instead of overwriting', () => {
  const first = enqueueHires(EMPTY_HIRE_QUEUE, [hire('Theo'), hire('Ines')]);
  const appended = enqueueHires(first, [hire('Sam'), hire('Lena')]);

  assert.deepEqual(appended.pending.map((m) => m.name), ['Theo', 'Ines', 'Sam', 'Lena']);
  assert.deepEqual(first.pending.map((m) => m.name), ['Theo', 'Ines'], 'enqueue is immutable');
  assert.deepEqual(hireQueueProgress(appended), { current: 1, total: 4 });
});

test('spawn or skip advances exactly one hire and keeps progress stable', () => {
  let queue = enqueueHires(EMPTY_HIRE_QUEUE, [hire('Theo'), hire('Ines'), hire('Sam')]);

  queue = finishCurrentHire(queue);
  assert.deepEqual(queue.pending.map((m) => m.name), ['Ines', 'Sam']);
  assert.deepEqual(hireQueueProgress(queue), { current: 2, total: 3 });

  queue = finishCurrentHire(queue);
  assert.deepEqual(queue.pending.map((m) => m.name), ['Sam']);
  assert.deepEqual(hireQueueProgress(queue), { current: 3, total: 3 });
});

test('draining the queue resets progress for the next independent import', () => {
  const one = enqueueHires(EMPTY_HIRE_QUEUE, [hire('Theo')]);
  const drained = finishCurrentHire(one);
  const next = enqueueHires(drained, [hire('Ines'), hire('Sam')]);

  assert.deepEqual(drained, EMPTY_HIRE_QUEUE);
  assert.deepEqual(hireQueueProgress(drained), null);
  assert.deepEqual(hireQueueProgress(next), { current: 1, total: 2 });
});

test('cancelling review discards the remaining batch and resets later progress', () => {
  let queue = enqueueHires(EMPTY_HIRE_QUEUE, [hire('Theo'), hire('Ines'), hire('Sam')]);
  queue = finishCurrentHire(queue);

  const cancelled = clearHireQueue(queue);
  const fresh = enqueueHires(cancelled, [hire('Lena'), hire('Kofi')]);

  assert.deepEqual(cancelled, EMPTY_HIRE_QUEUE);
  assert.deepEqual(fresh.pending.map((m) => m.name), ['Lena', 'Kofi']);
  assert.deepEqual(hireQueueProgress(fresh), { current: 1, total: 2 });
});

test('empty arrivals and advances do not invent queue state', () => {
  assert.deepEqual(enqueueHires(EMPTY_HIRE_QUEUE, []), EMPTY_HIRE_QUEUE);
  assert.deepEqual(finishCurrentHire(EMPTY_HIRE_QUEUE), EMPTY_HIRE_QUEUE);
});
