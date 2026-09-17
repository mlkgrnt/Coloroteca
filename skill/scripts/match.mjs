#!/usr/bin/env node
/**
 * Match one or many colour values against a colour library.
 *
 *   node skill/scripts/match.mjs --hex "#FF6B6B" --top 5
 *   node skill/scripts/match.mjs --rgb 255,107,107
 *   node skill/scripts/match.mjs --code "185 C"              # reverse lookup
 *   node skill/scripts/match.mjs --name "珊瑚粉"              # Chinese colour name
 *   node skill/scripts/match.mjs --batch colours.txt --top 3
 *   cat colours.txt | node skill/scripts/match.mjs --batch -
 *
 * Output defaults to a Markdown table, because the usual consumer is a chat
 * interface rather than a terminal.
 *
 * @module skill/scripts/match
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ROOT,
  emit,
  fail,
  libs,
  matchesToMarkdown,
  parseArgs,
  resolveLibrary,
  swatch,
  toCsv,
  toMarkdownTable,
  usage,
} from './lib.mjs';

const USAGE = `
match.mjs — match colour values against a Coloroteca library

USAGE
  match.mjs --hex "#FF6B6B" [options]
  match.mjs --rgb 255,107,107 [options]
  match.mjs --code "185 C" [options]
  match.mjs --name "珊瑚粉" [options]
  match.mjs --batch <file|-> [options]
  match.mjs "#FF6B6B" "#0A2BD9" [options]

INPUT (pick one)
  --hex <value>        #RRGGBB, RRGGBB, #RGB
  --rgb <r,g,b>        0-255 per channel
  --code <value>       look a colour code up in the library (reverse direction)
  --name <text>        Chinese colour name; resolved via data/zh-colornames.json
  --batch <file|->     one colour per line, or - for stdin
  <positional...>      any number of colour values

MATCHING
  --top <n>            how many matches to return (default 5)
  --formula <name>     CIEDE2000 (default) | CIE94 | CIE76
  --kl <n>             override the kL weight; default comes from the library
                       system (TCX textiles use 2, graphic arts use 1)
  --threshold <dE>     drop matches further away than this
  --library <path|id>  which library to use (default: first one found)
  --dir <path>         library directory (default ~/.coloroteca/libraries)

OUTPUT
  --format <md|json|csv>   default md
  --swatch <auto|ansi|block|none>   default auto
  --no-breakdown           omit the ΔL / ΔC / ΔH columns
  --quiet                  JSON with no commentary (same as --format json)

EXAMPLES
  match.mjs --hex "#FF6B6B"
  match.mjs --name "雾霾蓝" --top 3
  match.mjs --batch swatches.txt --format csv > out.csv
`;

const args = parseArgs(process.argv.slice(2), {
  booleans: ['no-breakdown', 'quiet', 'help'],
});

if (args.help || (!args.hex && !args.rgb && !args.code && !args.name && !args.batch && !args._.length)) {
  usage(USAGE);
  process.exit(args.help ? 0 : 2);
}

/* ────────────────────────────── colour-name table ────────────────────────── */

let nameTableCache = null;

function loadNameTable() {
  if (nameTableCache) return nameTableCache;
  const path = join(ROOT, 'data', 'zh-colornames.json');
  if (!existsSync(path)) {
    fail(`colour-name table missing at ${path}`);
  }
  nameTableCache = JSON.parse(readFileSync(path, 'utf8'));
  return nameTableCache;
}

/** Levenshtein distance, capped for speed on long strings. */
function editDistance(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = curr;
  }
  return prev[b.length];
}

/**
 * Resolve a Chinese colour name to reference colours.
 *
 * Order of preference: exact name, exact alias, name contains query, query
 * contains name, then a small edit distance. Several hits are returned rather
 * than one, because a descriptive name like 雾霾蓝 genuinely spans a range and
 * picking for the user would be a guess.
 *
 * @param {string} query
 * @returns {{exact:object[], fuzzy:object[]}}
 */
function lookupName(query) {
  const table = loadNameTable();
  const q = query.trim().toLowerCase();
  const exact = [];
  const fuzzy = [];

  for (const entry of table.entries) {
    const name = entry.name.toLowerCase();
    const aliases = (entry.aliases ?? []).map((a) => a.toLowerCase());
    if (name === q) { exact.push(entry); continue; }
    if (aliases.includes(q)) { exact.push(entry); continue; }
    if (name.includes(q) || aliases.some((a) => a.includes(q))) { fuzzy.push(entry); continue; }
    if (q.includes(name) || aliases.some((a) => q.includes(a))) { fuzzy.push(entry); continue; }
    const distance = editDistance(name, q);
    if (distance <= 1 || (q.length >= 3 && distance <= 2)) fuzzy.push({ ...entry, _distance: distance });
  }

  fuzzy.sort((a, b) => (a._distance ?? 0) - (b._distance ?? 0));
  return { exact, fuzzy };
}

/* ──────────────────────────────── input forms ────────────────────────────── */

const { matcher } = libs;

