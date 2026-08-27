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
const { parseCatalogMarkdown, parseSkillFrontmatter } = loadTs('src/main/skills.ts');

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
