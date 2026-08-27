'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const {
  sanitizeTerminalSelection,
  stripLeadingRail
} = loadTs('src/renderer/src/components/terminalSelection.ts');

test('the reported paste: Claude Code blockquote rail is dropped', () => {
  assert.equal(
    sanitizeTerminalSelection('▎ Rudy OS — clones for you and your team, working 24/7.'),
    'Rudy OS — clones for you and your team, working 24/7.'
  );
});

test('every line of a multi-line quote loses its rail', () => {
  const copied = [
    '▎ Rudy OS is live on Product Hunt today.',
    '▎',
    '▎ Free, open source, local-first.'
  ].join('\n');
  assert.equal(sanitizeTerminalSelection(copied), [
    'Rudy OS is live on Product Hunt today.',
    '',
    'Free, open source, local-first.'
  ].join('\n'));
});

test('indent survives, nested rails do not', () => {
  assert.equal(stripLeadingRail('  ▎ indented quote'), '  indented quote');
  assert.equal(stripLeadingRail('▎ ▎ nested quote'), 'nested quote');
  assert.equal(stripLeadingRail('\t▏ tab-indented'), '\ttab-indented');
});

test('CRLF selections keep their carriage return', () => {
  assert.equal(sanitizeTerminalSelection('▎ line one\r\n▎\r\n▎ line two\r\n'),
    'line one\r\n\r\nline two\r\n');
});

test('block art and bar charts are left alone (bars run together)', () => {
  assert.equal(sanitizeTerminalSelection('▌▌▌▌ 40%'), '▌▌▌▌ 40%');
  assert.equal(sanitizeTerminalSelection('█▉▊▋▌ gradient'), '█▉▊▋▌ gradient');
});

test('box drawing is never touched — tree/graph output must paste intact', () => {
  const tree = ['├── src', '│   └── main', '└── test'].join('\n');
  assert.equal(sanitizeTerminalSelection(tree), tree);
  assert.equal(sanitizeTerminalSelection('┃ heavy vertical'), '┃ heavy vertical');
  assert.equal(sanitizeTerminalSelection('| pipe table |'), '| pipe table |');
});

test('a mixed selection strips only the rail, never the tree indent', () => {
  // The tree lines must survive even though the selection DOES contain a rail,
  // so this walks the regex instead of the "no rail anywhere" fast path.
  const copied = ['▎ the layout is:', '├── src', '│   └── main', '└── test'].join('\n');
  assert.equal(sanitizeTerminalSelection(copied),
    ['the layout is:', '├── src', '│   └── main', '└── test'].join('\n'));
});

test('a rail in the middle of a line is content, not a gutter', () => {
  assert.equal(sanitizeTerminalSelection('press ▎ to quit'), 'press ▎ to quit');
});

test('ordinary prose is returned byte-for-byte', () => {
  const prose = 'npm run test:focused   # 154 passing\n  indented line\n';
  assert.equal(sanitizeTerminalSelection(prose), prose);
  assert.equal(sanitizeTerminalSelection(''), '');
});

test('a rail-only selection sanitizes to nothing', () => {
  assert.equal(sanitizeTerminalSelection('▎'), '');
  assert.equal(sanitizeTerminalSelection('▎ '), '');
});
