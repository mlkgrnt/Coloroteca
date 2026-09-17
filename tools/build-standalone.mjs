#!/usr/bin/env node
/**
 * Build a single-file, double-clickable copy of the web app.
 *
 * Why this exists: browsers refuse to load `<script type="module">` from a
 * file:// page — the origin is opaque, so fetching the module is a CORS error.
 * The app is written as plain ES modules with no build step, which is the right
 * call for the source tree, but it means double-clicking web/index.html does
 * not work in Chrome.
 *
 * So: this script inlines the whole module graph and the stylesheet into one
 * HTML file. The result is a classic (non-module) script, which file:// pages
 * may load freely. Open dist/coloroteca.html and everything works offline, with
 * no server and no install.
 *
 * The bundler is deliberately small and strict. It understands exactly the
 * module syntax this project uses and throws on anything else, so it can never
 * quietly emit a broken bundle. In particular it refuses:
 *
 *   - bare imports (node: builtins, npm packages) — nothing may creep into the
 *     browser build from the tooling side
 *   - `export default` of anything other than a plain identifier
 *   - a re-export whose name is not also imported, which would leave a dangling
 *     reference at runtime
 *   - circular imports, which this ordering scheme cannot express
 *
 * Usage:
 *   node tools/build-standalone.mjs [--out dist/coloroteca.html] [--check]
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve, sep } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const ENTRY = join(ROOT, 'web', 'app.js');
const HTML_IN = join(ROOT, 'web', 'index.html');
const CSS_IN = join(ROOT, 'web', 'style.css');

/* ─────────────────────────── module syntax patterns ──────────────────────── */

const RE = {
  // import { a, b } from './x.js'   (the braces may span lines)
  namedImport: /^[ \t]*import\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"]\s*;?[ \t]*$/gm,
  // import * as ns from './x.js'
  namespaceImport: /^[ \t]*import\s*\*\s*as\s+([A-Za-z_$][\w$]*)\s*from\s*['"]([^'"]+)['"]\s*;?[ \t]*$/gm,
  // import './x.js'
  sideEffectImport: /^[ \t]*import\s*['"]([^'"]+)['"]\s*;?[ \t]*$/gm,
  // export { a, b } from './x.js'
  reExport: /^[ \t]*export\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"]\s*;?[ \t]*$/gm,
  // export default someIdentifier;
  exportDefault: /^[ \t]*export\s+default\s+([A-Za-z_$][\w$]*)\s*;?[ \t]*$/gm,
  // export function f / export async function f
  exportFunction: /^[ \t]*export\s+(async\s+function|function)\s+([A-Za-z_$][\w$]*)/gm,
  // export const X / export let X / export var X
  exportDecl: /^[ \t]*export\s+(const|let|var)\s+([A-Za-z_$][\w$]*)/gm,
};

const fail = (message) => {
  throw new Error(`build-standalone: ${message}`);
};

/* ────────────────────────────── module graph ─────────────────────────────── */

const specifierToFile = (fromFile, specifier) => {
  if (!specifier.startsWith('.')) {
    fail(
      `bare import "${specifier}" found in ${relative(ROOT, fromFile)}. ` +
        'Only relative imports may reach the browser bundle.'
    );
  }
  return resolve(dirname(fromFile), specifier);
};

/** Key used inside __modules: a repo-relative POSIX path. */
const moduleKey = (file) => relative(ROOT, file).split(sep).join('/');

/**
 * Read a module and split it into its dependencies and its transformed body.
 *
 * @param {string} file absolute path
 * @returns {{file:string, key:string, body:string, exports:string[], deps:string[]}}
 */
