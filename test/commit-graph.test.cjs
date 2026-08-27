'use strict';

// Lane layout for the commit history rail. Untested while it sat unused; now it
// is what the graph actually renders from, so the shapes it has to get right are
// pinned here.

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { layoutGraph, LANE_COLORS } = loadTs('src/renderer/src/components/git/graph.ts');

/** `c('a', 'b')` = commit a whose parent is b. Newest first, as git log emits. */
const c = (sha, ...parents) => ({ sha, parents });
const laneOf = (out, sha) => out.rows.find((r) => r.sha === sha).lane;

test('linear history stays in a single lane', () => {
  const out = layoutGraph([c('a', 'b'), c('b', 'c'), c('c')]);
  assert.deepEqual(out.rows.map((r) => r.lane), [0, 0, 0]);
  assert.equal(out.maxLane, 0);
});

test('a merge sends the SECOND parent to a fresh lane', () => {
  // m has two parents; the first continues m's lane, the side branch forks.
  const out = layoutGraph([c('m', 'p1', 'p2'), c('p1', 'base'), c('p2', 'base'), c('base')]);
  assert.equal(laneOf(out, 'm'), 0);
  assert.equal(laneOf(out, 'p1'), 0, 'first parent keeps the lane');
  assert.notEqual(laneOf(out, 'p2'), 0, 'second parent forks');
  assert.ok(out.maxLane >= 1);
});

test('a lane is reused once its branch is exhausted', () => {
  // side ends at its root, so the lane it held is free for a later fork.
  const out = layoutGraph([
    c('m', 'p1', 'side'),
    c('side'),          // root — releases its lane
    c('p1', 'p2'),
    c('p2', 'x', 'y'),  // forks again; should reclaim the freed lane
    c('x'), c('y')
  ]);
  assert.ok(out.maxLane <= 1, `expected lanes to be reused, got maxLane ${out.maxLane}`);
});

test('a parent outside the window does not widen the graph', () => {
  // The newest commit's parent was not fetched — common with `git log -n`.
  const out = layoutGraph([c('a', 'missing')]);
  assert.equal(laneOf(out, 'a'), 0);
  assert.equal(out.maxLane, 0);
});

test('every row reports the lane each of its parents landed in', () => {
  const out = layoutGraph([c('m', 'p1', 'p2'), c('p1'), c('p2')]);
  const m = out.rows.find((r) => r.sha === 'm');
  assert.equal(m.parents.length, 2);
  assert.equal(m.parents[0].lane, laneOf(out, 'p1'));
  assert.equal(m.parents[1].lane, laneOf(out, 'p2'));
});

test('an empty history is not a crash', () => {
  const out = layoutGraph([]);
  assert.deepEqual(out.rows, []);
  assert.equal(out.maxLane, 0);
});

test('lane colours are design tokens, so the rail follows the theme', () => {
  assert.ok(LANE_COLORS.length > 0);
  for (const col of LANE_COLORS) assert.match(col, /^var\(--cth-/);
});
