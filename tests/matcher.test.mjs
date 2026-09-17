import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  CLF_FORMAT,
  createLibrary,
  validateLibrary,
  normalizeLibrary,
  displayCode,
  librarySummary,
  slugify,
} from '../core/clf.js';

import {
  matchColor,
  matchBatch,
  prepareLibrary,
  matchPrepared,
  lookupByCode,
  resolveInput,
} from '../core/matcher.js';

const here = dirname(fileURLToPath(import.meta.url));
const load = (p) => JSON.parse(readFileSync(join(here, '..', p), 'utf8'));

const wheel = load('data/demo/demo-wheel.clf.json');
const traditional = load('data/demo/chinese-traditional.clf.json');

// ------------------------------------------------------------------- CLF

test('the shipped demo libraries are valid CLF documents', () => {
  for (const lib of [wheel, traditional]) {
    const v = validateLibrary(lib);
    assert.deepEqual(v.errors, [], `${lib.id} errors`);
    assert.equal(v.valid, true);
    assert.equal(v.stats.dropped, 0, `${lib.id} dropped entries`);
    assert.equal(v.stats.total, lib.meta.colorCount);
  }
});

test('validateLibrary rejects documents that are not CLF', () => {
  assert.equal(validateLibrary(null).valid, false);
  assert.equal(validateLibrary([]).valid, false);
  assert.equal(validateLibrary({}).valid, false);
  assert.equal(validateLibrary({ format: 'something-else', colors: [] }).valid, false);
});

test('validateLibrary warns rather than fails on soft problems', () => {
  const doc = {
    format: CLF_FORMAT,
    version: '1.0',
    id: 'x',
    meta: { name: 'X', colorCount: 99, source: 't', license: 'MIT' },
    colors: [{ code: 'a', hex: '#ffffff' }],
  };
  const v = validateLibrary(doc);
  assert.equal(v.valid, true);
  assert.ok(v.warnings.some((w) => w.includes('colorCount')));
});

test('validateLibrary reports unusable colour entries', () => {
  const doc = {
    format: CLF_FORMAT,
    version: '1.0',
    id: 'x',
    meta: { name: 'X', source: 't', license: 'MIT' },
    colors: [{ code: 'ok', hex: '#ffffff' }, { code: 'bad', hex: 'nope' }],
  };
  const v = validateLibrary(doc);
  assert.equal(v.valid, true);
  assert.equal(v.stats.usable, 1);
  assert.equal(v.stats.dropped, 1);
});

test('createLibrary fills defaults and counts colours', () => {
  const lib = createLibrary({
    name: 'My Test Library',
    colors: [{ code: '1', hex: '#FF0000' }],
  });
  assert.equal(lib.format, CLF_FORMAT);
  assert.equal(lib.version, '1.0');
  assert.equal(lib.id, 'my-test-library');
  assert.equal(lib.meta.colorCount, 1);
  assert.equal(lib.meta.system, 'CUSTOM');
  assert.equal(lib.meta.license, 'unknown');
  assert.equal(lib.colors[0].hex, '#ff0000');
  assert.deepEqual(lib.colors[0].rgb, [255, 0, 0]);
});

test('createLibrary drops entries with no usable colour', () => {
  const lib = createLibrary({
    name: 'Partial',
    colors: [{ code: 'a', hex: '#ffffff' }, { code: 'b', hex: 'zzzzzz' }],
  });
  assert.equal(lib.colors.length, 1);
  assert.equal(lib.meta.colorCount, 1);
});

test('normalizeLibrary coerces an arbitrary document and reports drops', () => {
  const { library, dropped, warnings } = normalizeLibrary({
    id: 'raw',
    meta: { name: 'Raw', system: 'tcx' },
    colors: [
      { code: '1', hex: '#abcdef' },
      { code: '2', hex: null },
    ],
  });
  assert.equal(library.format, CLF_FORMAT);
  assert.equal(library.meta.system, 'TCX');
  assert.equal(library.colors.length, 1);
  assert.equal(dropped, 1);
  assert.equal(warnings.length, 1);
});

