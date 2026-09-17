#!/usr/bin/env node
/**
 * Convert a colour library file into CLF.
 *
 *   node skill/scripts/convert.mjs Freetone.ase -o ~/.coloroteca/libraries/freetone.clf.json
 *   node skill/scripts/convert.mjs "PANTONE+Solid Coated.acb" -o pantone-c.clf.json --license proprietary
 *   node skill/scripts/convert.mjs palette.gpl -o out.clf.json
 *   node skill/scripts/convert.mjs colours.txt -o out.clf.json --name "Brand colours"
 *
 * Reading the file is deliberately permissive; recording provenance is
 * deliberately not. CLF has required `source` and `license` fields, and the
 * whole point of the format is that you can tell later where a colour book came
 * from and what you may do with it. So the converter infers what it can and
 * asks about the rest.
 *
 * @module skill/scripts/convert
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';

import { DEFAULT_LIBRARY_DIR, emit, fail, libs, parseArgs, usage } from './lib.mjs';

const USAGE = `
convert.mjs — convert a colour library into Coloroteca Library Format (.clf.json)

USAGE
  convert.mjs <input-file> -o <output.clf.json> [options]

INPUT
  .ase    Adobe Swatch Exchange (big-endian binary)
  .acb    Adobe Color Book — carries real Lab values, so prefer this if you have it
  .gpl    GIMP / Inkscape palette
  .clf.json  already CLF (re-normalised, useful for editing metadata)
  .txt .csv .tsv .css   text lists of colour values

OPTIONS
  -o, --out <path>     output file (required unless --stdout)
  --stdout             write to stdout instead of a file
  --id <slug>          library id (default: a slug of the name)
  --name <text>        display name (default: the input filename)
  --system <name>      PMS | TCX | RAL | NCS | CUSTOM
  --substrate <name>   coated | uncoated
  --prefix <text>      shown before the code, e.g. PANTONE
  --suffix <text>      shown after the code, e.g. C
  --source <text>      where the data came from (default: file:<basename>)
  --license <name>     mit | cc0 | proprietary | unknown
  --indent <n>         JSON indentation (default 2)

NOTES
  The converter never downloads anything and never edits the input file. It also
  does not guess a licence: if you do not pass --license, the library is recorded
  as "unknown" rather than "free".

EXAMPLES
  convert.mjs "PANTONE+Solid Coated.acb" -o ~/.coloroteca/libraries/pms-c.clf.json \\
      --system PMS --prefix PANTONE --suffix C --license proprietary \\
      --source "Adobe Color Book supplied with my Creative Cloud subscription"
`;

const args = parseArgs(process.argv.slice(2), {
  booleans: ['stdout', 'help', 'pretty'],
  aliases: { '-o': 'out' },
});

if (args.help || !args._.length) {
  usage(USAGE);
  process.exit(args.help ? 0 : 2);
}

const inputPath = resolve(String(args._[0]));
if (!existsSync(inputPath) || !statSync(inputPath).isFile()) {
  fail(`input file not found: ${inputPath}`, 2);
}

const outPath = args.out && args.out !== true ? resolve(String(args.out)) : null;
if (!outPath && !args.stdout) {
  fail('specify -o <output.clf.json>, or --stdout to print the result.', 2);
}

const { parsers } = libs;

/* ─────────────────────────────── read input ──────────────────────────────── */

const extension = extname(inputPath).toLowerCase();
const stem = basename(inputPath, extname(inputPath));

/**
 * Sniff for JSON rather than trusting the extension: colour books exported by
 * various tools sometimes arrive with an unexpected suffix, and a document that
 * opens with { or [ is unambiguous.
 */
function looksLikeJson(file) {
  try {
    const head = readFileSync(file, 'utf8').replace(/^\uFEFF/, '').trimStart();
    return head.startsWith('{') || head.startsWith('[');
  } catch {
    return false;
  }
}

let parsed;
try {
  if (extension === '.ase' || extension === '.acb' || !looksLikeJson(inputPath)) {
    // Binary formats (and anything that is not JSON) go through the byte path,
    // where the signature decides. Text parsers are reached via detectFormat.
    const bytes = new Uint8Array(readFileSync(inputPath));
    const sniffed = parsers.detectFormat(bytes, basename(inputPath));
    parsed =
      sniffed === 'ase' || sniffed === 'acb'
        ? parsers.parseAny(bytes, { filename: basename(inputPath) })
        : parsers.parseAny(new TextDecoder('utf-8').decode(bytes), {
            filename: basename(inputPath),
          });
  } else {
    parsed = parsers.parseAny(readFileSync(inputPath, 'utf8'), { filename: basename(inputPath) });
  }
} catch (err) {
  fail(
    `could not parse ${basename(inputPath)}: ${err.message}\n` +
      'If this is a text list, check that each line contains a recognisable colour value.\n' +
      'If this is a binary format other than ASE or ACB, it is not supported yet.'
  );
}

