import { useEffect, useMemo, useState } from 'react';
import { useStore, type Agent } from '@/store/store';
import { SpritePortrait } from '@/components/SpritePortrait';
import { parseTasks, type HiveTask } from '@/components/TasksKanban';
import type { StatusKind } from '@/components/PixelBadge';

type Group = 'needs' | 'working' | 'resting';

const groupOf = (s: StatusKind): Group =>
  s === 'blocked' || s === 'waiting' ? 'needs'
    : s === 'working' || s === 'thinking' || s === 'looping' || s === 'compacting' ? 'working'
      : 'resting';

const LABEL: Record<StatusKind, string> = {
  idle: 'resting', thinking: 'thinking', working: 'working', waiting: 'waiting',
  blocked: 'needs you', success: 'done', ghost: 'gone',
  // Plain words for the one status a new user cannot guess: the agent is
  // summarizing its own chat to free context, which is progress, not a stall.
  compacting: 'tidying its chat',
  looping: 'looping', typing: 'your draft'
};

/** Assumed context window when the agent has not reported one. */
const DEFAULT_CONTEXT = 200_000;

/**
 * The floor, triaged. Everyone but Rudy (he is the desk) sorted into
 * NEEDS YOU, WORKING and RESTING. Needs you is always on top and always
 * red. The load bar shows how full each agent's context is before you
 * click anyone.
 */
