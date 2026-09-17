/**
 * Coloroteca — the matching engine.
 *
 * Given an input colour and a colour library, rank the library's entries by
 * perceptual distance and return the closest N.
 *
 * Two details are worth stating explicitly:
 *
 *   1. Candidates carrying a source `lab` value are compared in that Lab space.
 *      Pantone and Adobe publish ink Lab values; a hex value is a screen
 *      approximation derived from them, so round-tripping through hex would
 *      discard real precision.
 *
 *   2. kL defaults to whatever the library's system implies. TCX is a textile
 *      standard and gets kL = 2; graphic-arts libraries get kL = 1.
 *
 * @module core/matcher
 */

import { createDeltaE, deltaGrade, deltaBreakdown, klForSystem } from './delta-e.js';
import {
  parseColorInput,
  hexToLab,
  rgbToLab,
  rgbToHex,
  labToHex,
  labToRgb,
} from './color-space.js';
import { displayCode } from './clf.js';

const round = (v, d = 4) => {
  const f = Math.pow(10, d);
  return Math.round(v * f) / f;
};

const clampInt = (v, lo, hi) =>
  Math.max(lo, Math.min(hi, Math.floor(Number(v))));

/**
 * Resolve any accepted input form to a canonical colour object.
 * @param {string|object} input
 * @returns {{hex:string, rgb:number[], lab:number[], input:any}|null}
 */
export function resolveInput(input) {
  if (typeof input === 'string') return parseColorInput(input);

  if (input && typeof input === 'object') {
    if (Array.isArray(input.lab) && input.lab.length === 3) {
      const lab = input.lab.map(Number);
      return {
        hex: input.hex ?? labToHex(lab),
        rgb: input.rgb ?? labToRgb(lab),
        lab,
        input,
      };
    }
    if (Array.isArray(input.rgb) && input.rgb.length === 3) {
      const rgb = input.rgb.map(Number);
      return { hex: rgbToHex(rgb), rgb, lab: rgbToLab(rgb), input };
    }
    if (typeof input.hex === 'string') return parseColorInput(input.hex);
  }

  return null;
}

/**
 * Precompute candidate Lab values and the kL weight for a library, so a batch
 * of matches does not redo that work per input.
 *
 * @param {object} library CLF document
 * @returns {{library:object, labs:number[][], colors:object[], kL:number}}
 */
export function prepareLibrary(library) {
  const colors = library.colors;
  const labs = new Array(colors.length);
  for (let i = 0; i < colors.length; i++) {
    const c = colors[i];
    labs[i] = c.lab ?? hexToLab(c.hex) ?? [0, 0, 0];
  }
  return { library, colors, labs, kL: klForSystem(library.meta?.system) };
}

/**
 * Rank a prepared library against one input colour.
 *
 * @param {ReturnType<typeof prepareLibrary>} prepared
 * @param {{lab:number[], hex:string|null, rgb:number[]|null}} input
 * @param {{top?:number, formula?:string, kL?:number, kC?:number, kH?:number,
 *          threshold?:number|null, breakdown?:boolean}} [options]
 * @returns {object}
 */
export function matchPrepared(prepared, input, options = {}) {
  const { library, colors, labs } = prepared;
  const meta = library.meta ?? {};
  const formula = (options.formula ?? 'CIEDE2000').toUpperCase();
  const kL = options.kL ?? prepared.kL;
  const kC = options.kC ?? 1;
  const kH = options.kH ?? 1;
  const threshold = options.threshold ?? null;
  const wantBreakdown = options.breakdown !== false;

  const total = colors.length;
  const top = clampInt(options.top ?? 5, 1, Math.max(total, 1));
  const deltaE = createDeltaE({ formula, kL, kC, kH });

  const inputLab = input.lab;
  const scored = new Array(total);
  for (let i = 0; i < total; i++) {
    scored[i] = { i, d: deltaE(inputLab, labs[i]) };
  }
  scored.sort((a, b) => a.d - b.d);

  const matches = [];
  for (let r = 0; r < top && r < total; r++) {
    const { i, d } = scored[r];
    if (threshold != null && d > threshold) break;
    const color = colors[i];
    const lab = labs[i];
    matches.push({
      rank: r + 1,
      displayCode: displayCode(color, meta),
      code: color.code,
      name: color.name ?? null,
      note: color.note ?? null,
      hex: color.hex,
      rgb: color.rgb,
      cmyk: color.cmyk ?? null,
      lab: lab.map((v) => round(v, 4)),
      spot: color.spot ?? null,
      deltaE: round(d, 4),
      grade: deltaGrade(d),
      breakdown: wantBreakdown
        ? (() => {
            const b = deltaBreakdown(inputLab, lab);
            return {
              dL: round(b.dL, 3),
              dC: round(b.dC, 3),
              dH: round(b.dH, 3),
              dE76: round(b.dE76, 3),
            };
          })()
        : null,
    });
  }

  const judged = scored.length > 0 ? scored[0].d : null;

  return {
    input: {
      hex: input.hex ?? null,
      rgb: input.rgb ?? null,
      lab: inputLab.map((v) => round(v, 4)),
      raw: input.input ?? null,
    },
    library: {
      id: library.id,
      name: meta.name,
      system: meta.system ?? 'CUSTOM',
      matchCount: total,
    },
    settings: {
      formula,
      kL,
      kC,
      kH,
      kLSource: options.kL != null ? 'explicit' : 'derived-from-system',
      top,
      threshold,
    },
    bestDeltaE: judged == null ? null : round(judged, 4),
    matches,
  };
}

