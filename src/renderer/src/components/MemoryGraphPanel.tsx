import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '@/store/store';
import { PixelBadge } from './PixelBadge';
import { Icon } from './Icon';
import type { MessageAct } from '@/scene/office/MessageEnvelope';
import {
  buildGraph,
  type GraphData,
  type GraphNode,
  type GraphEdge,
  type MessageLogEntry
} from './memoryGraph/buildGraph';
import { forceLayout, type Positions } from './memoryGraph/forceLayout';

/** The memory-graph tab: hive agents as nodes, messages as edges, an optional
 *  topic layer from each agent's memory file. SVG-rendered (DESIGN.md neo-pixel:
 *  disc nodes, hard offset shadows, pixel labels). See MEMORY_GRAPH_SPEC.md.
 *
 *  All data comes from the existing preload bridge: store.agents + hiveLog +
 *  hiveMemory. No new IPC. Click an agent to jump to its memory; hover to peek. */
export function MemoryGraphPanel({
  bossId,
  onJumpToMemory
}: {
  bossId: string;
  onJumpToMemory: (agentId: string) => void;
}) {
  const agents = useStore((s) => s.agents);
  // Gone workers still appear (as ghosts) when the log mentions them; the
  // restorable roster gives their old names back.
  const restorableAgents = useStore((s) => s.restorableAgents);

  const [log, setLog] = useState<MessageLogEntry[]>([]);
  const [showTopics, setShowTopics] = useState(false);
  const [memories, setMemories] = useState<Record<string, string>>({});
  const [loadingTopics, setLoadingTopics] = useState(false);

  // ── poll the message log (same cadence as the Activity tab) ──────────────────
  const refresh = useCallback(async () => {
    try { setLog((await window.cth.hiveLog(200)) as MessageLogEntry[]); } catch { /* noop */ }
  }, []);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  // ── lazy memory loads: one on hover, all when the topic layer turns on ───────
  const fetchMemory = useCallback(async (id: string) => {
    try {
      const text = await window.cth.hiveMemory(id);
      setMemories((m) => ({ ...m, [id]: text ?? '' }));
    } catch { setMemories((m) => ({ ...m, [id]: '' })); }
  }, []);

  useEffect(() => {
    if (!showTopics) return;
    const missing = agents.map((a) => a.id).filter((id) => !(id in memories));
    if (missing.length === 0) return;
    setLoadingTopics(true);
    Promise.all(missing.map((id) => window.cth.hiveMemory(id).then(
      (t) => [id, t ?? ''] as const,
      () => [id, ''] as const
    ))).then((pairs) => {
      setMemories((m) => ({ ...m, ...Object.fromEntries(pairs) }));
      setLoadingTopics(false);
    });
  }, [showTopics, agents, memories]);

  // ── graph model ──────────────────────────────────────────────────────────────
  const graph: GraphData = useMemo(
    () => buildGraph(agents, log, {
      showTopics,
      memories,
      nameFor: (id) => restorableAgents.find((a) => a.id === id)?.name
    }),
    [agents, log, showTopics, memories, restorableAgents]
  );

  // ── canvas sizing ─────────────────────────────────────────────────────────────
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [dims, setDims] = useState({ w: 640, h: 440 });
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r && r.width > 0 && r.height > 0) setDims({ w: Math.round(r.width), h: Math.round(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── pinned (dragged) node positions ──────────────────────────────────────────
  const [pinned, setPinned] = useState<Record<string, { x: number; y: number }>>({});

  // recompute layout only when structure / size / pins change (not on every poll)
  const structKey = useMemo(
    () => graph.nodes.map((n) => n.id).join(',') + '|' + graph.edges.map((e) => e.id).join(','),
    [graph]
  );
  const pinnedKey = useMemo(() => JSON.stringify(pinned), [pinned]);
  const layout: Positions = useMemo(() => {
    const lnodes = graph.nodes.map((n) => ({
      id: n.id,
      gravityBias: n.kind === 'topic' ? 0.6 : n.kind === 'gone' ? 0.8 : n.kind === 'pseudo' ? 1.4 : n.id === bossId ? 2.4 : 1
    }));
    const ledges = graph.edges.map((e) => ({
      source: e.source,
      target: e.target,
      strength: e.kind === 'topic' ? 0.35 : 0.7 + Math.min(e.weight, 5) * 0.06
    }));
    return forceLayout(lnodes, ledges, { width: dims.w, height: dims.h, pinned });
    // structKey/pinnedKey capture the relevant graph identity; intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structKey, pinnedKey, dims.w, dims.h, bossId]);

  // ── drag ──────────────────────────────────────────────────────────────────────
  const [live, setLive] = useState<{ id: string; x: number; y: number } | null>(null);
  const dragOffset = useRef({ x: 0, y: 0 });
  const moved = useRef(false);

  const toSvg = useCallback((clientX: number, clientY: number) => {
    const r = wrapRef.current?.getBoundingClientRect();
    return { x: clientX - (r?.left ?? 0), y: clientY - (r?.top ?? 0) };
  }, []);

  const posOf = useCallback(
    (id: string) => (live && live.id === id ? { x: live.x, y: live.y } : layout.get(id)),
    [live, layout]
  );

  const startDrag = useCallback((e: React.MouseEvent, id: string) => {
    e.preventDefault();
    const p = posOf(id);
    if (!p) return;
    const s = toSvg(e.clientX, e.clientY);
    dragOffset.current = { x: s.x - p.x, y: s.y - p.y };
    moved.current = false;
    setLive({ id, x: p.x, y: p.y });
  }, [posOf, toSvg]);

  useEffect(() => {
    if (!live) return;
    const onMove = (ev: MouseEvent) => {
      const s = toSvg(ev.clientX, ev.clientY);
      const x = Math.max(8, Math.min(dims.w - 8, s.x - dragOffset.current.x));
      const y = Math.max(8, Math.min(dims.h - 8, s.y - dragOffset.current.y));
      moved.current = true;
      setLive((l) => (l ? { ...l, x, y } : l));
    };
    const onUp = () => {
      setLive((l) => {
        if (l && moved.current) setPinned((p) => ({ ...p, [l.id]: { x: l.x, y: l.y } }));
        return null;
      });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [live, toSvg, dims.w, dims.h]);

  // ── hover / tooltip ─────────────────────────────────────────────────────────
  const [hover, setHover] = useState<
    | { kind: 'node'; node: GraphNode }
    | { kind: 'edge'; edge: GraphEdge }
    | null
  >(null);
  const [cursor, setCursor] = useState({ x: 0, y: 0 });

  const onCanvasMove = useCallback((e: React.MouseEvent) => {
    const s = toSvg(e.clientX, e.clientY);
    setCursor(s);
  }, [toSvg]);

  const hoverNode = useCallback((node: GraphNode) => {
    setHover({ kind: 'node', node });
    if (node.kind === 'agent' && !(node.id in memories)) fetchMemory(node.id);
  }, [memories, fetchMemory]);

  const hoverNodeId = hover?.kind === 'node' ? hover.node.id : null;
  const nodeById = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);

  const messageEdgeCount = graph.edges.filter((e) => e.kind === 'message').length;

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: 'var(--cth-paper-200)' }}>
      {/* toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', flexShrink: 0,
        borderBottom: '1px solid var(--cth-ink-300)', background: 'var(--cth-cream-100)', flexWrap: 'wrap'
      }}>
        <Toggle on={showTopics} onClick={() => setShowTopics((v) => !v)} label="topics" />
        <button onClick={refresh} title="Refresh" style={iconBtn}>
          refresh
        </button>
        <div style={{ flex: 1 }} />
        {showTopics && (
          <span style={{ fontSize: 11, color: 'var(--cth-ink-500)' }}>
            {loadingTopics ? 'reading memory…' : `showing ${graph.topicShown} of ${graph.topicTotal} topics`}
          </span>
        )}
      </div>

      {/* canvas */}
      <div ref={wrapRef} style={{ position: 'relative', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <svg
          width={dims.w}
          height={dims.h}
          onMouseMove={onCanvasMove}
          style={{ display: 'block', userSelect: 'none' }}
        >
          <defs>
            <pattern id="mg-grid" width={32} height={32} patternUnits="userSpaceOnUse">
              <circle cx={1} cy={1} r={1} fill="var(--cth-ink-100)" />
            </pattern>
            {MARKER_ACTS.map((act) => (
              <marker
                key={act}
                id={`mg-arrow-${act}`}
                viewBox="0 0 8 8" refX={7} refY={4}
                markerWidth={7} markerHeight={7}
                markerUnits="userSpaceOnUse"
                orient="auto-start-reverse"
              >
                <path d="M0,0 L8,4 L0,8 Z" fill={actColor(act)} />
              </marker>
            ))}
          </defs>

          <rect x={0} y={0} width={dims.w} height={dims.h} fill="var(--cth-paper-100)" />
          <rect x={0} y={0} width={dims.w} height={dims.h} fill="url(#mg-grid)" />

          {/* edges */}
          <g>
            {graph.edges.map((e) => {
              const sp = posOf(e.source);
              const tp = posOf(e.target);
              const sn = nodeById.get(e.source);
              const tn = nodeById.get(e.target);
              if (!sp || !tp || !sn || !tn) return null;
              const isTopic = e.kind === 'topic';
              const touches = !hoverNodeId || e.source === hoverNodeId || e.target === hoverNodeId;
              const dx = tp.x - sp.x;
              const dy = tp.y - sp.y;
              const dist = Math.hypot(dx, dy) || 1;
              const ux = dx / dist;
              const uy = dy / dist;
              const startArrow = !isTopic && (e.dir === 'bwd' || e.dir === 'both');
              const endArrow = !isTopic && (e.dir === 'fwd' || e.dir === 'both');
              const sr = nodeRadius(sn) + (startArrow ? 7 : 2);
              const tr = nodeRadius(tn) + (endArrow ? 7 : 2);
              const x1 = sp.x + ux * sr;
              const y1 = sp.y + uy * sr;
              const x2 = tp.x - ux * tr;
              const y2 = tp.y - uy * tr;
              const stroke = isTopic ? 'var(--cth-ink-300)' : actColor(e.lastAct);
              const w = isTopic ? 1 : 1 + Math.min(e.weight, 4) * 0.35;
              return (
                <line
                  key={e.id}
                  x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke={stroke}
                  strokeWidth={w}
                  strokeDasharray={isTopic ? '3 3' : undefined}
                  opacity={touches ? (isTopic ? 0.55 : 0.9) : 0.12}
                  markerStart={startArrow ? `url(#mg-arrow-${e.lastAct ?? 'inform'})` : undefined}
                  markerEnd={endArrow ? `url(#mg-arrow-${e.lastAct ?? 'inform'})` : undefined}
                  onMouseEnter={() => setHover({ kind: 'edge', edge: e })}
                  onMouseLeave={() => setHover(null)}
                  style={{ cursor: 'default' }}
                />
              );
            })}
          </g>

          {/* nodes */}
          <g>
            {graph.nodes.map((n) => {
              const p = posOf(n.id);
              if (!p) return null;
              const s = nodeSize(n);
              const half = s / 2;
              const dim = hoverNodeId && hoverNodeId !== n.id && !isNeighbor(graph, hoverNodeId, n.id);
              // Gone workers keep their memory.md on disk, so the jump still works.
              const navigable = n.kind === 'agent' || n.kind === 'gone';
              return (
                <g
                  key={n.id}
                  transform={`translate(${p.x},${p.y})`}
                  opacity={dim ? 0.3 : 1}
                  onMouseEnter={() => hoverNode(n)}
                  onMouseLeave={() => setHover(null)}
                  onMouseDown={(e) => startDrag(e, n.id)}
                  onClick={() => { if (navigable && !moved.current) onJumpToMemory(n.id); }}
                  style={{ cursor: navigable ? 'pointer' : 'grab' }}
                >
                  {/* One shape per node, flat. The old stack (offset shadow +
                      body + boss double ring + status halo) drew four circles
                      per agent and read as clutter. Status is a small dot at
                      the node's edge; the boss is simply the biggest node with
                      the brand-red ring. */}
                  {n.kind === 'pseudo' && n.id === 'human' ? (
                    <rect x={-half} y={-half} width={s} height={s} transform="rotate(45)"
                      fill={nodeFill(n)} stroke="var(--cth-ink-700)" strokeWidth={1.5} />
                  ) : n.kind === 'gone' ? (
                    <circle
                      r={half - 1}
                      fill="transparent"
                      stroke="var(--cth-ink-300)"
                      strokeWidth={1.2}
                      strokeDasharray="2.5 3"
                    />
                  ) : (
                    <>
                      <circle
                        r={half}
                        fill={nodeFill(n)}
                        stroke={n.kind === 'agent' && n.isBoss ? 'var(--cth-brand-red)' : 'var(--cth-ink-700)'}
                        strokeWidth={n.kind === 'agent' && n.isBoss ? 2 : 1.25}
                      />
                      {n.kind === 'agent' && (
                        <circle
                          cx={half * 0.72} cy={half * 0.72} r={3.5}
                          fill={`var(--cth-status-${n.status})`}
                          stroke="var(--cth-paper-100)"
                          strokeWidth={1.25}
                        />
                      )}
                    </>
                  )}
                </g>
              );
            })}
          </g>

          {/* labels */}
          <g pointerEvents="none">
            {graph.nodes.map((n) => {
              const p = posOf(n.id);
              if (!p) return null;
              const dim = hoverNodeId && hoverNodeId !== n.id && !isNeighbor(graph, hoverNodeId, n.id);
              const below = nodeSize(n) / 2 + 13;
              const isTopic = n.kind === 'topic';
              const isGone = n.kind === 'gone';
              return (
                <text
                  key={n.id}
                  x={p.x} y={p.y + below}
                  textAnchor="middle"
                  opacity={dim ? 0.25 : 1}
                  style={{
                    // Agents speak the app's control voice: bold mono caps.
                    fontFamily: 'var(--cth-font-ui)',
                    fontWeight: isTopic ? 400 : 700,
                    fontSize: isTopic ? 11 : 10,
                    letterSpacing: isTopic ? undefined : '0.05em',
                    textTransform: isTopic ? undefined : 'uppercase',
                    fill: isTopic || isGone ? 'var(--cth-ink-500)' : 'var(--cth-ink-900)'
                  }}
                >{truncate(n.label, isTopic ? 20 : 16)}</text>
              );
            })}
          </g>
        </svg>

        {/* empty hint */}
        {messageEdgeCount === 0 && !showTopics && (
          <div style={{
            position: 'absolute', top: 10, left: 0, right: 0, textAlign: 'center',
            fontSize: 12, color: 'var(--cth-ink-500)', pointerEvents: 'none'
          }}>No messages logged yet, the hive is quiet. Agents shown as roster.</div>
        )}

        {/* tooltip */}
        {hover && (
          <Tooltip x={cursor.x} y={cursor.y} wrap={dims}>
            {hover.kind === 'node'
              ? <NodeTip node={hover.node} memories={memories} />
              : <EdgeTip edge={hover.edge} nodeById={nodeById} />}
          </Tooltip>
        )}

        {/* legend */}
        <Legend />
      </div>
    </div>
  );
}

// ─── tooltip bodies ──────────────────────────────────────────────────────────

function NodeTip({ node, memories }: { node: GraphNode; memories: Record<string, string> }) {
  if (node.kind === 'agent') {
    const mem = memories[node.id];
    const snippet = mem === undefined ? 'loading memory…' : memorySnippet(mem);
    return (
      <>
        <div style={tipTitle}>{node.label}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '2px 0 4px' }}>
          <PixelBadge status={node.status} />
          <span style={{ fontSize: 11, color: 'var(--cth-ink-500)' }}>{node.degree} message link{node.degree === 1 ? '' : 's'}</span>
        </div>
        <div style={tipBody}>{snippet}</div>
      </>
    );
  }
  if (node.kind === 'topic') {
    return (
      <>
        <div style={tipTitle}>{node.label}</div>
        <div style={tipBody}>shared by {node.weight} agents</div>
      </>
    );
  }
  if (node.kind === 'gone') {
    return (
      <>
        <div style={tipTitle}>{node.label}</div>
        <div style={tipBody}>
          left the floor · {node.degree} message link{node.degree === 1 ? '' : 's'} still on record
        </div>
      </>
    );
  }
  return (
    <>
      <div style={tipTitle}>{node.label}</div>
      <div style={tipBody}>{node.id === 'human' ? 'escalations to the human' : 'broadcast to everyone'}</div>
    </>
  );
}

function EdgeTip({ edge, nodeById }: { edge: GraphEdge; nodeById: Map<string, GraphNode> }) {
  const a = nodeById.get(edge.source)?.label ?? edge.source;
  const b = nodeById.get(edge.target)?.label ?? edge.target;
  if (edge.kind === 'topic') {
    return <div style={tipBody}>{a} knows about “{b}”</div>;
  }
  const arrow = edge.dir === 'both' ? '↔' : edge.dir === 'bwd' ? '←' : '→';
  return (
    <>
      <div style={tipTitle}>{a} {arrow} {b}</div>
      <div style={{ fontSize: 11, color: 'var(--cth-ink-500)', margin: '2px 0' }}>
        {edge.weight} message{edge.weight === 1 ? '' : 's'} · last: {edge.lastAct ?? ''}
      </div>
      {edge.lastSubject && <div style={tipBody}>{truncate(edge.lastSubject, 80)}</div>}
    </>
  );
}

function Legend() {
  const items: { c: string; label: string }[] = [
    { c: actColor('request'), label: 'request' },
    { c: actColor('query'), label: 'query' },
    { c: actColor('propose'), label: 'propose' },
    { c: actColor('agree'), label: 'agree/done' },
    { c: actColor('refuse'), label: 'refuse' },
    { c: 'var(--cth-ink-300)', label: 'inform/topic' }
  ];
  return (
    <div style={{
      position: 'absolute', bottom: 8, left: 8, padding: '5px 7px',
      background: 'var(--cth-cream-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)',
      display: 'flex', flexWrap: 'wrap', gap: '2px 10px', maxWidth: 280, pointerEvents: 'none'
    }}>
      {items.map((it) => (
        <span key={it.label} style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          fontFamily: 'var(--cth-font-ui)', fontWeight: 700, fontSize: 9.5,
          letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--cth-ink-700)'
        }}>
          <span style={{ width: 9, height: 3, background: it.c, display: 'inline-block' }} /> {it.label}
        </span>
      ))}
    </div>
  );
}

