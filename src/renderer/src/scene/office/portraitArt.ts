// Procedural portraits for the Rudy OS cast.
//
// Every agent is a clone of Rudy — the brand's line-art head (big ink swoop of
// hair, dot eyes, round ears) — told apart by the kit each role wears: outfit,
// glasses, headwear, a prop. The busts are fully custom-drawn recipes layering
// skin → clothing → face → hair → glasses → headwear on an 18×28 canvas; the
// in-scene walking sprite (cast.ts) reuses the exact same head/face/clothing
// and adds legs, so an agent on the floor looks identical to its card.

import type { OfficeCharacterName } from './cast';

export const PORTRAIT_W = 18;
export const PORTRAIT_H = 28;
// In-scene walking sprite: same width + upper body as the portrait, taller to add legs.
export const SCENE_W = 18;
export const SCENE_H = 32;
const OUTLINE: RGB = [38, 34, 46];
const HX0 = 4, HX1 = 13; // head skin columns

type RGB = [number, number, number];
type Buf = Uint8ClampedArray;

// Current canvas dims — set per compose() so the same drawing primitives serve
// both the 18×28 portrait and the 18×32 scene sprite. (Rendering is synchronous.)
let CUR_W = PORTRAIT_W, CUR_H = PORTRAIT_H;

const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
function shades(rgb: RGB, dl = 1.22, dd = 0.68): [RGB, RGB, RGB] {
  return [
    [clamp(rgb[0] * dl), clamp(rgb[1] * dl), clamp(rgb[2] * dl)],
    [rgb[0], rgb[1], rgb[2]],
    [clamp(rgb[0] * dd), clamp(rgb[1] * dd), clamp(rgb[2] * dd)],
  ];
}
function mix(a: RGB, b: RGB, t: number): RGB {
  return [clamp(a[0] + (b[0] - a[0]) * t), clamp(a[1] + (b[1] - a[1]) * t), clamp(a[2] + (b[2] - a[2]) * t)];
}

function set(buf: Buf, x: number, y: number, c: RGB, a = 255): void {
  if (x < 0 || x >= CUR_W || y < 0 || y >= CUR_H) return;
  const i = (y * CUR_W + x) * 4;
  buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; buf[i + 3] = a;
}
function alphaAt(buf: Buf, x: number, y: number): number {
  if (x < 0 || x >= CUR_W || y < 0 || y >= CUR_H) return 0;
  return buf[(y * CUR_W + x) * 4 + 3];
}
function rgbAt(buf: Buf, x: number, y: number): RGB {
  const i = (y * CUR_W + x) * 4;
  return [buf[i], buf[i + 1], buf[i + 2]];
}
function eq(a: RGB, b: RGB): boolean { return a[0] === b[0] && a[1] === b[1] && a[2] === b[2]; }
function rect(buf: Buf, x0: number, y0: number, x1: number, y1: number, c: RGB): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(buf, x, y, c);
}

// ─── palettes ────────────────────────────────────────────────────────────────
interface SkinPal { hi: RGB; base: RGB; sh: RGB; line: RGB; }
const SKIN: Record<string, SkinPal> = {
  light: { hi: [255, 221, 189], base: [247, 201, 170], sh: [212, 158, 126], line: [168, 112, 82] },
  tan:   { hi: [232, 182, 136], base: [214, 162, 116], sh: [176, 126, 86],  line: [138, 92, 60] },
  brown: { hi: [180, 130, 94],  base: [158, 112, 78],  sh: [124, 86, 58],   line: [90, 60, 40] },
  dark:  { hi: [142, 98, 70],   base: [120, 80, 56],   sh: [94, 62, 42],    line: [64, 42, 28] },
};
const WHITE: RGB = [238, 238, 236];
const INK: RGB = [40, 40, 48];

// ─── head + face ─────────────────────────────────────────────────────────────
function drawHead(buf: Buf, skin: string): void {
  const s = SKIN[skin];
  for (let y = 4; y <= 16; y++) {
    for (let x = HX0; x <= HX1; x++) {
      if (((x === HX0 || x === HX1) && (y === 4 || y === 5 || y === 16)) || ((x === 5 || x === 12) && y === 4)) continue;
      set(buf, x, y, s.base);
    }
  }
  for (let y = 6; y < 12; y++) set(buf, 5, y, s.hi);
  set(buf, 6, 5, s.hi); set(buf, 7, 5, s.hi);
  for (let y = 6; y < 15; y++) set(buf, 12, y, s.sh);
  for (const x of [7, 8, 9, 10, 11]) set(buf, x, 16, s.sh);
  for (const ex of [HX0 - 1, HX1 + 1]) { set(buf, ex, 9, s.base); set(buf, ex, 10, s.base); set(buf, ex, 11, s.sh); }
  rect(buf, 7, 17, 10, 18, s.sh); rect(buf, 7, 17, 9, 17, s.base);
}

