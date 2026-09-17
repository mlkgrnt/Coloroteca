/**
 * Coloroteca — web UI.
 *
 * The page is a thin shell over core/: every colour conversion and every
 * distance calculation comes from the shared modules, so the browser and the
 * command-line tool can never disagree about a result.
 *
 * @module web/app
 */

import {
  parseColorInput,
  hexToRgb,
  rgbToHex,
  rgbToHsl,
  hslToRgb,
} from '../core/color-space.js';
import { prepareLibrary, matchPrepared, matchBatch, lookupByCode, resolveInput } from '../core/matcher.js';
import { validateLibrary } from '../core/clf.js';
import { isAse, parseAse } from '../parsers/ase.js';
import { isAcb, parseAcb } from '../parsers/acb.js';
import { parseAny } from '../parsers/index.js';
import { DEMO_LIBRARIES } from './demo-libraries.js';
import {
  DEFAULT_SETTINGS,
  clearStoredLibraries,
  deleteStoredLibrary,
  isUsingFallback,
  listStoredLibraries,
  loadSettings,
  putStoredLibrary,
  saveSettings,
} from './store.js';

/* ══════════════════════════════════ state ══════════════════════════════════ */

const state = {
  settings: loadSettings(),
  /** @type {Array<{id:string,name:string,system:string,count:number,source:string,license:string,origin:string,builtin:boolean,doc:object}>} */
  libraries: [],
  activeId: null,
  /** prepared-library cache, keyed by library id */
  prepared: new Map(),
  /** current input as canonical rgb; every control syncs from this */
  rgb: [255, 107, 107],
  lastResult: null,
  batchRows: null,
};

const SUPPORTED_EXTENSIONS = ['.json', '.ase', '.acb', '.gpl', '.txt', '.csv', '.tsv', '.css'];

/* ═══════════════════════════════════ dom ═══════════════════════════════════ */

const $ = (id) => document.getElementById(id);

const dom = {
  librarySelect: $('library-select'),
  btnLibraries: $('btn-libraries'),
  btnImport: $('btn-import'),
  btnSettings: $('btn-settings'),

  tabSingle: $('tab-single'),
  tabBatch: $('tab-batch'),
  viewSingle: $('view-single'),
  viewBatch: $('view-batch'),

  previewSwatch: $('preview-swatch'),
  previewHex: $('preview-hex'),
  previewNote: $('preview-note'),

  inHex: $('in-hex'),
  hexError: $('hex-error'),
  inPicker: $('in-picker'),
  btnEyedropper: $('btn-eyedropper'),

  inR: $('in-r'), inRRange: $('in-r-range'),
  inG: $('in-g'), inGRange: $('in-g-range'),
  inB: $('in-b'), inBRange: $('in-b-range'),

  inH: $('in-h'), inHRange: $('in-h-range'),
  inS: $('in-s'), inSRange: $('in-s-range'),
  inL: $('in-l'), inLRange: $('in-l-range'),

  inCode: $('in-code'),
  btnLookup: $('btn-lookup'),
  lookupResult: $('lookup-result'),

  inBatch: $('in-batch'),
  btnBatchRun: $('btn-batch-run'),
  btnBatchCsv: $('btn-batch-csv'),
  batchStat: $('batch-stat'),
  batchOutput: $('batch-output'),

  resultMeta: $('result-meta'),
  resultList: $('result-list'),
  btnCopyAll: $('btn-copy-all'),
  btnExportCsv: $('btn-export-csv'),

  dlgImport: $('dlg-import'),
  dropzone: $('dropzone'),
  inFiles: $('in-files'),
  inFolder: $('in-folder'),
  inPaste: $('in-paste'),
  inPasteName: $('in-paste-name'),
  btnPasteImport: $('btn-paste-import'),
  importReport: $('import-report'),

  dlgLibraries: $('dlg-libraries'),
  libraryList: $('library-list'),

  dlgSettings: $('dlg-settings'),
  setFormula: $('set-formula'),
  setKl: $('set-kl'),
  setTop: $('set-top'),
  setThreshold: $('set-threshold'),
  btnSettingsReset: $('btn-settings-reset'),
};

/* ══════════════════════════════ small helpers ═══════════════════════════════ */

const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));

function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

