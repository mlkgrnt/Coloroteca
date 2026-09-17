/**
 * Coloroteca — colour difference metrics.
 *
 * Implements CIE76, CIE94 and CIEDE2000. CIEDE2000 follows Sharma, Wu & Dalal
 * (2005) step by step; that paper documents several traps that pass the small
 * worked example bundled with the standard but fail on the supplementary data:
 *
 *   - the hue-difference branch when C'1 * C'2 === 0
 *   - the mean-hue branch when |h'1 - h'2| > 180 AND h'1 + h'2 >= 360
 *   - all trigonometric arguments are in DEGREES and need conversion
 *   - the sign of R_T
 *
 * Verification uses the official 34-pair dataset (tests/sharma-ciede2000.json).
 *
 * @module core/delta-e
 */

const POW25_7 = 6103515625; // 25^7

const toRad = (deg) => (deg * Math.PI) / 180;
const hypot = (x, y) => Math.sqrt(x * x + y * y);

/**
 * Hue angle in degrees, [0, 360). Returns 0 for the achromatic origin,
 * matching the CIEDE2000 definition of h' when a' = b' = 0.
 * @param {number} b
 * @param {number} ap
 */
function hueAngle(b, ap) {
  if (ap === 0 && b === 0) return 0;
  const h = (Math.atan2(b, ap) * 180) / Math.PI;
  return h < 0 ? h + 360 : h;
}

/**
 * CIE76 colour difference — plain Euclidean distance in CIELAB.
 * Kept for comparison only; it is markedly less perceptually uniform
 * than CIEDE2000 and its JND (~2.3) is not interchangeable with CIEDE2000's (~1.0).
 *
 * @param {[number,number,number]} lab1
 * @param {[number,number,number]} lab2
 * @returns {number}
 */
export function deltaE76(lab1, lab2) {
  const dL = lab1[0] - lab2[0];
  const da = lab1[1] - lab2[1];
  const db = lab1[2] - lab2[2];
  return Math.sqrt(dL * dL + da * da + db * db);
}

/**
 * CIE94 colour difference.
 *
 * @param {[number,number,number]} lab1 reference
 * @param {[number,number,number]} lab2 sample
 * @param {{kL?:number,kC?:number,kH?:number,application?:'graphic'|'textile'}} [options]
 * @returns {number}
 */
export function deltaE94(lab1, lab2, options = {}) {
  const application = options.application ?? 'graphic';
  const kL = options.kL ?? 1;
  const kC = options.kC ?? 1;
  const kH = options.kH ?? 1;
  const K1 = application === 'textile' ? 0.048 : 0.045;
  const K2 = application === 'textile' ? 0.014 : 0.015;

  const dL = lab1[0] - lab2[0];
  const C1 = hypot(lab1[1], lab1[2]);
  const C2 = hypot(lab2[1], lab2[2]);
  const dC = C1 - C2;
  const da = lab1[1] - lab2[1];
  const db = lab1[2] - lab2[2];
  const dH2 = da * da + db * db - dC * dC;
  const dH = dH2 > 0 ? Math.sqrt(dH2) : 0;

  const SL = 1;
  const SC = 1 + K1 * C1;
  const SH = 1 + K2 * C1;

  const tL = dL / (kL * SL);
  const tC = dC / (kC * SC);
  const tH = dH / (kH * SH);
  return Math.sqrt(tL * tL + tC * tC + tH * tH);
}

/**
 * CIEDE2000 colour difference.
 *
 * @param {[number,number,number]} lab1 reference
 * @param {[number,number,number]} lab2 sample
 * @param {{kL?:number,kC?:number,kH?:number}} [options] kL = 1 for graphic arts
 *        (the default), kL = 2 for textiles, where surface texture reduces
 *        sensitivity to lightness differences.
 * @returns {number}
 */
