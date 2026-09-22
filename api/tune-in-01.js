const { createHash } = require('node:crypto');

// Prototype calculation and place lookup remain closed until an isolated service is verified.
// Audio signing is restricted to the independently verified development project.
const BIRTH_FREQUENCIES_URL = null;
const GOOGLE_GEOCODING_URL = null;
const GOOGLE_TIMEZONE_URL = null;
const IMMERSIONS_BUCKET = 'immersions';
const SIGNED_AUDIO_TTL_SECONDS = 15 * 60;
const DEVELOPMENT_AUDIO_ORIGIN = 'https://gnbfwqbgtehipjqqhjfn.supabase.co';

const FREE_TRACK_FOLDERS = Object.freeze({
  'quiet-success': 'Quiet-Success',
  'kindred-spirits': 'Kindred-Spirits',
  'elysian-surge': 'Elysian-Sky',
});

const RATE_LIMITS = Object.freeze({
  calculate: { limit: 10, windowMs: 10 * 60 * 1000 },
  places: { limit: 20, windowMs: 60 * 1000 },
  audio: { limit: 60, windowMs: 60 * 1000 },
});

// This is a best-effort per-instance guard. The deployment should also use a
// platform rate limit because serverless instances do not share memory.
const rateBuckets = new Map();

function sendJson(res, status, payload, extraHeaders = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  for (const [name, value] of Object.entries(extraHeaders)) {
    res.setHeader(name, value);
  }
  res.end(JSON.stringify(payload));
}

function fail(res, status, code, extraHeaders) {
  sendJson(res, status, { error: { code } }, extraHeaders);
}

function firstHeaderValue(value) {
  if (Array.isArray(value)) return value[0] || '';
  return typeof value === 'string' ? value.split(',')[0].trim() : '';
}

function isSameOrigin(req) {
  const origin = firstHeaderValue(req.headers.origin);
  if (!origin) return true;

  const host = firstHeaderValue(req.headers['x-forwarded-host']) || firstHeaderValue(req.headers.host);
  if (!host) return false;

  try {
    const parsed = new URL(origin);
    const forwardedProto = firstHeaderValue(req.headers['x-forwarded-proto']);
    const expectedProtocol = forwardedProto ? `${forwardedProto}:` : parsed.protocol;
    return parsed.host === host && parsed.protocol === expectedProtocol;
  } catch {
    return false;
  }
}

function clientKey(req, action) {
  const address =
    firstHeaderValue(req.headers['x-forwarded-for']) ||
    firstHeaderValue(req.headers['x-real-ip']) ||
    'unknown';
  const digest = createHash('sha256').update(address).digest('hex').slice(0, 20);
  return `${action}:${digest}`;
}

function rateLimit(req, action) {
  const config = RATE_LIMITS[action];
  const now = Date.now();
  const key = clientKey(req, action);
  let bucket = rateBuckets.get(key);

  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + config.windowMs };
  }

  bucket.count += 1;
  rateBuckets.set(key, bucket);

  if (rateBuckets.size > 5000) {
    for (const [storedKey, storedBucket] of rateBuckets) {
      if (now >= storedBucket.resetAt) rateBuckets.delete(storedKey);
    }
  }

  if (bucket.count <= config.limit) return null;
  return Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
}

function finiteNumber(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function integerInRange(value, min, max) {
  const number = finiteNumber(value);
  return number !== null && Number.isInteger(number) && number >= min && number <= max
    ? number
    : null;
}

function validCalendarDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getTime() <= Date.now()
  );
}

function parseBirthPayload(body) {
  const currentYear = new Date().getUTCFullYear();
  const day = integerInRange(body.day, 1, 31);
  const month = integerInRange(body.month, 1, 12);
  const year = integerInRange(body.year, 1900, currentYear);
  const hour = integerInRange(body.hour, 0, 23);
  const min = integerInRange(body.min, 0, 59);
  const lat = finiteNumber(body.lat);
  const lon = finiteNumber(body.lon);
  const tzone = finiteNumber(body.tzone);

  if (
    day === null ||
    month === null ||
    year === null ||
    hour === null ||
    min === null ||
    lat === null ||
    lat < -90 ||
    lat > 90 ||
    lon === null ||
    lon < -180 ||
    lon > 180 ||
    tzone === null ||
    tzone < -14 ||
    tzone > 14 ||
    !validCalendarDate(year, month, day)
  ) {
    return null;
  }

  return { day, month, year, hour, min, lat, lon, tzone };
}

