'use strict';
(() => {
  let events = [], legacy = [], user, newestSeen = '';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const key = () => `funnel-working-seen:${user?.email || ''}`;
  const stamp = value => new Date(value).toLocaleString('en-US', {dateStyle:'medium',timeStyle:'short'});
  const rows = () => [...events, ...legacy].sort((a,b) => b.createdAt.localeCompare(a.createdAt));
  function badge() {
    const count = document.getElementById('all-change-count');
    if (!count) return;
    count.textContent = rows().filter(item => item.createdAt > newestSeen).length;
    document.getElementById('all-changes').firstChild.textContent = 'Changes ';
  }
  async function refresh(detail) {
    if (detail?.user) {
      user = detail.user;
      legacy = (detail.data?.events || []).map(item => ({...item, editor:{name:item.author}, summary:item.summary || 'Section record updated'}));
      try { newestSeen = localStorage.getItem(key()) || ''; } catch {}
    }
    try {
      const response = await fetch('/api/funnel-review?action=activity', {credentials:'same-origin',cache:'no-store'});
      if (!response.ok) return;
      events = (await response.json()).events || [];
      badge();
    } catch {}
  }
  function open() {
    let dialog = document.getElementById('working-activity');
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.id = 'working-activity';
      dialog.setAttribute('aria-label','Changes across all funnel pages');
      document.body.append(dialog);
    }
    dialog.innerHTML = `<div class="dialog-top"><h2>Changes across the funnel</h2><button type="button" id="close-working-activity" aria-label="Close changes">✕</button></div><p>Saved drafts and confirmed publications, newest first.</p>${rows().length ? rows().map(item => {
      const href = new URL('/funnel/tracker',location.origin);
      href.searchParams.set('mode','review');
      href.searchParams.set('page',item.family || 'lander');
      href.searchParams.set('variant',item.variant || 'g');
      href.searchParams.set('section',item.sectionId);
      return `<article class="review-version"><strong>${esc(item.sectionId)} · ${esc(item.pageLabel || 'Section change')}</strong><p>${item.type === 'published' || item.type === 'live' ? 'Publication confirmed' : item.type === 'image' ? 'Image changed' : 'Draft copy changed'}</p><blockquote>${esc(item.summary)}</blockquote><p>${esc(item.editor?.name || item.editor?.email || 'Verified contributor')} · ${esc(stamp(item.createdAt))}</p><a href="${esc(href.href)}" target="_blank" rel="noopener">Open labelled section ↗</a></article>`;
    }).join('') : '<p>No changes have been saved yet. Select text or an image on a working page to make the first change.</p>'}`;
    document.getElementById('close-working-activity').onclick = () => dialog.close();
    dialog.showModal();
    newestSeen = rows()[0]?.createdAt || newestSeen;
    try { localStorage.setItem(key(),newestSeen); } catch {}
    badge();
  }
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('all-changes')?.addEventListener('click', event => {
      event.stopImmediatePropagation();
      open();
    }, true);
  });
  document.addEventListener('tracker:ready', event => refresh(event.detail));
  document.addEventListener('tracker:working-saved', () => refresh());
  document.addEventListener('tracker:signed-out', () => {
    events = []; legacy = []; user = null;
    document.getElementById('working-activity')?.remove();
  });
})();
