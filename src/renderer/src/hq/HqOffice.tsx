import { OfficeFloor } from '@/scene/office/OfficeFloor';
import { RudyBooting } from '@/components/RudyBooting';

/**
 * The office as a window. Always visible, never dominant: the live pixel
 * floor at postcard size in the top right. One click grows the same card
 * into a sheet; the same close rules put it back. A single floor instance
 * is kept alive throughout, it only changes size, so nothing reloads.
 */
export function HqOffice({ grown, onGrow, onShrink, booting }: {
  grown: boolean;
  onGrow: () => void;
  onShrink: () => void;
  booting: boolean;
}) {
  return (
    <>
      {grown && <div className="hq-office-ghost" aria-hidden="true" />}
      <div
        className={`aur-glass hq-office${grown ? ' grown' : ''}`}
        onClick={grown ? undefined : onGrow}
        role={grown ? 'dialog' : 'button'}
        aria-label={grown ? 'The office' : 'Grow the office'}
      >
        <div className="hq-office-head">
          <h5>THE OFFICE</h5>
          {!grown && <span className="grow" aria-hidden="true">⤢</span>}
          <span className="live">LIVE</span>
          {grown && (
            <button className="x" onClick={onShrink} aria-label="Put the office back">✕</button>
          )}
        </div>
        <div className="hq-office-body">
          <OfficeFloor />
          {/* v0.5.0: the grown sheet hugs the map ("I see only the office"),
              so the memory panel no longer squeezes in here — it lives in
              Command Center → Memory. */}
          {booting && <RudyBooting />}
          {/* At postcard size the sprites are too small to be click targets,
              so the whole card is one: grow it, then click around. */}
          {!grown && <div className="hq-office-cover" />}
        </div>
      </div>
    </>
  );
}
