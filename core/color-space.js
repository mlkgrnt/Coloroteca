/**
 * Coloroteca — colour space conversions.
 *
 * Standard CIE maths, no dependencies:
 *   sRGB (IEC 61966-2-1) -> linear RGB -> XYZ (D65) -> CIELAB (D65)
 *
 * The sRGB transfer function used here is the *piecewise* standard curve, not
 * the widespread gamma-2.2 approximation. The approximation introduces visible
 * error in dark tones — precisely the region colour matching cares about.
 *
 * RGB triples are [0..255] integers unless the name says otherwise.
 *
 * @module core/color-space
 */

/** CIE standard illuminant D65, normalised to Y = 1. The sRGB reference. */
export const WHITE_D65 = Object.freeze({ X: 0.95047, Y: 1.0, Z: 1.08883 });

/**
 * CIE standard illuminant D50.
 *
 * Adobe defines its LAB swatches and colour books against D50 — it is the
 * print-oriented reference. Those values must be chromatographically adapted
 * before they can be compared against Lab derived from screen sRGB, or every
 * match carries a systematic bias.
 */
export const WHITE_D50 = Object.freeze({ X: 0.96422, Y: 1.0, Z: 0.82521 });

/** Bradford cone-response matrix, and its inverse. */
const BRADFORD = [
  [0.8951, 0.2664, -0.1614],
  [-0.7502, 1.7135, 0.0367],
  [0.0389, -0.0685, 1.0296],
];
const BRADFORD_INV = [
  [0.9869929, -0.1470543, 0.1599627],
  [0.4323053, 0.5183603, 0.0492912],
  [-0.0085287, 0.0400428, 0.9684867],
];

const DELTA3 = 216 / 24389; // (6/29)^3
const K = 841 / 108; // (1/3) * (29/6)^2

const M_RGB_XYZ = [
  [0.4124564, 0.3575761, 0.1804375],
  [0.2126729, 0.7151522, 0.072175],
  [0.0193339, 0.119192, 0.9503041],
];

const M_XYZ_RGB = [
  [3.2404542, -1.5371385, -0.4985314],
  [-0.969266, 1.8760108, 0.041556],
  [0.0556434, -0.2040259, 1.0572252],
];

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const toDeg = (rad) => (rad * 180) / Math.PI;
const toRad = (deg) => (deg * Math.PI) / 180;

/** Lab f() helper. */
function labF(t) {
  return t > DELTA3 ? Math.cbrt(t) : K * t + 4 / 29;
}

/** Inverse of labF(). */
function labFInv(t) {
  return t > 6 / 29 ? t * t * t : (t - 4 / 29) / K;
}

// ---------------------------------------------------------------- hex / rgb

/**
 * Normalise any hex spelling to `#rrggbb` (lowercase).
 * Accepts `#fff`, `fff`, `#FFFFFF`, `FFFFFF`. Returns null when unparseable.
 *
 * @param {string} input
 * @returns {string|null}
 */
export function normalizeHex(input) {
  if (typeof input !== 'string') return null;
  let s = input.trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{3}$/.test(s)) {
    s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  }
  return /^[0-9a-f]{6}$/.test(s) ? '#' + s : null;
}

/**
 * @param {string} hex
 * @returns {[number,number,number]|null} RGB 0..255
 */
export function hexToRgb(hex) {
  const h = normalizeHex(hex);
  if (!h) return null;
  return [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16),
  ];
}

/**
 * @param {[number,number,number]} rgb 0..255
 * @returns {string} `#rrggbb`
 */
export function rgbToHex(rgb) {
  return (
    '#' +
    rgb
      .map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0'))
      .join('')
  );
}

// ------------------------------------------------------------- transfer fn

/**
 * sRGB channel (0..1) to linear-light (0..1). Piecewise standard curve.
 * @param {number} v
 */
