'use strict';

(function expose(factory) {
  if (typeof module === 'object' && module.exports) module.exports = {createArchiveImageCache: factory};
  if (typeof window === 'undefined') return;
  const cache = factory({origin: location.origin, fetch: window.fetch.bind(window),
    createUrl: blob => URL.createObjectURL(blob), revokeUrl: value => URL.revokeObjectURL(value)});
  window.FunnelArchiveImages = cache;
  document.addEventListener('tracker:ready', event => cache.setUser(event.detail?.user?.email || null));
  document.addEventListener('tracker:signed-out', () => cache.setUser(null));
  document.addEventListener('tracker:cache-clear', () => cache.clear());
  for (const name of ['pointerover', 'focusin']) document.addEventListener(name, event => {
    const href = event.target.closest?.('a[href]')?.href;
    if (href && cache.accepts(href)) cache.warm(href);
  });
})(function createArchiveImageCache({origin, fetch, createUrl, revokeUrl, now = Date.now,
  maxBytes = 32 * 1024 * 1024, maxEntries = 6, ttlMs = 300000} = {}) {
  const entries = new Map(), pending = new Map();
  const maxImageBytes = 24 * 1024 * 1024;
  let user = null, generation = 0, bytes = 0;

  function address(value) {
    try {
      const parsed = new URL(value, origin);
      if (parsed.origin !== origin) return null;
      if (parsed.pathname === '/api/funnel-production'
          && parsed.searchParams.get('targetId') && parsed.searchParams.get('archiveId')) return parsed.href;
      if (parsed.pathname === '/api/funnel-review' && parsed.searchParams.get('action') === 'draft-screenshot'
          && parsed.searchParams.get('pageKey') && parsed.searchParams.get('revision')) return parsed.href;
    } catch {}
    return null;
  }
  function remove(key) {
    const entry = entries.get(key);
    if (!entry) return;
    entries.delete(key); bytes -= entry.bytes; revokeUrl(entry.url);
  }
  function clear() {
    generation += 1;
    for (const key of entries.keys()) remove(key);
    for (const request of pending.values()) request.controller.abort();
    pending.clear();
  }
  function setUser(value) {
    if (value === user) return;
    clear(); user = value || null;
  }
  function load(value) {
    const href = address(value);
    if (!user || !href) return Promise.reject(Error('Company archive access is required.'));
    const entry = entries.get(href);
    if (entry && entry.expiresAt > now()) {
      entries.delete(href); entries.set(href, entry);
      return Promise.resolve(entry.url);
    }
    if (entry) remove(href);
    if (pending.has(href)) return pending.get(href).promise;
    if (pending.size >= 2) return Promise.reject(Error('Archive loading is busy.'));
    const current = generation, controller = new AbortController();
    const request = {controller};
    request.promise = Promise.resolve().then(async () => {
      const response = await fetch(href, {credentials: 'same-origin', cache: 'no-store', signal: controller.signal});
      if (!response.ok || !/^image\/png(?:;|$)/i.test(response.headers.get('content-type') || '')) {
        throw Error('The saved screenshot could not be loaded.');
      }
      if (Number(response.headers.get('content-length')) > maxImageBytes) throw Error('Screenshot size is invalid.');
      const blob = await response.blob();
      if (generation !== current || !user) throw Error('Company access changed.');
      if (blob.size > maxImageBytes || blob.size > maxBytes) throw Error('Screenshot size is invalid.');
      const url = createUrl(blob);
      entries.set(href, {url, bytes: blob.size, expiresAt: now() + ttlMs}); bytes += blob.size;
      while (entries.size > maxEntries || bytes > maxBytes) remove(entries.keys().next().value);
      return url;
    }).finally(() => {if (pending.get(href) === request) pending.delete(href);});
    pending.set(href, request);
    return request.promise;
  }
  function warm(href) {return load(href).catch(() => undefined);}
  async function attach(image, href) {
    const current = generation;
    image.setAttribute('aria-busy', 'true');
    try {
      const source = await load(href);
      if (current !== generation || !user || !image.isConnected) return;
      image.src = source;
    } catch {
      if (current === generation && user && image.isConnected) image.src = href;
    } finally {
      if (current === generation) image.removeAttribute('aria-busy');
    }
  }
  return {accepts: value => Boolean(address(value)), setUser, clear, load, warm, attach};
});
