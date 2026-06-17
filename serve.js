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

// Auto-generated index: every .html in the folder becomes a card. Drop a file, it appears.
const renderIndex = async () => {
  const files = (await readdir(ROOT)).filter(f => f.endsWith('.html') && f !== 'index.html').sort();
  const items = files.map(f => { const slug = '/' + basename(f, '.html'); const name = basename(f, '.html').replace(/[-_]/g,' ').replace(/\b\w/g, c=>c.toUpperCase()); return `<a class="page" href="${slug}">${name} <span>${slug}</span></a>`; }).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Zodiac — Preview</title>
<style>:root{--ink:#15151b;--mut:#83868f;--line:#e7e8ec;--accent:#5b5bd6;--bg:#f4f5f7}*{box-sizing:border-box;margin:0;padding:0}body{background:var(--bg);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:30px}.card{background:#fff;border:1px solid var(--line);border-radius:16px;padding:40px 44px;max-width:520px;width:100%}h1{font-size:24px;letter-spacing:-.02em}p{color:var(--mut);font-size:14px;margin-top:8px;line-height:1.6}.list{margin-top:24px;display:flex;flex-direction:column;gap:8px}a.page{display:flex;justify-content:space-between;align-items:center;padding:13px 16px;border:1px solid var(--line);border-radius:10px;text-decoration:none;color:var(--ink);font-size:14px;font-weight:500}a.page:hover{border-color:var(--accent);color:var(--accent)}a.page span{color:var(--mut);font-size:12px;font-weight:400}.tag{display:inline-block;background:#efeefe;color:var(--accent);font-size:11px;font-weight:600;padding:3px 9px;border-radius:20px;letter-spacing:.03em}.empty{color:var(--mut);font-size:13px;margin-top:24px;font-style:italic}</style></head>
<body><div class="card"><span class="tag">PREVIEW</span><h1 style="margin-top:12px">Zodiac — Pages</h1><p>Work-in-progress pages for feedback before they go live. Every page in the folder shows up here automatically.</p>${items ? `<div class="list">${items}</div>` : '<div class="empty">No pages yet. Drop an HTML file in the folder and refresh.</div>'}</div></body></html>`;
};

http.createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(req.url.split('?')[0]);
    if (path === '/' || path === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache' });
      res.end(await renderIndex());
      return;
    }
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