type Brow = 'flat' | 'angry' | 'raised' | 'soft' | 'none';
type Mouth = 'neutral' | 'smile' | 'frown' | 'grin' | 'small' | 'smirk';
type Eyes = 'normal' | 'dot';
function drawFace(buf: Buf, skin: string, brow: Brow, mouth: Mouth, blush: boolean, lashes = false, eyes: Eyes = 'normal'): void {
  const s = SKIN[skin];
  const white: RGB = [250, 248, 244], pup: RGB = [46, 38, 42];
  if (eyes === 'dot') {
    // Rudy-logo eyes: two ink dots, no whites.
    set(buf, 6, 9, pup); set(buf, 10, 9, pup);
    set(buf, 6, 10, pup); set(buf, 10, 10, pup);
  } else {
    for (const [a, b, p] of [[5, 6, 6], [10, 11, 10]] as const) {
      set(buf, a, 9, white); set(buf, b, 9, white); set(buf, p, 9, pup);
    }
  }
  // Feminine eyes: a dark upper lash line + an outer flick, and a bright glint
  // in each pupil so they read as bigger, rounder, more expressive.
  if (lashes) {
    const lash: RGB = [54, 40, 48], glint: RGB = [252, 250, 248];
    for (const x of [5, 6, 10, 11]) set(buf, x, 8, lash);
    set(buf, 4, 8, lash); set(buf, 12, 8, lash);
    if (eyes === 'normal') { set(buf, 5, 9, glint); set(buf, 10, 9, glint); }
  }
  if (brow === 'flat') for (const x of [5, 6, 10, 11]) set(buf, x, 7, s.line);
  else if (brow === 'angry') { set(buf, 5, 8, s.line); set(buf, 6, 7, s.line); set(buf, 10, 7, s.line); set(buf, 11, 8, s.line); }
  else if (brow === 'raised') for (const x of [5, 6, 10, 11]) set(buf, x, 6, s.line);
  else if (brow === 'soft') { for (const x of [5, 11]) set(buf, x, 7, s.line); for (const x of [6, 10]) set(buf, x, 7, s.sh); }
  // nose — a single hint under dot eyes (the logo has none), fuller otherwise
  if (eyes === 'dot') set(buf, 8, 12, s.sh);
  else { set(buf, 8, 11, s.sh); set(buf, 8, 12, s.sh); set(buf, 7, 12, s.sh); }
  const mc: RGB = [158, 86, 80];
  const mouths: Record<Mouth, [number, number][]> = {
    neutral: [[7, 14], [8, 14], [9, 14], [10, 14]],
    smile: [[7, 14], [8, 14], [9, 14], [10, 14], [6, 13], [11, 13]],
    frown: [[7, 15], [8, 15], [9, 15], [10, 15], [6, 14], [11, 14]],
    grin: [[7, 14], [8, 14], [9, 14], [10, 14], [7, 13], [8, 13], [9, 13], [10, 13], [6, 13], [11, 13]],
    small: [[8, 14], [9, 14]],
    smirk: [[8, 14], [9, 14], [10, 14], [11, 13]],
  };
  for (const [x, y] of mouths[mouth]) set(buf, x, y, mc);
  if (mouth === 'grin') { set(buf, 8, 13, white); set(buf, 9, 13, white); }
  if (blush) for (const x of [5, 12]) set(buf, x, 12, [235, 150, 140], 140);
}

// ─── hairstyles ──────────────────────────────────────────────────────────────
interface HairArgs { part?: 'L' | 'R'; recede?: number; length?: number; vol?: number; }
type HairFn = (buf: Buf, color: RGB, skinBase: RGB, a: HairArgs) => void;

/** The Rudy-logo swoop: a big ink mass that sweeps from the left over the right
 *  brow, with a curl over the left ear and a wavy fringe line. */
const styleRudy: HairFn = (buf, color) => {
  const [hi, base, sh] = shades(color, 1.35, 0.7);
  // fringe bottom row per column (hair covers rows <= f[x])
  const f: Record<number, number> = { 2: 8, 3: 10, 4: 8, 5: 6, 6: 5, 7: 5, 8: 6, 9: 7, 10: 8, 11: 8, 12: 7, 13: 8, 14: 9, 15: 7 };
  for (let x = 6; x <= 11; x++) set(buf, x, 1, base);
  for (let x = 4; x <= 13; x++) set(buf, x, 2, base);
  for (let x = 3; x <= 14; x++) set(buf, x, 3, base);
  for (const xs in f) { const x = +xs; const top = x === 2 || x === 15 ? 5 : 3; for (let y = top; y <= f[x]; y++) set(buf, x, y, base); }
  // the curl over the left ear (logo's signature)
  set(buf, 2, 9, base); set(buf, 3, 11, base);
  // sheen + swoop shadow
  for (const [x, y] of [[6, 1], [7, 1], [8, 1], [5, 2], [6, 2], [4, 3], [5, 3], [3, 4]] as const) set(buf, x, y, hi);
  for (const [x, y] of [[12, 3], [13, 3], [13, 4], [14, 5], [14, 6], [11, 7], [12, 6], [13, 7]] as const) set(buf, x, y, sh);
  for (const [x, y] of [[3, 9], [3, 10], [2, 8]] as const) set(buf, x, y, sh);
};

const styleShort: HairFn = (buf, color, skinBase, a) => {
  const [hi, base, sh] = shades(color);
  const part = a.part ?? 'L', recede = a.recede ?? 0;
  rect(buf, HX0, 2, HX1, 4, base);
  for (let x = HX0 - 1; x <= HX1 + 1; x++) set(buf, x, 3, base);
  rect(buf, HX0 - 1, 4, HX1 + 1, 5, base);
  for (let y = 6; y < 9; y++) { set(buf, HX0 - 1, y, base); set(buf, HX0, y, base); set(buf, HX1, y, base); set(buf, HX1 + 1, y, base); }
  for (let x = HX0; x <= HX1; x++) set(buf, x, 5, base);
  if (recede) {
    for (let y = 3; y < 6; y++) for (let x = 6; x < 12; x++) if (eq(rgbAt(buf, x, y), base)) set(buf, x, y, skinBase);
    set(buf, 8, 5, base); // widow's peak
  }
  const hx = part === 'L' ? 6 : 11;
  for (let y = 2; y < 6; y++) set(buf, hx, y, sh);
  for (let x = HX0; x < hx; x++) if (alphaAt(buf, x, 3)) set(buf, x, 3, hi);
  for (let x = HX0; x <= HX1; x++) if (alphaAt(buf, x, 2)) set(buf, x, 2, hi);
};

const HAIR_FNS = { styleRudy, styleShort };
type HairStyle = keyof typeof HAIR_FNS;

