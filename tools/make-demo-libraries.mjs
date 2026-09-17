#!/usr/bin/env node
/**
 * Regenerate the bundled demo libraries in data/demo/.
 *
 * Two libraries ship with the project, and both must be free of third-party
 * rights:
 *
 *   demo-wheel.clf.json          synthesised here, CC0. 24 hues at 15° steps
 *                                x 3 lightness levels at S=65%, plus an
 *                                11-step grey ramp = 83 entries. Nothing is
 *                                measured or copied — the values are computed.
 *
 *   chinese-traditional.clf.json derived from wyvernnot/ancient-chinese-color,
 *                                which is MIT licensed. Requires --ancient-data
 *                                because we do not vendor the upstream file.
 *
 * Everything is routed through core/ so the emitted documents are exactly what
 * the app itself would produce, and both carry a pinned `importedAt` so the
 * output is byte-stable across runs.
 *
 * It also bundles whatever .clf.json files sit in data/demo/ into
 * web/demo-libraries.js. The web app needs the demo data as an ES module
 * rather than fetched JSON, because fetch() is blocked on file:// — and the
 * whole point of the page is that you can double-click it and it works.
 *
 * Usage:
 *   node tools/make-demo-libraries.mjs
 *   node tools/make-demo-libraries.mjs --ancient-data <path to ancient-data.json>
 *   node tools/make-demo-libraries.mjs --check      # verify files are current
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { hslToRgb, rgbToHex } from '../core/color-space.js';
import { normalizeLibrary, librarySummary, validateLibrary } from '../core/clf.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

/** Pinned so repeated runs produce identical files. */
const PINNED_TIMESTAMP = '2026-09-17T00:00:00+08:00';

const HUE_STEP = 15; // degrees
const HUE_COUNT = 360 / HUE_STEP; // 24
const SATURATION = 65; // percent
const LEVELS = [25, 50, 75]; // lightness, percent
const GREY_STEPS = 11; // 0..100 at 10% intervals

const pad = (v, width) => String(v).padStart(width, '0');

/**
 * 24 hues x 3 lightness levels. Codes are "<hue>-<lightness>", e.g. "195-50".
 */
function buildWheelColors() {
  const colors = [];
  for (let i = 0; i < HUE_COUNT; i++) {
    const hue = i * HUE_STEP;
    for (const level of LEVELS) {
      const rgb = hslToRgb([hue, SATURATION, level]);
      colors.push({
        code: `${pad(hue, 3)}-${level}`,
        name: null,
        hex: rgbToHex(rgb),
        rgb,
      });
    }
  }
  return colors;
}

/** 11 neutrals from black to white. */
function buildGreyColors() {
  const colors = [];
  for (let i = 0; i < GREY_STEPS; i++) {
    const level = i * (100 / (GREY_STEPS - 1)); // 0, 10, ... 100
    const rgb = hslToRgb([0, 0, level]);
    colors.push({
      code: `GRAY-${pad(Math.round(level), 3)}`,
      name: null,
      hex: rgbToHex(rgb),
      rgb,
    });
  }
  return colors;
}

function buildWheelLibrary() {
  const colors = [...buildWheelColors(), ...buildGreyColors()];
  return normalizeLibrary({
    id: 'demo-wheel',
    meta: {
      name: 'Demo Colour Wheel',
      system: 'CUSTOM',
      prefix: 'DEMO',
      colorCount: colors.length,
      source: 'synthesised by Coloroteca (tools/make-demo-libraries.mjs)',
      license: 'CC0',
      importedAt: PINNED_TIMESTAMP,
      note:
        `Synthetic sample library: ${HUE_COUNT} hues x ${LEVELS.length} lightness levels ` +
        `at S=${SATURATION}%, plus a ${GREY_STEPS}-step grey ramp. ` +
        'Generated, not measured — carries no third-party rights.',
    },
    colors,
  }).library;
}

/**
 * @param {string} ancientDataPath upstream ancient-chinese-color JSON
 */
