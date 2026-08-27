#!/usr/bin/env node
'use strict';
/**
 * Guarantee node-pty's `spawn-helper` binaries are executable.
 *
 * On macOS/Linux node-pty does not exec the target command directly — it execs a
 * small `spawn-helper` binary that lives next to the loaded native module. Its
 * loader (node_modules/node-pty/lib/utils.js) resolves the native module from, in
 * order, `build/Release`, `build/Debug`, then `prebuilds/<platform>-<arch>`, and
 * derives `spawn-helper` from that same directory.
 *
 * In some installs the helper shipped inside `prebuilds/` lands with mode 644 (no
 * execute bit). When that's the copy node-pty loads, `pty.fork` fails with
 * "posix_spawnp failed" on EVERY spawn — so no PTY (and therefore no agent) can
 * start. `electron-rebuild` produces a correct copy under `bin/<runtime>-<abi>/`,
 * but node-pty's loader never looks there, so it falls back to the prebuild.
 *
 * This restores +x on every spawn-helper we can find so whichever one node-pty
 * resolves is runnable. No-op on Windows (conpty, no helper). Best-effort: a
 * missing node-pty or a chmod failure must never break `npm install`.
 */
const { chmodSync, existsSync, readdirSync, statSync } = require('node:fs');
const { join } = require('node:path');

if (process.platform === 'win32') process.exit(0);

try {
  const root = join(__dirname, '..', 'node_modules', 'node-pty');
  if (!existsSync(root)) process.exit(0);

  // Directories node-pty may load the native module (and thus the helper) from.
  const candidates = [join(root, 'build', 'Release'), join(root, 'build', 'Debug')];
  for (const base of [join(root, 'prebuilds'), join(root, 'bin')]) {
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base)) candidates.push(join(base, entry));
  }

  let fixed = 0;
  for (const dir of candidates) {
    const helper = join(dir, 'spawn-helper');
    if (!existsSync(helper)) continue;
    const mode = statSync(helper).mode & 0o777;
    if ((mode & 0o111) !== 0o111) {
      chmodSync(helper, mode | 0o755);
      fixed++;
      console.log('[ensure-pty-perms] +x', helper);
    }
  }
  if (fixed === 0) console.log('[ensure-pty-perms] node-pty spawn-helpers already executable');
} catch (e) {
  console.warn('[ensure-pty-perms] skipped:', e && e.message ? e.message : e);
}
