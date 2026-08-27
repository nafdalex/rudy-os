/**
 * The system-Node auto-installer.
 *
 * Founder decision (2026-08-07) reversed the earlier "never auto-install a system
 * Node" rule: on a machine with no usable Node we install the REAL thing (latest
 * LTS + the npm it ships with), and only then run `npm install -g <cli>`. These
 * tests pin the parts that are dangerous to get wrong — we hand a script to a
 * shell that will run an installer as root — without touching the network:
 * `resolveNodeInstaller` takes an injectable fetch, and every other function is pure.
 */
const test = require('node:test');
const assert = require('node:assert');
const load = require('./load-ts.cjs');

const {
  NODE_FLOOR_MAJOR, nodeMajor, nodeIsUsable, detectNodeVersion,
  pickLatestLts, nodeArtifactFor, shaFor, distUrl,
  resolveNodeInstaller, buildNodeInstallScript
} = load('src/main/nodeInstall.ts');
const { chooseInstallRung, buildMissingCliScript } = load('src/main/cliInstall.ts');

const SHA = 'a'.repeat(64);
const SHA2 = 'b'.repeat(64);

/** The shape nodejs.org/dist/index.json actually returns: NEWEST FIRST, with the
 *  odd/current release on top and `lts` being a codename or literal false. */
const INDEX = [
  { version: 'v26.7.0', lts: false, npm: '11.20.0' },
  { version: 'v25.4.1', lts: false, npm: '11.18.0' },
  { version: 'v24.19.0', lts: 'Krypton', npm: '11.17.0' },
  { version: 'v22.20.0', lts: 'Jod', npm: '10.9.3' }
];

function fakeFetch(map) {
  return async (url) => {
    if (!(url in map)) return { ok: false, text: async () => '' };
    return { ok: true, text: async () => map[url] };
  };
}

const OK_FETCH = fakeFetch({
  'https://nodejs.org/dist/index.json': JSON.stringify(INDEX),
  'https://nodejs.org/dist/v24.19.0/SHASUMS256.txt':
    `${SHA}  node-v24.19.0.pkg\n${SHA2}  node-v24.19.0-x64.msi\n${SHA}  node-v24.19.0-linux-x64.tar.xz\n`
});

// ── version gate ────────────────────────────────────────────────────────────

test('a Node at or above the floor is left alone; below it is not', () => {
  assert.equal(nodeMajor('v24.19.0'), 24);
  assert.equal(nodeMajor('20.18.1'), 20);
  assert.equal(nodeMajor('rubbish'), null);
  assert.equal(nodeIsUsable(`v${NODE_FLOOR_MAJOR}.0.0`), true);
  assert.equal(nodeIsUsable(`v${NODE_FLOOR_MAJOR - 1}.99.99`), false);
  // Absent / unparseable must NOT read as usable — that is the whole gate.
  assert.equal(nodeIsUsable(null), false);
  assert.equal(nodeIsUsable(''), false);
});

test('detectNodeVersion returns null rather than guessing when the probe fails', () => {
  assert.equal(detectNodeVersion('/usr/bin/node', () => 'v24.19.0\n'), 'v24.19.0');
  assert.equal(detectNodeVersion(null, () => 'v24.19.0'), null);
  assert.equal(detectNodeVersion('/usr/bin/node', () => { throw new Error('ENOENT'); }), null);
  // Garbage on stdout is not a version. Treating it as one would skip the install.
  assert.equal(detectNodeVersion('/usr/bin/node', () => 'command not found'), null);
});

// ── picking what to download ────────────────────────────────────────────────

test('latest STABLE means newest LTS, never index[0] (the current/odd release)', () => {
  assert.equal(pickLatestLts(INDEX).version, 'v24.19.0');
  assert.notEqual(pickLatestLts(INDEX).version, INDEX[0].version);
  assert.equal(pickLatestLts([{ version: 'v26.7.0', lts: false }]), null);
});

test('artifact names match what nodejs.org actually publishes', () => {
  // macOS ships ONE universal .pkg — there is no -x64/-arm64 variant.
  assert.deepEqual(nodeArtifactFor('v24.19.0', 'darwin', 'arm64'), { file: 'node-v24.19.0.pkg', kind: 'pkg' });
  assert.deepEqual(nodeArtifactFor('v24.19.0', 'darwin', 'x64'), { file: 'node-v24.19.0.pkg', kind: 'pkg' });
  assert.deepEqual(nodeArtifactFor('v24.19.0', 'win32', 'arm64'), { file: 'node-v24.19.0-arm64.msi', kind: 'msi' });
  assert.deepEqual(nodeArtifactFor('v24.19.0', 'win32', 'x64'), { file: 'node-v24.19.0-x64.msi', kind: 'msi' });
  assert.deepEqual(nodeArtifactFor('v24.19.0', 'linux', 'x64'), { file: 'node-v24.19.0-linux-x64.tar.xz', kind: 'tar' });
  // Unsupported: no artifact rather than a URL that 404s mid-install.
  assert.equal(nodeArtifactFor('v24.19.0', 'linux', 'mips'), null);
  assert.equal(nodeArtifactFor('v24.19.0', 'aix', 'ppc64'), null);
});

