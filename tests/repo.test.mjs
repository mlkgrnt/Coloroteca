/**
 * Repository-level invariants.
 *
 * The core and parser suites cover behaviour. This file covers the promises the
 * *repository* makes — that the bundled data is redistributable, that the
 * generated artifacts are current, that the compliance scanner still works, and
 * that the command-line tools run end to end.
 *
 * These are the checks that catch the mistakes nobody notices until they
 * matter: a colour book committed by accident, demo data hand-edited and left
 * drifting from its generator, a bundler change that quietly emits imports the
 * browser cannot resolve.
 *
 * @module tests/repo
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const readJson = (relPath) => JSON.parse(readFileSync(join(ROOT, relPath), 'utf8'));
const readText = (relPath) => readFileSync(join(ROOT, relPath), 'utf8');

/**
 * Run a script in the repository and capture everything, including failure.
 * @returns {{status:number, stdout:string, stderr:string}}
 */
function run(script, args = []) {
  try {
    const stdout = execFileSync(process.execPath, [join(ROOT, script), ...args], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    return {
      status: err.status ?? 1,
      stdout: err.stdout?.toString() ?? '',
      stderr: err.stderr?.toString() ?? '',
    };
  }
}

/** Create a scratch directory that is cleaned up when the callback returns. */
function withTempDir(prefix, fn) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/* ═══════════════════════════════ bundled data ══════════════════════════════ */

test('the colour-name table is well formed', () => {
  const doc = readJson('data/zh-colornames.json');
  assert.equal(doc.version, 1);
  assert.ok(Array.isArray(doc.entries), 'entries must be an array');
  assert.ok(doc.entries.length > 100, `expected a substantial table, got ${doc.entries.length}`);
  assert.equal(doc.count, doc.entries.length, 'declared count must match entries');
});

test('every colour-name entry has a usable value and a permissive source', () => {
  const doc = readJson('data/zh-colornames.json');
  const seen = new Set();

  for (const entry of doc.entries) {
    assert.ok(entry.name, 'entry is missing a name');
    assert.match(entry.hex, /^#[0-9a-f]{6}$/, `${entry.name} has a bad hex: ${entry.hex}`);
    assert.ok(Array.isArray(entry.aliases), `${entry.name} has no aliases array`);
    assert.ok(
      ['traditional', 'modern'].includes(entry.category),
      `${entry.name} has an unexpected category: ${entry.category}`
    );

    // This is the whole reason the table looks the way it does: the GPL-3.0 and
    // unlicensed Chinese colour datasets are excluded on purpose, so only
    // MIT-licensed upstream data and our own curated names may ship.
    assert.match(
      entry.source ?? '',
      /MIT|Coloroteca curated/,
      `${entry.name} cites a source outside the allowlist: ${entry.source}`
    );

    assert.ok(!seen.has(entry.name), `duplicate colour name: ${entry.name}`);
    seen.add(entry.name);
  }
});

test('modern colour names are marked approximate, traditional ones are not', () => {
  const doc = readJson('data/zh-colornames.json');
  for (const entry of doc.entries) {
    if (entry.category === 'modern') {
      assert.equal(
        entry.approximate,
        true,
        `${entry.name} is a descriptive name and must be marked approximate`
      );
    } else {
      assert.equal(
        entry.approximate,
        false,
        `${entry.name} comes from a dataset and should not be marked approximate`
      );
    }
  }
});

test('the colour-name table contains no brand or trademark colour names', () => {
  const raw = readText('data/zh-colornames.json').toLowerCase();
  // These are marks owned by specific companies, not generic colour words. They
  // are excluded deliberately, then asserted here so they cannot creep back in.
  for (const mark of ['蒂芙尼', 'tiffany', '克莱因', 'klein', '爱马仕', 'hermès', 'hermes']) {
    assert.ok(!raw.includes(mark.toLowerCase()), `"${mark}" is a brand identifier and must not appear`);
  }
});

test('bundled demo libraries are valid CLF with permissive licences', async () => {
  const { validateLibrary } = await import('../core/clf.js');
  const { DEMO_LIBRARIES } = await import('../web/demo-libraries.js');

  assert.ok(DEMO_LIBRARIES.length >= 2, 'expected at least two demo libraries');

  const permissive = new Set(['mit', 'cc0', 'public-domain', 'ofl', 'apache-2.0', 'bsd']);
  for (const doc of DEMO_LIBRARIES) {
    const check = validateLibrary(doc);
    assert.ok(check.valid, `${doc.id} is not valid CLF: ${check.errors.join('; ')}`);
    assert.ok(doc.meta.source, `${doc.id} is missing meta.source`);
    assert.ok(
      permissive.has(String(doc.meta.license).toLowerCase()),
      `${doc.id} has a non-permissive licence: ${doc.meta.license}`
    );
  }
});

test('the web bundle has not drifted from the .clf.json files it is built from', async () => {
  const { DEMO_LIBRARIES } = await import('../web/demo-libraries.js');

  for (const doc of DEMO_LIBRARIES) {
    const rel = `data/demo/${doc.id}.clf.json`;
    assert.ok(existsSync(join(ROOT, rel)), `missing ${rel}`);
    assert.deepEqual(
      doc,
      readJson(rel),
      `web/demo-libraries.js differs from ${rel} — rerun tools/make-demo-libraries.mjs`
    );
  }
});

test('the demo wheel is 24 hues x 3 levels plus an 11-step grey ramp', () => {
  const doc = readJson('data/demo/demo-wheel.clf.json');
  assert.equal(doc.colors.length, 24 * 3 + 11);
  assert.equal(doc.meta.colorCount, doc.colors.length);
  assert.equal(doc.meta.license, 'CC0');

  const greys = doc.colors.filter((c) => c.code.startsWith('GRAY-'));
  assert.equal(greys.length, 11);
  assert.equal(greys[0].hex, '#000000');
  assert.equal(greys[10].hex, '#ffffff');
});

test('the bundled traditional library matches the MIT dataset size', () => {
  const doc = readJson('data/demo/chinese-traditional.clf.json');
  assert.equal(doc.colors.length, 158);
  assert.equal(doc.meta.license, 'MIT');
  assert.match(doc.meta.source, /ancient-chinese-color/);
});

/* ══════════════════════════════ generated tools ════════════════════════════ */

test('make-demo-libraries reports the checked-in demo data as current', () => {
  const result = run('tools/make-demo-libraries.mjs', ['--check']);
  assert.equal(result.status, 0, `demo data is stale or missing:\n${result.stdout}\n${result.stderr}`);
});

/* ═════════════════════════════ boundary conditions ═════════════════════════ */

test('parseColorInput handles the spellings the UI advertises', async () => {
  const { parseColorInput } = await import('../core/color-space.js');
  for (const spelling of ['#FF6B6B', 'ff6b6b', '#F6B', 'rgb(255 107 107)', '255,107,107', 'hsl(0 100% 71%)']) {
    const parsed = parseColorInput(spelling);
    assert.ok(parsed, `failed to parse: ${spelling}`);
    assert.match(parsed.hex, /^#[0-9a-f]{6}$/, `${spelling} produced a bad hex`);
  }
});

test('a colour library with no usable entries is rejected rather than silently empty', async () => {
  const { validateLibrary } = await import('../core/clf.js');

  const empty = {
    format: 'coloroteca-library',
    version: '1.0',
    id: 'empty',
    meta: { name: 'Empty', colorCount: 2, source: 'test', license: 'cc0' },
    colors: [{ code: 'a' }, { code: 'b', hex: 'not-a-hex' }],
  };
  const check = validateLibrary(empty);
  assert.equal(check.stats.dropped, 2, 'both entries should be counted as dropped');
  assert.equal(check.stats.usable, 0);
  assert.ok(
    check.warnings.some((w) => /no usable hex/.test(w)),
    'a fully unusable library should warn'
  );
});

/* ═══════════════════════════════ build output ══════════════════════════════ */

test('the standalone build inlines the whole graph and needs no module loader', () => {
  withTempDir('ct-build-', (dir) => {
    const outPath = join(dir, 'coloroteca.html');
    const result = run('tools/build-standalone.mjs', ['--out', outPath]);
    assert.equal(result.status, 0, `build failed:\n${result.stdout}\n${result.stderr}`);
    assert.ok(existsSync(outPath), 'the build produced no file');

    const html = readFileSync(outPath, 'utf8');

    // This is the reason the standalone exists at all: file:// pages cannot load
    // module scripts, so the output must not depend on one.
    assert.ok(!/<script[^>]*type=["']module["']/i.test(html), 'still contains a module script tag');
    assert.ok(!/<script[^>]*\ssrc=/i.test(html), 'still references an external script');
    assert.ok(!/<link[^>]*stylesheet/i.test(html), 'the stylesheet was not inlined');
    assert.ok(!/\bfrom\s+['"]node:/.test(html), 'a node: builtin leaked into the browser bundle');
    assert.ok(html.includes('__modules'), 'the module table is missing');

    // And it must contain the actual application, not just an empty shell.
    assert.ok(html.includes('Coloroteca'), 'the app markup is missing');
    assert.ok(html.includes('DEMO_LIBRARIES'), 'the demo libraries were not bundled');
    assert.ok(html.includes('deltaE2000'), 'the matching engine was not bundled');
  });
});

test('the module bodies carry no surviving import or export statements', () => {
  withTempDir('ct-build-check-', (dir) => {
    const outPath = join(dir, 'out.html');
    assert.equal(run('tools/build-standalone.mjs', ['--out', outPath]).status, 0);

    const html = readFileSync(outPath, 'utf8');
    const scriptStart = html.indexOf('<script>');
    const scriptEnd = html.lastIndexOf('</script>');
    assert.ok(scriptStart > 0 && scriptEnd > scriptStart, 'could not locate the inline script');

    const script = html.slice(scriptStart, scriptEnd);
    // Line-anchored, because documentation inside the bundle legitimately talks
    // about import/export in prose.
    const leftovers = script
      .split('\n')
      .filter((line) => /^\s*(import|export)\s/.test(line));
    assert.deepEqual(leftovers, [], `untransformed module syntax survived:\n${leftovers.join('\n')}`);
  });
});

test('the standalone build is reproducible', () => {
  withTempDir('ct-build-repro-', (dir) => {
    const a = join(dir, 'a.html');
    const b = join(dir, 'b.html');
    assert.equal(run('tools/build-standalone.mjs', ['--out', a]).status, 0);
    assert.equal(run('tools/build-standalone.mjs', ['--out', b]).status, 0);
    assert.equal(
      readFileSync(a, 'utf8'),
      readFileSync(b, 'utf8'),
      'two builds of the same source produced different output'
    );
  });
});

/* ═════════════════════════════ compliance scanner ══════════════════════════ */

test('the compliance scan passes on the repository as committed', () => {
  const result = run('tools/scan-protected.mjs');
  assert.equal(result.status, 0, `the repository contains data it must not:\n${result.stdout}`);
});

test('the compliance scanner catches a non-permissive colour library', () => {
  // Plant a violation, confirm it is caught, clean up. Without this, the
  // scanner could rot into always passing and nobody would notice.
  const fixtureDir = join(ROOT, 'tests', '_scan_fixture');
  try {
    mkdirSync(fixtureDir, { recursive: true });
    writeFileSync(
      join(fixtureDir, 'planted.clf.json'),
      JSON.stringify({
        format: 'coloroteca-library',
        version: '1.0',
        id: 'planted',
        meta: { name: 'Planted', colorCount: 1, source: 'some export', license: 'proprietary' },
        colors: [{ code: '185', hex: '#e4002b' }],
      }),
      'utf8'
    );

    const result = run('tools/scan-protected.mjs');
    assert.notEqual(result.status, 0, 'the scanner did not notice a proprietary library');
    assert.match(result.stdout, /clf-restricted-licence/, 'the scanner flagged the wrong thing');
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
});

test('the compliance scanner catches a colour-book binary', () => {
  const fixtureDir = join(ROOT, 'tests', '_scan_fixture');
  try {
    mkdirSync(fixtureDir, { recursive: true });
    writeFileSync(join(fixtureDir, 'planted.acb'), 'not really binary', 'utf8');

    const result = run('tools/scan-protected.mjs');
    assert.notEqual(result.status, 0, 'the scanner did not notice a colour-book binary');
    assert.match(result.stdout, /colour-book-binary/, 'the scanner flagged the wrong thing');
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
});

/* ═══════════════════════════ user-library directory ════════════════════════ */

/**
 * Run git, returning null instead of throwing when it exits non-zero. That is
 * how `check-ignore` reports "not ignored" (exit 1), so null is meaningful here.
 */
function tryGit(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    return null;
  }
}

const hasGitRepo = () => existsSync(join(ROOT, '.git'));

test('data/libraries/ ignores real libraries but keeps its placeholder', (t) => {
  // The rule reads `data/libraries/*` rather than `data/libraries/`. Git cannot
  // re-include a file once a parent directory is excluded, so the trailing-slash
  // form would silently defeat the !.gitkeep exception and the directory would
  // disappear from a fresh clone. Hence: test the actual ignore behaviour, not
  // the text of .gitignore.
  if (!hasGitRepo()) return t.skip('not a git repository');

  const probeRel = 'data/libraries/_gitignore_probe.clf.json';
  const probeAbs = join(ROOT, 'data', 'libraries', '_gitignore_probe.clf.json');
  writeFileSync(probeAbs, '{"format":"coloroteca-library"}', 'utf8');
  try {
    const ignored = tryGit(['check-ignore', '-v', '--', probeRel]);
    assert.ok(ignored, 'a colour library placed in data/libraries/ would be committed');
    assert.match(ignored, /\.gitignore:\d+:/, 'it was ignored, but not by .gitignore');
  } finally {
    rmSync(probeAbs, { force: true });
  }

  assert.equal(
    tryGit(['check-ignore', '--', 'data/libraries/.gitkeep']),
    null,
    '.gitkeep must stay trackable, otherwise a fresh clone has no data/libraries/'
  );
});

test('the compliance scanner does not flag the .gitkeep placeholder', (t) => {
  if (!hasGitRepo()) return t.skip('not a git repository');

  const tracked = tryGit(['ls-files', '--', 'data/libraries']) ?? '';
  if (!tracked.includes('data/libraries/.gitkeep')) {
    return t.skip('placeholder not staged yet');
  }

  // Regression guard: this check only runs inside a git repository, so it went
  // unexercised while the repo did not exist — and shipped flagging .gitkeep as
  // a committed colour library.
  const result = run('tools/scan-protected.mjs');
  assert.equal(result.status, 0, `the scanner flagged a placeholder:\n${result.stdout}`);
});

/* ═════════════════════════════ command-line tools ══════════════════════════ */

const DEMO_DIR = join(ROOT, 'data', 'demo');
const DEMO_ARGS = ['--dir', join(ROOT, 'data', 'demo')];

test('match.mjs matches a hex value against a bundled library', () => {
  const result = run('skill/scripts/match.mjs', [
    '--hex', '#808080', '--library', 'demo-wheel', ...DEMO_ARGS, '--top', '3',
  ]);
  assert.equal(result.status, 0, `match.mjs failed:\n${result.stderr}`);

  // #808080 is literally an entry in the demo wheel, so the nearest match is
  // itself at essentially zero distance.
  assert.match(result.stdout, /GRAY-050/, 'the exact match was not found');
  assert.match(result.stdout, /ΔE2000/, 'the delta column is missing');
  assert.match(result.stdout, /肉眼几乎无法分辨/, 'an exact match should grade as imperceptible');
  assert.match(result.stdout, /官方色卡为准/, 'the disclaimer is missing');
});

test('match.mjs re-ranks when the formula changes', () => {
  const common = ['--library', 'demo-wheel', ...DEMO_ARGS, '--top', '5', '--format', 'json'];

  const ciede = run('skill/scripts/match.mjs', ['--hex', '#FF6B6B', ...common]);
  const cie76 = run('skill/scripts/match.mjs', ['--hex', '#FF6B6B', '--formula', 'CIE76', ...common]);
  assert.equal(ciede.status, 0, ciede.stderr);
  assert.equal(cie76.status, 0, cie76.stderr);

  const a = JSON.parse(ciede.stdout);
  const b = JSON.parse(cie76.stdout);
  assert.equal(a.settings.formula, 'CIEDE2000');
  assert.equal(b.settings.formula, 'CIE76');
  assert.equal(a.matches.length, 5);
  assert.notEqual(
    a.bestDeltaE,
    b.bestDeltaE,
    'both formulas reported the same distance, which cannot be right'
  );
});

test('match.mjs reads a batch list without eating hex values as comments', () => {
  withTempDir('ct-batch-', (dir) => {
    const batchPath = join(dir, 'list.txt');
    // '#FF6B6B' must survive; '# a comment' must not become a colour.
    writeFileSync(batchPath, '# a comment\n#FF6B6B\n10,43,217\nnot-a-colour\n', 'utf8');

    const result = run('skill/scripts/match.mjs', [
      '--batch', batchPath, '--library', 'demo-wheel', ...DEMO_ARGS, '--top', '1', '--format', 'json',
    ]);
    assert.equal(result.status, 0, `batch failed:\n${result.stderr}`);

    const payload = JSON.parse(result.stdout);
    assert.equal(payload.results.length, 3, 'expected exactly three non-comment lines');
    assert.equal(payload.results[0].input.hex, '#ff6b6b', 'the hex value was treated as a comment');
    assert.equal(payload.results[2].error, 'unparseable', 'the junk line should be reported, not dropped');
  });
});

test('list.mjs reports the bundled demo libraries', () => {
  const result = run('skill/scripts/list.mjs', ['--dir', DEMO_DIR]);
  assert.equal(result.status, 0, `list.mjs failed:\n${result.stderr}`);
  assert.match(result.stdout, /demo-wheel/);
  assert.match(result.stdout, /chinese-traditional/);
  assert.match(result.stdout, /CC0/);
  assert.match(result.stdout, /MIT/);
});

test('list.mjs explains the situation when no library directory exists', () => {
  withTempDir('ct-empty-', (dir) => {
    const result = run('skill/scripts/list.mjs', ['--dir', join(dir, 'nothing-here')]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /没有找到色库/);
    // The point of the message: it must not imply it can supply colour books itself.
    assert.match(result.stdout, /GETTING-LIBRARIES/);
  });
});

test('convert.mjs turns a colour list into CLF', () => {
  withTempDir('ct-convert-', (dir) => {
    const input = join(dir, 'list.txt');
    const output = join(dir, 'out.clf.json');
    writeFileSync(input, '# palette comment\n#FF6B6B\n10,43,217\n', 'utf8');

    const result = run('skill/scripts/convert.mjs', [
      input, '-o', output, '--name', 'Test palette', '--license', 'cc0',
    ]);
    assert.equal(result.status, 0, `convert.mjs failed:\n${result.stdout}\n${result.stderr}`);

    const doc = JSON.parse(readFileSync(output, 'utf8'));
    assert.equal(doc.format, 'coloroteca-library');
    assert.equal(doc.colors.length, 2, 'both colour lines should convert');
    assert.equal(doc.meta.license, 'cc0');
    assert.equal(doc.meta.colorCount, 2);
    assert.ok(
      !doc.colors.some((c) => String(c.code).includes('palette')),
      'the comment line became a colour entry'
    );
  });
});

test('convert.mjs keeps a CLF document provenance instead of blanking it', () => {
  withTempDir('ct-convert-clf-', (dir) => {
    const source = join(dir, 'source.clf.json');
    const output = join(dir, 'copy.clf.json');
    writeFileSync(
      source,
      JSON.stringify({
        format: 'coloroteca-library',
        version: '1.0',
        id: 'original-id',
        meta: { name: 'Original', colorCount: 1, source: 'upstream dataset', license: 'mit' },
        colors: [{ code: '1', hex: '#112233' }],
      }),
      'utf8'
    );

    const result = run('skill/scripts/convert.mjs', [source, '-o', output]);
    assert.equal(result.status, 0, result.stderr);

    const doc = JSON.parse(readFileSync(output, 'utf8'));
    assert.equal(doc.id, 'original-id', 'the CLF id should be preserved');
    assert.equal(doc.meta.license, 'mit', 'the licence should not be downgraded to unknown');
    assert.equal(doc.meta.source, 'upstream dataset', 'the source should be preserved');
  });
});

test('convert.mjs refuses a file it cannot parse instead of writing junk', () => {
  withTempDir('ct-convert-bad-', (dir) => {
    const input = join(dir, 'nothing.txt');
    const output = join(dir, 'out.clf.json');
    writeFileSync(input, 'this file has no colours in it at all\n', 'utf8');

    const result = run('skill/scripts/convert.mjs', [input, '-o', output]);
    assert.notEqual(result.status, 0, 'an unparseable input should fail');
    assert.ok(!existsSync(output), 'a failed conversion must not leave a file behind');
  });
});