function Tooltip({ x, y, wrap, children }: { x: number; y: number; wrap: { w: number; h: number }; children: React.ReactNode }) {
  const W = 240;
  const left = Math.min(x + 14, wrap.w - W - 6);
  const flipUp = y > wrap.h - 120;
  return (
    <div style={{
      position: 'absolute', left: Math.max(6, left), top: flipUp ? undefined : y + 14,
      bottom: flipUp ? wrap.h - y + 14 : undefined,
      width: W, padding: 8, pointerEvents: 'none', zIndex: 5,
      background: 'var(--cth-cream-50)', boxShadow: '2px 2px 0 var(--cth-ink-900), inset 0 0 0 1px var(--cth-ink-300)'
    }}>{children}</div>
  );
}

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 9px 3px', border: 'none', cursor: 'pointer',
        background: on ? 'var(--cth-lilac)' : 'var(--cth-cream-200)',
        boxShadow: on ? 'inset 0 0 0 1px var(--cth-ink-300)' : 'inset 0 0 0 1px var(--cth-ink-100)',
        fontFamily: 'var(--cth-font-ui)', fontWeight: 700, fontSize: 10,
        letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--cth-ink-900)'
      }}
    >
      <Icon name={on ? 'check' : 'plus'} /> {label}
    </button>
  );
}

