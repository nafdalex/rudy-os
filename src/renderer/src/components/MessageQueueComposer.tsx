import { ClipboardEvent, DragEvent, KeyboardEvent, useEffect, useLayoutEffect, useRef, useState , type ReactNode } from 'react';
import { PixelButton } from './PixelButton';
import { Icon } from './Icon';
import { useStore, type Agent, type QueuedMessage } from '@/store/store';
import { clearTerminalDraft, dismissTerminalPicker, terminalAutomationBlockFor } from './terminalPool';
import type { TerminalAutomationBlock } from './terminalAutomation';
import { useTerminalFontSize } from './terminalFontSize';

const EMPTY_QUEUE: QueuedMessage[] = [];

/** A file/image attached to the draft. Travels to the agent as a PATH it Reads. */
interface Attachment {
  path: string;
  name: string;
}

// Prepended (only to the enqueued value, never the visible draft) when the

export interface MessageQueueComposerProps {
  agent: Agent;
  /** Rendered at the left of the field (the HQ desk puts Rudy's face here). */
  leading?: ReactNode;
  /** Two visible lines instead of five: the field sits under a terminal that
   *  wants the height more. It still grows as you type. */
  compact?: boolean;
  /** While the queue is empty, fold the whole composer to one quiet line —
   *  the terminal above is the conversation; this box is only the holding
   *  area. It reopens on click and whenever something is actually held. */
  collapsible?: boolean;
}

/**
 * Lets the user keep messaging an agent whose terminal is mid-run. Typed
 * messages park in a per-agent queue and are submitted to the agent's Claude
 * TUI one-by-one as soon as it goes idle (see useHive's flush loop).
 */
