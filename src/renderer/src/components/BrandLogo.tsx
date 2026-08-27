/**
 * BrandLogo — the "RUDY OS" lockup, drawn as pixels.
 *
 * v0.5.0, the chosen mark (round-2 pick "E · OS plate"): the chunky 13-row
 * letterforms from the brand ideation sheet with the corner notches filled
 * (the solid cut), RUDY in ink, and OS reversed out of a solid red plate in
 * the brand cream. The plate is the one loud element; everything else is
 * quiet, which is exactly the app's voice.
 *
 * Everything is axis-aligned rectangles on a pixel grid: no <text>, no font to
 * load, so the lockup is identical everywhere and stays crisp at any size.
 *
 * Colours follow the app theme:
 *   RUDY   --cth-brand-ink   (ink on light, white on dark bands)
 *   plate  --cth-brand-plate (#7A1820 on light, #B3121B on dark grounds)
 *   OS     brand cream, fixed: it sits on the plate in both themes
 * `tone="onDark"` pins the dark-ground treatment for the onboarding rail
 * whatever the app theme is.
 */

/** 13-row pixel letters, variable width, solid cut. '1' is a filled cell. */
const GLYPHS: Record<string, string[]> = {
  R: [
    '1111111100',
    '1111111110',
    '1111111111',
    '1110001111',
    '1110001111',
    '1111111110',
    '1111111110',
    '1111111110',
    '1110111000',
    '1110111100',
    '1110011100',
    '1110011110',
    '1110001111',
  ],
  U: [
    '111000111',
    '111000111',
    '111000111',
    '111000111',
    '111000111',
    '111000111',
    '111000111',
    '111000111',
    '111000111',
    '111000111',
    '111111111',
    '011111110',
    '001111100',
  ],
  D: [
    '111111100',
    '111111110',
    '111111111',
    '111001111',
    '111001111',
    '111001110',
    '111001110',
    '111001110',
    '111001110',
    '111001110',
    '111111110',
    '111111100',
    '111111000',
  ],
  Y: [
    '111000111',
    '111000111',
    '111100111',
    '011101111',
    '011111110',
    '001111110',
    '001111100',
    '000111000',
    '000111000',
    '000111000',
    '000111000',
    '000111000',
    '000111000',
  ],
  O: [
    '011111110',
    '111111111',
    '111111111',
    '111000111',
    '111000111',
    '111000111',
    '111000111',
    '111000111',
    '111000111',
    '111000111',
    '111111111',
    '111111111',
    '011111110',
  ],
  S: [
    '011111110',
    '111111111',
    '111111111',
    '111000000',
    '111000000',
    '111111110',
    '111111111',
    '011111111',
    '000000111',
    '000000111',
    '111111111',
    '111111111',
    '011111110',
  ],
};
const GH = 13;

const CELL = 8;                                   // one letter pixel
const GAP = CELL * 2;                             // tracking between letters
const PLATE_PAD = CELL * 1.5;                     // red plate bleed around OS
const CREAM = '#F2ECE4';                          // OS on the plate, both themes
const glyphW = (ch: string) => (GLYPHS[ch]?.[0]?.length ?? 0) * CELL;
const wordWidth = (t: string) =>
  t.split('').reduce((w, c) => w + glyphW(c) + GAP, 0) - GAP;

function letterRects(text: string, x: number, y: number, fill: string, keyPrefix: string) {
  const out: JSX.Element[] = [];
  let cx = x;
  text.split('').forEach((ch, li) => {
    const rows = GLYPHS[ch];
    if (!rows) { cx += GAP; return; }
    const gw = rows[0].length;
    rows.forEach((row, ry) => {
      let run = 0;
      for (let rx = 0; rx <= gw; rx++) {
        const on = rx < gw && row[rx] === '1';
        if (on) { run++; continue; }
        if (run) {
          out.push(
            <rect
              key={`${keyPrefix}-${li}-${ry}-${rx}`}
              x={cx + (rx - run) * CELL} y={y + ry * CELL}
              width={run * CELL} height={CELL} fill={fill}
            />
          );
          run = 0;
        }
      }
    });
    cx += gw * CELL + GAP;
  });
  return out;
}

export function BrandLogo({ height = 20, title = 'Rudy OS', tone = 'theme' }: {
  height?: number;
  title?: string;
  /** `theme` follows the app tokens; `onDark` pins the dark-ground lockup. */
  tone?: 'theme' | 'onDark';
}) {
  const onDark = tone === 'onDark';
  const ink = onDark ? '#FFFFFF' : 'var(--cth-brand-ink)';
  const plate = onDark ? '#B3121B' : 'var(--cth-brand-plate, #7A1820)';

  const lettersH = GH * CELL;
  const wRudy = wordWidth('RUDY');
  const wOs = wordWidth('OS');
  const space = CELL * 5;
  const osX = wRudy + space;
  // The plate bleeds past the letters on every side, so the viewBox grows by
  // the pad and the whole lockup is scaled to the requested height.
  const vbW = osX + wOs + PLATE_PAD;
  const vbY = -PLATE_PAD;
  const vbH = lettersH + PLATE_PAD * 2;

  return (
    <svg
      viewBox={`0 ${vbY} ${vbW} ${vbH}`}
      height={height}
      width={(height * vbW) / vbH}
      role="img"
      aria-label={title}
      shapeRendering="crispEdges"
      style={{ display: 'block' }}
    >
      <title>{title}</title>
      {letterRects('RUDY', 0, 0, ink, 'r')}
      <rect x={osX - PLATE_PAD} y={-PLATE_PAD} width={wOs + PLATE_PAD * 2} height={lettersH + PLATE_PAD * 2} fill={plate} />
      {letterRects('OS', osX, 0, CREAM, 'o')}
    </svg>
  );
}
