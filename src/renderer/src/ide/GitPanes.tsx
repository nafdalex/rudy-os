/**
 * v0.3.4 git visualization — the HISTORY and COMPARE panes of the IDE's left
 * rail. Both operate at the repository's MAIN root (mainRepoRoot), so every
 * agent worktree branch appears in one graph. All git access stays in the main
 * process; these panes only render what the IPC returns.
 */
import { useCallback, useEffect, useState } from 'react';
import { CommitGraph } from '@/components/git/CommitGraph';
import { Icon } from '@/components/Icon';

// Local mirrors of the main-side git shapes (renderer-local by convention —
// importing the preload module would drag electron into the bundle).
interface GitCommitRow {
  sha: string; shortSha: string; parents: string[];
  subject: string; author: string; time: number; refs: string[];
}
interface GitFileChange { path: string; status: string; oldPath?: string }

function statusColor(code: string): string {
  if (code === 'M') return 'var(--cth-lemon)';
  if (code === 'A') return 'var(--cth-mint)';
  if (code === 'D') return 'var(--cth-coral)';
  if (code === 'R' || code === 'C') return 'var(--cth-lilac)';
  return 'var(--cth-ink-500)';
}

const rowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, padding: '2px 12px',
  cursor: 'pointer', fontSize: 12, color: 'var(--cth-ink-900)'
};
const noteStyle: React.CSSProperties = {
  padding: '6px 12px', fontSize: 12, color: 'var(--cth-ink-500)'
};
const smallBtn: React.CSSProperties = {
  padding: '0 6px', height: 20, fontFamily: 'var(--cth-font-ui)', fontSize: 11,
  color: 'var(--cth-ink-900)', background: 'var(--cth-cream-100)', border: 'none',
  boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)', cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0
};

function FileRow({ f, onClick }: { f: GitFileChange; onClick: () => void }) {
  return (
    <div onClick={onClick} title={f.oldPath ? `${f.oldPath} → ${f.path}` : f.path} style={rowStyle}>
      <span style={{
        width: 12, textAlign: 'center', fontFamily: 'var(--cth-font-mono)',
        fontWeight: 'bold' as const, color: statusColor(f.status)
      }}>{f.status}</span>
      <span style={{
        flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        fontFamily: 'var(--cth-font-mono)', direction: 'rtl', textAlign: 'left'
      }}>{f.path}</span>
    </div>
  );
}

// ─── HISTORY ─────────────────────────────────────────────────────────────────