function normalizedJsonBody(req) {
  if (!req.body) return null;
  if (typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;

  try {
    const text = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body);
    if (Buffer.byteLength(text, 'utf8') > 4096) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeFrequencies(data) {
  const source = data && data.frequencies;
  if (!source || typeof source !== 'object') return null;

  const frequencies = {};
  for (const key of ['core', 'love', 'vitality', 'abundance']) {
    const value = finiteNumber(source[key]);
    if (value === null) return null;
    frequencies[key] = Math.round(value);
  }
  return frequencies;
}

async function calculate(req, res) {
  const contentLength = finiteNumber(req.headers['content-length']);
  if (contentLength !== null && contentLength > 4096) {
    return fail(res, 413, 'request_too_large');
  }

  const body = normalizedJsonBody(req);
  if (!body || body.action !== 'calculate') {
    return fail(res, 400, 'invalid_request');
  }

  const birth = parseBirthPayload(body);
  if (!birth) return fail(res, 400, 'invalid_birth_details');

  try {
    const upstream = await fetchWithTimeout(
      BIRTH_FREQUENCIES_URL,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(birth),
      },
      12000,
    );

    if (!upstream.ok) return fail(res, 502, 'calculation_unavailable');
    const frequencies = normalizeFrequencies(await upstream.json());
    if (!frequencies) return fail(res, 502, 'calculation_unavailable');
    return sendJson(res, 200, { frequencies });
  } catch {
    return fail(res, 502, 'calculation_unavailable');
  }
}

function safeText(value, maxLength = 100) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

async function places(req, res) {
  const query = safeText((req.query || {}).q, 100);
  if (query.length < 2) return fail(res, 400, 'invalid_place_query');

  const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) return fail(res, 503, 'places_unavailable');

  const url = new URL(GOOGLE_GEOCODING_URL);
  url.searchParams.set('address', query);
  url.searchParams.set('language', 'en');
  url.searchParams.set('key', apiKey);

  try {
    const upstream = await fetchWithTimeout(url, {}, 8000);
    if (!upstream.ok) return fail(res, 502, 'places_unavailable');
    const data = await upstream.json();
    if (data.status === 'ZERO_RESULTS') return sendJson(res, 200, []);
    if (data.status !== 'OK' || !Array.isArray(data.results)) {
      return fail(res, 502, 'places_unavailable');
    }

    const clean = (
      await Promise.all(
        data.results.slice(0, 6).map(async (place) => {
          const latitude = finiteNumber(place.geometry?.location?.lat);
          const longitude = finiteNumber(place.geometry?.location?.lng);
          if (latitude === null || longitude === null) return null;

          const components = Array.isArray(place.address_components) ? place.address_components : [];
          const component = (...types) => {
            const match = components.find((item) =>
              types.some((type) => Array.isArray(item.types) && item.types.includes(type)),
            );
            return safeText(match?.long_name);
          };

          const timezoneUrl = new URL(GOOGLE_TIMEZONE_URL);
          timezoneUrl.searchParams.set('location', `${latitude},${longitude}`);
          timezoneUrl.searchParams.set('timestamp', String(Math.floor(Date.now() / 1000)));
          timezoneUrl.searchParams.set('key', apiKey);
          const timezoneResponse = await fetchWithTimeout(timezoneUrl, {}, 6000);
          if (!timezoneResponse.ok) return null;
          const timezoneData = await timezoneResponse.json();
          if (timezoneData.status !== 'OK') return null;

          return {
            name:
              component('locality', 'postal_town', 'sublocality', 'administrative_area_level_2') ||
              safeText(place.formatted_address).split(',')[0],
            country: component('country'),
            admin1: component('administrative_area_level_1'),
            latitude,
            longitude,
            timezone: safeText(timezoneData.timeZoneId),
          };
        }),
      )
    ).filter(
      (place) => place && place.name && place.country && place.timezone,
    );
    return sendJson(res, 200, clean);
  } catch {
    return fail(res, 502, 'places_unavailable');
  }
}