// ─── glasses ─────────────────────────────────────────────────────────────────
type GlassesKind = 'clear' | 'round' | 'sun' | 'goggles';
// Clear prescription glasses (NOT sunglasses): a thin rim that frames each eye
// without covering it. Round frames, shades, and lab goggles are variants.
function drawGlasses(buf: Buf, kind: GlassesKind = 'clear', tint?: RGB): void {
  const frame: RGB = [60, 54, 62];
  const glint: RGB = [236, 240, 246];
  if (kind === 'sun') {
    const dark = tint ?? [40, 36, 48];
    rect(buf, 4, 8, 7, 10, dark); rect(buf, 9, 8, 12, 10, dark);
    set(buf, 8, 9, frame); set(buf, 3, 9, frame); set(buf, 13, 9, frame);
    set(buf, 5, 8, [120, 118, 130]); set(buf, 10, 8, [120, 118, 130]);
    return;
  }
  if (kind === 'round') {
    for (const x0 of [5, 10]) {
      const x1 = x0 + 1;
      set(buf, x0, 7, frame); set(buf, x1, 7, frame); set(buf, x0, 11, frame); set(buf, x1, 11, frame);
      for (let y = 8; y <= 10; y++) { set(buf, x0 - 1, y, frame); set(buf, x1 + 1, y, frame); }
    }
    set(buf, 8, 9, frame); set(buf, 3, 9, frame); set(buf, 13, 9, frame);
    set(buf, 4, 8, glint); set(buf, 9, 8, glint);
    return;
  }
  if (kind === 'goggles') {
    const lens = tint ?? [170, 210, 230];
    rect(buf, 4, 7, 7, 10, frame); rect(buf, 9, 7, 12, 10, frame);
    rect(buf, 5, 8, 6, 9, lens); rect(buf, 10, 8, 11, 9, lens);
    set(buf, 8, 8, frame); set(buf, 8, 9, frame); set(buf, 3, 8, frame); set(buf, 13, 8, frame);
    set(buf, 5, 8, glint); set(buf, 10, 8, glint);
    return;
  }
  for (const x of [5, 6]) { set(buf, x, 8, frame); set(buf, x, 10, frame); }
  set(buf, 4, 9, frame); set(buf, 7, 9, frame);
  set(buf, 4, 8, frame); set(buf, 7, 8, frame);
  for (const x of [10, 11]) { set(buf, x, 8, frame); set(buf, x, 10, frame); }
  set(buf, 9, 9, frame); set(buf, 12, 9, frame);
  set(buf, 9, 8, frame); set(buf, 12, 8, frame);
  set(buf, 8, 8, frame);
  set(buf, 3, 9, frame); set(buf, 13, 9, frame);
  set(buf, 4, 8, glint); set(buf, 9, 8, glint);
}

// ─── headwear + ear kit (drawn AFTER hair) ───────────────────────────────────
type Accessory = 'headphones' | 'hardhat' | 'beret' | 'beanie' | 'visor' | 'crown' | 'earbuds' | 'capBack';
interface AccessorySpec { kind: Accessory; color?: RGB; c2?: RGB; }
function drawAccessory(buf: Buf, spec: AccessorySpec): void {
  const { kind, c2 } = spec;
  const [hi, base, sh] = shades(spec.color ?? INK);
  if (kind === 'headphones') {
    const band = INK, cup = spec.color ?? INK, pad = c2 ?? [90, 90, 100];
    for (let x = 4; x <= 13; x++) set(buf, x, 1, band);
    set(buf, 3, 2, band); set(buf, 14, 2, band); set(buf, 2, 3, band); set(buf, 15, 3, band);
    for (let y = 4; y <= 7; y++) { set(buf, 2, y, band); set(buf, 15, y, band); }
    rect(buf, 1, 8, 3, 11, cup); rect(buf, 14, 8, 16, 11, cup);
    set(buf, 2, 9, pad); set(buf, 2, 10, pad); set(buf, 15, 9, pad); set(buf, 15, 10, pad);
    set(buf, 1, 8, shades(cup)[0]); set(buf, 14, 8, shades(cup)[0]);
  } else if (kind === 'hardhat') {
    rect(buf, 4, 2, 13, 5, base);
    for (let x = 5; x <= 12; x++) set(buf, x, 1, base);
    for (let x = 6; x <= 11; x++) set(buf, x, 0, base);
    rect(buf, 2, 5, 15, 6, base);
    for (let x = 2; x <= 15; x++) set(buf, x, 6, sh);
    for (const [x, y] of [[6, 0], [7, 0], [5, 1], [6, 1], [5, 2]] as const) set(buf, x, y, hi);
  } else if (kind === 'beret') {
    for (let x = 4; x <= 13; x++) set(buf, x, 3, base);
    for (let x = 3; x <= 15; x++) set(buf, x, 2, base);
    for (let x = 5; x <= 15; x++) set(buf, x, 1, base);
    for (let x = 7; x <= 13; x++) set(buf, x, 0, base);
    for (let x = 9; x <= 14; x++) set(buf, x, 4, base);
    set(buf, 8, 0, hi); set(buf, 9, 0, hi); set(buf, 10, 0, hi);
    set(buf, 15, 2, sh); set(buf, 14, 4, sh); set(buf, 11, 0, sh);
  } else if (kind === 'beanie') {
    rect(buf, 3, 2, 14, 6, base);
    for (let x = 5; x <= 12; x++) set(buf, x, 1, base);
    for (let x = 6; x <= 11; x++) set(buf, x, 0, base);
    rect(buf, 3, 6, 14, 7, sh); // folded brim
    for (let x = 4; x <= 13; x += 2) set(buf, x, 6, base);
    for (const [x, y] of [[6, 0], [7, 0], [5, 1], [6, 1]] as const) set(buf, x, y, hi);
    if (c2) { set(buf, 8, 0, c2); set(buf, 9, 0, c2); } // pompom
  } else if (kind === 'visor') {
    const lens = spec.color ?? [40, 200, 170];
    rect(buf, 3, 8, 14, 10, lens);
    for (let x = 3; x <= 14; x += 3) set(buf, x, 8, shades(lens)[0]);
    rect(buf, 3, 7, 14, 7, INK);
  } else if (kind === 'crown') {
    const gold = spec.color ?? [228, 180, 60];
    rect(buf, 5, 1, 12, 3, gold);
    for (const x of [5, 7, 9, 11, 12]) set(buf, x, 0, gold);
    set(buf, 7, 2, c2 ?? [200, 60, 80]); set(buf, 10, 2, c2 ?? [60, 120, 200]);
    for (const x of [5, 7]) set(buf, x, 0, shades(gold)[0]);
  } else if (kind === 'earbuds') {
    const w: RGB = [245, 245, 245], stem: RGB = [200, 200, 205];
    set(buf, 3, 10, w); set(buf, 14, 10, w); set(buf, 3, 11, w); set(buf, 14, 11, w); set(buf, 3, 12, stem); set(buf, 14, 12, stem);
  } else if (kind === 'capBack') {
    rect(buf, 4, 2, 13, 5, base);
    for (let x = 5; x <= 12; x++) set(buf, x, 1, base);
    for (let x = 3; x <= 14; x++) set(buf, x, 5, base);
    rect(buf, 0, 5, 3, 5, sh); rect(buf, 1, 4, 3, 4, sh); // brim, backwards
    for (let x = 5; x <= 8; x++) set(buf, x, 1, hi);
    set(buf, 8, 3, sh); set(buf, 9, 3, sh); // strap
  }
}