export function MessageQueueComposer({ agent, leading, compact = false, collapsible = false }: MessageQueueComposerProps) {
  const queue = useStore((s) => s.messageQueues[agent.id]) ?? EMPTY_QUEUE;
  const enqueueMessage = useStore((s) => s.enqueueMessage);
  const removeQueuedMessage = useStore((s) => s.removeQueuedMessage);
  // collapsible only: the user explicitly opened the empty composer.
  const [expandedEmpty, setExpandedEmpty] = useState(false);
  const releaseQueuedMessage = useStore((s) => s.releaseQueuedMessage);
  const clearQueue = useStore((s) => s.clearQueue);

  // Draft lives in the store, keyed by agent — switching agents remounts this
  // component, and component-local state would silently eat the typed text.
  const text = useStore((s) => s.drafts[agent.id] ?? '');
  const setDraft = useStore((s) => s.setDraft);
  const setText = (t: string) => setDraft(agent.id, t);

  // The draft box is the terminal's twin — it should read at the same size the
  // agent's output does, at every zoom level.
  const composerFontSize = useTerminalFontSize();
  const composerLineHeight = Math.round(composerFontSize * 1.4);

  const idle = agent.status === 'idle';

  // Only the boss/Rudy agent gets the delegation toggle. Default OFF.

  // Files/images staged for the next message. Component-local: switching agents
  // remounts this component, so attachments are cleared on tab switch (drafts
  // persist in the store, attachments deliberately don't carry over).
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [dragOver, setDragOver] = useState(false);

  const addAttachments = (incoming: Attachment[]) =>
    setAttachments((prev) => {
      const seen = new Set(prev.map((a) => a.path));
      const fresh = incoming.filter((a) => a.path && !seen.has(a.path));
      return fresh.length ? [...prev, ...fresh] : prev;
    });

  const removeAttachment = (path: string) =>
    setAttachments((prev) => prev.filter((a) => a.path !== path));

  // '+' button → OS picker (images group + all files).
  const pickFiles = async () => {
    const res = await window.cth.attachFiles();
    if (res.ok) addAttachments(res.files);
  };

  // Drop files onto the composer → resolve each to its absolute path.
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = Array.from(e.dataTransfer?.files ?? []);
    if (!dropped.length) return;
    const atts = dropped
      .map((f) => ({ path: window.cth.pathForFile(f), name: f.name }))
      .filter((a) => a.path);
    if (atts.length) addAttachments(atts);
  };

  // Paste a screenshot (no path → persist the native clipboard image to a temp
  // file) or paste files copied from the OS file manager (carry a real path).
  const onPaste = async (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData?.items ?? []);
    const hasImage = items.some((it) => it.kind === 'file' && it.type.startsWith('image/'));
    if (hasImage) {
      e.preventDefault();
      const res = await window.cth.saveClipboardImage();
      if (res.ok) addAttachments([res.file]);
      return;
    }
    const files = Array.from(e.clipboardData?.files ?? []);
    if (files.length) {
      const atts = files
        .map((f) => ({ path: window.cth.pathForFile(f), name: f.name }))
        .filter((a) => a.path);
      if (atts.length) {
        e.preventDefault();
        addAttachments(atts);
      }
    }
  };

  const canSend = !!text.trim() || attachments.length > 0;

  const queueIt = () => {
    if (!canSend) return;
    // Prepend an "Attached files:" block using the same path-based convention as
    // the Slack inbound path (useHive.ts) so agents Read the files directly.
    const body = attachments.length
      ? (text.trim()
          ? `${text}\n\nAttached files:\n`
          : 'Attached files:\n') + attachments.map((a) => `- ${a.path} (${a.name})`).join('\n')
      : text;
    enqueueMessage(agent.id, body);
    setText('');
    setAttachments([]);
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      queueIt();
    }
  };

  // Delivery can be held back by the agent's own terminal (a half-typed draft or
  // an open slash-command picker owns the prompt). That used to be invisible —
  // the hint claimed it was sending while nothing moved — so poll it and say so.
  const block = useTerminalBlock(agent.ptyId, queue.length > 0 && idle);

  // Floor-wide auto-delivery pause (Command Center switch) also holds the queue.
  // Without saying so — and without the per-row "send now" override — messages
  // look permanently stuck with no explanation and no escape hatch.
  const deliveryPaused = useDeliveryPaused(agent.id, queue.length > 0);

  const statusHint = queue.length === 0
    ? null
    : !idle
    ? `${agent.name} is busy, ${queue.length} queued`
    : deliveryPaused && !queue[0]?.manual
    ? 'held, delivery paused floor-wide'
    : block === 'draft'
    ? `held, ${agent.name}'s terminal has unsent text on its prompt`
    : block === 'picker'
    ? `held, a slash-command picker is open in ${agent.name}'s terminal`
    : block === 'exited'
    ? `held, ${agent.name}'s terminal has exited`
    : `sending to ${agent.name} one-by-one…`;

  if (collapsible && queue.length === 0 && !text.trim() && !expandedEmpty) {
    return (
      <button
        className="mqc mqc-collapsed"
        onClick={() => setExpandedEmpty(true)}
        title={`Anything you queue here, lines or dropped files, lands in ${agent.name}'s prompt the moment the terminal is free.`}
      >
        <span className="mqc-c-k">QUEUE · EMPTY</span>
        <span className="mqc-c-t">talk to {agent.name} in the terminal · click to queue a line or drop files, they land in the prompt</span>
      </button>
    );
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); if (!dragOver) setDragOver(true); }}
      onDragLeave={(e) => {
        // Only clear when the cursor actually leaves the composer, not on child enter.
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setDragOver(false);
      }}
      onDrop={onDrop}
      className="mqc"
      style={{
        flexShrink: 0,
        borderTop: '1px solid var(--cth-ink-700)',
        background: 'var(--cth-cream-100)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: 8,
        boxShadow: dragOver ? 'inset 0 0 0 2px var(--cth-lilac)' : undefined
      }}>
      {dragOver && (
        <span style={{
          fontFamily: 'var(--cth-font-ui)', fontWeight: 700, fontSize: 10.5, lineHeight: '12px',
          color: 'var(--cth-ink-700)', textAlign: 'center'
        }}>DROP TO ATTACH</span>
      )}
      {/* Header: label, count, status, clear-all */}
      <div className="mqc-head" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          fontFamily: 'var(--cth-font-ui)', fontWeight: 700,
          fontSize: 10.5, lineHeight: '12px',
          color: 'var(--cth-ink-700)'
        }}>QUEUE</span>
        {queue.length > 0 && (
          <span style={{
            fontSize: 11, padding: '1px 6px 0',
            background: 'var(--cth-cream-200)',
            boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)',
            fontFamily: 'var(--cth-font-ui)', color: 'var(--cth-ink-900)'
          }}>{queue.length}</span>
        )}
        {statusHint && (
          <span
            title={deliveryPaused && !queue[0]?.manual
              ? 'Auto-delivery is paused for the whole floor. Resume it in the Command Center, or use "send now" on a message below.'
              : statusHint}
            style={{
              fontSize: 12,
              color: idle ? 'var(--cth-ink-700)' : 'var(--cth-ink-500)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
            }}
          >{statusHint}</span>
        )}
        {(block === 'draft' || block === 'picker') && agent.ptyId && (
          <button
            onClick={() => {
              // A picker and a draft are unblocked by different keys: Escape
              // closes the picker, Ctrl-U kills the input line. Sending Ctrl-U
              // at a picker leaves it open while telling automation the prompt
              // is free, which is how a queued message ends up typed into a
              // menu and marked delivered.
              if (block === 'picker') { dismissTerminalPicker(agent.ptyId!); return; }
              // Keep whatever was on the prompt — it lands in this composer so
              // the user can send it properly instead of losing it to Ctrl-U.
              const discarded = clearTerminalDraft(agent.ptyId!);
              if (discarded.trim()) setText(text ? `${text}\n${discarded}` : discarded);
            }}
            title={block === 'picker'
              ? "Close the picker this agent has open so queued messages can be delivered"
              : "Move the leftover text on this agent's prompt into this box so queued messages can be delivered"}
            style={{
              border: 'none', background: 'transparent', cursor: 'pointer', padding: 0,
              fontFamily: 'var(--cth-font-ui)', fontSize: 12,
              color: 'var(--cth-ink-900)', textDecoration: 'underline'
            }}
          >{block === 'picker' ? 'close picker' : 'recover prompt'}</button>
        )}
        {collapsible && queue.length === 0 && (
          <button className="mqc-hide" style={{ marginLeft: 'auto' }} onClick={() => setExpandedEmpty(false)}>
            hide
          </button>
        )}
        {queue.length > 1 && (
          <button
            onClick={() => clearQueue(agent.id)}
            title="Clear all queued messages"
            style={{
              marginLeft: 'auto', flexShrink: 0, whiteSpace: 'nowrap',
              border: 'none', background: 'transparent', cursor: 'pointer',
              fontFamily: 'var(--cth-font-ui)', fontSize: 12,
              color: 'var(--cth-ink-500)'
            }}
          >clear all</button>
        )}
      </div>

      {/* Pending list */}
      {queue.length > 0 && (
        <div style={{
          display: 'flex', flexDirection: 'column', gap: 4,
          maxHeight: 280, overflowY: 'auto'
        }}>
          {queue.map((m, i) => (
            <QueuedMessageRow
              key={m.id}
              index={i}
              message={m}
              paused={deliveryPaused}
              onSendNow={() => releaseQueuedMessage(agent.id, m.id)}
              onRemove={() => removeQueuedMessage(agent.id, m.id)}
            />
          ))}
        </div>
      )}

      {/* Attached files/images — chips with a remove 'x', above the textarea. */}
      {attachments.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {attachments.map((a) => (
            <span
              key={a.path}
              title={a.path}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                maxWidth: '100%',
                padding: '2px 4px 2px 6px',
                background: 'var(--cth-cream-200)',
                boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)',
                fontFamily: 'var(--cth-font-mono)', fontSize: 12, lineHeight: '16px',
                color: 'var(--cth-ink-900)'
              }}
            >
              <Icon name="folder" />
              <span style={{
                overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', maxWidth: 180
              }}>{a.name}</span>
              <button
                onClick={() => removeAttachment(a.path)}
                title="Remove attachment"
                style={{
                  flexShrink: 0, border: 'none', background: 'transparent', cursor: 'pointer',
                  color: 'var(--cth-ink-500)', padding: 0,
                  display: 'inline-flex', alignItems: 'center'
                }}
              >
                <Icon name="x" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Composer — full-width input above a single tidy control bar (cc-ui-polish),
          with file/image attachment chips + paste-to-attach (rich-composer). */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        {leading}
        <textarea
          className="cth-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          onPaste={onPaste}
          rows={compact ? 2 : 5}
          placeholder={idle ? `Message ${agent.name}` : `${agent.name} is busy, queue a message`}
          style={{
            flex: 1,
            width: '100%',
            minWidth: 0,
            resize: 'vertical',
            // Track the terminal's zoom (Cmd +/- or the terminal's own zoom
            // buttons) instead of a hardcoded 13px. On a large display the
            // terminal text scaled up while this box stayed tiny; box height is
            // derived from the same size so the visible line count is stable.
            minHeight: composerLineHeight * (compact ? 2 : 5) + 14,
            maxHeight: composerLineHeight * 18,
            padding: '6px 8px',
            background: 'var(--cth-paper-100)',
            border: 'none',
            // Border lives in .cth-input so :focus can change it — an inline
            // boxShadow here would outrank the stylesheet and the focus state
            // would silently never apply.
            fontFamily: 'var(--cth-font-mono)',
            fontSize: composerFontSize, lineHeight: `${composerLineHeight}px`,
            color: 'var(--cth-ink-900)',
            outline: 'none',
            boxSizing: 'border-box'
          }}
        />
        </div>
        {/* Control bar: Attach + Send aligned right. flexWrap so a
            narrow sidebar wraps the buttons onto a second row instead of
            pushing Send off-screen. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, rowGap: 6, flexWrap: 'wrap', minWidth: 0 }}>
          <span style={{ flex: 1 }} />
          <PixelButton variant="secondary" size="sm" onClick={pickFiles}>
            <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              <Icon name="plus" /> files
            </span>
          </PixelButton>
          <PixelButton variant="primary" size="sm" onClick={queueIt} disabled={!canSend}>
            <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              send <Icon name="arrow-right" />
            </span>
          </PixelButton>
        </div>
      </div>
    </div>
  );
}

/** Poll the pty's automation block while there is something waiting on it. The
 * flag lives in the terminal pool (a plain module map, not the store), so there
 * is nothing to subscribe to — a 1s tick while the queue is pending is enough. */
function useTerminalBlock(ptyId: string | undefined, active: boolean): TerminalAutomationBlock {
  const [block, setBlock] = useState<TerminalAutomationBlock>(null);
  useEffect(() => {
    if (!ptyId || !active) { setBlock(null); return; }
    const read = () => setBlock(terminalAutomationBlockFor(ptyId));
    read();
    const iv = setInterval(read, 1000);
    return () => clearInterval(iv);
  }, [ptyId, active]);
  // 'settling' is a sub-second gap between writes — not worth telling anyone.
  return block === 'settling' ? null : block;
}

/** Poll the floor-wide auto-delivery pause (main-process control state) while
 * this agent has messages waiting. 2s is plenty — the pause flips on human
 * timescales, and the drain re-reads the live snapshot before every send. */
function useDeliveryPaused(agentId: string, active: boolean): boolean {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (!active) { setPaused(false); return; }
    let alive = true;
    const read = () => {
      window.cth.controlSnapshot(agentId)
        .then((s) => { if (alive) setPaused(!!s?.autoDeliveryPaused); })
        .catch(() => { /* main not ready — assume not paused */ });
    };
    read();
    const iv = setInterval(read, 2000);
    return () => { alive = false; clearInterval(iv); };
  }, [agentId, active]);
  return paused;
}

