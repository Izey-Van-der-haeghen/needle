#!/usr/bin/env node
// Preview server for the Needle extension.
// Serves the files of the store package (INCLUDE in tools/package-files.mjs) and the harness
// (dev/preview, at /__preview/), and injects the chrome.* stub into the root-level HTML pages,
// so popup.html / options.html run in a normal tab. Nothing else in the repo is served: not
// notes/, CLAUDE.md, tools/, tests/, .git or other dotfiles.
//
//   node dev/preview/serve.js [--port 5178] [--root <repo>]
//
// Node built-ins only. Binds to 127.0.0.1, answers only requests addressed to localhost or
// 127.0.0.1 on its port, sends no-store so edits show on reload.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { INCLUDE } from '../../tools/package-files.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const ROOT = path.resolve(flag('--root', path.resolve(HERE, '../..')));
const PORT = Number(flag('--port', 5178));
const STUB_TAG = '<script src="/__preview/chrome-stub.js"></script>';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

if (!fs.existsSync(path.join(ROOT, 'manifest.json'))) {
  console.error(`No manifest.json in ${ROOT}. Pass the extension folder with --root <path>.`);
  process.exit(1);
}

const server = http.createServer((req, res) => {
  const send = (status, body, type = 'text/plain; charset=utf-8') => {
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(body);
  };

  // A page on another site that points its own host name at 127.0.0.1 (DNS rebinding) sends
  // that name as Host: it gets nothing.
  const host = (req.headers.host || '').toLowerCase();
  if (host !== `localhost:${PORT}` && host !== `127.0.0.1:${PORT}`) return send(421, 'Misdirected request');

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    return send(400, 'Bad request');
  }
  // fs throws on a NUL byte in a path, synchronously, which would stop the server (/%00).
  if (pathname.includes('\u0000')) return send(400, 'Bad request');
  if (pathname === '/') {
    res.writeHead(302, { location: '/popup.html' });
    return res.end();
  }
  // Tabs ask for a favicon, extension popups don't: answer with the extension icon instead of a 404.
  if (pathname === '/favicon.ico') pathname = '/icons/icon48.png';

  // /__preview/* comes from the harness folder, everything else from the repo root.
  const fromHarness = pathname.startsWith('/__preview/');
  const base = fromHarness ? HERE : ROOT;
  const file = path.join(base, fromHarness ? pathname.slice('/__preview'.length) : pathname);
  if (!file.startsWith(base + path.sep)) return send(403, 'Forbidden');
  // Only what the store package holds. Checked on the resolved file, not on the URL: an encoded
  // slash (/lib/..%2fCLAUDE.md) is no dot segment to the URL parser, but path.join resolves it.
  if (!fromHarness && !INCLUDE.includes(path.relative(ROOT, file).split(path.sep)[0])) {
    return send(404, `Not found: ${pathname}`);
  }

  fs.readFile(file, (err, buf) => {
    if (err) return send(404, `Not found: ${pathname}`);
    const ext = path.extname(file).toLowerCase();
    let body = buf;
    if (ext === '.html' && !fromHarness && path.dirname(file) === ROOT) {
      // Run the stub before any of the page's own scripts.
      body = buf.toString('utf8').replace(/<head(\s[^>]*)?>/i, (m) => m + STUB_TAG);
    }
    send(200, body, MIME[ext] || 'application/octet-stream');
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Needle preview, serving ${ROOT}`);
  console.log(`  http://localhost:${PORT}/popup.html            the popup on the fictional demo page`);
  console.log(`  http://localhost:${PORT}/popup.html?theme=dark`);
  console.log(`  http://localhost:${PORT}/options.html`);
  console.log(`  http://localhost:${PORT}/__preview/store-frame.html?shot=onpage   store screenshot frames`);
  console.log('Query parameters: theme=light|dark, access=0|1, panel=1, welcome=1, delay=<ms>');
});
