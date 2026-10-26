const {
  blobStore,
  storageConfigured,
  StoreConflictError,
  StoreUnavailableError,
} = require('../lib/funnel-tracker/blob-store');
const {InvalidMutationError, applyMutation} = require('../lib/funnel-tracker/state');
const {
  authConfigured,
  clearNonceCookie,
  clearSessionCookie,
  configuredGoogleClientId,
  createAgentToken,
  createSession,
  hasAuthorizationHeader,
  issueLoginChallenge,
  nonceCookie,
  readLoginChallenge,
  readAgentToken,
  readSession,
  sessionCookie,
  verifyGoogleCredential,
} = require('../lib/funnel-tracker/session');

const MAX_BODY_BYTES = 64 * 1024;

const ERROR_MESSAGES = Object.freeze({
  access_denied: 'Use a verified zodiac.fm Google account to continue.',
  auth_challenge_required: 'Refresh the tracker and try signing in again.',
  auth_not_configured: 'Company sign-in has not been configured yet.',
  agent_access_denied: 'This agent token is missing, invalid or expired.',
  agent_scope_denied: 'Agent access can read records and add drafts, but cannot perform this action.',
  company_access_required: 'Sign in with your zodiac.fm Google account to view the tracker.',
  expected_revision_required: 'Refresh the shared records before saving.',
  future_live_date: 'The go-live date cannot be in the future.',
  invalid_live_date: 'Enter the date this revision went live.',
  invalid_preview_url: 'Use a complete HTTPS preview URL.',
  invalid_production_url: 'Use the HTTPS customer production URL on zodiac.fm or one of its subdomains.',
  invalid_repository_ref: 'Use a zodiac-fm repository, a full 40-character commit, and an optional repository-relative path.',
  live_confirmation_required: 'Confirm that you checked this exact revision in production.',
  live_note_required: 'Add the production confirmation note.',
  revision_conflict: 'Someone saved a change while you were editing. Refresh and compare before saving again.',
  revision_content_required: 'Enter the complete section requirements.',
  revision_summary_required: 'Describe what changed.',
  same_origin_required: 'Open the tracker page directly before editing.',
  storage_not_configured: 'Shared tracker storage has not been configured yet.',
  tracker_state_invalid: 'The shared tracker data needs repair before another change can be saved.',
  tracker_unavailable: 'The shared service could not confirm the save. Refresh and check the section history before trying again.',
  unknown_section: 'That section is no longer in the shared tracker.',
  unknown_version: 'That revision is no longer available for production confirmation.',
});

function sendJson(res, status, payload, extraHeaders = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  for (const [name, value] of Object.entries(extraHeaders)) res.setHeader(name, value);
  res.end(JSON.stringify(payload));
}

function fail(res, status, code, extra = {}, headers = {}) {
  sendJson(res, status, {
    error: {code, message: ERROR_MESSAGES[code] || 'The request could not be completed.'},
    ...extra,
  }, headers);
}

function firstHeaderValue(value) {
  if (Array.isArray(value)) return value[0] || '';
  return typeof value === 'string' ? value.split(',')[0].trim() : '';
}

function expectedOrigin(req) {
  const host = firstHeaderValue(req.headers['x-forwarded-host']) || firstHeaderValue(req.headers.host);
  if (!host) return null;
  const protocol = firstHeaderValue(req.headers['x-forwarded-proto']) || 'https';
  if (!['http', 'https'].includes(protocol)) return null;
  try {
    return new URL(`${protocol}://${host}`).origin;
  } catch {
    return null;
  }
}

function isSameOrigin(req) {
  const expected = expectedOrigin(req);
  const supplied = firstHeaderValue(req.headers.origin);
  if (!expected || !supplied) return false;
  try {
    return new URL(supplied).origin === expected;
  } catch {
    return false;
  }
}

function queryAction(req) {
  if (typeof req.query?.action === 'string') return req.query.action;
  try {
    return new URL(req.url || '/', expectedOrigin(req) || 'https://invalid.local').searchParams.get('action');
  } catch {
    return null;
  }
}

function parsedBody(req) {
  const length = Number(req.headers['content-length']);
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) return null;
  if (!req.body) return null;
  if (typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    try {
      return Buffer.byteLength(JSON.stringify(req.body), 'utf8') <= MAX_BODY_BYTES ? req.body : null;
    } catch {
      return null;
    }
  }
  try {
    const body = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body);
    if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) return null;
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function requestIdentity(req) {
  if (hasAuthorizationHeader(req)) {
    const agent = readAgentToken(req);
    return agent ? {kind: 'agent', user: agent.user, scope: agent.scope} : null;
  }
  const session = readSession(req);
  return session ? {kind: 'browser', user: session.user} : null;
}

