import { BrandLogo } from '@/components/BrandLogo';
import { UpdateBadge } from '@/components/UpdateBadge';
import { Icon } from '@/components/Icon';

/**
 * ONE slim bar: brand, the floor pulse, IDE, theme, settings, focus. The
 * modules live as squares on the desk, right above the terminal, where
 * the work is.
 */
export function HqBar({
  working, needs, autoMode,
  theme, onTheme, onSettings, onIde, onFocus, focusOn
}: {
  working: number;
  needs: number;
  autoMode: boolean;
  theme: 'light' | 'dark';
  onTheme: () => void;
  onSettings: () => void;
  onIde: () => void;
  onFocus: () => void;
  focusOn: boolean;
}) {
  return (
    <div className="cth-titlebar-drag hq-bar">
      {/* A quiet pad under the macOS traffic lights: on the light greige bar
          they had no ground and faded away; on dark the pad goes transparent. */}
      <span className="hq-lights-pad" aria-hidden="true" />

      {/* The controls live LEFT, right beside the traffic lights — window
          buttons with window buttons. */}
      <div className="hq-right cth-titlebar-nodrag">
        <button className="hq-iconbtn cth-tip" onClick={onIde} data-tip="IDE" aria-label="Open the IDE">
          <Icon name="code" />
        </button>
        <button
          className="hq-iconbtn cth-tip"
          onClick={onTheme}
          data-tip={theme === 'dark' ? 'Light theme' : 'Dark theme'}
          aria-label="Toggle dark mode"
        >
          {theme === 'dark' ? '☀' : '☾'}
        </button>
        <button className="hq-iconbtn cth-tip" onClick={onSettings} data-tip="Settings" aria-label="Settings">
          <GearGlyph />
        </button>
        <button
          className={`hq-iconbtn cth-tip${focusOn ? ' on' : ''}`}
          onClick={onFocus}
          data-tip={focusOn ? 'Exit focus mode (Esc)' : 'Focus mode'}
          aria-label="Toggle focus mode"
        >
          {focusOn ? <CollapseGlyph /> : <ExpandGlyph />}
        </button>
      </div>

      <span style={{ flex: 1 }} />

      {/* The right edge stays information: the floor pulse, then the brand. */}
      <span className="hq-pulse cth-titlebar-nodrag" aria-live="polite">
        {needs > 0 && <><b className="warn">{needs} need{needs === 1 ? 's' : ''} you</b><span className="sep">·</span></>}
        <b>{working} working</b>
        <span className="sep">·</span>
        {autoMode ? 'auto on' : 'auto off'}
      </span>

      <div className="hq-brand">
        {/* Inline SVG so the wordmark follows the theme: RUDY white on dark,
            OS red in both. */}
        <BrandLogo height={16} />
        <span className="cth-titlebar-nodrag"><UpdateBadge /></span>
      </div>
    </div>
  );
}

/* ── bar glyphs ──────────────────────────────────────────────────────────
   Stroke icons on a 16 unit box, inheriting `currentColor`. Deliberately NOT
   in components/Icon.tsx: that library is the pixel identity and is used at
   tab and card scale. These sit beside the OS traffic lights, the one place
   a pixel grid reads as a rendering artifact rather than a decision. */
function Glyph({ children }: { children: React.ReactNode }) {
  return (
    <svg
      width="15" height="15" viewBox="0 0 16 16" fill="none"
      stroke="currentColor" strokeWidth={1.4}
      strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false"
    >{children}</svg>
  );
}

/** Four outward corner brackets: enter focus mode. */
export function ExpandGlyph() {
  return <Glyph><path d="M6.2 3H3v3.2M9.8 3H13v3.2M6.2 13H3V9.8M9.8 13H13V9.8" /></Glyph>;
}

/** The same brackets turned inward: leave focus mode. */
export function CollapseGlyph() {
  return <Glyph><path d="M3 6.2h3.2V3M13 6.2H9.8V3M3 9.8h3.2V13M13 9.8H9.8V13" /></Glyph>;
}

/** A wrench. A spoked gear at this size is a sun, and it sits beside a theme
 *  toggle whose light icon IS a sun. */
export function GearGlyph() {
  return (
    <svg
      width="15" height="15" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false"
    >
      <path d="M15.5 3.5a5 5 0 0 0-6.1 6.1l-5.6 5.6a2.3 2.3 0 1 0 3.2 3.2l5.6-5.6a5 5 0 0 0 6.1-6.1l-3 3-2.2-.6-.6-2.2z" />
    </svg>
  );
}
