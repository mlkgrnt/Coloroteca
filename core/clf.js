/**
 * Coloroteca Library Format (CLF) — schema, validation and normalisation.
 *
 * CLF is the single interchange schema every parser targets. Keeping one
 * canonical shape is what lets the web UI, the CLI and the agent skill share
 * a single matching implementation instead of drifting apart.
 *
 * Design notes:
 *   - `code` holds the bare identifier ("185"); the decorative parts live once
 *     in `meta.prefix` / `meta.suffix` and are composed at display time, so a
 *     2 000-entry library does not repeat "PANTONE " and " C" 2 000 times.
 *   - `lab` is preserved verbatim when the source provides it. Source Lab is
 *     more accurate than anything derived from a hex value, so it wins.
 *   - Lab is deliberately NOT precomputed for hex-only entries: that keeps the
 *     file pure data, and converting a few thousand entries at load time costs
 *     well under a millisecond.
 *
 * @module core/clf
 */

import { normalizeHex, hexToRgb } from './color-space.js';

export const CLF_FORMAT = 'coloroteca-library';
export const CLF_VERSION = '1.0';
export const SUPPORTED_VERSIONS = Object.freeze(['1.0']);
export const FILE_EXTENSION = '.clf.json';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * Turn a display name into a filesystem- and URL-safe identifier.
 * Keeps CJK characters, since colour libraries are often named in Chinese.
 *
 * @param {string} text
 * @returns {string}
 */
