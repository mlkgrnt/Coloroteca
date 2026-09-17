#!/usr/bin/env node
/**
 * Install the Coloroteca Agent Skill.
 *
 * The skill is not just SKILL.md — its scripts import the shared engine in
 * core/, read the colour-name table in data/, and parse imports with parsers/.
 * All of those have to travel together, so this copies a payload rather than a
 * single file.
 *
 * The target layout keeps SKILL.md at the root and puts the scripts in
 * scripts/, which is one level below core/ — the same relationship the
 * repository has. skill/scripts/lib.mjs locates the project root by walking
 * upwards looking for core/matcher.js, so both layouts work unchanged.
 *
 *   ~/.workbuddy/skills/coloroteca/
 *   ├── SKILL.md
 *   ├── core/        the shared engine
 *   ├── parsers/     format readers
 *   ├── data/        the MIT colour-name table
 *   ├── docs/        format spec and acquisition guide
 *   └── scripts/     match.mjs, list.mjs, convert.mjs, lib.mjs
 *
 * This script performs no network access and runs nothing it copies. It only
 * reads from the repository and writes to the target directory.
 *
 * Usage:
 *   node tools/install-skill.mjs [--target <dir>] [--dry-run] [--force]
 *
 * Default target: ~/.workbuddy/skills/coloroteca
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve, sep } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const DEFAULT_TARGET = join(homedir(), '.workbuddy', 'skills', 'coloroteca');

/** What gets installed, and where it comes from. */
const PAYLOAD = [
  { from: 'skill/SKILL.md', to: 'SKILL.md' },
  { dir: 'core', filter: (f) => f.endsWith('.js') },
  { dir: 'parsers', filter: (f) => f.endsWith('.js') },
  { dir: 'data', filter: (f) => f.endsWith('.json') || f.endsWith('.txt') },
  { dir: 'docs', filter: (f) => f.endsWith('.md') },
  { dir: 'skill/scripts', to: 'scripts', filter: (f) => f.endsWith('.mjs') },
];

function parseArgs(argv) {
  const args = { dryRun: false, force: false, target: null };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--dry-run') args.dryRun = true;
    else if (token === '--force') args.force = true;
    else if (token === '--target') args.target = argv[++i];
    else if (token.startsWith('--target=')) args.target = token.slice('--target='.length);
  }
  return args;
}

/**
 * Expand the payload into a flat list of {from, to} file pairs.
 * @returns {Array<{from:string,to:string}>}
 */
function buildPlan() {
  const plan = [];

  for (const entry of PAYLOAD) {
    if (entry.from) {
      const source = join(ROOT, entry.from);
      if (!existsSync(source)) throw new Error(`missing payload file: ${entry.from}`);
      plan.push({ from: source, to: entry.to ?? entry.from });
      continue;
    }

    const sourceDir = join(ROOT, entry.dir);
    if (!existsSync(sourceDir)) throw new Error(`missing payload directory: ${entry.dir}`);

    const targetDir = entry.to ?? entry.dir;
    for (const name of readdirSync(sourceDir)) {
      const full = join(sourceDir, name);
      if (!statSync(full).isFile()) continue;
      if (entry.filter && !entry.filter(name)) continue;
      plan.push({ from: full, to: `${targetDir}/${name}` });
    }
  }

  return plan;
}

/**
 * Files already in the target that this installer does not manage. Reported but
 * never deleted: removing someone's files is not this script's business, and a
 * leftover can tell us that a module was renamed.
 */
function findStrayFiles(target, plan) {
  // Both sides use forward slashes so the comparison is the same on every OS.
  const managed = new Set(plan.map((p) => p.to));
  const strays = [];

  const walk = (dir, prefix) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      if (statSync(full).isDirectory()) {
        walk(full, rel);
      } else if (!managed.has(rel)) {
        strays.push(rel);
      }
    }
  };

  if (existsSync(target)) walk(target, '');
  return strays;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const target = resolve(args.target ?? DEFAULT_TARGET);

  console.log('Coloroteca skill installer');
  console.log(`  source : ${ROOT}`);
  console.log(`  target : ${target}`);
  console.log('');

  const plan = buildPlan();

  /* ── what this skill actually does, so the install is not a black box ── */

  console.log('payload audit');
  console.log('  network access   none');
  console.log('  subprocesses     none (the scripts only read files and print)');
  console.log(`  writes outside the target directory   none`);
  console.log(`  files shipped    ${plan.length}`);
  console.log('');

  if (args.dryRun) {
    console.log('dry run — nothing written. Plan:');
    for (const item of plan) {
      console.log(`  ${relative(ROOT, item.from).split(sep).join('/').padEnd(40)} -> ${item.to}`);
    }
    return;
  }

  /* ── write ── */

  let written = 0;
  for (const item of plan) {
    const dest = join(target, item.to);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(item.from, dest);
    written++;
  }

  console.log(`installed ${written} files to ${target}`);

  const strays = findStrayFiles(target, plan);
  if (strays.length) {
    console.log('');
    console.log(`note: ${strays.length} file(s) in the target are not managed by this installer:`);
    for (const s of strays.slice(0, 10)) console.log(`  ${s}`);
    if (strays.length > 10) console.log(`  … and ${strays.length - 10} more`);
    console.log('  If a module was renamed, delete the target directory and reinstall to clear them.');
  }

  /* ── verify the install can find its own engine ── */

  const enginePath = join(target, 'core', 'matcher.js');
  const scriptsPath = join(target, 'scripts', 'match.mjs');
  const ok = existsSync(enginePath) && existsSync(scriptsPath);

  console.log('');
  console.log('verification');
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} core/matcher.js present (the scripts search upwards for this)`);
  console.log(`  ${existsSync(scriptsPath) ? 'ok  ' : 'FAIL'} scripts/match.mjs present`);

  // The colour-name table is easy to forget, and its absence only shows up when
  // someone asks for a colour by name.
  const nameTable = join(target, 'data', 'zh-colornames.json');
  console.log(`  ${existsSync(nameTable) ? 'ok  ' : 'FAIL'} data/zh-colornames.json present`);

  if (existsSync(nameTable)) {
    try {
      const doc = JSON.parse(readFileSync(nameTable, 'utf8'));
      console.log(`       ${doc.entries.length} colour names available`);
    } catch (err) {
      console.log(`       FAIL could not read the colour-name table: ${err.message}`);
      process.exitCode = 1;
    }
  }

  if (!ok) process.exitCode = 1;

  console.log('');
  console.log('next steps');
  console.log('  Colour libraries are NOT installed: this project bundles none.');
  console.log('  Point the skill at your own books:');
  console.log(`    node "${join(target, 'scripts', 'convert.mjs')}" <your-file.ase> \\`);
  console.log(`        -o "${join(homedir(), '.coloroteca', 'libraries', 'my-book.clf.json')}"`);
  console.log('  Then in a conversation: 「#FF6B6B 最接近我色库里的哪个色号」');
}

main();
