#!/usr/bin/env node
/**
 * Compliance check: make sure no protected colour-library data has been
 * committed to this repository.
 *
 * The whole project rests on one promise — Coloroteca ships the engine, not the
 * colour books. That promise is easy to break by accident: drop an .ase in the
 * wrong folder, paste a swatch table into a fixture, save a colleague's
 * exported CLF. This script is the guard rail.
 *
 * An important design note: this scanner does NOT contain a list of protected
 * colour values to match against. Embedding such a list would put exactly the
 * data we refuse to ship into the repository, and it would be a poor detector
 * anyway — it could only catch books it already knew. So it looks for
 * *structural* signatures instead:
 *
 *   1. colour-book binaries (.ase/.acb/.aco/.act) anywhere in the tree
 *   2. CLF documents whose declared licence is not permissive
 *   3. data files that look like a bulk proprietary swatch table — many
 *      colour-coded records in a file that also names a proprietary system
 *   4. colour-name tables whose entries cite a source outside the allowlist
 *   5. colour libraries under data/libraries/ that have been staged for commit
 *      (placeholders such as .gitkeep excepted — they hold no colour data)
 *
 * SCOPE: this inspects THE REPOSITORY, never the user's machine. Colour
 * libraries under data/libraries/ are reported as a count and otherwise left
 * alone — using a licensed colour book locally is legitimate, and only
 * redistribution is not. Do not "improve" this script by adding checks that
 * audit, warn about or refuse a user's own files: the engine is a shell, and a
 * shell has no business vetting its user. Both failure modes are real — such
 * checks cannot stop anyone determined, and they reliably punish everyone else.
 *
 * Usage:
 *   node tools/scan-protected.mjs [--json] [--quiet]
 *
 * Exit codes: 0 clean, 1 findings, 2 the scan itself could not run.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve, extname, sep, basename } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

/* ───────────────────────────────── policy ────────────────────────────────── */

/** Licences that may be committed. Anything else must not be in the repo. */
const PERMISSIVE_LICENCES = new Set([
  'mit', 'cc0', 'cc0-1.0', 'public-domain', 'apache-2.0', 'bsd', 'bsd-2-clause',
  'bsd-3-clause', 'ofl', 'cc-by', 'cc-by-sa',
]);

/** Binary colour-book formats. These are user data, never repository content. */
const COLOUR_BOOK_EXTENSIONS = new Set(['.ase', '.acb', '.aco', '.act']);

/**
 * Names of proprietary colour systems. Their presence is a hint, not proof: our
 * own documentation talks about them constantly, so a mention alone means
 * nothing.
 */
const PROPRIETARY_SYSTEMS = [/\bpantone\b/i, /\bfreetone\b/i, /\bRAL\s*classic\b/i];

/**
 * A pasted swatch table has a shape: line after line pairing a colour code with
 * a colour value. Prose does not, even when it discusses Pantone at length and
 * quotes example values. So the decisive signal is the number of lines that
 * pair the two, not the total count of either.
 *
 * That distinction is what keeps this check usable rather than obnoxious: a
 * document arguing about licensing will name Pantone repeatedly and show
 * sample values, and must not be flagged for doing so.
 * tests/repo.test.mjs plants exactly that shape and asserts it passes, so this
 * rule cannot quietly degrade into a mention counter.
 */
const PAIRED_LINE = new RegExp(
  String.raw`(#[0-9a-f]{6}\b[^\n]{0,40}?\b\d{2,4}\s*(?:C|U|TCX|TPG)\b)` +
    '|' +
    String.raw`(\b\d{2,4}\s*(?:C|U|TCX|TPG)\b[^\n]{0,40}?#[0-9a-f]{6}\b)`,
  'i'
);

/** How many paired lines make a file a table rather than prose. */
const PAIRED_LINE_THRESHOLD = 8;

/**
 * A single mention of a proprietary system is enough to make a table-shaped file
 * suspicious. A pasted conversion table is mostly code/value lines with one
 * header naming the system, so requiring many mentions would let the real thing
 * through — which is exactly what an earlier version of this check did.
 */
const SYSTEM_MENTION_GATE = 1;

/**
 * Escape hatch for the rare file that genuinely needs table-shaped lines in
 * prose. Putting this marker anywhere in the file exempts it, so the exemption
 * is visible in the diff rather than hidden in this script.
 */
const ALLOW_MARKER = 'scan-protected: allow-swatch-table';

/** Directories that are never scanned. */
const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'dist', '.workbuddy', 'coverage', '.cache',
]);

/** `data/libraries/` holds the user's own books and is gitignored — but scan it
 *  anyway so a mistake is visible locally, and separately check git staging. */
const USER_LIBRARY_DIR = join(ROOT, 'data', 'libraries');

const TEXT_EXTENSIONS = new Set([
  '.json', '.js', '.mjs', '.cjs', '.ts', '.md', '.txt', '.css', '.html', '.csv', '.tsv', '.yml', '.yaml',
]);

