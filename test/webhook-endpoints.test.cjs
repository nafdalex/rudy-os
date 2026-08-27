'use strict';

/**
 * Multi-endpoint webhook server — the routing + isolation rules that a single
 * shared public surface lives or dies on:
 *
 *   1. one server, many endpoints, told apart by the id in the path (and bare
 *      `POST /` still means the pre-multi-endpoint `legacy` endpoint);
 *   2. each endpoint is gated by ITS OWN secret, so revoking one caller cannot
 *      open or close another's door;
 *   3. an unknown id is answered EXACTLY like a wrong secret, so the surface
 *      can't be walked to discover which webhooks exist;
 *   4. the endpoint list is swappable at runtime — a revoked endpoint stops
 *      resolving on the very next request, with no restart (a restart would
 *      rotate the tunnel URL and break every OTHER caller);
 *   5. per-endpoint rate limiting, so one noisy caller burns its own budget;
 *   6. a held message answers 202 (accepted, not started) with its token.
 *
 * The HTTP handler is driven directly with stub req/res objects: `start()` opens
 * a real tunnel, and a unit test must never reach the network.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const loadTs = require('./load-ts.cjs');

const { WebhookServer, LEGACY_ENDPOINT_ID } = loadTs('src/main/webhook.ts');

const SECRET_A = 'a'.repeat(64);
const SECRET_B = 'b'.repeat(64);
const SCHEMA = JSON.stringify({
  type: 'object',
  required: ['message'],
  properties: { message: { type: 'string' }, count: { type: 'number' } }
});

function endpoints() {
  return [
    { id: 'alpha', name: 'Alpha', secret: SECRET_A, schema: SCHEMA },
    { id: LEGACY_ENDPOINT_ID, name: 'Default webhook', secret: SECRET_B, schema: SCHEMA }
  ];
}

/** A server whose callbacks record what they were handed. */
function makeServer(overrides = {}) {
  const seen = [];
  const server = new WebhookServer({
    port: 0,
    endpoints: endpoints(),
    onMessage: (msg, endpoint) => {
      seen.push({ msg, endpoint });
      if (overrides.pending) return { token: 'tok-pending', pending: true };
      return { token: `tok-${endpoint.id}`, taskId: `webhook-${endpoint.id}`, pending: false };
    },
    lookupStatus: (token) =>
      token === 'good-token' ? { status: 'todo', title: 'a card' } : null,
    ...overrides.opts
  });
  return { server, seen };
}

/** Fire one request through the handler and resolve with `{status, body}`. */
function request(server, { method = 'POST', url = '/', headers = {}, body = undefined }) {
  return new Promise((resolve) => {
    const req = new EventEmitter();
    req.method = method;
    req.url = url;
    req.headers = headers;
    req.destroy = () => { /* no socket to tear down */ };
    const res = {
      writeHead(status) { res._status = status; return res; },
      end(payload) {
        let parsed = null;
        try { parsed = payload ? JSON.parse(payload) : null; } catch { parsed = payload; }
        resolve({ status: res._status, body: parsed });
      }
    };
    server.handleRequest(req, res);
    if (method === 'POST') {
      if (body !== undefined) req.emit('data', Buffer.from(body));
      req.emit('end');
    }
  });
}

const auth = (secret) => ({ 'x-md-webhook-secret': secret });
const post = (msg) => JSON.stringify(msg);

