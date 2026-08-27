// Theme registry — the pluggable "office theme" contract.
//
// Phase 0 of the TV-show-offices feature (card tvshow-phase0-abstraction):
// extract the ~40% of constants that were hard-coded inside OfficeFloor.tsx
// (errand spots, coffee-economy tile coords, prop anchors, seat names, tileset
// URLs, palette, monitor gids) into a ThemeConfig so the scene becomes
// swappable per show. This phase ships the EXISTING office unchanged as
// `theme: 'office'`: every value below is copied byte-for-byte from the old
// in-file literals, so the office renders and behaves identically.
//
// The engine (TiledMapRenderer / BFS pathfinding / Camera / sprite animation)
// is already fully generic and needs no change. cast.ts is read-only here
// (uncommitted human WIP) — the office theme references its existing exports.

import type { Texture } from 'pixi.js';
import { colors } from '@/design/tokens';
import {
  CAST_BY_NAME,
  getCastFrames,
  DEFAULT_CHARACTER,
  type CastMember,
  type OfficeCharacterName,
} from './cast';

import officeTilesetUrl from '@/assets/tilesets/office-tileset.png?url';
import a5FloorsWallsUrl from '@/assets/tilesets/a5-office-floors-walls.png?url';
import interiorsUrl from '@/assets/tilesets/interiors.png?url';
// .tmj is Tiled JSON; imported as raw text and parsed by the loader.
import officeMapRaw from '@/assets/maps/office.tmj?raw';

/** Theme identifiers. ONE theme: the Rudy OS office. (The TV-show themes and
 *  their maps were removed with the rebrand; the registry contract stays so a
 *  future original theme can plug in.) */
export type ThemeId = 'office';

export interface Tile { x: number; y: number; }
export type Facing = 'up' | 'down' | 'left' | 'right';

/** Kinds of small idle errands around the office (incl. plant watering).
 *  'smoke' is the boss special: cigar at the open window, boss only. */
export type ErrandKind =
  | 'water' | 'window' | 'dispenser' | 'fridge' | 'shelf' | 'bin' | 'smoke';

/** One idle-errand anchor: a stand tile + facing, an `fx` tile for the ambient
 *  animation, a duration, and an optional boss-only restriction. */
export interface ErrandSpot {
  kind: ErrandKind;
  stand: Tile;
  facing: Facing;
  fx: Tile;
  duration: number;
  bossOnly?: boolean;
}

/** One tileset atlas + its placement in the global gid space. `embedded` marks
 *  the atlas whose metadata already lives inline in the map's own `tilesets[0]`
 *  (the loader keeps the map's copy and only patches the appended atlases). */
export interface TilesetEntry {
  url: string;
  embedded?: boolean;
  firstgid?: number;
  image?: string;
  imagewidth?: number;
  imageheight?: number;
  tilewidth?: number;
  tileheight?: number;
  columns?: number;
  tilecount?: number;
}

/** Desk-monitor overlay gids. The map paints an OFF monitor block; DeskScreen
 *  overlays the matching ON tiles while the desk's agent is seated. */
export interface MonitorConfig {
  /** gid of the OFF monitor block's top-left tile, as painted in the map. */
  offTopLeftGid: number;
  /** Matching ON tiles as [gid, dx, dy] relative to the block's top-left. */
  onGids: ReadonlyArray<readonly [number, number, number]>;
}

/** The coffee economy's fixed tiles: sideboard (mug rack) → counter machine →
 *  sink → back to the sideboard. `maxCups` caps the clean-mug stock. */
export interface CoffeeConfig {
  trayTile: Tile;
  trayStand: Tile;
  machineStand: Tile;
  sinkTile: Tile;
  sinkStand: Tile;
  maxCups: number;
}

/** Clickable prop anchors (tile coords). calendar → TRIGGERS, boards → TASKS,
 *  clock → CLOSING TIME. */
export interface AnchorConfig {
  calendar: Tile;
  boards: Tile;
  clock: Tile;
}

/** Theme palette. `background` is the canvas clear color; `noteColors` are the
 *  kanban note colors keyed by task status. `ground` tints the floor/walls tile
 *  layers only — furniture and the cast live in sibling containers and keep
 *  their own colors (see OfficeFloor's colorway block). */
export interface PaletteConfig {
  background: number;
  noteColors: Record<string, number>;
  ground?: { floorTint: number; wallTint: number };
}

/** Per-theme cast loader — the indirection point so a future show can swap its
 *  own roster + sprite frames. The office theme points at cast.ts's exports. */
export interface ThemeCast {
  byName: Record<string, CastMember>;
  getFrames: (name: string) => Promise<Texture[][]>;
  defaultCharacter: string;
}

/** The full contract a theme must supply. See report §A (theme contract). */
export interface ThemeConfig {
  id: ThemeId;
  /** Raw Tiled JSON text; parsed + tileset-patched by themeLoader. */
  mapRaw: string;
  /** Ordered atlases — order matches both the texture load order and the map's
   *  tileset array (texture[i] ↔ tilesets[i]). */
  tilesets: TilesetEntry[];
  /** Desk-claim order, by spawn-point name (seat 0 = boss / desk-ceo). */
  primarySeatNames: string[];
  /** Paired café table seats, in order. */
  cafeSeatNames: string[];
  /** Café standing spots: [spawn-point name, kind]. */
  cafeStands: ReadonlyArray<readonly [string, 'coffee' | 'vending']>;
  coffee: CoffeeConfig;
  anchors: AnchorConfig;
  errandSpots: ErrandSpot[];
  monitor: MonitorConfig;
  palette: PaletteConfig;
  cast: ThemeCast;
}

