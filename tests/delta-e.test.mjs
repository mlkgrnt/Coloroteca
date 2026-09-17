import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  deltaE2000,
  deltaE76,
  deltaE94,
  createDeltaE,
  deltaGrade,
  deltaBreakdown,
  klForSystem,
} from '../core/delta-e.js';

const here = dirname(fileURLToPath(import.meta.url));
const sharma = JSON.parse(
  readFileSync(join(here, 'sharma-ciede2000.json'), 'utf8')
);

test('CIEDE2000 agrees with all 34 official Sharma pairs', () => {
  const failures = [];
  for (const p of sharma.pairs) {
    const actual = deltaE2000(p.lab1, p.lab2);
    if (Math.abs(actual - p.expected) > sharma.tolerance) {
      failures.push(
        `  #${p.id}: expected ${p.expected}, got ${actual.toFixed(8)}` +
          (p.comment ? `  [${p.comment}]` : '')
      );
    }
  }
  assert.equal(
    failures.length,
    0,
    `${failures.length}/${sharma.pairs.length} pairs failed:\n${failures.join('\n')}`
  );
});

test('CIEDE2000 is symmetric', () => {
  for (const p of sharma.pairs) {
    const ab = deltaE2000(p.lab1, p.lab2);
    const ba = deltaE2000(p.lab2, p.lab1);
    assert.ok(
      Math.abs(ab - ba) < 1e-12,
      `pair #${p.id} asymmetric: ${ab} vs ${ba}`
    );
  }
});

test('CIEDE2000 of a colour against itself is zero', () => {
  for (const p of sharma.pairs) {
    assert.equal(deltaE2000(p.lab1, p.lab1), 0);
    assert.equal(deltaE2000(p.lab2, p.lab2), 0);
  }
});

test('CIEDE2000 handles the achromatic origin without NaN', () => {
  assert.equal(deltaE2000([50, 0, 0], [50, 0, 0]), 0);
  assert.ok(Number.isFinite(deltaE2000([50, 0, 0], [50, 1, 1])));
  assert.ok(Number.isFinite(deltaE2000([50, 0, 0], [73, 25, -18])));
});

test('kL weighting scales the lightness term only', () => {
  const pureLightness = [[50, 0, 0], [60, 0, 0]];
  const withKL1 = deltaE2000(pureLightness[0], pureLightness[1], { kL: 1 });
  const withKL2 = deltaE2000(pureLightness[0], pureLightness[1], { kL: 2 });
  assert.ok(
    Math.abs(withKL2 * 2 - withKL1) < 1e-12,
    'doubling kL should halve a pure-lightness difference'
  );

  const pureChroma = [[50, 10, 0], [50, 20, 0]];
  assert.equal(
    deltaE2000(pureChroma[0], pureChroma[1], { kL: 1 }),
    deltaE2000(pureChroma[0], pureChroma[1], { kL: 2 }),
    'kL must not affect a difference with no lightness component'
  );
});

test('createDeltaE returns a reusable function for each formula', () => {
  const a = [50, 2.6772, -79.7751];
  const b = [50, 0, -82.7485];
  assert.equal(createDeltaE()(a, b), deltaE2000(a, b));
  assert.equal(createDeltaE({ formula: 'CIE76' })(a, b), deltaE76(a, b));
  assert.equal(createDeltaE({ formula: 'CIE94' })(a, b), deltaE94(a, b));
});

test('klForSystem maps textile systems to kL = 2', () => {
  assert.equal(klForSystem('TCX'), 2);
  assert.equal(klForSystem('TPG'), 2);
  assert.equal(klForSystem('PMS'), 1);
  assert.equal(klForSystem(undefined), 1);
});

test('deltaGrade thresholds follow the CIEDE2000 scale', () => {
  assert.equal(deltaGrade(0.4).level, 'imperceptible');
  assert.equal(deltaGrade(0.99).level, 'imperceptible');
  assert.equal(deltaGrade(1.0).level, 'trained');
  assert.equal(deltaGrade(2.0).level, 'noticeable');
  assert.equal(deltaGrade(3.5).level, 'distinct');
  assert.equal(deltaGrade(9).level, 'different');
});

test('deltaBreakdown isolates lightness, chroma and hue terms', () => {
  const bd = deltaBreakdown([50, 0, 0], [60, 0, 0]);
  assert.equal(bd.dL, 10);
  assert.equal(bd.dC, 0);
  assert.equal(bd.dH, 0);

  const chroma = deltaBreakdown([50, 10, 0], [50, 20, 0]);
  assert.equal(chroma.dL, 0);
  assert.equal(chroma.dC, 10);
});
