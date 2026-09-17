/**
 * Coloroteca Library Format (.clf.json) reader.
 *
 * Accepts either a parsed object or raw JSON text. This is the one format the
 * project treats as native, so parsing is a validate-then-normalise pass.
 *
 * @module parsers/clf
 */

import { CLF_FORMAT, validateLibrary, normalizeLibrary } from '../core/clf.js';

/**
 * @param {unknown} doc
 * @returns {boolean}
 */
export function isClfDocument(doc) {
  return !!doc && typeof doc === 'object' && !Array.isArray(doc) && doc.format === CLF_FORMAT;
}

/**
 * @param {string|object} input
 * @returns {object}
 */
export function parseClfJson(input) {
  if (typeof input !== 'string') return input;
  try {
    return JSON.parse(input.replace(/^\uFEFF/, ''));
  } catch (err) {
    throw new Error(`not valid JSON: ${err.message}`);
  }
}

/**
 * Parse a CLF document into a library.
 *
 * @param {string|object} input JSON text or an already-parsed object
 * @param {object} [options] accepted for parity with the other parsers; a CLF
 *        file carries its own metadata, so nothing here overrides it
 * @returns {{library:object,format:string,warnings:string[],stats:object}}
 */
export function parseClf(input, options = {}) {
  const doc = parseClfJson(input);
  if (!isClfDocument(doc)) {
    throw new Error(
      `not a CLF document: expected format "${CLF_FORMAT}", got ${JSON.stringify(doc?.format)}`
    );
  }

  const check = validateLibrary(doc);
  if (!check.valid) {
    throw new Error(`invalid CLF document: ${check.errors.join('; ')}`);
  }

  const { library, dropped, warnings } = normalizeLibrary(doc);

  if (options.name) library.meta.name = options.name;
  if (options.id) library.id = options.id;

  return {
    library,
    format: 'clf',
    warnings: [...check.warnings, ...warnings],
    stats: { total: check.stats.total, parsed: library.colors.length, skipped: dropped },
  };
}

export default parseClf;
