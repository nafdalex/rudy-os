import type { ReactNode } from 'react';

/**
 * A sheet: the one way a module or a worker console appears. It slides over
 * the desk and closes on outside click, Esc, its own button, or a retap of
 * the bar button that opened it. No view you can get stuck in.
 */
export function HqSheet({ title, onClose, children }: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <>
      <div className="hq-scrim" onClick={onClose} aria-hidden="true" />
      <div className="aur-glass hq-sheet" role="dialog" aria-label={title}>
        <div className="hq-sheet-head">
          <h3>{title}</h3>
          <span className="esc">click outside or press ESC to close</span>
          <button className="x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="hq-sheet-body">{children}</div>
      </div>
    </>
  );
}
