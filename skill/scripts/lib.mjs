/**
 * Shared helpers for the Coloroteca command-line scripts.
 *
 * Layout independence is the thing to notice here. These scripts are run from
 * two places:
 *
 *   in the repository        <repo>/skill/scripts/match.mjs
 *   installed as a skill     ~/.workbuddy/skills/coloroteca/scripts/match.mjs
 *
 * Rather than hard-code a relative path that only holds in one of them, the
 * root is found by walking upwards until core/matcher.js turns up. Set
 * COLOROTECA_ROOT to skip the search.
 *
 * @module skill/scripts/lib
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/* ─────────────────────────────── project root ────────────────────────────── */

function findRoot() {
  if (process.env.COLOROTECA_ROOT) {
    const forced = resolve(process.env.COLOROTECA_ROOT);
    if (!existsSync(join(forced, 'core', 'matcher.js'))) {
      throw new Error(`COLOROTECA_ROOT (${forced}) does not contain core/matcher.js`);
    }
    return forced;
  }

  let dir = HERE;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'core', 'matcher.js'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `could not locate the Coloroteca root from ${HERE}. ` +
      'Expected an ancestor directory containing core/matcher.js, or set COLOROTECA_ROOT.'
  );
}

export const ROOT = findRoot();

/** Lazily import a module from the shared core. */
export const coreModule = (relPath) =>
  import(pathToFileURL(join(ROOT, relPath)).href);

export const DEFAULT_LIBRARY_DIR = join(homedir(), '.coloroteca', 'libraries');

/* ─────────────────────────────── arg parsing ─────────────────────────────── */

/**
 * A very small option parser: `--key value`, `--key=value`, `--flag`, short
 * aliases, and repeated keys collected into an array.
 *
 * Anything unrecognised, and any bare `-`, is a positional. That last rule
 * matters because `--batch -` means "read standard input", and a bare dash is
 * conventionally a value rather than a flag.
 *
 * @param {string[]} argv
 * @param {{booleans?:string[], aliases?:Record<string,string>}} [options]
 *   `booleans` lists keys that never take a value; `aliases` maps a short flag
 *   such as '-o' to its long name.
 */
export function parseArgs(argv, options = {}) {
  const booleans = new Set(options.booleans ?? []);
  const aliases = options.aliases ?? {};
  const out = { _: [] };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];

    if (!token.startsWith('-') || token === '-') {
      out._.push(token);
      continue;
    }

    const eq = token.indexOf('=');
    const rawKey = eq > 0 ? token.slice(0, eq) : token;
    const inlineValue = eq > 0 ? token.slice(eq + 1) : undefined;

    let key;
    if (rawKey.startsWith('--')) key = rawKey.slice(2);
    else if (aliases[rawKey]) key = aliases[rawKey];
    else {
      // Unknown short flag: not ours to interpret, so pass it through.
      out._.push(token);
      continue;
    }

    if (inlineValue !== undefined) {
      assign(out, key, inlineValue);
      continue;
    }

    const next = argv[i + 1];
    const nextIsValue = next !== undefined && (!next.startsWith('-') || next === '-');
    if (booleans.has(key) || !nextIsValue) {
      assign(out, key, true);
    } else {
      assign(out, key, next);
      i++;
    }
  }
  return out;
}

function assign(out, key, value) {
  if (key in out) {
    out[key] = Array.isArray(out[key]) ? [...out[key], value] : [out[key], value];
  } else {
    out[key] = value;
  }
}

/* ─────────────────────────────── libraries ───────────────────────────────── */

/**
 * Every library we can find, newest name order, deduplicated by id.
 *
 * @param {string} [dir]
 * @returns {Array<{id:string,name:string,path:string}>}
 */
export function discoverLibraries(dir = DEFAULT_LIBRARY_DIR) {
  if (!existsSync(dir)) return [];
  const found = new Map();

  for (const entry of readdirSync(dir)) {
    if (!entry.toLowerCase().endsWith('.clf.json')) continue;
    const path = join(dir, entry);
    try {
      const doc = JSON.parse(readFileSync(path, 'utf8'));
      if (doc?.format !== 'coloroteca-library') continue;
      if (!found.has(doc.id)) {
        found.set(doc.id, { id: doc.id, name: doc.meta?.name ?? doc.id, path });
      }
    } catch {
      // A malformed file is not fatal: skip it and let `list` report the rest.
    }
  }

  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
}

/**
 * Resolve a `--library` argument, which may be a path or an id.
 *
 * @param {string|undefined} spec
 * @param {string} [dir]
 * @returns {{id:string,name:string,path:string,doc:object}}
 */
export function resolveLibrary(spec, dir = DEFAULT_LIBRARY_DIR) {
  if (spec) {
    const candidates = [];
    if (isAbsolute(spec) || spec.includes('/') || spec.includes('\\')) {
      candidates.push(resolve(spec));
    } else {
      candidates.push(join(dir, `${spec}.clf.json`));
      candidates.push(resolve(spec));
      const byId = discoverLibraries(dir).find((l) => l.id === spec);
      if (byId) candidates.push(byId.path);
    }

    for (const path of candidates) {
      if (existsSync(path) && statSync(path).isFile()) return loadLibraryFile(path);
    }
    throw new Error(
      `no library matched "${spec}". ` +
        `Looked for a file at that path and for an id in ${dir}. ` +
        'Run list.mjs to see what is available.'
    );
  }

  const available = discoverLibraries(dir);
  if (!available.length) {
    throw new Error(
      `no colour libraries found in ${dir}.\n` +
        'Coloroteca does not bundle any colour library data — you supply your own.\n' +
        'Import a .ase / .acb / .gpl / .clf.json file, then point this tool at it:\n' +
        '  node skill/scripts/convert.mjs <your-file> -o ~/.coloroteca/libraries/my-book.clf.json\n' +
        'See docs/GETTING-LIBRARIES.md for where to obtain colour books legitimately.'
    );
  }
  return loadLibraryFile(available[0].path);
}

