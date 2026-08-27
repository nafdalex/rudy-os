import { useCallback, useEffect, useRef, useState } from 'react';
import { PixelPanel } from './PixelPanel';
import { PixelButton } from './PixelButton';
import { PixelBadge } from './PixelBadge';
import { Icon } from './Icon';
import { useStore } from '@/store/store';

/** A card on the task kanban. Mirrors HiveTask in the main/preload process —
 *  re-declared locally so the renderer doesn't reach into the preload package
 *  (same convention as store/config.ts). */
export interface HumanQA {
  q: string;
  a?: string;
  askedAt?: string;
  answeredAt?: string;
  /** Set when the human dismisses the ask from the ASK ME board WITHOUT
   *  answering — the question stays on the card (history is preserved) but
   *  openQuestion() stops returning it, so the card leaves ASK ME. */
  dismissedAt?: string;
}

export interface HiveTask {
  id: string;
  title: string;
  description?: string;
  assignee?: string;
  status: 'todo' | 'doing' | 'blocked' | 'done';
  dependsOn: string[];
  priority: number;
  createdAt: string;
  /** The boss's closing report on a finished card, when it wrote one. */
  result?: string;
  /** First-class human feedback: the boss appends {q} when a card needs the
   *  human; the ASK ME view fills in {a}. Full history stays on the card. */
  humanQA?: HumanQA[];
}

/** The card's currently open question for the human, if any. An entry the human
 *  dismissed (dismissedAt) counts as resolved, same as an answered one. */
export function openQuestion(t: HiveTask): HumanQA | undefined {
  if (!Array.isArray(t.humanQA)) return undefined;
  for (let i = t.humanQA.length - 1; i >= 0; i--) {
    const e = t.humanQA[i];
    if (e && typeof e.q === 'string' && !e.a && !e.dismissedAt) return e;
  }
  return undefined;
}

/** Waiting on the human = blocked with an unanswered question on the card. */
export function waitsOnHuman(t: HiveTask): boolean {
  return t.status === 'blocked' && !!openQuestion(t);
}

type Status = HiveTask['status'];

const COLUMNS: { key: Status; label: string; accent: string }[] = [
  { key: 'todo',    label: 'TODO',    accent: 'var(--cth-sky)' },
  { key: 'doing',   label: 'DOING',   accent: 'var(--cth-lemon)' },
  { key: 'blocked', label: 'BLOCKED', accent: 'var(--cth-coral)' },
  { key: 'done',    label: 'DONE',    accent: 'var(--cth-mint)' }
];

const POLL_MS = 5000;

const STATUS_ORDER: Record<Status, number> = { doing: 0, blocked: 1, todo: 2, done: 3 };

/** Column order: urgent first. High priority floats, then older cards first —
 *  except DONE, where the newest finish is the interesting one. */
function sortCards(cards: HiveTask[], col: Status): HiveTask[] {
  return [...cards].sort((x, y) => {
    if (y.priority !== x.priority) return y.priority - x.priority;
    const xt = Date.parse(x.createdAt) || 0;
    const yt = Date.parse(y.createdAt) || 0;
    return col === 'done' ? yt - xt : xt - yt;
  });
}

/** Deterministic fallback id derived from a task's content (djb2 → base36).
 *  Used for tasks lacking a valid string id so re-parsing tasks.json on every
 *  5s poll yields the SAME id — no React key churn / card remount. Unlike
 *  shortId() (random, for brand-new tasks), this never changes across polls. */
function stableId(seed: string): string {
  let h = 5381;
  for (let i = 0; i < seed.length; i++) h = (((h << 5) + h) ^ seed.charCodeAt(i)) | 0;
  return `t-${(h >>> 0).toString(36)}`;
}

/** Normalize whatever hive:tasks returns into a typed task array. The boss
 *  writes this file by hand — every field except the shape itself is optional
 *  in practice, so EVERY consumer must go through this (exported for the
 *  detail overlay; a raw card without dependsOn once crashed it). */
