#!/usr/bin/env node
'use strict';

/**
 * rudy-photon-reply — post a reply into the iMessage thread a task came from.
 *
 * Invoked BY AN AGENT, out of process:
 *   node <resources>/rudy-photon-reply.cjs --space <spaceId> --text "<message>"
 *                                          [--task <taskId>]
 *
 * The agent never holds the Photon project secret. This script talks to a
 * loopback-only endpoint inside the Rudy main process, authenticating with a
 * per-session capability token it reads from a 0600 discovery file; main does the
 * actual send. Same design as rudy-slack-reply.cjs.
 *
 * `--task` is optional but worth passing: it tells the harness this card was
 * already answered directly, so the done-notifier stays quiet instead of texting
 * a second summary on top of the agent's own reply.
 *
 * Dependencies are node builtins ONLY — it runs outside the asar, under whatever
 * node the agent has.
 */

const fs = require('node:fs');
const http = require('node:http');

function fail(msg) {
  process.stderr.write(`rudy-photon-reply: ${msg}\n`);
  process.exit(1);
}

/** Supports both `--key value` and `--key=value`; a valueless flag is `true`. */
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq !== -1) {
      out[a.slice(2, eq)] = a.slice(eq + 1);
      continue;
    }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[a.slice(2)] = true;
    else { out[a.slice(2)] = next; i++; }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const space = args.space || args.spaceId;
const text = args.text;
const task = typeof args.task === 'string' ? args.task : undefined;

if (!space || space === true || !text || text === true) {
  fail('required: --space <spaceId> --text "<message>"  [--task <taskId>]');
}

const configPath = args.config || process.env.MD_PHOTON_REPLY_CONFIG;
if (!configPath) {
  fail('cannot locate the reply endpoint: set MD_PHOTON_REPLY_CONFIG or pass --config');
}

let cfg;
try {
  cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (e) {
  // The file only exists while the channel is up, so a read failure is almost
  // always "iMessage is switched off", not a corrupt install.
  fail(`iMessage channel not running (could not read ${configPath}): ${e.message}`);
}
if (!cfg || typeof cfg.port !== 'number' || typeof cfg.token !== 'string') {
  fail(`malformed reply config at ${configPath}`);
}

const body = JSON.stringify({ spaceId: space, text, taskId: task });
const req = http.request(
  {
    host: '127.0.0.1',
    port: cfg.port,
    path: '/reply',
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
      'x-md-reply-token': cfg.token
    }
  },
  (res) => {
    let raw = '';
    res.on('data', (d) => { raw += d; });
    res.on('end', () => {
      let json = {};
      try { json = JSON.parse(raw); } catch { /* keep raw for the error message */ }
      if (res.statusCode === 200 && json.ok) {
        process.stdout.write('Sent reply by iMessage.\n');
        process.exit(0);
      }
      fail(`reply failed (HTTP ${res.statusCode}): ${json.error || raw || 'unknown error'}`);
    });
  }
);
req.on('error', (e) => fail(`could not reach reply endpoint: ${e.message}`));
req.write(body);
req.end();
