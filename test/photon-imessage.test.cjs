'use strict';

/**
 * The iMessage channel's safety rules — the ones that, if they broke, would turn
 * a phone line into an open shell or make an agent run the same instruction
 * twice:
 *
 *   1. the sender ALLOWLIST is the entire security boundary (iMessage carries no
 *      signature to verify), and it fails CLOSED — an empty list admits nobody,
 *      and a stranger is dropped without any reply that would confirm the line
 *      is live and automated;
 *   2. handles are compared canonically, so the number a human types matches the
 *      form Apple sends;
 *   3. delivery is AT-LEAST-ONCE, so an id seen twice is processed once — a
 *      redelivered directive must not run again after a reconnect;
 *   4. tapbacks route only from a real reaction, carrying the id of the message
 *      they were placed on (that pairing is the whole approval mechanism);
 *   5. output is fitted for a phone: iMessage renders no markup, so agent text
 *      aimed at Slack is de-marked, and a long body is cut at a LINE boundary
 *      with the remainder handed back to attach.
 *
 * The channel is driven through a stub `spectrum-ts` module rather than the real
 * SDK: a unit test must never open a gRPC stream, and the point here is our
 * gating logic, not theirs.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const loadTs = require('./load-ts.cjs');

/* ── stub the ESM SDK before the module under test dynamically imports it ──── */

const sent = [];
let inboundQueue = [];

/** A fake space that records what was sent into it. */
function makeSpace(id) {
  return {
    id,
    send: async (text) => { sent.push({ spaceId: id, text }); return { id: `sent-${sent.length}` }; },
    responding: async (fn) => fn(),
    getMessage: async (mid) => ({ id: mid, react: async () => {} })
  };
}

/** One inbound message in the SDK's shape. */
function msg({ id, text, sender, spaceId = 'space-1', reaction }) {
  const space = makeSpace(spaceId);
  return {
    id,
    direction: 'inbound',
    sender: sender === undefined ? undefined : { id: sender },
    space,
    content: reaction
      ? { type: 'reaction', emoji: reaction.emoji, target: { id: reaction.targetId } }
      : { type: 'text', text },
    react: async () => {}
  };
}

const stubApp = {
  messages: {
    async *[Symbol.asyncIterator]() {
      for (const m of inboundQueue) yield [m.space, m];
      // Then idle forever so the consume loop does not spin into reconnect.
      await new Promise(() => {});
    }
  },
  stop: async () => {}
};

// `spectrum-ts` is ESM-only and is reached through a dynamic import() inside
// photon.ts. Seeding require.cache makes that import resolve to this stub
// without the real gRPC client ever being constructed.
for (const spec of ['spectrum-ts', 'spectrum-ts/providers/imessage']) {
  const resolved = `stub:${spec}`;
  Module._cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports: spec.endsWith('imessage')
      ? { imessage: { config: () => ({}) } }
      : { Spectrum: async () => stubApp }
  };
}
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === 'spectrum-ts' || request === 'spectrum-ts/providers/imessage') return `stub:${request}`;
  return origResolve.call(this, request, ...rest);
};

const { PhotonChannel, normalizeHandle, isAllowed, formatForIMessage } = loadTs('src/main/photon.ts');

const ALLOWED = '+1 (555) 123-4567';

/** A channel wired to collectors, started against the stubbed stream. */
async function makeChannel(queue, allowlist = [ALLOWED]) {
  inboundQueue = queue;
  sent.length = 0;
  const inbound = [];
  const reactions = [];
  const ch = new PhotonChannel({
    projectId: 'proj',
    getProjectSecret: () => 'secret',
    allowlist,
    onMessage: (m) => { inbound.push(m); },
    onReaction: (r) => { reactions.push(r); }
  });
  const res = await ch.start();
  // Let the consume loop drain the queued messages.
  await new Promise((r) => setTimeout(r, 20));
  return { ch, inbound, reactions, res };
}

/* ─────────────────────────────── allowlist ───────────────────────────────── */

test('a message from an allowlisted sender is routed', async () => {
  const { ch, inbound } = await makeChannel([msg({ id: 'm1', text: 'ship it', sender: '+15551234567' })]);
  assert.equal(inbound.length, 1, 'allowlisted sender should be routed');
  assert.equal(inbound[0].text, 'ship it');
  assert.equal(inbound[0].messageId, 'm1', 'reply coordinates must survive');
  await ch.stop();
});

test('a message from a stranger is dropped silently — no route, no reply', async () => {
  const { ch, inbound } = await makeChannel([msg({ id: 'm1', text: 'hello?', sender: '+15559999999' })]);
  assert.equal(inbound.length, 0, 'stranger must not reach the trigger gate');
  assert.equal(sent.length, 0, 'any reply would confirm the line is live to a stranger');
  await ch.stop();
});

