import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  parseAny,
  detectFormat,
  parseAse,
  parseAcb,
  parseGpl,
  parseClf,
  parseText,
  isAse,
  isAcb,
  isGpl,
  isClfDocument,
} from '../parsers/index.js';
import { validateLibrary, displayCode } from '../core/clf.js';
import { matchColor } from '../core/matcher.js';

const here = dirname(fileURLToPath(import.meta.url));

// ------------------------------------------------------- binary builders

class ByteWriter {
  constructor() {
    this.bytes = [];
  }
  u8(...v) {
    this.bytes.push(...v.map((x) => x & 0xff));
    return this;
  }
  u16(v) {
    this.bytes.push((v >> 8) & 0xff, v & 0xff);
    return this;
  }
  u32(v) {
    this.bytes.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
    return this;
  }
  f32(v) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setFloat32(0, v);
    this.bytes.push(...b);
    return this;
  }
  ascii(s) {
    for (const ch of s) this.bytes.push(ch.charCodeAt(0));
    return this;
  }
  utf16(s) {
    for (const ch of s) this.u16(ch.charCodeAt(0));
    return this;
  }
  out() {
    return new Uint8Array(this.bytes);
  }
}

/** Build an ASE file with the given swatches. */
function buildAse(swatches, groups = []) {
  const body = [];

  for (const g of groups) {
    const nameUnits = g.length + 1;
    const w = new ByteWriter();
    w.u16(0xc001).u32(2 + nameUnits * 2).u16(nameUnits).utf16(g).u16(0);
    body.push(w.out());
  }

  for (const s of swatches) {
    const nameUnits = s.name.length + 1;
    let payload;
    if (s.model === 'RGB ') {
      payload = 12;
    } else if (s.model === 'CMYK') {
      payload = 16;
    } else if (s.model === 'LAB ') {
      payload = 12;
    } else {
      payload = 4;
    }
    const w = new ByteWriter();
    w.u16(0x0001).u32(2 + nameUnits * 2 + 4 + payload + 2);
    w.u16(nameUnits).utf16(s.name).u16(0);
    w.ascii(s.model);
    for (const v of s.values) w.f32(v);
    w.u16(s.spot ? 1 : 2);
    body.push(w.out());
  }

  const w = new ByteWriter();
  w.ascii('ASEF').u16(1).u16(0).u32(body.length);
  return concat([w.out(), ...body]);
}