/**
 * Convenience wrapper: parse the input, prepare the library, match.
 * Use {@link prepareLibrary} + {@link matchPrepared} instead when matching many
 * inputs against the same library.
 *
 * @param {string|object} input
 * @param {object} library CLF document
 * @param {object} [options]
 * @returns {object}
 */
export function matchColor(input, library, options = {}) {
  const resolved = resolveInput(input);
  if (!resolved) {
    throw new Error(`Cannot interpret colour input: ${JSON.stringify(input)}`);
  }
  return matchPrepared(prepareLibrary(library), resolved, options);
}

/**
 * Match many inputs against one library, sharing the prepared candidate set.
 *
 * @param {Array<string|object>} inputs
 * @param {object} library
 * @param {object} [options]
 * @returns {Array<object>} one result per input; unparseable inputs carry an `error`
 */
export function matchBatch(inputs, library, options = {}) {
  const prepared = prepareLibrary(library);
  return inputs.map((raw, index) => {
    const resolved = resolveInput(raw);
    if (!resolved) {
      return {
        index,
        input: { raw: String(raw), hex: null, rgb: null, lab: null },
        error: 'unparseable',
        matches: [],
      };
    }
    return { index, ...matchPrepared(prepared, resolved, options) };
  });
}

/**
 * Look up an entry by its colour code — the reverse direction, used to answer
 * "what colour is PANTONE 185 C".
 *
 * Matching is case-insensitive and tolerant of the decorative prefix/suffix, so
 * "185", "185 C" and "PANTONE 185 C" all resolve.
 *
 * @param {object} library CLF document
 * @param {string} query
 * @param {{limit?:number}} [options]
 * @returns {object[]}
 */
export function lookupByCode(library, query, options = {}) {
  const limit = options.limit ?? 5;
  const meta = library.meta ?? {};
  const needle = String(query ?? '').trim().toLowerCase();
  if (!needle) return [];

  const strip = (s) =>
    s
      .toLowerCase()
      .replace(/^pantone\s+/i, '')
      .replace(/\s+/g, ' ')
      .trim();

  const target = strip(needle);
  const found = [];

  for (const color of library.colors) {
    const full = displayCode(color, meta).toLowerCase();
    const bare = String(color.code).toLowerCase();
    const name = (color.name ?? '').toLowerCase();

    let rank = -1;
    if (full === needle || bare === needle || full === target || bare === target) {
      rank = 0;
    } else if (strip(full) === target) {
      rank = 1;
    } else if (name && name === needle) {
      rank = 2;
    } else if (name && name.includes(needle)) {
      rank = 3;
    } else if (bare.includes(target) || full.includes(target)) {
      rank = 4;
    }

    if (rank >= 0) found.push({ rank, color });
  }

  found.sort((a, b) => a.rank - b.rank || String(a.color.code).localeCompare(String(b.color.code)));

  return found.slice(0, limit).map(({ color }) => ({
    displayCode: displayCode(color, meta),
    code: color.code,
    name: color.name ?? null,
    note: color.note ?? null,
    hex: color.hex,
    rgb: color.rgb,
    cmyk: color.cmyk ?? null,
    lab: (color.lab ?? hexToLab(color.hex)).map((v) => round(v, 4)),
  }));
}
