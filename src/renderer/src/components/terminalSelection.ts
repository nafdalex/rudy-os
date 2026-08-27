/**
 * Copy hygiene for terminal selections.
 *
 * Agent CLIs paint their decoration INTO the character grid. Claude Code draws
 * a markdown blockquote as `▎ text`, so the rail is a real cell on that line —
 * not a border drawn beside it. Selecting the line (which is exactly what a
 * triple-click or a full-width drag does) therefore copies the rail with the
 * prose, and the paste lands as:
 *
 *     ▎ Rudy OS — clones for you and your team, working 24/7.
 *
 * Nothing downstream wants that glyph, so strip it on the way to the clipboard.
 *
 * The guard that stops this from eating real content: a rail only counts when a
 * space follows it or it ends the line — the shape a quote gutter always has. A
 * bar chart (`▌▌▌▌ 40%`) or block art keeps its bars because they run together.
 *
 * Deliberately narrow. Only the left/right BLOCK elements CLIs use as a gutter
 * are in the set; box-drawing verticals (`│`, `┃`) are not. `tree`, `git log
 * --graph` and every framed table indent continuation lines with `│   `, and
 * stripping that would corrupt far more copies than it would fix.
 */

/** ▌ ▍ ▎ ▏ (left half → left one-eighth) and ▐ ▕ (right half, right eighth). */
const RAIL_CHARS = '▌▍▎▏▐▕';

/** Leading indent, then one or more `rail + space` / `rail + end-of-line` runs.
 *  Nested quotes render as `▎ ▎ text`, hence the repeat. */
const LEADING_RAIL = new RegExp(`^([ \\t]*)(?:[${RAIL_CHARS}](?: |(?=\\r?$)))+`);

const ANY_RAIL = new RegExp(`[${RAIL_CHARS}]`);

/** Drop a quote/gutter rail from the start of a single line, keeping its indent. */
export function stripLeadingRail(line: string): string {
  return line.replace(LEADING_RAIL, '$1');
}

/**
 * Clean a terminal selection for the clipboard: per line, drop the gutter rail
 * the CLI painted into column 0. Everything else — indentation, box drawing,
 * inline glyphs — is left byte-for-byte alone.
 */
export function sanitizeTerminalSelection(text: string): string {
  // The overwhelming majority of copies contain no rail at all; skip the split.
  if (!text || !ANY_RAIL.test(text)) return text;
  return text.split('\n').map(stripLeadingRail).join('\n');
}
