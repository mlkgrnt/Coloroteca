#!/usr/bin/env node
/**
 * A static file server for local development, in about the same number of lines
 * as it takes to describe one.
 *
 * Why it exists: the app is plain ES modules, and browsers refuse to load
 * module scripts over file:// (the origin is opaque, so the fetch is a CORS
 * error). Serving over http://localhost fixes that in one line of setup.
 *
 * It is a development convenience, not a requirement — tools/build-standalone.mjs
 * produces a single HTML file that runs straight from disk, without a server.
 *
 * Usage:
 *   node tools/serve.mjs [--port 8787] [--host 127.0.0.1] [--open]
 *
 * Then open http://127.0.0.1:8787/ — that maps to web/index.html.
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function parseArgs(argv) {
  const args = { port: 8787, host: '127.0.0.1', open: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port' || argv[i] === '-p') args.port = Number(argv[++i]);
    else if (argv[i] === '--host') args.host = argv[++i];
    else if (argv[i] === '--open') args.open = true;
  }
  return args;
}

/**
 * Resolve a request path against ROOT, refusing anything that escapes it.
 * @returns {string|null}
 */
function safeResolve(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  const candidate = resolve(ROOT, '.' + normalize(decoded));
  return candidate === ROOT || candidate.startsWith(ROOT + sep) ? candidate : null;
}

async function sendFile(res, filePath) {
  const body = await readFile(filePath);
  res.writeHead(200, {
    'Content-Type': MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': body.length,
    // Never cache during development: a stale module is a confusing bug.
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

const args = parseArgs(process.argv.slice(2));

const server = createServer(async (req, res) => {
  try {
    // Redirect rather than serving the file at '/': index.html references its
    // siblings by relative path, and those only resolve correctly when the URL
    // actually is /web/.
    const pathname = (req.url ?? '/').split('?')[0];
    if (pathname === '/' || pathname === '/index.html') {
      res.writeHead(302, { Location: '/web/index.html' });
      res.end();
      return;
    }

    let target = safeResolve(req.url ?? '/');
    if (!target) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('403 — path escapes the project root');
      return;
    }

    let info = await stat(target).catch(() => null);
    if (info?.isDirectory()) {
      target = join(target, 'index.html');
      info = await stat(target).catch(() => null);
    }

    if (!info) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`404 — ${req.url}`);
      return;
    }

    await sendFile(res, target);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`500 — ${err.message}`);
  }
});

server.listen(args.port, args.host, () => {
  const url = `http://${args.host}:${args.port}/`;
  console.log(`Coloroteca dev server`);
  console.log(`  project root : ${ROOT}`);
  console.log(`  app          : ${url}`);
  console.log(`  stop         : Ctrl+C`);
});