test('an empty allowlist admits nobody and refuses to open the line', async () => {
  const ch = new PhotonChannel({
    projectId: 'proj',
    getProjectSecret: () => 'secret',
    allowlist: [],
    onMessage: () => assert.fail('must not route with an empty allowlist'),
    onReaction: () => {}
  });
  const res = await ch.start();
  assert.equal(res.ok, false, 'an ungated iMessage line must fail closed');
  assert.match(res.error, /allowlist/i);
});

test('a message with no sender is not admitted', () => {
  assert.equal(isAllowed(undefined, [ALLOWED]), false);
  assert.equal(isAllowed('', [ALLOWED]), false);
});

/* ───────────────────────────── handle matching ───────────────────────────── */

test('phone handles match across the formats a human and Apple each use', () => {
  const forms = ['+15551234567', '+1 (555) 123-4567', '555-123-4567', '5551234567'];
  const canonical = forms.map(normalizeHandle);
  assert.equal(new Set(canonical).size, 1, `all forms should canonicalise alike, got ${canonical.join(' / ')}`);
  for (const f of forms) assert.equal(isAllowed(f, [ALLOWED]), true, `${f} should be allowed`);
});

test('email handles are case-insensitive', () => {
  assert.equal(isAllowed('Me@iCloud.com', ['me@icloud.com']), true);
});

test('a different number is not allowed', () => {
  assert.equal(isAllowed('+15559999999', [ALLOWED]), false);
});

/* ──────────────────────────────── dedupe ─────────────────────────────────── */

test('a redelivered message id is processed exactly once', async () => {
  const { ch, inbound } = await makeChannel([
    msg({ id: 'dup', text: 'deploy prod', sender: '+15551234567' }),
    msg({ id: 'dup', text: 'deploy prod', sender: '+15551234567' })
  ]);
  assert.equal(inbound.length, 1, 'at-least-once delivery must not run a directive twice');
  await ch.stop();
});

/* ─────────────────────────────── tapbacks ────────────────────────────────── */

test('a tapback surfaces as a reaction carrying the id it was placed on', async () => {
  const { ch, reactions, inbound } = await makeChannel([
    msg({ id: 'r1', sender: '+15551234567', reaction: { emoji: '👍', targetId: 'prompt-7' } })
  ]);
  assert.equal(inbound.length, 0, 'a reaction is not a text');
  assert.equal(reactions.length, 1);
  assert.equal(reactions[0].emoji, '👍');
  assert.equal(reactions[0].targetId, 'prompt-7', 'the target id is the approval correlation key');
  await ch.stop();
});

test('a tapback from a stranger decides nothing', async () => {
  const { ch, reactions } = await makeChannel([
    msg({ id: 'r1', sender: '+15559999999', reaction: { emoji: '👍', targetId: 'prompt-7' } })
  ]);
  assert.equal(reactions.length, 0, 'the allowlist gates approvals too, not just texts');
  await ch.stop();
});

/* ───────────────────────────── phone formatting ──────────────────────────── */

test('markup is stripped — iMessage renders none of it', () => {
  const { text } = formatForIMessage('**Done** and `built` and :white_check_mark: ok');
  assert.equal(text.includes('**'), false, 'markdown bold would show literally');
  assert.equal(text.includes('`'), false, 'backticks would show literally');
  assert.equal(text.includes(':white_check_mark:'), false, 'emoji shortcodes would show literally');
  assert.equal(text.includes('Done'), true, 'the words themselves must survive');
});

test('short text passes through with no overflow', () => {
  const { text, overflow } = formatForIMessage('all green');
  assert.equal(text, 'all green');
  assert.equal(overflow, undefined);
});

test('a long body is cut at a line boundary and the rest handed back', () => {
  const body = Array.from({ length: 80 }, (_, i) => `line ${i} of output`).join('\n');
  const { text, overflow } = formatForIMessage(body, 300);
  assert.ok(text.length < body.length, 'must actually truncate');
  assert.match(text, /more, attached\)$/, 'the reader must be told there is more');
  assert.ok(overflow && overflow.length > 0, 'the remainder must be recoverable for attachment');
  // The visible head must end on a whole line, never mid-word.
  const head = text.split('\n\n…')[0];
  assert.ok(body.startsWith(head), 'the head must be a clean prefix of the original');
  assert.match(head, /output$/, 'the cut should land on a line boundary');
});

test('a single unbroken line longer than the budget still truncates', () => {
  const { text, overflow } = formatForIMessage('x'.repeat(500), 100);
  assert.ok(text.length < 500, 'a body with no line breaks must still be cut');
  assert.ok(overflow && overflow.length > 0);
});
