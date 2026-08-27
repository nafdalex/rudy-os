'use strict';

/**
 * Boss has to know the LIVE floor across its own restarts — a roster it read once
 * goes stale, and it then messages agents that were archived or killed. So the
 * roster is PUSHED into boss's context (SessionStart + every prompt) rather than
 * pulled.
 *
 * Only one `additionalContext` may be returned per hook, so the roster and the
 * operator-steer path must MERGE — otherwise they silently displace each other.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

// hooks.ts pulls Notification from electron; outside Electron that resolve gives
// a path string, so seed the cache with the surface the server actually touches.
const electron = require.resolve('electron');
require.cache[electron] = {
  id: electron,
  filename: electron,
  loaded: true,
  exports: { Notification: class { show() {} static isSupported() { return false; } } }
};

const { HiveManager } = loadTs('src/main/hive.ts');
const { HookServer } = loadTs('src/main/hooks.ts');

const CONFIG = { notifications: false };

function tmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'md-roster-inj-'));
}

async function floor(t, { steer } = {}) {
  const home = tmpHome();
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'boss-1', name: 'Rudy', provider: 'claude', cwd: home, isBoss: true });
  await hive.ensureAgent({ id: 'theo-1', name: 'Theo', provider: 'claude', cwd: home });

  const control = steer
    ? { takeSteer: (id) => (id === 'boss-1' ? steer : null), shouldHalt: () => false, toolDecision: () => ({ deny: false }) }
    : undefined;
  const server = new HookServer(hive, () => null, () => CONFIG, control, undefined);
  const fire = (agent_id, hook_event_name, extra = {}) => server.handle({ agent_id, hook_event_name, session_id: 's1', ...extra });
  return { home, hive, server, fire };
}

function snapshot(hive) {
  hive.writeFleetSnapshot({
    ts: Date.now() - 4000,
    agents: [
      { id: 'boss-1', name: 'Rudy', role: 'orchestrator', isBoss: true, breaker: 'ok', tokens: 812_400, usd: 4.2199, lastActiveSecAgo: 6, inboxBacklog: 2 },
      { id: 'theo-1', name: 'Theo', role: 'agent', breaker: 'warn', tokens: 120_401, usd: 1.0231, lastActiveSecAgo: 240, inboxBacklog: 0 },
      { id: 'ines-1', name: 'Ines', role: 'agent', breaker: 'ok', tokens: 0, usd: 0, lastActiveSecAgo: null, inboxBacklog: 0 }
    ]
  });
}

const context = (res) => res?.hookSpecificOutput?.additionalContext ?? '';

test('the roster line carries the whole floor and its state', async (t) => {
  const { hive } = await floor(t);
  assert.equal(hive.rosterContext(), null, 'no snapshot yet — inject nothing rather than noise');

  snapshot(hive);
  const line = hive.rosterContext();

  assert.ok(!line.includes('\n'), 'must stay a single compact line');
  for (const id of ['boss-1', 'theo-1', 'ines-1']) assert.ok(line.includes(id), `missing ${id}`);
  assert.match(line, /812k tok/);
  assert.match(line, /\$4\.22/);
  assert.match(line, /inbox 2/);
  assert.match(line, /breaker warn/);
  assert.match(line, /boss-1[^;]*you/, 'boss has to be able to spot itself');
  assert.match(line, /no activity yet/, 'an agent that never ran must not read as "active never"');
  assert.match(line, /SUPERSEDES/, 'the point is to override what boss remembers');
  assert.ok(line.length < 1200, `too long for a 3-agent floor: ${line.length} chars`);
});

test('each agent line carries its live context-window occupancy (ctx NN%)', async (t) => {
  const { hive, fire } = await floor(t);
  snapshot(hive);

  // No Status tick yet — a bare direct call (no callback) must not add ctx.
  assert.ok(!hive.rosterContext().includes('ctx '), 'no occupancy when no statusLine tick has fired');

  // Seed live context-window accounting through the statusLine shim path.
  // boss-1: 62% of a 200k window; theo-1: 99% (near-full, the routing signal).
  await fire('boss-1', 'Status', { context_window: { total_input_tokens: 124000, context_window_size: 200000 } });
  await fire('theo-1', 'Status', { context_window: { total_input_tokens: 99000, context_window_size: 100000 } });

  // Read the roster the way boss actually receives it: injected on a prompt,
  // which is where HookServer layers the LIVE occupancy onto the disk snapshot.
  const line = context(await fire('boss-1', 'UserPromptSubmit'));
  assert.ok(line.includes('LIVE ROSTER'), 'roster injected on prompt');
  assert.match(line, /boss-1[^;]*ctx 62%/, 'boss line shows its own occupancy');
  assert.match(line, /theo-1[^;]*ctx 99%/, 'a near-full agent is flagged to boss');
  // ines-1 never fired a Status tick — its line must NOT get ctx.
  assert.match(line, /ines-1[^;]*\(agent, no activity yet\)/, 'no ctx for an agent with no Status data');
  assert.ok(!line.includes('\n'), 'still a single compact line');
});

test('renaming changes only the display name and reaches boss immediately', async (t) => {
  const { home, hive } = await floor(t);
  snapshot(hive);
  const agentDir = path.join(home, 'hive', 'agents', 'theo-1');
  const before = hive.registry().agents['theo-1'];

  const result = hive.renameAgent('theo-1', '  Kofi  ');

  assert.deepEqual(result, { ok: true, name: 'Kofi' });
  assert.deepEqual(hive.registry().agents['theo-1'], { ...before, name: 'Kofi' },
    'registry metadata must be unchanged apart from the display name');
  assert.equal(fs.existsSync(agentDir), true, 'the id-derived agent directory must not move');
  assert.match(hive.rosterContext(), /theo-1 "Kofi"/);
  assert.doesNotMatch(hive.rosterContext(), /theo-1 "Theo"/);
});

test('rename rejects empty and unknown agents without changing the registry', async (t) => {
  const { hive } = await floor(t);

  assert.equal(hive.renameAgent('theo-1', '   ').ok, false);
  assert.equal(hive.renameAgent('missing', 'Kofi').ok, false);
  assert.equal(hive.registry().agents['theo-1'].name, 'Theo');
});

test('boss gets the roster on SessionStart and on every prompt — nobody else does', async (t) => {
  const { hive, fire } = await floor(t);
  snapshot(hive);

  const start = await fire('boss-1', 'SessionStart');
  assert.match(context(start), /LIVE ROSTER/);
  assert.equal(start.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(context(await fire('boss-1', 'UserPromptSubmit')), /LIVE ROSTER/);

  assert.doesNotMatch(context(await fire('theo-1', 'SessionStart')), /LIVE ROSTER/);
  assert.doesNotMatch(context(await fire('theo-1', 'UserPromptSubmit')), /LIVE ROSTER/);
  assert.doesNotMatch(context(await fire('boss-1', 'PostToolUse')), /LIVE ROSTER/,
    'prompt boundaries only — not once per tool call');
});

test('a queued operator steer is not swallowed by the roster', async (t) => {
  const steer = 'OPERATOR: stop and summarize.';
  const { hive, fire } = await floor(t, { steer });
  snapshot(hive);

  const ctx = context(await fire('boss-1', 'UserPromptSubmit'));
  assert.match(ctx, /LIVE ROSTER/);
  assert.ok(ctx.includes(steer), 'only one additionalContext exists — the two must merge, not race');
});

test('a corrupt fleet.json degrades to no injection instead of throwing into a hook', async (t) => {
  const { home, hive, fire } = await floor(t);
  snapshot(hive);
  fs.writeFileSync(path.join(home, 'hive', 'fleet.json'), '{ not json');

  assert.equal(hive.rosterContext(), null);
  const res = await fire('boss-1', 'SessionStart');
  assert.doesNotMatch(context(res), /LIVE ROSTER/);
});

// --- 1:1 hold ---------------------------------------------------------------
// The human takes an agent aside. It keeps running and keeps its terminal, but
// Rudy has to stop routing to it — otherwise the human and the orchestrator
// are driving the same agent at once, which is how a 1:1 turns into a fight
// over the same terminal.

test('a held agent is marked in the roster and Rudy is told to route around it', async (t) => {
  const { hive } = await floor(t);
  snapshot(hive);
  assert.doesNotMatch(hive.rosterContext(), /ON HOLD/,
    'nothing says hold until something is held');

  assert.deepEqual(hive.setAgentHold('theo-1', true), { ok: true, onHold: true });

  const line = hive.rosterContext();
  assert.match(line, /theo-1 "Theo" \([^)]*ON HOLD/, 'the mark belongs on that agent, not the line');
  assert.match(line, /Do NOT message them/);
  assert.match(line, /do NOT dispatch to them/);
  assert.ok(!line.includes('\n'), 'still one compact line');
});

test('the hold reaches Rudy without waiting for the next fleet snapshot', async (t) => {
  const { home, hive } = await floor(t);
  snapshot(hive);
  hive.setAgentHold('theo-1', true);
  // The registry is the record, but the roster is injected from fleet.json, and
  // the periodic writer is 8s away. One more dispatch fits in 8s.
  const fleet = JSON.parse(fs.readFileSync(path.join(home, 'hive', 'fleet.json'), 'utf8'));
  assert.equal(fleet.agents.find((a) => a.id === 'theo-1').onHold, true);
});

test('releasing clears the mark and the whole instruction block', async (t) => {
  const { hive } = await floor(t);
  snapshot(hive);
  hive.setAgentHold('theo-1', true);
  assert.deepEqual(hive.setAgentHold('theo-1', false), { ok: true, onHold: false });

  const line = hive.rosterContext();
  assert.doesNotMatch(line, /ON HOLD/);
  assert.doesNotMatch(line, /Do NOT message them/,
    'the guidance must go with the last hold, or it reads as always-on and gets ignored');
});

test('holding is idempotent and a bad id is refused', async (t) => {
  const { hive } = await floor(t);
  assert.deepEqual(hive.setAgentHold('theo-1', true), { ok: true, onHold: true });
  assert.deepEqual(hive.setAgentHold('theo-1', true), { ok: true, onHold: true });
  assert.equal(hive.setAgentHold('nobody-here', true).ok, false);
});

test('the hold survives a restart, because the registry is the record', async (t) => {
  const { home, hive } = await floor(t);
  hive.setAgentHold('theo-1', true);
  const reg = JSON.parse(fs.readFileSync(path.join(home, 'hive', 'registry.json'), 'utf8'));
  assert.equal(reg.agents['theo-1'].onHold, true,
    'a hold that evaporated on restart would hand the agent back to Rudy silently');
});
