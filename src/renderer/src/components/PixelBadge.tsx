import { CSSProperties } from 'react';

export type StatusKind =
  | 'idle' | 'thinking' | 'working' | 'waiting' | 'blocked' | 'success' | 'ghost'
  // #5C — richer states driven by real events: PreCompact/PostCompact hooks and
  // the Lane A circuit breaker (#6) respectively.
  | 'compacting' | 'looping'
  // Not an agent state at all — the USER has unsubmitted text on that agent's
  // prompt, which holds its queue. Never stored on the agent (the pty parser
  // would overwrite it); derived at render, see `hasTerminalDraft`. Without it
  // a held queue looked identical to an idle agent doing nothing.
  | 'typing';

export interface PixelBadgeProps {
  status: StatusKind;
  label?: string;
  style?: CSSProperties;
}

const colorByStatus: Record<StatusKind, string> = {
  idle:     'var(--cth-status-idle)',
  thinking: 'var(--cth-status-thinking)',
  working:  'var(--cth-status-working)',
  waiting:  'var(--cth-status-waiting)',
  blocked:  'var(--cth-status-blocked)',
  success:  'var(--cth-status-success)',
  ghost:    'var(--cth-status-ghost)',
  compacting: 'var(--cth-status-compacting)',
  looping:    'var(--cth-status-looping)',
  typing:     'var(--cth-status-typing)'
};

// Human-readable labels. "blocked" is reserved for the boss agent waiting on YOU,
// so it reads as "needs you"; sub-agents waiting on boss/another agent are
// "waiting", which is honest about who they're actually stalled on.
const labelByStatus: Record<StatusKind, string> = {
  idle:     'idle',
  thinking: 'working',
  working:  'working',
  waiting:  'waiting',
  blocked:  'needs you',
  success:  'done',
  ghost:    'gone',
  compacting: 'compacting',
  looping:    'looping',
  // Reads as "you are typing", not "the agent is typing" — it is your text
  // sitting on the prompt, and it is why nothing is being delivered.
  typing:     'your draft'
};

export function PixelBadge({ status, label, style }: PixelBadgeProps) {
  const text = label ?? labelByStatus[status] ?? status;
  // "Needs you" is the one state that must shout; everything else is ambient.
  const loud = status === 'blocked';
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        // Same reason as PixelButton: a status chip that shrinks spills its text
        // under the controls beside it instead of holding its own width.
        flexShrink: 0,
        gap: 5,
        fontFamily: 'var(--cth-font-ui)',
        fontSize: 'var(--cth-text-body-sm)',
        fontWeight: loud ? 700 : 400,
        lineHeight: '18px',
        color: loud ? colorByStatus[status] : 'var(--cth-ink-500)',
        userSelect: 'none',
        ...style
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          flexShrink: 0,
          background: colorByStatus[status]
        }}
      />
      {text}
    </span>
  );
}
