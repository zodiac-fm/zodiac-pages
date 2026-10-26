'use strict';

(() => {
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
  const norm = value => String(value || '').replace(/\s+/g, ' ').trim();
  const names = {
    lander: 'Lander', results: 'Results', bc: 'Birth chart', join: 'Cart / Join',
    g: 'General', a: 'Astrology', m: 'Manifesting', shared: 'Birth chart',
    paid: 'Paid trial', free: 'Free trial',
  };
  const variants = family => family === 'bc' ? ['shared'] : family === 'join' ? ['paid', 'free'] : ['g', 'a', 'm'];
  const state = {
    map: null, data: null, user: null, canEdit: false,
    family: 'lander', variant: 'g', selected: null,
    draft: null, pageKey: '', picked: null, frameReady: false, frameToken: 0, draftToken: 0,
    mode: null, notice: null, pendingScroll: false, conflict: null,
    scratch: new Map(), layoutKey: '',
  };
  let root;
  let resizeObserver;

  function safe(value) {
    if (!String(value || '').trim()) return '';
    try {
      const url = new URL(value, location.href);
      if (url.protocol === 'https:') return url.href;
      const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
      return url.protocol === 'http:' && local && url.origin === location.origin ? url.href : '';
    } catch {
      return '';
    }
  }

  function imageUrl(value) {
    const raw = typeof value === 'string' ? value : value?.url;
    if (!String(raw || '').trim()) return '';
    try {
      const base = String(raw).startsWith('/api/funnel-review') ? location.origin : state.draft?.sourceUrl;
      return safe(new URL(raw, base || location.href).href);
    } catch {
      return '';
    }
  }

  async function request(path, options = {}) {
    const response = await fetch(path, {credentials: 'same-origin', cache: 'no-store', ...options});
    let result;
    try {
      result = await response.json();
    } catch {
      throw Error('The workspace service returned an unreadable response.');
    }
    if (!response.ok) {
      const error = Error(result.message || result.error?.message || (
        response.status === 409
          ? 'A newer draft was saved. Your unsaved edit is still here.'
          : 'The private working page could not be updated.'
      ));
      error.status = response.status;
      error.result = result;
      throw error;
    }
    return result;
  }

  const mapped = id => state.map?.sections?.[id];
  const workingBinding = id => state.draft?.workingBindings?.find(item => item.sectionId === id) || mapped(id);
  const section = (id = state.selected) => (state.data?.sections || []).find(item => item.id === id);
  const pageSections = () => (state.data?.sections || []).filter(item => (
    item.family === state.family
      && (item.variant === state.variant || item.variant === 'shared')
      && mapped(item.id)
  ));
  const draftKey = () => state.family === 'bc' ? 'draft-bc' : `draft-${state.family}-${state.variant}`;
  const scratchKey = (node = state.picked) => node ? `${state.pageKey}:${node.sectionId}:${node.editId}` : '';

  function scratchFor(node = state.picked) {
    if (!node) return null;
    const key = scratchKey(node);
    if (!state.scratch.has(key)) {
      state.scratch.set(key, {
        editId: node.editId, sectionId: node.sectionId, type: node.type,
        text: node.type === 'text' ? String(node.value || '') : '',
        note: '', exampleUrl: '', file: null, objectUrl: '', attachmentId: '',
      });
    }
    return state.scratch.get(key);
  }

  function releaseScratch(entry) {
    if (entry?.objectUrl) URL.revokeObjectURL(entry.objectUrl);
  }

  function clearScratch(node = state.picked) {
    const key = scratchKey(node);
    const entry = state.scratch.get(key);
    releaseScratch(entry);
    state.scratch.delete(key);
  }

  function stashInputs() {
    const entry = scratchFor();
    if (!entry) return;
    if ($('review-text')) entry.text = $('review-text').value;
    if ($('review-note')) entry.note = $('review-note').value;
    if ($('review-example')) entry.exampleUrl = $('review-example').value;
  }

  function clear() {
    for (const entry of state.scratch.values()) releaseScratch(entry);
    state.scratch.clear();
    state.map = null;
    state.data = null;
    state.user = null;
    state.draft = null;
    state.picked = null;
    state.conflict = null;
    state.pageKey = '';
    state.layoutKey = '';
    state.frameReady = false;
    state.draftToken += 1;
    resizeObserver?.disconnect();
    if (root) root.replaceChildren();
  }

  function setNotice(text, kind = '') {
    state.notice = {text, kind};
    const status = $('review-status');
    if (status) {
      status.textContent = text;
      status.className = `review-status ${kind}`;
    }
  }

  async function loadBase() {
    if (!state.map) {
      const response = await request('/api/funnel-review?action=map');
      if (!response.map?.sections) throw Error('The private section map is unavailable.');
      state.map = response.map;
    }
    if (!state.data) {
      const response = await request('/api/funnel-tracker');
      state.data = response.data;
      state.user = response.user;
      state.canEdit = Boolean(response.canEdit);
    }
  }

  function pendingScratch(draft = state.draft) {
    for (const [key, entry] of state.scratch) {
      if (!key.startsWith(`${state.pageKey}:`)) continue;
      const node = draft?.editableNodes?.find(item => item.editId === entry.editId);
      if (entry.type === 'image' && entry.file) return {entry, node};
      if (entry.type === 'text' && node && entry.text.trim() !== String(node.value || '').trim()) {
        return {entry, node};
      }
    }
    return null;
  }

  function rebaseCleanScratch(previous, latest) {
    for (const [key, entry] of state.scratch) {
      if (!key.startsWith(`${state.pageKey}:`) || entry.type !== 'text') continue;
      const before = previous?.editableNodes?.find(item => item.editId === entry.editId);
      const after = latest?.editableNodes?.find(item => item.editId === entry.editId);
      if (before && after && entry.text.trim() === String(before.value || '').trim()) {
        entry.text = String(after.value || '');
      }
    }
  }

  function conflictFor(latest, pending) {
    const node = pending?.node || state.picked;
    const entry = pending?.entry || scratchFor(node);
    return {
      latest,
      editId: node?.editId || null,
      desired: node?.type === 'image'
        ? {type: 'image', fileName: entry?.file?.name || 'Selected image'}
        : {type: 'text', text: entry?.text || ''},
    };
  }

  async function loadDraft({force = false} = {}) {
    const pageKey = draftKey();
    if (!force && state.pageKey === pageKey && state.draft) return state.draft;
    stashInputs();
    const previous = state.pageKey === pageKey ? state.draft : null;
    if (state.pageKey !== pageKey) {
      state.pageKey = pageKey;
      state.draft = null;
      state.picked = null;
      state.conflict = null;
      state.frameReady = false;
    }
    const token = ++state.draftToken;
    let response;
    try {
      response = await request(`/api/funnel-review?action=draft&pageKey=${encodeURIComponent(pageKey)}`);
    } catch (error) {
      if (error.status !== 404) throw error;
      response = await request('/api/funnel-review?action=initialize-draft', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({pageKey}),
      });
    }
    if (!response.draft?.workingUrl || !Array.isArray(response.draft.editableNodes)) {
      throw Error('The working page cannot be prepared for editing.');
    }
    if (token !== state.draftToken || state.pageKey !== pageKey) return state.draft;
    const latest = response.draft;
    if (previous && latest.revision !== previous.revision) {
      const pending = pendingScratch(previous);
      if (pending) {
        state.conflict = conflictFor(latest, pending);
        state.notice = {text: 'A newer working page exists. Compare it before retrying.', kind: 'error'};
        return previous;
      }
      rebaseCleanScratch(previous, latest);
      state.notice = {text: 'A newer working page was loaded.', kind: 'success'};
    }
    state.draft = latest;
    if (state.picked) state.picked = latest.editableNodes.find(item => item.editId === state.picked.editId) || null;
    state.conflict = null;
    state.user = response.user || state.user;
    return latest;
  }

  function elementMatches(node, binding) {
    if (!node || node.tagName.toLowerCase() !== binding.element.tag
        || (node.id || null) !== (binding.element.id || null)) return false;
    const actual = [...new Set(node.classList)].sort();
    const expected = [...new Set(binding.element.classes || [])].sort();
    return actual.length === expected.length && actual.every((item, index) => item === expected[index]);
  }

  function firstHeading(node) {
    const heading = node.querySelector('h1,h2,h3,h4,h5,h6');
    // The server binds source text. innerText can apply CSS text-transform and
    // make unchanged headings appear different in the browser.
    return heading ? {tag: heading.tagName.toLowerCase(), text: norm(heading.textContent)} : null;
  }

  function nodeDescription(node) {
    if (node.type === 'image') {
      const alt = norm(node.alt);
      if (alt) return `Image · ${alt}`;
      try {
        const pathname = new URL(node.value, state.draft?.sourceUrl).pathname;
        return `Image · ${decodeURIComponent(pathname.split('/').pop() || 'Selected image')}`;
      } catch {
        return 'Image';
      }
    }
    const excerpt = norm(node.value);
    return excerpt ? `“${excerpt.length > 72 ? `${excerpt.slice(0, 69)}…` : excerpt}”` : 'Copy';
  }

  function dateTime(value) {
    if (!value) return 'Undated';
    return new Intl.DateTimeFormat('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
      timeZone: 'America/Denver', timeZoneName: 'short',
    }).format(new Date(value));
  }

  function currentRevisionUrl() {
    const current = (state.draft?.history || []).find(item => item.id === state.draft?.revision);
    return safe(current?.workingUrl || state.draft?.workingUrl);
  }

  function layout() {
    if (!root) return;
    if (state.layoutKey === state.pageKey && $('review-frame') && $('review-panel')) return;
    resizeObserver?.disconnect();
    root.innerHTML = `
      <div id="review-topline" class="review-topline"></div>
      <div class="review-workgrid">
        <aside id="review-section-nav" class="review-section-nav"></aside>
        <section class="review-preview">
          <div id="review-preview-bar" class="review-preview-bar"></div>
          <div class="review-frame-shell">
            <iframe id="review-frame" sandbox="allow-same-origin" title="Private working page"></iframe>
            <div id="review-overlay" class="review-overlay" aria-hidden="true"></div>
            <div id="review-frame-message" class="review-frame-message">Loading private working page…</div>
          </div>
        </section>
        <aside id="review-panel" class="review-panel"></aside>
      </div>`;
    state.layoutKey = state.pageKey;
    state.frameReady = false;
  }

  function renderTop(active) {
    const container = $('review-topline');
    if (!container) return;
    container.innerHTML = `
      <div><p class="eyebrow">${esc(names[state.family])} / ${esc(names[state.variant])} · Working page</p>
        <strong>${active ? `${esc(active.id)} · ${esc(active.name)}` : 'No mapped section'}</strong></div>
      <nav class="review-variants" aria-label="Working page version">
        ${variants(state.family).map(variant => `<button data-review-variant="${esc(variant)}" class="${variant === state.variant ? 'selected' : ''}" aria-pressed="${variant === state.variant}">${['g', 'a', 'm'].includes(variant) ? `<span>${variant.toUpperCase()}</span>` : ''}${esc(names[variant])}</button>`).join('')}
      </nav>
      ${state.draft ? `<a class="review-open-page" target="_blank" rel="noopener" href="${esc(safe(state.draft.workingUrl))}">Open working page ↗</a>` : ''}`;
    container.querySelectorAll('[data-review-variant]').forEach(button => {
      button.addEventListener('click', () => document.dispatchEvent(new CustomEvent('tracker:select-variant', {
        detail: {variant: button.dataset.reviewVariant},
      })));
    });
  }

  function renderNavigation(items) {
    const container = $('review-section-nav');
    if (!container) return;
    container.innerHTML = `
      <label class="review-select-label" for="review-select">Section</label>
      <select id="review-select">${items.map(item => `<option value="${esc(item.id)}" ${item.id === state.selected ? 'selected' : ''}>${esc(item.id)} · ${esc(item.name)}</option>`).join('')}</select>
      <div class="review-section-list">${items.map(item => `<button data-review-section="${esc(item.id)}" class="${item.id === state.selected ? 'selected' : ''}"><span>${esc(item.id)}</span><b>${esc(item.name)}</b><small>${esc(workingBinding(item.id)?.firstHeading?.text || 'No current heading')}</small></button>`).join('')}</div>`;
    $('review-select')?.addEventListener('change', event => chooseSection(event.target.value));
    container.querySelectorAll('[data-review-section]').forEach(button => {
      button.addEventListener('click', () => chooseSection(button.dataset.reviewSection));
    });
  }

  function renderPreview(active) {
    const bar = $('review-preview-bar');
    if (!bar) return;
    bar.innerHTML = `<span>${esc(active?.id || '')}</span><span>${esc(active?.name || '')}</span><span class="review-preview-heading">DRAFT</span>`;
  }

  function editorMarkup(node) {
    const entry = scratchFor(node);
    if (node.type === 'text') {
      return `<label>Draft copy<textarea id="review-text" rows="7">${esc(entry.text)}</textarea></label>`;
    }
    const current = imageUrl(node.value);
    return `
      <div class="review-current-image">${current ? `<img src="${esc(current)}" alt="Current selected image">` : ''}</div>
      <label>Replacement image<input id="review-image" type="file" accept="image/png,image/jpeg,image/webp"></label>
      <div id="review-dropzone" class="review-dropzone" tabindex="0">Drop or paste PNG, JPEG, or WebP here</div>
      <div id="review-image-preview" class="review-image-preview">${entry.objectUrl ? `<img src="${esc(entry.objectUrl)}" alt="Selected replacement preview">` : ''}</div>`;
  }

  function beforeAfter(value, label) {
    if (typeof value === 'string') return `<p class="review-before"><strong>${esc(label)}:</strong> ${esc(value || 'Empty')}</p>`;
    const url = imageUrl(value);
    return `<p class="review-before"><strong>${esc(label)}:</strong> ${url ? `<a href="${esc(url)}" target="_blank" rel="noopener">Open image ↗</a>` : 'Image'}</p>`;
  }

  function historyMarkup(event) {
    const isImage = event.operationType === 'image';
    const afterImage = isImage ? imageUrl(event.after) : '';
    const actorName = event.editor?.name || 'Verified contributor';
    const actorEmail = event.editor?.email || '';
    const title = isImage ? 'Saved image change' : 'Saved copy change';
    const revisionLink = safe(event.workingUrl);
    const screenshotLink = event.screenshot?.status === 'ready' ? safe(event.screenshot.imageUrl) : '';
    const screenshotStatus = event.screenshot?.status === 'pending'
      ? '<small>Screenshot pending</small>'
      : event.screenshot?.status === 'error'
        ? '<small>The working page was saved; its screenshot will retry automatically.</small>' : '';
    return `<article class="review-version">
      <div><strong>${title}</strong><time>${esc(dateTime(event.createdAt))}</time></div>
      ${beforeAfter(event.before, 'Before')}
      ${isImage ? `${beforeAfter(event.after, 'After')}${afterImage ? `<img src="${esc(afterImage)}" alt="Saved replacement image">` : ''}` : `<blockquote>${esc(String(event.after || ''))}</blockquote>`}
      ${event.material?.exampleUrl ? `<p><a href="${esc(safe(event.material.exampleUrl))}" target="_blank" rel="noopener">Open Vercel example ↗</a></p>` : ''}
      ${revisionLink ? `<p><a href="${esc(revisionLink)}" target="_blank" rel="noopener">Open this saved working page ↗</a></p>` : ''}
      ${screenshotLink ? `<p><a href="${esc(screenshotLink)}" target="_blank" rel="noopener">Open its screenshot ↗</a></p>` : screenshotStatus}
      ${event.material?.note ? `<p class="review-version-note">${esc(event.material.note)}</p>` : ''}
      <small>${esc(actorName)}${actorEmail ? ` · ${esc(actorEmail)}` : ''} · ${esc(dateTime(event.createdAt))}</small>
    </article>`;
  }

  function publicationMarkup(item) {
    const actorName = item.editor?.name || 'Verified contributor';
    const actorEmail = item.editor?.email || '';
    const liveUrl = safe(item.liveUrl);
    return `<article class="review-event"><strong>Published confirmation</strong><time>${esc(dateTime(item.confirmedAt))}</time>${liveUrl ? `<p><a href="${esc(liveUrl)}" target="_blank" rel="noopener">Open customer page ↗</a></p>` : ''}${item.note ? `<p>${esc(item.note)}</p>` : ''}<small>${esc(actorName)}${actorEmail ? ` · ${esc(actorEmail)}` : ''}</small></article>`;
  }

  function renderConflict() {
    if (!state.conflict) return '';
    const latestNode = state.conflict.latest?.editableNodes?.find(item => item.editId === state.conflict.editId);
    const latestValue = latestNode?.type === 'text' ? latestNode.value : 'The selected image changed.';
    const desired = state.conflict.desired.type === 'text' ? state.conflict.desired.text : state.conflict.desired.fileName;
    return `<div class="review-unavailable"><strong>A newer working page was saved.</strong><p>Your change is still here. Compare it with the latest saved version, then load that version before retrying.</p><details><summary>Compare changes</summary><p><strong>Latest saved:</strong> ${esc(latestValue || 'Empty')}</p><p><strong>Your change:</strong> ${esc(desired || 'Selected image')}</p></details><button type="button" id="review-load-latest">Load latest and keep my change</button></div>`;
  }

  function currentRevisionIsPublishable() {
    return Boolean(sectionRevision());
  }

  function sectionRevision() {
    return (state.draft?.history || []).filter(item => item.kind === 'edit' && item.sectionId === state.selected).at(-1);
  }

  function knownProductionUrls(active) {
    const values = [];
    if (active?.live?.productionUrl) values.push(active.live.productionUrl);
    if (state.family === 'lander') {
      const slug = {g: 'lg', m: 'lm', a: 'la'}[state.variant];
      if (slug) values.push(`https://zodiac.fm/${slug}`, `https://zodiac.fm/${slug}?coupon=FACEBOOK20`, `https://zodiac.fm/${slug}?inf_affid=14085`);
    }
    if (state.family === 'results') {
      const category = {g: 'general', m: 'manifesting', a: 'astrology'}[state.variant];
      if (category) values.push(`https://app.zodiac.fm/frequency?category=${category}&coupon=MCEWEN&affiliate=David%20McEwen`, `https://app.zodiac.fm/frequency?category=${category}&coupon=FACEBOOK20`);
    }
    return [...new Set(values.filter(Boolean))];
  }

  function renderPanel(active, binding, nodes) {
    const panel = $('review-panel');
    if (!panel) return;
    const node = state.picked;
    const entry = scratchFor(node);
    const history = (state.draft?.history || []).filter(item => item.sectionId === state.selected).slice().reverse();
    const publications = (state.draft?.publications || []).filter(item => item.sectionId === state.selected).slice().reverse();
    panel.innerHTML = `
      <div class="review-panel-head"><p class="eyebrow">Edit the working page</p><h2>${esc(active?.id || '')} · ${esc(active?.name || '')}</h2><p>${esc(binding?.firstHeading?.text || '')}</p></div>
      ${binding?.gaps?.length ? `<details class="review-source-notes review-gap"><summary>Source notes</summary>${binding.gaps.map(item => `<p>${esc(item)}</p>`).join('')}</details>` : ''}
      <form id="review-change-form">
        <div class="review-picker"><strong>${node ? (node.type === 'image' ? 'Selected image' : 'Selected text') : 'Choose text or an image'}</strong><p>${node ? esc(nodeDescription(node)) : (nodes.length ? 'Click a copy line or image in the working page.' : 'Nothing in this section is ready to edit yet.')}</p>${node ? editorMarkup(node) : `<div class="review-node-list">${nodes.map(item => `<button type="button" data-review-pick="${esc(item.editId)}">${esc(nodeDescription(item))}</button>`).join('')}</div>`}</div>
        <div class="review-reference"><label>Vercel example (reference only)<input id="review-example" type="url" placeholder="https://zodiac-pages.vercel.app/…" value="${esc(entry?.exampleUrl || '')}"></label><label class="review-note">Optional note<textarea id="review-note" rows="2">${esc(entry?.note || '')}</textarea></label></div>
        ${renderConflict()}
        <div class="review-save-area"><p id="review-form-error" class="review-form-error" role="alert"></p><button id="review-save" class="review-save" type="submit">Save draft changes</button><p id="review-status" class="review-status ${esc(state.notice?.kind || '')}">${esc(state.notice?.text || '')}</p></div>
      </form>
      <section class="review-history"><h3>Draft history</h3>${history.length ? history.map(historyMarkup).join('') : '<p class="review-muted">No direct edits saved for this section.</p>'}<details class="review-source-notes"><summary>Source baseline and notes</summary><p>${esc(active?.scopeNote || '')}</p>${(active?.versions || []).slice().reverse().map(version => `<p><strong>Imported record ${esc(version.number)}</strong> · ${esc(version.summary || '')}</p>`).join('')}</details></section>
      <section class="review-live"><h3>When Walter publishes it</h3><p>Confirm this section’s latest saved change after it appears on the customer page.</p><button id="review-publish" type="button" ${state.canEdit && currentRevisionIsPublishable() ? '' : 'disabled'}>Confirm published</button>${!currentRevisionIsPublishable() ? '<p class="review-muted">Save a change in this section before confirming it.</p>' : ''}<div id="review-published-form" hidden></div>${publications.map(publicationMarkup).join('')}</section>`;
    panel.querySelectorAll('[data-review-pick]').forEach(button => {
      button.addEventListener('click', () => pickNode(button.dataset.reviewPick));
    });
    $('review-change-form')?.addEventListener('submit', event => {
      event.preventDefault();
      save();
    });
    $('review-publish')?.addEventListener('click', () => publish(active));
    $('review-load-latest')?.addEventListener('click', loadLatestAfterConflict);
    wireEditor();
    updateSaveButton();
  }

  function render() {
    if (!root || !state.data || !state.map || !state.draft) return;
    const items = pageSections();
    if (!state.selected || !items.some(item => item.id === state.selected)) state.selected = items[0]?.id || null;
    if (state.picked && state.picked.sectionId !== state.selected) state.picked = null;
    const active = section();
    const binding = workingBinding(state.selected);
    const nodes = (state.draft.editableNodes || []).filter(item => item.sectionId === state.selected);
    layout();
    renderTop(active);
    renderNavigation(items);
    renderPreview(active);
    renderPanel(active, binding, nodes);
    loadFrame(currentRevisionUrl());
  }

  function chooseSection(sectionId) {
    if (sectionId === state.selected) {
      state.pendingScroll = true;
      scrollSelected();
      return;
    }
    stashInputs();
    state.selected = sectionId;
    state.picked = null;
    state.conflict = null;
    state.pendingScroll = true;
    const url = new URL(location.href);
    url.searchParams.set('section', sectionId);
    history.replaceState(null, '', url);
    renderTop(section());
    renderNavigation(pageSections());
    renderPreview(section());
    renderPanel(section(), workingBinding(sectionId), (state.draft?.editableNodes || []).filter(item => item.sectionId === sectionId));
    markLabels();
    scrollSelected();
  }

  function pickNode(editId) {
    stashInputs();
    const node = state.draft?.editableNodes?.find(item => item.editId === editId);
    if (!node) return;
    state.selected = node.sectionId;
    state.picked = node;
    state.conflict = null;
    renderPanel(section(), workingBinding(state.selected), state.draft.editableNodes.filter(item => item.sectionId === state.selected));
    markLabels();
  }

  function scrollSelected() {
    const frame = $('review-frame');
    if (!state.frameReady || !state.pendingScroll || !frame?.contentDocument) return;
    const escaped = window.CSS?.escape ? CSS.escape(state.selected) : String(state.selected).replace(/[^A-Za-z0-9_-]/g, '\\$&');
    const target = frame.contentDocument.querySelector(`[data-funnel-section-id="${escaped}"]`);
    if (target && frame.contentWindow) {
      const banner = frame.contentDocument.querySelector('[data-funnel-working-banner]');
      const inset = (banner?.getBoundingClientRect().height || 0) + 12;
      const top = target.getBoundingClientRect().top + frame.contentWindow.scrollY - inset;
      frame.contentWindow.scrollTo({top: Math.max(0, top), behavior: 'smooth'});
    }
    state.pendingScroll = false;
  }

  function markLabels() {
    const frame = $('review-frame');
    const documentRoot = frame?.contentDocument;
    if (!state.frameReady || !documentRoot) return;
    $('review-overlay')?.replaceChildren();
    documentRoot.querySelectorAll('[data-funnel-working-label]').forEach(label => {
      const owner = label.closest('[data-funnel-section-id]');
      const selected = owner?.getAttribute('data-funnel-section-id') === state.selected;
      label.style.outline = selected ? '2px solid #a82759' : '';
      label.style.outlineOffset = selected ? '2px' : '';
      if (selected) label.setAttribute('aria-current', 'true');
      else label.removeAttribute('aria-current');
    });
  }

  function wireFrame(documentRoot) {
    if (documentRoot.documentElement.dataset.funnelReviewWired === 'true') return;
    documentRoot.documentElement.dataset.funnelReviewWired = 'true';
    documentRoot.addEventListener('click', event => {
      const editable = event.target.closest?.('[data-funnel-edit-id]');
      const region = event.target.closest?.('[data-funnel-section-id]');
      if (!editable && !region) return;
      event.preventDefault();
      event.stopPropagation();
      const sectionId = (editable || region).closest('[data-funnel-section-id]')?.getAttribute('data-funnel-section-id');
      if (sectionId && sectionId !== state.selected) chooseSection(sectionId);
      if (editable) pickNode(editable.getAttribute('data-funnel-edit-id'));
    }, true);
  }

  function frameError(message, url) {
    state.frameReady = false;
    const area = $('review-frame-message');
    if (!area) return;
    const href = safe(url);
    area.hidden = false;
    area.innerHTML = `<strong>Working page unavailable</strong><p>${esc(message)}</p>${href ? `<a href="${esc(href)}" target="_blank" rel="noopener">Open working page ↗</a>` : ''}`;
  }

  function loadFrame(url) {
    const frame = $('review-frame');
    const href = safe(url);
    if (!frame || !href) return frameError('The private working page link is unavailable.', url);
    if (frame.dataset.reviewUrl === href && frame.contentDocument?.body) {
      state.frameReady = true;
      markLabels();
      scrollSelected();
      return;
    }
    const token = ++state.frameToken;
    state.frameReady = false;
    frame.dataset.reviewUrl = href;
    const message = $('review-frame-message');
    if (message) {
      message.hidden = false;
      message.textContent = 'Loading private working page…';
    }
    frame.onload = () => {
      if (token !== state.frameToken) return;
      try {
        const documentRoot = frame.contentDocument;
        const failures = [];
        for (const binding of state.draft?.workingBindings || []) {
          let matches;
          let owned;
          try {
            matches = documentRoot.querySelectorAll(binding.selector);
            const sectionId = window.CSS?.escape
              ? CSS.escape(binding.sectionId)
              : String(binding.sectionId).replace(/[^A-Za-z0-9_-]/g, '\\$&');
            owned = documentRoot.querySelectorAll(`[data-funnel-section-id="${sectionId}"]`);
          } catch {
            failures.push(binding.sectionId);
            continue;
          }
          if (matches.length !== 1 || owned.length !== 1 || matches[0] !== owned[0]
              || !elementMatches(matches[0], binding)) {
            failures.push(binding.sectionId);
            continue;
          }
          const actual = firstHeading(matches[0]);
          const expected = binding.firstHeading;
          if ((actual?.tag || null) !== (expected?.tag || null)
              || (actual?.text || null) !== (expected?.text || null)) failures.push(binding.sectionId);
        }
        if (failures.length) throw Error(`The saved working page no longer matches ${failures.slice(0, 2).join(', ')}.`);
        wireFrame(documentRoot);
        state.frameReady = true;
        if (message) message.hidden = true;
        markLabels();
        resizeObserver?.disconnect();
        resizeObserver = new ResizeObserver(markLabels);
        resizeObserver.observe(frame);
        state.pendingScroll = true;
        scrollSelected();
      } catch (error) {
        frameError(error.message, href);
      }
    };
    frame.onerror = () => frameError('The private working page could not be embedded.', href);
    frame.src = href;
  }

  function fileError(message) {
    const error = $('review-form-error');
    if (error) error.textContent = message;
  }

  function acceptFile(file) {
    const entry = scratchFor();
    if (!entry || state.picked?.type !== 'image') return;
    if (!file || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size < 1 || file.size > 4 * 1024 * 1024) {
      fileError('Choose a PNG, JPEG, or WebP image up to 4 MiB.');
      return;
    }
    releaseScratch(entry);
    entry.file = file;
    entry.objectUrl = URL.createObjectURL(file);
    entry.attachmentId = '';
    fileError('');
    const preview = $('review-image-preview');
    if (preview) preview.innerHTML = `<img src="${esc(entry.objectUrl)}" alt="Selected replacement preview">`;
    updateSaveButton();
  }

  function wireEditor() {
    const form = $('review-change-form');
    if (!form) return;
    form.querySelectorAll('textarea,input[type=url]').forEach(input => {
      input.addEventListener('input', () => {
        stashInputs();
        updateSaveButton();
      });
    });
    $('review-image')?.addEventListener('change', event => acceptFile(event.target.files?.[0]));
    const dropzone = $('review-dropzone');
    if (dropzone) {
      for (const type of ['dragenter', 'dragover']) dropzone.addEventListener(type, event => {
        event.preventDefault();
        dropzone.dataset.dragging = 'true';
      });
      for (const type of ['dragleave', 'drop']) dropzone.addEventListener(type, event => {
        event.preventDefault();
        delete dropzone.dataset.dragging;
      });
      dropzone.addEventListener('drop', event => acceptFile(event.dataTransfer?.files?.[0]));
      dropzone.addEventListener('paste', event => acceptFile([...event.clipboardData.files][0]));
      dropzone.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') $('review-image')?.click();
      });
    }
  }

  function hasChange() {
    const entry = scratchFor();
    if (!state.picked || !entry) return false;
    if (state.picked.type === 'image') return Boolean(entry.file);
    return entry.text.trim() !== String(state.picked.value || '').trim();
  }

  function updateSaveButton() {
    const button = $('review-save');
    if (!button) return;
    button.disabled = !state.canEdit || !state.picked || !hasChange() || Boolean(state.conflict);
  }

  async function uploadAttachment(file) {
    const response = await request('/api/funnel-review?action=attachment', {
      method: 'POST',
      headers: {'Content-Type': file.type, 'X-Funnel-Filename': file.name || 'replacement-image'},
      body: file,
    });
    if (!response.attachment?.id) throw Error('The replacement image was uploaded without a usable receipt.');
    return response.attachment;
  }

  function changeMaterial(node, entry, attachmentId) {
    const material = {};
    if (node.type === 'text') material.replacementCopy = entry.text.trim();
    else material.attachmentId = attachmentId;
    if (entry.exampleUrl.trim()) material.exampleUrl = entry.exampleUrl.trim();
    if (entry.note.trim()) material.note = entry.note.trim();
    return material;
  }

  function validExampleUrl(value) {
    if (!value) return true;
    try {
      const url = new URL(value);
      return url.origin === 'https://zodiac-pages.vercel.app'
        && !url.port && !url.hash && /^\/(?:landers|funnel|site)(?:\/|$)/.test(url.pathname);
    } catch {
      return false;
    }
  }

  function validProductionUrl(value) {
    try {
      const url = new URL(value);
      const hostname = url.hostname.toLowerCase();
      const labels = hostname.split('.');
      return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash
        && (hostname === 'zodiac.fm' || hostname.endsWith('.zodiac.fm'))
        && !labels.some(label => ['dev', 'development', 'preview', 'staging', 'test'].includes(label));
    } catch {
      return false;
    }
  }

  async function save() {
    stashInputs();
    const node = state.picked;
    const entry = scratchFor(node);
    if (!node || !entry || !hasChange() || state.conflict) return updateSaveButton();
    const button = $('review-save');
    const errorArea = $('review-form-error');
    if (!validExampleUrl(entry.exampleUrl.trim())) {
      if (errorArea) errorArea.textContent = 'Use a zodiac-pages.vercel.app lander, funnel, or site link as the example.';
      return;
    }
    if (button) button.disabled = true;
    if (errorArea) errorArea.textContent = '';
    setNotice('Saving the working page…');
    try {
      let attachmentId;
      if (node.type === 'image') {
        attachmentId = entry.attachmentId || (await uploadAttachment(entry.file)).id;
        entry.attachmentId = attachmentId;
      }
      const operation = node.type === 'text'
        ? {type: 'text', value: entry.text.trim()}
        : {type: 'image', attachmentId};
      const response = await request('/api/funnel-review?action=draft-edit', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          pageKey: state.pageKey,
          sectionId: state.selected,
          editId: node.editId,
          expectedRevision: state.draft.revision,
          operation,
          material: changeMaterial(node, entry, attachmentId),
        }),
      });
      clearScratch(node);
      state.draft = response.draft;
      state.user = response.user || state.user;
      document.dispatchEvent(new Event('tracker:working-saved'));
      state.picked = state.draft.editableNodes.find(item => item.editId === node.editId) || null;
      state.conflict = null;
      state.frameReady = false;
      const capture = response.event?.screenshot;
      state.notice = capture?.status === 'ready'
        ? {text: 'Draft saved and screenshot recorded.', kind: 'success'}
        : capture?.status === 'error'
          ? {text: 'Draft saved. Its screenshot will retry automatically.', kind: 'success'}
          : {text: 'Draft saved. Screenshot pending.', kind: 'success'};
      renderTop(section());
      renderNavigation(pageSections());
      renderPreview(section());
      renderPanel(section(), workingBinding(state.selected), state.draft.editableNodes.filter(item => item.sectionId === state.selected));
      loadFrame(currentRevisionUrl());
    } catch (error) {
      if (error.status === 409 && error.result?.draft) {
        state.conflict = {
          latest: error.result.draft,
          editId: node.editId,
          desired: node.type === 'text'
            ? {type: 'text', text: entry.text}
            : {type: 'image', fileName: entry.file?.name || 'Selected image'},
        };
        renderPanel(section(), workingBinding(state.selected), state.draft.editableNodes.filter(item => item.sectionId === state.selected));
        setNotice('A newer working page exists. Compare it before retrying.', 'error');
      } else {
        if (errorArea) errorArea.textContent = error.message;
        setNotice('The change was not saved.', 'error');
        updateSaveButton();
      }
    }
  }

  function loadLatestAfterConflict() {
    if (!state.conflict?.latest) return;
    const editId = state.conflict.editId;
    const previous = state.draft;
    const latest = state.conflict.latest;
    rebaseCleanScratch(previous, latest);
    state.draft = latest;
    state.picked = state.draft.editableNodes.find(item => item.editId === editId) || null;
    if (state.picked) {
      state.selected = state.picked.sectionId;
      const url = new URL(location.href);
      url.searchParams.set('section', state.selected);
      history.replaceState(null, '', url);
    }
    state.conflict = null;
    state.frameReady = false;
    state.notice = {text: 'Latest saved page loaded. Your change is still in the editor.', kind: ''};
    renderTop(section());
    renderNavigation(pageSections());
    renderPreview(section());
    renderPanel(section(), workingBinding(state.selected), state.draft.editableNodes.filter(item => item.sectionId === state.selected));
    loadFrame(currentRevisionUrl());
  }

  function publish(active) {
    const area = $('review-published-form');
    if (!area || !state.canEdit || !currentRevisionIsPublishable()) return;
    const urls = knownProductionUrls(active);
    const selectedUrl = urls[0] || '';
    area.hidden = false;
    area.className = 'review-live-form';
    area.innerHTML = `<form id="review-live-form">
      ${urls.length ? `<label>Customer production page<select id="review-live-choice">${urls.map(url => `<option value="${esc(url)}">${esc(url)}</option>`).join('')}<option value="custom">Another customer URL</option></select></label>` : ''}
      <label ${urls.length ? 'hidden' : ''} id="review-live-custom-label">Customer production URL<input id="review-live-url" type="url" required value="${esc(selectedUrl)}" placeholder="https://app.zodiac.fm/…"></label>
      <label>Optional note<textarea id="review-live-note" rows="2"></textarea></label>
      <label class="review-check"><input id="review-live-confirm" type="checkbox" required> I checked this section’s saved change on the customer page, or Walter confirmed it.</label>
      <p id="review-live-error" class="review-form-error" role="alert"></p>
      <button id="review-confirm-live" type="submit">Record published confirmation</button>
    </form>`;
    const choice = $('review-live-choice');
    const input = $('review-live-url');
    choice?.addEventListener('change', () => {
      const custom = choice.value === 'custom';
      $('review-live-custom-label').hidden = !custom;
      input.value = custom ? '' : choice.value;
    });
    area.querySelector('form').addEventListener('submit', confirmPublished);
  }

  async function confirmPublished(event) {
    event.preventDefault();
    const errorArea = $('review-live-error');
    const button = $('review-confirm-live');
    const liveUrl = $('review-live-choice') && $('review-live-choice').value !== 'custom'
      ? $('review-live-choice').value : $('review-live-url')?.value.trim();
    if (!$('review-live-confirm')?.checked) return;
    if (!validProductionUrl(liveUrl)) {
      if (errorArea) errorArea.textContent = 'Enter the customer production URL.';
      return;
    }
    button.disabled = true;
    if (errorArea) errorArea.textContent = '';
    try {
      const response = await request('/api/funnel-review?action=confirm-published', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          pageKey: state.pageKey,
          sectionId: state.selected,
          revisionId: sectionRevision()?.id,
          liveUrl,
          confirmed: true,
          note: $('review-live-note')?.value.trim() || undefined,
        }),
      });
      state.draft = response.draft;
      document.dispatchEvent(new Event('tracker:working-saved'));
      state.notice = {text: 'Published confirmation recorded.', kind: 'success'};
      renderPanel(section(), workingBinding(state.selected), state.draft.editableNodes.filter(item => item.sectionId === state.selected));
    } catch (error) {
      if (errorArea) errorArea.textContent = error.message;
      button.disabled = false;
    }
  }

  async function ready(event) {
    stashInputs();
    const detail = event.detail || {};
    const changedPage = detail.family && (detail.family !== state.family || detail.variant !== state.variant);
    state.user = detail.user || state.user;
    state.family = detail.family || state.family;
    state.variant = detail.variant || state.variant;
    state.data = detail.data || state.data;
    state.canEdit = typeof detail.canEdit === 'boolean' ? detail.canEdit : state.canEdit;
    try {
      await loadBase();
      await loadDraft({force: !changedPage && Boolean(state.draft)});
      render();
    } catch (error) {
      if (root) root.innerHTML = `<div class="review-unavailable"><strong>Working page unavailable</strong><p>${esc(error.message)}</p></div>`;
    }
  }

  function start() {
    root = $('review-workspace');
    if (!root) return;
    const initialRoute = new URLSearchParams(location.search);
    const initialFamily = initialRoute.get('page');
    if (['lander', 'bc', 'results', 'join'].includes(initialFamily)) state.family = initialFamily;
    const initialVariant = initialRoute.get('variant');
    state.variant = variants(state.family).includes(initialVariant) ? initialVariant : variants(state.family)[0];
    const requested = initialRoute.get('section');
    if (requested) state.selected = requested;
    root.hidden = true;
    document.addEventListener('tracker:ready', ready);
    document.addEventListener('tracker:selection', async event => {
      stashInputs();
      const changedPage = event.detail.family !== state.family || event.detail.variant !== state.variant;
      if (!changedPage) return;
      state.family = event.detail.family;
      state.variant = event.detail.variant;
      state.selected = null;
      state.layoutKey = '';
      try {
        await loadDraft();
        render();
      } catch (error) {
        if (root) root.innerHTML = `<div class="review-unavailable"><strong>Working page unavailable</strong><p>${esc(error.message)}</p></div>`;
      }
    });
    document.addEventListener('tracker:mode', event => {
      stashInputs();
      state.mode = event.detail?.mode;
      root.hidden = state.mode !== 'review';
    });
    document.addEventListener('tracker:signed-out', clear);
    document.addEventListener('tracker:show-changes', () => root.querySelector('.review-history')?.scrollIntoView({behavior: 'smooth'}));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') stashInputs();
    });
    window.addEventListener('pagehide', stashInputs);
    window.setInterval(() => {
      if (state.mode === 'review') stashInputs();
    }, 1500);
  }

  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', start) : start();
})();
