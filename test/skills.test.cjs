'use strict';

/**
 * The skills catalog is parsed out of a hand-maintained README with no machine
 * index, so its shape is a moving target owned by someone else. These pin the
 * failures that would be SILENT: entries that stop parsing (an empty tab that
 * reads as "no skills exist") and non-entry rows leaking in as skills.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');
const {
  parseCatalogMarkdown, parseSkillFrontmatter, mergeCatalogs, resolveBatches, unattributedRows
} = loadTs('src/main/skills.ts');

const MD = [
  '## 📈 Overview',
  '',
  '| Category | Skills |',        // the overview table — counts, not skills
  '|----------|--------|',
  '| 💻 Development & Code Tools | 74 |',
  '',
  '## 📄 Document Skills',
  '',
  '| Name | Description | Link |',
  '|------|-------------|------|',
  '| **docx** | Create and edit Word documents | [Source](https://github.com/anthropics/skills/tree/main/skills/docx) |',
  '| **pdf** | Extract content from PDFs | [Source](https://github.com/anthropics/skills/tree/main/skills/pdf) |',
  '',
  '## 🎨 Creative & Design',
  '',
  '| Name | Description | Link |',
  '|------|-------------|------|',
  '| **frontend-slides** | Build slide decks | [Source](https://github.com/zarazhangrui/frontend-slides) |'
].join('\n');

test('table rows parse into name, description, url and category', () => {
  const s = parseCatalogMarkdown(MD);
  assert.equal(s.length, 3);
  assert.equal(s[0].name, 'docx');
  assert.equal(s[0].description, 'Create and edit Word documents');
  assert.equal(s[0].url, 'https://github.com/anthropics/skills/tree/main/skills/docx');
  assert.equal(s[0].category, 'Document Skills');
});

test('the category emoji is stripped but the words are kept intact', () => {
  const s = parseCatalogMarkdown(MD);
  assert.equal(s[2].category, 'Creative & Design');
  assert.ok(!s.some((x) => x.category.includes('📄')));
});

test('publisher comes from the GitHub owner, since names here are bare', () => {
  const s = parseCatalogMarkdown(MD);
  assert.equal(s[0].owner, 'anthropics');
  assert.equal(s[2].owner, 'zarazhangrui');
});

test('the overview counts table does not leak in as skills', () => {
  const s = parseCatalogMarkdown(MD);
  // "74" is a count, not a skill, and its row carries no link.
  assert.ok(!s.some((x) => x.description === '74'));
  assert.ok(!s.some((x) => x.name.includes('Development & Code Tools')));
});

test('header rows and separator rules are skipped', () => {
  const s = parseCatalogMarkdown(MD);
  assert.ok(!s.some((x) => x.name === 'Name'));
  assert.ok(!s.some((x) => /^-+$/.test(x.name)));
});

test('a row without a resolvable link is dropped rather than guessed at', () => {
  const s = parseCatalogMarkdown(['## X', '| **orphan** | no link at all | TBD |'].join('\n'));
  assert.equal(s.length, 0);
});

test('SKILL.md frontmatter reads a multi-line block description whole', () => {
  const fm = parseSkillFrontmatter([
    '---',
    'name: rudy-audit',
    'description: |',
    '  Read-only code quality audit — scan the cwd',
    '  and return a prioritised report.',
    'version: 1.0.0',
    '---',
    '# body'
  ].join('\n'));
  assert.equal(fm.name, 'rudy-audit');
  assert.match(fm.description, /scan the cwd and return a prioritised report/);
});

test('inline frontmatter description and absent frontmatter both behave', () => {
  assert.equal(parseSkillFrontmatter('---\nname: x\ndescription: one liner\n---').description, 'one liner');
  assert.deepEqual(parseSkillFrontmatter('# no frontmatter'), {});
});

/* ── Multiple sources ───────────────────────────────────────────────────────
 *
 * Browse merges a curated README with repositories whose own folders are the
 * skills. The failure that would be SILENT here is a source quietly erasing
 * another's rows, or the same skill listed twice because two lists carry it.
 */

const row = (name, url, extra = {}) => ({
  name, url, description: `${name} does things`, category: 'Skills', owner: 'someone', ...extra
});

test('sources merge in declared order and keep every distinct skill', () => {
  const merged = mergeCatalogs([
    [row('docx', 'https://github.com/anthropics/skills/tree/main/skills/docx')],
    [row('greploop', 'https://github.com/michaelshimeles/skills/tree/main/greploop')]
  ]);
  assert.deepEqual(merged.map((s) => s.name), ['docx', 'greploop']);
});

test('the same skill in two sources yields one row, first source winning', () => {
  const url = 'https://github.com/michaelshimeles/skills/tree/main/greploop';
  const merged = mergeCatalogs([
    [row('greploop', url, { category: 'Engineering workflow' })],
    [row('GrepLoop', url, { category: 'Other' })]
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].category, 'Engineering workflow');
});