export function srgbToLinear(v) {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/**
 * Linear-light (0..1) to sRGB channel (0..1).
 * @param {number} v
 */
export function linearToSrgb(v) {
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

// -------------------------------------------------------------- rgb -> lab

/**
 * @param {[number,number,number]} rgb 0..255
 * @returns {[number,number,number]} CIELAB, D65
 */
export function rgbToXyz(rgb) {
  const lin = rgb.map((v) => srgbToLinear(clamp(v, 0, 255) / 255));
  return M_RGB_XYZ.map((row) => row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2]);
}

/**
 * @param {[number,number,number]} xyz
 * @param {{X:number,Y:number,Z:number}} [wp] reference white, defaults to D65
 * @returns {[number,number,number]} CIELAB
 */
export function xyzToLab(xyz, wp = WHITE_D65) {
  const fx = labF(xyz[0] / wp.X);
  const fy = labF(xyz[1] / wp.Y);
  const fz = labF(xyz[2] / wp.Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/**
 * @param {[number,number,number]} rgb 0..255
 * @returns {[number,number,number]} CIELAB, D65
 */
export function rgbToLab(rgb) {
  return xyzToLab(rgbToXyz(rgb));
}

/**
 * @param {string} hex
 * @returns {[number,number,number]|null}
 */
export function hexToLab(hex) {
  const rgb = hexToRgb(hex);
  return rgb ? rgbToLab(rgb) : null;
}

// -------------------------------------------------------------- lab -> rgb

/**
 * @param {[number,number,number]} lab
 * @param {{X:number,Y:number,Z:number}} [wp] reference white, defaults to D65
 * @returns {[number,number,number]} XYZ
 */
export function labToXyz(lab, wp = WHITE_D65) {
  const fy = (lab[0] + 16) / 116;
  const fx = lab[1] / 500 + fy;
  const fz = fy - lab[2] / 200;
  return [
    labFInv(fx) * wp.X,
    labFInv(fy) * wp.Y,
    labFInv(fz) * wp.Z,
  ];
}

/**
 * @param {[number,number,number]} xyz
 * @returns {[number,number,number]} RGB 0..255 (may be out of gamut before clamping)
 */
export function xyzToRgb(xyz) {
  const lin = M_XYZ_RGB.map(
    (row) => row[0] * xyz[0] + row[1] * xyz[1] + row[2] * xyz[2]
  );
  return lin.map((v) => linearToSrgb(v) * 255);
}

/**
 * @param {[number,number,number]} lab
 * @returns {[number,number,number]} RGB 0..255, clamped into gamut
 */
export function labToRgb(lab) {
  return xyzToRgb(labToXyz(lab)).map((v) => clamp(Math.round(v), 0, 255));
}

/**
 * @param {[number,number,number]} lab
 * @returns {string}
 */
export function labToHex(lab) {
  return rgbToHex(labToRgb(lab));
}

/**
 * True when a Lab colour falls outside the sRGB gamut.
 * @param {[number,number,number]} lab
 * @returns {boolean}
 */
export function isOutOfGamut(lab) {
  return xyzToRgb(labToXyz(lab)).some((v) => v < -0.5 || v > 255.5);
}

// ------------------------------------------------------------------- hsl

/**
 * @param {[number,number,number]} rgb 0..255
 * @returns {[number,number,number]} [h 0..360, s 0..100, l 0..100]
 */
export function rgbToHsl(rgb) {
  const [r, g, b] = rgb.map((v) => clamp(v, 0, 255) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l * 100];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return [h, s * 100, l * 100];
}

/**
 * @param {[number,number,number]} hsl [h 0..360, s 0..100, l 0..100]
 * @returns {[number,number,number]} RGB 0..255
 */
export function hslToRgb(hsl) {
  const h = ((hsl[0] % 360) + 360) % 360;
  const s = clamp(hsl[1], 0, 100) / 100;
  const l = clamp(hsl[2], 0, 100) / 100;
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  const hk = h / 360;
  return [
    Math.round(hue(hk + 1 / 3) * 255),
    Math.round(hue(hk) * 255),
    Math.round(hue(hk - 1 / 3) * 255),
  ];
}

// ------------------------------------------------------------------- lch

/**
 * CIELAB to cylindrical LCh.
 * @param {[number,number,number]} lab
 * @returns {[number,number,number]} [L, C, h 0..360]
 */
export function labToLch(lab) {
  const c = Math.sqrt(lab[1] * lab[1] + lab[2] * lab[2]);
  let h = toDeg(Math.atan2(lab[2], lab[1]));
  if (h < 0) h += 360;
  return [lab[0], c, h];
}

/**
 * @param {[number,number,number]} lch [L, C, h 0..360]
 * @returns {[number,number,number]} CIELAB
 */
export function lchToLab(lch) {
  const rad = toRad(lch[2]);
  return [lch[0], Math.cos(rad) * lch[1], Math.sin(rad) * lch[1]];
}

// --------------------------------------------------- chromatic adaptation

function mulMV(m, v) {
  return m.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);
}

function mulMM(a, b) {
  const out = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      out[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
    }
  }
  return out;
}

/**
 * Bradford chromatic adaptation matrix taking a colour from one reference
 * white to another.
 *
 * @param {{X:number,Y:number,Z:number}} fromWP
 * @param {{X:number,Y:number,Z:number}} toWP
 * @returns {number[][]} 3x3 row-major matrix
 */
export function adaptationMatrix(fromWP, toWP) {
  const src = mulMV(BRADFORD, [fromWP.X, fromWP.Y, fromWP.Z]);
  const dst = mulMV(BRADFORD, [toWP.X, toWP.Y, toWP.Z]);
  const scale = [dst[0] / src[0], dst[1] / src[1], dst[2] / src[2]];
  const scaled = BRADFORD.map((row, i) => row.map((v) => v * scale[i]));
  return mulMM(BRADFORD_INV, scaled);
}

/**
 * Adapt an XYZ tristimulus value between reference whites.
 * @param {[number,number,number]} xyz
 * @param {{X:number,Y:number,Z:number}} fromWP
 * @param {{X:number,Y:number,Z:number}} toWP
 * @returns {[number,number,number]}
 */
export function adaptXyz(xyz, fromWP, toWP) {
  return mulMV(adaptationMatrix(fromWP, toWP), xyz);
}

/**
 * Re-express a CIELAB value under a different reference white.
 * @param {[number,number,number]} lab
 * @param {{X:number,Y:number,Z:number}} fromWP
 * @param {{X:number,Y:number,Z:number}} toWP
 * @returns {[number,number,number]}
 */
export function labToLab(lab, fromWP, toWP) {
  return xyzToLab(adaptXyz(labToXyz(lab, fromWP), fromWP, toWP), toWP);
}

/**
 * Convert an Adobe D50 Lab value into the D65 Lab that Coloroteca works in.
 * Applied to every LAB swatch read from .ase and .acb files.
 *
 * @param {[number,number,number]} lab
 * @returns {[number,number,number]}
 */
export function labD50ToLabD65(lab) {
  return labToLab(lab, WHITE_D50, WHITE_D65);
}

// --------------------------------------------------------------- parsing

/**
 * Parse a user-supplied colour string into a canonical object.
 * Understands hex (3/6 digit, optional `#`), `rgb(r,g,b)`, bare `r,g,b`,
 * and `hsl(h,s%,l%)`. Returns null when nothing parses.
 *
 * @param {string} text
 * @returns {{hex:string, rgb:[number,number,number], lab:[number,number,number], input:string}|null}
 */
export function parseColorInput(text) {
  if (typeof text !== 'string') return null;
  const raw = text.trim();
  if (!raw) return null;

  const build = (rgb, input) => ({
    hex: rgbToHex(rgb),
    rgb: rgb.map((v) => clamp(Math.round(v), 0, 255)),
    lab: rgbToLab(rgb),
    input,
  });

  const hex = normalizeHex(raw);
  if (hex) return build(hexToRgb(hex), raw);

  let m = raw.match(/^rgba?\(\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*[,\s]\s*([\d.]+)/i);
  if (m) return build([+m[1], +m[2], +m[3]], raw);

  m = raw.match(/^hsl\(\s*([\d.]+)\s*[,\s]\s*([\d.]+)%?\s*[,\s]\s*([\d.]+)%?/i);
  if (m) return build(hslToRgb([+m[1], +m[2], +m[3]]), raw);

  m = raw.match(/^([\d.]+)\s*[,\s]\s*([\d.]+)\s*[,\s]\s*([\d.]+)$/);
  if (m) {
    const vals = [+m[1], +m[2], +m[3]];
    if (vals.every((v) => v >= 0 && v <= 255)) return build(vals, raw);
  }

  return null;
}