/* ──────────────────────────────── machinery ──────────────────────────────── */

const findings = [];
const notes = [];

const report = (level, check, file, message) => {
  findings.push({ level, check, file, message });
};

const rel = (p) => relative(ROOT, p).split(sep).join('/');

function* walk(dir, { includeUserLibraries = false } = {}) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      if (!includeUserLibraries && full === USER_LIBRARY_DIR) continue;
      yield* walk(full, { includeUserLibraries });
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

function readText(path) {
  try {
    return readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
  } catch {
    return null;
  }
}

/* ────────────────────────────────── checks ───────────────────────────────── */

/** 1. No colour-book binaries in the tree. */
function checkColourBookBinaries(files) {
  for (const file of files) {
    const ext = extname(file).toLowerCase();
    if (!COLOUR_BOOK_EXTENSIONS.has(ext)) continue;
    report(
      'error',
      'colour-book-binary',
      rel(file),
      `${ext} is a colour-book binary. These are user-supplied data and must never be committed — ` +
        'keep them outside the repository and convert them into ~/.coloroteca/libraries/.'
    );
  }
}

/** 2. Every committed CLF document must declare a permissive licence. */
function checkClfLicences(files) {
  for (const file of files) {
    if (!file.toLowerCase().endsWith('.clf.json')) continue;
    const text = readText(file);
    if (text == null) continue;

    let doc;
    try {
      doc = JSON.parse(text);
    } catch (err) {
      report('warn', 'clf-unparseable', rel(file), `not valid JSON: ${err.message}`);
      continue;
    }

    if (doc?.format !== 'coloroteca-library') continue;

    const licence = String(doc.meta?.license ?? '').trim().toLowerCase();
    if (!licence) {
      report('error', 'clf-no-licence', rel(file), 'CLF document has no meta.license.');
      continue;
    }
    if (!PERMISSIVE_LICENCES.has(licence)) {
      report(
        'error',
        'clf-restricted-licence',
        rel(file),
        `meta.license is "${licence}", which is not on the permissive allowlist. ` +
          'A colour library whose licence is not clearly free to redistribute does not belong in the repository.'
      );
    }
    if (!doc.meta?.source) {
      report('warn', 'clf-no-source', rel(file), 'CLF document has no meta.source.');
    }
  }
}

/**
 * 3. Pasted swatch tables that name a proprietary system.
 *
 * This is the thing we most want to avoid: someone pastes a third-party
 * conversion table into a fixture. The detector looks for the shape of a table
 * — repeated lines pairing a code with a colour value — rather than for volume
 * of either ingredient on its own, so documentation stays clean.
 */
function checkSwatchTables(files) {
  for (const file of files) {
    const ext = extname(file).toLowerCase();
    if (!TEXT_EXTENSIONS.has(ext)) continue;

    const text = readText(file);
    if (text == null || text.length > 4_000_000) continue;

    if (text.includes(ALLOW_MARKER)) continue;

    const systemMentions = PROPRIETARY_SYSTEMS.reduce(
      (n, re) => n + (text.match(new RegExp(re.source, 'gi')) ?? []).length,
      0
    );
    if (systemMentions < SYSTEM_MENTION_GATE) continue;

    const paired = text
      .split(/\r?\n/)
      .filter((line) => PAIRED_LINE.test(line)).length;

    if (paired >= PAIRED_LINE_THRESHOLD) {
      report(
        'error',
        'swatch-table',
        rel(file),
        `looks like a pasted swatch table: ${paired} lines pair a colour code with a colour value, ` +
          `and the file names a proprietary colour system ${systemMentions} times. ` +
          'A third-party conversion table must not be committed.'
      );
    }
  }
}

/** 4. Colour-name tables may only cite allow-listed sources. */
function checkNameTable() {
  const path = join(ROOT, 'data', 'zh-colornames.json');
  if (!existsSync(path)) {
    report('warn', 'name-table-missing', 'data/zh-colornames.json', 'colour-name table is absent');
    return;
  }

  let doc;
  try {
    doc = JSON.parse(readText(path));
  } catch (err) {
    report('error', 'name-table-invalid', 'data/zh-colornames.json', `not valid JSON: ${err.message}`);
    return;
  }

  const entries = Array.isArray(doc.entries) ? doc.entries : [];
  if (doc.count !== entries.length) {
    report(
      'warn',
      'name-table-count',
      'data/zh-colornames.json',
      `declared count ${doc.count} does not match ${entries.length} entries`
    );
  }

  const sources = new Map();
  for (const entry of entries) {
    const source = String(entry.source ?? '');
    sources.set(source, (sources.get(source) ?? 0) + 1);
    if (!source) {
      report('error', 'name-table-no-source', 'data/zh-colornames.json', `entry "${entry.name}" has no source`);
    }
  }

  const disallowed = [...sources.keys()].filter(
    (s) => s && !/MIT|Coloroteca curated/i.test(s)
  );
  if (disallowed.length) {
    report(
      'error',
      'name-table-source',
      'data/zh-colornames.json',
      `entries cite sources outside the allowlist: ${disallowed.join('; ')}. ` +
        'Only MIT-licensed or self-authored colour names may ship.'
    );
  }

  notes.push(
    `colour-name table: ${entries.length} entries from ${[...sources.keys()].join(' | ') || '(none)'}`
  );
}