test('same name at a different url is a different skill, not a duplicate', () => {
  const merged = mergeCatalogs([
    [row('pdf', 'https://github.com/anthropics/skills/tree/main/skills/pdf')],
    [row('pdf', 'https://github.com/someone-else/skills/tree/main/pdf')]
  ]);
  assert.equal(merged.length, 2);
});

test('an empty source cannot erase the sources around it', () => {
  const merged = mergeCatalogs([[], [row('docx', 'https://github.com/a/b/tree/main/docx')], []]);
  assert.deepEqual(merged.map((s) => s.name), ['docx']);
});

/* ── A source going down ────────────────────────────────────────────────────
 *
 * The silent failure this pins: one source failing while another answers used
 * to hand Browse the shorter list AND cache it as current, so the failed
 * source's skills disappeared for a day even after it came back.
 */

const SOURCES = [{ url: 'https://example.com/curated.md' }, { url: 'https://github.com/someone/skills' }];

test('a failed source keeps its last-known rows instead of vanishing', () => {
  const cachedBySource = {
    'https://github.com/someone/skills': [row('greploop', 'https://github.com/someone/skills/tree/main/greploop')]
  };
  const batches = resolveBatches(
    SOURCES,
    [{ skills: [row('docx', 'https://github.com/anthropics/skills/tree/main/skills/docx')] }, { skills: [], error: 'rate limited' }],
    cachedBySource
  );
  const merged = mergeCatalogs(SOURCES.map((s) => batches[s.url]));
  assert.deepEqual(merged.map((s) => s.name), ['docx', 'greploop']);
});

test('a source that answers replaces its cached rows rather than merging with them', () => {
  const batches = resolveBatches(
    [SOURCES[1]],
    [{ skills: [row('new-feature', 'https://github.com/someone/skills/tree/main/new-feature')] }],
    { 'https://github.com/someone/skills': [row('retired', 'https://github.com/someone/skills/tree/main/retired')] }
  );
  assert.deepEqual(batches[SOURCES[1].url].map((s) => s.name), ['new-feature']);
});

test('a source that fails with nothing cached contributes nothing, not a crash', () => {
  const batches = resolveBatches([SOURCES[1]], [{ skills: [], error: 'offline' }], undefined);
  assert.deepEqual(batches[SOURCES[1].url], []);
});

/* ── The upgrade window ───────────────────────────────────────────────────────
 *
 * Attribution is new. Every cache written before it holds the rows and no idea
 * which source each came from, so the first refresh after an upgrade is the one
 * moment carry-forward has nothing to carry — and a source failing exactly then
 * would drop its skills anyway. These pin the narrow rescue and, just as much,
 * its narrowness.
 */

const LEGACY = {
  skills: [
    row('docx', 'https://github.com/anthropics/skills/tree/main/skills/docx'),
    row('greploop', 'https://github.com/someone/skills/tree/main/greploop')
  ]
};

test('an upgrade cache rescues a failed source that has nothing attributed', () => {
  const bySource = resolveBatches(
    SOURCES,
    [{ skills: [row('docx', 'https://github.com/anthropics/skills/tree/main/skills/docx')] }, { skills: [], error: 'rate limited' }],
    undefined
  );
  const merged = mergeCatalogs([
    ...SOURCES.map((s) => bySource[s.url]),
    unattributedRows(SOURCES, bySource, LEGACY, true)
  ]);
  assert.deepEqual(merged.map((s) => s.name), ['docx', 'greploop']);
});

test('the rescued rows go last, so a source that answered still wins', () => {
  const fresh = row('docx', 'https://github.com/anthropics/skills/tree/main/skills/docx');
  fresh.description = 'the current description';
  const bySource = resolveBatches(SOURCES, [{ skills: [fresh] }, { skills: [], error: 'offline' }], undefined);
  const merged = mergeCatalogs([
    ...SOURCES.map((s) => bySource[s.url]),
    unattributedRows(SOURCES, bySource, LEGACY, true)
  ]);
  assert.equal(merged.find((s) => s.name === 'docx').description, 'the current description');
});

test('a clean refresh never resurrects a row an upgrade cache still holds', () => {
  const bySource = resolveBatches(
    SOURCES,
    [{ skills: [row('docx', 'https://github.com/anthropics/skills/tree/main/skills/docx')] }, { skills: [] }],
    undefined
  );
  assert.deepEqual(unattributedRows(SOURCES, bySource, LEGACY, false), []);
});

test('a cache that carries attribution does not fall back to its flat list', () => {
  const cached = { skills: LEGACY.skills, bySource: { 'https://github.com/someone/skills': [] } };
  const bySource = resolveBatches(SOURCES, [{ skills: [] }, { skills: [], error: 'offline' }], cached.bySource);
  assert.deepEqual(unattributedRows(SOURCES, bySource, cached, true), []);
});

test('no cache at all leaves a failed source with nothing to rescue', () => {
  const bySource = resolveBatches(SOURCES, [{ skills: [] }, { skills: [], error: 'offline' }], undefined);
  assert.deepEqual(unattributedRows(SOURCES, bySource, null, true), []);
});