// ─── helpers ─────────────────────────────────────────────────────────────────

const MARKER_ACTS: MessageAct[] = ['request', 'inform', 'propose', 'query', 'agree', 'refuse', 'done'];

/** Speech-act → colour. Mirrors ACT_COLOR in MessageEnvelope.ts so the graph
 *  speaks the same visual language as the floor's flying envelopes. */
function actColor(act?: MessageAct): string {
  switch (act) {
    case 'request': return 'var(--cth-sky)';
    case 'query': return 'var(--cth-lilac)';
    case 'propose': return 'var(--cth-lemon)';
    case 'agree': return 'var(--cth-mint)';
    case 'done': return 'var(--cth-mint)';
    case 'refuse': return 'var(--cth-coral)';
    case 'inform':
    default: return 'var(--cth-ink-300)';
  }
}

function nodeSize(n: GraphNode): number {
  if (n.kind === 'agent') return (n.isBoss ? 30 : 22) + Math.min(n.degree, 10) * 1.0;
  if (n.kind === 'topic') return 12 + Math.min(n.weight, 6) * 1.4;
  if (n.kind === 'gone') return 16 + Math.min(n.degree, 10) * 0.8;
  return 17; // pseudo
}
function nodeRadius(n: GraphNode): number { return nodeSize(n) / 2; }

