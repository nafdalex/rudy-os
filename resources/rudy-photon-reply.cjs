#!/usr/bin/env node
'use strict';

/**
 * rudy-photon-reply — post a reply into the iMessage thread a task came from.
 *
 * Invoked BY AN AGENT, out of process:
 *   node <resources>/rudy-photon-reply.cjs --space <spaceId> --text "<message>"
 *                                          [--file <abs path>]... [--task <taskId>]
 *
 * `--file` is repeatable and takes an ABSOLUTE path. Images render inline on the
 * phone; anything else arrives as an attachment. A chart, screenshot or diff is
 * usually the answer itself — send it rather than describing it. With files,
 * --text becomes an optional caption.
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
const path = require('node:path');

function fail(msg) {
  process.stderr.write(`rudy-photon-reply: ${msg}\n`);
  process.exit(1);
}

/** Supports both `--key value` and `--key=value`; a valueless flag is `true`. */
function parseArgs(argv) {
  const out = { file: [] };
  const put = (k, v) => { if (k === 'file') out.file.push(v); else out[k] = v; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq !== -1) { put(a.slice(2, eq), a.slice(eq + 1)); continue; }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[a.slice(2)] = true;
    else { put(a.slice(2), next); i++; }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const space = args.space || args.spaceId;
const text = typeof args.text === 'string' ? args.text : '';
const task = typeof args.task === 'string' ? args.task : undefined;
const files = (args.file || []).filter((f) => typeof f === 'string' && f.length > 0);

// Absolute paths only: this runs from whatever cwd the agent happened to be in,
// so a relative path would resolve somewhere unpredictable, or not at all.
for (const f of files) {
  if (!path.isAbsolute(f)) fail(`--file needs an absolute path, got: ${f}`);
  if (!fs.existsSync(f)) fail(`--file not found: ${f}`);
}

if (!space || space === true || (!text && files.length === 0)) {
  fail('required: --space <spaceId> plus --text "<message>" and/or --file <abs path>');
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

const body = JSON.stringify({ spaceId: space, text, taskId: task, files });
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
        process.stdout.write(files.length > 0
          ? `Sent reply by iMessage with ${files.length} file(s).\n`
          : 'Sent reply by iMessage.\n');
        process.exit(0);
      }
      fail(`reply failed (HTTP ${res.statusCode}): ${json.error || raw || 'unknown error'}`);
    });
  }
);
req.on('error', (e) => fail(`could not reach reply endpoint: ${e.message}`));
req.write(body);
req.end();
