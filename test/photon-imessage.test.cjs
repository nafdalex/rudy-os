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
/** Space ids the stubbed platform will resolve for a cold send. */
const resolvableSpaces = new Set();
const readLog = [];
const typingLog = [];
let inboundQueue = [];

/** A fake space that records what was sent into it. */
function makeSpace(id) {
  return {
    id,
    send: async (...parts) => {
      sent.push({ spaceId: id, text: parts[0], parts });
      return { id: `sent-${sent.length}` };
    },
    responding: async (fn) => fn(),
    startTyping: async () => { typingLog.push([id, true]); },
    stopTyping: async () => { typingLog.push([id, false]); },
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
    react: async () => {},
    read: async () => { readLog.push(id); }
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
      ? {
          // `imessage` is BOTH a config factory and the platform-narrowing
          // callable — imessage(app) is the only route to space resolution.
          imessage: Object.assign(
            () => ({
              user: async (h) => ({ id: h }),
              space: {
                get: async (id) => (resolvableSpaces.has(id) ? makeSpace(id) : null),
                create: async (u) => makeSpace(`any;-;${u.id}`)
              }
            }),
            { config: () => ({}) }
          )
        }
      : {
          Spectrum: async () => stubApp,
          attachment: (input, opts) => ({ __attachment: input, name: opts?.name })
        }
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
  readLog.length = 0;
  typingLog.length = 0;
  resolvableSpaces.clear();
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

/* ───────────────────────────── read receipts ─────────────────────────────── */

test('an accepted message is marked read', async () => {
  const { ch } = await makeChannel([msg({ id: 'm1', text: 'status?', sender: '+15551234567' })]);
  assert.deepEqual(readLog, ['m1'], 'the sender should see a read receipt once we have the message');
  await ch.stop();
});

test('a stranger never gets a read receipt', async () => {
  const { ch } = await makeChannel([msg({ id: 'm1', text: 'who is this', sender: '+15559999999' })]);
  assert.deepEqual(readLog, [], 'a receipt would confirm a real reader is on the other end');
  await ch.stop();
});

test('a duplicate delivery is not re-marked read', async () => {
  const { ch } = await makeChannel([
    msg({ id: 'dup', text: 'ship it', sender: '+15551234567' }),
    msg({ id: 'dup', text: 'ship it', sender: '+15551234567' })
  ]);
  assert.deepEqual(readLog, ['dup'], 'dedupe must gate receipts too');
  await ch.stop();
});

/* ────────────────────────────── typing control ───────────────────────────── */

test('typing can be turned on and off for a known space', async () => {
  const { ch } = await makeChannel([msg({ id: 'm1', text: 'hi', sender: '+15551234567' })]);
  await ch.typing('space-1', true);
  await ch.typing('space-1', false);
  assert.deepEqual(typingLog, [['space-1', true], ['space-1', false]]);
  await ch.stop();
});

test('typing on an unknown space is a no-op, not a throw', async () => {
  const { ch } = await makeChannel([msg({ id: 'm1', text: 'hi', sender: '+15551234567' })]);
  await ch.typing('never-seen', true);          // must not reject
  assert.equal(typingLog.some(([s]) => s === 'never-seen'), false);
  await ch.stop();
});

/* ─────────────────── outbound without a prior inbound ────────────────────── */

test('a send resolves a space it never received a message on', async () => {
  // The exact restart case: a long task finishes and reports back in a session
  // that never saw the original text.
  const { ch } = await makeChannel([]);
  resolvableSpaces.add('any;-;+15551234567');
  const res = await ch.send('any;-;+15551234567', 'done');
  assert.equal(res.ok, true, 'a cold space must resolve, or every post-restart reply is lost');
  assert.equal(sent.at(-1).text, 'done');
  await ch.stop();
});

test('an unresolvable space fails cleanly instead of throwing', async () => {
  const { ch } = await makeChannel([]);
  const res = await ch.send('any;-;+15550000000', 'hello');
  assert.equal(res.ok, false);
  assert.match(res.error, /no live handle/);
  await ch.stop();
});

test('the office can open a conversation from a bare handle', async () => {
  const { ch } = await makeChannel([]);
  const res = await ch.sendToHandle('+15551234567', 'first contact');
  assert.equal(res.ok, true, 'outbound-first must work with no inbound history');
  assert.equal(sent.at(-1).spaceId, 'any;-;+15551234567');
  await ch.stop();
});

/* ─────────────────────────── files and images ────────────────────────────── */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

function tmpFile(name, body = 'x') {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'photon-')), name);
  fs.writeFileSync(f, body);
  return f;
}

test('a file is attached alongside its caption', async () => {
  const { ch } = await makeChannel([]);
  resolvableSpaces.add('space-1');
  const chart = tmpFile('chart.png');
  const res = await ch.sendFiles('space-1', 'this week', [chart]);
  assert.equal(res.ok, true);
  const last = sent.at(-1);
  assert.equal(last.parts[0], 'this week', 'caption goes first');
  assert.equal(last.parts[1].__attachment, chart, 'the file itself must be attached');
  assert.equal(last.parts[1].name, 'chart.png', 'the phone should show a real filename');
  await ch.stop();
});

test('a file with no caption still sends', async () => {
  const { ch } = await makeChannel([]);
  resolvableSpaces.add('space-1');
  const res = await ch.sendFiles('space-1', '', [tmpFile('out.log')]);
  assert.equal(res.ok, true, 'an image is often the whole answer — no caption needed');
  assert.equal(sent.at(-1).parts.length, 1, 'an empty caption must not be sent as a blank message');
  await ch.stop();
});

test('unreadable paths are refused rather than sent as text', async () => {
  const { ch } = await makeChannel([]);
  resolvableSpaces.add('space-1');
  const res = await ch.sendFiles('space-1', 'here', ['/nope/missing.png']);
  assert.equal(res.ok, false);
  assert.match(res.error, /no readable files/);
  await ch.stop();
});

test('multiple files all ride along', async () => {
  const { ch } = await makeChannel([]);
  resolvableSpaces.add('space-1');
  const res = await ch.sendFiles('space-1', 'both', [tmpFile('a.png'), tmpFile('b.txt')]);
  assert.equal(res.ok, true);
  assert.equal(sent.at(-1).parts.length, 3, 'caption + two attachments');
  await ch.stop();
});