function transform(file) {
  const source = readFileSync(file, 'utf8');
  const deps = new Set();
  const hoisted = [];
  const exports = new Set();

  const exportedNames = new Set();

  // Collect what this module exports. Declarations are found first because the
  // `export` keyword is stripped afterwards.
  for (const m of source.matchAll(RE.exportFunction)) exportedNames.add(m[2]);
  for (const m of source.matchAll(RE.exportDecl)) exportedNames.add(m[2]);

  // Re-exports: keep the names, but they must already be imported here.
  const importedFrom = new Map(); // module file -> Set of names
  for (const m of source.matchAll(RE.namedImport)) {
    const spec = m[2];
    const dep = specifierToFile(file, spec);
    const names = m[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const n of names) {
      if (n.startsWith('{')) fail(`unsupported import form in ${relative(ROOT, file)}: ${n}`);
    }
    if (!importedFrom.has(dep)) importedFrom.set(dep, new Set());
    for (const n of names) importedFrom.get(dep).add(n);
  }

  for (const m of source.matchAll(RE.reExport)) {
    const dep = specifierToFile(file, m[2]);
    const names = m[1].split(',').map((s) => s.trim()).filter(Boolean);
    for (const n of names) {
      if (n.includes(' as ')) {
        fail(`"export { x as y }" is not supported (${relative(ROOT, file)})`);
      }
      if (!importedFrom.get(dep)?.has(n)) {
        fail(
          `re-exported name "${n}" in ${relative(ROOT, file)} is not imported from ` +
            `${m[2]}; the bundle would reference an undefined binding.`
        );
      }
      exportedNames.add(n);
    }
  }

  // Now rewrite. Order of replacement matters: re-exports before named imports
  // so the longer pattern is not clipped by the shorter one.
  const body = source
    .replace(RE.reExport, '')

    // import { a, b } from './x.js'  ->  const { a, b } = __modules['x'];
    .replace(RE.namedImport, (_full, names, spec) => {
      const dep = specifierToFile(file, spec);
      deps.add(dep);
      const clean = names
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .join(', ');
      // Hoisting matches ES module semantics: imported bindings are available
      // before the statement that names them.
      hoisted.push(`const { ${clean} } = __modules[${JSON.stringify(moduleKey(dep))}];`);
      return '';
    })

    .replace(RE.namespaceImport, (_full, ns, spec) => {
      const dep = specifierToFile(file, spec);
      deps.add(dep);
      hoisted.push(`const ${ns} = __modules[${JSON.stringify(moduleKey(dep))}];`);
      return '';
    })

    .replace(RE.sideEffectImport, (_full, spec) => {
      const dep = specifierToFile(file, spec);
      deps.add(dep);
      hoisted.push(`__modules[${JSON.stringify(moduleKey(dep))}];`);
      return '';
    })

    .replace(RE.exportDefault, (_full, name) => {
      exportedNames.add('default');
      return `/* default export ${name} dropped: nothing in the bundle imports it */`;
    })

    .replace(RE.exportFunction, (_full, kind, name) => `${kind} ${name}`)
    .replace(RE.exportDecl, (_full, kind, name) => `${kind} ${name}`)
    // Any surviving `export` is a form we do not understand.
    .replace(/^[ \t]*export\b.*$/gm, (line) => {
      fail(`unsupported export form in ${relative(ROOT, file)}: ${line.trim()}`);
    });

  for (const n of exportedNames) if (n !== 'default') exports.add(n);

  return {
    file,
    key: moduleKey(file),
    body: [...hoisted, '', body].join('\n'),
    exports: [...exports].sort(),
    deps: [...deps],
  };
}

/**
 * Depth-first post-order walk: dependencies are emitted before dependents, so
 * each IIFE can read its dependencies out of __modules as it runs.
 */
function collect(entry) {
  const modules = new Map();
  const visiting = new Set();
  const order = [];

  const walk = (file) => {
    if (modules.has(file)) return;
    if (visiting.has(file)) {
      fail(`circular import involving ${relative(ROOT, file)} — flatten it before bundling`);
    }
    visiting.add(file);

    const mod = transform(file);
    for (const dep of mod.deps) {
      if (!existsSync(dep)) fail(`missing module ${dep} imported from ${relative(ROOT, file)}`);
      walk(dep);
    }

    visiting.delete(file);
    modules.set(file, mod);
    if (file !== entry) order.push(mod);
  };

  walk(entry);
  const entryMod = modules.get(entry);
  if (!entryMod) fail('entry module was not collected');
  order.push(entryMod); // entry last: its body is what kicks everything off
  return order;
}

