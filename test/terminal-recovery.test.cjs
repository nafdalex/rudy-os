'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const {
  createTerminalRecoveryState,
  normalizePtyChunk,
  requestInitialPtyRedraw,
  scheduleWebglRecovery,
  terminalInstanceKey
} = loadTs('src/renderer/src/components/terminalRecovery.ts');

test('terminal generation creates a new instance for the same PTY', () => {
  assert.equal(terminalInstanceKey('pty-agent', 0), 'pty-agent:0');
  assert.equal(terminalInstanceKey('pty-agent', 1), 'pty-agent:1');
});

test('terminal output accepts current and pre-revert message shapes', () => {
  assert.equal(normalizePtyChunk('current'), 'current');
  assert.equal(normalizePtyChunk({ seq: 7, data: 'pre-revert' }), 'pre-revert');
  assert.equal(normalizePtyChunk({ data: 7 }), '');
});

test('initial attach requests exactly one PTY redraw', () => {
  const state = createTerminalRecoveryState();
  let redraws = 0;
  assert.equal(requestInitialPtyRedraw(state, () => { redraws++; }), true);
  assert.equal(requestInitialPtyRedraw(state, () => { redraws++; }), false);
  assert.equal(redraws, 1);
});

test('WebGL recovery is deduped and repaints after two frames', () => {
  const state = createTerminalRecoveryState();
  const frames = [];
  let repaints = 0;
  const requestFrame = (cb) => frames.push(cb);

  assert.equal(scheduleWebglRecovery(state, requestFrame, () => { repaints++; }), true);
  assert.equal(scheduleWebglRecovery(state, requestFrame, () => { repaints++; }), false);
  assert.equal(frames.length, 1);
  frames.shift()();
  assert.equal(repaints, 0);
  assert.equal(frames.length, 1);
  frames.shift()();
  assert.equal(repaints, 1);
  assert.equal(state.webglRecoveryPending, false);
});
