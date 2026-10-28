'use strict';

const {createHash} = require('node:crypto');
const {authConfigured, hasAuthorizationHeader, readAgentToken, readSession} = require('../lib/funnel-tracker/session');
const {TARGETS} = require('../lib/funnel-tracker/production-catalog');
const {
  InvalidProductionRequestError,
  checkTarget,
  closeRendererWithin,
  customTargets,
  registerDraftTarget,
  requestOidcTokenProvider,
} = require('../lib/funnel-tracker/production-monitor');
const {createProductionRenderer} = require('../lib/funnel-tracker/production-renderer');
const {
  ProductionStoreConflictError,
  MAX_IMAGE_BYTES,
  productionStorageConfigured,
  productionStore,
} = require('../lib/funnel-tracker/production-store');
const {immutableScreenshotCache} = require('../lib/funnel-tracker/screenshot-cache');

const MAX_BODY_BYTES = 16 * 1024;

const MESSAGES = Object.freeze({
  auth_not_configured: 'Company sign-in has not been configured yet.',
  company_access_required: 'Sign in with your zodiac.fm Google account to view production history.',
  agent_access_denied: 'This agent token is missing, invalid or expired.',
  agent_scope_denied: 'Agent access can read production status but cannot run checks or open archived images.',
  storage_not_configured: 'Production history storage has not been configured yet.',
  production_unavailable: 'Production history is temporarily unavailable.',
  invalid_request: 'The production request is invalid.',
  invalid_target: 'That production page is not registered.',
  invalid_registration: 'Use a name, family, variant and an allowed zodiac-pages.vercel.app URL.',
  duplicate_draft: 'That draft URL is already registered.',
  same_origin_required: 'Open the tracker page directly before changing production monitoring.',
  archive_not_found: 'That archived screenshot is not available.',
  method_not_allowed: 'That request method is not supported.',
});

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cache-Control', 'private, no-store');
}

function sendJson(res, status, payload, headers = {}) {
  res.statusCode = status;
  setSecurityHeaders(res);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
  res.end(JSON.stringify(payload));
}

function fail(res, status, code, extra = {}, headers = {}) {
  return sendJson(res, status, {
    error: {code, message: MESSAGES[code] || 'The request could not be completed.'},
    ...extra,
  }, headers);
}

function firstHeader(value) {
  if (Array.isArray(value)) return value[0] || '';
  return typeof value === 'string' ? value.split(',')[0].trim() : '';
}

function expectedOrigin(req) {
  const host = firstHeader(req.headers['x-forwarded-host']) || firstHeader(req.headers.host);
  const protocol = firstHeader(req.headers['x-forwarded-proto']) || 'https';
  if (!host || !['http', 'https'].includes(protocol)) return null;
  try {
    return new URL(`${protocol}://${host}`).origin;
  } catch {
    return null;
  }
}

function isSameOrigin(req) {
  const expected = expectedOrigin(req);
  const supplied = firstHeader(req.headers.origin);
  if (!expected || !supplied) return false;
  try {
    return new URL(supplied).origin === expected;
  } catch {
    return false;
  }
}