function buildTraditionalLibrary(ancientDataPath) {
  const raw = JSON.parse(readFileSync(ancientDataPath, 'utf8'));
  if (!Array.isArray(raw)) {
    throw new Error(`${ancientDataPath}: expected a JSON array`);
  }

  // Upstream stores RGB/CMYK as comma-separated strings, and a few values carry
  // stray zero-width characters, so pull the digits out rather than splitting.
  const numbers = (value) =>
    typeof value === 'string' ? (value.match(/\d+/g) ?? []).map(Number) : [];

  const colors = [];
  let skipped = 0;

  for (const item of raw) {
    const hex = typeof item?.HEX === 'string' ? item.HEX.trim() : '';
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) {
      skipped++;
      continue;
    }
    const rgb = numbers(item.RGB);
    const cmyk = numbers(item.CMYK);
    colors.push({
      code: String(item.name ?? '').trim(),
      name: null,
      hex,
      rgb: rgb.length === 3 ? rgb : undefined,
      cmyk: cmyk.length === 4 ? cmyk : undefined,
      note: String(item.description ?? '').trim() || undefined,
    });
  }

  const library = normalizeLibrary({
    id: 'chinese-traditional',
    meta: {
      name: '中国传统色',
      system: 'CUSTOM',
      colorCount: colors.length,
      source: 'wyvernnot/ancient-chinese-color (MIT)',
      license: 'MIT',
      importedAt: PINNED_TIMESTAMP,
      note:
        '中国古代颜色表。数据来自 wyvernnot/ancient-chinese-color，MIT 许可，' +
        '版权归原作者所有。',
    },
    colors,
  }).library;

  return { library, skipped };
}

const serialize = (doc) => `${JSON.stringify(doc, null, 2)}\n`;

function report(label, library, extra = '') {
  const s = librarySummary(library);
  const v = validateLibrary(library);
  console.log(
    `  ${label}: ${s.count} colours, ${s.id}, license=${s.license}` +
      (extra ? `, ${extra}` : '')
  );
  if (!v.valid) {
    console.error(`    INVALID: ${v.errors.join('; ')}`);
    process.exitCode = 1;
  }
  if (v.warnings.length) {
    for (const w of v.warnings) console.log(`    warning: ${w}`);
  }
}

function writeOrCheck(path, contents, checkOnly) {
  if (checkOnly) {
    if (!existsSync(path)) {
      console.error(`  MISSING: ${path}`);
      process.exitCode = 1;
      return;
    }
    if (readFileSync(path, 'utf8') !== contents) {
      console.error(`  STALE: ${path} differs from generated output`);
      process.exitCode = 1;
      return;
    }
    console.log(`  up to date: ${path}`);
    return;
  }
  writeFileSync(path, contents, 'utf8');
  console.log(`  wrote ${path}`);
}

function main() {
  const argv = process.argv.slice(2);
  const checkOnly = argv.includes('--check');
  const idx = argv.indexOf('--ancient-data');
  const ancientData = idx >= 0 ? argv[idx + 1] : null;
  const outDir = join(ROOT, 'data', 'demo');

  if (idx >= 0 && !ancientData) {
    console.error('--ancient-data requires a path');
    process.exit(2);
  }

  mkdirSync(outDir, { recursive: true });
  console.log(checkOnly ? 'checking demo libraries' : 'generating demo libraries');

  const wheel = buildWheelLibrary();
  report('demo-wheel', wheel);
  writeOrCheck(join(outDir, 'demo-wheel.clf.json'), serialize(wheel), checkOnly);

  if (ancientData) {
    const { library, skipped } = buildTraditionalLibrary(ancientData);
    report('chinese-traditional', library, skipped ? `${skipped} rows skipped` : '');
    writeOrCheck(
      join(outDir, 'chinese-traditional.clf.json'),
      serialize(library),
      checkOnly
    );
  } else {
    console.log(
      '  chinese-traditional: skipped (pass --ancient-data <path> to regenerate)'
    );
  }

  bundleForWeb(outDir, checkOnly);
}

/**
 * Bundle every .clf.json in data/demo/ into web/demo-libraries.js.
 *
 * The .clf.json files are the source of truth; this is a derived artifact and
 * is regenerated from whatever is on disk.
 */
function bundleForWeb(outDir, checkOnly) {
  mkdirSync(join(ROOT, 'web'), { recursive: true });
  const files = readdirSync(outDir)
    .filter((f) => f.endsWith('.clf.json'))
    .sort();

  const libraries = files.map((f) => JSON.parse(readFileSync(join(outDir, f), 'utf8')));

  const banner = [
    '/**',
    ' * Generated by tools/make-demo-libraries.mjs — do not edit by hand.',
    ' *',
    ' * The bundled sample libraries, inlined as an ES module so the page works',
    ' * when opened straight from disk (fetch() is unavailable on file://).',
    ' *',
    ' * Every entry here is either computed or MIT licensed; see the `meta.source`',
    ' * and `meta.license` fields of each document, and data/demo/ for the',
    ' * canonical .clf.json files. Replace or remove these freely from the UI.',
    ' *',
    ` * Libraries: ${files.join(', ')}`,
    ' */',
    '',
    'export const DEMO_LIBRARIES = ',
    `${JSON.stringify(libraries, null, 2)};`,
    '',
  ].join('\n');

  console.log(
    `  web bundle: ${libraries.length} libraries (${files.join(', ')})`
  );
  writeOrCheck(join(ROOT, 'web', 'demo-libraries.js'), banner, checkOnly);
}

main();