export function parseTasks(raw: unknown): HiveTask[] {
  const list = (raw && typeof raw === 'object' && Array.isArray((raw as { tasks?: unknown }).tasks))
    ? (raw as { tasks: unknown[] }).tasks
    : [];
  return list
    .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object')
    .map((t, i) => ({
      id: typeof t.id === 'string' && t.id
        ? t.id
        : stableId(`${typeof t.title === 'string' ? t.title : ''}|${typeof t.createdAt === 'string' ? t.createdAt : ''}|${i}`),
      title: typeof t.title === 'string' ? t.title : '(untitled)',
      description: typeof t.description === 'string' ? t.description : undefined,
      assignee: typeof t.assignee === 'string' ? t.assignee : undefined,
      status: (['todo', 'doing', 'blocked', 'done'] as const).includes(t.status as Status)
        ? (t.status as Status) : 'todo',
      dependsOn: Array.isArray(t.dependsOn) ? t.dependsOn.filter((d): d is string => typeof d === 'string') : [],
      priority: typeof t.priority === 'number' ? t.priority : 3,
      createdAt: typeof t.createdAt === 'string' ? t.createdAt : new Date().toISOString(),
      result: typeof t.result === 'string' && t.result ? t.result : undefined,
      humanQA: Array.isArray(t.humanQA)
        ? (t.humanQA as unknown[])
          .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object' && typeof (e as { q?: unknown }).q === 'string')
          .map((e) => ({
            q: e.q as string,
            a: typeof e.a === 'string' ? e.a : undefined,
            askedAt: typeof e.askedAt === 'string' ? e.askedAt : undefined,
            answeredAt: typeof e.answeredAt === 'string' ? e.answeredAt : undefined,
            // Preserve a dismissal across the 5s re-parse, else the card would
            // resurface on the next poll (openQuestion would see it as open).
            dismissedAt: typeof e.dismissedAt === 'string' ? e.dismissedAt : undefined
          }))
        : undefined
    }));
}

/**
 * Task kanban over hive/tasks.json — a READ surface. Polls every 5s; cards
 * carry just the title and open the app-wide detail overlay on click. The boss
 * is the ledger's writer: new work enters via the dispatch box (mailed to the
 * boss), never by the human inserting cards the orchestrator never heard about.
 */