test('each endpoint is gated by its OWN secret', async () => {
  const { server, seen } = makeServer();
  const ok = await request(server, {
    url: '/alpha', headers: auth(SECRET_A), body: post({ message: 'hello' })
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.token, 'tok-alpha');
  assert.equal(seen[0].endpoint.id, 'alpha');
  // The handler is handed the endpoint's identity ONLY — never its secret, which
  // must not be able to reach a card, a hive message or the history ledger.
  assert.deepEqual(Object.keys(seen[0].endpoint).sort(), ['id', 'name']);

  // Alpha's door does not open with the other endpoint's key.
  const wrong = await request(server, {
    url: '/alpha', headers: auth(SECRET_B), body: post({ message: 'hello' })
  });
  assert.equal(wrong.status, 401);
});

test('an unknown id is indistinguishable from a wrong secret', async () => {
  const { server, seen } = makeServer();
  const unknown = await request(server, {
    url: '/does-not-exist', headers: auth(SECRET_A), body: post({ message: 'hi' })
  });
  const wrongSecret = await request(server, {
    url: '/alpha', headers: auth(SECRET_B), body: post({ message: 'hi' })
  });
  assert.equal(unknown.status, wrongSecret.status);
  assert.deepEqual(unknown.body, wrongSecret.body);
  assert.deepEqual(unknown.body, { ok: false, error: 'unauthorized' });
  assert.equal(seen.length, 0, 'neither request may reach the dispatch handler');
});

test('bare POST / still means the legacy endpoint', async () => {
  const { server, seen } = makeServer();
  const res = await request(server, {
    url: '/', headers: auth(SECRET_B), body: post({ message: 'legacy caller' })
  });
  assert.equal(res.status, 200);
  assert.equal(seen[0].endpoint.id, LEGACY_ENDPOINT_ID);
});

test('a nested path is not an endpoint', async () => {
  const { server } = makeServer();
  const res = await request(server, {
    url: '/alpha/extra', headers: auth(SECRET_A), body: post({ message: 'hi' })
  });
  assert.equal(res.status, 401);
});

test('setEndpoints revokes one endpoint without touching the others', async () => {
  const { server } = makeServer();
  server.setEndpoints([{ id: LEGACY_ENDPOINT_ID, name: 'Default webhook', secret: SECRET_B, schema: SCHEMA }]);

  const revoked = await request(server, {
    url: '/alpha', headers: auth(SECRET_A), body: post({ message: 'hi' })
  });
  assert.equal(revoked.status, 401, 'the revoked endpoint stops resolving immediately');

  const survivor = await request(server, {
    url: '/legacy', headers: auth(SECRET_B), body: post({ message: 'hi' })
  });
  assert.equal(survivor.status, 200, 'every other endpoint is undisturbed');
});

test('the body is validated against THAT endpoint schema', async () => {
  const { server } = makeServer();
  const bad = await request(server, {
    url: '/alpha', headers: auth(SECRET_A), body: post({ message: 'hi', count: 'seven' })
  });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /count/);

  const missing = await request(server, {
    url: '/alpha', headers: auth(SECRET_A), body: post({ title: 'no message here' })
  });
  assert.equal(missing.status, 400);

  const junk = await request(server, {
    url: '/alpha', headers: auth(SECRET_A), body: 'not json at all'
  });
  assert.equal(junk.status, 400);
  assert.equal(junk.body.error, 'bad json');
});

test('the caller declaration of kind/from is passed through', async () => {
  const { server, seen } = makeServer();
  await request(server, {
    url: '/alpha',
    headers: auth(SECRET_A),
    body: post({ message: 'ship it', kind: 'communication', from: 'ci-bot', title: 'build' })
  });
  assert.equal(seen[0].msg.kind, 'communication');
  assert.equal(seen[0].msg.from, 'ci-bot');
  assert.equal(seen[0].msg.title, 'build');
  // A kind the enum doesn't know is dropped rather than trusted.
  await request(server, {
    url: '/alpha', headers: auth(SECRET_A), body: post({ message: 'x', kind: 'anything-goes' })
  });
  assert.equal(seen[1].msg.kind, undefined);
});

test('a held message answers 202 with its token and no task', async () => {
  const { server } = makeServer({ pending: true });
  const res = await request(server, {
    url: '/alpha', headers: auth(SECRET_A), body: post({ message: 'do the thing' })
  });
  assert.equal(res.status, 202);
  assert.equal(res.body.pending, true);
  assert.equal(res.body.status, 'awaiting-approval');
  assert.equal(res.body.token, 'tok-pending');
  assert.equal(res.body.taskId, undefined);
});

test('GET is token-scoped, and answers 404 identically for every miss', async () => {
  const { server } = makeServer();
  const ok = await request(server, {
    method: 'GET', url: '/alpha', headers: { 'x-md-webhook-token': 'good-token' }
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.status, 'todo');

  const badToken = await request(server, {
    method: 'GET', url: '/alpha', headers: { 'x-md-webhook-token': 'nope' }
  });
  const badEndpoint = await request(server, {
    method: 'GET', url: '/ghost', headers: { 'x-md-webhook-token': 'good-token' }
  });
  assert.deepEqual(badToken.body, badEndpoint.body);
  assert.equal(badToken.status, 404);
  assert.equal(badEndpoint.status, 404);

  const noToken = await request(server, { method: 'GET', url: '/alpha' });
  assert.equal(noToken.status, 401);
});

test('the query-param token fallback still works', async () => {
  const { server } = makeServer();
  const res = await request(server, { method: 'GET', url: '/alpha?token=good-token' });
  assert.equal(res.status, 200);
});

test('one noisy endpoint cannot starve the others', async () => {
  const { server } = makeServer();
  let limited = 0;
  for (let i = 0; i < 61; i++) {
    const r = await request(server, {
      url: '/alpha', headers: auth(SECRET_A), body: post({ message: `n${i}` })
    });
    if (r.status === 429) limited++;
  }
  assert.ok(limited > 0, 'the per-endpoint budget must trip before the global one');

  const other = await request(server, {
    url: '/legacy', headers: auth(SECRET_B), body: post({ message: 'still fine' })
  });
  assert.equal(other.status, 200, 'a different endpoint keeps its own budget');
});

test('a secretless endpoint is never served', async () => {
  const { server } = makeServer();
  server.setEndpoints([{ id: 'empty', name: 'Empty', secret: '', schema: SCHEMA }]);
  assert.deepEqual(server.endpointIds(), []);
  const res = await request(server, {
    url: '/empty', headers: { 'x-md-webhook-secret': '' }, body: post({ message: 'hi' })
  });
  assert.equal(res.status, 401);
});
