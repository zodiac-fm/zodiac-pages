'use strict';

const {timingSafeEqual} = require('node:crypto');
const {TARGETS} = require('../lib/funnel-tracker/production-catalog');
const {capturePendingDrafts} = require('../lib/funnel-tracker/draft-capture');
const {checkAllTargets, requestOidcTokenProvider} = require('../lib/funnel-tracker/production-monitor');
const {productionStorageConfigured, productionStore} = require('../lib/funnel-tracker/production-store');

function sendJson(res, status, payload, headers = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
  res.end(JSON.stringify(payload));
}

function authorizedCron(req, environment = process.env) {
  const secret = environment.CRON_SECRET;
  const header = Array.isArray(req.headers.authorization) ? null : req.headers.authorization;
  if (typeof secret !== 'string' || secret.length < 32 || secret.length > 1024
      || typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  const supplied = header.slice(7);
  if (supplied.length < 1 || supplied.length > 1024) return false;
  const expectedBytes = Buffer.from(secret, 'utf8');
  const suppliedBytes = Buffer.from(supplied, 'utf8');
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
}

function publicResult(result) {
  return {
    targetId: result.targetId,
    status: result.status,
    changed: result.changed,
    archiveId: result.archiveId,
    skipped: result.skipped === true,
    timedOut: result.timedOut === true,
    error: result.error || null,
  };
}

function createHandler({
  environment = process.env,
  store = productionStore,
  targets = TARGETS,
  checkAll = checkAllTargets,
  captureDrafts = capturePendingDrafts,
  now = () => new Date(),
} = {}) {
  return async function handler(req, res) {
    if (req.method !== 'GET') return sendJson(res, 405, {ok: false, error: 'method_not_allowed'}, {Allow: 'GET'});
    if (environment.VERCEL_ENV !== 'production') {
      return sendJson(res, 403, {ok: false, error: 'production_environment_required'});
    }
    if (!authorizedCron(req, environment)) return sendJson(res, 401, {ok: false, error: 'cron_access_denied'});
    if (!productionStorageConfigured(environment)) {
      return sendJson(res, 503, {ok: false, error: 'storage_not_configured'});
    }
    const checkedAt = now().toISOString();
    try {
      const results = (await checkAll(targets, {
        store,
        tokenProvider: requestOidcTokenProvider(req),
      })).map(publicResult);
      let draftCaptures;
      try {
        draftCaptures = await captureDrafts();
      } catch {
        draftCaptures = {
          ok: false,
          attempted: 0,
          remaining: null,
          ready: 0,
          failed: 0,
          results: [],
          error: 'draft_capture_unavailable',
        };
      }
      const failed = results.some(result => ['needs_connection', 'error', 'skipped'].includes(result.status));
      return sendJson(res, failed ? 207 : 200, {ok: !failed, checkedAt, results, draftCaptures});
    } catch {
      return sendJson(res, 503, {ok: false, checkedAt, error: 'monitor_unavailable', results: []});
    }
  };
}

const handler = createHandler();
module.exports = handler;
module.exports._test = {authorizedCron, createHandler, publicResult};
