'use strict';

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 32;
const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_ENTRY_BYTES = 24 * 1024 * 1024;
const DEFAULT_MAX_IN_FLIGHT = 8;

function createImmutableScreenshotCache({
  ttlMs = DEFAULT_TTL_MS,
  maxEntries = DEFAULT_MAX_ENTRIES,
  maxBytes = DEFAULT_MAX_BYTES,
  maxEntryBytes = DEFAULT_MAX_ENTRY_BYTES,
  maxInFlight = DEFAULT_MAX_IN_FLIGHT,
  now = () => Date.now(),
} = {}) {
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > DEFAULT_TTL_MS
      || !Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 128
      || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > DEFAULT_MAX_BYTES
      || !Number.isSafeInteger(maxEntryBytes) || maxEntryBytes < 1
      || maxEntryBytes > DEFAULT_MAX_ENTRY_BYTES || maxEntryBytes > maxBytes
      || !Number.isSafeInteger(maxInFlight) || maxInFlight < 1 || maxInFlight > 32
      || typeof now !== 'function') throw new Error('invalid screenshot cache configuration');

  const entries = new Map();
  const flights = new Map();
  let totalBytes = 0;

  function remove(key) {
    const entry = entries.get(key);
    if (!entry) return;
    totalBytes -= entry.value.length;
    entries.delete(key);
  }

  function prune(current) {
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= current) remove(key);
    }
  }

  function retain(key, value, current) {
    if (value.length > maxEntryBytes) return;
    prune(current);
    remove(key);
    while (entries.size >= maxEntries || totalBytes + value.length > maxBytes) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      remove(oldest);
    }
    const immutable = Buffer.from(value);
    entries.set(key, {value:immutable, expiresAt:current + ttlMs});
    totalBytes += immutable.length;
  }

  async function getOrLoad(key, loader) {
    if (typeof key !== 'string' || key.length < 1 || key.length > 512
        || typeof loader !== 'function') throw new Error('invalid screenshot cache request');
    const current = now();
    prune(current);
    const cached = entries.get(key);
    if (cached) {
      entries.delete(key);
      entries.set(key, cached);
      return cached.value;
    }
    if (flights.has(key)) return flights.get(key);
    if (flights.size >= maxInFlight) {
      throw Object.assign(new Error('screenshot cache is busy'), {code:'screenshot_cache_busy'});
    }
    const flight = Promise.resolve().then(loader).then(value => {
      if (!Buffer.isBuffer(value) || value.length < 1 || value.length > maxEntryBytes) {
        throw new Error('invalid screenshot cache value');
      }
      retain(key, value, now());
      return entries.get(key)?.value || value;
    });
    flights.set(key, flight);
    try {
      return await flight;
    } finally {
      if (flights.get(key) === flight) flights.delete(key);
    }
  }

  return {getOrLoad};
}

const immutableScreenshotCache = createImmutableScreenshotCache();

module.exports = {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_ENTRIES,
  DEFAULT_MAX_ENTRY_BYTES,
  DEFAULT_MAX_IN_FLIGHT,
  DEFAULT_TTL_MS,
  createImmutableScreenshotCache,
  immutableScreenshotCache,
};