test('shaFor matches the exact file, not a prefix of another entry', () => {
  const body = `${SHA}  node-v24.19.0.pkg\n${SHA2}  node-v24.19.0-x64.msi\n`;
  assert.equal(shaFor(body, 'node-v24.19.0.pkg'), SHA);
  assert.equal(shaFor(body, 'node-v24.19.0-x64.msi'), SHA2);
  assert.equal(shaFor(body, 'node-v24.19.0-arm64.msi'), null);
  assert.equal(distUrl('v24.19.0', 'node-v24.19.0.pkg'), 'https://nodejs.org/dist/v24.19.0/node-v24.19.0.pkg');
});

test('resolveNodeInstaller returns the LTS artifact with its real digest', async () => {
  const got = await resolveNodeInstaller('darwin', 'arm64', OK_FETCH);
  assert.equal(got.version, 'v24.19.0');
  assert.equal(got.npmVersion, '11.17.0');
  assert.equal(got.file, 'node-v24.19.0.pkg');
  assert.equal(got.url, 'https://nodejs.org/dist/v24.19.0/node-v24.19.0.pkg');
  assert.equal(got.sha256, SHA);
  assert.equal(got.kind, 'pkg');
});

test('resolveNodeInstaller refuses rather than running an unverified installer', async () => {
  // Artifact published but absent from SHASUMS256 → no digest → no install.
  assert.equal(await resolveNodeInstaller('win32', 'arm64', OK_FETCH), null);
  // Offline / 5xx on either fetch.
  assert.equal(await resolveNodeInstaller('darwin', 'arm64', fakeFetch({})), null);
  assert.equal(await resolveNodeInstaller('darwin', 'arm64', async () => { throw new Error('ENETDOWN'); }), null);
  // Unsupported platform never reaches the network at all.
  assert.equal(await resolveNodeInstaller('sunos', 'x64', OK_FETCH), null);
});

// ── the script we hand to a root-capable shell ──────────────────────────────

const INSTALLER = {
  version: 'v24.19.0', npmVersion: '11.17.0', file: 'node-v24.19.0.pkg',
  url: 'https://nodejs.org/dist/v24.19.0/node-v24.19.0.pkg', sha256: SHA, kind: 'pkg'
};
const WIN_INSTALLER = { ...INSTALLER, file: 'node-v24.19.0-x64.msi', kind: 'msi',
  url: 'https://nodejs.org/dist/v24.19.0/node-v24.19.0-x64.msi' };

test('every posix install script verifies the checksum BEFORE it elevates', () => {
  for (const platform of ['darwin', 'linux']) {
    const script = buildNodeInstallScript(
      platform === 'darwin' ? INSTALLER : { ...INSTALLER, file: 'node-v24.19.0-linux-x64.tar.xz', kind: 'tar' },
      platform
    ).join('\n');
    const verifyAt = script.indexOf(SHA);
    const elevateAt = script.indexOf('sudo ');
    assert.ok(verifyAt > -1, `${platform}: digest never checked`);
    assert.ok(elevateAt > -1, `${platform}: never installs`);
    assert.ok(verifyAt < elevateAt, `${platform}: elevates before verifying`);
    // A mismatch must ABORT on its OWN line, not warn and carry on into sudo.
    // (Asserted per-line: a regex spanning to some later `exit 1` passes even
    // when the mismatch branch only prints — which is the bug that matters.)
    const mismatch = script.split('\n').find((l) => l.includes('CHECKSUM MISMATCH'));
    assert.ok(mismatch, `${platform}: no mismatch branch at all`);
    assert.ok(/exit 1/.test(mismatch), `${platform}: mismatch warns but continues: ${mismatch}`);
    assert.ok(script.indexOf('CHECKSUM MISMATCH') < elevateAt, `${platform}: mismatch checked after sudo`);
    // The download must fail loudly too, on its own line.
    const dl = script.split('\n').find((l) => l.includes('curl -fSL'));
    assert.ok(dl && /exit 1/.test(dl), `${platform}: a failed download falls through: ${dl}`);
  }
});

test('posix script uses the hashing tool that platform actually ships', () => {
  const mac = buildNodeInstallScript(INSTALLER, 'darwin').join('\n');
  const lin = buildNodeInstallScript({ ...INSTALLER, kind: 'tar' }, 'linux').join('\n');
  assert.match(mac, /shasum -a 256 -c -/);
  assert.ok(!/sha256sum/.test(mac), 'macOS does not ship sha256sum');
  assert.match(lin, /sha256sum -c -/);
  assert.ok(!/shasum -a 256/.test(lin), 'most linux images do not ship shasum');
  assert.match(mac, /sudo installer -pkg/);
  assert.match(lin, /sudo tar -xJf/);
  // The running shell captured PATH before node existed — it must be re-pointed.
  assert.match(mac, /PATH=\/usr\/local\/bin:\$PATH/);
});