export function slugify(text) {
  return String(text ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

/**
 * Normalise a single colour entry.
 * @param {object} raw
 * @returns {object|null} null when the entry has no usable colour value
 */
function normalizeColor(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const hex = normalizeHex(raw.hex);
  if (!hex) return null;

  const out = {
    code: raw.code != null && String(raw.code).trim() !== ''
      ? String(raw.code).trim()
      : hex.slice(1),
    name: raw.name ? String(raw.name).trim() : null,
    hex,
    rgb:
      Array.isArray(raw.rgb) && raw.rgb.length === 3
        ? raw.rgb.map((v) => clamp(Math.round(Number(v)), 0, 255))
        : hexToRgb(hex),
  };

  if (Array.isArray(raw.cmyk) && raw.cmyk.length === 4) {
    out.cmyk = raw.cmyk.map((v) => Number(v));
  }

  if (
    Array.isArray(raw.lab) &&
    raw.lab.length === 3 &&
    raw.lab.every((v) => Number.isFinite(Number(v)))
  ) {
    out.lab = raw.lab.map((v) => Number(v));
  }

  if (typeof raw.spot === 'boolean') out.spot = raw.spot;
  if (raw.displayName) out.displayName = String(raw.displayName);
  if (raw.note) out.note = String(raw.note);

  return out;
}

/**
 * Validate a CLF document without mutating it.
 *
 * @param {unknown} doc
 * @returns {{valid:boolean, errors:string[], warnings:string[], stats:object}}
 */
export function validateLibrary(doc) {
  const errors = [];
  const warnings = [];
  const stats = { total: 0, usable: 0, dropped: 0, duplicateCodes: 0 };

  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return { valid: false, errors: ['not an object'], warnings, stats };
  }

  if (doc.format !== CLF_FORMAT) {
    errors.push(
      `format must be "${CLF_FORMAT}", got ${JSON.stringify(doc.format)}`
    );
  }

  const version = String(doc.version ?? '');
  if (version && !SUPPORTED_VERSIONS.includes(version)) {
    warnings.push(
      `version ${version} is not one of ${SUPPORTED_VERSIONS.join(', ')}; attempting to load anyway`
    );
  }

  if (!doc.meta || typeof doc.meta !== 'object') {
    errors.push('missing meta object');
  } else {
    if (!doc.meta.name) warnings.push('meta.name is empty');
    if (!doc.meta.source) warnings.push('meta.source is empty — provenance unknown');
    if (!doc.meta.license) warnings.push('meta.license is empty');
    if (
      typeof doc.meta.colorCount === 'number' &&
      Array.isArray(doc.colors) &&
      doc.meta.colorCount !== doc.colors.length
    ) {
      warnings.push(
        `meta.colorCount (${doc.meta.colorCount}) does not match colors.length (${doc.colors.length})`
      );
    }
  }

  if (!Array.isArray(doc.colors)) {
    errors.push('colors must be an array');
    return { valid: errors.length === 0, errors, warnings, stats };
  }

  stats.total = doc.colors.length;
  const seen = new Set();
  for (const c of doc.colors) {
    const norm = normalizeColor(c);
    if (!norm) {
      stats.dropped++;
      continue;
    }
    stats.usable++;
    if (seen.has(norm.code)) stats.duplicateCodes++;
    else seen.add(norm.code);
  }

  if (stats.dropped > 0) {
    warnings.push(`${stats.dropped} entries have no usable hex value and will be skipped`);
  }
  if (stats.duplicateCodes > 0) {
    warnings.push(`${stats.duplicateCodes} duplicate colour codes found`);
  }

  return { valid: errors.length === 0, errors, warnings, stats };
}

/**
 * Build a CLF document from raw parts.
 *
 * @param {object} spec
 * @param {string} spec.name
 * @param {Array<object>} spec.colors
 * @param {string} [spec.id]
 * @param {string} [spec.system]
 * @param {'coated'|'uncoated'|null} [spec.substrate]
 * @param {string} [spec.prefix]
 * @param {string} [spec.suffix]
 * @param {string} [spec.source]
 * @param {string} [spec.license]
 * @param {string} [spec.note]
 * @returns {object} CLF document
 */
export function createLibrary(spec) {
  const colors = (spec.colors ?? []).map(normalizeColor).filter(Boolean);
  const name = spec.name ? String(spec.name) : 'Untitled library';
  return {
    format: CLF_FORMAT,
    version: CLF_VERSION,
    id: spec.id ? slugify(spec.id) : slugify(name) || 'library',
    meta: {
      name,
      system: spec.system ? String(spec.system).toUpperCase() : 'CUSTOM',
      substrate: spec.substrate ?? null,
      prefix: spec.prefix ?? null,
      suffix: spec.suffix ?? null,
      colorCount: colors.length,
      source: spec.source ?? 'user-imported',
      license: spec.license ?? 'unknown',
      importedAt: new Date().toISOString(),
      note: spec.note ?? '',
    },
    colors,
  };
}

/**
 * Coerce an arbitrary document into a valid CLF structure.
 * Invalid colour entries are dropped rather than aborting the whole import.
 *
 * @param {object} doc
 * @returns {{library:object, dropped:number, warnings:string[]}}
 */
export function normalizeLibrary(doc) {
  if (!doc || typeof doc !== 'object') {
    throw new TypeError('normalizeLibrary expects an object');
  }
  const meta = doc.meta ?? {};
  const rawColors = Array.isArray(doc.colors) ? doc.colors : [];
  const colors = [];
  let dropped = 0;
  for (const c of rawColors) {
    const norm = normalizeColor(c);
    if (norm) colors.push(norm);
    else dropped++;
  }
  const name = meta.name ? String(meta.name) : 'Untitled library';
  const warnings = [];
  if (dropped > 0) warnings.push(`${dropped} entries dropped: unusable or missing hex`);

  return {
    dropped,
    warnings,
    library: {
      format: CLF_FORMAT,
      version: CLF_VERSION,
      id: slugify(doc.id ?? name) || 'library',
      meta: {
        name,
        system: meta.system ? String(meta.system).toUpperCase() : 'CUSTOM',
        substrate: meta.substrate ?? null,
        prefix: meta.prefix ?? null,
        suffix: meta.suffix ?? null,
        colorCount: colors.length,
        source: meta.source ?? 'unknown',
        license: meta.license ?? 'unknown',
        importedAt: meta.importedAt ?? new Date().toISOString(),
        note: meta.note ?? '',
      },
      colors,
    },
  };
}

/**
 * Compose the human-facing label for a colour entry.
 * "PANTONE" + "185" + "C" -> "PANTONE 185 C"
 *
 * @param {object} color
 * @param {object} [meta] the library's meta block
 * @returns {string}
 */
export function displayCode(color, meta = {}) {
  if (color.displayName) return color.displayName;
  const prefix = meta.prefix ? String(meta.prefix).trim() : '';
  const suffix = meta.suffix ? String(meta.suffix).trim() : '';
  const code = color.code == null ? '' : String(color.code).trim();
  return [prefix, code, suffix].filter(Boolean).join(' ');
}

/**
 * @param {object} library
 * @returns {{id:string, name:string, system:string, count:number, source:string, license:string}}
 */
export function librarySummary(library) {
  return {
    id: library.id,
    name: library.meta.name,
    system: library.meta.system,
    count: library.colors.length,
    source: library.meta.source,
    license: library.meta.license,
  };
}