function createHandler({
  store = blobStore,
  verifyCredential = verifyGoogleCredential,
} = {}) {
  async function latestConflict(res) {
    try {
      const current = await store.read();
      return fail(res, 409, 'revision_conflict', current);
    } catch {
      return fail(res, 409, 'revision_conflict');
    }
  }

  function handleConfig(res) {
    const clientId = configuredGoogleClientId();
    const configured = authConfigured();
    const payload = {
      googleClientId: clientId,
      authConfigured: configured,
      storageConfigured: storageConfigured(),
      nonce: null,
    };
    if (!configured) return sendJson(res, 200, payload);
    const challenge = issueLoginChallenge();
    return sendJson(res, 200, {...payload, nonce: challenge.nonce}, {
      'Set-Cookie': nonceCookie(challenge.token),
    });
  }

  async function handleGet(req, res) {
    if (queryAction(req) === 'config') return handleConfig(res);
    if (!authConfigured()) return fail(res, 503, 'auth_not_configured', {setupPending: true});
    const identity = requestIdentity(req);
    if (!identity) {
      return fail(res, 401, hasAuthorizationHeader(req) ? 'agent_access_denied' : 'company_access_required');
    }
    if (!storageConfigured()) {
      return fail(res, 503, 'storage_not_configured', {
        setupPending: true,
        authConfigured: true,
        storageConfigured: false,
        user: identity.user,
      });
    }
    try {
      const current = await store.read();
      return sendJson(res, 200, {
        data: current.data,
        revision: current.revision,
        canEdit: true,
        user: identity.user,
        setupPending: false,
      });
    } catch (error) {
      if (error instanceof StoreConflictError) return latestConflict(res);
      return fail(res, 503, 'tracker_unavailable');
    }
  }

  async function handleSession(req, res, body) {
    if (!authConfigured()) return fail(res, 503, 'auth_not_configured');
    const challenge = readLoginChallenge(req);
    if (!challenge) return fail(res, 401, 'auth_challenge_required');
    let user;
    try {
      user = await verifyCredential(body.credential, challenge.nonce);
    } catch {
      return fail(res, 401, 'access_denied', {}, {'Set-Cookie': clearNonceCookie()});
    }
    const token = createSession(user);
    return sendJson(res, 200, {canEdit: true, user}, {
      'Set-Cookie': [sessionCookie(token), clearNonceCookie()],
    });
  }

  function handleAgentToken(req, res) {
    if (!authConfigured()) return fail(res, 503, 'auth_not_configured');
    const session = readSession(req);
    if (!session) return fail(res, 401, 'company_access_required');
    const issued = createAgentToken(session.user);
    return sendJson(res, 200, issued);
  }

  async function handleMutation(req, res, body, identity) {
    if (!authConfigured()) return fail(res, 503, 'auth_not_configured', {setupPending: true});
    if (!identity) {
      return fail(res, 401, hasAuthorizationHeader(req) ? 'agent_access_denied' : 'company_access_required');
    }
    if (identity.kind === 'agent' && body.action !== 'revision') {
      return fail(res, 403, 'agent_scope_denied');
    }
    if (!storageConfigured()) return fail(res, 503, 'storage_not_configured', {setupPending: true});
    if (typeof body.expectedRevision !== 'string' || !body.expectedRevision) {
      return fail(res, 400, 'expected_revision_required');
    }

    let current;
    try {
      current = await store.read();
    } catch (error) {
      if (error instanceof StoreConflictError) return latestConflict(res);
      return fail(res, 503, 'tracker_unavailable');
    }
    if (body.expectedRevision !== current.revision) return latestConflict(res);

    let changed;
    try {
      changed = applyMutation(current.data, {
        action: body.action,
        sectionId: body.sectionId,
        payload: body.payload,
        editor: identity.user,
      });
    } catch (error) {
      if (error instanceof InvalidMutationError) return fail(res, 400, error.code);
      return fail(res, 500, 'tracker_state_invalid');
    }

    try {
      const stored = await store.write(changed.data, current.revision);
      return sendJson(res, 201, {
        data: stored.data,
        revision: stored.revision,
        canEdit: true,
        user: identity.user,
        event: changed.event,
      });
    } catch (error) {
      if (error instanceof StoreConflictError) return latestConflict(res);
      if (error instanceof StoreUnavailableError) return fail(res, 503, 'tracker_unavailable');
      return fail(res, 503, 'tracker_unavailable');
    }
  }

  return async function handler(req, res) {
    if (req.method === 'GET') return handleGet(req, res);
    if (req.method !== 'POST') return fail(res, 405, 'method_not_allowed', {}, {Allow: 'GET, POST'});

    const body = parsedBody(req);
    if (!body || typeof body.action !== 'string') return fail(res, 400, 'invalid_request');
    const bearerRequest = hasAuthorizationHeader(req);
    if (bearerRequest && ['session', 'logout', 'agent-token', 'live'].includes(body.action)) {
      return fail(res, 403, 'agent_scope_denied');
    }
    if (!bearerRequest && !isSameOrigin(req)) return fail(res, 403, 'same_origin_required');
    if (body.action === 'session') return handleSession(req, res, body);
    if (body.action === 'logout') {
      return sendJson(res, 200, {canEdit: false, user: null}, {
        'Set-Cookie': [clearSessionCookie(), clearNonceCookie()],
      });
    }
    if (body.action === 'agent-token') return handleAgentToken(req, res);
    if (!['revision', 'live'].includes(body.action)) return fail(res, 400, 'invalid_action');
    return handleMutation(req, res, body, requestIdentity(req));
  };
}

const handler = createHandler();

module.exports = handler;
module.exports._test = {
  createHandler,
  expectedOrigin,
  isSameOrigin,
  parsedBody,
  queryAction,
  requestIdentity,
};