/* ──────────────────────────────── metadata ───────────────────────────────── */

const library = parsed.library;
const wasClf = parsed.format === 'clf';

// Writing an empty library would be a silent failure: the user would get a file
// that loads fine and matches nothing. Refuse instead, and name the file.
if (!library.colors.length) {
  fail(
    `${basename(inputPath)}: no colour values could be read from this file, so nothing was written.\n` +
      'Check that each line contains a recognisable colour: #RRGGBB, a "R,G,B" triple, ' +
      'an rgb()/hsl() function, or a code paired with a hex value.'
  );
}

// Snapshot before touching anything: a CLF input already carries provenance,
// and a format conversion is not an excuse to throw that away.
const original = { ...library.meta };

const providedSource = args.source && args.source !== true ? String(args.source) : null;
const providedLicense = args.license && args.license !== true ? String(args.license) : null;

/* name */
if (args.name && args.name !== true) library.meta.name = String(args.name);
else if (!library.meta.name || library.meta.name === 'Untitled library') library.meta.name = stem;

/* id
   Precedence: an explicit --id; then the document's own id, but only for a CLF
   input, where the id is the file's identity; then a slug of the name. Deriving
   from the name in the last case matters because every text import would
   otherwise land on the same generic id and silently overwrite the previous one. */
if (args.id && args.id !== true) {
  library.id = String(args.id);
} else if (!(wasClf && library.id && library.id !== 'library')) {
  const { slugify } = libs.clf;
  library.id = slugify(library.meta.name) || slugify(stem) || 'library';
}

if (args.system && args.system !== true) library.meta.system = String(args.system).toUpperCase();
if (args.substrate && args.substrate !== true) library.meta.substrate = String(args.substrate);
if (args.prefix && args.prefix !== true) library.meta.prefix = String(args.prefix);
if (args.suffix && args.suffix !== true) library.meta.suffix = String(args.suffix);

/* provenance — fill in, never blank out */
library.meta.source =
  providedSource ?? (wasClf && original.source ? original.source : `file:${basename(inputPath)}`);
library.meta.license =
  providedLicense ?? (wasClf && original.license ? original.license : 'unknown');
library.meta.importedAt = original.importedAt ?? new Date().toISOString();
library.meta.colorCount = library.colors.length;

if (library.meta.license === 'unknown') {
  library.meta.note = [library.meta.note, '来源与许可未确认。对外分发或商业使用前请先查清。']
    .filter(Boolean)
    .join(' ');
}

/* ──────────────────────────────── validate ───────────────────────────────── */

const { validateLibrary } = libs.clf;
const check = validateLibrary(library);
if (!check.valid) fail(`conversion produced an invalid CLF document: ${check.errors.join('; ')}`);

/* ───────────────────────────────── output ────────────────────────────────── */

const indent = args.indent && args.indent !== true ? Number(args.indent) : 2;
const json = `${JSON.stringify(library, null, indent)}\n`;

if (args.stdout) {
  emit(json);
} else {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, json, 'utf8');
}

/* ──────────────────────────────── report ─────────────────────────────────── */

const summary = [
  `${basename(inputPath)}  →  ${args.stdout ? '(stdout)' : outPath}`,
  `  格式      ${parsed.format}`,
  `  色号数    ${library.colors.length}`,
  `  ID        ${library.id}`,
  `  名称      ${library.meta.name}`,
  `  体系      ${library.meta.system}`,
  `  来源      ${library.meta.source}`,
  `  许可      ${library.meta.license}`,
];

// Lab is the whole reason ACB is the preferred import path — say so when it
// actually happened, because it means the match will be more accurate.
const withLab = library.colors.filter((c) => Array.isArray(c.lab)).length;
if (withLab) {
  summary.push(`  含 Lab    ${withLab}/${library.colors.length} 条（匹配时直接使用源 Lab，精度更高）`);
}
if (parsed.stats?.skipped) {
  summary.push(`  已跳过    ${parsed.stats.skipped} 条（无法识别的记录）`);
}
for (const w of parsed.warnings ?? []) summary.push(`  警告      ${w}`);
for (const w of check.warnings) summary.push(`  警告      ${w}`);

if (!args.stdout && library.meta.license === 'unknown') {
  summary.push('');
  summary.push(
    '许可未指定，已记为 "unknown"。如果你确知这份色库的许可状态，建议补上：\n' +
      `      convert.mjs "${inputPath}" -o "${outPath}" --license <mit|cc0|proprietary>`
  );
}
if (!args.stdout && outPath && dirname(outPath) !== DEFAULT_LIBRARY_DIR && !existsSync(DEFAULT_LIBRARY_DIR)) {
  summary.push('');
  summary.push(
    `提示：把它放进默认色库目录，match.mjs 与 list.mjs 就能直接找到：\n` +
      `      "${DEFAULT_LIBRARY_DIR}"`
  );
}

emit(summary.join('\n'));
