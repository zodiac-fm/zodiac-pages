'use strict';

const {authConfigured, hasAuthorizationHeader, readAgentToken, readSession} = require('../lib/funnel-tracker/session');
const {blobStore, storageConfigured} = require('../lib/funnel-tracker/blob-store');
const {
  DraftStoreConflictError,
  DraftStoreUnavailableError,
  InvalidDraftDataError,
  draftStore,
  fetchCanonicalDraft,
  publicDraft,
  validPageKey,
} = require('../lib/funnel-tracker/draft-store');
const {captureDraftRevision} = require('../lib/funnel-tracker/draft-capture');
const {getTarget} = require('../lib/funnel-tracker/production-catalog');
const {workStore, InvalidWorkDataError, WorkStoreConflictError} = require('../lib/funnel-tracker/work-store');
const {
  MAX_ATTACHMENT_BYTES,
  InvalidReviewDataError,
  ReviewStoreUnavailableError,
  reviewStore,
  validAttachmentId,
} = require('../lib/funnel-tracker/review-store');

const MESSAGES = Object.freeze({
  agent_access_denied: 'This agent token is missing, invalid or expired.',
  agent_scope_denied: 'Agent access can read the section map but cannot upload or open private images.',
  attachment_not_found: 'That private image attachment is not available.',
  auth_not_configured: 'Company sign-in has not been configured yet.',
  company_access_required: 'Sign in with your zodiac.fm Google account to use section review.',
  invalid_attachment: 'Upload a PNG, JPEG, or WebP image up to 4 MiB.',
  invalid_request: 'The review request is invalid.',
  invalid_draft: 'Choose a valid working page, section, and editable item.',
  invalid_publication: 'Confirm an exact saved draft revision and a customer production URL.',
  map_not_configured: 'The private section presentation map has not been configured yet.',
  method_not_allowed: 'That request method is not supported.',
  review_unavailable: 'The private review material service is temporarily unavailable.',
  draft_not_found: 'That working page has not been initialized yet.',
  draft_conflict: 'Someone saved this working page while you were editing. Refresh and compare before saving again.',
  draft_has_unmerged_edits: 'This working page has saved edits from its earlier source. Those edits are safe. Compare them before replacing the source.',
  same_origin_required: 'Open the tracker page directly before uploading a private image.',
  storage_not_configured: 'Shared tracker storage has not been configured yet.',
});

function setSecurityHeaders(res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  res.setHeader('X-Frame-Options', 'DENY');
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

function parsedJsonBody(req, maxBytes = 64 * 1024) {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!req.body) return null;
  if (typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    try {
      return Buffer.byteLength(JSON.stringify(req.body), 'utf8') <= maxBytes ? req.body : null;
    } catch {
      return null;
    }
  }
  try {
    const body = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body);
    return Buffer.byteLength(body, 'utf8') <= maxBytes ? JSON.parse(body) : null;
  } catch {
    return null;
  }
}

function redirectToTracker(res, pageKey) {
  const target = getTarget(pageKey);
  const params = new URLSearchParams({mode: 'review', page: target.family, variant: target.variant});
  res.statusCode = 302;
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Location', `/funnel/tracker?${params}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.end();
}

function sendWorkingHtml(res, html) {
  res.statusCode = 200;
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Content-Security-Policy', "default-src 'self' https: data: blob:; script-src 'self' 'unsafe-inline' https:; style-src 'self' 'unsafe-inline' https:; object-src 'none'; base-uri 'self' https://zodiac-pages.vercel.app; frame-ancestors 'self'; form-action 'self' https://zodiac-pages.vercel.app");
  return res.end(html);
}

function sendPng(res, image) {
  res.statusCode = 200;
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Content-Length', String(image.length));
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  return res.end(image);
}

function requestIdentity(req) {
  if (hasAuthorizationHeader(req)) {
    const agent = readAgentToken(req);
    return agent ? {kind: 'agent', user: agent.user, scope: agent.scope} : null;
  }
  const session = readSession(req);
  return session ? {kind: 'browser', user: session.user} : null;
}

async function rawBody(req) {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && (declared < 1 || declared > MAX_ATTACHMENT_BYTES)) return null;
  if (Buffer.isBuffer(req.body)) {
    return req.body.length >= 1 && req.body.length <= MAX_ATTACHMENT_BYTES ? Buffer.from(req.body) : null;
  }
  if (req.body !== undefined && req.body !== null) return null;
  if (!req[Symbol.asyncIterator]) return null;
  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > MAX_ATTACHMENT_BYTES) return null;
      chunks.push(buffer);
    }
  } catch {
    return null;
  }
  return size >= 1 ? Buffer.concat(chunks, size) : null;
}

