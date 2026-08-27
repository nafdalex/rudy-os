import { useState } from 'react';
import { PixelPanel } from './PixelPanel';
import { PixelButton } from './PixelButton';
import { Icon } from './Icon';

/** Renderer-side closing-time view state. Mirrors the main process's
 *  ClosingTimeEvent phases, plus a local 'error' for a failed start. */
export interface ClosingTimeState {
  phase: 'started' | 'progress' | 'complete' | 'timeout' | 'error';
  acked: number;
  total: number;
  error?: string;
}

export interface QuitWarningModalProps {
  ptyCount: number;
  /** Non-null while the closing-time protocol runs — switches the dialog into
   *  the "wrapping up the floor" progress view. */
  closing?: ClosingTimeState | null;
  onCancel: () => void;
  onConfirm: () => void;
  /** Start the graceful shutdown (the third button). */
  onClosingTime?: () => void;
}

export function QuitWarningModal({ ptyCount, closing, onCancel, onConfirm, onClosingTime }: QuitWarningModalProps) {
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setBusy(true);
    await onConfirm();
    // No need to clear busy — the app is quitting.
  };

  const inClosingTime = !!closing && closing.phase !== 'error';

  return (
    <div
      onClick={inClosingTime ? undefined : onCancel}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(26, 19, 32, 0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        // Above EVERY modal, not just most of them. Modals in this app sit at
        // 500 (add agent, edit agent, the release drop) and overlays below that.
        // At 300 this dialog opened BEHIND the release drop, so clicking quit
        // with a drop on screen looked like quit did nothing — while a hidden
        // dialog held the app open. This is the last thing the user is asked
        // before the process dies; it outranks whatever it interrupts.
        zIndex: 1000
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: 480, maxWidth: '92vw' }}
      >
        <PixelPanel variant="dialog" title={inClosingTime ? 'SAVING THE FLOOR' : 'QUIT RUDY OS?'} noPadding>
          <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {inClosingTime ? (
              <>
                {/* ── Graceful shutdown in progress ──────────────────────── */}
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <div style={{
                    width: 32, height: 32,
                    background: closing!.phase === 'complete' ? 'var(--cth-mint-light, #cdeccd)' : 'var(--cth-lemon-light, #f6ecc4)',
                    boxShadow: 'inset 0 0 0 1.5px var(--cth-ink-500)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0
                  }}>
                    <Icon name="bell" />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{
                      fontFamily: 'var(--cth-font-display)',
                      fontSize: 12, lineHeight: '20px',
                      color: 'var(--cth-ink-900)',
                      marginBottom: 4
                    }}>
                      {closing!.phase === 'complete'
                        ? 'ALL SAVED · SEE YOU SOON'
                        : closing!.phase === 'timeout'
                          ? 'STILL SAVING…'
                          : 'EVERYONE IS SAVING THEIR WORK'}
                    </div>
                    <div style={{ fontSize: 12.5, lineHeight: '19px', color: 'var(--cth-ink-700)' }}>
                      {closing!.phase === 'complete' ? (
                        <>Everything is committed and every memory is saved. The app
                        closes itself in a moment.</>
                      ) : (
                        <>Rudy told everyone to wrap up. Each agent commits its work,
                        saves its memory and reports back. The app closes once
                        everyone has confirmed, so nothing is lost.</>
                      )}
                    </div>
                  </div>
                </div>

                {/* ACK progress */}
                <div style={{
                  padding: 8,
                  background: 'var(--cth-cream-200)',
                  boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)',
                  fontSize: 12, lineHeight: '18px',
                  color: 'var(--cth-ink-700)',
                  fontFamily: 'var(--cth-font-display)'
                }}>
                  {closing!.total > 0
                    ? `${closing!.acked} / ${closing!.total} AGENTS CONFIRMED${closing!.acked >= closing!.total ? ' · RUDY IS FINISHING UP' : ''}`
                    : 'ONLY RUDY IS ON THE FLOOR · HE IS SAVING AND CONFIRMING'}
                  {closing!.phase === 'timeout' && (
                    <div style={{ marginTop: 6, fontFamily: 'var(--cth-font-body, inherit)' }}>
                      Taking longer than usual (an agent may be deep in a tool call).
                      Keep waiting, or quit now and accept losing whatever is unsaved.
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  {closing!.phase !== 'complete' && (
                    <>
                      <PixelButton variant="secondary" size="md" onClick={onCancel} disabled={busy}>
                        back to work
                      </PixelButton>
                      <PixelButton variant="destructive" size="md" onClick={confirm} disabled={busy}>
                        {busy ? 'quitting...' : 'quit now anyway'}
                      </PixelButton>
                    </>
                  )}
                </div>
              </>
            ) : (
              <>
                {/* ── The classic quit warning ────────────────────────────── */}
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <div style={{
                    width: 32, height: 32,
                    background: 'var(--cth-coral-light)',
                    boxShadow: 'inset 0 0 0 1.5px var(--cth-ink-500)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0
                  }}>
                    <Icon name="bell" />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{
                      fontFamily: 'var(--cth-font-display)',
                      fontSize: 12, lineHeight: '20px',
                      color: 'var(--cth-ink-900)',
                      marginBottom: 4
                    }}>
                      {ptyCount <= 1 ? 'RUDY IS STILL AT THE DESK' : `${ptyCount} AGENTS STILL RUNNING`}
                    </div>
                    <div style={{ fontSize: 12.5, lineHeight: '19px', color: 'var(--cth-ink-700)' }}>
                      Quitting right now ends{' '}
                      {ptyCount <= 1 ? "Rudy's session" : `all ${ptyCount} running sessions`}{' '}
                      immediately. Whatever {ptyCount <= 1 ? 'he was' : 'they were'} in the middle
                      of is lost.
                    </div>
                  </div>
                </div>

                <div style={{
                  padding: 8,
                  background: 'var(--cth-cream-200)',
                  boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)',
                  fontSize: 12, lineHeight: '18px',
                  color: 'var(--cth-ink-700)'
                }}>
                  <strong>Save and quit</strong> is the safe way out: everyone commits
                  their work and saves their memory first, then the app closes itself.
                  Nothing is lost.
                </div>

                {closing?.phase === 'error' && (
                  <div style={{
                    padding: 8,
                    background: 'var(--cth-coral-light)',
                    boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)',
                    fontSize: 12, lineHeight: '18px',
                    color: 'var(--cth-ink-900)'
                  }}>
                    {closing.error ?? 'Save and quit could not start.'}
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
                  <PixelButton variant="secondary" size="md" onClick={onCancel} disabled={busy}>
                    stay
                  </PixelButton>
                  {onClosingTime && (
                    <PixelButton variant="primary" size="md" onClick={onClosingTime} disabled={busy}>
                      <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                        <Icon name="check" /> save and quit
                      </span>
                    </PixelButton>
                  )}
                  <PixelButton variant="destructive" size="md" onClick={confirm} disabled={busy}>
                    {busy ? 'quitting...' : 'quit now'}
                  </PixelButton>
                </div>
              </>
            )}
          </div>
        </PixelPanel>
      </div>
    </div>
  );
}