function loadLibraryFile(path) {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const { validateLibrary, normalizeLibrary } = libs.clf;
  const check = validateLibrary(raw);
  if (!check.valid) {
    throw new Error(`${path} is not a valid CLF document: ${check.errors.join('; ')}`);
  }
  const { library } = normalizeLibrary(raw);
  return { id: library.id, name: library.meta.name, path, doc: library };
}

/**
 * The core modules, loaded once on first use so the CLI stays fast to start
 * when a script only needs one of them.
 */
export const libs = await (async () => {
  const [colorSpace, deltaE, clf, matcher, parsers] = await Promise.all([
    coreModule('core/color-space.js'),
    coreModule('core/delta-e.js'),
    coreModule('core/clf.js'),
    coreModule('core/matcher.js'),
    coreModule('parsers/index.js'),
  ]);
  return { colorSpace, deltaE, clf, matcher, parsers };
})();

/* ──────────────────────────────── output ─────────────────────────────────── */

const supportsColor = () => {
  if (process.env.NO_COLOR) return false;
  if (process.env.COLOROTECA_COLOR === 'always') return true;
  if (process.env.COLOROTECA_COLOR === 'never') return false;
  return Boolean(process.stdout.isTTY);
};

/**
 * A colour chip for the swatch column.
 *
 * ANSI truecolour when the output is a terminal; a plain block character
 * otherwise, because escape codes travelling through a log or a chat message
 * are just noise. The hex column always carries the authoritative value.
 *
 * @param {number[]} rgb
 * @param {'auto'|'ansi'|'block'|'none'} mode
 */
export function swatch(rgb, mode = 'auto') {
  const resolved = mode === 'auto' ? (supportsColor() ? 'ansi' : 'block') : mode;
  if (resolved === 'none') return '';
  if (resolved === 'block') return '████';
  const [r, g, b] = rgb;
  return `\u001b[48;2;${r};${g};${b}m    \u001b[0m`;
}

/** Pad a string to a display width, counting CJK characters as two columns. */
export function pad(text, width) {
  const s = String(text ?? '');
  let display = 0;
  for (const ch of s) {
    const code = ch.codePointAt(0);
    display +=
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6)
        ? 2
        : 1;
  }
  return s + ' '.repeat(Math.max(0, width - display));
}

/**
 * Render matches as a Markdown table. Markdown is the default because the
 * primary consumer is a chat interface, not a terminal.
 */
export function matchesToMarkdown(matches, { swatchMode = 'auto', includeBreakdown = true } = {}) {
  const head = includeBreakdown
    ? ['#', '色号', '色块', 'HEX', 'RGB', 'ΔE2000', '感知', 'ΔL / ΔC / ΔH']
    : ['#', '色号', '色块', 'HEX', 'RGB', 'ΔE2000', '感知'];

  const rows = matches.map((m) => {
    const cells = [
      String(m.rank),
      m.displayCode,
      swatch(m.rgb, swatchMode) || '·',
      m.hex.toUpperCase(),
      (m.rgb ?? []).join(','),
      m.deltaE.toFixed(2),
      m.grade.label,
    ];
    if (includeBreakdown) {
      cells.push(
        m.breakdown
          ? `${m.breakdown.dL >= 0 ? '+' : ''}${m.breakdown.dL} / ${m.breakdown.dC >= 0 ? '+' : ''}${m.breakdown.dC} / ${m.breakdown.dH}`
          : ''
      );
    }
    return cells;
  });

  return toMarkdownTable(head, rows);
}

export function toMarkdownTable(head, rows) {
  const widths = head.map((h, i) =>
    Math.max(visibleWidth(h), ...rows.map((r) => visibleWidth(r[i] ?? '')))
  );
  const line = (cells) =>
    `| ${cells.map((c, i) => pad(c ?? '', widths[i])).join(' | ')} |`;
  const sep = `|${widths.map((w) => '-'.repeat(w + 2)).join('|')}|`;

  return [line(head), sep, ...rows.map(line)].join('\n');
}

/** Strip ANSI escapes before measuring, so coloured swatches do not skew widths. */
export function visibleWidth(text) {
  const stripped = String(text ?? '').replace(/\u001b\[[0-9;]*m/g, '');
  let width = 0;
  for (const ch of stripped) {
    const code = ch.codePointAt(0);
    width +=
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6)
        ? 2
        : 1;
  }
  return width;
}

export function toCsv(head, rows) {
  const escape = (v) => {
    const s = String(v ?? '');
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [head, ...rows].map((r) => r.map(escape).join(',')).join('\n');
}

/** Print to stdout and exit, unless the caller asked for a different stream. */
export function emit(text, stream = process.stdout) {
  stream.write(text.endsWith('\n') ? text : text + '\n');
}

export function fail(message, code = 1) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

export function usage(lines) {
  emit(lines.join('\n'), process.stderr);
}