function concat(parts) {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Build an ACB colour book. */
function buildAcb({ title = 'Test Book', prefix = 'TST ', suffix = ' C', spaceId = 7, records = [] }) {
  const w = new ByteWriter();
  w.ascii('8BCB').u16(1).u16(0x0bb8);
  const str = (s) => {
    w.u32(s.length).utf16(s);
  };
  str(title);
  str(prefix);
  str(suffix);
  str('(c) test');
  w.u16(records.length).u16(6).u16(0).u16(spaceId);

  for (const r of records) {
    const pad = new ByteWriter();
    pad.u32(r.name.length).utf16(r.name);
    w.bytes.push(...pad.out());
    for (const ch of r.code.padEnd(6, ' ').slice(0, 6)) w.u8(ch.charCodeAt(0));
    for (const c of r.components) w.u8(c);
  }
  return w.out();
}

// ------------------------------------------------------------------ ASE

test('ASE: RGB swatches parse into CLF', () => {
  const buf = buildAse(
    [
      { name: 'Red', model: 'RGB ', values: [1, 0, 0] },
      { name: 'Sea', model: 'RGB ', values: [0, 0.4, 0.8], spot: true },
      { name: 'Ink', model: 'CMYK', values: [0, 1, 0.81, 0] },
    ],
    ['Group A']
  );

  const res = parseAse(buf);
  assert.equal(res.format, 'ase');
  assert.equal(res.library.colors.length, 3);
  assert.deepEqual(validateLibrary(res.library).errors, []);

  assert.equal(res.library.colors[0].code, 'Red');
  assert.equal(res.library.colors[0].hex, '#ff0000');
  assert.deepEqual(res.library.colors[0].rgb, [255, 0, 0]);

  assert.equal(res.library.colors[1].spot, true);

  assert.equal(res.library.colors[2].code, 'Ink');
  assert.deepEqual(res.library.colors[2].cmyk, [0, 100, 81, 0]);

  assert.match(res.library.meta.note, /Group A/);
});

test('ASE: LAB swatches keep their Lab and are adapted from D50', () => {
  // Adobe normalises L to 0..1 in an ASE LAB block, while a and b are already
  // in real Lab units — hence 0.5 here rather than 50.
  const buf = buildAse([{ name: 'Neutral', model: 'LAB ', values: [0.5, 0, 0] }]);
  const res = parseAse(buf);
  const c = res.library.colors[0];
  assert.ok(Array.isArray(c.lab), 'lab should be preserved');
  // a neutral grey stays neutral under chromatic adaptation
  assert.ok(Math.abs(c.lab[1]) < 1e-6, `a* should stay ~0, got ${c.lab[1]}`);
  assert.ok(Math.abs(c.lab[2]) < 1e-6, `b* should stay ~0, got ${c.lab[2]}`);
  assert.ok(Math.abs(c.lab[0] - 50) < 1e-6, `L* should stay ~50, got ${c.lab[0]}`);
});

/*
 * Regression: L arrives normalised (0..1) but a and b are already in Lab units.
 * Taking L literally put every swatch near black — a bright yellow imported as
 * #010000, and a matching run against a real book returned ΔE ≈ 50 for colours
 * that should have been within a few units. Assert on the resulting colour, not
 * only on the number, because the numeric assertion alone passes either way.
 */
test('ASE: a normalised L is rescaled, not taken literally', () => {
  // L* 87.55, a* 2.18, b* 109.05: the shape of a bright yellow swatch.
  const buf = buildAse([
    { name: 'Bright Yellow', model: 'LAB ', values: [0.8755, 2.18, 109.05] },
  ]);
  const c = parseAse(buf).library.colors[0];

  // The Bradford D50 -> D65 adaptation moves L* by a fraction of a unit, so this
  // asserts a band rather than the input value. The failure mode being guarded
  // against is a value near 0.9, which is what reading L literally produces.
  assert.ok(
    c.lab[0] > 80 && c.lab[0] < 95,
    `L* should be around 87, got ${c.lab[0]}`
  );
  assert.ok(
    Math.max(...c.rgb) > 200,
    `a bright swatch must not come out dark: rgb=${c.rgb.join(',')} hex=${c.hex}`
  );
});

test('ASE: signature detection and rejection', () => {
  const buf = buildAse([{ name: 'A', model: 'RGB ', values: [0, 0, 0] }]);
  assert.equal(isAse(buf), true);
  assert.equal(isAse(new Uint8Array([0, 1, 2, 3])), false);
  assert.throws(() => parseAse(new Uint8Array([0, 1, 2, 3])), /signature missing/);
  assert.throws(() => parseAse('not bytes'), /expects a Uint8Array/);
});

test('ASE: group start and end blocks do not become colours', () => {
  const g1 = new ByteWriter();
  const g1Units = 'Gp'.length + 1;
  g1.u16(0xc001).u32(2 + g1Units * 2).u16(g1Units).utf16('Gp').u16(0);

  const g2 = new ByteWriter();
  g2.u16(0xc002).u32(0);

  const colUnits = 'A'.length + 1;
  const col = new ByteWriter();
  col
    .u16(0x0001)
    .u32(2 + colUnits * 2 + 4 + 12 + 2)
    .u16(colUnits)
    .utf16('A')
    .u16(0)
    .ascii('RGB ')
    .f32(1)
    .f32(1)
    .f32(1)
    .u16(2);

  const head = new ByteWriter();
  head.ascii('ASEF').u16(1).u16(0).u32(3);
  const res = parseAse(concat([head.out(), g1.out(), col.out(), g2.out()]));
  assert.equal(res.library.colors.length, 1);
  assert.equal(res.library.colors[0].hex, '#ffffff');
  assert.match(res.library.meta.note, /Gp/);
});

test('ASE: a truncated file is reported, not thrown', () => {
  const full = buildAse([
    { name: 'A', model: 'RGB ', values: [1, 0, 0] },
    { name: 'B', model: 'RGB ', values: [0, 1, 0] },
  ]);
  const cut = full.slice(0, full.length - 8);
  const res = parseAse(cut);
  assert.ok(res.library.colors.length >= 1, 'should salvage what is readable');
});

// ------------------------------------------------------------------ ACB

test('ACB: header fields and Lab records parse correctly', () => {
  // L byte 128 -> 50.2%, a/b byte 128 -> 0
  const buf = buildAcb({
    title: 'Test Book',
    prefix: 'TST ',
    suffix: ' C',
    spaceId: 7,
    records: [
      { name: 'Neutral', code: 'NTRL', components: [128, 128, 128] },
      { name: 'Warm', code: 'WRM', components: [200, 150, 140] },
    ],
  });

  const res = parseAcb(buf);
  assert.equal(res.format, 'acb');
  assert.equal(res.library.meta.name, 'Test Book');
  assert.equal(res.library.meta.prefix, 'TST ');
  assert.equal(res.library.meta.suffix, ' C');
  assert.equal(res.library.colors.length, 2);

  const [neutral, warm] = res.library.colors;
  assert.equal(neutral.code, 'Neutral');
  assert.ok(Math.abs(neutral.lab[0] - 50.196) < 0.01, `L* got ${neutral.lab[0]}`);
  assert.ok(Math.abs(neutral.lab[1]) < 1e-3);
  assert.ok(Math.abs(neutral.lab[2]) < 1e-3);

  assert.ok(warm.lab[1] > 0, 'warm swatch should have positive a*');
  assert.match(res.library.meta.note, /8-bit quantised/);
  assert.match(res.library.meta.note, /D50 to D65/);
});

/*
 * Regression: the record's six-byte field is Adobe's internal slot id, not a
 * colour code. In a shipped PANTONE+ book those read "0061SC", "0064SC", … and
 * abbreviate named swatches to "YELLOC". Treating them as the code produced
 * libraries whose "185 C" entry was labelled "0061SC" — unusable for lookup,
 * and wrong in a way that only shows up against a real book, never against a
 * fixture whose name and code columns happen to be swapped.
 */
test('ACB: the swatch name is the code, not the six-byte slot id', () => {
  const buf = buildAcb({
    prefix: 'PANTONE ',
    suffix: ' C',
    records: [
      { name: '106', code: '0064SC', components: [231, 124, 203] },
      { name: 'Yellow', code: 'YELLOC', components: [227, 127, 239] },
      { name: 'Orange 021', code: 'OR021C', components: [155, 194, 213] },
    ],
  });

  const res = parseAcb(buf);
  const codes = res.library.colors.map((c) => c.code);
  assert.deepEqual(codes, ['106', 'Yellow', 'Orange 021']);

  assert.equal(displayCode(res.library.colors[0], res.library.meta), 'PANTONE 106 C');
  assert.equal(displayCode(res.library.colors[1], res.library.meta), 'PANTONE Yellow C');

  for (const c of codes) {
    assert.ok(!/^\d{4}SC$/.test(c), `slot id leaked into the code: ${c}`);
  }
});

test('ACB: an empty-ish name still falls back to the slot id', () => {
  const buf = buildAcb({
    records: [{ name: '   ', code: 'PAD1  ', components: [128, 128, 128] }],
  });
  const res = parseAcb(buf);
  assert.equal(res.library.colors.length, 1);
  assert.equal(res.library.colors[0].code, 'PAD1');
});

test('ACB: displayCode composes prefix, code and suffix', () => {
  // Mirrors the real format: the name column carries the number, the six-byte
  // column carries Adobe's slot serial.
  const buf = buildAcb({
    prefix: 'TST ',
    suffix: ' C',
    records: [{ name: '185', code: '0061SC', components: [128, 128, 128] }],
  });
  const res = parseAcb(buf);
  assert.equal(displayCode(res.library.colors[0], res.library.meta), 'TST 185 C');
});

test('ACB: CMYK books invert and rescale the byte values', () => {
  // ACB stores CMYK inverted: byte 0 -> 100%, byte 255 -> 0%.
  // [0, 255, 255, 255] is therefore C=100 M=0 Y=0 K=0, i.e. pure cyan.
  const buf = buildAcb({
    spaceId: 2,
    records: [{ name: 'Cyan', code: 'CYN', components: [0, 255, 255, 255] }],
  });
  const res = parseAcb(buf);
  assert.deepEqual(res.library.colors[0].cmyk, [100, 0, 0, 0]);
  assert.equal(res.library.colors[0].hex, '#00ffff');
});

test('ACB: RGB books read bytes directly', () => {
  const buf = buildAcb({
    spaceId: 0,
    records: [{ name: 'Blue', code: 'BLU', components: [0, 0, 255] }],
  });
  const res = parseAcb(buf);
  assert.equal(res.library.colors[0].hex, '#0000ff');
  assert.deepEqual(res.library.colors[0].rgb, [0, 0, 255]);
});

test('ACB: empty-name padding records are skipped', () => {
  const buf = buildAcb({
    records: [
      { name: 'Real', code: 'R1', components: [128, 128, 128] },
      { name: '', code: 'PAD', components: [0, 0, 0] },
      { name: 'Real2', code: 'R2', components: [130, 130, 130] },
    ],
  });
  const res = parseAcb(buf);
  assert.equal(res.library.colors.length, 2);
  assert.ok(res.warnings.some((w) => w.includes('padding')));
});

test('ACB: the spot/process marker is consumed when present', () => {
  const base = buildAcb({
    records: [{ name: 'Spotty', code: 'SPT', components: [128, 128, 128] }],
  });
  const marker = new ByteWriter();
  marker.ascii('spflspot');
  // rebuild: strip nothing, just append the marker after the single record
  const withMarker = concat([base, marker.out()]);
  const res = parseAcb(withMarker);
  assert.equal(res.library.colors.length, 1);
});

test('ACB: signature detection and unsupported colour space', () => {
  const buf = buildAcb({ records: [{ name: 'A', code: 'A', components: [1, 2, 3] }] });
  assert.equal(isAcb(buf), true);
  assert.equal(isAcb(new Uint8Array([1, 2, 3, 4])), false);

  const weird = buildAcb({ spaceId: 3, records: [{ name: 'A', code: 'A', components: [1, 2, 3] }] });
  assert.throws(() => parseAcb(weird), /unsupported ACB colour space/);
});

// ------------------------------------------------------------------ GPL

test('GPL: a palette parses into CLF', () => {
  const text = [
    'GIMP Palette',
    'Name: Brand colours',
    'Columns: 4',
    '# a comment',
    '228   0  43\tRed',
    '  0 128 255\tBlue',
    ' 17  17  17',
  ].join('\n');

  assert.equal(isGpl(text), true);
  const res = parseGpl(text);
  assert.equal(res.library.meta.name, 'Brand colours');
  assert.equal(res.library.colors.length, 3);
  assert.equal(res.library.colors[0].code, 'Red');
  assert.equal(res.library.colors[0].hex, '#e4002b');
  assert.equal(res.library.colors[1].hex, '#0080ff');
  // no label -> the hex becomes the code
  assert.equal(res.library.colors[2].code, '111111');
});

test('GPL: malformed lines are skipped and reported', () => {
  const text = ['GIMP Palette', '999 999 999', '10 20 30\tGood', 'nonsense'].join('\n');
  const res = parseGpl(text);
  assert.equal(res.library.colors.length, 1);
  assert.equal(res.stats.skipped, 2);
  assert.equal(res.warnings.length, 2);
});

test('GPL: header is required', () => {
  assert.throws(() => parseGpl('255 0 0\n0 255 0'), /missing "GIMP Palette" header/);
});

// ------------------------------------------------------------------ text

test('text: the common paste shapes all parse', () => {
  const text = [
    '#E4002B',
    '228,0,43',
    'rgb(228, 0, 43)',
    '185 C #E4002B',
    'PANTONE 185 C\t#E4002B',
    '185,#E4002B',
    '--brand-red: #E4002B;',
    '#E4002B 185 C',
  ].join('\n');

  const res = parseText(text);
  assert.equal(res.library.colors.length, 8);
  for (const c of res.library.colors) assert.equal(c.hex, '#e4002b');

  const codes = res.library.colors.map((c) => c.code);
  assert.equal(codes[0], 'e4002b');
  assert.equal(codes[1], 'e4002b');
  assert.equal(codes[3], '185 C');
  assert.equal(codes[4], 'PANTONE 185 C');
  assert.equal(codes[5], '185');
  assert.equal(codes[6], 'brand-red');
  assert.equal(codes[7], '185 C');
});

test('text: comments and blank lines are skipped, not errors', () => {
  const text = ['# Brand colours', '', '   ', '#E4002B'].join('\n');
  const res = parseText(text);
  assert.equal(res.library.colors.length, 1);
  assert.equal(res.stats.skipped, 0);
});

test('text: three digit hex and rgb shorthand work', () => {
  const res = parseText('#f00\n#0f0');
  assert.equal(res.library.colors[0].hex, '#ff0000');
  assert.equal(res.library.colors[1].hex, '#00ff00');
});

test('text: lines with no colour are counted as skipped', () => {
  const res = parseText('#E4002B\nthis line has no colour in it');
  assert.equal(res.library.colors.length, 1);
  assert.equal(res.stats.skipped, 1);
  assert.match(res.warnings[0], /line 2/);
});

// ------------------------------------------------------------------ CLF

test('CLF: a shipped demo library round-trips', () => {
  const raw = readFileSync(join(here, '..', 'data/demo/demo-wheel.clf.json'), 'utf8');
  const res = parseClf(raw);
  assert.equal(res.format, 'clf');
  assert.equal(res.library.colors.length, 83);
  const first = res.library.colors[0];
  assert.equal(first.code, '000-25');
  assert.equal(first.name, null);
  assert.match(first.hex, /^#[0-9a-f]{6}$/);
  assert.deepEqual(first.rgb.length, 3);
});

test('CLF: a non-CLF JSON document is rejected with a clear message', () => {
  assert.throws(() => parseClf('{"foo":1}'), /not a CLF document/);
  assert.throws(() => parseClf('not json at all'), /not valid JSON/);
  assert.equal(isClfDocument({ format: 'coloroteca-library' }), true);
  assert.equal(isClfDocument({ format: 'other' }), false);
});

// ------------------------------------------------------- dispatch

test('detectFormat sniffs all supported types', () => {
  const ase = buildAse([{ name: 'A', model: 'RGB ', values: [0, 0, 0] }]);
  const acb = buildAcb({ records: [{ name: 'A', code: 'A', components: [1, 1, 1] }] });

  assert.equal(detectFormat(ase), 'ase');
  assert.equal(detectFormat(acb), 'acb');
  assert.equal(detectFormat('GIMP Palette\n0 0 0'), 'gpl');
  assert.equal(detectFormat('{"format":"coloroteca-library","colors":[]}'), 'clf');
  assert.equal(detectFormat('{"something":"else"}'), 'json');
  assert.equal(detectFormat('#E4002B'), 'text');
  assert.equal(detectFormat({ format: 'coloroteca-library' }), 'clf');
});

test('parseAny routes to the right parser and always yields CLF', () => {
  const cases = [
    [buildAse([{ name: 'A', model: 'RGB ', values: [1, 1, 1] }]), 'ase'],
    [buildAcb({ records: [{ name: 'A', code: 'A', components: [128, 128, 128] }] }), 'acb'],
    ['GIMP Palette\n255 0 0\tR', 'gpl'],
    ['#E4002B', 'text'],
  ];
  for (const [input, expected] of cases) {
    const res = parseAny(input);
    assert.equal(res.format, expected);
    assert.equal(validateLibrary(res.library).valid, true, `${expected} produced an invalid CLF`);
  }
});

test('parseAny rejects unsupported input with an actionable message', () => {
  assert.throws(() => parseAny('{"not":"clf"}'), /not in Coloroteca Library Format/);
  assert.throws(() => parseAny(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])), /unrecognised colour library format/);
});

// ------------------------------------------- end-to-end through the engine

test('a parsed library can be matched against immediately', () => {
  const buf = buildAse([
    { name: 'Red', model: 'RGB ', values: [1, 0, 0] },
    { name: 'Green', model: 'RGB ', values: [0, 1, 0] },
    { name: 'Blue', model: 'RGB ', values: [0, 0, 1] },
  ]);
  const { library } = parseAny(buf);
  const r = matchColor('#fa0505', library, { top: 1 });
  assert.equal(r.matches[0].code, 'Red');
  assert.ok(r.matches[0].deltaE < 5);
});

test('an ACB book matches through Lab without a hex round trip', () => {
  const buf = buildAcb({
    records: [
      { name: 'Neutral', code: 'NTRL', components: [128, 128, 128] },
      { name: 'Dark', code: 'DARK', components: [60, 128, 128] },
    ],
  });
  const { library } = parseAny(buf);
  const r = matchColor({ lab: [50.196, 0, 0] }, library, { top: 1 });
  assert.equal(r.matches[0].code, 'Neutral');
  assert.ok(r.matches[0].deltaE < 1e-3, `expected an exact hit, got ${r.matches[0].deltaE}`);
});