export function HqFloor({ selectedId, onPick, onHire }: {
  selectedId: string | null;
  onPick: (id: string) => void;
  onHire: () => void;
}) {
  const agents = useStore((s) => s.agents);
  const queues = useStore((s) => s.messageQueues);
  const archivedAgents = useStore((s) => s.archivedAgents);
  const removeArchivedAgent = useStore((s) => s.removeArchivedAgent);
  // Which clocked-out entry is unfolded. Click the row to see its record;
  // destructive "forget" lives INSIDE the unfolded view, never on the row.
  const [openArchived, setOpenArchived] = useState<string | null>(null);
  // The hive task ledger, fetched once per unfold: the tasks assigned to a
  // clocked-out worker ARE its work history (title, status, and the boss's
  // closing report on each), which beats any static description of the role.
  const [ledger, setLedger] = useState<HiveTask[] | null>(null);
  useEffect(() => {
    if (!openArchived) return;
    let alive = true;
    window.cth.hiveTasks()
      .then((raw) => { if (alive) setLedger(parseTasks(raw)); })
      .catch(() => { if (alive) setLedger([]); });
    return () => { alive = false; };
  }, [openArchived]);

  const groups = useMemo(() => {
    const out: Record<Group, Agent[]> = { needs: [], working: [], resting: [] };
    for (const a of agents) if (!a.isBoss) out[groupOf(a.status)].push(a);
    for (const g of Object.values(out)) g.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }, [agents]);

  const workers = agents.filter((a) => !a.isBoss).length;

  const card = (a: Agent) => {
    const q = queues[a.id]?.length ?? 0;
    const needy = groupOf(a.status) === 'needs';
    const load = Math.max(0, Math.min(100, Math.round(100 * (a.contextTokens ?? 0) / (a.contextLimit ?? DEFAULT_CONTEXT))));
    const doing = a.action && a.action !== 'awaiting' ? a.action : LABEL[a.status];
    return (
      <button
        key={a.id}
        className={`fl-card${a.id === selectedId ? ' sel' : ''}${needy ? ' needy' : ''}`}
        onClick={() => onPick(a.id)}
        title={`${a.name} · ${LABEL[a.status]}${q ? ` · ${q} queued` : ''}`}
      >
        <span className="fl-face">
          <SpritePortrait character={a.character} scale={1.15} />
        </span>
        <span className="fl-main">
          <span className="fl-name">{a.name}</span>
          <span className="fl-sub">{q > 0 && <b>{q} queued · </b>}{doing}</span>
        </span>
        {needy
          ? <span className="fl-act">OPEN</span>
          : a.contextTokens != null ? (
            /* Only once the agent has actually reported context — an empty
               grey sliver on a fresh agent read as a rendering glitch. */
            <span className={`fl-load${load >= 75 ? ' high' : ''}`} title={`context ${load}% full`}>
              <i style={{ width: `${load}%` }} />
            </span>
          ) : null}
      </button>
    );
  };

  const section = (title: string, cls: string, items: Agent[]) => items.length === 0 ? null : (
    <>
      <div className={`fl-h${cls ? ` ${cls}` : ''}`}>{title}<span className="n">{items.length}</span></div>
      {items.map(card)}
    </>
  );

  return (
    <div className="aur-glass hq-floor">
      <div className="hq-floor-head">
        <h5>THE FLOOR · {workers}</h5>
        <button className="hq-hire" onClick={onHire}>+ HIRE</button>
      </div>
      <div className="hq-floor-list">
        {workers === 0 && (
          <div className="hq-floor-empty">
            Only Rudy is seated.<br />Hire your first agent.
          </div>
        )}
        {section('NEEDS YOU', 'hot', groups.needs)}
        {section('WORKING', '', groups.working)}
        {section('RESTING', '', groups.resting)}
        {/* Workers the hive archived (job done, or reaped at its token cap).
            Without this they vanished from the floor without a trace, which
            read as a bug, not a lifecycle. Dimmed, newest first, capped at 5,
            the full list lives in Command Center → ARCHIVED. */}
        {archivedAgents.length > 0 && (
          <>
            <div className="fl-h">CLOCKED OUT<span className="n">{archivedAgents.length}</span></div>
            {archivedAgents.slice(-5).reverse().map((a) => {
              const open = openArchived === a.id;
              return (
                <div key={a.id}>
                  <button
                    className={`fl-card${open ? ' sel' : ''}`}
                    style={{ opacity: open ? 0.9 : 0.55, width: '100%' }}
                    title={`${a.name} finished and was archived. Click for its record.`}
                    onClick={() => setOpenArchived(open ? null : a.id)}
                  >
                    <span className="fl-face">
                      <SpritePortrait character={a.character} scale={1.15} />
                    </span>
                    <span className="fl-main">
                      <span className="fl-name">{a.name}</span>
                      <span className="fl-sub">job done, clocked out</span>
                    </span>
                    <span className="fl-act">{open ? 'CLOSE' : 'RECORD'}</span>
                  </button>
                  {open && (
                    <div style={{
                      margin: '2px 8px 8px 8px', padding: '8px 10px',
                      display: 'flex', flexDirection: 'column', gap: 6,
                      background: 'var(--aur-glass)', borderRadius: 4,
                      fontFamily: 'var(--cth-font-ui)', fontSize: 11, lineHeight: '15px'
                    }}>
                      <span style={{ color: 'var(--hq-ink2)' }}>{a.description}</span>
                      {/* What it actually DID: its cards from the hive task
                          ledger, each with the boss's closing report. */}
                      {(() => {
                        const mine = (ledger ?? []).filter((t) => t.assignee === a.id);
                        if (mine.length === 0) return null;
                        return (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <span style={{
                              fontWeight: 700, fontSize: 9.5, letterSpacing: '0.06em',
                              textTransform: 'uppercase', color: 'var(--hq-ink3)'
                            }}>what it did</span>
                            {mine.slice(-3).reverse().map((t) => (
                              <span key={t.id} style={{ color: 'var(--hq-ink2)' }} title={t.result ?? t.title}>
                                {t.status === 'done' ? '✓' : '·'} {t.title}
                                {t.result && (
                                  <span style={{ color: 'var(--hq-ink3)' }}>
                                    {' '}· {t.result.length > 120 ? `${t.result.slice(0, 120)}…` : t.result}
                                  </span>
                                )}
                              </span>
                            ))}
                          </div>
                        );
                      })()}
                      {a.goal && (
                        <span style={{ color: 'var(--hq-ink3)' }} title={a.goal}>
                          brief: {a.goal.length > 140 ? `${a.goal.slice(0, 140)}…` : a.goal}
                        </span>
                      )}
                      {a.cwd && <span style={{ color: 'var(--hq-ink3)', wordBreak: 'break-all' }}>worked in {a.cwd}</span>}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
                        <button
                          onClick={() => { removeArchivedAgent(a.id); setOpenArchived(null); }}
                          style={{
                            flexShrink: 0, padding: '3px 8px 2px',
                            border: 'none', cursor: 'pointer', background: 'transparent',
                            boxShadow: 'inset 0 0 0 1px var(--aur-glass-brd)',
                            fontFamily: 'var(--cth-font-ui)', fontWeight: 700, fontSize: 9.5,
                            letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--hq-ink3)'
                          }}
                        >clear from this list</button>
                        {/* Say the consequence WHERE the button is: this only
                            tidies the floor, nothing about the worker is lost. */}
                        <span style={{ color: 'var(--hq-ink3)' }}>
                          just tidies the floor, its notes and record stay in the hive
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {archivedAgents.length > 5 && (
              <div className="fl-sub" style={{ padding: '2px 10px 6px', color: 'var(--cth-ink-500)', fontSize: 11 }}>
                +{archivedAgents.length - 5} more in Command Center
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