// ─── props + neckwear (drawn on the torso) ───────────────────────────────────
type Extra = 'mic' | 'bowtie' | 'scarf' | 'lanyard' | 'coffee';
interface ExtraSpec { kind: Extra; color?: RGB; }
function drawExtra(buf: Buf, spec: ExtraSpec): void {
  const [hi, base, sh] = shades(spec.color ?? [200, 60, 70]);
  if (spec.kind === 'bowtie') {
    set(buf, 7, 19, base); set(buf, 10, 19, base); set(buf, 8, 19, sh); set(buf, 9, 19, sh); set(buf, 7, 20, base); set(buf, 10, 20, base);
  } else if (spec.kind === 'scarf') {
    rect(buf, 5, 17, 12, 19, base); rect(buf, 11, 20, 13, 25, base);
    for (let x = 5; x <= 12; x += 2) set(buf, x, 18, hi);
    for (let y = 20; y <= 25; y += 2) set(buf, 12, y, sh);
    set(buf, 12, 26, sh); set(buf, 11, 26, sh);
  } else if (spec.kind === 'lanyard') {
    const l = spec.color ?? [40, 120, 200];
    for (let y = 19; y <= 23; y++) { set(buf, 7, y, l); set(buf, 10, y, l); }
    rect(buf, 7, 24, 10, 26, [240, 240, 236]); set(buf, 8, 25, [120, 120, 130]); set(buf, 9, 25, [120, 120, 130]);
  } else if (spec.kind === 'mic') {
    // headset mic arm from the left ear down to the mouth
    for (const [x, y] of [[3, 12], [4, 13], [5, 14], [5, 15]] as const) set(buf, x, y, INK);
    set(buf, 6, 15, [90, 90, 100]);
  } else if (spec.kind === 'coffee') {
    // a mug held up by the right shoulder
    const mug = spec.color ?? [240, 240, 236];
    rect(buf, 14, 22, 16, 25, mug); set(buf, 17, 23, mug); set(buf, 17, 24, mug);
    rect(buf, 14, 22, 16, 22, [110, 70, 40]);
    set(buf, 15, 21, [220, 220, 220], 120);
  }
}