/* ─────────────────────────────── emit bundle ─────────────────────────────── */

function emitBundle(order) {
  const parts = [
    '(function () {',
    "'use strict';",
    '',
    '/*',
    ' * Coloroteca — bundled build.',
    ' * Generated by tools/build-standalone.mjs. Do not edit; edit web/ and rebuild.',
    ' *',
    ' * The module graph is inlined below in dependency order. No network calls,',
    ' * no imports at runtime: this is the whole application.',
    ' */',
    '',
    'var __modules = Object.create(null);',
    '',
  ];

  for (const mod of order) {
    const returnList = mod.exports.map((n) => `${n}: ${n}`).join(', ');
    parts.push(`/* ── ${mod.key} ${'─'.repeat(Math.max(2, 62 - mod.key.length))} */`);
    parts.push(`__modules[${JSON.stringify(mod.key)}] = (function () {`);
    parts.push(mod.body.trim());
    parts.push('');
    parts.push(`return { ${returnList} };`);
    parts.push('})();');
    parts.push('');
  }

  parts.push('})();');
  return parts.join('\n');
}

/* ─────────────────────────────── emit HTML ───────────────────────────────── */

function emitHtml(bundle) {
  let html = readFileSync(HTML_IN, 'utf8');
  const css = readFileSync(CSS_IN, 'utf8');

  const styleTag = `<link rel="stylesheet" href="style.css">`;
  if (!html.includes(styleTag)) fail('could not find the stylesheet link in web/index.html');
  html = html.replace(
    styleTag,
    `<style>\n${css.trim()}\n</style>`
  );

  const scriptTag = `<script type="module" src="app.js"></script>`;
  if (!html.includes(scriptTag)) fail('could not find the module script tag in web/index.html');
  html = html.replace(scriptTag, `<script>\n${bundle}\n</script>`);

  // The footer links point at files that only exist in the repository, so a
  // standalone copy cannot follow them. Replace them with plain text.
  const linksBlock = /<p class="footer-links">[\s\S]*?<\/p>/;
  if (!linksBlock.test(html)) fail('could not find the footer links block in web/index.html');
  html = html.replace(
    linksBlock,
    '<p class="footer-links">单文件版：文档与色库格式说明在仓库的 docs/ 目录下。</p>'
  );

  return html;
}

/* ────────────────────────────────── main ─────────────────────────────────── */

function main() {
  const argv = process.argv.slice(2);
  const checkOnly = argv.includes('--check');
  const outIdx = argv.indexOf('--out');
  const outPath = outIdx >= 0 ? resolve(argv[outIdx + 1]) : join(ROOT, 'dist', 'coloroteca.html');

  console.log('bundling web app');
  const order = collect(ENTRY);
  const bundle = emitBundle(order);
  const html = emitHtml(bundle);

  console.log(`  modules inlined: ${order.length}`);
  for (const m of order) {
    console.log(`    ${m.key.padEnd(26)} ${String(m.body.length).padStart(7)} bytes  exports: ${m.exports.length}`);
  }
  console.log(`  bundle size: ${(bundle.length / 1024).toFixed(1)} KB`);
  console.log(`  output size: ${(html.length / 1024).toFixed(1)} KB`);

  if (checkOnly) {
    if (!existsSync(outPath)) {
      console.error(`  MISSING: ${outPath}`);
      process.exitCode = 1;
      return;
    }
    if (readFileSync(outPath, 'utf8') !== html) {
      console.error(`  STALE: ${outPath} differs from a fresh build`);
      process.exitCode = 1;
      return;
    }
    console.log(`  up to date: ${outPath}`);
    return;
  }

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, html, 'utf8');
  console.log(`  wrote ${outPath}`);
}

try {
  main();
} catch (err) {
  console.error(String(err.message ?? err));
  process.exit(1);
}
