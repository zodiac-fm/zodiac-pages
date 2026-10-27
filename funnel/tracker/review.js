'use strict';

(() => {
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
  const norm = value => String(value || '').replace(/\s+/g, ' ').trim();
  const names = {
    lander: 'Lander', results: 'Results', bc: 'Birth chart', join: 'Cart / Join', corporate: 'Corporate site',
    g: 'General', a: 'Astrology and Human Design', m: 'Manifestation', shared: 'Birth chart',
    paid: 'Paid trial', free: 'Free trial', home: 'Home',
  };
  const variants = family => family === 'corporate' ? ['home'] : family === 'bc' ? ['shared'] : family === 'join' ? ['paid', 'free'] : ['g', 'a', 'm'];
  const state = {
    map: null, data: null, user: null, canEdit: false,
    family: 'lander', variant: 'g', selected: null,
    draft: null, pageKey: '', picked: null, frameReady: false, frameToken: 0, draftToken: 0,
    mode: null, notice: null, pendingScroll: false, conflict: null,
    scratch: new Map(), layoutKey: '', work: [], workError: '', syncing: false,
    pageChoice: '', pages: [], pagesError: '',
    view: 'desktop', viewScope: 'shared',
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

  function selectedView() { return state.view === 'mobile' ? 'mobile' : 'desktop'; }

  function withView(value) {
    const href = safe(value);
    if (!href) return '';
    try {
      const url = new URL(href, location.origin);
      url.searchParams.set('view', selectedView());
      return safe(url.href);
    } catch { return href; }
  }

  function syncStatus(value) {
    const sync = value?.sync || value;
    const status = sync?.status || value?.status;
    if (status === 'unsynced') return 'unsynced';
    const views = sync?.views || value?.views || {};
    const unavailable = sync?.checkStatus === 'unavailable' || value?.checkStatus === 'unavailable'
      || Object.values(views).some(view => (view?.sync || view)?.checkStatus === 'unavailable');
    return unavailable ? 'unavailable' : status || 'unavailable';
  }

  function activeDraft(value = state.draft) {
    if (!value) return value;
    const view = value.views?.[selectedView()];
    return view ? {...value, ...view, views: value.views, overallSync: value.viewSync || value.overallSync || value.sync, activeView: selectedView()} : value;
  }

  function imageUrl(value) {
    const raw = typeof value === 'string' ? value : value?.url;
    if (!String(raw || '').trim()) return '';
    try {
      const base = String(raw).startsWith('/api/funnel-review') ? location.origin : state.draft?.contentBaseUrl || state.draft?.sourceUrl;
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
  const mainDraftKey = () => state.family === 'bc' ? 'draft-bc' : `draft-${state.family}-${state.variant}`;
  const draftKey = () => state.pageChoice || mainDraftKey();
  const scratchKey = (node = state.picked) => node ? `${state.pageKey}:${node.sectionId}:${node.editId}` : '';

  function scratchFor(node = state.picked) {
    if (!node) return null;
    const key = scratchKey(node);
    if (!state.scratch.has(key)) {
      state.scratch.set(key, {
        editId: node.editId, sectionId: node.sectionId, type: node.type,
        text: node.type === 'text' ? String(node.value || '') : '',
        note: '', changeSummary: '', releaseType: 'minor', exampleUrl: '', file: null, objectUrl: '', attachmentId: '',
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
    if ($('review-summary')) entry.changeSummary = $('review-summary').value;
    if ($('review-release-type')) entry.releaseType = $('review-release-type').value;
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
    state.work = [];
    state.pages = [];
    state.pageChoice = '';
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
      state.viewScope = 'shared';
      state.frameReady = false;
    }
    const token = ++state.draftToken;
    let response;
    try {
      response = await request(`/api/funnel-review?action=draft&pageKey=${encodeURIComponent(pageKey)}&view=${selectedView()}`);
    } catch (error) {
      if (error.status !== 404) throw error;
      response = await request(`/api/funnel-review?action=initialize-draft&view=${selectedView()}`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({pageKey}),
      });
    }
    response.draft = activeDraft(response.draft);
    if (!response.draft?.workingUrl || !Array.isArray(response.draft.editableNodes)) {
      throw Error('The working page cannot be prepared for editing.');
    }
    if (response.draft.sourceOutdated) {
      try {
        response = await request(`/api/funnel-review?action=initialize-draft&view=${selectedView()}`, {
          method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({pageKey}),
        });
      } catch (error) {
        if (error.status !== 409 || !error.result?.draft) throw error;
        response.draft = activeDraft(error.result.draft);
        state.notice = {text: error.message, kind: 'error'};
      }
    }
    response.draft = activeDraft(response.draft);
    try {
      const linked = await request(`/api/funnel-review?action=linear-work&pageKey=${encodeURIComponent(pageKey)}`);
      if (token === state.draftToken) { state.work = linked.entries || []; state.workError = ''; }
    } catch { state.work = []; state.workError = 'Linked work could not be loaded. Refresh to retry.'; }
    try {
      const pages = await request('/api/funnel-review?action=working-pages');
      if (token === state.draftToken) { state.pages = pages.drafts || []; state.pagesError = ''; }
    } catch { state.pagesError = 'Other working pages could not be loaded. Refresh to retry.'; }
    if (token !== state.draftToken || state.pageKey !== pageKey) return state.draft;
    const latest = activeDraft(response.draft);
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
    return withView(current?.workingUrl || state.draft?.workingUrl);
  }

  function previewEmbedUrl(value) {
    const href = withView(value);
    if (!href) return '';
    const url = new URL(href, location.origin);
    url.searchParams.set('embedded', '1');
    return safe(url.href);
  }

  async function chooseView(view) {
    if (!['desktop', 'mobile'].includes(view) || view === selectedView()) return;
    stashInputs();
    state.view = view;
    state.viewScope = 'shared';
    state.picked = null;
    state.conflict = null;
    state.frameReady = false;
    const route = new URL(location.href);
    route.searchParams.set('view', view);
    history.replaceState(null, '', route);
    try {
      await loadDraft({force: true});
      render();
    } catch (error) {
      setNotice(error.message, 'error');
    }
  }

  function layout() {
    if (!root) return;
    if (state.layoutKey === state.pageKey && $('review-frame') && $('review-panel')) return;
    resizeObserver?.disconnect();
    root.innerHTML = `
      <div id="review-topline" class="review-topline"></div>
      <div id="review-branchbar"></div>
      <div id="review-viewbar"></div>
      <div id="review-page-pair"></div>
      <div id="review-shared-edit"></div>
      <div class="review-workgrid">
        <aside id="review-section-nav" class="review-section-nav"></aside>
        <section class="review-preview">
          <div id="review-preview-bar" class="review-preview-bar"></div>
          <div id="review-frame-shell" class="review-frame-shell">
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
      <div><p class="eyebrow">${esc(names[state.family])}</p>
        <strong>${esc(names[state.variant])}</strong></div>
      <nav class="review-variants" aria-label="Working page version">
        ${variants(state.family).map(variant => `<button data-review-variant="${esc(variant)}" class="${variant === state.variant ? 'selected' : ''}" aria-pressed="${variant === state.variant}" aria-label="${esc(names[variant])}">${['g', 'a', 'm'].includes(variant) ? `<span>${variant.toUpperCase()}</span>` : ''}<b>${esc(names[variant])}</b></button>`).join('')}
      </nav>
      `;
    container.querySelectorAll('[data-review-variant]').forEach(button => {
      button.addEventListener('click', () => document.dispatchEvent(new CustomEvent('tracker:select-variant', {
        detail: {variant: button.dataset.reviewVariant},
      })));
    });
    renderBranchBar();
    renderViewBar();
    renderPagePair();
  }

  function renderBranchBar() {
    const container = $('review-branchbar'), draft = state.draft;
    if (!container || !draft) return;
    const pages = [draft, ...state.pages.filter(item => item.pageKey !== draft.pageKey)].filter(item => item.mainPageKey === draft.mainPageKey).sort((a,b)=>Number(Boolean(a.variation))-Number(Boolean(b.variation)));
    container.innerHTML = `<div class="review-branchbar"><label>Variation<select id="review-variation">${pages.map(item => `<option value="${esc(item.pageKey)}" ${item.pageKey === draft.pageKey ? 'selected' : ''}>${esc(item.variation?.name || 'Main')} · Version ${esc(item.version)}</option>`).join('') || `<option>${esc(draft.variation?.name || 'Main')} · Version ${esc(draft.version)}</option>`}</select></label><button id="review-new-variation" type="button" ${draft.variation || !state.canEdit ? 'disabled' : ''}>New variation</button>${!draft.releaseStarted ? '<button id="review-start-versions" type="button">Start current pages at Version 1</button>' : ''}<span>Minor changes use 1.1D, 1.2D. A structural change starts 2D. Confirmation removes D.</span></div><div id="review-variation-form"></div>`;
    $('review-start-versions')?.addEventListener('click', async event => {
      stashInputs();
      if (pendingScratch()) return setNotice('Save or undo your unsaved change first.', 'error');
      const button = event.currentTarget; button.disabled = true;
      try {
        const response = await request('/api/funnel-review?action=working-pages');
        await request('/api/funnel-review?action=start-versioning', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({expectedPages:response.drafts.map(item=>({pageKey:item.pageKey,expectedRevision:item.revision}))})});
        await loadDraft({force:true}); render();
      } catch(error) { setNotice(error.message, 'error'); button.disabled = false; }
    });
    $('review-variation').onchange = async event => {
      stashInputs();
      state.pageChoice = event.target.value;
      state.selected = null;
      const route = new URL(location.href);
      route.searchParams.set('pageKey', state.pageChoice);
      route.searchParams.delete('section');
      history.replaceState(null, '', route);
      await loadDraft();
      render();
    };
    $('review-new-variation').onclick = () => {
      stashInputs();
      const area = $('review-variation-form');
      if (pendingScratch()) { area.textContent = 'Save or undo your unsaved changes before creating a variation.'; return; }
      area.innerHTML = `<form class="review-inline-form" id="review-create-variation"><label>Variation name<input name="name" required maxlength="100" placeholder="For example: Different opening"></label><p>Starts from ${esc(draft.label)}. Main stays unchanged.</p><button type="submit">Create variation</button><button id="review-variation-cancel" type="button">Cancel</button><p role="alert" id="review-variation-error"></p></form>`;
      $('review-variation-cancel').onclick = () => area.replaceChildren();
      $('review-create-variation').onsubmit = async event => {
        event.preventDefault();
        const button = event.currentTarget.querySelector('[type=submit]');
        button.disabled = true; button.textContent = 'Creating variation…';
        try {
          const response = await request('/api/funnel-review?action=create-variation', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pageKey:draft.pageKey,expectedRevision:draft.revision,name:new FormData(event.currentTarget).get('name')})});
          state.pageChoice = response.draft.pageKey;
          const route = new URL(location.href); route.searchParams.set('pageKey',state.pageChoice); route.searchParams.delete('section'); history.replaceState(null,'',route);
          state.notice = {text:'Variation created. It has its own version history and is not live.',kind:'success'};
          await loadDraft(); render();
          document.dispatchEvent(new Event('tracker:working-saved'));
        } catch(error) { $('review-variation-error').textContent = error.message; button.disabled = false; button.textContent = 'Create variation'; }
      };
    };
  }

  function renderViewBar() {
    const container = $('review-viewbar');
    if (!container || !state.draft) return;
    const view = selectedView();
    const title = `${names[state.family]} · ${names[state.variant]}`;
    const status = value => value === 'synced' ? 'Synced' : value === 'unsynced' ? 'Unsynced' : 'Check unavailable';
    const desktop = syncStatus(state.draft.views?.desktop);
    const mobile = syncStatus(state.draft.views?.mobile);
    const overall = syncStatus(state.draft.viewSync || state.draft.overallSync || state.draft);
    container.innerHTML = `<section class="review-viewbar"><div class="review-view-summary"><span>Working page</span><strong>${esc(title)} · Version ${esc(state.draft.version)}</strong><small>Viewing ${view === 'desktop' ? 'Desktop web · 1280px fit' : 'Mobile web · 390px viewport'}</small></div><nav class="review-view-toggle" aria-label="Working page view"><button type="button" data-review-view="desktop" class="${view === 'desktop' ? 'selected' : ''}" aria-pressed="${view === 'desktop'}">Desktop web</button><button type="button" data-review-view="mobile" class="${view === 'mobile' ? 'selected' : ''}" aria-pressed="${view === 'mobile'}">Mobile web</button></nav><div class="review-sync-states" aria-label="View synchronization"><b>Desktop ${esc(status(desktop))}</b><b>Mobile ${esc(status(mobile))}</b><b>Overall ${esc(status(overall))}</b></div></section>`;
    container.querySelectorAll('[data-review-view]').forEach(button => button.addEventListener('click', () => chooseView(button.dataset.reviewView)));
  }

  function renderPagePair() {
    const container = $('review-page-pair'), draft = state.draft;
    if (!container || !draft) return;
    const livePages = draft.livePages || [];
    const publication = draft.latestPagePublication;
    const mainLive = livePages.find(item => item.url === (publication?.revisionId === draft.revision ? publication.liveUrl : draft.liveSource?.liveUrl)) || livePages.find(item => item.channel === 'direct') || livePages.find(item => item.channel === 'affiliate') || livePages[0];
    const live = draft.liveSource;
    const canSync = ['lander', 'results'].includes(draft.family) && !draft.variation;
    const overallSync = draft.viewSync || draft.overallSync || draft.sync;
    const overallStatus = syncStatus(overallSync);
    const selectedStatus = syncStatus(draft.sync);
    const synced = overallStatus === 'synced';
    const selectedSynced = selectedStatus === 'synced';
    const selectedName = selectedView() === 'mobile' ? 'Mobile web' : 'Desktop web';
    const status = state.syncing ? 'Copying live into the working page…' : overallStatus === 'unavailable' ? 'Check unavailable' : synced ? 'Synced' : 'Unsynced';
    const explanation = overallStatus === 'unavailable' ? 'The latest live check could not finish. The saved baseline is preserved; no edit has been recorded.'
      : synced ? `All tracked views in Version ${draft.version} match the recorded live version.`
      : selectedSynced ? `${selectedName} matches live, but Version ${draft.version} remains unsynced until both web views match.`
      : overallSync?.reason === 'live-changed' ? 'The live page changed. Review it before updating this working copy.'
        : draft.variation ? 'This variation has its own versions. Walter can publish it when it is ready.'
          : mainLive ? `Version ${draft.version} has changes ready for Walter to make live.` : 'A live page has not been connected yet.';
    const sourceVersion = draft.history.find(item => item.id === live?.revisionId)?.version;
    const pageLabel = draft.family === 'bc' ? 'Birth chart' : `${names[draft.variant]} · ${names[draft.family]}`;
    container.innerHTML = `<div class="page-pair">
      <section class="page-pair-live"><p class="eyebrow">Live page</p><h2>${esc(pageLabel)}</h2>
        ${mainLive ? `<a href="${esc(safe(mainLive.url))}" target="_blank" rel="noopener">Open live page ↗</a><p class="pair-address">${esc(mainLive.url.replace('https://',''))}</p>` : '<p class="review-muted">No live page has been selected for this draft.</p>'}
        ${livePages.length > 1 ? `<details><summary>Live links by channel</summary><div class="pair-channels">${livePages.map(item => `<a href="${esc(safe(item.url))}" target="_blank" rel="noopener">${esc(item.channel === 'affiliate' ? 'Affiliate · David McEwen' : item.channel === 'paid' ? 'Paid · Facebook' : 'Direct')} ↗</a>`).join('')}</div></details>` : ''}
        ${sourceVersion ? `<p class="pair-source">${synced ? 'Synced working version' : 'Last working baseline'}: Version ${synced ? draft.version : sourceVersion}</p>` : ''}
      </section>
      <section class="page-pair-draft"><p class="eyebrow">Working page <span class="pair-draft-badge">DRAFT</span></p><h2>${esc(draft.label)}</h2>
        <a href="${esc(withView(draft.workingUrl))}" target="_blank" rel="noopener">Working page ↗</a><p class="pair-address">${esc(withView(draft.stableWorkingUrl || draft.workingUrl).replace('https://',''))}</p>
        <p class="pair-source">Saved ${esc(dateTime(draft.updatedAt))} · ${esc(draft.editor.name)}</p>
      </section>
      <div class="pair-publication" aria-live="polite"><strong class="sync-badge ${synced ? 'synced' : 'unsynced'}">${esc(status)}</strong><p>${explanation}</p>${draft.liveCheck ? `<p class="review-muted">${draft.liveCheck.status === 'unavailable' ? 'Live check unavailable. The last recorded state is shown.' : `Live checked ${esc(dateTime(draft.liveCheck.checkedAt))}.`}${live?.synthetic ? ' Results uses a fixed sample profile.' : ''}</p>` : ''}${publication ? `<p>Version ${draft.history.find(item=>item.id===publication.revisionId)?.version} confirmed live by ${esc(publication.editor.name)} · ${esc(dateTime(publication.confirmedAt))}.</p>` : ''}
      ${livePages.length && !synced && !draft.sourceOutdated ? `<details id="pair-confirm"><summary>Confirm this version is live</summary><form id="pair-confirm-form"><p>Use this after Walter publishes Version ${draft.version}. This records the match and does not deploy the page.</p><label>Live channel<select id="pair-live-channel">${livePages.map(item => `<option value="${esc(item.url)}" ${item.id === mainLive.id ? 'selected' : ''}>${esc(item.channel)}</option>`).join('')}</select></label><label class="pair-checkbox"><input id="pair-confirm-check" type="checkbox" required>I checked Version ${draft.version} on that live page and they match.</label><button type="submit">Mark Version ${draft.version} synced</button><p id="pair-confirm-error" role="alert"></p></form></details>` : ''}
      <details id="pair-change-log"><summary>Change log · ${draft.history.filter(item=>!item.setup).length} ${draft.history.filter(item=>!item.setup).length === 1 ? 'version' : 'versions'}</summary>${draft.history.filter(item=>!item.setup).slice().reverse().map(item => releaseHistoryMarkup(item)).join('')}<details><summary>Earlier setup history · ${draft.history.filter(item=>item.setup).length}</summary>${draft.history.filter(item=>item.setup).slice().reverse().map(item => releaseHistoryMarkup(item)).join('')}<p class="review-muted">Earlier design: <a href="${esc(safe(draft.referenceUrl || draft.sourceUrl))}" target="_blank" rel="noopener">${esc(draft.sourceVersion || 'Original design')} ↗</a></p></details></details>
      ${canSync ? `<details><summary>Copy live into the working page</summary><p>This replaces an unchanged working baseline with the current live template. It does not publish your changes.</p><button id="pair-sync-live" type="button" ${!state.canEdit || state.syncing ? 'disabled' : ''}>${state.syncing ? 'Copying live…' : 'Copy current live version'}</button><p id="pair-sync-message" role="status"></p></details>` : ''}</div>
    </div><details class="pair-work"><summary>Work in Linear · ${state.work.length} linked ${state.work.length === 1 ? 'issue' : 'issues'}</summary><div class="pair-work-heading"><h3>Linked work</h3><button type="button" id="pair-link-work">Link a Linear issue</button></div><p class="review-muted">Issue status is a dated record. Open Linear for its latest status. Confirm page publication separately.</p>
      ${state.work.map(item => `<article><a href="${esc(safe(item.issueUrl))}" target="_blank" rel="noopener">${esc(item.issueId)} · ${esc(item.title)} ↗</a><p>${esc(item.status)}${item.assignee ? ` · ${esc(item.assignee)}` : ''}<small>Checked ${esc(dateTime(item.checkedAt))}</small></p>${item.note ? `<p class="review-muted">${esc(item.note)}</p>` : ''}</article>`).join('') || `<p>${esc(state.workError || 'No Linear issue linked to this page yet.')}</p>`}
      <div id="pair-work-form"></div></details>`;
    $('pair-confirm-form')?.addEventListener('submit', confirmPage);
    $('pair-sync-live')?.insertAdjacentHTML('beforebegin', '<label>Release type<select id="pair-sync-release"><option value="minor">Minor: keep the page structure</option><option value="major">Major: page structure changed</option></select></label><label>Change description<input id="pair-sync-description" maxlength="1000" placeholder="Describe changes made on the live page."></label>');
    $('pair-sync-live')?.addEventListener('click', syncLive);
    $('pair-link-work').onclick = showWorkForm;
  }

  function releaseHistoryMarkup(item) {
    const label = item.setup ? `Setup record ${item.archiveNumber}` : `Version ${item.version}`;
    const description = item.changeSummary || (item.sourceEvidence ? 'Copied from verified live content.' : item.kind === 'initialized' ? 'Starting page.' : item.kind === 'section-copy' ? 'Shared section updated.' : 'Saved page change.');
    return `<article class="review-release"><strong>${esc(label)}</strong><p>${esc(description)}</p>${item.sectionId ? `<p>${esc(item.sectionId)}</p>` : ''}<small>${esc(dateTime(item.createdAt))} · ${esc(item.editor.name)}</small><p><a href="${esc(withView(item.workingUrl))}" target="_blank" rel="noopener">Working page ↗</a>${item.screenshot?.status === 'ready' ? ` · <a href="${esc(safe(item.screenshot.imageUrl))}" target="_blank" rel="noopener">Screenshot ↗</a>` : ''}</p></article>`;
  }

  async function syncLive() {
    if (state.syncing) return;
    stashInputs();
    if (pendingScratch()) {
      $('pair-sync-message').textContent = 'Your unsaved change is still here. Save or undo it before updating from live.';
      return;
    }
    const pageKey = state.pageKey, previous = state.draft;
    const releaseType = $('pair-sync-release')?.value || 'minor';
    const changeSummary = $('pair-sync-description')?.value.trim() || undefined;
    state.syncing = true;
    renderPagePair();
    try {
      const response = await request('/api/funnel-review?action=sync-live', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({pageKey, expectedRevision: previous.revision, releaseType, changeSummary}),
      });
      if (state.pageKey !== pageKey) return;
      if (pendingScratch(previous)) {
        state.conflict = conflictFor(activeDraft(response.draft), pendingScratch(previous));
        state.notice = {text:'The live baseline was saved. Your unsaved change is still here. Compare before retrying.', kind:'error'};
      } else {
        rebaseCleanScratch(previous, activeDraft(response.draft));
        state.draft = activeDraft(response.draft);
        state.picked = null;
        state.notice = {text:response.synced ? 'Working draft updated from live. Earlier versions are saved.' : 'Working draft already matches the live template.', kind:'success'};
      }
      document.dispatchEvent(new Event('tracker:working-saved'));
    } catch (error) {
      if (state.pageKey === pageKey) state.notice = {text: `${error.message}${error.result?.unmatched?.length ? ` Sections: ${error.result.unmatched.join(', ')}.` : ''}`, kind:'error'};
    } finally {
      state.syncing = false;
      render();
      if (state.pageKey === pageKey && $('pair-sync-message')) $('pair-sync-message').textContent = state.notice?.text || '';
    }
  }

  async function confirmPage(event) {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button'); button.disabled = true;
    try {
      const result = await request('/api/funnel-review?action=confirm-page-published', {
        method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({
          pageKey:state.pageKey, revisionId:state.draft.revision, liveUrl:$('pair-live-channel').value,
          confirmed:$('pair-confirm-check').checked,
        }),
      });
      state.draft = result.draft; renderPagePair();
      document.dispatchEvent(new Event('tracker:working-saved'));
      renderPagePair();
    } catch (error) { $('pair-confirm-error').textContent = error.message; button.disabled = false; }
  }

  function showWorkForm() {
    const area = $('pair-work-form');
    area.innerHTML = `<form id="pair-linear-form"><label>Linear issue URL<input name="issueUrl" type="url" required placeholder="https://linear.app/zodiacfm/issue/…"></label><label>Issue title<input name="title" required maxlength="200"></label><label>Current status in Linear<input name="status" required maxlength="100"></label><label>Assigned to<input name="assignee" maxlength="120"></label><label>Note (optional)<input name="note" maxlength="2000"></label><label class="pair-checkbox"><input name="allLanders" type="checkbox">Link to all three landers</label><button type="submit">Save Linear link</button><button id="pair-work-cancel" type="button">Cancel</button><p id="pair-work-error" role="alert"></p></form>`;
    $('pair-work-cancel').onclick = () => area.replaceChildren();
    $('pair-linear-form').onsubmit = async event => {
      event.preventDefault(); const form = event.currentTarget, button = form.querySelector('[type=submit]'); button.disabled = true;
      try {
        const values = Object.fromEntries(new FormData(form)), match = values.issueUrl.match(/\/issue\/((?:ZFM|ENG)-\d+)\//i);
        if (!match) throw Error('Use a Zodiac Linear issue link.');
        const payload = {issueId:match[1].toUpperCase(), issueUrl:values.issueUrl, title:values.title, status:values.status,
          assignee:values.assignee || null, note:values.note || null, checkedAt:new Date().toISOString(),
          pageKeys:values.allLanders ? ['draft-lander-g','draft-lander-a','draft-lander-m'] : [state.pageKey]};
        await request('/api/funnel-review?action=link-linear-work', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({payload})});
        state.work = (await request(`/api/funnel-review?action=linear-work&pageKey=${encodeURIComponent(state.pageKey)}`)).entries;
        renderPagePair();
      } catch (error) { $('pair-work-error').textContent = error.message; button.disabled = false; }
    };
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

  function sectionPreview(draft, sectionId) {
    const nodes = draft.editableNodes.filter(item => item.sectionId === sectionId);
    const text = nodes.filter(item => item.type === 'text').map(item => item.value).join('\n');
    const images = nodes.filter(item => item.type === 'image');
    return `<details class="shared-section-preview"><summary>Copy and images · ${images.length} ${images.length === 1 ? 'image' : 'images'}</summary><pre>${esc(text || 'This section has no editable text.')}</pre><div>${images.map(item => {
      let href = ''; try { href = safe(new URL(item.value,draft.contentBaseUrl || draft.sourceUrl).href); } catch {}
      return href ? `<a href="${esc(href)}" target="_blank" rel="noopener"><img loading="lazy" src="${esc(href)}" alt="${esc(item.alt || 'Section image')}"></a>` : '';
    }).join('')}</div></details>`;
  }

  async function showSharedEdit() {
    stashInputs();
    const area = $('review-shared-edit');
    if (pendingScratch()) {
      setNotice('Save or undo your unsaved changes before copying a section.', 'error');
      return;
    }
    const source = state.draft, sourceSectionId = state.selected;
    area.innerHTML = '<p role="status">Loading other working pages…</p>';
    try {
      const response = await request('/api/funnel-review?action=working-pages');
      if (state.pageKey !== source.pageKey || state.selected !== sourceSectionId) return;
      state.pages = response.drafts || [];
      const targets = state.pages.filter(item => item.family === source.family && item.pageKey !== source.pageKey);
      const preferredSection = target => target.workingBindings.find(item => item.sectionId === sourceSectionId)
        || target.workingBindings.find(item => item.sectionId.split('-').slice(1).join('-') === sourceSectionId.split('-').slice(1).join('-'))
        || target.workingBindings[0];
      area.innerHTML = `<section class="review-shared-panel"><div class="review-shared-heading"><h2>Use this section on other ${esc(names[source.family].toLowerCase())} pages</h2><button id="review-shared-close" type="button">Close</button></div><p>From ${esc(source.label)} · ${esc(sourceSectionId)} · ${esc(section(sourceSectionId)?.name || '')}</p><p>This copies the whole saved section, including its copy and images. It replaces category-specific content only on the pages you select. Earlier versions stay in history.</p>${sectionPreview(source,sourceSectionId)}<form id="review-copy-form">${targets.length ? targets.map((target,index) => {
        const selected = preferredSection(target);
        return `<div class="review-copy-target"><label class="pair-checkbox"><input type="checkbox" name="target" value="${index}"><strong>${esc(target.label)}</strong></label><label>Section to replace<select data-copy-target="${index}">${target.workingBindings.map(binding => `<option value="${esc(binding.sectionId)}" ${binding.sectionId === selected.sectionId ? 'selected' : ''}>${esc(binding.sectionId)} · ${esc(section(binding.sectionId)?.name || binding.firstHeading?.text || 'Section')}</option>`).join('')}</select></label><div id="copy-target-preview-${index}">${sectionPreview(target,selected.sectionId)}</div></div>`;
      }).join('') : '<p>No other working pages in this family yet. Open another category or create a variation first.</p>'}<label class="pair-checkbox"><input id="review-copy-accept" type="checkbox" required>I reviewed the selected sections. Replace them with this saved section.</label><button id="review-copy-submit" type="submit" disabled>Choose pages to update</button><p id="review-copy-error" role="alert"></p></form></section>`;
      $('review-shared-close').onclick = () => area.replaceChildren();
      const form = $('review-copy-form');
      form.insertAdjacentHTML('afterbegin', `<label>What changed?<textarea id="review-copy-summary" rows="2" required maxlength="1000">Use ${esc(sourceSectionId)} from ${esc(source.label)}.</textarea></label><label>Release type<select id="review-copy-release"><option value="minor">Minor: keep the page structure</option><option value="major">Major: page structure changed</option></select></label>`);
      const update = () => {
        const count = form.querySelectorAll('input[name=target]:checked').length;
        $('review-copy-submit').textContent = count ? `Copy section to ${count} ${count === 1 ? 'page' : 'pages'}` : 'Choose pages to update';
        $('review-copy-submit').disabled = !count || !$('review-copy-accept').checked;
      };
      form.querySelectorAll('[data-copy-target]').forEach(select => select.onchange = () => {
        const index = Number(select.dataset.copyTarget);
        $(`copy-target-preview-${index}`).innerHTML = sectionPreview(targets[index],select.value);
        $('review-copy-accept').checked = false; update();
      });
      form.querySelectorAll('input[name=target]').forEach(input => input.onchange = () => { $('review-copy-accept').checked = false; update(); });
      $('review-copy-accept').onchange = update;
      form.onsubmit = async event => {
        event.preventDefault();
        const button = $('review-copy-submit');
        button.disabled = true; button.textContent = 'Saving selected pages…';
        const chosen = [...form.querySelectorAll('input[name=target]:checked')].map(input => {
          const index = Number(input.value), target = targets[index];
          return {pageKey:target.pageKey,sectionId:form.querySelector(`[data-copy-target="${index}"]`).value,expectedRevision:target.revision};
        });
        try {
          const result = await request('/api/funnel-review?action=copy-section', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sourcePageKey:source.pageKey,sourceSectionId,sourceRevision:source.revision,targets:chosen,releaseType:$('review-copy-release').value,changeSummary:$('review-copy-summary').value.trim()})});
          area.innerHTML = `<section class="review-shared-panel"><h2>Section copied to ${result.drafts.length} ${result.drafts.length === 1 ? 'page' : 'pages'}.</h2><p>These new versions are Unsynced and ready for Walter. Screenshots are queued automatically.</p>${result.drafts.map(draft => {
            const route = new URL(withView(draft.workingUrl),location.origin);route.hash=`funnel-section-${chosen.find(item=>item.pageKey===draft.pageKey).sectionId}`;
            return `<p><a href="${esc(route.href)}" target="_blank" rel="noopener">${esc(draft.label)} · Unsynced ↗</a></p>`;
          }).join('')}<button id="review-shared-done" type="button">Done</button></section>`;
          $('review-shared-done').onclick = () => area.replaceChildren();
          state.pages = (await request('/api/funnel-review?action=working-pages')).drafts;
          renderBranchBar(); document.dispatchEvent(new Event('tracker:working-saved'));
        } catch(error) { $('review-copy-error').textContent = error.message; button.textContent = 'Copy selected sections'; update(); }
      };
      area.scrollIntoView({behavior:'smooth',block:'start'});
    } catch(error) { area.innerHTML = `<p role="alert">${esc(error.message)}</p>`; }
  }

  function renderPreview(active) {
    const bar = $('review-preview-bar');
    if (!bar) return;
    const view = selectedView();
    bar.innerHTML = `<span>${esc(active?.id || '')}</span><span>${esc(active?.name || '')}</span><span class="review-preview-heading">${view === 'desktop' ? 'Desktop web' : 'Mobile web'} · Version ${esc(state.draft.version)}</span>`;
    const shell = document.querySelector('.review-frame-shell');
    if (shell) shell.dataset.view = view;
    fitPreview();
  }

  function fitPreview() {
    const shell = $('review-frame-shell');
    const frame = $('review-frame');
    if (!shell || !frame) return;
    if (selectedView() !== 'desktop') {
      frame.style.removeProperty('width');
      frame.style.removeProperty('height');
      frame.style.removeProperty('transform');
      shell.style.removeProperty('height');
      shell.style.removeProperty('min-height');
      return;
    }
    const sourceWidth = 1280;
    const sourceHeight = 795;
    const available = Math.max(1, shell.clientWidth);
    const scale = Math.min(1, available / sourceWidth);
    frame.style.width = `${sourceWidth}px`;
    frame.style.height = `${sourceHeight}px`;
    frame.style.transform = `scale(${scale})`;
    shell.style.height = `${Math.round(sourceHeight * scale)}px`;
    shell.style.minHeight = '0';
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
    if (event.kind === 'section-copy') {
      return `<article class="review-version"><strong>Version ${event.version} · Section copied</strong><p>Copied from ${esc(event.after.sourceSectionId)}. Earlier content remains in the previous version.</p><p><a href="${esc(withView(event.workingUrl))}" target="_blank" rel="noopener">Open this working version ↗</a></p><small>${esc(event.editor.name)} · ${esc(dateTime(event.createdAt))}</small></article>`;
    }
    const isImage = event.operationType === 'image';
    const afterImage = isImage ? imageUrl(event.after) : '';
    const actorName = event.editor?.name || 'Verified contributor';
    const actorEmail = event.editor?.email || '';
    const title = isImage ? 'Saved image change' : 'Saved copy change';
    const revisionLink = withView(event.workingUrl);
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
      <div class="review-panel-head"><p class="eyebrow">Edit the working page</p><h2>${esc(active?.id || '')} · ${esc(active?.name || '')}</h2><p>${esc(binding?.firstHeading?.text || '')}</p><button id="review-copy-section" class="review-copy-section" type="button">Copy section to other pages</button></div>
      ${binding?.gaps?.length ? `<details class="review-source-notes review-gap"><summary>Source notes</summary>${binding.gaps.map(item => `<p>${esc(item)}</p>`).join('')}</details>` : ''}
      <form id="review-change-form">
        <div class="review-picker"><strong>${node ? (node.type === 'image' ? 'Selected image' : 'Selected text') : 'Choose text or an image'}</strong><p>${node ? esc(nodeDescription(node)) : (nodes.length ? 'Click a copy line or image in the working page.' : 'Nothing in this section is ready to edit yet.')}</p>${node ? editorMarkup(node) : `<div class="review-node-list">${nodes.map(item => `<button type="button" data-review-pick="${esc(item.editId)}">${esc(nodeDescription(item))}</button>`).join('')}</div>`}</div>
        <div class="review-reference"><label>Apply this change to<select id="review-view-scope"><option value="shared" ${state.viewScope === 'shared' ? 'selected' : ''}>Both web views</option><option value="${esc(selectedView())}" ${state.viewScope === selectedView() ? 'selected' : ''}>This view only (${selectedView() === 'desktop' ? 'Desktop web' : 'Mobile web'})</option></select></label><p class="review-view-scope-help">Previewing ${selectedView() === 'desktop' ? 'Desktop web' : 'Mobile web'}. Both views is the default.</p><label>What changed?<textarea id="review-summary" rows="2" required placeholder="Describe the change for Walter.">${esc(entry?.changeSummary || '')}</textarea></label><label class="review-note">Release type<select id="review-release-type"><option value="minor" ${entry?.releaseType !== 'major' ? 'selected' : ''}>Minor: keep the page structure</option><option value="major" ${entry?.releaseType === 'major' ? 'selected' : ''}>Major: page structure changed</option></select></label><label class="review-note">Design example for Walter (optional)<input id="review-example" type="url" placeholder="https://zodiac-pages.vercel.app/…" value="${esc(entry?.exampleUrl || '')}"></label><label class="review-note">Optional note<textarea id="review-note" rows="2">${esc(entry?.note || '')}</textarea></label></div>
        ${renderConflict()}
        <div class="review-save-area"><p id="review-form-error" class="review-form-error" role="alert"></p><button id="review-save" class="review-save" type="submit">Save draft changes</button><p id="review-status" class="review-status ${esc(state.notice?.kind || '')}">${esc(state.notice?.text || '')}</p></div>
      </form>
      <section class="review-history"><h3>Section changes</h3>${history.length ? history.map(historyMarkup).join('') : '<p class="review-muted">No edits saved for this section yet.</p>'}<details class="review-source-notes"><summary>Original section requirements</summary><p>${esc(active?.scopeNote || '')}</p>${(active?.versions || []).slice().reverse().map(version => `<p><strong>Imported record ${esc(version.number)}</strong> · ${esc(version.summary || '')}</p>`).join('')}</details></section>
      <section class="review-live"><h3>When Walter publishes it</h3><p>Confirm this section’s latest saved change after it appears on the customer page.</p><button id="review-publish" type="button" ${state.canEdit && currentRevisionIsPublishable() ? '' : 'disabled'}>Confirm published</button>${!currentRevisionIsPublishable() ? '<p class="review-muted">Save a change in this section before confirming it.</p>' : ''}<div id="review-published-form" hidden></div>${publications.map(publicationMarkup).join('')}</section>`;
    panel.querySelectorAll('[data-review-pick]').forEach(button => {
      button.addEventListener('click', () => pickNode(button.dataset.reviewPick));
    });
    $('review-change-form')?.addEventListener('submit', event => {
      event.preventDefault();
      save();
    });
    $('review-publish')?.addEventListener('click', () => publish(active));
    $('review-copy-section')?.addEventListener('click', showSharedEdit);
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
    $('review-shared-edit')?.replaceChildren();
    state.selected = sectionId;
    state.picked = null;
    state.viewScope = 'shared';
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
    if (state.picked?.editId !== node.editId) state.viewScope = 'shared';
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

  function wireSafeWorkingRuntime(documentRoot) {
    if (!documentRoot || documentRoot.documentElement.dataset.funnelSafeRuntime === 'true') return;
    documentRoot.documentElement.dataset.funnelSafeRuntime = 'true';
    const frameWindow = documentRoot.defaultView;
    const visible = element => {
      const box = element.getBoundingClientRect();
      return box.top < frameWindow.innerHeight && box.bottom > 0;
    };
    const update = () => {
      const atOffer = [...documentRoot.querySelectorAll('.offer-callout,.offer-inline')].some(visible)
        || [...documentRoot.querySelectorAll('footer,.site-footer')].some(visible);
      const showSticky = frameWindow.scrollY > 120 && !atOffer;
      documentRoot.querySelectorAll('.sticky-cta').forEach(item => item.classList.toggle('is-shown', showSticky));
      documentRoot.querySelectorAll('.header-cta,.site-header').forEach(item => item.classList.toggle('is-condensed', frameWindow.scrollY > 8));
    };
    frameWindow.addEventListener('scroll', update, {passive: true});
    frameWindow.addEventListener('resize', update, {passive: true});
    documentRoot.addEventListener('click', event => {
      const jump = event.target.closest?.('a[data-offer-jump]');
      if (!jump) return;
      event.preventDefault();
      event.stopPropagation();
      const offers = [...documentRoot.querySelectorAll('.offer-callout,.offer-inline')];
      const next = offers.find(item => item.getBoundingClientRect().top > 80) || offers.at(-1);
      next?.scrollIntoView({behavior: 'smooth', block: 'start'});
    }, true);
    documentRoot.addEventListener('submit', event => event.preventDefault(), true);
    update();
  }

  function wireFrame(documentRoot) {
    if (documentRoot.documentElement.dataset.funnelReviewWired === 'true') return;
    documentRoot.documentElement.dataset.funnelReviewWired = 'true';
    documentRoot.addEventListener('click', event => {
      const sectionLink = event.target.closest?.('[data-funnel-working-label]');
      if (sectionLink) {
        event.preventDefault(); event.stopPropagation();
        const href = withView(sectionLink.href);
        if (href) window.open(href, '_blank', 'noopener');
        return;
      }
      const bannerLink = event.target.closest?.('[data-funnel-working-banner] a');
      if (bannerLink) {
        event.preventDefault(); event.stopPropagation();
        const href = safe(bannerLink.href);
        if (href) window.open(href, '_blank', 'noopener');
        return;
      }
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
    const href = withView(url);
    area.hidden = false;
    area.innerHTML = `<strong>The working preview could not open.</strong><p>${esc(message)}</p><button type="button" id="review-frame-retry">Retry preview</button>${href ? `<a href="${esc(href)}" target="_blank" rel="noopener">Open this working version ↗</a>` : ''}`;
    $('review-frame-retry').onclick = () => { const frame = $('review-frame'); delete frame.dataset.reviewUrl; loadFrame(currentRevisionUrl()); };
  }

  function loadFrame(url) {
    const frame = $('review-frame');
    const href = previewEmbedUrl(url);
    if (!frame || !href) return frameError('The private working page link is unavailable.', url);
    if (frame.dataset.loadedUrl === href && state.frameReady) {
      markLabels();
      scrollSelected();
      return;
    }
    if (frame.dataset.reviewUrl === href && frame.dataset.loading === 'true') return;
    const token = ++state.frameToken;
    const expectedDraft = state.draft;
    state.frameReady = false;
    frame.dataset.reviewUrl = href;
    frame.dataset.loading = 'true';
    const message = $('review-frame-message');
    if (message) {
      message.hidden = false;
      message.textContent = 'Loading private working page…';
    }
    frame.onload = () => {
      if (token !== state.frameToken) return;
      try {
        const documentRoot = frame.contentDocument;
        if (!documentRoot || documentRoot.URL === 'about:blank') return;
        const banner = documentRoot.querySelector('[data-funnel-working-banner]');
        if (!banner) throw Error('Company sign-in may have expired. Open this working version to sign in, then retry the preview.');
        if (banner.dataset.funnelWorkingPage !== expectedDraft.pageKey
            || banner.dataset.funnelWorkingRevision !== expectedDraft.revision) {
          throw Error('The preview loaded a different version. Refresh shared records, then retry.');
        }
        const failures = [];
        for (const binding of expectedDraft.workingBindings || []) {
          let owned;
          try {
            const sectionId = window.CSS?.escape
              ? CSS.escape(binding.sectionId)
              : String(binding.sectionId).replace(/[^A-Za-z0-9_-]/g, '\\$&');
            owned = documentRoot.querySelectorAll(`[data-funnel-section-id="${sectionId}"]`);
          } catch {
            failures.push(binding.sectionId);
            continue;
          }
          if (owned.length !== 1 || !elementMatches(owned[0], binding)) {
            failures.push(binding.sectionId);
            continue;
          }
          const actual = firstHeading(owned[0]);
          const expected = binding.firstHeading;
          if ((actual?.tag || null) !== (expected?.tag || null)
              || (actual?.text || null) !== (expected?.text || null)) failures.push(binding.sectionId);
        }
        if (failures.length) throw Error(`The section labels could not be verified for Version ${expectedDraft.version}. Retry the preview. Your saved page is intact.`);
        banner.style.setProperty('display', 'none', 'important');
        banner.setAttribute('aria-hidden', 'true');
        wireSafeWorkingRuntime(documentRoot);
        wireFrame(documentRoot);
        frame.dataset.loadedUrl = href;
        frame.dataset.loading = 'false';
        state.frameReady = true;
        if (message) message.hidden = true;
        markLabels();
        resizeObserver?.disconnect();
        resizeObserver = new ResizeObserver(() => { fitPreview(); markLabels(); });
        resizeObserver.observe(frame);
        const shell = $('review-frame-shell');
        if (shell instanceof Element) resizeObserver.observe(shell);
        state.pendingScroll = true;
        scrollSelected();
      } catch (error) {
        frame.dataset.loading = 'false';
        frameError(error.message, href);
      }
    };
    frame.onerror = () => { frame.dataset.loading = 'false'; frameError('The private working page could not be embedded. Retry or open this version in its own tab.', href); };
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
    $('review-view-scope')?.addEventListener('change', event => { state.viewScope = event.target.value; });
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
    if (!entry.changeSummary.trim()) {
      if (errorArea) errorArea.textContent = 'Describe the change for the page header and change log.';
      return;
    }
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
          view: selectedView(),
          scope: state.viewScope === 'shared' ? 'shared' : selectedView(),
          material: changeMaterial(node, entry, attachmentId),
          changeSummary: entry.changeSummary.trim(),
          releaseType: entry.releaseType,
        }),
      });
      clearScratch(node);
      state.draft = activeDraft(response.draft);
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
          latest: activeDraft(error.result.draft),
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
    const latest = activeDraft(state.conflict.latest);
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
      state.draft = activeDraft(response.draft);
      document.dispatchEvent(new Event('tracker:working-saved'));
      state.notice = {text: 'Published confirmation recorded.', kind: 'success'};
      renderPagePair();
      renderPanel(section(), workingBinding(state.selected), state.draft.editableNodes.filter(item => item.sectionId === state.selected));
    } catch (error) {
      if (errorArea) errorArea.textContent = error.message;
      button.disabled = false;
    }
  }

  function renderCorporate() {
    if (!root) return;
    state.draft = null;
    state.pageKey = '';
    state.layoutKey = '';
    state.frameReady = false;
    resizeObserver?.disconnect();
    root.innerHTML = `<div class="review-topline"><div><p class="eyebrow">Corporate site</p><strong>Your website and its working pages.</strong></div></div>
      <div class="corporate-workspace">
        <section><p class="eyebrow">Live homepage</p><h2>zodiac.fm</h2><p>The live link stays the same. Dated screenshots keep earlier versions available.</p><a class="review-open-page" href="https://zodiac.fm/" target="_blank" rel="noopener">Open corporate site ↗</a><button type="button" id="corporate-history">View screenshots and history</button></section>
        <section><p class="eyebrow">Working pages</p><h2>Add your corporate drafts.</h2><p>No editable corporate draft has been selected yet. Add Vercel pages here to track their screenshots, dates and contributor.</p><button type="button" id="corporate-add-page">Add Vercel page</button></section>
      </div>`;
    $('corporate-history').onclick = () => document.querySelector('[data-mode="pages"]').click();
    $('corporate-add-page').onclick = () => document.dispatchEvent(new Event('tracker:add-page'));
    root.hidden = state.mode !== 'review';
  }

  async function ready(event) {
    stashInputs();
    const detail = event.detail || {};
    const changedPage = detail.family && (detail.family !== state.family || detail.variant !== state.variant);
    if (changedPage) state.pageChoice = '';
    state.user = detail.user || state.user;
    state.family = detail.family || state.family;
    state.variant = detail.variant || state.variant;
    state.data = detail.data || state.data;
    state.canEdit = typeof detail.canEdit === 'boolean' ? detail.canEdit : state.canEdit;
    if (state.family === 'corporate') return renderCorporate();
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
    const requestedView = initialRoute.get('view');
    state.view = requestedView === 'mobile' ? 'mobile' : 'desktop';
    const initialFamily = initialRoute.get('page');
    if (['lander', 'bc', 'results', 'join', 'corporate'].includes(initialFamily)) state.family = initialFamily;
    const initialVariant = initialRoute.get('variant');
    state.variant = variants(state.family).includes(initialVariant) ? initialVariant : variants(state.family)[0];
    const requestedPageKey = initialRoute.get('pageKey');
    if (requestedPageKey === mainDraftKey() || requestedPageKey?.startsWith(`${mainDraftKey()}--variation-`)) state.pageChoice = requestedPageKey;
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
      state.pageChoice = '';
      const route = new URL(location.href); route.searchParams.delete('pageKey'); route.searchParams.set('view', selectedView()); history.replaceState(null,'',route);
      state.selected = null;
      state.layoutKey = '';
      if (state.family === 'corporate') return renderCorporate();
      try {
        await loadBase();
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