function collectInputs() {
  const inputs = [];
  if (args.hex) inputs.push(...(Array.isArray(args.hex) ? args.hex : [args.hex]));
  if (args.rgb) {
    for (const v of Array.isArray(args.rgb) ? args.rgb : [args.rgb]) {
      const parts = String(v).split(',').map((s) => Number(s.trim()));
      if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
        fail(`--rgb expects three numbers, got "${v}"`);
      }
      inputs.push({ rgb: parts });
    }
  }
  for (const v of args._) inputs.push(v);
  return inputs;
}

/**
 * Read a colour list, one per line.
 *
 * A '#' only opens a comment when it is followed by whitespace, `!` or the end
 * of the line — otherwise "#FF6B6B" would be discarded as a comment. This is
 * the same rule parsers/text.js uses, so a list behaves identically whether it
 * goes through this CLI or the web app's paste box.
 */
function readBatch(source) {
  let text;
  if (source === '-') {
    text = readFileSync(0, 'utf8');
  } else if (existsSync(source)) {
    text = readFileSync(source, 'utf8');
  } else {
    fail(`batch file not found: ${source}`);
  }
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^#($|[\s!])/.test(l));
}

/* ──────────────────────────────── rendering ──────────────────────────────── */

const swatchMode = args.swatch ?? 'auto';
const includeBreakdown = !args['no-breakdown'];
const format = args.quiet ? 'json' : (args.format ?? 'md');

function matchOptions() {
  const options = { top: args.top ? Number(args.top) : 5 };
  if (args.formula) options.formula = String(args.formula);
  if (args.kl != null && args.kl !== true) options.kL = Number(args.kl);
  if (args.threshold != null && args.threshold !== true) options.threshold = Number(args.threshold);
  return options;
}

/**
 * Run the matcher for a single resolved colour and render it.
 * @param {object} library
 * @param {{hex?:string,rgb?:number[]}} input
 */
function renderSingle(library, input) {
  const result = matcher.matchColor(input, library.doc, matchOptions());

  if (format === 'json') {
    emit(JSON.stringify(result, null, 2));
    return result;
  }

  if (format === 'csv') {
    const head = ['rank', 'code', 'hex', 'rgb', 'cmyk', 'lab_L', 'lab_a', 'lab_b',
      'deltaE2000', 'perception', 'dL', 'dC', 'dH', 'dE76'];
    const rows = result.matches.map((m) => [
      m.rank, m.displayCode, m.hex, (m.rgb ?? []).join(' '), (m.cmyk ?? []).join(' '),
      m.lab[0].toFixed(3), m.lab[1].toFixed(3), m.lab[2].toFixed(3),
      m.deltaE, m.grade.label,
      m.breakdown?.dL ?? '', m.breakdown?.dC ?? '', m.breakdown?.dH ?? '', m.breakdown?.dE76 ?? '',
    ]);
    emit(toCsv(head, rows));
    return result;
  }

  const lines = [];
  lines.push(
    `输入 ${result.input.hex.toUpperCase()}  ·  Lab ${result.input.lab
      .map((v) => v.toFixed(2))
      .join(', ')}  ·  色库「${result.library.name}」${result.library.matchCount} 色`
  );
  lines.push(
    `公式 ${result.settings.formula}，kL=${result.settings.kL}` +
      (result.settings.kLSource === 'explicit' ? '（手动指定）' : '（按色库体系自动）') +
      `，取前 ${result.settings.top} 个`
  );
  if (!result.matches.length) {
    lines.push('');
    lines.push(`没有结果${result.settings.threshold != null ? `落在阈值 ΔE ≤ ${result.settings.threshold} 之内` : ''}。`);
    emit(lines.join('\n'));
    return result;
  }
  lines.push('');
  lines.push(matchesToMarkdown(result.matches, { swatchMode, includeBreakdown }));
  lines.push('');
  lines.push('屏幕色值近似匹配，实际指定色号请以官方色卡为准。');
  emit(lines.join('\n'));
  return result;
}

function renderLookup(library, query) {
  const hits = matcher.lookupByCode(library.doc, query, { limit: 10 });
  if (!hits.length) {
    if (format === 'json') emit(JSON.stringify({ query, matches: [] }, null, 2));
    else emit(`「${query}」在色库「${library.name}」中没有匹配的色号。`);
    return hits;
  }

  if (format === 'json') {
    emit(JSON.stringify({ query, library: library.name, matches: hits }, null, 2));
    return hits;
  }
  if (format === 'csv') {
    emit(toCsv(['code', 'hex', 'rgb', 'name'], hits.map((h) => [
      h.displayCode, h.hex, (h.rgb ?? []).join(' '), h.name ?? '',
    ])));
    return hits;
  }

  const rows = hits.map((h, i) => [
    String(i + 1), h.displayCode, swatch(h.rgb, swatchMode) || '·', h.hex.toUpperCase(),
    (h.rgb ?? []).join(','), h.name ?? '',
  ]);
  emit([
    `反查「${query}」· 色库「${library.name}」`,
    '',
    toMarkdownTable(['#', '色号', '色块', 'HEX', 'RGB', '色名'], rows),
  ].join('\n'));
  return hits;
}

