/**
 * Installing Node.js itself, so a machine with nothing on it can still run agents.
 *
 * Founder decision (2026-08-07), superseding the earlier "never auto-install a
 * system Node" constraint: by DEFAULT we install the real thing — latest stable
 * (LTS) Node + the npm that ships with it — into the user's system. Electron's
 * bundled Node stays as a last-resort fallback only (see hive.runtimeBinDir).
 *
 * The user has to type their password: every official installer writes outside the
 * home directory. That happens VISIBLY in the same terminal as every other
 * installer in this app — we never elevate silently.
 *
 * Because we run an installer as root, the download is CHECKSUM-VERIFIED against
 * nodejs.org's own SHASUMS256.txt before anything executes. A mismatch aborts.
 *
 * Nothing here imports electron: the URL/artifact/script logic is all pure, so it
 * is testable without booting an app.
 */

/** Lowest Node major we consider usable. Below this we offer the upgrade; at or
 *  above it we leave the user's own install completely alone — an existing,
 *  working toolchain is never "upgraded" out from under them. Chosen as Electron's
 *  own bundled line, i.e. the floor we already know every code path tolerates. */
export const NODE_FLOOR_MAJOR = 20;

const DIST = 'https://nodejs.org/dist';

export interface NodeDistEntry {
  version: string;              // 'v24.19.0'
  lts: false | string;          // false | 'Krypton'
  npm?: string;
}

export interface NodeInstaller {
  version: string;              // 'v24.19.0'
  npmVersion?: string;
  file: string;                 // 'node-v24.19.0.pkg'
  url: string;
  sha256: string;
  kind: 'pkg' | 'msi' | 'tar';
}

/** Major version of `v24.19.0` / `24.19.0`, or null if unparseable. */
export function nodeMajor(version: string | null | undefined): number | null {
  const m = /^v?(\d+)\./.exec((version ?? '').trim());
  return m ? Number(m[1]) : null;
}

/** Whether the user's own Node is good enough to be left alone. */
export function nodeIsUsable(version: string | null | undefined): boolean {
  const major = nodeMajor(version);
  return major !== null && major >= NODE_FLOOR_MAJOR;
}

type VersionProbe = (nodePath: string) => string;

const execNodeVersion: VersionProbe = (nodePath) =>
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('node:child_process')
    .execFileSync(nodePath, ['--version'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });

/** `node --version` from the binary the user's PATH actually resolves (see
 *  pty.commandPath). Null when node is absent or the probe fails at all — both
 *  mean "we cannot vouch for this runtime", which routes into the install rung
 *  rather than silently assuming it is fine. */
export function detectNodeVersion(
  nodePath: string | null | undefined,
  probe: VersionProbe = execNodeVersion
): string | null {
  if (!nodePath) return null;
  try {
    const out = (probe(nodePath) || '').trim();
    return /^v?\d+\./.test(out) ? out : null;
  } catch {
    return null;
  }
}

/** Newest LTS in nodejs.org's index.json. The index is newest-first, and `lts` is
 *  the codename (or false), so the first truthy one is the latest stable line.
 *  We deliberately do NOT take index[0] — that is the current/odd release, which
 *  is not what "latest stable" means to a user who just wants things to work. */
export function pickLatestLts(index: NodeDistEntry[]): NodeDistEntry | null {
  return index.find((e) => e && e.lts) ?? null;
}

/** The installer artifact for a platform/arch.
 *
 *  Names are derived here but VALIDATED against SHASUMS256.txt by the caller —
 *  index.json's `files` array is not trustworthy for this: it lists no
 *  `win-arm64-msi` even though `node-<v>-arm64.msi` is published, and its
 *  `osx-x64-pkg` entry actually denotes the single UNIVERSAL `node-<v>.pkg`.
 *
 *  Linux has no official installer package — only tarballs — so it gets the
 *  tar kind, unpacked into /usr/local. */
export function nodeArtifactFor(
  version: string,
  platform: string,
  arch: string
): { file: string; kind: NodeInstaller['kind'] } | null {
  if (platform === 'darwin') return { file: `node-${version}.pkg`, kind: 'pkg' };
  if (platform === 'win32') {
    const a = arch === 'arm64' ? 'arm64' : 'x64';
    return { file: `node-${version}-${a}.msi`, kind: 'msi' };
  }
  if (platform === 'linux') {
    const a = arch === 'arm64' ? 'arm64' : arch === 'x64' ? 'x64' : null;
    if (!a) return null;
    return { file: `node-${version}-linux-${a}.tar.xz`, kind: 'tar' };
  }
  return null;
}

/** Pull one file's digest out of a SHASUMS256.txt body ("<sha>  <file>" lines). */
export function shaFor(shasums: string, file: string): string | null {
  for (const line of shasums.split('\n')) {
    const m = /^([0-9a-f]{64})\s+(\S+)\s*$/.exec(line.trim());
    if (m && m[2] === file) return m[1];
  }
  return null;
}

