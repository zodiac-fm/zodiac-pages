// Build step (runs on Vercel before deploy): regenerates index.html by scanning
// the folder for .html pages, so a dropped-in page auto-appears on the index.
// Same look as the dev server. Keeps the Vercel site zero-touch: drop file, push, live.
import { readdir, writeFile } from 'fs/promises';
import { basename } from 'path';

const files = (await readdir('.')).filter(f => f.endsWith('.html') && f !== 'index.html').sort();
const items = files.map(f => {
  // Relative href (GitHub Pages serves project sites under /<repo>/, so absolute /paths break).
  const name = basename(f, '.html').replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  return `    <a class="page" href="${f}">${name} <span>/${basename(f, '.html')}</span></a>`;
}).join('\n');

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Zodiac — Preview</title>
<style>
  :root{--ink:#15151b;--mut:#83868f;--line:#e7e8ec;--accent:#5b5bd6;--bg:#f4f5f7}
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:var(--bg);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:30px}
  .card{background:#fff;border:1px solid var(--line);border-radius:16px;padding:40px 44px;max-width:520px;width:100%}
  h1{font-size:24px;letter-spacing:-.02em}
  p{color:var(--mut);font-size:14px;margin-top:8px;line-height:1.6}
  .list{margin-top:24px;display:flex;flex-direction:column;gap:8px}
  a.page{display:flex;justify-content:space-between;align-items:center;padding:13px 16px;border:1px solid var(--line);border-radius:10px;text-decoration:none;color:var(--ink);font-size:14px;font-weight:500}
  a.page:hover{border-color:var(--accent);color:var(--accent)}
  a.page span{color:var(--mut);font-size:12px;font-weight:400}
  .tag{display:inline-block;background:#efeefe;color:var(--accent);font-size:11px;font-weight:600;padding:3px 9px;border-radius:20px;letter-spacing:.03em}
  .empty{color:var(--mut);font-size:13px;margin-top:24px;font-style:italic}
</style></head>
<body><div class="card">
  <span class="tag">PREVIEW</span>
  <h1 style="margin-top:12px">Zodiac — Pages</h1>
  <p>Work-in-progress pages for feedback before they go live. Every page in the folder shows up here automatically.</p>
${items ? `  <div class="list">\n${items}\n  </div>` : '  <div class="empty">No pages yet. Drop an HTML file in the repo and push.</div>'}
</div></body></html>
`;

await writeFile('index.html', html);
console.log(`Generated index.html with ${files.length} page(s): ${files.join(', ') || '(none)'}`);
