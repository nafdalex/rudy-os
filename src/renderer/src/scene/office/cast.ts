// The Rudy OS cast — roster metadata + sprite frames.
//
// Every agent is a clone of Rudy (the brand head: ink swoop, dot eyes), told
// apart by the kit each role wears. Both the static portraits (cards / picker)
// and the in-scene walking sprites are custom-drawn from the same per-character
// recipes in portraitArt.ts: the scene sprite reuses the portrait's exact
// head/face/clothing and adds legs, so an agent on the office floor looks
// identical to its card. See assets/ATTRIBUTION.md.

import { Texture } from 'pixi.js';
import { paintPortrait, sceneFrameBufs, SCENE_W, SCENE_H } from './portraitArt';

export type OfficeCharacterName =
  | 'rudy' | 'theo' | 'sam' | 'ines' | 'lena' | 'kofi' | 'ravi' | 'noor'
  | 'wren' | 'mara' | 'yuki' | 'jonah' | 'zoe' | 'mateo' | 'ayo';

export interface CastMember {
  name: OfficeCharacterName;
  displayName: string;
  /** Signature accent color (hex) — used for the in-scene selection glow. */
  shirt: string;
  /** Blurb shown when this character is picked / has no description yet. */
  blurb: string;
}

/** Selectable roster, in display order. Rudy (the original) leads; the blurb is
 *  a one-liner from that role's daily life on a builder's team. */
export const OFFICE_CAST: CastMember[] = [
  { name: 'rudy',  displayName: 'Rudy',  shirt: '#6E1423', blurb: 'The original' },
  { name: 'theo',  displayName: 'Theo',  shirt: '#4F9FAF', blurb: 'Ships on a Friday' },
  { name: 'sam',   displayName: 'Sam',   shirt: '#D99168', blurb: 'Turns it off and on' },
  { name: 'ines',  displayName: 'Inés',  shirt: '#9482D3', blurb: 'Nudges it 2px left' },
  { name: 'lena',  displayName: 'Lena',  shirt: '#5CA97A', blurb: 'Breaks it on purpose' },
  { name: 'kofi',  displayName: 'Kofi',  shirt: '#3D2E4A', blurb: 'Trusts nobody' },
  { name: 'ravi',  displayName: 'Ravi',  shirt: '#DCAB3C', blurb: 'Lives in spreadsheets' },
  { name: 'noor',  displayName: 'Noor',  shirt: '#D96A62', blurb: 'Actually writes docs' },
  { name: 'wren',  displayName: 'Wren',  shirt: '#6B5878', blurb: 'It is always DNS' },
  { name: 'mara',  displayName: 'Mara',  shirt: '#4F9FAF', blurb: 'Says no politely' },
  { name: 'yuki',  displayName: 'Yuki',  shirt: '#5CA97A', blurb: 'Waits on the GPU' },
  { name: 'jonah', displayName: 'Jonah', shirt: '#6E1423', blurb: 'Asks what it costs' },
  { name: 'zoe',   displayName: 'Zoe',   shirt: '#D16BA5', blurb: 'Swipes till it breaks' },
  { name: 'mateo', displayName: 'Mateo', shirt: '#D6903F', blurb: 'Sleeps with the pager' },
  { name: 'ayo',   displayName: 'Ayo',   shirt: '#A899B5', blurb: 'Deployed on day one' },
];

export const CAST_BY_NAME: Record<OfficeCharacterName, CastMember> =
  Object.fromEntries(OFFICE_CAST.map((c) => [c.name, c])) as Record<OfficeCharacterName, CastMember>;

// Workers default to Theo (the dev); Rudy himself is the orchestrator's look.
export const DEFAULT_CHARACTER: OfficeCharacterName = 'theo';

export function hexToNumber(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}

// ─── scene frames ────────────────────────────────────────────────────────────
const frameCache = new Map<OfficeCharacterName, Texture[][]>();

function bufToTexture(buf: Uint8ClampedArray): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = SCENE_W; canvas.height = SCENE_H;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(SCENE_W, SCENE_H);
  img.data.set(buf);
  ctx.putImageData(img, 0, 0);
  const tex = Texture.from(canvas);
  tex.source.scaleMode = 'nearest';
  return tex;
}

/**
 * Frame grid CharacterSprite expects: 3 rows (down, up, right) × 7 frames
 * [walk1, walk2, walk3, type1, type2, read1, read2]. We provide a front view
 * (down — and reused for the side row, so left/right walkers still show a face)
 * and a back view (up — agents seated facing their desk show their back). The
 * three walk frames are stand / step-left / step-right.
 */
export async function getCastFrames(name: OfficeCharacterName): Promise<Texture[][]> {
  const cached = frameCache.get(name);
  if (cached) return cached;
  const { front, back } = sceneFrameBufs(name);
  const toRow = (bufs: Uint8ClampedArray[]): Texture[] => {
    const [stand, stepL, stepR] = bufs.map(bufToTexture);
    return [stand, stepL, stepR, stand, stand, stand, stand];
  };
  const frontRow = toRow(front);
  const frames: Texture[][] = [frontRow, toRow(back), frontRow]; // down, up, right
  frameCache.set(name, frames);
  return frames;
}

/**
 * Paint a character's static portrait for cards / the picker (delegates to the
 * custom procedural composer in portraitArt.ts).
 */
export async function paintCastPortrait(
  ctx: CanvasRenderingContext2D,
  name: OfficeCharacterName,
  scale = 2,
): Promise<void> {
  paintPortrait(ctx, name, scale);
}
