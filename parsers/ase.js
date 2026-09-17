/**
 * Adobe Swatch Exchange (.ase) parser.
 *
 * ASE is the interchange format Adobe applications write, and it is the format
 * Freetone ships as. Big-endian throughout:
 *
 *   offset  size  field
 *   0       4     "ASEF"
 *   4       2     version major
 *   6       2     version minor
 *   8       4     block count        <- blocks, NOT colours
 *   12      ..    blocks
 *
 * Each block opens with a uint16 type and a uint32 byte length. The declared
 * length is authoritative: we resynchronise on it after every block, so one
 * malformed entry cannot derail the rest of the file.
 *
 * Note that LAB swatches are defined against D50 and are adapted to D65 on
 * read — comparing them raw against sRGB-derived Lab would bias every match.
 *
 * @module parsers/ase
 */

import { createLibrary } from '../core/clf.js';
import { rgbToHex, labToHex, labD50ToLabD65 } from '../core/color-space.js';

const BLOCK_COLOR = 0x0001;
const BLOCK_GROUP_START = 0xc001;
const BLOCK_GROUP_END = 0xc002;

const utf16be = new TextDecoder('utf-16be');
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
 * Cheap signature test, for format sniffing.
 * @param {Uint8Array|ArrayBuffer} input
 * @returns {boolean}
 */
export function isAse(input) {
  const u8 = asBytes(input);
  return (
    !!u8 &&
    u8.length >= 4 &&
    u8[0] === 0x41 &&
    u8[1] === 0x53 &&
    u8[2] === 0x45 &&
    u8[3] === 0x46
  );
}

/**
 * Naive CMYK to RGB. Only used when a swatch is CMYK-only and therefore has no
 * in-gamut screen equivalent to begin with — treat the result as indicative.
 */
function cmykToRgb(cmyk) {
  const [c, m, y, k] = cmyk.map((v) => clamp(v, 0, 100) / 100);
  return [
    Math.round(255 * (1 - c) * (1 - k)),
    Math.round(255 * (1 - m) * (1 - k)),
    Math.round(255 * (1 - y) * (1 - k)),
  ];
}

/**
 * Parse an ASE file into a CLF library.
 *
 * @param {Uint8Array|ArrayBuffer} input
 * @param {{name?:string,id?:string,system?:string,prefix?:string,suffix?:string,
 *          source?:string,license?:string}} [options]
 * @returns {{library:object,format:string,warnings:string[],stats:object}}
 */
export function parseAse(input, options = {}) {
  const u8 = asBytes(input);
  if (!u8) throw new TypeError('parseAse expects a Uint8Array or ArrayBuffer');
  if (!isAse(u8)) throw new Error('not an ASE file: "ASEF" signature missing');

  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const total = u8.length;
  const warnings = [];
  let pos = 0;

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
  const f32 = () => {
    if (pos + 4 > total) throw new RangeError(`truncated at offset ${pos}`);
    const v = view.getFloat32(pos);
    pos += 4;
    return v;
  };
  const str = () => {
    const units = u16();
    const bytes = units * 2;
    if (pos + bytes > total) throw new RangeError(`truncated string at offset ${pos}`);
    const slice = new Uint8Array(u8.buffer, u8.byteOffset + pos, bytes);
    pos += bytes;
    return utf16be.decode(slice).replace(/\0+$/, '');
  };

  pos = 4;
  const versionMajor = u16();
  const versionMinor = u16();
  const blockCount = u32();

  const colors = [];
  const groups = [];
  let skipped = 0;

  for (let b = 0; b < blockCount; b++) {
    if (pos + 6 > total) {
      warnings.push(`file ended after ${b} of ${blockCount} blocks`);
      break;
    }
    const type = u16();
    const length = u32();
    const blockEnd = pos + length;

    try {
      if (type === BLOCK_COLOR) {
        const name = str();

        if (pos + 4 > total) throw new RangeError('colour block has no model field');
        const model = String.fromCharCode(u8[pos], u8[pos + 1], u8[pos + 2], u8[pos + 3])
          .trim()
          .toUpperCase();
        pos += 4;

        let hex = null;
        let rgb = null;
        let cmyk = null;
        let lab = null;

        if (model === 'RGB') {
          const r = f32();
          const g = f32();
          const bl = f32();
          rgb = [r, g, bl].map((v) => clamp(Math.round(v * 255), 0, 255));
          hex = rgbToHex(rgb);
        } else if (model === 'CMYK') {
          cmyk = [f32(), f32(), f32(), f32()].map((v) => clamp(Math.round(v * 100), 0, 100));
          rgb = cmykToRgb(cmyk);
          hex = rgbToHex(rgb);
        } else if (model === 'LAB') {
          const raw = [f32(), f32(), f32()];
          lab = labD50ToLabD65(raw).map((v) => round(v, 4));
          hex = labToHex(lab);
        } else if (model === 'GRAY') {
          const g = f32();
          const v = clamp(Math.round(g * 255), 0, 255);
          rgb = [v, v, v];
          hex = rgbToHex(rgb);
        } else {
          skipped++;
          warnings.push(`block ${b}: unknown colour model ${JSON.stringify(model)}`);
          pos = blockEnd;
          continue;
        }

        const colorType = u16(); // 0 global, 1 spot, 2 normal

        const entry = { code: name || hex.slice(1), name: null, hex };
        if (rgb) entry.rgb = rgb;
        if (cmyk) entry.cmyk = cmyk;
        if (lab) entry.lab = lab;
        if (colorType === 1) entry.spot = true;

        colors.push(entry);
      } else if (type === BLOCK_GROUP_START) {
        const groupName = str();
        if (groupName) groups.push(groupName);
      } else if (type === BLOCK_GROUP_END) {
        // no payload
      } else {
        skipped++;
        warnings.push(`block ${b}: unrecognised block type 0x${type.toString(16)}`);
      }
    } catch (err) {
      skipped++;
      warnings.push(`block ${b}: ${err.message}`);
    }

    pos = blockEnd; // resynchronise on the declared length
  }

  const library = createLibrary({
    name: options.name ?? (groups[0] ? `ASE — ${groups[0]}` : 'ASE library'),
    id: options.id,
    system: options.system ?? 'CUSTOM',
    prefix: options.prefix ?? null,
    suffix: options.suffix ?? null,
    source: options.source ?? 'imported from .ase',
    license: options.license ?? 'unknown',
    colors,
    note:
      `ASE ${versionMajor}.${versionMinor}; ${blockCount} blocks` +
      (groups.length ? `; groups: ${groups.join(', ')}` : ''),
  });

  return {
    library,
    format: 'ase',
    warnings,
    stats: { total: blockCount, parsed: colors.length, skipped },
  };
}

export default parseAse;