test('the Windows install script survives cmd /d /s /c quoting', () => {
  const parts = buildNodeInstallScript(WIN_INSTALLER, 'win32');
  const line = parts.join(' & ');
  // Wrapped verbatim in `cmd /d /s /c "<script>"` — one embedded quote truncates it.
  assert.ok(!line.includes('"'), 'double quote would end the command line early');
  assert.ok(!line.includes('\n'), 'must stay a single line');
  // Literal ampersands inside a parenthesized block have to be escaped.
  assert.ok(!/[^^]&(?!\s)/.test(line.replace(/ & /g, ' ')), 'unescaped & inside a block');
  assert.match(line, /certutil -hashfile .* SHA256 \| findstr \/i \/c:a{64}/);
  assert.match(line, /msiexec \/i .* \/passive \/norestart/);
  assert.ok(line.indexOf(SHA) < line.indexOf('msiexec'), 'elevates before verifying');
});

// ── the ladder ──────────────────────────────────────────────────────────────

test('a usable npm is untouched — no Node install is ever spliced in', () => {
  for (const provider of ['claude', 'codex', 'opencode', 'copilot']) {
    const rung = chooseInstallRung(
      { command: 'npm install -g x', nativeCommand: 'curl x | bash', label: 'X' }, true, INSTALLER
    );
    assert.equal(rung.kind, 'npm');
    assert.equal(rung.nodeMissing, false);
    const s = buildMissingCliScript(provider, provider, true, 'darwin', INSTALLER);
    assert.ok(!s.includes('nodejs.org'), `${provider}: offered a Node install to a machine that has one`);
    assert.ok(!s.includes('sudo'), `${provider}: asked for a password it does not need`);
  }
});

test('no usable npm + a resolvable installer → node-then-npm, ABOVE the native rung', () => {
  // Claude Code is the only provider with a node-free native installer, so it is
  // the one case where the two rungs compete. Founder ruled: fix the machine.
  const info = { command: 'npm install -g @anthropic-ai/claude-code', nativeCommand: 'curl -fsSL https://claude.ai/install.sh | bash', label: 'Claude Code' };
  const rung = chooseInstallRung(info, false, INSTALLER);
  assert.equal(rung.kind, 'node-then-npm');
  assert.equal(rung.command, info.command);
  assert.equal(rung.nodeMissing, true);
});

test('node-then-npm installs Node first, then the CLI with it', () => {
  const s = buildMissingCliScript('claude', 'claude', false, 'darwin', INSTALLER);
  const nodeAt = s.indexOf('sudo installer -pkg');
  const cliAt = s.lastIndexOf('npm install -g');
  assert.ok(nodeAt > -1, 'no Node install');
  assert.ok(cliAt > nodeAt, 'CLI install must come after Node lands');
  assert.match(s, /Installing Node v24\.19\.0 \(\+ npm\) first/);
  // The Node script exits non-zero on failure, so the npm line is unreachable
  // unless Node actually installed — that is what makes the ordering safe.
  const mismatch = s.split('\n').find((l) => l.includes('CHECKSUM MISMATCH'));
  assert.ok(mismatch && /exit 1/.test(mismatch), `mismatch must abort before npm: ${mismatch}`);
});

test('no installer resolvable (offline/unsupported) falls back, never fabricates one', () => {
  const info = { command: 'npm install -g @anthropic-ai/claude-code', nativeCommand: 'curl -fsSL https://claude.ai/install.sh | bash', label: 'Claude Code' };
  assert.equal(chooseInstallRung(info, false, null).kind, 'native');
  assert.equal(chooseInstallRung(info, false, undefined).kind, 'native');
  // A provider with no native installer and no Node → manual hint, runs nothing.
  const bare = { command: 'npm install -g @openai/codex', label: 'Codex' };
  const manual = chooseInstallRung(bare, false, null);
  assert.equal(manual.kind, 'manual');
  assert.equal(manual.command, undefined);
  const s = buildMissingCliScript('codex', 'codex', false, 'darwin', null);
  for (const line of s.split('\n')) {
    const t = line.trim();
    if (t) assert.match(t, /^(echo |if |fi$|else$)/, `manual rung EXECUTED: ${t}`);
  }
});

test('the Windows node-then-npm script is still one quote-free line', () => {
  const s = buildMissingCliScript('claude', 'claude', false, 'win32', WIN_INSTALLER);
  assert.ok(!s.includes('\n'), 'must stay a single line');
  assert.ok(!s.includes('"'), 'double quote would end the command line early');
  assert.ok(s.indexOf('msiexec') < s.lastIndexOf('npm install -g'), 'Node must land before the CLI install');
  assert.match(s, /set PATH=%ProgramFiles%\\nodejs;%PATH%/);
});