export function deltaE2000(lab1, lab2, options = {}) {
  const kL = options.kL ?? 1;
  const kC = options.kC ?? 1;
  const kH = options.kH ?? 1;

  const L1 = lab1[0];
  const a1 = lab1[1];
  const b1 = lab1[2];
  const L2 = lab2[0];
  const a2 = lab2[1];
  const b2 = lab2[2];

  // Step 1 — a-axis rescaling to correct the CIELAB blue region.
  const C1 = hypot(a1, b1);
  const C2 = hypot(a2, b2);
  const Cbar = (C1 + C2) / 2;
  const Cbar7 = Math.pow(Cbar, 7);
  const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + POW25_7)));

  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = hypot(a1p, b1);
  const C2p = hypot(a2p, b2);
  const h1p = hueAngle(b1, a1p);
  const h2p = hueAngle(b2, a2p);

  // Step 2 — differences.
  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  const C1pC2p = C1p * C2p;

  let dhp;
  if (C1pC2p === 0) {
    dhp = 0;
  } else {
    const raw = h2p - h1p;
    if (Math.abs(raw) <= 180) dhp = raw;
    else if (raw > 180) dhp = raw - 360;
    else dhp = raw + 360;
  }
  const dHp = 2 * Math.sqrt(C1pC2p) * Math.sin(toRad(dhp) / 2);

  // Step 3 — CIEDE2000 weighting functions.
  const Lbar = (L1 + L2) / 2;
  const Cbarp = (C1p + C2p) / 2;

  let hbar;
  if (C1pC2p === 0) {
    hbar = h1p + h2p;
  } else {
    const sum = h1p + h2p;
    if (Math.abs(h1p - h2p) <= 180) hbar = sum / 2;
    else if (sum < 360) hbar = (sum + 360) / 2;
    else hbar = (sum - 360) / 2;
  }

  const T =
    1 -
    0.17 * Math.cos(toRad(hbar - 30)) +
    0.24 * Math.cos(toRad(2 * hbar)) +
    0.32 * Math.cos(toRad(3 * hbar + 6)) -
    0.2 * Math.cos(toRad(4 * hbar - 63));

  const dTheta = 30 * Math.exp(-Math.pow((hbar - 275) / 25, 2));
  const Cbarp7 = Math.pow(Cbarp, 7);
  const RC = 2 * Math.sqrt(Cbarp7 / (Cbarp7 + POW25_7));
  const RT = -Math.sin(toRad(2 * dTheta)) * RC;

  const dL50 = Lbar - 50;
  const SL = 1 + (0.015 * dL50 * dL50) / Math.sqrt(20 + dL50 * dL50);
  const SC = 1 + 0.045 * Cbarp;
  const SH = 1 + 0.015 * Cbarp * T;

  // Step 4 — combine.
  const tL = dLp / (kL * SL);
  const tC = dCp / (kC * SC);
  const tH = dHp / (kH * SH);

  return Math.sqrt(tL * tL + tC * tC + tH * tH + RT * tC * tH);
}

/**
 * Build a reusable difference function, so a batch match resolves the formula
 * and weights once instead of per candidate.
 *
 * @param {{formula?:'CIEDE2000'|'CIE94'|'CIE76', kL?:number, kC?:number, kH?:number,
 *          application?:'graphic'|'textile'}} [options]
 * @returns {(lab1:[number,number,number], lab2:[number,number,number])=>number}
 */
export function createDeltaE(options = {}) {
  const formula = (options.formula ?? 'CIEDE2000').toUpperCase();
  const opts = {
    kL: options.kL ?? 1,
    kC: options.kC ?? 1,
    kH: options.kH ?? 1,
    application: options.application ?? 'graphic',
  };
  if (formula === 'CIE76' || formula === 'DELTAE76') return deltaE76;
  if (formula === 'CIE94' || formula === 'DELTAE94') {
    return (a, b) => deltaE94(a, b, opts);
  }
  return (a, b) => deltaE2000(a, b, opts);
}

/**
 * kL weighting implied by a colour library's system.
 * TCX / Fashion, Home + Interiors is a textile standard, so it gets kL = 2.
 *
 * @param {string} [system]
 * @returns {1|2}
 */
export function klForSystem(system) {
  const s = String(system ?? '').toUpperCase();
  return s === 'TCX' || s === 'TPG' || s === 'TEXTILE' ? 2 : 1;
}

/**
 * Perceptual grade for a CIEDE2000 value.
 *
 * The thresholds are CIEDE2000's own. Do not reuse the CIE76 scale — its
 * just-noticeable difference sits around 2.3, more than twice CIEDE2000's ~1.0.
 *
 * @param {number} dE
 * @returns {{level:string, label:string, max:number}}
 */
export function deltaGrade(dE) {
  if (dE < 1) return { level: 'imperceptible', label: '肉眼几乎无法分辨', max: 1 };
  if (dE < 2) return { level: 'trained', label: '专业受过训练的眼睛可辨', max: 2 };
  if (dE < 3.5) return { level: 'noticeable', label: '一般观察者可辨', max: 3.5 };
  if (dE < 5) return { level: 'distinct', label: '明显不同色', max: 5 };
  return { level: 'different', label: '基本算两种颜色', max: Infinity };
}

/**
 * Break a difference down into its components, so a result can explain *how*
 * two colours differ rather than only by how much.
 *
 * `dL` is positive when the sample is lighter, `dC` positive when it is more
 * chromatic, `dH` is the residual hue contribution (always non-negative).
 *
 * @param {[number,number,number]} lab1 reference
 * @param {[number,number,number]} lab2 sample
 * @returns {{dL:number, dC:number, dH:number, dE76:number}}
 */
export function deltaBreakdown(lab1, lab2) {
  const dL = lab2[0] - lab1[0];
  const C1 = hypot(lab1[1], lab1[2]);
  const C2 = hypot(lab2[1], lab2[2]);
  const dC = C2 - C1;
  const da = lab2[1] - lab1[1];
  const db = lab2[2] - lab1[2];
  const dH2 = da * da + db * db - dC * dC;
  return {
    dL,
    dC,
    dH: dH2 > 0 ? Math.sqrt(dH2) : 0,
    dE76: deltaE76(lab1, lab2),
  };
}
