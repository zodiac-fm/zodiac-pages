// Build step (GitHub Pages branch-mode + local): regenerates index.html by scanning
// the category folders, so the directory groups pages by category. Drop a file in a
// category folder + push -> it appears under that heading. Relative links (project
// Pages serve under /<repo>/, so absolute /paths would break).
import { readFile, readdir, unlink, writeFile } from 'fs/promises';
import { basename } from 'path';
import { createHash } from 'crypto';

// Ordered categories. Add a new {dir,label} here to introduce a category.
const CATS = [
  { dir: 'inapp',   label: 'In-App' },
  { dir: 'quiz',    label: 'Quiz' },
  { dir: 'landers', label: 'Landing Pages' },
];

const pretty = f => basename(f, '.html').replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
const catalog = JSON.parse(await readFile('landers/page-catalog.json', 'utf8'));
const sha256 = source => createHash('sha256').update(source).digest('hex');
const exactLanderPage = path => /^landers\/(?:general-spiritual|manifestation|astrology-human-design)-\d\d\.html$/.test(path);
const expectedProtectedPaths = new Set([
  'landers/general-spiritual-13.html',
  'landers/manifestation-11.html',
  'landers/astrology-human-design-04.html',
]);
const expectedNumberedPaths = new Set([
  ...Array.from({ length: 14 }, (_, index) => `landers/general-spiritual-${String(index + 1).padStart(2, '0')}.html`),
  ...Array.from({ length: 13 }, (_, index) => `landers/manifestation-${String(index + 1).padStart(2, '0')}.html`),
  ...Array.from({ length: 4 }, (_, index) => `landers/astrology-human-design-${String(index + 1).padStart(2, '0')}.html`),
]);

function assertCatalog() {
  const protectedPaths = new Set(catalog.protected.map(page => page.path));
  const archivedPaths = new Set(catalog.archived.map(page => page.path));
  if (catalog.protected.length !== 3 || catalog.archived.length !== 28 ||
      protectedPaths.size !== 3 || archivedPaths.size !== 28 ||
      ![...protectedPaths, ...archivedPaths].every(exactLanderPage) ||
      [...protectedPaths].some(path => archivedPaths.has(path)) ||
      [...expectedProtectedPaths].some(path => !protectedPaths.has(path)) ||
      [...expectedNumberedPaths].some(path => !protectedPaths.has(path) && !archivedPaths.has(path))) {
    throw new Error('Invalid lander archive catalog: expected 3 protected and 28 distinct archived numbered pages.');
  }
}

async function assertHashes(pages, kind) {
  await Promise.all(pages.map(async ({ path, sha256: expected }) => {
    const actual = sha256(await readFile(path));
    if (actual !== expected) throw new Error(`${kind} hash mismatch: ${path}`);
  }));
}

assertCatalog();
if (process.env.VERCEL === '1') {
  // Validate every target before the first unlink so a failed deployment cannot partly archive this set.
  await assertHashes(catalog.protected, 'Protected page');
  await assertHashes(catalog.archived, 'Archived page');
  await Promise.all(catalog.archived.map(({ path }) => unlink(path)));
}

const archivedPaths = new Set(catalog.archived.map(page => page.path));
const protectedPaths = new Set(catalog.protected.map(page => page.path));
const managedPaths = new Set([...archivedPaths, ...protectedPaths]);
const pageLink = (href, label = pretty(href)) =>
  `      <a class="page" href="${href}">${label} <span>/${href.replace(/\.html$/, '')}</span></a>`;

let total = 0;
const sections = [];
for (const c of CATS) {
  let files = [];
  try { files = (await readdir(c.dir)).filter(f => f.endsWith('.html') && !managedPaths.has(`${c.dir}/${f}`)).sort(); } catch {}
  total += files.length;
  const items = files.map(f => pageLink(`${c.dir}/${f}`)).join('\n');
  sections.push(`    <section class="cat">
      <div class="cathead">${c.label}<span class="count">${files.length || ''}</span></div>
      ${files.length ? `<div class="list">\n${items}\n      </div>` : '<div class="empty">Nothing here yet.</div>'}
    </section>`);
}

const landerSections = catalog.categories.map(category => {
  const concepts = catalog.activeConcepts.filter(page => page.category === category.id);
  const items = [
    pageLink(category.controlPath, `${category.label} Control`),
    ...concepts.map(page => pageLink(page.path, page.label)),
  ].join('\n');
  total += concepts.length + 1;
  return `    <section class="cat">
      <div class="cathead">${category.label}<span class="count">${concepts.length + 1}</span></div>
      <div class="list">\n${items}\n      </div>
    </section>`;
});
const walterItems = catalog.protected.map(page => pageLink(page.path)).join('\n');
total += catalog.protected.length;
landerSections.push(`    <section class="cat">
      <div class="cathead">Walter Numbered Pages<span class="count">${catalog.protected.length}</span></div>
      <div class="list">\n${walterItems}\n      </div>
    </section>`);

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Zodiac — Pages</title>
<style>
  :root{--ink:#15151b;--mut:#83868f;--line:#e7e8ec;--accent:#5b5bd6;--bg:#f4f5f7}
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:var(--bg);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased;min-height:100vh;display:flex;align-items:flex-start;justify-content:center;padding:48px 24px}
  .card{background:#fff;border:1px solid var(--line);border-radius:16px;padding:40px 44px;max-width:560px;width:100%}
  .tag{display:inline-block;background:#efeefe;color:var(--accent);font-size:11px;font-weight:600;padding:3px 9px;border-radius:20px;letter-spacing:.03em}
  h1{font-size:24px;letter-spacing:-.02em;margin-top:12px}
  .sub{color:var(--mut);font-size:14px;margin-top:8px;line-height:1.6}
  .cat{margin-top:28px}
  .cathead{font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--mut);display:flex;align-items:center;gap:8px;margin-bottom:10px}
  .count{background:var(--bg);color:var(--mut);font-size:11px;font-weight:600;padding:1px 8px;border-radius:20px}
  .list{display:flex;flex-direction:column;gap:8px}
  a.page{display:flex;justify-content:space-between;align-items:center;padding:13px 16px;border:1px solid var(--line);border-radius:10px;text-decoration:none;color:var(--ink);font-size:14px;font-weight:500}
  a.page:hover{border-color:var(--accent);color:var(--accent)}
  a.page span{color:var(--mut);font-size:12px;font-weight:400}
  .empty{color:var(--mut);font-size:13px;font-style:italic;padding:4px 2px}
</style></head>
<body><div class="card">
  <span class="tag">PREVIEW</span>
  <h1>Zodiac — Pages</h1>
  <p class="sub">Work-in-progress pages for feedback before they go live, grouped by category.</p>
${sections.join('\n')}
${landerSections.join('\n')}
</div></body></html>
`;

await writeFile('index.html', html);
console.log(`Generated index.html — ${total} page(s) across ${CATS.length} categories.`);