/** Clipboard access is not guaranteed (file://, non-secure context). */
async function copyText(text, button) {
  let ok = true;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      ok = document.execCommand('copy');
      ta.remove();
    }
  } catch {
    ok = false;
  }
  if (button) {
    const original = button.textContent;
    button.textContent = ok ? '已复制' : '复制失败';
    setTimeout(() => { button.textContent = original; }, 1200);
  }
  return ok;
}

function download(filename, contents, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Excel needs a byte-order mark and CRLF to read UTF-8 CSV correctly. */
const toCsv = (rows) =>
  '\uFEFF' +
  rows
    .map((row) =>
      row
        .map((cell) => {
          const s = String(cell ?? '');
          return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(',')
    )
    .join('\r\n');

let debounceTimer = null;
function debounce(fn, ms) {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(fn, ms);
}

/* ═══════════════════════════════ libraries ═════════════════════════════════ */

function builtinRecords() {
  return DEMO_LIBRARIES.map((doc) => {
    const check = validateLibrary(doc);
    return {
      id: doc.id,
      name: doc.meta?.name ?? doc.id,
      system: doc.meta?.system ?? 'CUSTOM',
      count: doc.colors?.length ?? 0,
      source: doc.meta?.source ?? 'unknown',
      license: doc.meta?.license ?? 'unknown',
      origin: '内置示例',
      builtin: true,
      doc,
      warnings: [...check.warnings, ...(check.valid ? [] : check.errors)],
    };
  });
}

async function loadLibraries() {
  const stored = await listStoredLibraries();

  // An imported library with the same id as a built-in replaces it, so a user
  // who imports their own corrected copy is not fighting the sample data.
  const byId = new Map();
  for (const rec of builtinRecords()) byId.set(rec.id, rec);
  for (const rec of stored) {
    byId.set(rec.id, {
      id: rec.id,
      name: rec.name,
      system: rec.system,
      count: rec.count,
      source: rec.source,
      license: rec.license,
      origin: rec.origin === 'paste' ? '粘贴导入' : '文件导入',
      builtin: false,
      doc: rec.doc,
      warnings: [],
    });
  }

  state.libraries = [...byId.values()].sort((a, b) => {
    if (a.builtin !== b.builtin) return a.builtin ? -1 : 1;
    return a.name.localeCompare(b.name, 'zh-Hans-CN');
  });

  if (!state.libraries.some((l) => l.id === state.activeId)) {
    state.activeId = state.libraries[0]?.id ?? null;
  }
  state.prepared.clear();
}

function activeLibrary() {
  return state.libraries.find((l) => l.id === state.activeId) ?? null;
}

/** Prepare once per library: the Lab table is expensive to rebuild per keystroke. */
function preparedActive() {
  const library = activeLibrary();
  if (!library) return null;
  let prepared = state.prepared.get(library.id);
  if (!prepared) {
    prepared = prepareLibrary(library.doc);
    state.prepared.set(library.id, prepared);
  }
  return prepared;
}

/* ══════════════════════════════ match options ═══════════════════════════════ */

function matchOptions() {
  const s = state.settings;
  const options = {
    formula: s.formula,
    top: clampInt(s.top, 1, 20),
  };
  if (s.kl !== 'auto') options.kL = Number(s.kl);
  if (s.threshold != null && s.threshold !== '') options.threshold = Number(s.threshold);
  return options;
}

/* ═══════════════════════════════ matching ═══════════════════════════════════ */

function runMatch() {
  const prepared = preparedActive();
  if (!prepared) {
    dom.resultList.innerHTML = '<p class="empty-state">还没有可用色库。先导入一个色库，或选择内置示例。</p>';
    dom.resultMeta.innerHTML = '';
    state.lastResult = null;
    return;
  }

  // resolveInput is the single entry point for turning raw input into the
  // canonical {hex, rgb, lab} triple. Going around it would leave `lab`
  // undefined, which is exactly what the distance formulas need.
  const resolved = resolveInput({ rgb: state.rgb });
  const result = matchPrepared(prepared, resolved, matchOptions());
  state.lastResult = result;
  renderResultMeta(result);
  renderResultList(result);

  // Keep the input's own Lab visible — it is what everything is measured from.
  const lab = result.input.lab.map((v) => v.toFixed(2)).join(', ');
  dom.previewNote.textContent = `sRGB · Lab ${lab}`;
}

/* ═══════════════════════════════ rendering ══════════════════════════════════ */

function renderResultMeta(result) {
  if (!result) {
    dom.resultMeta.innerHTML = '';
    return;
  }
  const s = result.settings;
  const klLabel = s.kLSource === 'explicit' ? `手动 kL=${s.kL}` : `自动 kL=${s.kL}`;
  const best = result.bestDeltaE == null ? '—' : result.bestDeltaE.toFixed(2);
  const items = [
    ['色库', escapeHtml(result.library.name)],
    ['色号数', String(result.library.matchCount)],
    ['体系', escapeHtml(result.library.system)],
    ['公式', s.formula],
    [klLabel.split(' ')[0], klLabel.split(' ')[1] ?? ''],
    ['最近 ΔE', best],
  ];
  dom.resultMeta.innerHTML = items
    .map(
      ([k, v]) =>
        `<span class="meta-item"><span class="meta-key">${escapeHtml(k)}</span><span class="meta-val">${escapeHtml(v)}</span></span>`
    )
    .join('');
}

function renderResultList(result) {
  if (!result.matches.length) {
    dom.resultList.innerHTML = '<p class="empty-state">色库中没有符合阈值的结果。</p>';
    return;
  }

  const inputHex = result.input.hex ?? rgbToHex(state.rgb);
  const threshold = result.settings.threshold;

  dom.resultList.innerHTML = result.matches
    .map((m) => {
      const far = threshold != null && m.deltaE > threshold;
      const values = [
        `<b>${escapeHtml(m.hex.toUpperCase())}</b>`,
        m.rgb ? `RGB ${m.rgb.join(', ')}` : null,
        m.cmyk ? `CMYK ${m.cmyk.join(', ')}` : null,
        `Lab ${m.lab.map((v) => v.toFixed(2)).join(', ')}`,
      ].filter(Boolean).join(' · ');

      const b = m.breakdown;
      const breakdown = b
        ? `<span class="breakdown">· ΔL ${b.dL >= 0 ? '+' : ''}${b.dL} ΔC ${b.dC >= 0 ? '+' : ''}${b.dC} ΔH ${b.dH} · ΔE76 ${b.dE76}</span>`
        : '';

      const nameHtml = m.name ? `<span class="match-name">${escapeHtml(m.name)}</span>` : '';
      const noteHtml = m.note
        ? `<div class="match-values">${escapeHtml(m.note)}</div>`
        : '';

      return `
<article class="match-card${far ? ' is-far' : ''}">
  <div class="swatch-base" style="background:${escapeHtml(inputHex)}" title="输入色 ${escapeHtml(inputHex)}">
    <span class="swatch-inner" style="background:${escapeHtml(m.hex)}" title="候选色 ${escapeHtml(m.hex)}"></span>
  </div>
  <div class="match-body">
    <div class="match-head">
      <span class="rank">${m.rank}</span>
      <span class="match-code">${escapeHtml(m.displayCode)}</span>
      ${nameHtml}
      <span class="grade grade-${m.grade.level}">${escapeHtml(m.grade.label)}</span>
    </div>
    <div class="match-values">${values}</div>
    <div class="match-delta"><span class="de">ΔE00 ${m.deltaE.toFixed(2)}</span> ${breakdown}</div>
    ${noteHtml}
  </div>
  <button type="button" class="btn copy-btn" data-copy="${escapeHtml(m.displayCode)}|${escapeHtml(m.hex)}">复制</button>
</article>`;
    })
    .join('');

  for (const btn of dom.resultList.querySelectorAll('.copy-btn')) {
    btn.addEventListener('click', () => {
      const [code, hex] = btn.dataset.copy.split('|');
      copyText(`${code}  ${hex}`, btn);
    });
  }
}

function renderLibrarySelect() {
  const current = state.activeId;
  dom.librarySelect.innerHTML = state.libraries
    .map(
      (l) =>
        `<option value="${escapeHtml(l.id)}"${l.id === current ? ' selected' : ''}>` +
        `${escapeHtml(l.name)}（${l.count}）</option>`
    )
    .join('');
  dom.librarySelect.disabled = state.libraries.length === 0;
}

function licenseBadgeClass(license) {
  const l = String(license).toLowerCase();
  if (['mit', 'cc0', 'apache-2.0', 'bsd', 'ofl'].includes(l)) return 'license-badge is-free';
  if (['proprietary', 'unknown'].includes(l)) return 'license-badge is-proprietary';
  return 'license-badge';
}

function renderLibraryManager() {
  if (!state.libraries.length) {
    dom.libraryList.innerHTML = '<p class="empty-state">还没有色库。</p>';
    return;
  }

  dom.libraryList.innerHTML = state.libraries
    .map((l) => {
      const actions = l.builtin
        ? '<span class="hint">内置示例</span>'
        : `<button type="button" class="btn" data-export="${escapeHtml(l.id)}">导出</button>
           <button type="button" class="btn" data-delete="${escapeHtml(l.id)}">删除</button>`;
      const warn = l.warnings?.length
        ? `<div class="library-meta-line">${escapeHtml(l.warnings[0])}</div>`
        : '';
      return `
<div class="library-row">
  <div>
    <div class="library-name">
      <span class="${licenseBadgeClass(l.license)}">${escapeHtml(l.license)}</span>
      ${escapeHtml(l.name)}
      ${l.id === state.activeId ? '<span class="hint">· 当前使用</span>' : ''}
    </div>
    <div class="library-meta-line">${l.count} 色 · ${escapeHtml(l.system)} · ${escapeHtml(l.origin)}</div>
    <div class="library-meta-line">来源：${escapeHtml(l.source)}</div>
    ${warn}
  </div>
  <div class="library-actions">${actions}</div>
</div>`;
    })
    .join('');

  for (const btn of dom.libraryList.querySelectorAll('[data-delete]')) {
    btn.addEventListener('click', async () => {
      await deleteStoredLibrary(btn.dataset.delete);
      if (state.activeId === btn.dataset.delete) state.activeId = null;
      await loadLibraries();
      renderLibrarySelect();
      renderLibraryManager();
      runMatch();
    });
  }

  for (const btn of dom.libraryList.querySelectorAll('[data-export]')) {
    btn.addEventListener('click', () => {
      const lib = state.libraries.find((l) => l.id === btn.dataset.export);
      if (!lib) return;
      download(`${lib.id}.clf.json`, `${JSON.stringify(lib.doc, null, 2)}\n`, 'application/json');
    });
  }
}

/* ════════════════════════════════ input sync ════════════════════════════════ */

/** Push the canonical rgb into every control. */
function syncControlsFromRgb() {
  const [r, g, b] = state.rgb;
  const hex = rgbToHex(state.rgb);

  dom.inHex.value = hex.toUpperCase();
  dom.hexError.hidden = true;

  dom.inR.value = r; dom.inRRange.value = r;
  dom.inG.value = g; dom.inGRange.value = g;
  dom.inB.value = b; dom.inBRange.value = b;

  const [h, s, l] = rgbToHsl(state.rgb);
  const hh = Math.round(h);
  const ss = Math.round(s);
  const ll = Math.round(l);
  dom.inH.value = hh; dom.inHRange.value = hh;
  dom.inS.value = ss; dom.inSRange.value = ss;
  dom.inL.value = ll; dom.inLRange.value = ll;

  dom.inPicker.value = hex.toLowerCase();

  dom.previewSwatch.style.background = hex;
  dom.previewHex.textContent = hex.toUpperCase();
}

/** @param {number[]} rgb */
function setRgb(rgb, { rerun = true } = {}) {
  state.rgb = rgb.map((v) => clampInt(v, 0, 255));
  syncControlsFromRgb();
  if (rerun) debounce(runMatch, 80);
}

function setRgbFromChannel(channel, value) {
  const next = [...state.rgb];
  const index = { r: 0, g: 1, b: 2 }[channel];
  next[index] = clampInt(value, 0, 255);
  setRgb(next);
}

function setRgbFromHsl(channel, value) {
  const current = rgbToHsl(state.rgb);
  const next = [...current];
  const index = { h: 0, s: 1, l: 2 }[channel];
  const max = channel === 'h' ? 360 : 100;
  next[index] = Math.max(0, Math.min(max, Number(value) || 0));
  setRgb(hslToRgb(next));
}

/* ══════════════════════════════════ import ══════════════════════════════════ */

/**
 * Parse one File into a CLF library.
 *
 * Binary signatures are checked before anything is decoded as text: an .ase or
 * .acb file can easily contain byte sequences that look like a text header.
 *
 * @param {File} file
 */
async function parseFileToLibrary(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());

  if (isAse(bytes)) {
    const { library, warnings, stats } = parseAse(bytes, {});
    return { library, format: 'ase', warnings, stats };
  }
  if (isAcb(bytes)) {
    const { library, warnings, stats } = parseAcb(bytes, {});
    return { library, format: 'acb', warnings, stats };
  }

  const text = new TextDecoder('utf-8').decode(bytes);
  if (!text.trim()) throw new Error('文件是空的');
  return parseAny(text, { filename: file.name });
}

function reportImport(entries) {
  const ok = entries.filter((e) => !e.error);
  const bad = entries.filter((e) => e.error);

  const parts = [];
  if (ok.length) {
    parts.push(`<p class="ok">成功导入 ${ok.length} 个色库：</p><ul>`);
    for (const e of ok) {
      parts.push(
        `<li><b>${escapeHtml(e.name)}</b> — ${e.count} 色（${escapeHtml(e.format)}）` +
          (e.warnings?.length ? `<br><span class="hint">${escapeHtml(e.warnings[0])}</span>` : '') +
          '</li>'
      );
    }
    parts.push('</ul>');
  }
  if (bad.length) {
    parts.push(`<p class="bad">失败 ${bad.length} 个：</p><ul>`);
    for (const e of bad) {
      parts.push(`<li>${escapeHtml(e.filename)} — ${escapeHtml(e.error)}</li>`);
    }
    parts.push('</ul>');
  }
  if (!parts.length) parts.push('<p>没有可导入的内容。</p>');

  dom.importReport.innerHTML = parts.join('');
  dom.importReport.hidden = false;
}

async function importFiles(fileList) {
  const files = [...fileList].filter((f) => {
    const lower = f.name.toLowerCase();
    return SUPPORTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
  });

  if (!files.length) {
    reportImport([{ filename: '（未选择受支持的文件）', error: `支持的类型：${SUPPORTED_EXTENSIONS.join(' ')}` }]);
    return;
  }

  const entries = [];
  for (const file of files) {
    try {
      const { library, format, warnings, stats } = await parseFileToLibrary(file);
      await putStoredLibrary(library, 'file');
      entries.push({
        name: library.meta.name,
        count: library.colors.length,
        format,
        warnings: [
          ...(warnings ?? []),
          stats?.skipped ? `${stats.skipped} 行被跳过` : null,
        ].filter(Boolean),
      });
    } catch (err) {
      entries.push({ filename: file.name, error: err.message });
    }
  }

  reportImport(entries);
  await loadLibraries();
  // Make the newest import the active one — that is what the user just asked for.
  const lastOk = entries.filter((e) => !e.error).pop();
  if (lastOk) {
    const match = state.libraries.find((l) => l.name === lastOk.name);
    if (match) state.activeId = match.id;
  }
  renderLibrarySelect();
  renderLibraryManager();
  runMatch();
}

async function importPastedText() {
  const text = dom.inPaste.value;
  if (!text.trim()) {
    reportImport([{ filename: '（粘贴区为空）', error: '请先粘贴色值列表' }]);
    return;
  }
  const name = dom.inPasteName.value.trim() || `粘贴色值 ${new Date().toLocaleString('zh-CN')}`;
  try {
    const { library, warnings, stats } = parseAny(text, { format: 'text', name, id: name });
    if (!library.colors.length) {
      reportImport([{ filename: name, error: '没有解析出任何色值' }]);
      return;
    }
    await putStoredLibrary(library, 'paste');
    reportImport([
      {
        name: library.meta.name,
        count: library.colors.length,
        format: 'text',
        warnings: [...(warnings ?? []), stats?.skipped ? `${stats.skipped} 行被跳过` : null].filter(Boolean),
      },
    ]);
    dom.inPaste.value = '';
    await loadLibraries();
    state.activeId = library.id;
    renderLibrarySelect();
    renderLibraryManager();
    runMatch();
  } catch (err) {
    reportImport([{ filename: name, error: err.message }]);
  }
}

/* ═════════════════════════════════ reverse lookup ═══════════════════════════ */

function runLookup() {
  const library = activeLibrary();
  const query = dom.inCode.value.trim();
  if (!library) {
    dom.lookupResult.innerHTML = '<p class="hint">还没有可用色库。</p>';
    dom.lookupResult.hidden = false;
    return;
  }
  if (!query) {
    dom.lookupResult.hidden = true;
    return;
  }

  const hits = lookupByCode(library.doc, query, { limit: 8 });
  if (!hits.length) {
    dom.lookupResult.innerHTML = `<p class="hint">「${escapeHtml(query)}」在「${escapeHtml(library.name)}」中没有匹配的色号。</p>`;
    dom.lookupResult.hidden = false;
    return;
  }

  dom.lookupResult.innerHTML = hits
    .map(
      (h) => `
<div class="lookup-row">
  <span class="lookup-chip" style="background:${escapeHtml(h.hex)}"></span>
  <span class="lookup-code">${escapeHtml(h.displayCode)}</span>
  <span class="lookup-hex">${escapeHtml(h.hex.toUpperCase())}</span>
  ${h.name ? `<span class="lookup-hex">${escapeHtml(h.name)}</span>` : ''}
  <button type="button" class="btn copy-btn" data-copy="${escapeHtml(h.displayCode)}|${escapeHtml(h.hex)}">复制</button>
</div>`
    )
    .join('');
  dom.lookupResult.hidden = false;

  for (const btn of dom.lookupResult.querySelectorAll('.copy-btn')) {
    btn.addEventListener('click', () => {
      const [code, hex] = btn.dataset.copy.split('|');
      copyText(`${code}  ${hex}`, btn);
    });
  }
}

/* ═══════════════════════════════════ batch ══════════════════════════════════ */

function runBatch() {
  const library = activeLibrary();
  if (!library) {
    dom.batchOutput.innerHTML = '<p class="empty-state">还没有可用色库。</p>';
    return;
  }

  const lines = dom.inBatch.value
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (!lines.length) {
    dom.batchOutput.innerHTML = '<p class="empty-state">在上面粘贴每行一个色值。</p>';
    dom.batchStat.textContent = '';
    state.batchRows = null;
    return;
  }

  const results = matchBatch(lines, library.doc, matchOptions());
  state.batchRows = results;

  const okCount = results.filter((r) => !r.error).length;
  const top = matchOptions().top;
  dom.batchStat.textContent =
    `${okCount}/${results.length} 行解析成功，每行取最接近的 ${top} 个色号。` +
    (okCount < results.length ? ` 有 ${results.length - okCount} 行无法识别。` : '');

  // One row per input colour: the input plus its ranked candidates. Keeping it
  // to one row per input means a wide paste stays readable.
  const rows = [];
  for (const r of results) {
    if (r.error) {
      rows.push(
        `<tr class="is-error"><td class="mono">${escapeHtml(r.input.raw)}</td>` +
          `<td colspan="${4 + top * 2}">无法识别为色值</td></tr>`
      );
      continue;
    }
    const cells = [];
    for (let i = 0; i < top; i++) {
      const m = r.matches[i];
      cells.push(
        m
          ? `<td><span class="batch-swatch" style="background:${escapeHtml(m.hex)}"></span></td>` +
            `<td class="mono">${escapeHtml(m.displayCode)}</td>`
          : '<td></td><td></td>'
      );
    }
    rows.push(
      `<tr><td class="mono">${escapeHtml(r.input.hex ?? r.input.raw)}</td>` +
        `<td><span class="batch-swatch" style="background:${escapeHtml(r.input.hex ?? '#000')}"></span></td>` +
        cells.join('') +
        '</tr>'
    );
  }

  const headCells = ['输入', ''];
  for (let i = 1; i <= top; i++) headCells.push(`#${i}`, `ΔE`);

  dom.batchOutput.innerHTML =
    `<table class="batch-table"><thead><tr>${headCells
      .map((h) => `<th>${escapeHtml(h)}</th>`)
      .join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

function exportBatchCsv() {
  if (!state.batchRows?.length) return;
  const top = matchOptions().top;
  const header = ['input', 'input_lab_L', 'input_lab_a', 'input_lab_b'];
  for (let i = 1; i <= top; i++) {
    header.push(`rank${i}_code`, `rank${i}_hex`, `rank${i}_deltaE`, `rank${i}_grade`);
  }
  const rows = [header];
  for (const r of state.batchRows) {
    if (r.error) {
      rows.push([r.input.raw, '', '', '', ...Array(top * 4).fill('')]);
      continue;
    }
    const row = [
      r.input.hex,
      r.input.lab[0].toFixed(3),
      r.input.lab[1].toFixed(3),
      r.input.lab[2].toFixed(3),
    ];
    for (let i = 0; i < top; i++) {
      const m = r.matches[i];
      row.push(m ? m.displayCode : '', m ? m.hex : '', m ? m.deltaE : '', m ? m.grade.label : '');
    }
    rows.push(row);
  }
  download('coloroteca-batch.csv', toCsv(rows), 'text/csv;charset=utf-8');
}

function exportResultCsv() {
  const result = state.lastResult;
  if (!result?.matches.length) return;
  const header = [
    'rank', 'code', 'name', 'hex', 'rgb', 'cmyk', 'lab_L', 'lab_a', 'lab_b',
    'deltaE2000', 'perception', 'dL', 'dC', 'dH', 'dE76',
  ];
  const rows = [header];
  for (const m of result.matches) {
    rows.push([
      m.rank,
      m.displayCode,
      m.name ?? '',
      m.hex,
      (m.rgb ?? []).join(' '),
      (m.cmyk ?? []).join(' '),
      m.lab[0].toFixed(3), m.lab[1].toFixed(3), m.lab[2].toFixed(3),
      m.deltaE,
      m.grade.label,
      m.breakdown?.dL ?? '', m.breakdown?.dC ?? '', m.breakdown?.dH ?? '', m.breakdown?.dE76 ?? '',
    ]);
  }
  download(`coloroteca-${result.library.id}-${result.input.hex.slice(1)}.csv`, toCsv(rows), 'text/csv;charset=utf-8');
}

/* ═════════════════════════════════ settings ═════════════════════════════════ */

function applySettingsToForm() {
  const s = state.settings;
  dom.setFormula.value = s.formula;
  dom.setKl.value = String(s.kl);
  dom.setTop.value = s.top;
  dom.setThreshold.value = s.threshold ?? '';
}

function readSettingsFromForm() {
  state.settings = {
    ...state.settings,
    formula: dom.setFormula.value,
    kl: dom.setKl.value,
    top: clampInt(dom.setTop.value, 1, 20),
    threshold: dom.setThreshold.value === '' ? null : Number(dom.setThreshold.value),
  };
  saveSettings(state.settings);
  applySettingsToForm();
  runMatch();
}

/* ═══════════════════════════════ view switch ════════════════════════════════ */

function setView(view) {
  const isSingle = view === 'single';
  dom.tabSingle.classList.toggle('is-active', isSingle);
  dom.tabBatch.classList.toggle('is-active', !isSingle);
  dom.tabSingle.setAttribute('aria-selected', String(isSingle));
  dom.tabBatch.setAttribute('aria-selected', String(!isSingle));
  dom.viewSingle.hidden = !isSingle;
  dom.viewBatch.hidden = isSingle;
  state.settings.view = view;
  saveSettings(state.settings);
  if (!isSingle && !state.batchRows) runBatch();
}

/* ══════════════════════════════════ wiring ══════════════════════════════════ */

function wireEvents() {
  /* --- library --- */
  dom.librarySelect.addEventListener('change', () => {
    state.activeId = dom.librarySelect.value;
    renderLibraryManager();
    runMatch();
    if (!dom.viewBatch.hidden) runBatch();
  });

  dom.btnLibraries.addEventListener('click', () => {
    renderLibraryManager();
    dom.dlgLibraries.showModal();
  });

  dom.btnImport.addEventListener('click', () => {
    dom.importReport.hidden = true;
    dom.dlgImport.showModal();
  });

  dom.btnSettings.addEventListener('click', () => {
    applySettingsToForm();
    dom.dlgSettings.showModal();
  });

  /* --- tabs --- */
  dom.tabSingle.addEventListener('click', () => setView('single'));
  dom.tabBatch.addEventListener('click', () => setView('batch'));

  /* --- hex --- */
  dom.inHex.addEventListener('input', () => {
    const parsed = parseColorInput(dom.inHex.value);
    if (parsed) {
      dom.hexError.hidden = true;
      state.rgb = parsed.rgb;
      // Rewriting the field while typing would fight the caret, so only the
      // other controls are synced here.
      const keep = dom.inHex.value;
      syncControlsFromRgb();
      dom.inHex.value = keep;
      debounce(runMatch, 80);
    } else {
      dom.hexError.textContent = '无法识别这个色值。试试 #RRGGBB、rgb(255 107 107) 或 hsl(0 100% 71%)。';
      dom.hexError.hidden = false;
    }
  });
  dom.inHex.addEventListener('blur', () => {
    if (parseColorInput(dom.inHex.value)) syncControlsFromRgb();
  });

  dom.inPicker.addEventListener('input', () => {
    const parsed = parseColorInput(dom.inPicker.value);
    if (parsed) setRgb(parsed.rgb);
  });

  dom.btnEyedropper.addEventListener('click', async () => {
    if (!window.EyeDropper) {
      dom.hexError.textContent = '这个浏览器不支持屏幕吸色。Chromium 系浏览器（Chrome / Edge）可用，也可以直接用调色盘。';
      dom.hexError.hidden = false;
      return;
    }
    try {
      const { sRGBHex } = await new window.EyeDropper().open();
      const parsed = parseColorInput(sRGBHex);
      if (parsed) setRgb(parsed.rgb);
    } catch {
      /* user pressed Escape — nothing to do */
    }
  });

  /* --- rgb / hsl channels --- */
  for (const [id, rangeId, channel] of [
    ['in-r', 'in-r-range', 'r'], ['in-g', 'in-g-range', 'g'], ['in-b', 'in-b-range', 'b'],
  ]) {
    const input = $(id);
    const range = $(rangeId);
    input.addEventListener('input', () => setRgbFromChannel(channel, input.value));
    range.addEventListener('input', () => setRgbFromChannel(channel, range.value));
  }

  for (const [id, rangeId, channel] of [
    ['in-h', 'in-h-range', 'h'], ['in-s', 'in-s-range', 's'], ['in-l', 'in-l-range', 'l'],
  ]) {
    const input = $(id);
    const range = $(rangeId);
    input.addEventListener('input', () => setRgbFromHsl(channel, input.value));
    range.addEventListener('input', () => setRgbFromHsl(channel, range.value));
  }

  /* --- reverse lookup --- */
  dom.btnLookup.addEventListener('click', runLookup);
  dom.inCode.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') runLookup();
  });

  /* --- batch --- */
  dom.btnBatchRun.addEventListener('click', runBatch);
  dom.btnBatchCsv.addEventListener('click', exportBatchCsv);

  /* --- result actions --- */
  dom.btnCopyAll.addEventListener('click', () => {
    const result = state.lastResult;
    if (!result?.matches.length) return;
    const lines = result.matches.map(
      (m) => `${m.rank}\t${m.displayCode}\t${m.hex}\tΔE00 ${m.deltaE.toFixed(2)}\t${m.grade.label}`
    );
    copyText(lines.join('\n'), dom.btnCopyAll);
  });
  dom.btnExportCsv.addEventListener('click', exportResultCsv);

  /* --- import dialog --- */
  dom.inFiles.addEventListener('change', () => {
    importFiles(dom.inFiles.files);
    dom.inFiles.value = '';
  });
  dom.inFolder.addEventListener('change', () => {
    importFiles(dom.inFolder.files);
    dom.inFolder.value = '';
  });
  dom.btnPasteImport.addEventListener('click', importPastedText);

  ['dragenter', 'dragover'].forEach((type) =>
    dom.dropzone.addEventListener(type, (e) => {
      e.preventDefault();
      dom.dropzone.classList.add('is-over');
    })
  );
  ['dragleave', 'drop'].forEach((type) =>
    dom.dropzone.addEventListener(type, (e) => {
      e.preventDefault();
      dom.dropzone.classList.remove('is-over');
    })
  );
  dom.dropzone.addEventListener('drop', (e) => {
    if (e.dataTransfer?.files?.length) importFiles(e.dataTransfer.files);
  });

  /* --- settings dialog --- */
  for (const el of [dom.setFormula, dom.setKl, dom.setTop, dom.setThreshold]) {
    el.addEventListener('change', readSettingsFromForm);
  }
  dom.btnSettingsReset.addEventListener('click', () => {
    state.settings = { ...DEFAULT_SETTINGS, view: state.settings.view };
    saveSettings(state.settings);
    applySettingsToForm();
    runMatch();
  });

  /* --- global key handling --- */
  document.addEventListener('keydown', (e) => {
    // Ctrl/Cmd+K focuses the hex field, which is the one people use most.
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      dom.inHex.focus();
      dom.inHex.select();
    }
  });
}

/* ════════════════════════════════════ init ══════════════════════════════════ */

async function init() {
  applySettingsToForm();
  wireEvents();

  await loadLibraries();
  renderLibrarySelect();
  renderLibraryManager();

  syncControlsFromRgb();
  runMatch();

  if (state.settings.view === 'batch') setView('batch');

  if (isUsingFallback()) {
    const note = document.createElement('p');
    note.className = 'notice';
    note.textContent =
      '这个浏览器不允许本地存储（IndexedDB 不可用），导入的色库只在本次会话有效，刷新后会消失。用「导出」保存成 .clf.json 可以保留下来。';
    dom.resultList.before(note);
  }
}

init();