function renderName(library, query) {
  const { exact, fuzzy } = lookupName(query);
  const pool = exact.length ? exact : fuzzy;

  if (!pool.length) {
    if (format === 'json') {
      emit(JSON.stringify({ query, resolved: [], matches: [] }, null, 2));
    } else {
      emit(
        `色名表里没有「${query}」。\n` +
          '这张表只收录已知的传统色名与常见描述性色名，不做语义联想 —— ' +
          '如果这是个不常见的叫法，请直接给出色值（例如 --hex）。'
      );
    }
    return;
  }

  // Fuzzy hits are offered as candidates rather than matched outright: a
  // descriptive name like 雾霾蓝 spans a range, so silently picking one
  // interpretation would be a guess dressed up as an answer.
  if (!exact.length) {
    if (format === 'json') {
      emit(JSON.stringify({ query, ambiguous: true, candidates: pool.slice(0, 8) }, null, 2));
      return;
    }
    const rows = pool.slice(0, 8).map((e) => [
      e.name,
      swatch(libs.colorSpace.hexToRgb(e.hex), swatchMode) || '·',
      e.hex.toUpperCase(),
      e.category === 'traditional' ? '传统色' : '现代描述色名',
      e.approximate ? '参考值' : '有出处',
    ]);
    emit([
      `「${query}」不是色名表里的精确色名，但有这些相近的：`,
      '',
      toMarkdownTable(['色名', '色块', '参考色值', '类别', '性质'], rows),
      '',
      '从列表里挑一个，或者直接给出色值（--hex）再匹配。',
    ].join('\n'));
    return;
  }

  for (const entry of exact) {
    if (format === 'json') {
      emit(JSON.stringify({ query, resolved: entry, match: matcher.matchColor(entry.hex, library.doc, matchOptions()) }, null, 2));
      return;
    }
    emit(
      `「${entry.name}」的参考色值是 ${entry.hex.toUpperCase()}` +
        (entry.approximate ? '（描述性色名的代表性取值，非权威定义）' : '') +
        (entry.note ? `\n  ${entry.note}` : '') +
        '\n'
    );
    renderSingle(library, entry.hex);
    if (exact.length > 1) emit('');
  }
}

function renderBatch(library, source) {
  const lines = readBatch(source);
  if (!lines.length) fail('batch input was empty');

  const results = matcher.matchBatch(lines, library.doc, matchOptions());

  if (format === 'json') {
    emit(JSON.stringify({ library: library.name, results }, null, 2));
    return;
  }

  const top = matchOptions().top;

  if (format === 'csv') {
    const head = ['input'];
    for (let i = 1; i <= top; i++) head.push(`rank${i}_code`, `rank${i}_hex`, `rank${i}_deltaE`, `rank${i}_grade`);
    const rows = results.map((r) => {
      if (r.error) return [r.input.raw, ...Array(top * 4).fill('')];
      const row = [r.input.hex];
      for (let i = 0; i < top; i++) {
        const m = r.matches[i];
        row.push(m ? m.displayCode : '', m ? m.hex : '', m ? m.deltaE : '', m ? m.grade.label : '');
      }
      return row;
    });
    emit(toCsv(head, rows));
    return;
  }

  // Markdown: one block per input, which reads better than a very wide table.
  // Joining pre-rendered blocks avoids the stray blank lines that accumulate if
  // the separator is emitted alongside the content.
  const blocks = [];
  let failed = 0;
  for (const r of results) {
    if (r.error) {
      failed++;
      blocks.push(`**${r.input.raw}** — 无法识别为色值。`);
      continue;
    }
    blocks.push(
      `**${r.input.hex.toUpperCase()}**\n\n${matchesToMarkdown(r.matches, { swatchMode, includeBreakdown })}`
    );
  }
  const header =
    `批量匹配 ${results.length} 个色值 · 色库「${library.name}」` +
    `（${library.doc.colors.length} 色）· 每个取前 ${top} 个` +
    (failed ? ` · ${failed} 个无法识别` : '');
  emit([header, '', blocks.join('\n\n'), '', '屏幕色值近似匹配，实际指定色号请以官方色卡为准。'].join('\n'));
}

/* ─────────────────────────────────── run ─────────────────────────────────── */

const library = (() => {
  try {
    return resolveLibrary(args.library, args.dir);
  } catch (err) {
    fail(err.message, 3);
  }
})();

if (args.code) {
  renderLookup(library, String(args.code));
} else if (args.name) {
  renderName(library, String(args.name));
} else if (args.batch) {
  renderBatch(library, String(args.batch));
} else {
  const inputs = collectInputs();
  if (!inputs.length) fail('no colour input given. See usage.');
  for (const input of inputs) {
    renderSingle(library, input);
    if (inputs.length > 1 && format !== 'json') emit('');
  }
}
