/**
 * GIMP Palette (.gpl) parser.
 *
 * A plain-text palette written by GIMP, Inkscape, Aseprite, Krita and several
 * other editors — the easiest format for a user to hand-author or paste.
 *
 *   GIMP Palette
 *   Name: Brand colours
 *   Columns: 4
 *   #
 *   228   0  43	Red
 *     0 128 255	Blue
 *
 * @module parsers/gpl
 */

import { createLibrary } from '../core/clf.js';
import { rgbToHex } from '../core/color-space.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * @param {string} text
 * @returns {boolean}
 */
export function isGpl(text) {
  return /^\uFEFF?GIMP Palette/.test(String(text).trimStart());
}

/**
 * Parse a GIMP palette into a CLF library.
 *
 * @param {string} text
 * @param {{name?:string,id?:string,prefix?:string,suffix?:string,source?:string,
 *          license?:string}} [options]
 * @returns {{library:object,format:string,warnings:string[],stats:object}}
 */
export function parseGpl(text, options = {}) {
  const src = String(text ?? '');
  if (!isGpl(src)) throw new Error('not a GIMP palette: missing "GIMP Palette" header');

  const lines = src.split(/\r?\n/);
  const warnings = [];
  const colors = [];
  let skipped = 0;
  let paletteName = null;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;

    const meta = line.match(/^(Name|Columns):\s*(.*)$/i);
    if (meta) {
      if (meta[1].toLowerCase() === 'name') paletteName = meta[2].trim();
      continue;
    }

    const m = line.match(/^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})(?:\s+(.*))?$/);
    if (!m) {
      skipped++;
      warnings.push(`line ${i + 1}: not a palette entry — ${JSON.stringify(line.slice(0, 40))}`);
      continue;
    }

    const rgb = [+m[1], +m[2], +m[3]];
    if (rgb.some((v) => v > 255 || v < 0)) {
      skipped++;
      warnings.push(`line ${i + 1}: channel out of range ${rgb.join(',')}`);
      continue;
    }

    const label = m[4] ? m[4].trim() : '';
    const hex = rgbToHex(rgb);
    colors.push({
      code: label || hex.slice(1),
      name: null,
      hex,
      rgb: rgb.map((v) => clamp(v, 0, 255)),
    });
  }

  const library = createLibrary({
    name: options.name ?? paletteName ?? 'GIMP palette',
    id: options.id,
    system: options.system ?? 'CUSTOM',
    prefix: options.prefix ?? null,
    suffix: options.suffix ?? null,
    source: options.source ?? 'imported from .gpl',
    license: options.license ?? 'unknown',
    colors,
    note: paletteName ? `GIMP palette "${paletteName}"` : 'GIMP palette',
  });

  return {
    library,
    format: 'gpl',
    warnings,
    stats: { total: lines.length, parsed: colors.length, skipped },
  };
}

export default parseGpl;