test('displayCode composes prefix, code and suffix once', () => {
  assert.equal(displayCode({ code: '185' }, { prefix: 'PANTONE', suffix: 'C' }), 'PANTONE 185 C');
  assert.equal(displayCode({ code: '015-50' }, { prefix: 'DEMO' }), 'DEMO 015-50');
  assert.equal(displayCode({ code: 'x' }, {}), 'x');
  assert.equal(
    displayCode({ code: 'ignored', displayName: 'Explicit' }, { prefix: 'P' }),
    'Explicit'
  );
});

test('source Lab values survive normalisation', () => {
  const lib = createLibrary({
    name: 'L',
    colors: [{ code: 'a', hex: '#ff0000', lab: [50, 0, 0], cmyk: [0, 100, 100, 0] }],
  });
  assert.deepEqual(lib.colors[0].lab, [50, 0, 0]);
  assert.deepEqual(lib.colors[0].cmyk, [0, 100, 100, 0]);
});

test('slugify keeps CJK and strips decoration', () => {
  assert.equal(slugify('PANTONE Solid Coated'), 'pantone-solid-coated');
  assert.equal(slugify('  中国传统色  '), '中国传统色');
});

// --------------------------------------------------------------- matching

test('an exact library colour matches itself with ~zero distance', () => {
  for (const idx of [0, 40, 82]) {
    const probe = wheel.colors[idx];
    const r = matchColor(probe.hex, wheel, { top: 1 });
    assert.equal(r.matches[0].hex, probe.hex);
    assert.ok(r.matches[0].deltaE < 0.01, `expected ~0, got ${r.matches[0].deltaE}`);
  }
});

test('matches come back sorted by ascending delta E', () => {
  const r = matchColor('#ff6b6b', wheel, { top: 8 });
  assert.equal(r.matches.length, 8);
  for (let i = 1; i < r.matches.length; i++) {
    assert.ok(
      r.matches[i].deltaE >= r.matches[i - 1].deltaE,
      `rank ${i} (${r.matches[i].deltaE}) < rank ${i - 1} (${r.matches[i - 1].deltaE})`
    );
  }
  assert.equal(r.matches[0].rank, 1);
});

test('results carry the perceptual grade and a component breakdown', () => {
  const r = matchColor('#ff6b6b', wheel, { top: 3 });
  const m = r.matches[0];
  assert.ok(m.grade.label.length > 0);
  assert.ok(['imperceptible', 'trained', 'noticeable', 'distinct', 'different'].includes(m.grade.level));
  for (const k of ['dL', 'dC', 'dH', 'dE76']) {
    assert.equal(typeof m.breakdown[k], 'number', `breakdown.${k}`);
  }
});

test('top-N is clamped to the library size', () => {
  const tiny = createLibrary({
    name: 'Tiny',
    colors: [{ code: 'a', hex: '#000000' }, { code: 'b', hex: '#ffffff' }],
  });
  const r = matchColor('#808080', tiny, { top: 50 });
  assert.equal(r.matches.length, 2);
});

test('threshold filters out distant candidates', () => {
  const r = matchColor('#ff0000', wheel, { top: 20, threshold: 1 });
  for (const m of r.matches) assert.ok(m.deltaE <= 1);
});

test('kL is derived from the library system', () => {
  const tcx = createLibrary({
    name: 'Textile',
    system: 'TCX',
    colors: [{ code: '1', hex: '#ff0000' }],
  });
  const derived = matchColor('#ff0000', tcx);
  assert.equal(derived.settings.kL, 2);
  assert.equal(derived.settings.kLSource, 'derived-from-system');

  const pms = createLibrary({
    name: 'Graphic',
    system: 'PMS',
    colors: [{ code: '1', hex: '#ff0000' }],
  });
  assert.equal(matchColor('#ff0000', pms).settings.kL, 1);

  const explicit = matchColor('#ff0000', tcx, { kL: 1 });
  assert.equal(explicit.settings.kL, 1);
  assert.equal(explicit.settings.kLSource, 'explicit');
});

