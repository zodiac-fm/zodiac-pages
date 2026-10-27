'use strict';

(function expose(factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.FunnelSessionCache = api;
})(function createApi() {
  const DEFAULT_MAX_ENTRIES = 32;
  const DEFAULT_MAX_BYTES = 16 * 1024 * 1024;
  const DEFAULT_TTL_MS = 60_000;
  const MAX_INFLIGHT = 36;

  function cacheError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  function validLimit(value, fallback) {
    return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
  }

  function validTtl(value, fallback) {
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  }

  function utf8Bytes(text) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).byteLength;
    if (typeof Buffer !== 'undefined') return Buffer.byteLength(text, 'utf8');
    return unescape(encodeURIComponent(text)).length;
  }

  function calculatedBytes(value) {
    try {
      const serialized = JSON.stringify(value);
      return typeof serialized === 'string' ? utf8Bytes(serialized) : 0;
    } catch {
      return null;
    }
  }

  function createSessionCache(options = {}) {
    const maxEntries = validLimit(options.maxEntries, DEFAULT_MAX_ENTRIES);
    const maxBytes = validLimit(options.maxBytes, DEFAULT_MAX_BYTES);
    const defaultTtlMs = validTtl(options.ttlMs, DEFAULT_TTL_MS);
    const clock = typeof options.now === 'function' ? options.now : Date.now;
    const values = new Map();
    const inflight = new Map();
    let totalBytes = 0;
    let generation = 0;

    function timestamp() {
      const value = clock();
      return Number.isFinite(value) ? value : Date.now();
    }

    function deleteValue(key) {
      const record = values.get(key);
      if (!record) return false;
      values.delete(key);
      totalBytes -= record.bytes;
      return true;
    }

    function evict() {
      while (values.size > maxEntries || totalBytes > maxBytes) {
        const oldest = values.keys().next().value;
        if (oldest === undefined) break;
        deleteValue(oldest);
      }
    }

    function get(key) {
      const record = values.get(key);
      if (!record) return undefined;
      if (record.expiresAt <= timestamp()) {
        deleteValue(key);
        return undefined;
      }
      // Reinserting makes Map order an LRU queue without copying the value.
      values.delete(key);
      values.set(key, record);
      return record.value;
    }

    function set(key, value, settings = {}) {
      const bytes = settings.bytes === undefined ? calculatedBytes(value) : settings.bytes;
      const ttlMs = validTtl(settings.ttlMs, defaultTtlMs);
      if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > maxBytes || maxEntries === 0) {
        return value;
      }
      deleteValue(key);
      values.set(key, {value, bytes, expiresAt: timestamp() + ttlMs});
      totalBytes += bytes;
      evict();
      return value;
    }

    function invalidateFlight(key, error) {
      const record = inflight.get(key);
      if (!record) return false;
      inflight.delete(key);
      record.invalidated = true;
      record.reject(error);
      return true;
    }

    function remove(key) {
      return deleteValue(key);
    }

    function clear() {
      generation += 1;
      values.clear();
      totalBytes = 0;
      for (const key of [...inflight.keys()]) {
        invalidateFlight(key, cacheError('cache_cleared', 'The session cache was cleared.'));
      }
    }

    function load(key, loader, settings = {}) {
      if (typeof loader !== 'function') return Promise.reject(cacheError('invalid_loader', 'A cache loader is required.'));
      if (!settings.force) {
        const cached = get(key);
        if (cached !== undefined) return Promise.resolve(cached);
      }
      const existing = inflight.get(key);
      if (existing) return existing.promise;
      if (inflight.size >= MAX_INFLIGHT) {
        return Promise.reject(cacheError('cache_inflight_limit', 'Too many session cache loads are in progress.'));
      }
      const startedGeneration = generation;
      let resolvePromise;
      let rejectPromise;
      const promise = new Promise((resolve, reject) => { resolvePromise = resolve; rejectPromise = reject; });
      const record = {promise, reject: rejectPromise, invalidated: false};
      inflight.set(key, record);
      Promise.resolve().then(loader).then(value => {
        if (record.invalidated || generation !== startedGeneration) {
          rejectPromise(cacheError('cache_cleared', 'The session cache was cleared.'));
          return;
        }
        set(key, value, settings);
        resolvePromise(value);
      }, error => rejectPromise(error)).finally(() => {
        if (inflight.get(key) === record) inflight.delete(key);
      });
      return promise;
    }

    return {get, set, delete: remove, clear, load};
  }

  return {createSessionCache};
});
