'use strict';

/**
 * The hero payload is REMOTE data that renders in Settings. It is fetched from a
 * file in this repo, so the trust level is "whatever is on main" — which is high,
 * but not high enough to render unvalidated, because the failure modes are silent:
 * a typo'd URL becomes a dead button, an unbounded string wrecks the dialog, and
 * a malformed edit could blank the card for every user at once.
 *
 * So the parser is total — it never throws and always returns something
 * renderable — and these pin that.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');
const { parseHeroPayload, DEFAULT_HERO } = loadTs('src/shared/heroPayload.ts');

test('a well-formed payload comes through intact', () => {
  const h = parseHeroPayload({
    plan: { label: 'Pro', blurb: 'Extra things.', upgrade: { label: 'Upgrade', url: 'https://example.com/pro' } },
    sponsor: { name: 'Acme', blurb: 'They paid.', url: 'https://acme.example' },
    notice: 'Scheduled maintenance Friday.'
  });
  assert.equal(h.plan.label, 'Pro');
  assert.deepEqual(h.plan.upgrade, { label: 'Upgrade', url: 'https://example.com/pro' });
  assert.equal(h.sponsor.name, 'Acme');
  assert.equal(h.notice, 'Scheduled maintenance Friday.');
});

test('garbage of every shape degrades to the built-in defaults', () => {
  for (const bad of [null, undefined, 42, 'a string', [], { plan: 'not an object' }]) {
    const h = parseHeroPayload(bad);
    assert.equal(h.plan.label, DEFAULT_HERO.plan.label, `for ${JSON.stringify(bad)}`);
    assert.equal(h.sponsor, null);
  }
});

test('one broken field does not cost the user the rest of the card', () => {
  const h = parseHeroPayload({
    plan: { label: 'Pro', blurb: 'Extra things.' },
    sponsor: { name: 'Acme' }   // no url → not renderable
  });
  assert.equal(h.plan.label, 'Pro', 'the plan survives a broken sponsor');
  assert.equal(h.sponsor, null);
});

test('non-https URLs are refused, so a bad link never renders as a button', () => {
  for (const url of ['http://example.com', 'javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,x', 'not a url']) {
    const h = parseHeroPayload({ plan: { label: 'P', blurb: 'b', upgrade: { label: 'Go', url } } });
    assert.equal(h.plan.upgrade, undefined, `must refuse ${url}`);
    const s = parseHeroPayload({ sponsor: { name: 'A', blurb: 'b', url } });
    assert.equal(s.sponsor, null, `must refuse sponsor ${url}`);
  }
});

test('an upgrade needs BOTH a label and a destination', () => {
  assert.equal(parseHeroPayload({ plan: { upgrade: { url: 'https://x.example' } } }).plan.upgrade, undefined);
  assert.equal(parseHeroPayload({ plan: { upgrade: { label: 'Go' } } }).plan.upgrade, undefined);
});

test('overlong strings are capped rather than allowed to wreck the dialog', () => {
  const h = parseHeroPayload({
    plan: { label: 'x'.repeat(500), blurb: 'y'.repeat(5000) },
    notice: 'z'.repeat(5000)
  });
  assert.ok(h.plan.label.length <= 24, `label was ${h.plan.label.length}`);
  assert.ok(h.plan.blurb.length <= 240);
  assert.ok(h.notice.length <= 160);
  assert.ok(h.plan.label.endsWith('…'), 'truncation is visible, not silent');
});

test('empty and whitespace-only strings fall back rather than rendering blank', () => {
  const h = parseHeroPayload({ plan: { label: '   ', blurb: '' }, notice: '  ' });
  assert.equal(h.plan.label, DEFAULT_HERO.plan.label);
  assert.equal(h.plan.blurb, DEFAULT_HERO.plan.blurb);
  assert.equal(h.notice, null);
});

test('unknown fields are ignored, so adding one later cannot break older builds', () => {
  const h = parseHeroPayload({ plan: { label: 'P', blurb: 'b' }, futureThing: { a: 1 }, banner: '<script>' });
  assert.equal(h.plan.label, 'P');
  assert.equal(Object.keys(h).sort().join(','), 'notice,plan,sponsor');
});

test('the shipped docs/hero.json parses to a renderable payload', () => {
  const raw = JSON.parse(require('node:fs').readFileSync('docs/hero.json', 'utf8'));
  const h = parseHeroPayload(raw);
  assert.ok(h.plan.label && h.plan.blurb, 'the file we actually ship must render');
});