// ─── clothing ────────────────────────────────────────────────────────────────
type Cloth = 'suit' | 'blazer' | 'dressshirt' | 'polo' | 'cardigan' | 'sweater' | 'hoodie' | 'tee' | 'turtleneck' | 'labcoat' | 'vest' | 'flannel';
function bodyShape(buf: Buf, col: RGB, heavy = false): void {
  const [, base, sh] = shades(col);
  const rows: [number, number, number][] = heavy
    ? [[19, 5, 12], [20, 3, 14], [21, 2, 15], [22, 1, 16], [23, 1, 16], [24, 0, 17], [25, 0, 17], [26, 0, 17], [27, 0, 17]]
    : [[19, 6, 11], [20, 4, 13], [21, 3, 14], [22, 2, 15], [23, 2, 15], [24, 1, 16], [25, 1, 16], [26, 1, 16], [27, 1, 16]];
  for (const [y, a, b] of rows) rect(buf, a, y, b, y, base);
  const [lo, hi] = heavy ? [1, 16] : [2, 15];
  for (let y = 22; y < 28; y++) { set(buf, lo, y, sh); set(buf, hi, y, sh); }
}
function drawClothing(buf: Buf, kind: Cloth, c1: RGB, c2: RGB | undefined, tie: RGB | undefined, skin: string, heavy = false): void {
  const [hi, base, sh] = shades(c1);
  const s = SKIN[skin];
  bodyShape(buf, kind === 'labcoat' ? WHITE : c1, heavy);
  if (kind === 'suit' || kind === 'blazer') {
    const shirt = c2 ?? WHITE;
    for (const [x, y] of [[8, 19], [9, 19], [7, 20], [8, 20], [9, 20], [10, 20], [8, 21], [9, 21]] as const) set(buf, x, y, shirt);
    for (const [x, y] of [[6, 20], [7, 21], [11, 20], [10, 21], [6, 21], [11, 21]] as const) set(buf, x, y, sh);
    if (tie) { for (let y = 20; y < 26; y++) { set(buf, 8, y, tie); set(buf, 9, y, tie); } set(buf, 8, 20, shades(tie)[0]); }
    else for (let y = 22; y < 26; y++) { set(buf, 8, y, shirt); set(buf, 9, y, shirt); }
    if (kind === 'blazer') for (let y = 22; y < 27; y++) { set(buf, 7, y, sh); set(buf, 10, y, sh); }
  } else if (kind === 'dressshirt') {
    for (const [x, y] of [[6, 19], [7, 19], [10, 19], [11, 19], [7, 20], [10, 20]] as const) set(buf, x, y, sh);
    for (let y = 20; y < 27; y += 2) set(buf, 8, y, sh);
    if (tie) for (let y = 19; y < 26; y++) { set(buf, 8, y, tie); set(buf, 9, y, tie); }
  } else if (kind === 'polo') {
    for (const [x, y] of [[6, 19], [7, 19], [10, 19], [11, 19]] as const) set(buf, x, y, hi);
    set(buf, 8, 20, sh); set(buf, 8, 22, sh);
    const accent = c2 ? shades(c2)[1] : hi;
    for (const [x, y] of [[7, 20], [9, 20]] as const) set(buf, x, y, accent);
  } else if (kind === 'cardigan') {
    const inner: RGB = c2 ? shades(c2)[1] : [235, 233, 226];
    for (let y = 19; y < 27; y++) { set(buf, 8, y, inner); set(buf, 9, y, inner); }
    for (const [x, y] of [[6, 19], [7, 19], [10, 19], [11, 19]] as const) set(buf, x, y, sh);
  } else if (kind === 'sweater') {
    for (const [x, y] of [[6, 19], [7, 19], [8, 19], [9, 19], [10, 19], [11, 19]] as const) set(buf, x, y, sh);
  } else if (kind === 'hoodie') {
    // hood bunched at the neck + drawstrings + kangaroo pocket
    rect(buf, 4, 19, 13, 20, sh);
    for (const [x, y] of [[5, 19], [12, 19], [6, 18], [11, 18]] as const) set(buf, x, y, sh);
    for (const [x, y] of [[6, 19], [7, 19], [10, 19], [11, 19]] as const) set(buf, x, y, base);
    const str = c2 ?? WHITE;
    for (let y = 20; y <= 24; y++) { set(buf, 7, y, str); set(buf, 10, y, str); }
    rect(buf, 4, 25, 13, 27, sh); rect(buf, 5, 25, 12, 25, base);
    for (let x = 5; x <= 12; x++) set(buf, x, 25, hi);
  } else if (kind === 'tee') {
    for (const [x, y] of [[7, 19], [8, 19], [9, 19], [10, 19]] as const) set(buf, x, y, sh);
    set(buf, 6, 19, hi); set(buf, 11, 19, hi);
    if (c2) rect(buf, 7, 22, 10, 24, c2); // chest print
    // short sleeves: bare arms from row 25
    for (let y = 25; y <= 27; y++) { set(buf, 2, y, s.base); set(buf, 15, y, s.base); set(buf, 3, y, s.sh); set(buf, 14, y, s.sh); }
  } else if (kind === 'turtleneck') {
    rect(buf, 6, 17, 11, 19, base); rect(buf, 6, 17, 11, 17, hi);
    for (let x = 6; x <= 11; x++) set(buf, x, 18, (x % 2) ? sh : base);
  } else if (kind === 'labcoat') {
    const [, , cs] = shades(WHITE);
    // inner shirt (c1) shows in the V; pocket pens
    for (const [x, y] of [[8, 19], [9, 19], [7, 20], [8, 20], [9, 20], [10, 20], [8, 21], [9, 21], [8, 22], [9, 22]] as const) set(buf, x, y, base);
    for (const [x, y] of [[6, 20], [7, 21], [11, 20], [10, 21], [7, 22], [10, 22]] as const) set(buf, x, y, cs);
    for (let y = 23; y < 28; y++) set(buf, 8, y, cs);
    rect(buf, 11, 24, 14, 24, cs);
    set(buf, 12, 25, c2 ?? [200, 80, 80]); set(buf, 13, 25, [60, 120, 200]);
  } else if (kind === 'vest') {
    // shirt (c1) with a vest (c2) over it
    const v = c2 ?? [200, 120, 40];
    const [vh, vb, vs] = shades(v);
    rect(buf, 3, 20, 5, 27, vb); rect(buf, 12, 20, 14, 27, vb);
    rect(buf, 5, 22, 6, 27, vb); rect(buf, 11, 22, 12, 27, vb);
    for (let y = 21; y < 28; y++) { set(buf, 3, y, vh); set(buf, 14, y, vs); }
    if (tie) for (let y = 19; y < 26; y++) { set(buf, 8, y, tie); set(buf, 9, y, tie); }
    for (const [x, y] of [[6, 19], [7, 19], [10, 19], [11, 19]] as const) set(buf, x, y, sh);
  } else if (kind === 'flannel') {
    // plaid: c1 base with c2 cross-stripes, white tee at the collar
    const p = c2 ?? INK;
    for (let y = 19; y < 28; y++) for (let x = 0; x < 18; x++) {
      if (!alphaAt(buf, x, y)) continue;
      if ((x % 4 === 1) || (y % 4 === 1)) set(buf, x, y, mix(rgbAt(buf, x, y), p, 0.55));
    }
    for (const [x, y] of [[6, 19], [7, 19], [10, 19], [11, 19], [7, 20], [10, 20]] as const) set(buf, x, y, sh);
    for (let y = 20; y < 27; y += 2) set(buf, 8, y, sh);
    rect(buf, 8, 19, 9, 21, WHITE);
  }
}
function collarNeck(buf: Buf, skin: string): void {
  rect(buf, 7, 18, 10, 19, SKIN[skin].sh);
}

// ─── scene body (full standing figure: torso + legs, front or back) ──────────
// Proportioned for standing (not the portrait bust): a narrower torso over real
// legs. Head (rows 2-16) sits above; this draws rows 18-31.
const SHOE: RGB = [44, 40, 48];

