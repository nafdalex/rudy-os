/**
 * PixelToggle — the ONE on/off control. A real switch: green track when on,
 * gray when off, square knob that slides. Replaces the old `on`/`off` text
 * buttons, which gave no glanceable state ("is 'on' the state or the action?").
 */
export function PixelToggle({ on, onClick, disabled = false, title }: {
  on: boolean;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={on}
      title={title ?? (on ? 'On. Click to switch off.' : 'Off. Click to switch on.')}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={{
        width: 40,
        height: 20,
        padding: 2,
        flexShrink: 0,
        border: 'none',
        borderRadius: 2,
        cursor: disabled ? 'not-allowed' : 'pointer',
        background: on ? 'var(--cth-mint)' : 'var(--cth-cream-300)',
        boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: on ? 'flex-end' : 'flex-start',
        transition: 'background 0.15s',
        opacity: disabled ? 0.5 : 1
      }}
    >
      <span style={{
        width: 14,
        height: 14,
        borderRadius: 1,
        // ink-900 flips with the theme, so the knob is dark-on-green in light
        // mode and off-white in dark mode — visible on both track colors.
        background: 'var(--cth-ink-900)',
        boxShadow: '0 1px 0 rgba(0,0,0,0.25)'
      }} />
    </button>
  );
}