export function HistoryPane({ gitRoot, onOpenRevDiff }: {
  gitRoot: string;
  /** Open a Monaco diff of `path` between `revA` (parent/base) and `revB`. */
  onOpenRevDiff: (revA: string, revB: string, path: string, label: string) => void;
}) {
  const [commits, setCommits] = useState<GitCommitRow[]>([]);
  const [branch, setBranch] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<GitCommitRow | null>(null);
  const [files, setFiles] = useState<GitFileChange[] | null>(null);
  const [note, setNote] = useState('');
  const [page, setPage] = useState(1);

  const load = useCallback(async (pages: number) => {
    setLoading(true);
    const [log, br] = await Promise.all([
      window.cth.gitLogGraph(gitRoot, pages * 200),
      window.cth.gitBranch(gitRoot)
    ]);
    if (Array.isArray(log)) setCommits(log);
    if (!('error' in br)) setBranch(br.current);
    setLoading(false);
  }, [gitRoot]);

  useEffect(() => { void load(page); }, [load, page]);

  const pick = useCallback(async (sha: string) => {
    const c = commits.find((x) => x.sha === sha) ?? null;
    setSelected(c);
    setFiles(null);
    setNote('');
    if (!c) return;
    const res = await window.cth.gitCommitFiles(gitRoot, sha);
    if (Array.isArray(res)) setFiles(res);
    else setNote(res.error);
  }, [commits, gitRoot]);

  const jump = async (c: GitCommitRow) => {
    if (!window.confirm(`Jump the repo to ${c.shortSha} ("${c.subject.slice(0, 60)}")?\n\nThis detaches HEAD. Blocked automatically if the tree is dirty or an agent is mid-run.`)) return;
    const res = await window.cth.gitCheckout(gitRoot, c.sha, true);
    setNote(res.ok ? `now at ${c.shortSha} (detached HEAD)` : res.error);
    if (res.ok) void load(page);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {loading && commits.length === 0 && <div style={noteStyle}>loading history…</div>}
        {!loading && commits.length === 0 && <div style={noteStyle}>no commits</div>}
        <CommitGraph commits={commits} currentBranch={branch} onCommitClick={(sha) => { void pick(sha); }} />
        {commits.length >= page * 200 && (
          <div style={{ padding: '4px 12px' }}>
            <button style={smallBtn} onClick={() => setPage((p) => p + 1)}>load older…</button>
          </div>
        )}
      </div>
      {selected && (
        <div style={{
          flexShrink: 0, maxHeight: '45%', display: 'flex', flexDirection: 'column', minHeight: 0,
          borderTop: '1px solid var(--cth-ink-300)', background: 'var(--cth-cream-50)'
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px 3px',
            fontSize: 12, color: 'var(--cth-ink-700)'
          }}>
            <span style={{ fontFamily: 'var(--cth-font-mono)', color: 'var(--cth-ink-900)' }}>{selected.shortSha}</span>
            <span style={{
              flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
            }} title={selected.subject}>{selected.subject}</span>
            <button style={smallBtn} onClick={() => void jump(selected)} title="Check out this commit (detached HEAD)">
              <Icon name="arrow-right" /> jump here
            </button>
            <button style={{ ...smallBtn, width: 20, justifyContent: 'center' }} onClick={() => setSelected(null)} title="Close">✕</button>
          </div>
          {/* `flex: 1` is load-bearing: without it this scroller sizes to its
              CONTENT, overflows the parent's maxHeight and never reaches its own
              scroll threshold, so a commit touching many files runs off the
              bottom with no way to scroll to the rest. */}
          <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
            {!files && !note && <div style={noteStyle}>loading files…</div>}
            {note && <div style={{ ...noteStyle, color: 'var(--cth-ink-700)' }}>{note}</div>}
            {files && files.length === 0 && <div style={noteStyle}>no file changes (merge?)</div>}
            {files?.map((f) => (
              <FileRow
                key={f.path}
                f={f}
                onClick={() => onOpenRevDiff(`${selected.sha}^`, selected.sha, f.path, selected.shortSha)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── COMPARE ─────────────────────────────────────────────────────────────────

export function ComparePane({ gitRoot, onOpenRevDiff }: {
  gitRoot: string;
  onOpenRevDiff: (revA: string, revB: string, path: string, label: string) => void;
}) {
  const [branches, setBranches] = useState<string[]>([]);
  const [base, setBase] = useState('');
  const [head, setHead] = useState('');
  const [mode, setMode] = useState<'two' | 'three'>('three');
  const [result, setResult] = useState<{ ahead: number; behind: number; mergeBase: string | null; files: GitFileChange[] } | null>(null);
  const [note, setNote] = useState('');

  useEffect(() => {
    void window.cth.gitBranches(gitRoot).then((res) => {
      if ('error' in res) { setNote(res.error); return; }
      const all = [...res.local, ...res.remote];
      setBranches(all);
      if (res.current) setHead((h) => h || res.current!);
      const guess = res.local.find((b) => b === 'main' || b === 'master') ?? res.local[0];
      if (guess) setBase((b) => b || guess);
    });
  }, [gitRoot]);

  useEffect(() => {
    if (!base || !head) { setResult(null); return; }
    let alive = true;
    setNote('comparing…');
    void window.cth.gitCompareRefs(gitRoot, base, head, mode).then((res) => {
      if (!alive) return;
      if ('error' in res) { setNote(res.error); setResult(null); return; }
      setNote('');
      setResult(res);
    });
    return () => { alive = false; };
  }, [gitRoot, base, head, mode]);

  const switchTo = async () => {
    if (!head) return;
    if (!window.confirm(`Switch this repo to '${head}'?\n\nBlocked automatically if the tree is dirty or an agent is mid-run.`)) return;
    const res = await window.cth.gitCheckout(gitRoot, head.replace(/^origin\//, ''), false);
    setNote(res.ok ? `switched to ${head}` : res.error);
  };

  const sel: React.CSSProperties = {
    flex: 1, minWidth: 0, height: 22, fontFamily: 'var(--cth-font-mono)', fontSize: 11,
    background: 'var(--cth-paper-100)', color: 'var(--cth-ink-900)',
    border: 'none', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)'
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '6px 12px', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <select value={base} onChange={(e) => setBase(e.target.value)} style={sel} title="Base, the branch you're comparing against">
            {branches.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <button style={{ ...smallBtn, width: 22, justifyContent: 'center' }} title="Swap base ↔ compare"
            onClick={() => { setBase(head); setHead(base); }}>⇄</button>
          <select value={head} onChange={(e) => setHead(e.target.value)} style={sel} title="Compare, the branch whose changes you're viewing">
            {branches.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11, color: 'var(--cth-ink-500)' }}>
          {result && (
            <span title={`'${head}' is ${result.ahead} ahead and ${result.behind} behind '${base}'`}>
              ↑{result.ahead} ↓{result.behind}
            </span>
          )}
          <button
            style={{ ...smallBtn, background: mode === 'three' ? 'var(--cth-sky-light)' : 'var(--cth-cream-100)' }}
            onClick={() => setMode((m) => (m === 'three' ? 'two' : 'three'))}
            title={mode === 'three'
              ? 'Showing what the compare branch ADDS since the common ancestor (PR-style). Click for the literal two-dot difference.'
              : 'Showing the literal difference between the two branch states. Click for PR-style (what compare adds).'}
          >{mode === 'three' ? 'since common ancestor' : 'literal difference'}</button>
          <span style={{ flex: 1 }} />
          <button style={smallBtn} onClick={() => void switchTo()} title={`Check out '${head}'`}>
            <Icon name="arrow-right" /> switch to {head.split('/').pop()}
          </button>
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', borderTop: '1px solid var(--cth-ink-100)' }}>
        {note && <div style={noteStyle}>{note}</div>}
        {result && result.files.length === 0 && !note && <div style={noteStyle}>no differences</div>}
        {result?.files.map((f) => (
          <FileRow
            key={f.path}
            f={f}
            onClick={() => onOpenRevDiff(
              mode === 'three' ? (result.mergeBase ?? base) : base,
              head, f.path, `${base}…${head}`
            )}
          />
        ))}
      </div>
    </div>
  );
}
