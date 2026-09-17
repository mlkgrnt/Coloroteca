/**
 * Adobe Color Book (.acb) parser.
 *
 * This is the channel that matters most for a bring-your-own-library tool:
 * `Presets/Color Books` inside a Photoshop or Illustrator install already holds
 * the colour books the user is licensed for, and an .acb carries real ink Lab
 * values rather than a third-party hex approximation.
 *
 * Big-endian throughout. Three details there are easy to get wrong and would
 * corrupt everything downstream:
 *
 *   1. Strings are length-prefixed with a **32-bit** count (most Adobe
 *      binary formats use 16-bit), followed by UTF-16BE characters with no
 *      terminator.
 *   2. Colour components are **one byte each**, not 16-bit words.
 *   3. Each record carries **two** identifiers and they are not
 *      interchangeable. The length-prefixed string is the swatch's real name
 *      ("106", "Yellow", "Orange 021"); the six bytes that follow are
 *      Adobe's internal slot id, six characters wide and usually a serial
 *      rather than a name. In the shipped PANTONE+ Solid Coated book those
 *      slots read "0061SC", "0064SC", … — page and position, not colour — and
 *      only for named swatches do they abbreviate ("Yellow" -> "YELLOC").
 *      The name is the identifier; use the slot id only as a fallback.
 *
 * Lab in an .acb is D50 (the print reference), so it is adapted to D65 on read.
 * The values are also quantised to a single byte per channel, which is coarser
 * than an .ase LAB swatch — noted in the library metadata.
 *
 * @module parsers/acb
 */

import { createLibrary } from '../core/clf.js';
import { rgbToHex, labToHex, labD50ToLabD65 } from '../core/color-space.js';

const utf16be = new TextDecoder('utf-16be');

const SPACE_RGB = 0;
const SPACE_CMYK = 2;
const SPACE_LAB = 7;
const SPACE_GRAY = 8;

const COMPONENT_BYTES = {
  [SPACE_RGB]: 3,
  [SPACE_CMYK]: 4,
  [SPACE_LAB]: 3,
  [SPACE_GRAY]: 1,
};

const SPACE_NAMES = {
  [SPACE_RGB]: 'RGB',
  [SPACE_CMYK]: 'CMYK',
  [SPACE_LAB]: 'Lab',
  [SPACE_GRAY]: 'Grayscale',
};

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const round = (v, d = 4) => Math.round(v * 10 ** d) / 10 ** d;

function asBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  return null;
}

/**
 * @param {Uint8Array|ArrayBuffer} input
 * @returns {boolean}
 */
export function isAcb(input) {
  const u8 = asBytes(input);
  return (
    !!u8 &&
    u8.length >= 4 &&
    u8[0] === 0x38 &&
    u8[1] === 0x42 &&
    u8[2] === 0x43 &&
    u8[3] === 0x42
  );
}

/**
 * Adobe stores UI strings as localisation tokens such as
 * `$$$/colorbook/ANPA/title=ANPA Color`. Strip the token and expand the two
 * documented escapes.
 *
 * `trim` is off for the name prefix and suffix: Adobe pads them deliberately
 * ("ANPA " + code + " AdPro"), and trimming would run the words together.
 */
function cleanAdobeString(s, trim = true) {
  if (!s) return '';
  const m = String(s).match(/^(\$\$\$\/[^=]*=)([\s\S]*)$/);
  const value = m ? m[2] : String(s);
  const expanded = value.replace(/\^R/g, '\u00AE').replace(/\^C/g, '\u00A9');
  return trim ? expanded.trim() : expanded;
}

/**
 * The six bytes after the name are Adobe's internal slot id — a fixed-width
 * serial, not a colour code. Kept only as a fallback for a record whose name
 * field turns out to be empty or whitespace.
 */
function decodeSlotId(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s.replace(/\u0000/g, '').trim();
}

/**
 * Parse an ACB colour book into a CLF library.
 *
 * @param {Uint8Array|ArrayBuffer} input
 * @param {{name?:string,id?:string,system?:string,license?:string}} [options]
 * @returns {{library:object,format:string,warnings:string[],stats:object}}
 */
