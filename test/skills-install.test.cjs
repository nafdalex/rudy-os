'use strict';

/**
 * Install/uninstall guards.
 *
 * These bound real damage. Install writes files the user did not author into a
 * directory their agents load from; uninstall deletes directories. Both are
 * driven by a public list anyone can open a PR against, so the REFUSALS are the
 * feature — each test below is a way the app could have destroyed or executed
 * something it should not have.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { parseGitHubSourceUrl, safeSkillDirName, uninstallSkill } =
  loadTs('src/main/skills.ts');

const tmpdir = (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'md-skill-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
};

test('a GitHub tree URL is split into owner/repo/ref/path', () => {
  assert.deepEqual(
    parseGitHubSourceUrl('https://github.com/monbossb/agent-skills/tree/main/skills/monbossb-mcp-setup'),
    { owner: 'monbossb', repo: 'agent-skills', ref: 'main', path: 'skills/monbossb-mcp-setup' }
  );
  assert.equal(parseGitHubSourceUrl('https://officialskills.sh/monbossb/skills/x'), null);
  // A repo ROOT is also a valid source — 81 catalog entries are shaped that way.
  assert.deepEqual(parseGitHubSourceUrl('https://github.com/zarazhangrui/frontend-slides'),
    { owner: 'zarazhangrui', repo: 'frontend-slides', ref: '', path: '' });
  assert.equal(parseGitHubSourceUrl('https://github.com/orgs/anthropics'), null);
});

test('a skill folder name that could escape its directory is refused', () => {
  assert.equal(safeSkillDirName('redis-development'), 'redis-development');
  assert.equal(safeSkillDirName('skills/redis-development'), 'redis-development');
  for (const bad of ['..', '.', '', '.hidden', 'x y', '-leading', 'a b/../c d']) {
    assert.equal(safeSkillDirName(bad), null, 'must refuse ' + JSON.stringify(bad));
  }
  // A traversal reduces to its LAST segment, which is a plain, safe folder name —
  // the caller joins it onto the skills root, so there is nothing left to escape.
  assert.equal(safeSkillDirName('a/../../b'), 'b');
});

test('uninstall refuses anything outside a managed skills root', (t) => {
  const tmp = tmpdir(t);
  const victim = path.join(tmp, 'important-work');
  fs.mkdirSync(victim, { recursive: true });
  const res = uninstallSkill(victim, { cwds: [] });
  assert.equal(res.ok, false);
  assert.match(res.error, /not inside a skills directory/i);
  assert.ok(fs.existsSync(victim), 'the folder must still be there');
});

test('uninstall refuses a folder inside a skills root with no SKILL.md', (t) => {
  const tmp = tmpdir(t);
  const notASkill = path.join(tmp, '.claude', 'skills', 'src');
  fs.mkdirSync(notASkill, { recursive: true });
  fs.writeFileSync(path.join(notASkill, 'index.ts'), 'export {}');
  const res = uninstallSkill(notASkill, { cwds: [tmp] });
  assert.equal(res.ok, false);
  assert.match(res.error, /SKILL/i);
  assert.ok(fs.existsSync(notASkill));
});

test('uninstall removes a real skill folder inside a project root', (t) => {
  const tmp = tmpdir(t);
  const skill = path.join(tmp, '.claude', 'skills', 'demo');
  fs.mkdirSync(skill, { recursive: true });
  fs.writeFileSync(path.join(skill, 'SKILL.md'), '---\nname: demo\n---\n');
  assert.equal(uninstallSkill(skill, { cwds: [tmp] }).ok, true);
  assert.ok(!fs.existsSync(skill));
});

test('uninstall will not delete the skills root itself', (t) => {
  const tmp = tmpdir(t);
  const root = path.join(tmp, '.claude', 'skills');
  fs.mkdirSync(root, { recursive: true });
  assert.equal(uninstallSkill(root, { cwds: [tmp] }).ok, false);
  assert.ok(fs.existsSync(root));
});
