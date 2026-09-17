import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeHex,
  hexToRgb,
  rgbToHex,
  rgbToLab,
  labToRgb,
  hexToLab,
  labToHex,
  rgbToHsl,
  hslToRgb,
  labToLch,
  lchToLab,
  parseColorInput,
  srgbToLinear,
  linearToSrgb,
  isOutOfGamut,
  WHITE_D65,
} from '../core/color-space.js';

const closeTo = (actual, expected, tol, msg) =>
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `${msg ?? 'value'} expected ${expected}, got ${actual} (tol ${tol})`
  );

const labCloseTo = (actual, expected, tol, msg) => {
  for (let i = 0; i < 3; i++) {
    closeTo(actual[i], expected[i], tol, `${msg ?? 'lab'}[${i}]`);
  }
};

test('normalizeHex accepts the common spellings', () => {
  assert.equal(normalizeHex('#FF6B6B'), '#ff6b6b');
  assert.equal(normalizeHex('FF6B6B'), '#ff6b6b');
  assert.equal(normalizeHex('  #ff6b6b  '), '#ff6b6b');
  assert.equal(normalizeHex('#f00'), '#ff0000');
  assert.equal(normalizeHex('abc'), '#aabbcc');
  assert.equal(normalizeHex('#gg0000'), null);
  assert.equal(normalizeHex('#ff00'), null);
  assert.equal(normalizeHex(''), null);
  assert.equal(normalizeHex(null), null);
});

test('hex and rgb round-trip', () => {
  for (const hex of ['#000000', '#ffffff', '#ff6b6b', '#1a2b3c', '#e4002b']) {
    assert.equal(rgbToHex(hexToRgb(hex)), hex);
  }
});

test('the D65 white point maps to L* = 100', () => {
  labCloseTo(hexToLab('#ffffff'), [100, 0, 0], 1e-3, 'white');
});

test('black maps to the Lab origin', () => {
  labCloseTo(hexToLab('#000000'), [0, 0, 0], 1e-3, 'black');
});

test('primaries match published sRGB D65 values', () => {
  labCloseTo(hexToLab('#ff0000'), [53.2408, 80.0925, 67.2032], 0.01, 'red');
  labCloseTo(hexToLab('#00ff00'), [87.7347, -86.1827, 83.1793], 0.01, 'green');
  labCloseTo(hexToLab('#0000ff'), [32.297, 79.1875, -107.8602], 0.01, 'blue');
});

test('neutral greys have no chroma', () => {
  for (const g of ['#404040', '#808080', '#c0c0c0']) {
    const [, a, b] = hexToLab(g);
    closeTo(a, 0, 1e-3, `${g} a*`);
    closeTo(b, 0, 1e-3, `${g} b*`);
  }
  closeTo(hexToLab('#808080')[0], 53.585, 0.01, 'mid grey L*');
});

test('lab and rgb round-trip within rounding error', () => {
  for (const hex of ['#ff6b6b', '#0a5c36', '#f2e8da', '#123456']) {
    const rgb = hexToRgb(hex);
    const back = labToRgb(rgbToLab(rgb));
    for (let i = 0; i < 3; i++) {
      closeTo(back[i], rgb[i], 1, `${hex}[${i}]`);
    }
  }
});

test('hex survives a lab round-trip', () => {
  for (const hex of ['#ff6b6b', '#7f77dd', '#f3ece0']) {
    assert.equal(labToHex(hexToLab(hex)), hex);
  }
});

test('the sRGB transfer function is the piecewise standard curve', () => {
  closeTo(srgbToLinear(0), 0, 1e-12);
  closeTo(srgbToLinear(1), 1, 1e-12);
  closeTo(srgbToLinear(0.04045), 0.04045 / 12.92, 1e-12);
  for (const v of [0.01, 0.1, 0.5, 0.9, 0.99]) {
    closeTo(linearToSrgb(srgbToLinear(v)), v, 1e-12, `transfer ${v}`);
  }
  const v = 0.5;
  const exact = srgbToLinear(v);
  const gamma22 = Math.pow(v, 2.2);
  assert.ok(
    Math.abs(exact - gamma22) > 1e-4,
    'the curve must differ measurably from the gamma-2.2 approximation'
  );
});

test('hsl round-trips within integer rounding', () => {
  for (const hex of ['#ff6b6b', '#00ff00', '#0000ff', '#808080', '#f2e8da']) {
    const rgb = hexToRgb(hex);
    const back = hslToRgb(rgbToHsl(rgb));
    for (let i = 0; i < 3; i++) closeTo(back[i], rgb[i], 1, `${hex}[${i}]`);
  }
  assert.deepEqual(hslToRgb(rgbToHsl([255, 0, 0])), [255, 0, 0]);
  const grey = rgbToHsl([128, 128, 128]);
  assert.equal(grey[0], 0);
  assert.equal(grey[1], 0);
  closeTo(grey[2], (128 / 255) * 100, 1e-9, 'grey lightness');
});

test('lch round-trips', () => {
  for (const lab of [[50, 20, -30], [100, 0, 0], [10, -5, 5]]) {
    const back = lchToLab(labToLch(lab));
    for (let i = 0; i < 3; i++) closeTo(back[i], lab[i], 1e-9, `lch[${i}]`);
  }
});

test('labToLch reports hue in [0, 360)', () => {
  for (const lab of [[50, 20, -30], [50, -20, 30], [50, 1, -1], [50, -1, -1]]) {
    const [, , h] = labToLch(lab);
    assert.ok(h >= 0 && h < 360, `hue out of range: ${h}`);
  }
});

test('parseColorInput understands the familiar spellings', () => {
  assert.equal(parseColorInput('#ff6b6b').hex, '#ff6b6b');
  assert.equal(parseColorInput('rgb(255, 107, 107)').hex, '#ff6b6b');
  assert.equal(parseColorInput('255,107,107').hex, '#ff6b6b');
  assert.equal(parseColorInput('hsl(0, 100%, 71%)').hex, '#ff6b6b');
  assert.equal(parseColorInput('not a colour'), null);
  assert.equal(parseColorInput(''), null);
  assert.equal(parseColorInput(undefined), null);
});

test('parseColorInput returns canonical rgb and lab', () => {
  const c = parseColorInput('255,107,107');
  assert.deepEqual(c.rgb, [255, 107, 107]);
  labCloseTo(c.lab, hexToLab('#ff6b6b'), 1e-9, 'parsed lab');
});

test('out-of-gamut detection flags impossible sRGB colours', () => {
  assert.equal(isOutOfGamut(hexToLab('#ff0000')), false);
  assert.equal(isOutOfGamut([50, 0, 0]), false);
  assert.equal(isOutOfGamut([50, 120, -120]), true);
});

test('the D65 white point constants are the CIE values', () => {
  assert.equal(WHITE_D65.Y, 1);
  assert.ok(Math.abs(WHITE_D65.X - 0.95047) < 1e-6);
  assert.ok(Math.abs(WHITE_D65.Z - 1.08883) < 1e-6);
});