function audioConfig() {
  const rawUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!rawUrl || !secretKey) return null;

  try {
    const parsed = new URL(rawUrl);
    if (rawUrl !== DEVELOPMENT_AUDIO_ORIGIN && rawUrl !== `${DEVELOPMENT_AUDIO_ORIGIN}/`) return null;
    if (parsed.origin !== DEVELOPMENT_AUDIO_ORIGIN || parsed.username || parsed.password || parsed.search || parsed.hash) return null;
    return { baseUrl: parsed.origin, secretKey };
  } catch {
    return null;
  }
}

function signedUrlFromResponse(baseUrl, expectedPath, data) {
  const value = data && (data.signedURL || data.signedUrl);
  if (typeof value !== 'string' || !value) return null;
  const candidate = value.startsWith('/object/') ? `${baseUrl}/storage/v1${value}` : value;
  try {
    const parsed = new URL(candidate, baseUrl);
    if (parsed.origin !== baseUrl || parsed.pathname !== expectedPath || parsed.username || parsed.password || !parsed.searchParams.has('token')) return null;
    return parsed.href;
  } catch { return null; }
}

async function audio(req, res) {
  const query = req.query || {};
  const track = safeText(query.track, 40);
  const folder = FREE_TRACK_FOLDERS[track];
  const rawHz = finiteNumber(query.hz);
  if (!folder || rawHz === null) return fail(res, 400, 'invalid_audio_request');

  const hz = Math.max(250, Math.min(950, Math.round(rawHz)));
  const config = audioConfig();
  if (!config) return fail(res, 503, 'audio_signing_unavailable');

  const objectPath = `${folder}/${folder}--${hz}Hz.mp3`;
  const encodedPath = objectPath.split('/').map(encodeURIComponent).join('/');
  const signingPath = `/storage/v1/object/sign/${IMMERSIONS_BUCKET}/${encodedPath}`;
  const signingUrl = `${config.baseUrl}${signingPath}`;

  try {
    const upstream = await fetchWithTimeout(
      signingUrl,
      {
        method: 'POST',
        headers: {
          apikey: config.secretKey,
          Authorization: `Bearer ${config.secretKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ expiresIn: SIGNED_AUDIO_TTL_SECONDS }),
      },
      8000,
    );

    if (!upstream.ok) return fail(res, 502, 'audio_unavailable');
    const url = signedUrlFromResponse(config.baseUrl, signingPath, await upstream.json());
    if (!url) return fail(res, 502, 'audio_unavailable');
    return sendJson(res, 200, { url, expiresIn: SIGNED_AUDIO_TTL_SECONDS });
  } catch {
    return fail(res, 502, 'audio_unavailable');
  }
}

module.exports = async function handler(req, res) {
  if (!isSameOrigin(req)) return fail(res, 403, 'origin_not_allowed');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Allow', 'GET, POST, OPTIONS');
    res.setHeader('Cache-Control', 'no-store');
    return res.end();
  }

  const action = req.method === 'GET' ? safeText((req.query || {}).action, 20) : 'calculate';
  if (!RATE_LIMITS[action]) return fail(res, 400, 'invalid_action');

  if (action === 'calculate' || action === 'places') {
    return fail(res, 503, action === 'calculate' ? 'calculation_unavailable' : 'places_unavailable');
  }

  const retryAfter = rateLimit(req, action);
  if (retryAfter !== null) {
    return fail(res, 429, 'rate_limited', { 'Retry-After': String(retryAfter) });
  }

  if (req.method === 'POST' && action === 'calculate') return calculate(req, res);
  if (req.method === 'GET' && action === 'places') return places(req, res);
  if (req.method === 'GET' && action === 'audio') return audio(req, res);

  return fail(res, 405, 'method_not_allowed', { Allow: 'GET, POST, OPTIONS' });
};
