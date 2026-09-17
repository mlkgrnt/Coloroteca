/**
 * Format sniffing and dispatch.
 *
 * Every parser returns the same envelope, so callers never branch on format:
 *
 *   { library, format, warnings, stats }
 *
 * `library` is always a valid CLF document, whatever went in.
 *
 * @module parsers
 */

import { parseClf, isClfDocument, parseClfJson } from './clf.js';
import { parseAse, isAse } from './ase.js';
import { parseAcb, isAcb } from './acb.js';
import { parseGpl, isGpl } from './gpl.js';
import { parseText } from './text.js';

export { parseClf, isClfDocument, parseClfJson } from './clf.js';
export { parseAse, isAse } from './ase.js';
export { parseAcb, isAcb } from './acb.js';
export { parseGpl, isGpl } from './gpl.js';
export { parseText } from './text.js';

/** Formats this build can read. */
export const SUPPORTED_FORMATS = Object.freeze(['clf', 'ase', 'acb', 'gpl', 'text']);

function asBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  return null;
}

/**
 * Work out what a blob is.
 *
 * Order matters: binary signatures are checked first because a binary file can
 * contain ASCII that happens to look like a text header.
 *
 * @param {Uint8Array|ArrayBuffer|string|object} input
 * @param {string} [filename] used only as a weak hint, never as the decision
 * @returns {'clf'|'ase'|'acb'|'gpl'|'text'|'json'|'unknown'}
 */
export function detectFormat(input, filename) {
  if (input && typeof input === 'object' && !ArrayBuffer.isView(input) && !(input instanceof ArrayBuffer)) {
    return isClfDocument(input) ? 'clf' : 'json';
  }

  const u8 = asBytes(input);
  if (u8) {
    if (isAse(u8)) return 'ase';
    if (isAcb(u8)) return 'acb';
  }

  if (typeof input === 'string') {
    const head = input.replace(/^\uFEFF/, '').trimStart();
    if (isGpl(head)) return 'gpl';
    if (head.startsWith('{') || head.startsWith('[')) {
      try {
        const doc = parseClfJson(head);
        return isClfDocument(doc) ? 'clf' : 'json';
      } catch {
        return 'json';
      }
    }
    return 'text';
  }

  if (typeof filename === 'string' && filename) {
    const lower = filename.toLowerCase();
    if (lower.endsWith('.ase')) return 'ase';
    if (lower.endsWith('.acb')) return 'acb';
    if (lower.endsWith('.gpl')) return 'gpl';
    if (lower.endsWith('.clf.json')) return 'clf';
  }

  return 'unknown';
}

/**
 * Parse anything into a CLF library.
 *
 * @param {Uint8Array|ArrayBuffer|string|object} input
 * @param {{format?:string, filename?:string, [key:string]:any}} [options]
 * @returns {{library:object,format:string,warnings:string[],stats:object}}
 */
export function parseAny(input, options = {}) {
  const format = options.format ?? detectFormat(input, options.filename);

  switch (format) {
    case 'ase':
      return parseAse(input, options);
    case 'acb':
      return parseAcb(input, options);
    case 'gpl':
      return parseGpl(input, options);
    case 'clf':
      return parseClf(input, options);
    case 'text':
      return parseText(input, options);
    case 'json':
      throw new Error(
        'this JSON file is not in Coloroteca Library Format (.clf.json). ' +
          'Convert it first — see docs/CLF-FORMAT.md.'
      );
    default:
      throw new Error(
        `unrecognised colour library format${options.filename ? ` (${options.filename})` : ''}. ` +
          `Supported: ${SUPPORTED_FORMATS.join(', ')}.`
      );
  }
}