export function TasksKanban() {
  const agents = useStore((s) => s.agents);
  const [tasks, setTasks] = useState<HiveTask[]>([]);
  // Detail view: cards show just the title — clicking one opens the full
  // breakdown as an APP-WIDE overlay over the office floor (see
  // TaskDetailOverlay) — the content grows (contracts, deps, human Q&A), so it
  // gets the big stage instead of the narrow side panel.
  const openTaskDetail = useStore((s) => s.openTaskDetail);
  // Two lenses over the same ledger: BY STATUS is the classic four columns,
  // BY AGENT answers "what is each of my people carrying right now".
  const [lens, setLens] = useState<'status' | 'agent'>('status');
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try { setTasks(parseTasks(await window.cth.hiveTasks())); } catch { /* keep last good */ }
  }, []);

  // Dismiss a card off the board (human-initiated). The kanban is otherwise the
  // boss's to write, but a person can clear a card they no longer want tracked.
  // Main removes the named id from its latest on-disk ledger, so a webhook or
  // boss card added since this renderer's last poll cannot be lost.
  const dismissTask = useCallback(async (id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id)); // optimistic
    try {
      const result = await window.cth.hiveDeleteTask(id);
      if (!result.ok) void refresh();
    } catch { /* keep last good; the next poll re-syncs from disk */ }
  }, [refresh]);

  useEffect(() => {
    refresh();
    timer.current = setInterval(refresh, POLL_MS);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [refresh]);

  const restorableAgents = useStore((s) => s.restorableAgents);
  /** Resolve an assignee id to a display name — falls back to the restorable
   *  roster so a done card keeps its author's name even after that worker's
   *  terminal is gone, then to the raw id. */
  const nameFor = (id?: string): string | undefined =>
    id
      ? (agents.find((a) => a.id === id)?.name
        ?? restorableAgents.find((a) => a.id === id)?.name
        ?? id)
      : undefined;

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: 'var(--cth-paper-200)', position: 'relative' }}>
      {/* Toolbar — read-only: the boss is the ledger's writer. New work enters
          through the dispatch box (which mails the boss), not by the human
          inserting cards the orchestrator never heard about. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', flexShrink: 0,
        borderBottom: '1px solid var(--cth-ink-300)'
      }}>
        <span style={{ fontFamily: 'var(--cth-font-ui)', fontWeight: 700, fontSize: 10, letterSpacing: '0.06em', color: 'var(--cth-ink-500)' }}>
          {tasks.length} task{tasks.length === 1 ? '' : 's'}
        </span>
        {(['status', 'agent'] as const).map((k) => (
          <button
            key={k}
            onClick={() => setLens(k)}
            title={k === 'status' ? 'Four columns: todo, doing, blocked, done' : 'One row per agent: what each is carrying'}
            style={{
              padding: '4px 8px 3px', border: 'none', cursor: 'pointer',
              fontFamily: 'var(--cth-font-ui)', fontWeight: 700, fontSize: 9.5, letterSpacing: '0.08em',
              background: lens === k ? 'var(--cth-sky-light)' : 'transparent',
              color: lens === k ? 'var(--cth-sky)' : 'var(--cth-ink-500)',
              boxShadow: `inset 0 0 0 1px ${lens === k ? 'var(--cth-sky)' : 'var(--cth-ink-300)'}`
            }}
          >{k === 'status' ? 'BY STATUS' : 'BY AGENT'}</button>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--cth-ink-500)' }}>
          new work? dispatch it to Rudy (monitor tab)
        </span>
      </div>

      {/* Columns */}
      {lens === 'status' && (
        <div style={{
          flex: 1, minHeight: 0, display: 'flex', gap: 8, padding: 10, overflowX: 'auto'
        }}>
          {COLUMNS.map((col) => {
            const cards = sortCards(tasks.filter((t) => t.status === col.key), col.key);
            return (
              <div key={col.key} style={{
                flex: '1 1 0', minWidth: 170, display: 'flex', flexDirection: 'column',
                background: 'var(--cth-cream-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)'
              }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px 4px',
                  background: col.accent, boxShadow: 'inset 0 -1px 0 var(--cth-ink-900)',
                  fontFamily: 'var(--cth-font-ui)', fontWeight: 700, fontSize: 10, letterSpacing: '0.06em', color: 'var(--cth-ink-900)'
                }}>
                  {col.label}
                  <span style={{ marginLeft: 'auto', fontSize: 11, fontFamily: 'var(--cth-font-ui)' }}>{cards.length}</span>
                </div>
                <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {cards.length === 0 && (
                    <div style={{ fontSize: 11, color: 'var(--cth-ink-500)', textAlign: 'center', padding: '10px 0' }}>
                      nothing here
                    </div>
                  )}
                  {cards.map((t) => (
                    <TaskCard
                      key={t.id}
                      task={t}
                      accent={col.accent}
                      assigneeName={nameFor(t.assignee)}
                      onOpen={() => openTaskDetail(t.id)}
                      onDismiss={() => dismissTask(t.id)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* One row per agent — who is carrying what, at a glance. */}
      {lens === 'agent' && (
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {(() => {
            const groups = new Map<string, HiveTask[]>();
            for (const t of tasks) {
              const key = nameFor(t.assignee) ?? '(unassigned)';
              const g = groups.get(key) ?? [];
              g.push(t);
              groups.set(key, g);
            }
            const names = [...groups.keys()].sort((x, y) =>
              x === '(unassigned)' ? 1 : y === '(unassigned)' ? -1 : x.localeCompare(y));
            if (names.length === 0) {
              return <div style={{ fontSize: 12, color: 'var(--cth-ink-500)', textAlign: 'center', padding: '18px 0' }}>
                No tasks on the board yet.
              </div>;
            }
            return names.map((name) => {
              const list = [...groups.get(name)!].sort((x, y) =>
                STATUS_ORDER[x.status] - STATUS_ORDER[y.status] || y.priority - x.priority);
              const open = list.filter((t) => t.status !== 'done').length;
              return (
                <div key={name} style={{ background: 'var(--cth-cream-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)' }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px 4px',
                    borderBottom: '1px solid var(--cth-ink-300)',
                    fontFamily: 'var(--cth-font-ui)', fontWeight: 700, fontSize: 10, color: 'var(--cth-ink-700)'
                  }}>
                    {name.toUpperCase()}
                    <span style={{ marginLeft: 'auto', fontFamily: 'var(--cth-font-ui)', fontSize: 11, color: 'var(--cth-ink-500)' }}>
                      {open} open · {list.length - open} done
                    </span>
                  </div>
                  <div style={{ padding: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {list.map((t) => (
                      <TaskCard
                        key={t.id}
                        task={t}
                        accent={(COLUMNS.find((c) => c.key === t.status) ?? COLUMNS[0]).accent}
                        assigneeName={undefined}
                        statusLabel={t.status}
                        onOpen={() => openTaskDetail(t.id)}
                        onDismiss={() => dismissTask(t.id)}
                      />
                    ))}
                  </div>
                </div>
              );
            });
          })()}
        </div>
      )}
    </div>
  );
}

// ─── Card ────────────────────────────────────────────────────────────────────
// Deliberately minimal — a colored status edge, the title, a whisper of an
// assignee. Everything else (the full contract, deps, controls) lives in the
// detail view a click away: a kanban card can carry a title at most.

function TaskCard({ task, accent, assigneeName, statusLabel, onOpen, onDismiss }: {
  task: HiveTask;
  accent: string;
  assigneeName?: string;
  /** BY AGENT lens: the column is gone, so the card says its own status. */
  statusLabel?: Status;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  return (
    <div style={{ position: 'relative', display: 'flex' }}>
      <button
        onClick={onOpen}
        title="open task details"
        style={{
          flex: 1, minWidth: 0,
          display: 'flex', alignItems: 'stretch', gap: 0, padding: 0,
          border: 'none', cursor: 'pointer', textAlign: 'left',
          background: 'var(--cth-paper-100)',
          boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)'
        }}
      >
        <span style={{ width: 4, flexShrink: 0, background: accent, boxShadow: 'inset -1px 0 0 var(--cth-ink-700)' }} />
        <span style={{ flex: 1, minWidth: 0, padding: '6px 18px 6px 7px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{
            fontFamily: 'var(--cth-font-ui)', fontSize: 12, lineHeight: '16px',
            fontWeight: 500,
            color: 'var(--cth-ink-900)',
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden'
          }}>{task.title}</span>
          {assigneeName && (
            <span style={{ fontSize: 9.5, letterSpacing: '0.08em', color: 'var(--cth-ink-500)', fontWeight: 700, fontFamily: 'var(--cth-font-ui)' }}>
              {assigneeName.toUpperCase()}
            </span>
          )}
          {statusLabel && (
            <span style={{ fontSize: 9.5, color: 'var(--cth-ink-500)', fontWeight: 700, fontFamily: 'var(--cth-font-ui)', letterSpacing: '0.08em' }}>
              {statusLabel.toUpperCase()}
            </span>
          )}
        </span>
        {waitsOnHuman(task) && (
          <span title="waiting on YOUR answer, see the ASK ME tab" style={{
            alignSelf: 'center', marginRight: 18, flexShrink: 0,
            fontFamily: 'var(--cth-font-ui)', fontWeight: 700, fontSize: 10, padding: '3px 5px 2px',
            background: 'var(--cth-lilac)', color: 'var(--cth-ink-900)',
            boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)'
          }}>?</span>
        )}
      </button>
      {/* Dismiss — sibling button (not nested) so it never triggers onOpen. */}
      <button
        onClick={(e) => { e.stopPropagation(); onDismiss(); }}
        title="dismiss this task (removes it from the board)"
        aria-label="dismiss task"
        style={{
          position: 'absolute', top: 0, right: 0, width: 16, height: 16, padding: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
          border: 'none', cursor: 'pointer', background: 'transparent',
          color: 'var(--cth-ink-500)', fontFamily: 'var(--cth-font-ui)', fontSize: 12
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--cth-coral)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--cth-ink-500)'; }}
      >✕</button>
    </div>
  );
}

// ─── Detail view ─────────────────────────────────────────────────────────────
// The full breakdown of one task: status, assignee, priority, the complete
// description (the boss writes 4-part dispatch contracts in there — preserved
// line by line), dependencies resolved to their titles, the human Q&A trail,
// and the move/assign controls that used to crowd every card. Rendered as an
// APP-WIDE overlay (over the office floor) — this content grows, so it gets
// the big stage instead of the narrow side panel. Exported for App's
// TaskDetailOverlay; opened via the store's openTaskDetail from anywhere.

export function TaskDetail({ task, all, assigneeName, onMove, onAssign, onClose }: {
  task: HiveTask;
  all: HiveTask[];
  assigneeName?: string;
  onMove: (s: Status) => void;
  onAssign: () => void;
  onClose: () => void;
}) {
  const col = COLUMNS.find((c) => c.key === task.status) ?? COLUMNS[0];
  // Belt + suspenders: parseTasks normalizes these, but the ledger is a
  // hand-written file — never trust a card's shape at the point of use.
  const deps = (task.dependsOn ?? [])
    .map((id) => all.find((t) => t.id === id))
    .filter((t): t is HiveTask => !!t);
  const created = new Date(task.createdAt);
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 280,
        background: 'var(--hq-scrim, rgba(0, 0, 0, 0.55))',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24
      }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ width: 720, maxWidth: '94vw', maxHeight: '90vh', display: 'flex' }}>
        <PixelPanel variant="dialog" title="TASK" noPadding style={{ display: 'flex', flexDirection: 'column', width: '100%', minHeight: 0 }}>
          <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0, overflowY: 'auto' }}>
            {/* Title under a status-colored bar */}
            <div style={{ borderLeft: `4px solid ${col.accent}`, paddingLeft: 8 }}>
              <div style={{ fontFamily: 'var(--cth-font-ui)', fontSize: 13, lineHeight: '19px', fontWeight: 600, color: 'var(--cth-ink-900)' }}>
                {task.title}
              </div>
            </div>

            {/* Fact row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{
                fontFamily: 'var(--cth-font-ui)', fontWeight: 700, fontSize: 10, padding: '2px 6px 1px',
                background: col.accent, color: 'var(--cth-ink-900)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)'
              }}>{col.label}</span>
              {assigneeName
                ? <PixelBadge status="working" label={assigneeName} />
                : <span style={{ fontSize: 11, color: 'var(--cth-ink-300)' }}>unassigned</span>}
              <PriorityDots level={Math.max(1, Math.min(5, task.priority))} />
              <span style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--cth-ink-500)', fontFamily: 'var(--cth-font-mono)' }}>
                {isNaN(created.getTime()) ? '' : created.toLocaleString()}
              </span>
            </div>

            {/* The contract — preserved line by line */}
            <div style={{
              padding: 10, background: 'var(--cth-paper-100)',
              boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)',
              fontFamily: 'var(--cth-font-mono)', fontSize: 12, lineHeight: '18px',
              color: 'var(--cth-ink-900)', whiteSpace: 'pre-wrap', wordBreak: 'break-word'
            }}>
              {task.description?.trim() || <span style={{ color: 'var(--cth-ink-300)' }}>(no description on this card)</span>}
            </div>

            {/* The human Q&A trail — every decision documented on the card */}
            {(task.humanQA?.length ?? 0) > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ fontFamily: 'var(--cth-font-ui)', fontWeight: 700, fontSize: 10, color: 'var(--cth-ink-500)' }}>
                  HUMAN Q&A
                </div>
                {task.humanQA!.map((e, i) => (
                  <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <div style={{
                      padding: '5px 7px', background: 'var(--cth-lilac-light)',
                      boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)',
                      fontSize: 12, lineHeight: '17px', color: 'var(--cth-ink-900)', whiteSpace: 'pre-wrap'
                    }}>
                      <span style={{ fontFamily: 'var(--cth-font-ui)', fontWeight: 700, fontSize: 10, marginRight: 6 }}>Q</span>
                      {e.q}
                    </div>
                    {e.a ? (
                      <div style={{
                        padding: '5px 7px', background: 'var(--cth-mint-light)',
                        boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)',
                        fontSize: 12, lineHeight: '17px', color: 'var(--cth-ink-900)', whiteSpace: 'pre-wrap'
                      }}>
                        <span style={{ fontFamily: 'var(--cth-font-ui)', fontWeight: 700, fontSize: 10, marginRight: 6 }}>A</span>
                        {e.a}
                      </div>
                    ) : (
                      <div style={{
                        fontSize: 10, color: 'var(--cth-coral)',
                        fontFamily: 'var(--cth-font-ui)', fontWeight: 700, letterSpacing: '0.05em'
                      }}>
                        AWAITING YOUR ANSWER · ASK ME TAB
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Dependencies, resolved to titles */}
            {deps.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ fontFamily: 'var(--cth-font-ui)', fontWeight: 700, fontSize: 10, color: 'var(--cth-ink-500)' }}>
                  DEPENDS ON
                </div>
                {deps.map((d) => {
                  const dc = COLUMNS.find((c) => c.key === d.status) ?? COLUMNS[0];
                  return (
                    <div key={d.id} style={{
                      display: 'flex', alignItems: 'center', gap: 6, padding: '3px 6px',
                      background: 'var(--cth-cream-200)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)',
                      fontSize: 12, color: 'var(--cth-ink-700)'
                    }}>
                      <span style={{ width: 8, height: 8, background: dc.accent, boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)', flexShrink: 0 }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.title}</span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Controls. The bare select read as a mystery dropdown — the MOVE
                TO label says what changing it does. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{
                fontFamily: 'var(--cth-font-ui)', fontWeight: 700, fontSize: 10,
                letterSpacing: '0.05em', color: 'var(--cth-ink-500)', flexShrink: 0
              }}>MOVE TO</span>
              <select
                value={task.status}
                onChange={(e) => onMove(e.target.value as Status)}
                style={{
                  flex: 1, padding: '4px 6px', background: 'var(--cth-paper-100)', border: 'none',
                  boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)', fontFamily: 'var(--cth-font-ui)',
                  fontSize: 12, color: 'var(--cth-ink-900)', cursor: 'pointer'
                }}
              >
                {COLUMNS.map((c) => (<option key={c.key} value={c.key}>{c.label.toLowerCase()}</option>))}
              </select>
              <PixelButton variant="secondary" size="sm" onClick={onAssign}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                  <Icon name="arrow-right" /> assign
                </span>
              </PixelButton>
              <PixelButton variant="ghost" size="sm" onClick={onClose}>close</PixelButton>
            </div>
          </div>
        </PixelPanel>
      </div>
    </div>
  );
}

function PriorityDots({ level }: { level: number }) {
  // 1 = lowest, 5 = highest. Warmer fill as priority climbs.
  const color = level >= 4 ? 'var(--cth-coral)' : level === 3 ? 'var(--cth-lemon)' : 'var(--cth-mint)';
  return (
    <span title={`Priority ${level}/5`} style={{ display: 'inline-flex', gap: 1, flexShrink: 0, marginTop: 2 }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} style={{
          width: 4, height: 8,
          background: i <= level ? color : 'var(--cth-cream-200)',
          boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)'
        }} />
      ))}
    </span>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '6px 8px', background: 'var(--cth-paper-100)', border: 'none',
  boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)', fontFamily: 'var(--cth-font-ui)',
  fontSize: 12, lineHeight: '17px', color: 'var(--cth-ink-900)', outline: 'none', boxSizing: 'border-box'
};

const selectStyle: React.CSSProperties = {
  padding: '3px 6px', background: 'var(--cth-paper-100)', border: 'none',
  boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)', fontFamily: 'var(--cth-font-ui)',
  fontSize: 12, color: 'var(--cth-ink-900)', cursor: 'pointer'
};

const labelStyle: React.CSSProperties = {
  fontFamily: 'var(--cth-font-ui)', fontWeight: 700, fontSize: 10, color: 'var(--cth-ink-500)'
};
