// The 05 portal's same-origin adapter for the app's existing anonymous birth-place routes.
// It only reads the app's search/resolve endpoints; it does not own Maps or write app data.
const { createHash } = require('node:crypto');

const APP_ORIGIN = 'https://app.zodiac.fm';
const LIMITS = Object.freeze({
  search: { count: 45, windowMs: 10 * 60 * 1000 },
  resolve: { count: 20, windowMs: 10 * 60 * 1000 },
});
const buckets = new Map();
const searchCache = new Map();

function send(res, status, value, retryAfter) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (retryAfter) res.setHeader('Retry-After', String(retryAfter));
  res.end(JSON.stringify(value));
}

function first(value) {
  return Array.isArray(value) ? value[0] || '' : typeof value === 'string' ? value.split(',')[0].trim() : '';
}

function sameOrigin(req) {
  const origin = first(req.headers.origin);
  if (!origin) return true;
  try {
    const host = first(req.headers['x-forwarded-host']) || first(req.headers.host);
    const proto = first(req.headers['x-forwarded-proto']);
    const parsed = new URL(origin);
    return parsed.host === host && (!proto || parsed.protocol === `${proto}:`);
  } catch { return false; }
}

function rateLimit(req, action) {
  const address = first(req.headers['x-forwarded-for']) || first(req.headers['x-real-ip']) || req.socket?.remoteAddress || 'unknown';
  const key = `${action}:${createHash('sha256').update(address).digest('hex').slice(0, 20)}`;
  const now = Date.now(), config = LIMITS[action];
  let bucket = buckets.get(key);
  if (!bucket || bucket.until <= now) bucket = { count: 0, until: now + config.windowMs };
  bucket.count++;
  buckets.set(key, bucket);
  if (buckets.size > 2000) {
    for (const [item, value] of buckets) if (value.until <= now) buckets.delete(item);
    while (buckets.size > 2000) buckets.delete(buckets.keys().next().value);
  }
  return bucket.count > config.count ? Math.max(1, Math.ceil((bucket.until - now) / 1000)) : 0;
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return year >= 1900 && parsed.getUTCFullYear() === year && parsed.getUTCMonth() + 1 === month && parsed.getUTCDate() === day && parsed.getTime() <= Date.now();
}

async function readApp(path) {
  const response = await fetch(`${APP_ORIGIN}${path}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  });
  return { response, data: await response.json().catch(() => null) };
}

module.exports = async function handler(req, res) {
  if (!sameOrigin(req)) return send(res, 403, { error: { code: 'origin_not_allowed' } });
  if (req.method !== 'GET') return send(res, 405, { error: { code: 'method_not_allowed' } });
  const action = req.query?.action;
  if (typeof action !== 'string' || !Object.hasOwn(LIMITS, action)) return send(res, 400, { error: { code: 'invalid_action' } });
  const retry = rateLimit(req, action);
  if (retry) return send(res, 429, { error: { code: 'rate_limited' } }, retry);

  const upstream = new URL(`${APP_ORIGIN}/api/mobile/places/${action}`);
  let cacheKey;
  if (action === 'search') {
    const query = req.query?.q;
    if (typeof query !== 'string' || query.trim().length < 3 || query.length > 100) return send(res, 400, { error: { code: 'invalid_place_query' } });
    upstream.searchParams.set('q', query.trim());
    cacheKey = query.trim().toLocaleLowerCase('en-US');
    const cached = searchCache.get(cacheKey);
    if (cached && cached.until > Date.now()) return send(res, 200, cached.value);
  } else {
    const date = req.query?.date, placeId = req.query?.placeId;
    if (!validDate(date) || typeof placeId !== 'string' || !placeId.trim() || placeId.length > 250 || /[\x00-\x1f]/.test(placeId)) return send(res, 400, { error: { code: 'invalid_place_request' } });
    upstream.searchParams.set('date', date);
    upstream.searchParams.set('placeId', placeId.trim());
  }

  try {
    const { response, data } = await readApp(upstream.pathname + upstream.search);
    if (response.status === 429) return send(res, 429, { error: { code: 'rate_limited' } }, Math.max(1, Math.min(600, Number(response.headers.get('retry-after')) || 60)));
    if (!response.ok) return send(res, response.status === 400 || response.status === 404 ? response.status : 502, { error: { code: action === 'search' ? 'places_unavailable' : 'place_resolve_unavailable' } });
    if (action === 'search') {
      if (!Array.isArray(data?.results)) throw new Error('Invalid app search response');
      const value = { results: data.results.filter((item) => typeof item?.description === 'string' && typeof item?.placeId === 'string').slice(0, 6).map((item) => ({ description: item.description.slice(0, 160), placeId: item.placeId.slice(0, 250) })) };
      searchCache.set(cacheKey, { value, until: Date.now() + 90000 });
      if (searchCache.size > 150) for (const [key, item] of searchCache) if (item.until <= Date.now() || searchCache.size > 150) searchCache.delete(key);
      return send(res, 200, value);
    }
    const { latitude, longitude, timezone } = data || {};
    if (![latitude, longitude, timezone].every(Number.isFinite) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || Math.abs(timezone) > 14) throw new Error('Invalid app resolve response');
    return send(res, 200, { latitude, longitude, timezone });
  } catch {
    return send(res, 502, { error: { code: action === 'search' ? 'places_unavailable' : 'place_resolve_unavailable' } });
  }
};