/** 5. The user's own library directory must not be staged for commit. */
function checkUserLibrariesNotStaged() {
  if (!existsSync(USER_LIBRARY_DIR)) return;

  // Distinguish "no repository yet" from "git failed", so the note tells the
  // truth instead of blaming the toolchain.
  if (!existsSync(join(ROOT, '.git'))) {
    notes.push('not a git repository yet — skipped the check for staged user libraries');
    return;
  }

  let staged;
  try {
    staged = execFileSync('git', ['ls-files', '--', 'data/libraries'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    notes.push(`could not run git ls-files (${String(err.message).split('\n')[0]}) — staged-file check skipped`);
    return;
  }

  const tracked = staged.split(/\r?\n/).filter(Boolean);

  // A placeholder cannot carry colour data, so it cannot break the promise this
  // check protects. data/libraries/.gitkeep is re-included by .gitignore on
  // purpose, to keep the directory alive in a fresh clone — flagging it would
  // make the check fire on a correctly-configured repository.
  const offenders = tracked.filter((file) => !isPlaceholder(join(ROOT, file)));

  if (offenders.length) {
    report(
      'error',
      'user-library-tracked',
      'data/libraries/',
      `${offenders.length} file(s) under data/libraries/ are tracked by git: ${offenders.slice(0, 5).join(', ')}` +
        (offenders.length > 5 ? ', …' : '') +
        '. .gitignore should exclude them; run: git rm --cached <file>'
    );
  }
}

/**
 * True for a file that cannot plausibly be a user's colour library: the
 * conventional .gitkeep placeholder, or an empty file. Deliberately narrow —
 * a dotfile with a real payload (`.my-book.clf.json`) still counts as an
 * offender, because the cost of a false positive here is noise, while the cost
 * of a false negative is shipping someone's licensed colour book.
 */
function isPlaceholder(abs) {
  if (basename(abs) === '.gitkeep') return true;
  try {
    return statSync(abs).size === 0;
  } catch {
    return false;
  }
}

/** 6. Files under data/libraries are fine locally, but say what is there. */
function noteUserLibraries() {
  if (!existsSync(USER_LIBRARY_DIR)) return;
  let count = 0;
  for (const file of walk(USER_LIBRARY_DIR, { includeUserLibraries: true })) {
    if (file.toLowerCase().endsWith('.clf.json')) count++;
  }
  if (count) {
    notes.push(`local user libraries present (gitignored, not committed): ${count} file(s)`);
  }
}

/* ─────────────────────────────────── main ────────────────────────────────── */

function main() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');
  const quiet = argv.includes('--quiet');

  const files = [...walk(ROOT)];

  checkColourBookBinaries(files);
  checkClfLicences(files);
  checkSwatchTables(files);
  checkNameTable();
  checkUserLibrariesNotStaged();
  noteUserLibraries();

  const errors = findings.filter((f) => f.level === 'error');
  const warns = findings.filter((f) => f.level === 'warn');

  if (asJson) {
    console.log(JSON.stringify({ root: ROOT, scanned: files.length, findings, notes }, null, 2));
    process.exitCode = errors.length ? 1 : 0;
    return;
  }

  if (!quiet) {
    console.log(`合规扫描 · ${files.length} 个文件 · ${rel(ROOT) || '.'}`);
    console.log('');
    for (const note of notes) console.log(`  note: ${note}`);
    if (notes.length) console.log('');
  }

  if (!findings.length) {
    console.log('PASS — 仓库内没有发现受保护色库数据。');
    console.log('');
    console.log('  检查项：色库二进制文件 · CLF 许可声明 · 批量色卡表特征 · 色名表来源 · data/libraries 是否入库');
    return;
  }

  for (const f of findings) {
    const tag = f.level === 'error' ? 'ERROR' : 'WARN ';
    console.log(`${tag} [${f.check}] ${f.file}`);
    console.log(`      ${f.message}`);
  }

  console.log('');
  console.log(`${errors.length} 个错误 / ${warns.length} 个警告`);

  if (errors.length) {
    console.log('');
    console.log('这份仓库的立身之本是「只发引擎、不发色库」。上面的错误会破坏这个承诺，');
    console.log('即使本地测试全过也不应提交。');
    process.exitCode = 1;
  }
}

try {
  main();
} catch (err) {
  console.error(`scan-protected: the scan could not complete — ${err.message}`);
  process.exit(2);
}