export function parseAcb(input, options = {}) {
  const u8 = asBytes(input);
  if (!u8) throw new TypeError('parseAcb expects a Uint8Array or ArrayBuffer');
  if (!isAcb(u8)) throw new Error('not an ACB file: "8BCB" signature missing');

  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const total = u8.length;
  const warnings = [];
  let pos = 4;

  const u16 = () => {
    if (pos + 2 > total) throw new RangeError(`truncated at offset ${pos}`);
    const v = view.getUint16(pos);
    pos += 2;
    return v;
  };
  const u32 = () => {
    if (pos + 4 > total) throw new RangeError(`truncated at offset ${pos}`);
    const v = view.getUint32(pos);
    pos += 4;
    return v;
  };
  const str = () => {
    const chars = u32(); // 32-bit length, unlike most Adobe formats
    const bytes = chars * 2;
    if (pos + bytes > total) throw new RangeError(`truncated string at offset ${pos}`);
    const slice = new Uint8Array(u8.buffer, u8.byteOffset + pos, bytes);
    pos += bytes;
    return utf16be.decode(slice);
  };

  const version = u16();
  const bookId = u16();
  const title = cleanAdobeString(str());
  const prefix = cleanAdobeString(str(), false);
  const suffix = cleanAdobeString(str(), false);
  const description = cleanAdobeString(str());
  const colorCount = u16();
  const pageSize = u16();
  const pageSelector = u16();
  const spaceId = u16();

  const componentBytes = COMPONENT_BYTES[spaceId];
  const spaceName = SPACE_NAMES[spaceId];

  if (!componentBytes) {
    throw new Error(
      `unsupported ACB colour space ${spaceId}; this parser handles RGB (0), CMYK (2), Lab (7) and Grayscale (8)`
    );
  }

  const colors = [];
  let padding = 0;
  let skipped = 0;

  for (let i = 0; i < colorCount; i++) {
    let name;
    try {
      name = str();
    } catch (err) {
      warnings.push(`record ${i}: ${err.message}`);
      skipped++;
      break;
    }

    if (!name) {
      // Padding record inserted to keep pages tidy — its remaining fields
      // carry nothing meaningful but still occupy space.
      pos += 6 + componentBytes;
      padding++;
      continue;
    }

    if (pos + 6 + componentBytes > total) {
      warnings.push(`record ${i}: truncated`);
      skipped++;
      break;
    }

    const slotId = decodeSlotId(u8.subarray(pos, pos + 6));
    pos += 6;

    let hex = null;
    let rgb = null;
    let cmyk = null;
    let lab = null;

    if (spaceId === SPACE_RGB) {
      rgb = [u8[pos], u8[pos + 1], u8[pos + 2]];
      pos += 3;
      hex = rgbToHex(rgb);
    } else if (spaceId === SPACE_CMYK) {
      // Bytes are inverted and quantised: 255 -> 0%, 0 -> 100%.
      cmyk = [0, 1, 2, 3].map((k) =>
        clamp(Math.round((255 - u8[pos + k]) / 2.55), 0, 100)
      );
      pos += 4;
      const [c, m, y, kk] = cmyk.map((v) => v / 100);
      rgb = [
        Math.round(255 * (1 - c) * (1 - kk)),
        Math.round(255 * (1 - m) * (1 - kk)),
        Math.round(255 * (1 - y) * (1 - kk)),
      ];
      hex = rgbToHex(rgb);
    } else if (spaceId === SPACE_LAB) {
      const l = (u8[pos] / 2.55) * 1.0;
      const a = u8[pos + 1] - 128;
      const b = u8[pos + 2] - 128;
      pos += 3;
      lab = labD50ToLabD65([l, a, b]).map((v) => round(v, 3));
      hex = labToHex(lab);
    } else {
      const g = u8[pos];
      pos += 1;
      rgb = [g, g, g];
      hex = rgbToHex(rgb);
    }

    // Photoshop CS and later append an 8-byte marker identifying the book as
    // spot or process. Older files omit it, so only consume a real marker.
    let spot = null;
    if (pos + 8 <= total) {
      const tag = String.fromCharCode(u8[pos], u8[pos + 1], u8[pos + 2], u8[pos + 3]);
      if (tag === 'spfl') {
        spot = String.fromCharCode(...u8.subarray(pos, pos + 8)) === 'spflspot';
        pos += 8;
      }
    }

    // The name is the identifier. An .acb's own `prefix` / `suffix` header
    // fields supply the decorative parts, so "PANTONE " + "Yellow" + " C"
    // composes back to the label Adobe's own UI shows.
    const entry = { code: cleanAdobeString(name) || slotId, name: null, hex };
    if (rgb) entry.rgb = rgb;
    if (cmyk) entry.cmyk = cmyk;
    if (lab) entry.lab = lab;
    if (spot === true) entry.spot = true;

    colors.push(entry);
  }

  const resolvedName = options.name ?? title ?? `ACB book ${bookId}`;

  const library = createLibrary({
    name: resolvedName,
    id: options.id,
    system: options.system ?? 'CUSTOM',
    prefix: options.prefix ?? (prefix || null),
    suffix: options.suffix ?? (suffix || null),
    source: options.source ?? `imported from .acb (book ${bookId})`,
    license: options.license ?? 'unknown',
    colors,
    note:
      `Adobe Color Book v${version}, book id ${bookId}, ${spaceName} source` +
      (pageSize ? `, ${pageSize} per page` : '') +
      (padding ? `, ${padding} padding records skipped` : '') +
      (spaceId === SPACE_LAB
        ? '. Lab values are 8-bit quantised per channel and were adapted from D50 to D65.'
        : '') +
      (description ? ` — ${description}` : ''),
  });

  if (padding) warnings.push(`${padding} padding records skipped (empty name)`);

  return {
    library,
    format: 'acb',
    warnings,
    stats: { total: colorCount, parsed: colors.length, skipped },
  };
}

export default parseAcb;