export const distUrl = (version: string, file: string): string => `${DIST}/${version}/${file}`;

type Fetcher = (url: string) => Promise<{ ok: boolean; text: () => Promise<string> }>;

/** This runs INSIDE a spawn, so it must never hang the launch: an unreachable
 *  nodejs.org has to fail fast and drop the ladder to its next rung. */
const timedFetch: Fetcher = (url) =>
  fetch(url, { signal: AbortSignal.timeout(6000) }) as unknown as ReturnType<Fetcher>;

/** Resolve the exact installer to run on THIS machine, checksum included.
 *  Returns null on any failure (offline, unsupported platform, artifact not in
 *  SHASUMS256) — callers then fall back down the ladder rather than guessing. */
export async function resolveNodeInstaller(
  platform: string = process.platform,
  arch: string = process.arch,
  fetchImpl: Fetcher = timedFetch
): Promise<NodeInstaller | null> {
  try {
    const indexRes = await fetchImpl(`${DIST}/index.json`);
    if (!indexRes.ok) return null;
    const index = JSON.parse(await indexRes.text()) as NodeDistEntry[];
    const lts = pickLatestLts(index);
    if (!lts) return null;

    const artifact = nodeArtifactFor(lts.version, platform, arch);
    if (!artifact) return null;

    const shaRes = await fetchImpl(`${DIST}/${lts.version}/SHASUMS256.txt`);
    if (!shaRes.ok) return null;
    const sha256 = shaFor(await shaRes.text(), artifact.file);
    // No digest → we would be running an unverified installer as root. Refuse.
    if (!sha256) return null;

    return {
      version: lts.version,
      npmVersion: lts.npm,
      file: artifact.file,
      url: distUrl(lts.version, artifact.file),
      sha256,
      kind: artifact.kind
    };
  } catch {
    return null;
  }
}

/** The visible install script: download → VERIFY → install, aborting on any step.
 *
 *  POSIX form is newline-separated statements for `$SHELL -lc`. Windows form is
 *  ONE `&`-chained cmd.exe line with NO double quotes — it is wrapped verbatim in
 *  `cmd /d /s /c "<script>"`, where a single embedded quote would end the command
 *  line early and execute the remainder as garbage. */
export function buildNodeInstallScript(installer: NodeInstaller, platform: string): string[] {
  const { version, url, sha256, file } = installer;

  if (platform === 'win32') {
    // certutil is the only hashing tool guaranteed present; `findstr` does the
    // compare because cmd has no string equality on command output. msiexec's
    // own UAC prompt is the elevation — we never call it silently.
    const f = `%TEMP%\\${file}`;
    return [
      `echo   Downloading Node.js ${version} ^(official installer^)...`,
      `curl -fSL ${url} -o ${f}`,
      `if errorlevel 1 exit /b 1`,
      `echo   Verifying checksum...`,
      `certutil -hashfile ${f} SHA256 | findstr /i /c:${sha256} >nul`,
      `if errorlevel 1 (echo   [x] CHECKSUM MISMATCH, refusing to install ^& exit /b 1)`,
      `echo   Installing, approve the Windows prompt if it appears...`,
      `msiexec /i ${f} /passive /norestart`,
      `if errorlevel 1 exit /b 1`,
      `set PATH=%ProgramFiles%\\nodejs;%PATH%`
    ];
  }

  // macOS ships `shasum`; Linux ships `sha256sum`. Neither ships both.
  const verify = platform === 'darwin'
    ? `echo "${sha256}  $__f" | shasum -a 256 -c - >/dev/null`
    : `echo "${sha256}  $__f" | sha256sum -c - >/dev/null`;
  const install = platform === 'darwin'
    ? `sudo installer -pkg "$__f" -target /`
    // No official Linux package — the tarball IS the distribution. --strip-components
    // drops the versioned top dir so bin/ lands directly in /usr/local/bin.
    : `sudo tar -xJf "$__f" -C /usr/local --strip-components=1`;

  return [
    `echo '  Downloading Node.js ${version} (official installer)...'`,
    `__tmp=$(mktemp -d)`,
    `__f=$__tmp/${file}`,
    `curl -fSL --progress-bar ${url} -o "$__f" || { echo '  [x] Download failed.'; exit 1; }`,
    `echo '  Verifying checksum...'`,
    `${verify} || { echo '  [x] CHECKSUM MISMATCH, refusing to install.'; rm -rf "$__tmp"; exit 1; }`,
    `echo ''`,
    `echo '  Installing Node.js. Enter your password if prompted -'`,
    `echo '  the official installer writes outside your home directory.'`,
    `echo ''`,
    `${install} || { echo '  [x] Node install failed.'; rm -rf "$__tmp"; exit 1; }`,
    `rm -rf "$__tmp"`,
    // The shell that is running this script captured PATH before node existed.
    `PATH=/usr/local/bin:$PATH`,
    `export PATH`
  ];
}