function query(req) {
  try {
    return new URL(req.url || '/', expectedOrigin(req) || 'https://invalid.local').searchParams;
  } catch {
    return new URLSearchParams();
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
    const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body);
    return Buffer.byteLength(raw, 'utf8') <= MAX_BODY_BYTES ? JSON.parse(raw) : null;
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

function publicComparisonDetails(details, includeResources = true) {
  if (!details) return null;
  return {
    version: details.version,
    mainHtmlSha256: details.mainHtmlSha256,
    normalizedDomSha256: details.normalizedDomSha256,
    inlineCssSha256: details.inlineCssSha256,
    resourceSetSha256: details.resourceSetSha256,
    resourceCount: details.resources.length,
    ...(includeResources ? {resources: details.resources.map(resource => ({...resource}))} : {}),
  };
}

function publicChangeSummary(summary) {
  if (!summary) return null;
  if (summary.diagnosticBaseline) return {diagnosticBaseline: true};
  return {
    ...summary,
    resourcesAdded: summary.resourcesAdded.map(resource => ({...resource})),
    resourcesRemoved: summary.resourcesRemoved.map(resource => ({...resource})),
    resourcesChanged: summary.resourcesChanged.map(resource => ({...resource})),
  };
}

function publicArchive(archive) {
  return {
    id: archive.id,
    targetId: archive.targetId,
    kind: archive.kind,
    stage: archive.stage,
    createdAt: archive.createdAt,
    sourceUrl: archive.sourceUrl,
    sourceCommit: archive.sourceCommit,
    sourceResponseAt: archive.sourceResponseAt,
    sourceFingerprint: archive.sourceFingerprint,
    renderFingerprint: archive.renderFingerprint,
    comparisonVersion: archive.comparisonVersion || null,
    comparisonBaseline: archive.comparisonBaseline === true,
    comparisonDetails: publicComparisonDetails(archive.comparisonDetails, false),
    changeSummary: publicChangeSummary(archive.changeSummary),
    sectionBindings: archive.sectionBindings || null,
    imageSha256: archive.imageSha256,
    width: archive.width,
    height: archive.height,
    imageUrl: `/api/funnel-production?targetId=${encodeURIComponent(archive.targetId)}&archiveId=${encodeURIComponent(archive.id)}`,
  };
}

function publicTarget(target, state) {
  return {
    ...target,
    status: state?.status || 'never_checked',
    lastCheckedAt: state?.lastCheckedAt || null,
    lastChangedAt: state?.lastChangedAt || null,
    lastResponseAt: state?.lastResponseAt || null,
    currentArchiveId: state?.currentArchiveId || null,
    sourceCommit: state?.sourceCommit || null,
    sourceFingerprint: state?.sourceFingerprint || null,
    renderFingerprint: state?.renderFingerprint || null,
    comparisonVersion: state?.comparisonVersion || null,
    comparisonDetails: publicComparisonDetails(state?.comparisonDetails),
    sectionBindings: state?.sectionBindings || null,
    archiveCount: state?.archives?.length || 0,
    archives: (state?.archives || []).map(publicArchive).reverse(),
    error: state?.error || null,
  };
}

function manifestPayload(manifest) {
  const allTargets = [...TARGETS, ...customTargets(manifest)];
  const targets = allTargets.map(target => publicTarget(target, manifest.targets[target.id]));
  const counts = {
    total: targets.length,
    neverChecked: 0,
    baseline: 0,
    current: 0,
    changed: 0,
    needsConnection: 0,
    errors: 0,
  };
  for (const target of targets) {
    if (target.status === 'never_checked') counts.neverChecked += 1;
    else if (target.status === 'needs_connection') counts.needsConnection += 1;
    else if (target.status === 'error') counts.errors += 1;
    else counts[target.status] += 1;
  }
  return {
    targets,
    status: {
      storageConfigured: true,
      updatedAt: manifest.updatedAt,
      ...counts,
    },
  };
}

function findTarget(manifest, targetId) {
  return [...TARGETS, ...customTargets(manifest)].find(target => target.id === targetId) || null;
}

function sendArchive(res, image) {
  res.statusCode = 200;
  setSecurityHeaders(res);
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('Content-Length', String(image.length));
  return res.end(image);
}

async function readArchiveImage(result, expectedSha256) {
  if (!result?.stream || (Number.isSafeInteger(result.blob?.size)
      && (result.blob.size < 8 || result.blob.size > MAX_IMAGE_BYTES))) {
    throw new Error('invalid production archive image');
  }
  const reader = result.stream.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      length += chunk.length;
      if (length > MAX_IMAGE_BYTES) throw new Error('production archive image is too large');
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  const image = Buffer.concat(chunks, length);
  if (image.length < 8
      || !image.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
      || createHash('sha256').update(image).digest('hex') !== expectedSha256) {
    throw new Error('production archive image integrity check failed');
  }
  return image;
}

function createHandler({
  store = productionStore,
  rendererFactory = createProductionRenderer,
  screenshotCache = immutableScreenshotCache,
} = {}) {
  async function handleManifest(req, res, identity) {
    try {
      const current = await store.read();
      return sendJson(res, 200, {...manifestPayload(current.data), user: identity.user});
    } catch {
      return fail(res, 503, 'production_unavailable');
    }
  }

  async function handleImage(req, res, identity, targetId, archiveId) {
    if (!identity || identity.kind !== 'browser' || hasAuthorizationHeader(req)) {
      return fail(res, 403, hasAuthorizationHeader(req) ? 'agent_scope_denied' : 'company_access_required');
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,179}$/.test(targetId)
        || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,179}$/.test(archiveId)) {
      return fail(res, 404, 'archive_not_found');
    }
    try {
      const image = await screenshotCache.getOrLoad(
        `production:${targetId}:${archiveId}`,
        async () => {
          const current = await store.read();
          const state = current.data.targets[targetId];
          const archive = state?.archives.find(item => item.id === archiveId);
          if (!archive) throw Object.assign(new Error('archive not found'), {
            code:'archive_not_found',
          });
          const result = await store.readImage(archive.blobPath);
          if (!result) throw Object.assign(new Error('archive not found'), {
            code:'archive_not_found',
          });
          return readArchiveImage(result, archive.imageSha256);
        },
      );
      return sendArchive(res, image);
    } catch (error) {
      if (error?.code === 'archive_not_found') return fail(res, 404, 'archive_not_found');
      return fail(res, 503, 'production_unavailable');
    }
  }

  async function handleCheck(req, res, targetId) {
    let current;
    try {
      current = await store.read();
    } catch {
      return fail(res, 503, 'production_unavailable');
    }
    const target = findTarget(current.data, targetId);
    if (!target) return fail(res, 404, 'invalid_target');
    const renderer = rendererFactory();
    try {
      const result = await checkTarget(target, {
        store,
        renderer,
        tokenProvider: requestOidcTokenProvider(req),
      });
      let latest;
      try {
        latest = await store.read();
      } catch {
        return fail(res, 503, 'production_unavailable');
      }
      return sendJson(res, 200, {
        result: {
          targetId: result.targetId,
          status: result.status,
          changed: result.changed,
          archiveId: result.archiveId,
          error: result.error || null,
        },
        target: publicTarget(target, latest.data.targets[target.id]),
      });
    } finally {
      await closeRendererWithin(renderer);
    }
  }

  async function handleRegister(res, body, identity) {
    try {
      const target = await registerDraftTarget({payload: body.payload, editor: identity.user, store});
      return sendJson(res, 201, {target: publicTarget(target, null)});
    } catch (error) {
      if (error instanceof InvalidProductionRequestError) {
        return fail(res, error.code === 'duplicate_draft' ? 409 : 400, error.code);
      }
      if (error instanceof ProductionStoreConflictError) return fail(res, 409, 'production_unavailable');
      return fail(res, 503, 'production_unavailable');
    }
  }

  return async function handler(req, res) {
    if (!authConfigured()) return fail(res, 503, 'auth_not_configured', {setupPending: true});
    const identity = requestIdentity(req);
    if (!identity) {
      return fail(res, 401, hasAuthorizationHeader(req) ? 'agent_access_denied' : 'company_access_required');
    }
    if (!productionStorageConfigured()) {
      return fail(res, 503, 'storage_not_configured', {setupPending: true, user: identity.user});
    }

    if (req.method === 'GET') {
      const params = query(req);
      const targetId = params.get('targetId');
      const archiveId = params.get('archiveId');
      if (targetId !== null || archiveId !== null) {
        if (!targetId || !archiveId) return fail(res, 400, 'invalid_request');
        return handleImage(req, res, identity, targetId, archiveId);
      }
      return handleManifest(req, res, identity);
    }
    if (req.method !== 'POST') return fail(res, 405, 'method_not_allowed', {}, {Allow: 'GET, POST'});
    if (identity.kind !== 'browser' || hasAuthorizationHeader(req)) return fail(res, 403, 'agent_scope_denied');
    if (!isSameOrigin(req)) return fail(res, 403, 'same_origin_required');
    const body = parsedBody(req);
    if (!body || typeof body.action !== 'string') return fail(res, 400, 'invalid_request');
    if (body.action === 'check') {
      if (typeof body.targetId !== 'string') return fail(res, 400, 'invalid_request');
      return handleCheck(req, res, body.targetId);
    }
    if (body.action === 'register') return handleRegister(res, body, identity);
    return fail(res, 400, 'invalid_request');
  };
}

const handler = createHandler();
module.exports = handler;
module.exports._test = {
  createHandler,
  expectedOrigin,
  findTarget,
  isSameOrigin,
  manifestPayload,
  parsedBody,
  publicChangeSummary,
  publicComparisonDetails,
  publicArchive,
  publicTarget,
  query,
  requestIdentity,
};
