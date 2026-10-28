'use strict';

(() => {
  const embedded = new URL(location.href).searchParams.get('embedded') === '1';
  let shellParent = false;
  let trackerPreview = false;
  try {
    shellParent = window.parent !== window && Boolean(window.parent.document.querySelector('[data-funnel-working-shell]'));
    trackerPreview = window.parent !== window && Boolean(window.parent.document.getElementById('review-frame'));
  } catch {}
  if (window.self !== window.top && (!embedded || !shellParent || trackerPreview)) return;

  const banner = document.querySelector('[data-funnel-working-banner]');
  if (!banner || banner.dataset.workingEditorReady === 'true') return;
  banner.dataset.workingEditorReady = 'true';
  const pageKey = banner.dataset.funnelWorkingPage;
  const renderedRevision = banner.dataset.funnelWorkingRevision;
  let editingRevision = renderedRevision;
  let view = banner.dataset.funnelWorkingView === 'mobile' ? 'mobile' : 'desktop';
  let viewScope = 'shared';
  if (!pageKey || !renderedRevision) return;

  const apiOrigin = location.origin;
  const endpoint = (action, params = {}) => {
    const url = new URL('/api/funnel-review', apiOrigin);
    url.search = new URLSearchParams({action, ...params}).toString();
    return url.href;
  };
  const currentHash = sectionId => sectionId ? `#funnel-section-${encodeURIComponent(sectionId)}` : '';
  let draft = null;
  let picked = null;
  let lastFocus = null;
  let drawer = null;

  function activeDraft(value) {
    if (!value) return value;
    const selected = value.views?.[view];
    return selected ? {...value, ...selected, views: value.views, activeView: view} : value;
  }

  function withView(value) {
    const href = sameOriginUrl(value);
    if (!href) return '';
    const url = new URL(href, apiOrigin);
    url.searchParams.set('view', view);
    return url.href;
  }

  function hostWindow() { return shellParent ? window.top : window; }

  function replaceWorkingHash(hash) {
    const host = hostWindow();
    const page = new URL(host.location.href);
    page.hash = hash;
    host.history.replaceState(null, '', page.href);
  }

  function navigateWorkingPage(value, sectionId) {
    const href = withView(value);
    if (!href) return;
    const next = new URL(href, apiOrigin);
    next.hash = currentHash(sectionId);
    hostWindow().location.assign(next.href);
  }

  function imageSource(value) {
    try {
      const raw = String(value || '');
      const base = raw.startsWith('/api') ? apiOrigin : (draft?.contentBaseUrl || draft?.sourceUrl || apiOrigin);
      return new URL(raw, base).href;
    } catch { return ''; }
  }

  function sameOriginUrl(value) {
    try {
      const url = new URL(value, apiOrigin);
      const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
      if (url.protocol === 'https:' || (local && url.protocol === 'http:' && url.origin === location.origin)) return url.href;
    } catch {}
    return '';
  }

  async function request(action, options = {}, params = {}) {
    const response = await fetch(endpoint(action, params), {credentials: 'same-origin', cache: 'no-store', ...options});
    let body = null;
    try { body = await response.json(); } catch {}
    if (!response.ok) {
      const error = Error(body?.error?.message || 'The working-page service could not complete that request.');
      error.status = response.status;
      error.body = body;
      throw error;
    }
    return body;
  }

  function sectionTarget(sectionId) {
    const escaped = window.CSS?.escape ? CSS.escape(sectionId) : String(sectionId).replace(/[^A-Za-z0-9_-]/g, '\\$&');
    return document.querySelector(`[data-funnel-section-id="${escaped}"]`);
  }

  function wireSafeWorkingRuntime(documentRoot = document) {
    if (documentRoot.documentElement.dataset.funnelSafeRuntime === 'true') return;
    documentRoot.documentElement.dataset.funnelSafeRuntime = 'true';
    const pageWindow = documentRoot.defaultView || window;
    const visible = element => {
      const box = element.getBoundingClientRect();
      return box.top < pageWindow.innerHeight && box.bottom > 0;
    };
    const update = () => {
      const atOffer = [...documentRoot.querySelectorAll('.offer-callout,.offer-inline')].some(visible)
        || [...documentRoot.querySelectorAll('footer,.site-footer')].some(visible);
      const showSticky = pageWindow.scrollY > 120 && !atOffer;
      documentRoot.querySelectorAll('.sticky-cta').forEach(item => item.classList.toggle('is-shown', showSticky));
      documentRoot.querySelectorAll('.header-cta,.site-header').forEach(item => item.classList.toggle('is-condensed', pageWindow.scrollY > 8));
    };
    pageWindow.addEventListener('scroll', update, {passive: true});
    pageWindow.addEventListener('resize', update, {passive: true});
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

  function visitSection(sectionId, behavior = 'smooth') {
    const target = sectionTarget(sectionId);
    if (!target) return;
    replaceWorkingHash(currentHash(sectionId));
    const bannerHeight = Math.max(0, banner.getBoundingClientRect().height);
    target.style.scrollMarginTop = `${Math.ceil(bannerHeight) + 8}px`;
    target.scrollIntoView({behavior, block: 'start'});
  }

  function isCurrent() { return Boolean(draft && draft.revision === editingRevision && (!draft.lifecycle || draft.lifecycle.status === 'active')); }

  function scratch() {
    if (!drawer || !picked) return null;
    return {
      copy: drawer.querySelector('#working-editor-copy')?.value || '',
      summary: drawer.querySelector('#working-editor-summary')?.value || '',
      releaseType: drawer.querySelector('#working-editor-release')?.value || 'minor',
      file: drawer._workingEditorFile || drawer.querySelector('#working-editor-file')?.files?.[0] || null,
    };
  }

  function hasUnsavedWork() {
    const value = scratch();
    if (!value || !picked) return false;
    return value.copy !== String(picked.value || '') || Boolean(value.summary) || value.releaseType !== 'minor' || Boolean(value.file);
  }

  function closeDrawer(force = false) {
    if (!force && hasUnsavedWork() && !window.confirm('Discard this unsaved draft change?')) return false;
    drawer?.remove();
    drawer = null;
    picked = null;
    lastFocus?.focus?.();
    lastFocus = null;
    return true;
  }

  function errorText(error) {
    if (error?.status === 401) return 'Your company session expired. Sign in again in the tracker, then reopen this working page.';
    return error?.message || 'The working-page service is unavailable.';
  }

  function historicalMarkup() {
    if (draft?.lifecycle?.status === 'archived') return '<p class="working-editor-error">This variation is archived and read-only. Open the tracker and restore it to edit it again.</p>';
    const current = withView(draft?.workingUrl);
    return `<p class="working-editor-error">This is an earlier saved version and is read-only.</p>${current ? `<a class="working-editor-current" target="_top" href="${escapeHtml(current + currentHash(picked?.sectionId))}">Open the current working page</a>` : ''}`;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
  }

  function drawerMarkup(node) {
    const readOnly = !isCurrent();
    const isImage = node.type === 'image';
    const sectionTitle = sectionTarget(node.sectionId)?.querySelector('[data-funnel-working-label]')?.textContent || node.sectionId;
    return `<div class="working-editor-backdrop" data-working-editor-close></div><aside class="working-editor-drawer" role="dialog" aria-modal="true" aria-labelledby="working-editor-title">
      <div class="working-editor-head"><div><p>Working draft</p><h2 id="working-editor-title">${escapeHtml(sectionTitle)}</h2></div><button type="button" class="working-editor-close" aria-label="Close editor" data-working-editor-close>×</button></div>
      <p class="working-editor-version">${escapeHtml(draft?.label || '')}</p>
      ${readOnly ? historicalMarkup() : `<form id="working-editor-form" novalidate>
        ${editingRevision !== renderedRevision && !isImage ? `<p class="working-editor-help">Latest saved copy: ${escapeHtml(node.value)}</p>` : ''}
        ${isImage ? `<div class="working-editor-image"><img src="${escapeHtml(imageSource(node.value))}" alt="${escapeHtml(node.alt || 'Current image')}"></div><label>Replacement image<input id="working-editor-file" type="file" accept="image/png,image/jpeg,image/webp" required></label><p class="working-editor-help">PNG, JPEG, or WebP up to 4 MiB.</p>` : `<label>Copy<textarea id="working-editor-copy" rows="10" required>${escapeHtml(node.value)}</textarea></label>`}
        <label>What changed?<textarea id="working-editor-summary" rows="3" required placeholder="Describe this change for Walter and the version history."></textarea></label>
        <label>Apply this change to<select id="working-editor-scope"><option value="shared" ${viewScope === 'shared' ? 'selected' : ''}>Both web views</option><option value="${view}" ${viewScope === view ? 'selected' : ''}>This view only (${view === 'mobile' ? 'Mobile web' : 'Desktop web'})</option></select></label><p class="working-editor-help">Editing ${view === 'mobile' ? 'Mobile web' : 'Desktop web'}. Both views is the default.</p>
        <label>Release type<select id="working-editor-release"><option value="minor">Minor: copy or image change</option><option value="major">Major: page structure changed</option></select></label>
        <p class="working-editor-error" id="working-editor-error" role="alert"></p>
        <button class="working-editor-save" type="submit">Save draft change</button>
      </form>`}
    </aside>`;
  }

  function showDrawer(node, trigger, restore = null, forceClose = false) {
    const bothViews = !draft?.views || ['desktop','mobile'].every(name=>draft.views[name]?.editableNodes.some(item=>item.editId === node.editId && item.sectionId === node.sectionId && item.type === node.type));
    if (!restore && picked?.editId !== node.editId) viewScope = bothViews ? 'shared' : view;
    if (drawer && !closeDrawer(forceClose)) return;
    if (!draft) return;
    picked = node;
    lastFocus = trigger || document.activeElement;
    drawer?.remove();
    drawer = document.createElement('div');
    drawer.className = 'working-editor';
    drawer.innerHTML = drawerMarkup(node);
    document.body.append(drawer);
    if (!bothViews && drawer.querySelector('#working-editor-scope')) {
      viewScope = view;
      drawer.querySelector('#working-editor-scope').value = view;
      drawer.querySelector('#working-editor-scope [value=shared]').disabled = true;
    }
    if (restore) {
      const copy = drawer.querySelector('#working-editor-copy');
      const summary = drawer.querySelector('#working-editor-summary');
      const release = drawer.querySelector('#working-editor-release');
      if (copy) copy.value = restore.copy;
      if (summary) summary.value = restore.summary;
      if (release) release.value = restore.releaseType;
      drawer._workingEditorFile = restore.file || null;
      if (restore.file) drawer.querySelector('.working-editor-help').textContent = `Selected replacement: ${restore.file.name}.`;
    }
    drawer.querySelectorAll('[data-working-editor-close]').forEach(button => button.addEventListener('click', () => closeDrawer()));
    drawer.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); closeDrawer(); return; }
      if (event.key !== 'Tab') return;
      const focusable = [...drawer.querySelectorAll('button:not([disabled]),textarea:not([disabled]),select:not([disabled]),input:not([disabled]),a[href]')];
      if (!focusable.length) return;
      const first = focusable[0]; const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    const form = drawer.querySelector('#working-editor-form');
    if (form) form.addEventListener('submit', save);
    drawer.querySelector('#working-editor-scope')?.addEventListener('change', event => { viewScope = event.target.value; });
    drawer.querySelector('#working-editor-file')?.addEventListener('change', event => {
      drawer._workingEditorFile = event.target.files?.[0] || null;
      const help = drawer.querySelector('.working-editor-help');
      if (help && drawer._workingEditorFile) help.textContent = `Selected replacement: ${drawer._workingEditorFile.name}.`;
    });
    const focus = drawer.querySelector('#working-editor-copy,#working-editor-file,.working-editor-close');
    focus?.focus();
  }

  async function upload(file) {
    if (!file || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size < 1 || file.size > 4 * 1024 * 1024) {
      throw Error('Choose a PNG, JPEG, or WebP image up to 4 MiB.');
    }
    const response = await fetch(endpoint('attachment'), {
      method: 'POST', credentials: 'same-origin', body: file,
      headers: {'Content-Type': file.type, 'X-Funnel-Filename': file.name || 'replacement-image'},
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.attachment?.id) {
      const error = Error(payload?.error?.message || 'The replacement image could not be uploaded.');
      error.status = response.status;
      throw error;
    }
    return payload.attachment.id;
  }

  async function save(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const error = drawer.querySelector('#working-editor-error');
    const button = drawer.querySelector('.working-editor-save');
    const summary = drawer.querySelector('#working-editor-summary').value.trim();
    if (!summary) { error.textContent = 'Describe the change before saving.'; return; }
    const releaseType = drawer.querySelector('#working-editor-release').value;
    let operation;
    button.disabled = true;
    try {
      if (picked.type === 'image') operation = {type: 'image', attachmentId: await upload(drawer._workingEditorFile || drawer.querySelector('#working-editor-file').files?.[0])};
      else operation = {type: 'text', value: drawer.querySelector('#working-editor-copy').value};
      error.textContent = 'Saving draft change…';
      const result = await request('draft-edit', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          pageKey, sectionId: picked.sectionId, editId: picked.editId, expectedRevision: draft.revision,
          operation, view, scope: viewScope === 'shared' ? 'shared' : view,
          material: {note: summary}, changeSummary: summary, releaseType,
        }),
      });
      const next = withView(activeDraft(result?.draft)?.workingUrl);
      if (!next) throw Error('The saved draft did not return a working-page link.');
      navigateWorkingPage(next, picked.sectionId);
    } catch (saveError) {
      button.disabled = false;
      if (saveError.status === 409) {
        const current = sameOriginUrl(saveError.body?.draft?.workingUrl || draft?.workingUrl);
        error.innerHTML = 'A newer draft was saved. Your change is still here. ';
        const reload = document.createElement('button');
        reload.type = 'button'; reload.className = 'working-editor-reload'; reload.textContent = 'Load latest and keep my change';
        reload.addEventListener('click', async () => {
          const saved = scratch();
          const editId = picked?.editId;
          const trigger = lastFocus;
          try {
            const latest = await request('draft', {}, {pageKey, view});
            draft = activeDraft(latest.draft);
            const node = draft.editableNodes?.find(item => item.editId === editId);
            if (!node) throw Error('That editable item changed in the newer version. Copy your change before continuing.');
            editingRevision = draft.revision;
            showDrawer(node, trigger, saved, true);
          } catch (reloadError) { error.textContent = errorText(reloadError); }
        });
        error.append(reload);
      } else error.textContent = errorText(saveError);
    }
  }

  async function loadDraft() {
    try {
      const result = await request('draft', {}, {pageKey, view,check:'defer'});
      draft = activeDraft(result.draft);
      if (!draft?.revision) throw Error('This working page is unavailable.');
    } catch (error) {
      banner.insertAdjacentHTML('beforeend', `<span class="working-editor-notice">${escapeHtml(errorText(error))}</span>`);
      throw error;
    }
  }

  let liveCheckRequest = null;
  function updateShellStatus(status,overallStatus=status) {
    if(!shellParent)return;
    const viewLabel=view==='mobile'?'Mobile web':'Desktop web';
    const fullIdentity=banner.querySelector('.funnel-working-identity').textContent;
    const prefix=`${viewLabel} · `;
    const identity=fullIdentity.startsWith(prefix)?fullIdentity.slice(prefix.length):fullIdentity;
    const title=`${identity} · ${viewLabel} · ${status} · Overall ${overallStatus}`;
    hostWindow().document.title=title;
    hostWindow().document.querySelector('.working-shell__title').textContent=`${title} · ${view==='mobile'?390:1280}px viewport`;
  }
  function updateLiveStatus(value) {
    if(value.revision!==renderedRevision)return;
    const selected=value.views?.[view]||value;
    const overall=value.viewSync||value.sync;
    const label=sync=>sync?.status==='unsynced'?'Unsynced':sync?.checkStatus==='unavailable'?'Check unavailable':'Synced';
    const status=label(selected.sync);
    const overallStatus=overall?.status==='unsynced'?'Unsynced':overall?.checkStatus==='unavailable'||Object.values(overall?.views||{}).some(item=>item.checkStatus==='unavailable')?'Check unavailable':label(overall);
    const revision=value.history.find(item=>item.id===renderedRevision);
    const identity=revision?.identity||`${value.baseLabel} · Version ${value.version}`;
    const viewLabel=view==='mobile'?'Mobile web':'Desktop web';
    banner.querySelector('.funnel-working-identity').textContent=`${viewLabel} · ${identity}`;
    banner.querySelector('.funnel-working-status').textContent=status;
    banner.querySelector('.funnel-working-status').dataset.status=status==='Synced'?'synced':status==='Unsynced'?'unsynced':'unavailable';
    banner.dataset.funnelWorkingVersion=value.version;
    banner.dataset.funnelSyncStatus=selected.sync?.status||'unsynced';
    document.title=`${identity} · ${status}`;
    updateShellStatus(status,overallStatus);
  }

  function checkLive(fresh=false) {
    if(liveCheckRequest)return liveCheckRequest;
    const button=banner.querySelector('.working-editor-check-live');
    if(button)button.disabled=true;
    banner.querySelector('.funnel-working-status').textContent='Checking live…';
    updateShellStatus('Checking live…');
    liveCheckRequest=request('draft',{}, {pageKey,view,...(fresh?{check:'fresh'}:{})}).then(result=>{
      updateLiveStatus(result.draft);
    }).catch(()=>{
      banner.querySelector('.funnel-working-status').textContent='Check unavailable';
      updateShellStatus('Check unavailable');
    }).finally(()=>{liveCheckRequest=null;if(button)button.disabled=false;});
    return liveCheckRequest;
  }

  function selectEditable(event) {
    const element = event.target.closest?.('[data-funnel-edit-id]');
    if (!element || !draft) return;
    const node = draft.editableNodes?.find(item => item.editId === element.getAttribute('data-funnel-edit-id'));
    if (!node) return;
    event.preventDefault();
    event.stopPropagation();
    visitSection(node.sectionId);
    showDrawer(node, element);
  }

  banner.insertAdjacentHTML('beforeend', '<button class="working-editor-open" type="button">Edit sections</button><button class="working-editor-check-live" type="button">Check live</button><span class="working-editor-instruction">Choose a labeled section or highlighted copy/image to edit this draft.</span>');
  banner.querySelector('.working-editor-check-live').addEventListener('click',()=>checkLive(true));
  wireSafeWorkingRuntime();
  banner.querySelectorAll('[data-funnel-working-view-toggle]').forEach(button => {
    const nextView = button.dataset.funnelWorkingViewToggle;
    const selected = nextView === view;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
    button.addEventListener('click', () => {
      if (!['desktop', 'mobile'].includes(nextView) || nextView === view) return;
      if (!closeDrawer()) return;
      const route = new URL(hostWindow().location.href);
      route.searchParams.set('view', nextView);
      hostWindow().location.assign(route.href);
    });
  });
  const open = banner.querySelector('.working-editor-open');
  open.addEventListener('click', () => {
    const first = draft?.editableNodes?.[0];
    if (first) { visitSection(first.sectionId); showDrawer(first, open); }
  });
  document.addEventListener('click', event => {
    const label = event.target.closest?.('[data-funnel-working-label]');
    if (label) {
      const sectionId = label.closest('[data-funnel-section-id]')?.getAttribute('data-funnel-section-id');
      if (sectionId) { event.preventDefault(); visitSection(sectionId); }
      return;
    }
    selectEditable(event);
  }, true);
  document.addEventListener('mouseover', event => event.target.closest?.('[data-funnel-edit-id]')?.classList.add('working-editor-hover'));
  document.addEventListener('mouseout', event => event.target.closest?.('[data-funnel-edit-id]')?.classList.remove('working-editor-hover'));
  document.addEventListener('focusin', event => event.target.closest?.('[data-funnel-edit-id]')?.classList.add('working-editor-hover'));
  document.addEventListener('focusout', event => event.target.closest?.('[data-funnel-edit-id]')?.classList.remove('working-editor-hover'));
  hostWindow().addEventListener('hashchange', () => {
    const match = /^#funnel-section-(.+)$/.exec(hostWindow().location.hash);
    if (match) { try { visitSection(decodeURIComponent(match[1])); } catch {} }
  });

  const initialSection = /^#funnel-section-(.+)$/.exec(hostWindow().location.hash);
  if (initialSection) { try { visitSection(decodeURIComponent(initialSection[1]), 'auto'); } catch {} }

  loadDraft().then(() => {
    if (!isCurrent()) {open.disabled = true;banner.querySelector('.working-editor-check-live').disabled=true;}
    if(isCurrent())checkLive();
  }).catch(() => { open.disabled = true; });
})();
