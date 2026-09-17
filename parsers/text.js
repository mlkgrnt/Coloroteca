/**
 * Free-form text / CSV / CSS parser.
 *
 * The "I already have a list of colours" entry point. One line per colour, and
 * the line may be anything a person would plausibly paste:
 *
 *   #E4002B
 *   228,0,43
 *   rgb(228, 0, 43)
 *   185 C #E4002B
 *   PANTONE 185 C	#E4002B
 *   185,#E4002B
 *   --brand-red: #E4002B;
 *
 * Anything to the left of the colour becomes the code; anything to the right is
 * used only if the left is empty. A line with no recognisable colour is counted
 * as skipped rather than silently dropped.
 *
 * @module parsers/text
 */

import { createLibrary } from '../core/clf.js';
import { normalizeHex, hexToRgb, rgbToHex } from '../core/color-space.js';

const HEX6 = /#([0-9a-fA-F]{6})\b/;
const HEX3 = /#([0-9a-fA-F]{3})\b/;
const RGB_FN = /rgba?\(\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})/i;
const BARE_RGB = /^(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})$/;
const CSS_VAR = /^--([a-zA-Z0-9_-]+)\s*[:=]/;

const DECOR = /^[-–—\s]+|[\s:;=,]+$/g;
const DECOR_EDGES = /^[\s:;=,]+|[\s:;=,]+$/g;

/**
 * Pull a human label out of the surrounding text.
 * @param {string} line
 * @param {number} index start of the colour token
 * @param {number} length length of the colour token
 * @param {string} fallbackHex used when there is no label at all
 */
function extractLabel(line, index, length, fallbackHex) {
  const before = line.slice(0, index).replace(DECOR, '').trim();
  if (before) return before;

  const cssVar = line.match(CSS_VAR);
  if (cssVar) return cssVar[1];

  const after = line.slice(index + length).replace(DECOR_EDGES, '').trim();
  return after || fallbackHex.slice(1);
}

/**
 * @param {string} text
 * @param {{name?:string,id?:string,system?:string,prefix?:string,suffix?:string,
 *          source?:string,license?:string}} [options]
 * @returns {{library:object,format:string,warnings:string[],stats:object}}
 */
export function parseText(text, options = {}) {
  const lines = String(text ?? '').split(/\r?\n/);
  const colors = [];
  const warnings = [];
  let skipped = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    // A '#' followed by whitespace or '!' opens a comment. This is checked
    // before hex extraction so "# Brand colours" is not misread as a colour.
    if (/^#($|[\s!])/.test(line)) continue;

    let m = line.match(HEX6) || line.match(HEX3);
    if (m) {
      const hex = normalizeHex(m[0]);
      if (!hex) {
        skipped++;
        continue;
      }
      colors.push({
        code: extractLabel(line, m.index, m[0].length, hex),
        name: null,
        hex,
        rgb: hexToRgb(hex),
      });
      continue;
    }

    m = line.match(RGB_FN);
    if (m) {
      const rgb = [+m[1], +m[2], +m[3]];
      if (rgb.every((v) => v >= 0 && v <= 255)) {
        const hex = rgbToHex(rgb);
        colors.push({
          code: extractLabel(line, m.index, m[0].length, hex),
          name: null,
          hex,
          rgb,
        });
        continue;
      }
    }

    m = line.match(BARE_RGB);
    if (m) {
      const rgb = [+m[1], +m[2], +m[3]];
      if (rgb.every((v) => v >= 0 && v <= 255)) {
        const hex = rgbToHex(rgb);
        colors.push({ code: hex.slice(1), name: null, hex, rgb });
        continue;
      }
    }

    skipped++;
    warnings.push(`line ${i + 1}: no colour found — ${JSON.stringify(line.slice(0, 50))}`);
  }

  const library = createLibrary({
    name: options.name ?? 'Pasted colours',
    id: options.id,
    system: options.system ?? 'CUSTOM',
    prefix: options.prefix ?? null,
    suffix: options.suffix ?? null,
    source: options.source ?? 'pasted as text',
    license: options.license ?? 'unknown',
    colors,
    note: `${colors.length} colours parsed from ${lines.length} lines of text`,
  });

  return {
    library,
    format: 'text',
    warnings,
    stats: { total: lines.length, parsed: colors.length, skipped },
  };
}

export default parseText;
