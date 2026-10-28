'use strict';

const {createHash} = require('node:crypto');

const DEFAULT_TTL_MS = 60 * 1000;
const DEFAULT_MAX_ENTRIES = 64;

function publicationKey(value) {
  return (value.publications || []).map(item => ({
    id:item.id,
    sectionId:item.sectionId,
    revisionId:item.revisionId,
    view:item.view || null,
    liveUrl:item.liveUrl,
    liveContentSha256:item.liveContentSha256 || null,
    liveComparisonVersion:item.liveComparisonVersion || null,
    liveComparisonSha256:item.liveComparisonSha256 || null,
    confirmedAt:item.confirmedAt,
  }));
}

function revisionEvidenceKey(value) {
  return (value.revisions || []).map(item => ({
    id:item.id,
    kind:item.kind,
    scope:item.scope || null,
    view:item.view || null,
    sourceEvidence:item.sourceEvidence || null,
    views:item.views ? Object.fromEntries(['desktop', 'mobile'].map(view => [
      view,
      item.views[view]?.sourceEvidence || null,
    ])) : null,
  }));
}

function liveCheckCacheKey(value, view, identityKind) {
  if (!value || typeof value.pageKey !== 'string' || typeof value.currentRevisionId !== 'string'
      || !['desktop', 'mobile'].includes(view) || !['browser', 'agent'].includes(identityKind)) {
    throw new Error('invalid live-check cache key');
  }
  const payload = JSON.stringify({
    pageKey:value.pageKey,
    currentRevisionId:value.currentRevisionId,
    updatedAt:typeof value.updatedAt === 'string' ? value.updatedAt : null,
    lifecycle:value.lifecycle ? {
      status:value.lifecycle.status,
      events:value.lifecycle.events || [],
    } : null,
    view,
    identityKind,
    revisions:revisionEvidenceKey(value),
    publications:publicationKey(value),
  });
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

function createLiveCheckCache({
  ttlMs = DEFAULT_TTL_MS,
  maxEntries = DEFAULT_MAX_ENTRIES,
  now = () => Date.now(),
} = {}) {
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > DEFAULT_TTL_MS
      || !Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 256
      || typeof now !== 'function') throw new Error('invalid live-check cache configuration');
  const entries = new Map();
  const flights = new Map();
  const generations = new Map();

  function prune(current) {
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= current) entries.delete(key);
    }
    while (entries.size >= maxEntries) entries.delete(entries.keys().next().value);
  }

  function beginLoad(key) {
    const state = generations.get(key) || {latest:0,active:0};
    state.latest += 1;
    state.active += 1;
    generations.set(key, state);
    return state.latest;
  }

  function finishLoad(key) {
    const state = generations.get(key);
    if (!state) return;
    state.active -= 1;
    if (state.active === 0) generations.delete(key);
  }

  async function getOrLoad(key, loader, {force = false} = {}) {
    if (typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key) || typeof loader !== 'function') {
      throw new Error('invalid live-check cache request');
    }
    const current = now();
    if (!force) {
      const cached = entries.get(key);
      if (cached && cached.expiresAt > current) {
        return {value:structuredClone(cached.value),mode:'cached'};
      }
      if (flights.has(key)) {
        return {value:structuredClone(await flights.get(key)),mode:'shared'};
      }
    }
    const generation = beginLoad(key);
    const flight = Promise.resolve().then(loader).then(value => {
      if (generations.get(key)?.latest === generation) {
        const loadedAt = now();
        prune(loadedAt);
        entries.set(key, {value:structuredClone(value),expiresAt:loadedAt + ttlMs});
      }
      return value;
    });
    if (!force) flights.set(key, flight);
    try {
      return {value:structuredClone(await flight),mode:'fresh'};
    } finally {
      if (!force && flights.get(key) === flight) flights.delete(key);
      finishLoad(key);
    }
  }

  return {getOrLoad};
}

const liveCheckCache = createLiveCheckCache();

module.exports = {
  DEFAULT_MAX_ENTRIES,
  DEFAULT_TTL_MS,
  createLiveCheckCache,
  liveCheckCache,
  liveCheckCacheKey,
};
