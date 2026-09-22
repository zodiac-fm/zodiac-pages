// Portal birthplace lookup remains closed until an isolated backend is verified.
function send(res, status, code) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify({ error: { code } }));
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

module.exports = async function handler(req, res) {
  if (!sameOrigin(req)) return send(res, 403, 'origin_not_allowed');
  if (req.method !== 'GET') return send(res, 405, 'method_not_allowed');
  if (req.query?.action !== 'search' && req.query?.action !== 'resolve') return send(res, 400, 'invalid_action');
  return send(res, 503, req.query.action === 'search' ? 'places_unavailable' : 'place_resolve_unavailable');
};