/**
 * One pending queue row. Collapsed it clamps to 2 lines; "see more" expands it
 * in place so a long message can be read without hovering for the tooltip. The
 * toggle only renders when the text actually clips, so short messages stay tidy.
 */
function QueuedMessageRow(
  { index, message, paused, onSendNow, onRemove }: {
    index: number;
    message: QueuedMessage;
    /** Floor-wide auto-delivery is paused — offer the per-message override. */
    paused: boolean;
    onSendNow: () => void;
    onRemove: () => void;
  }
) {
  const [expanded, setExpanded] = useState(false);
  const [clipped, setClipped] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Measure against the CLAMPED box, so the toggle survives being expanded (the
  // expanded box never overflows and would otherwise report clipped = false).
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const measure = () => {
      if (expanded) return;
      setClipped(el.scrollHeight > el.clientHeight + 1);
    };
    measure();
    // The panel is resizable — re-measure on width changes, not just text ones.
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [message.text, expanded]);

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 6,
      padding: '4px 6px',
      background: 'var(--cth-paper-100)',
      boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)'
    }}>
      <span style={{
        fontFamily: 'var(--cth-font-mono)', fontSize: 12,
        color: 'var(--cth-ink-500)', lineHeight: '18px', flexShrink: 0
      }}>{`${index + 1}.`}</span>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div
          ref={bodyRef}
          title={expanded ? undefined : message.text}
          style={{
            fontSize: 12, lineHeight: '18px',
            color: 'var(--cth-ink-900)',
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            ...(expanded
              // Cap the expanded body so one long message can't push the rest of
              // the queue out of the list's own 280px scroll area.
              ? { maxHeight: 220, overflowY: 'auto' as const }
              : {
                  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                  overflow: 'hidden'
                })
          }}
        >{message.text}</div>
        {(clipped || expanded || paused) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {(clipped || expanded) && (
              <button
                onClick={() => setExpanded((e) => !e)}
                title={expanded ? 'Collapse this message' : 'Show the full message'}
                style={{
                  border: 'none', background: 'transparent', cursor: 'pointer', padding: 0,
                  fontFamily: 'var(--cth-font-ui)', fontSize: 12, lineHeight: '16px',
                  color: 'var(--cth-ink-500)', textDecoration: 'underline'
                }}
              >{expanded ? 'see less' : 'see more'}</button>
            )}
            {paused && !message.manual && (
              <button
                onClick={onSendNow}
                title="Deliver this message even though auto-delivery is paused. It moves to the front of the queue and types in as soon as the terminal is free."
                style={{
                  border: 'none', background: 'transparent', cursor: 'pointer', padding: 0,
                  fontFamily: 'var(--cth-font-ui)', fontSize: 12, lineHeight: '16px',
                  color: 'var(--cth-ink-900)', textDecoration: 'underline'
                }}
              >send now</button>
            )}
            {paused && message.manual && (
              <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--cth-ink-500)' }}>
                sending when free…
              </span>
            )}
          </div>
        )}
      </div>
      <button
        onClick={onRemove}
        title="Remove from queue"
        style={{
          flexShrink: 0, border: 'none', background: 'transparent',
          cursor: 'pointer',
          color: 'var(--cth-ink-500)', padding: 0,
          display: 'inline-flex', alignItems: 'center'
        }}
      >
        <Icon name="x" />
      </button>
    </div>
  );
}