function drawSceneLegs(buf: Buf, pants: RGB, phase: number): void {
  const [, base, sh] = shades(pants);
  // two legs cols 5-7 / 10-12, gap at 8-9
  for (const [lx0, lx1] of [[5, 7], [10, 12]] as const) {
    rect(buf, lx0, 25, lx1, 30, base);
    for (let y = 25; y <= 30; y++) set(buf, lx1, y, sh); // inner shade
  }
  // feet — lift one foot per walk phase for a simple gait
  const leftLow = phase !== 1, rightLow = phase !== 2;
  rect(buf, 5, leftLow ? 31 : 30, 7, leftLow ? 31 : 30, SHOE);
  rect(buf, 10, rightLow ? 31 : 30, 12, rightLow ? 31 : 30, SHOE);
}

function drawSceneTorso(buf: Buf, r: Recipe, back: boolean): void {
  const col = r.cloth === 'labcoat' ? WHITE : r.c1;
  const [hi, base, sh] = shades(col);
  // shoulders → torso, narrower than the portrait bust (wider + rounder if heavy)
  if (r.heavy) {
    rect(buf, 3, 18, 14, 18, base);
    rect(buf, 2, 19, 15, 19, base);
    rect(buf, 2, 20, 15, 24, base);
    for (let y = 20; y <= 24; y++) { set(buf, 2, y, sh); set(buf, 15, y, sh); set(buf, 14, y, sh); }
  } else {
    rect(buf, 4, 18, 13, 18, base);
    rect(buf, 3, 19, 14, 19, base);
    rect(buf, 4, 20, 13, 24, base);
    for (let y = 20; y <= 24; y++) { set(buf, 3, y, sh); set(buf, 14, y, sh); set(buf, 13, y, sh); } // arms / right shade
  }
  if (back) {
    // plain back with a collar line + center seam
    rect(buf, 6, 18, 11, 18, sh);
    for (let y = 19; y <= 24; y++) set(buf, 8, y, sh);
    return;
  }
  const k = r.cloth;
  if (k === 'suit' || k === 'blazer') {
    const shirt = r.c2 && k === 'blazer' ? r.c2 : WHITE;
    for (const [x, y] of [[8, 18], [9, 18], [7, 19], [8, 19], [9, 19], [10, 19], [8, 20], [9, 20]] as const) set(buf, x, y, shirt);
    for (const [x, y] of [[6, 19], [7, 20], [11, 19], [10, 20]] as const) set(buf, x, y, sh);
    if (r.tie) { for (let y = 19; y <= 24; y++) { set(buf, 8, y, r.tie); set(buf, 9, y, r.tie); } set(buf, 8, 19, shades(r.tie)[0]); }
  } else if (k === 'dressshirt' || k === 'flannel') {
    for (const [x, y] of [[6, 18], [7, 18], [10, 18], [11, 18], [7, 19], [10, 19]] as const) set(buf, x, y, sh);
    if (r.tie) for (let y = 18; y <= 24; y++) { set(buf, 8, y, r.tie); set(buf, 9, y, r.tie); }
    else for (let y = 20; y <= 24; y += 2) set(buf, 8, y, sh);
    if (k === 'flannel') {
      const p = r.c2 ?? INK;
      for (let y = 18; y <= 24; y++) for (let x = 3; x <= 14; x++) if (alphaAt(buf, x, y) && ((x % 4 === 1) || (y % 4 === 1))) set(buf, x, y, mix(rgbAt(buf, x, y), p, 0.55));
    }
  } else if (k === 'polo') {
    for (const [x, y] of [[6, 18], [7, 18], [10, 18], [11, 18]] as const) set(buf, x, y, hi);
    set(buf, 8, 19, sh); set(buf, 8, 21, sh);
  } else if (k === 'cardigan') {
    const inner: RGB = r.c2 ? shades(r.c2)[1] : [235, 233, 226];
    for (let y = 18; y <= 24; y++) { set(buf, 8, y, inner); set(buf, 9, y, inner); }
    for (const [x, y] of [[6, 18], [7, 18], [10, 18], [11, 18]] as const) set(buf, x, y, sh);
  } else if (k === 'sweater' || k === 'turtleneck') {
    for (const [x, y] of [[6, 18], [7, 18], [8, 18], [9, 18], [10, 18], [11, 18]] as const) set(buf, x, y, sh);
  } else if (k === 'hoodie') {
    rect(buf, 5, 18, 12, 19, sh);
    for (let y = 19; y <= 22; y++) { set(buf, 7, y, r.c2 ?? WHITE); set(buf, 10, y, r.c2 ?? WHITE); }
    rect(buf, 5, 23, 12, 24, sh);
  } else if (k === 'tee') {
    for (const [x, y] of [[7, 18], [8, 18], [9, 18], [10, 18]] as const) set(buf, x, y, sh);
    if (r.c2) rect(buf, 7, 20, 10, 22, r.c2);
  } else if (k === 'labcoat') {
    for (const [x, y] of [[8, 18], [9, 18], [7, 19], [8, 19], [9, 19], [10, 19], [8, 20], [9, 20]] as const) set(buf, x, y, r.c1);
    for (let y = 21; y <= 24; y++) set(buf, 8, y, sh);
  } else if (k === 'vest') {
    const [, vb] = shades(r.c2 ?? [200, 120, 40]);
    rect(buf, 4, 19, 5, 24, vb); rect(buf, 12, 19, 13, 24, vb);
    if (r.tie) for (let y = 18; y <= 24; y++) { set(buf, 8, y, r.tie); set(buf, 9, y, r.tie); }
  }
  if (r.extra && (r.extra.kind === 'lanyard' || r.extra.kind === 'bowtie')) {
    // small enough to carry onto the standing torso; scarf/mug/mic are portrait-only
    const [, eb] = shades(r.extra.color ?? [200, 60, 70]);
    if (r.extra.kind === 'lanyard') { for (let y = 18; y <= 21; y++) { set(buf, 7, y, eb); set(buf, 10, y, eb); } rect(buf, 7, 22, 10, 23, [240, 240, 236]); }
    else { set(buf, 7, 18, eb); set(buf, 10, 18, eb); set(buf, 8, 18, shades(eb)[2]); set(buf, 9, 18, shades(eb)[2]); }
  }
}