function createHandler({
  store = reviewStore,
  drafts = draftStore,
  tracker = blobStore,
  sourceFetcher = fetchCanonicalDraft,
  captureRevision = captureDraftRevision,
  work = workStore,
} = {}) {
  return async function handler(req, res) {
    if (!authConfigured()) return fail(res, 503, 'auth_not_configured', {setupPending: true});
    const params = query(req);
    const action = params.get('action');
    const identity = requestIdentity(req);
    if (!identity) {
      const pageKey = params.get('pageKey');
      if (req.method === 'GET' && action === 'draft-html' && validPageKey(pageKey)
          && !hasAuthorizationHeader(req)) return redirectToTracker(res, pageKey);
      return fail(res, 401, hasAuthorizationHeader(req) ? 'agent_access_denied' : 'company_access_required');
    }
    if (!storageConfigured()) return fail(res, 503, 'storage_not_configured', {setupPending: true, user: identity.user});

    if (req.method === 'GET' && action === 'linear-work') {
      try {
        const result = await work.list({pageKey: params.get('pageKey') || null});
        return sendJson(res, 200, {...result, user: identity.user});
      } catch (error) {
        return fail(res, error instanceof InvalidWorkDataError ? 400 : 503, 'review_unavailable');
      }
    }
    if (req.method === 'POST' && action === 'link-linear-work') {
      if (identity.kind !== 'browser' || hasAuthorizationHeader(req)) return fail(res, 403, 'agent_scope_denied');
      if (!isSameOrigin(req)) return fail(res, 403, 'same_origin_required');
      const body = parsedJsonBody(req);
      if (!body) return fail(res, 400, 'invalid_request');
      try {
        const result = await work.upsert(body.payload, identity.user, body.expectedRevision);
        return sendJson(res, 200, {...result, user: identity.user});
      } catch (error) {
        return fail(res, error instanceof WorkStoreConflictError ? 409 : error instanceof InvalidWorkDataError ? 400 : 503,
          error instanceof WorkStoreConflictError ? 'draft_conflict' : 'invalid_request');
      }
    }

    if (req.method === 'GET' && action === 'activity') {
      try {
        const current = await drafts.readManifest();
        const events = current.data.drafts.flatMap(draft => [
          ...draft.revisions.filter(item => item.kind === 'edit').map(item => ({
            id: item.id, type: item.operationType, sectionId: item.sectionId,
            pageKey: draft.pageKey, family: draft.family, variant: draft.variant,
            pageLabel: draft.label, createdAt: item.createdAt, editor: item.editor,
            summary: item.operationType === 'text' ? String(item.after).slice(0, 240) : 'Replacement image saved',
          })),
          ...draft.publications.map(item => ({
            id: item.id, type: 'published', sectionId: item.sectionId,
            pageKey: draft.pageKey, family: draft.family, variant: draft.variant,
            pageLabel: draft.label, createdAt: item.confirmedAt, editor: item.editor,
            summary: 'Customer publication confirmed',
          })),
        ]).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        return sendJson(res, 200, {events, user: identity.user});
      } catch { return fail(res, 503, 'review_unavailable'); }
    }

    if (req.method === 'GET' && action === 'map') {
      try {
        const current = await store.readMap();
        return sendJson(res, 200, {map: current.data, user: identity.user});
      } catch (error) {
        if (error instanceof ReviewStoreUnavailableError
            && error.message === 'runtime review map is not initialized') {
          return fail(res, 503, 'map_not_configured', {setupPending: true});
        }
        return fail(res, 503, 'review_unavailable');
      }
    }

    if (req.method === 'GET' && action === 'image') {
      if (identity.kind !== 'browser' || hasAuthorizationHeader(req)) return fail(res, 403, 'agent_scope_denied');
      const attachmentId = params.get('attachmentId');
      if (!validAttachmentId(attachmentId)) return fail(res, 404, 'attachment_not_found');
      try {
        const result = await store.readAttachment(attachmentId);
        if (!result) return fail(res, 404, 'attachment_not_found');
        res.statusCode = 200;
        setSecurityHeaders(res);
        res.setHeader('Content-Type', result.attachment.mimeType);
        res.setHeader('Content-Length', String(result.attachment.size));
        res.setHeader('Content-Disposition', 'inline');
        res.setHeader('Digest', `sha-256=${Buffer.from(result.attachment.sha256, 'hex').toString('base64')}`);
        return res.end(result.buffer);
      } catch {
        return fail(res, 503, 'review_unavailable');
      }
    }

    if (req.method === 'GET' && action === 'draft') {
      const pageKey = params.get('pageKey');
      if (!validPageKey(pageKey)) return fail(res, 400, 'invalid_draft');
      try {
        const current = await drafts.getDraft(pageKey);
        if (!current.draft) return fail(res, 404, 'draft_not_found');
        return sendJson(res, 200, {draft: publicDraft(current.draft), user: identity.user});
      } catch (error) {
        if (error instanceof InvalidDraftDataError) return fail(res, 400, 'invalid_draft');
        return fail(res, 503, 'review_unavailable');
      }
    }

    if (req.method === 'GET' && action === 'draft-html') {
      if (identity.kind !== 'browser' || hasAuthorizationHeader(req)) return fail(res, 403, 'agent_scope_denied');
      const pageKey = params.get('pageKey');
      if (!validPageKey(pageKey)) return fail(res, 404, 'draft_not_found');
      try {
        const current = await drafts.getDraft(pageKey);
        if (!current.draft) return fail(res, 404, 'draft_not_found');
        const revisionId = params.get('revision') || current.draft.currentRevisionId;
        const result = await drafts.getHtmlByRevision(current.draft, revisionId);
        if (!result) return fail(res, 404, 'draft_not_found');
        return sendWorkingHtml(res, result.html);
      } catch {
        return fail(res, 503, 'review_unavailable');
      }
    }

    if (req.method === 'GET' && action === 'draft-screenshot') {
      if (identity.kind !== 'browser' || hasAuthorizationHeader(req)) return fail(res, 403, 'agent_scope_denied');
      const pageKey = params.get('pageKey');
      const revisionId = params.get('revision');
      if (!validPageKey(pageKey) || typeof revisionId !== 'string') return fail(res, 404, 'draft_not_found');
      try {
        const result = await drafts.getScreenshot(pageKey, revisionId);
        if (!result) return fail(res, 404, 'draft_not_found');
        return sendPng(res, result.image);
      } catch {
        return fail(res, 503, 'review_unavailable');
      }
    }

    if (req.method === 'POST' && action === 'attachment') {
      if (identity.kind !== 'browser' || hasAuthorizationHeader(req)) return fail(res, 403, 'agent_scope_denied');
      if (!isSameOrigin(req)) return fail(res, 403, 'same_origin_required');
      const mimeType = firstHeader(req.headers['content-type']).split(';')[0].trim().toLowerCase();
      const body = await rawBody(req);
      if (!body || !['image/png', 'image/jpeg', 'image/webp'].includes(mimeType)) {
        return fail(res, 400, 'invalid_attachment');
      }
      try {
        const attachment = await store.putAttachment(body, {
          mimeType,
          fileName: firstHeader(req.headers['x-funnel-filename']),
          editor: identity.user,
        });
        return sendJson(res, 201, {attachment});
      } catch (error) {
        if (error instanceof InvalidReviewDataError) return fail(res, 400, 'invalid_attachment');
        return fail(res, 503, 'review_unavailable');
      }
    }

    if (req.method === 'POST' && action === 'initialize-draft') {
      if (identity.kind !== 'browser' || hasAuthorizationHeader(req)) return fail(res, 403, 'agent_scope_denied');
      if (!isSameOrigin(req)) return fail(res, 403, 'same_origin_required');
      const body = parsedJsonBody(req);
      if (!body || !validPageKey(body.pageKey)) return fail(res, 400, 'invalid_draft');
      try {
        const existing = await drafts.getDraft(body.pageKey);
        if (existing.draft && !publicDraft(existing.draft).sourceOutdated) {
          let latest = existing.draft;
          try {
            await captureRevision(body.pageKey, existing.draft.currentRevisionId, {drafts, review: store});
            latest = (await drafts.getDraft(body.pageKey)).draft || latest;
          } catch {}
          return sendJson(res, 200, {draft: publicDraft(latest), user: identity.user});
        }
        const [mapResult, trackerResult, source] = await Promise.all([
          store.readMap(), tracker.read(), sourceFetcher(body.pageKey),
        ]);
        const sectionNames = Object.fromEntries(trackerResult.data.sections.map(section => [section.id, section.name]));
        const initialize = existing.draft ? drafts.rebase.bind(drafts) : drafts.initialize.bind(drafts);
        const initialized = await initialize({
          pageKey: body.pageKey,
          expectedRevision: existing.draft?.currentRevisionId,
          sourceHtml: source.html,
          sourceSha256: source.sha256,
          runtimeMap: mapResult.data,
          sectionNames,
          editor: identity.user,
        });
        let latest = initialized.draft;
        try {
          await captureRevision(body.pageKey, initialized.draft.currentRevisionId, {drafts, review: store});
          latest = (await drafts.getDraft(body.pageKey)).draft || latest;
        } catch {}
        return sendJson(res, initialized.created ? 201 : 200, {
          draft: publicDraft(latest), user: identity.user,
        });
      } catch (error) {
        if (error instanceof InvalidDraftDataError && error.message === 'draft_has_unmerged_edits') {
          const latest = await drafts.getDraft(body.pageKey).catch(() => null);
          return fail(res, 409, 'draft_has_unmerged_edits', {draft: latest?.draft ? publicDraft(latest.draft) : null});
        }
        if (error instanceof DraftStoreConflictError) {
          const latest = await drafts.getDraft(body.pageKey).catch(() => null);
          const code = error.message === 'draft_has_unmerged_edits' ? 'draft_has_unmerged_edits' : 'draft_conflict';
          return fail(res, 409, code, {draft: latest?.draft ? publicDraft(latest.draft) : null});
        }
        if (error instanceof InvalidDraftDataError) return fail(res, 400, 'invalid_draft');
        return fail(res, 503, 'review_unavailable');
      }
    }

    if (req.method === 'POST' && action === 'draft-edit') {
      if (identity.kind === 'browser' && !isSameOrigin(req)) return fail(res, 403, 'same_origin_required');
      const body = parsedJsonBody(req);
      if (!body) return fail(res, 400, 'invalid_draft');
      if (identity.kind === 'agent' && (body.operation?.type !== 'text' || body.material?.attachmentId !== undefined)) {
        return fail(res, 403, 'agent_scope_denied');
      }
      const attachmentId = body.operation?.type === 'image'
        ? body.operation?.attachmentId : body.material?.attachmentId;
      if (attachmentId !== undefined) {
        if (identity.kind !== 'browser') return fail(res, 403, 'agent_scope_denied');
        try {
          if (!await store.hasAttachment(attachmentId)) return fail(res, 400, 'invalid_attachment');
        } catch {
          return fail(res, 503, 'review_unavailable');
        }
      }
      try {
        const changed = await drafts.edit({
          pageKey: body.pageKey,
          sectionId: body.sectionId,
          editId: body.editId,
          expectedRevision: body.expectedRevision,
          operation: body.operation,
          material: body.material,
          editor: identity.user,
        });
        let latest = changed.draft;
        try {
          await captureRevision(body.pageKey, changed.revision.id, {drafts, review: store});
          latest = (await drafts.getDraft(body.pageKey)).draft || latest;
        } catch {}
        const publicLatest = publicDraft(latest);
        return sendJson(res, 201, {
          draft: publicLatest,
          user: identity.user,
          event: publicLatest.history.find(item => item.id === changed.revision.id),
        });
      } catch (error) {
        if (error instanceof DraftStoreConflictError) {
          try {
            const latest = await drafts.getDraft(body.pageKey);
            return fail(res, 409, 'draft_conflict', {draft: latest.draft ? publicDraft(latest.draft) : null});
          } catch {
            return fail(res, 409, 'draft_conflict');
          }
        }
        if (error instanceof InvalidDraftDataError) return fail(res, 400, 'invalid_draft');
        return fail(res, 503, 'review_unavailable');
      }
    }

    if (req.method === 'POST' && ['confirm-published', 'confirm-page-published'].includes(action)) {
      if (identity.kind !== 'browser' || hasAuthorizationHeader(req)) return fail(res, 403, 'agent_scope_denied');
      if (!isSameOrigin(req)) return fail(res, 403, 'same_origin_required');
      const body = parsedJsonBody(req);
      if (!body) return fail(res, 400, 'invalid_publication');
      try {
        const confirmed = await drafts.confirmPublished({...body, ...(action === 'confirm-page-published' ? {sectionId: null} : {}), editor: identity.user});
        return sendJson(res, 201, {
          draft: publicDraft(confirmed.draft),
          user: identity.user,
          publication: confirmed.publication,
        });
      } catch (error) {
        if (error instanceof DraftStoreConflictError) return fail(res, 409, 'draft_conflict');
        if (error instanceof InvalidDraftDataError) return fail(res, 400, 'invalid_publication');
        return fail(res, 503, 'review_unavailable');
      }
    }

    if (!['GET', 'POST'].includes(req.method)) {
      return fail(res, 405, 'method_not_allowed', {}, {Allow: 'GET, POST'});
    }
    return fail(res, 400, 'invalid_request');
  };
}

const handler = createHandler();
module.exports = handler;
module.exports._test = {
  createHandler,
  expectedOrigin,
  isSameOrigin,
  query,
  rawBody,
  parsedJsonBody,
  requestIdentity,
};
