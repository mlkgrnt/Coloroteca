#!/usr/bin/env node
/**
 * List the colour libraries available to the command-line tools.
 *
 *   node skill/scripts/list.mjs
 *   node skill/scripts/list.mjs --json
 *   node skill/scripts/list.mjs --include-demo
 *
 * @module skill/scripts/list
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { DEFAULT_LIBRARY_DIR, ROOT, emit, parseArgs, toMarkdownTable, usage } from './lib.mjs';

const USAGE = `
list.mjs — list available Coloroteca libraries

USAGE
  list.mjs [--dir <path>] [--include-demo] [--json] [--verbose]

OPTIONS
  --dir <path>      library directory (default ~/.coloroteca/libraries)
  --include-demo    also list the sample libraries bundled with the project
  --json            machine-readable output
  --verbose         include the file path and any import warnings
`;

const args = parseArgs(process.argv.slice(2), { booleans: ['json', 'verbose', 'include-demo', 'help'] });

if (args.help) {
  usage(USAGE);
  process.exit(0);
}

const dir = args.dir ?? DEFAULT_LIBRARY_DIR;

/** Read a CLF file and summarise it, or report why it could not be read. */
function describe(path) {
  try {
    const doc = JSON.parse(readFileSync(path, 'utf8'));
    if (doc?.format !== 'coloroteca-library') {
      return { path, broken: `not a CLF document (format: ${JSON.stringify(doc?.format)})` };
    }
    const meta = doc.meta ?? {};
    const colors = Array.isArray(doc.colors) ? doc.colors.length : 0;
    const warnings = [];
    if (meta.colorCount != null && meta.colorCount !== colors) {
      warnings.push(`meta.colorCount 是 ${meta.colorCount}，实际 ${colors} 色`);
    }
    return {
      path,
      id: doc.id,
      name: meta.name ?? doc.id,
      system: meta.system ?? 'CUSTOM',
      count: colors,
      source: meta.source ?? 'unknown',
      license: meta.license ?? 'unknown',
      importedAt: meta.importedAt ?? null,
      warnings,
    };
  } catch (err) {
    return { path, broken: `cannot parse: ${err.message}` };
  }
}

function collectFrom(directory, origin) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((f) => f.toLowerCase().endsWith('.clf.json'))
    .map((f) => ({ ...describe(join(directory, f)), origin }));
}

const entries = [
  ...collectFrom(dir, '用户色库'),
  ...(args['include-demo'] ? collectFrom(join(ROOT, 'data', 'demo'), '内置示例') : []),
].sort((a, b) => (a.name ?? a.path).localeCompare(b.name ?? b.path, 'zh-Hans-CN'));

if (args.json) {
  emit(JSON.stringify({ directory: dir, libraries: entries }, null, 2));
  process.exit(0);
}

if (!entries.length) {
  emit(
    [
      args['include-demo'] ? '没有找到任何色库。' : `没有找到色库：${dir}`,
      '',
      'Coloroteca deliberately ships no colour library data — Pantone, Freetone and',
      'the like are not ours to redistribute. You supply the books you are entitled to use.',
      '',
      '下一步：',
      '  1. 拿到你自己的 .ase / .acb / .gpl 色库文件；',
      '  2. 转换到 CLF：',
      `       node skill/scripts/convert.mjs <your-file> -o "${join(dir, 'my-book.clf.json')}"`,
      '  3. 再看这份列表，用 match.mjs --library 匹配。',
      '',
      '获取色库的合法途径见 docs/GETTING-LIBRARIES.md。',
      '想先试一下，可以加 --include-demo 看内置示例色库。',
    ].join('\n')
  );
  process.exit(0);
}

const head = ['色库', 'ID', '色号数', '体系', '许可', '位置', '来源'];
const rows = entries.map((e) => {
  if (e.broken) return [`⚠ ${e.path.split(/[\\/]/).pop()}`, '—', '—', '—', '—', e.origin, e.broken];
  return [e.name, e.id, String(e.count), e.system, e.license, e.origin, e.source];
});

const header = `${entries.length} 个色库 · 目录 ${dir}`;
const lines = [header, '', toMarkdownTable(head, rows)];

if (args.verbose) {
  lines.push('');
  lines.push('来源标注：');
  for (const e of entries) {
    lines.push(`  ${e.broken ? '⚠ ' : '· '}${e.broken ?? e.path}`);
    for (const w of e.warnings ?? []) lines.push(`      warning: ${w}`);
  }
}

const withoutProvenance = entries.filter(
  (e) => !e.broken && (!e.source || e.source === 'unknown' || e.license === 'unknown')
);
if (withoutProvenance.length) {
  lines.push('');
  lines.push(
    `注意：${withoutProvenance.length} 个色库没有标注来源或许可。CLF 要求这两个字段，` +
      '导入时可补上；来源不明的数据在对外使用前应当先查清。'
  );
}

emit(lines.join('\n'));