/** Back of the head: a rounded hair-covered skull with crown sheen + nape, no
 *  face — plus whatever headwear the recipe carries, so a hard hat or crown
 *  still reads from behind. */
function drawHeadBack(buf: Buf, r: Recipe): void {
  const s = SKIN[r.skin];
  const [hi, base, sh] = shades(r.hairc);
  // rounded skull silhouette (narrow at crown + nape, full through the middle)
  const rows: [number, number, number][] = [
    [2, 6, 11], [3, 5, 12], [4, 4, 13], [5, 4, 13], [6, 4, 13], [7, 4, 13], [8, 4, 13],
    [9, 4, 13], [10, 4, 13], [11, 4, 13], [12, 4, 13], [13, 5, 12], [14, 6, 11],
  ];
  for (const [y, a, b] of rows) rect(buf, a, y, b, y, base);
  // roundness: darken the side edges and the nape
  for (let y = 4; y <= 12; y++) { set(buf, 4, y, sh); set(buf, 13, y, sh); }
  for (const [x, y] of [[5, 3], [12, 3], [5, 13], [12, 13], [6, 14], [11, 14]] as const) set(buf, x, y, sh);
  // crown sheen (rounded top catching the light) + the swoop's part line
  for (const [x, y] of [[7, 2], [8, 2], [9, 2], [10, 2], [7, 3], [8, 3], [9, 3]] as const) set(buf, x, y, hi);
  for (let y = 4; y <= 11; y++) set(buf, 9, y, hi);
  for (let y = 4; y <= 12; y++) set(buf, 8, y, sh);
  // nape + neck (skin)
  rect(buf, 7, 14, 10, 14, sh);
  rect(buf, 7, 15, 10, 17, s.sh);
  rect(buf, 7, 15, 9, 15, s.base);
  if (r.accessory && r.accessory.kind !== 'earbuds' && r.accessory.kind !== 'visor') drawAccessory(buf, r.accessory);
}

function drawSceneBody(buf: Buf, r: Recipe, phase: number, back: boolean): void {
  drawSceneTorso(buf, r, back);
  drawSceneLegs(buf, defaultPants(r), phase);
}

// ─── outline pass ────────────────────────────────────────────────────────────
function outlinePass(buf: Buf): void {
  const pts: [number, number][] = [];
  for (let y = 0; y < CUR_H; y++) {
    for (let x = 0; x < CUR_W; x++) {
      if (alphaAt(buf, x, y) !== 0) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        if (alphaAt(buf, x + dx, y + dy) === 255) { pts.push([x, y]); break; }
      }
    }
  }
  for (const [x, y] of pts) set(buf, x, y, OUTLINE);
}

// ─── recipes ─────────────────────────────────────────────────────────────────
interface Recipe {
  skin: string; hairc: RGB; hair: HairStyle; hairargs?: HairArgs;
  cloth: Cloth; c1: RGB; c2?: RGB; tie?: RGB; pants?: RGB;
  brow?: Brow; mouth?: Mouth; eyes?: Eyes; blush?: boolean; lashes?: boolean;
  /** Clear frames by default; a kind picks shades / round rims / lab goggles. */
  glasses?: boolean | GlassesKind; glassTint?: RGB;
  /** Headwear or ear kit, drawn over the hair. */
  accessory?: AccessorySpec;
  /** A prop or neckwear on the torso (portrait bust; lanyard/bowtie also on the floor). */
  extra?: ExtraSpec;
  /** Heavier build: wider torso. */
  heavy?: boolean;
}

// The one head every clone shares — the brand mark in pixels.
const RUDY_HEAD = { skin: 'light', hairc: [20, 18, 24] as RGB, hair: 'styleRudy' as HairStyle, eyes: 'dot' as Eyes, brow: 'none' as Brow };
const BRAND_RED: RGB = [110, 20, 35];
const CREAM: RGB = [236, 232, 222];