function nodeFill(n: GraphNode): string {
  // The tinted fill, not the full accent: a solid gold/red disc dominated the
  // canvas; the light fill + colored status dot keeps the accent readable
  // without shouting.
  if (n.kind === 'agent') return `var(--cth-${n.accent}-light)`;
  if (n.kind === 'topic') return 'var(--cth-cream-200)';
  if (n.kind === 'gone') return 'var(--cth-cream-200)';
  return n.id === 'human' ? 'var(--cth-lemon-light)' : 'var(--cth-ink-300)';
}

function isNeighbor(graph: GraphData, a: string, b: string): boolean {
  for (const e of graph.edges) {
    if ((e.source === a && e.target === b) || (e.source === b && e.target === a)) return true;
  }
  return false;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/** First meaningful line(s) of a memory file, for the hover preview. */
function memorySnippet(text: string): string {
  if (!text.trim()) return 'No memory recorded yet.';
  const lines = text
    .split('\n')
    .map((l) => l.replace(/^[#>\-*\s]+/, '').trim())
    .filter((l) => l && !/^_.*_$/.test(l) && !/^memory —/i.test(l));
  return truncate(lines.slice(0, 3).join(' '), 200) || 'No memory recorded yet.';
}

const iconBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 9px 3px', border: 'none', cursor: 'pointer',
  background: 'var(--cth-cream-200)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)',
  fontFamily: 'var(--cth-font-ui)', fontWeight: 700, fontSize: 10,
  letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--cth-ink-900)'
};

const tipTitle: React.CSSProperties = {
  fontFamily: 'var(--cth-font-ui)', fontSize: 12, color: 'var(--cth-ink-900)', lineHeight: '16px'
};
const tipBody: React.CSSProperties = {
  fontSize: 11, lineHeight: '15px', color: 'var(--cth-ink-700)'
};
