// Tiny static server for the sample/preview pages. Mirrors Vercel's cleanUrls:
// /quiz -> quiz.html, / -> index.html. Local dev / tunnel only; Vercel serves prod.
import http from 'http';
import { readFile, stat, readdir } from 'fs/promises';
import { extname, join, normalize, basename } from 'path';

const ROOT = new URL('./', import.meta.url).pathname;
const PORT = process.env.PORT || 8090;
const TYPES = { '.html':'text/html', '.css':'text/css', '.js':'text/javascript', '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.svg':'image/svg+xml', '.gif':'image/gif', '.webp':'image/webp', '.ico':'image/x-icon', '.woff':'font/woff', '.woff2':'font/woff2' };

const tryFiles = async (p) => {
  for (const cand of [p, p + '.html', join(p, 'index.html')]) {
    try { const s = await stat(cand); if (s.isFile()) return cand; } catch {}
  }
  return null;
};

http.createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(req.url.split('?')[0]);
    // Serve the committed, category-grouped index.html (run `node gen-index.mjs` to refresh it).
    // block traversal
    const safe = normalize(join(ROOT, path)).startsWith(normalize(ROOT)) ? join(ROOT, path) : ROOT;
    let file = await tryFiles(safe);
    if (!file) { res.writeHead(404, {'Content-Type':'text/html'}); res.end('<h1>404</h1><p>No page here. Drop an HTML file in the repo and it shows up.</p>'); return; }
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch (e) {
    res.writeHead(500); res.end('error: ' + String(e));
  }
}).listen(PORT, () => console.log('Pages preview on http://localhost:' + PORT));