const RECIPES: Record<OfficeCharacterName, Recipe> = {
  rudy:   { ...RUDY_HEAD, cloth: 'tee', c1: CREAM, c2: BRAND_RED, mouth: 'small' },
  theo:   { ...RUDY_HEAD, cloth: 'hoodie', c1: [74, 96, 140], c2: WHITE, accessory: { kind: 'headphones', color: INK, c2: BRAND_RED }, mouth: 'smile' },
  sam:    { ...RUDY_HEAD, cloth: 'vest', c1: CREAM, c2: [216, 130, 50], accessory: { kind: 'hardhat', color: [240, 190, 60] }, mouth: 'neutral' },
  ines:   { ...RUDY_HEAD, cloth: 'turtleneck', c1: [40, 38, 48], accessory: { kind: 'beret', color: [120, 30, 50] }, mouth: 'smirk' },
  lena:   { ...RUDY_HEAD, cloth: 'labcoat', c1: [92, 169, 122], glasses: 'goggles', glassTint: [170, 220, 200], mouth: 'neutral' },
  kofi:   { ...RUDY_HEAD, cloth: 'suit', c1: [40, 38, 48], tie: BRAND_RED, glasses: 'sun', mouth: 'neutral', extra: { kind: 'mic' } },
  ravi:   { ...RUDY_HEAD, cloth: 'vest', c1: CREAM, c2: [120, 100, 160], glasses: 'round', mouth: 'small', extra: { kind: 'bowtie', color: BRAND_RED } },
  noor:   { ...RUDY_HEAD, cloth: 'cardigan', c1: [150, 120, 90], c2: CREAM, glasses: 'round', extra: { kind: 'scarf', color: [170, 50, 60] }, mouth: 'smile' },
  wren:   { ...RUDY_HEAD, cloth: 'flannel', c1: [150, 60, 60], c2: [30, 30, 40], accessory: { kind: 'beanie', color: [60, 70, 90], c2: [240, 200, 80] }, mouth: 'neutral' },
  mara:   { ...RUDY_HEAD, cloth: 'blazer', c1: [60, 90, 120], c2: CREAM, extra: { kind: 'lanyard', color: BRAND_RED }, mouth: 'smile' },
  yuki:   { ...RUDY_HEAD, cloth: 'hoodie', c1: [40, 110, 100], c2: [240, 200, 80], accessory: { kind: 'visor', color: [60, 220, 180] }, mouth: 'small' },
  jonah:  { ...RUDY_HEAD, cloth: 'suit', c1: [60, 50, 70], tie: BRAND_RED, accessory: { kind: 'crown', color: [228, 180, 60], c2: BRAND_RED }, mouth: 'grin' },
  zoe:    { ...RUDY_HEAD, cloth: 'tee', c1: [200, 90, 140], c2: WHITE, accessory: { kind: 'earbuds' }, mouth: 'smile' },
  mateo:  { ...RUDY_HEAD, cloth: 'polo', c1: [210, 120, 50], c2: INK, accessory: { kind: 'headphones', color: [60, 60, 70], c2: [200, 200, 210] }, extra: { kind: 'coffee' }, mouth: 'neutral' },
  ayo:    { ...RUDY_HEAD, cloth: 'hoodie', c1: [120, 120, 130], c2: WHITE, accessory: { kind: 'capBack', color: BRAND_RED }, extra: { kind: 'lanyard', color: [60, 120, 200] }, mouth: 'grin' },
};
const FALLBACK: OfficeCharacterName = 'theo';

/** The face/hair group (head → face → hair → glasses → headwear), no clothing. */
function drawHeadGroup(buf: Buf, r: Recipe): void {
  const skinBase = SKIN[r.skin].base;
  drawHead(buf, r.skin);
  drawFace(buf, r.skin, r.brow ?? 'flat', r.mouth ?? 'neutral', r.blush ?? false, r.lashes ?? false, r.eyes ?? 'normal');
  HAIR_FNS[r.hair](buf, r.hairc, skinBase, r.hairargs ?? {});
  if (r.glasses) drawGlasses(buf, r.glasses === true ? 'clear' : r.glasses, r.glassTint);
  if (r.accessory) drawAccessory(buf, r.accessory);
}

function defaultPants(r: Recipe): RGB {
  if (r.pants) return r.pants;
  return r.cloth === 'suit' ? shades(r.c1)[2] : [54, 56, 70];
}

/** Portrait bust: shoulders-height clothing + front head group. */
function compose(r: Recipe): Buf {
  CUR_W = PORTRAIT_W; CUR_H = PORTRAIT_H;
  const buf = new Uint8ClampedArray(PORTRAIT_W * PORTRAIT_H * 4);
  drawClothing(buf, r.cloth, r.c1, r.c2, r.tie, r.skin, r.heavy ?? false);
  if (r.extra) drawExtra(buf, r.extra);
  collarNeck(buf, r.skin);
  drawHeadGroup(buf, r);
  if (r.extra && r.extra.kind === 'scarf') drawExtra(buf, r.extra); // over the collar
  outlinePass(buf);
  return buf;
}

/** Full-body 18×32 scene sprite. `back=false` reuses the portrait's exact face. */
function composeScene(r: Recipe, phase: number, back: boolean): Buf {
  CUR_W = SCENE_W; CUR_H = SCENE_H;
  const buf = new Uint8ClampedArray(SCENE_W * SCENE_H * 4);
  drawSceneBody(buf, r, phase, back);
  if (back) drawHeadBack(buf, r);
  else drawHeadGroup(buf, r);
  outlinePass(buf);
  return buf;
}

// ─── public render ───────────────────────────────────────────────────────────
const bufCache = new Map<OfficeCharacterName, Buf>();
const sceneCache = new Map<OfficeCharacterName, SceneFrames>();

function getBuf(name: OfficeCharacterName): Buf {
  let buf = bufCache.get(name);
  if (!buf) {
    buf = compose(RECIPES[name] ?? RECIPES[FALLBACK]);
    bufCache.set(name, buf);
  }
  return buf;
}

export interface SceneFrames { front: Buf[]; back: Buf[]; }

/** Walk-phase frames (stand, step-L, step-R) for the in-scene sprite, front + back. */
export function sceneFrameBufs(name: OfficeCharacterName): SceneFrames {
  let frames = sceneCache.get(name);
  if (!frames) {
    const r = RECIPES[name] ?? RECIPES[FALLBACK];
    frames = {
      front: [composeScene(r, 0, false), composeScene(r, 1, false), composeScene(r, 2, false)],
      back: [composeScene(r, 0, true), composeScene(r, 1, true), composeScene(r, 2, true)],
    };
    sceneCache.set(name, frames);
  }
  return frames;
}

/** Paint a character's procedural portrait onto `ctx`, nearest-neighbor at `scale`. */
export function paintPortrait(ctx: CanvasRenderingContext2D, name: OfficeCharacterName, scale = 2): void {
  const buf = getBuf(name);
  // Stage at 1× on an offscreen canvas, then blit scaled with smoothing off.
  const stage = document.createElement('canvas');
  stage.width = PORTRAIT_W; stage.height = PORTRAIT_H;
  const sctx = stage.getContext('2d')!;
  const img = sctx.createImageData(PORTRAIT_W, PORTRAIT_H);
  img.data.set(buf);
  sctx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, PORTRAIT_W * scale, PORTRAIT_H * scale);
  ctx.drawImage(stage, 0, 0, PORTRAIT_W, PORTRAIT_H, 0, 0, PORTRAIT_W * scale, PORTRAIT_H * scale);
}