test('kL changes the ranking of lightness-different candidates', () => {
  const lib = createLibrary({
    name: 'Pair',
    colors: [
      { code: 'darker', hex: '#8b0000' },
      { code: 'palersame', hex: '#ff0000' },
    ],
  });
  const graphic = matchColor('#b30000', lib, { top: 2, kL: 1 });
  const textile = matchColor('#b30000', lib, { top: 2, kL: 2 });
  assert.equal(graphic.settings.kL, 1);
  assert.equal(textile.settings.kL, 2);
  // both must still return a full ranking without error
  assert.equal(graphic.matches.length, 2);
  assert.equal(textile.matches.length, 2);
});

test('a source Lab value wins over the entry hex', () => {
  const lib = createLibrary({
    name: 'LabPriority',
    colors: [{ code: 'A', hex: '#ff0000', lab: [50, 0, 0] }],
  });
  const r = matchColor({ lab: [50, 0, 0] }, lib, { top: 1 });
  assert.ok(
    r.matches[0].deltaE < 1e-9,
    `expected the stored Lab to be used, got deltaE ${r.matches[0].deltaE}`
  );
});

test('prepareLibrary plus matchPrepared equals matchColor', () => {
  const prepared = prepareLibrary(wheel);
  const viaPrepared = matchPrepared(prepared, resolveInput('#3a7bd5'), { top: 5 });
  const viaHelper = matchColor('#3a7bd5', wheel, { top: 5 });
  assert.deepEqual(viaPrepared.matches, viaHelper.matches);
});

test('matchBatch agrees with individual matches and reports bad input', () => {
  const inputs = ['#ff6b6b', 'rgb(0,128,255)', 'not a colour', '18,52,86'];
  const batch = matchBatch(inputs, wheel, { top: 3 });
  assert.equal(batch.length, 4);
  assert.equal(batch[2].error, 'unparseable');
  assert.equal(batch[2].matches.length, 0);

  for (const idx of [0, 1, 3]) {
    const single = matchColor(inputs[idx], wheel, { top: 3 });
    assert.deepEqual(batch[idx].matches, single.matches, `input ${inputs[idx]}`);
  }
});

test('matching is deterministic across repeated runs', () => {
  const a = matchColor('#9b59b6', wheel, { top: 6 });
  const b = matchColor('#9b59b6', wheel, { top: 6 });
  assert.deepEqual(a.matches, b.matches);
});

test('CJK colour names are matched through lookupByCode', () => {
  const hit = lookupByCode(traditional, '胭脂');
  assert.ok(hit.length > 0, 'expected a hit for 胭脂');
  assert.equal(hit[0].code, '胭脂');
  assert.match(hit[0].hex, /^#[0-9a-f]{6}$/);
});

test('lookupByCode tolerates the decorative prefix and suffix', () => {
  const bare = lookupByCode(wheel, '015-50');
  const full = lookupByCode(wheel, 'DEMO 015-50');
  const lower = lookupByCode(wheel, 'demo 015-50');
  assert.equal(bare.length, 1);
  assert.deepEqual(bare, full);
  assert.deepEqual(bare, lower);
});

test('lookupByCode returns nothing for an unknown code', () => {
  assert.deepEqual(lookupByCode(wheel, 'no-such-code-xyz'), []);
  assert.deepEqual(lookupByCode(wheel, ''), []);
});

test('librarySummary exposes the provenance fields', () => {
  const s = librarySummary(traditional);
  assert.equal(s.id, 'chinese-traditional');
  assert.equal(s.license, 'MIT');
  assert.ok(s.source.includes('ancient-chinese-color'));
  assert.equal(s.count, 158);
});