/** The existing office, expressed as a theme. Values are copied verbatim from
 *  the former in-file constants in OfficeFloor.tsx / DeskScreen.ts. */
export const OFFICE_THEME: ThemeConfig = {
  id: 'office',
  mapRaw: officeMapRaw,
  tilesets: [
    // office-tileset.png — embedded in the map (firstgid 1); keep the map's copy.
    { url: officeTilesetUrl, embedded: true },
    { url: a5FloorsWallsUrl, firstgid: 513, image: 'a5', imagewidth: 256, imageheight: 512, tilewidth: 16, tileheight: 16, columns: 16, tilecount: 512 },
    { url: interiorsUrl, firstgid: 1025, image: 'interiors', imagewidth: 256, imageheight: 1424, tilewidth: 16, tileheight: 16, columns: 16, tilecount: 1424 },
  ],
  primarySeatNames: [
    'desk-ceo',
    'pc-1', 'pc-2', 'pc-3', 'pc-4', 'pc-5',
    'pc-6', 'pc-7', 'pc-8', 'pc-9', 'pc-10',
    'desk-agent-organizer', 'desk-chief-architect', 'desk-ui-ux-expert',
    'warroom-seat',
  ],
  cafeSeatNames: ['cafe-seat-1', 'cafe-seat-2', 'cafe-seat-3', 'cafe-seat-4'],
  cafeStands: [
    ['cafe-stand-coffee', 'coffee'],
    ['cafe-stand-vending', 'vending'],
  ],
  // Atrium layout: the café moved to the sunny top-center, so the whole
  // coffee economy happens on the kitchen run under the windows.
  coffee: {
    trayTile: { x: 15, y: 4 },      // kitchen counter, middle
    trayStand: { x: 15, y: 6 },
    machineStand: { x: 18, y: 5 },  // below the coffee machine
    sinkTile: { x: 16, y: 4 },      // counter top beside the tray
    sinkStand: { x: 16, y: 6 },
    maxCups: 4,
  },
  anchors: {
    calendar: { x: 4, y: 1 },
    // The task boards hang ON the war-room's top wall, facing the bullpen —
    // they floated mid-floor before, which read as clutter.
    boards: { x: 2, y: 14 },
    clock: { x: 1, y: 1 },
  },
  errandSpots: [
    // plants on the open floor (droplets ride on the character)
    { kind: 'water', stand: { x: 1, y: 13 }, facing: 'up', fx: { x: 1, y: 12 }, duration: 4.5 },
    { kind: 'water', stand: { x: 12, y: 20 }, facing: 'right', fx: { x: 13, y: 20 }, duration: 4.5 },
    { kind: 'water', stand: { x: 31, y: 20 }, facing: 'right', fx: { x: 32, y: 20 }, duration: 4.5 },
    // Rudy's corner office is his alone: his plant, his window, his cigar.
    { kind: 'water', stand: { x: 26, y: 5 }, facing: 'up', fx: { x: 26, y: 4 }, duration: 4.5, bossOnly: true },
    { kind: 'smoke', stand: { x: 31, y: 4 }, facing: 'up', fx: { x: 31, y: 1 }, duration: 18, bossOnly: true },
    // the cooler by the café
    { kind: 'dispenser', stand: { x: 21, y: 4 }, facing: 'up', fx: { x: 21, y: 3 }, duration: 3.5 },
    // the kitchen run: fridge at the left end, shelf at the right
    { kind: 'fridge', stand: { x: 12, y: 6 }, facing: 'up', fx: { x: 12, y: 5 }, duration: 3.2 },
    { kind: 'shelf', stand: { x: 16, y: 6 }, facing: 'up', fx: { x: 16, y: 4 }, duration: 4 },
  ],
  monitor: {
    offTopLeftGid: 365,
    onGids: [
      [367, 0, 0], [368, 1, 0],
      [383, 0, 1], [384, 1, 1],
    ],
  },
  palette: {
    // Terminal near-black, matching the HQ shell's dark ground — the old
    // warm plum (colors.ink[900]) fought the cool floor tint below.
    background: 0x141414,
    noteColors: { todo: 0xf2df8a, doing: 0x9ecbf0, blocked: 0xf0a3a3, done: 0xa8e0b0 },
    // Cool slate ground: multiplied onto the two-color sitcom-green floor
    // tiles (and, softer, the walls) BEFORE the world's saturate(-0.3),
    // landing the floor near #707885 graphite.
    ground: { floorTint: 0xbdb5e9, wallTint: 0xd0cce6 },
  },
  cast: {
    byName: CAST_BY_NAME as Record<string, CastMember>,
    getFrames: (name: string) => getCastFrames(name as OfficeCharacterName),
    defaultCharacter: DEFAULT_CHARACTER,
  },
};

/** All registered themes: the office. */
export const THEMES: Partial<Record<ThemeId, ThemeConfig>> = {
  office: OFFICE_THEME,
};

/** Look up a theme by id, falling back to the office theme if unknown/missing
 *  (a bad/absent show bundle must never break the floor — see report §E). */
export function getTheme(id: ThemeId): ThemeConfig {
  return THEMES[id] ?? OFFICE_THEME;
}
