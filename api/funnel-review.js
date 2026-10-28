'use strict';

const {createHmac, randomBytes, timingSafeEqual} = require('node:crypto');

const {
  authConfigured,
  configuredSessionSecret,
  hasAuthorizationHeader,
  readAgentToken,
  readSession,
} = require('../lib/funnel-tracker/session');
const {blobStore, storageConfigured} = require('../lib/funnel-tracker/blob-store');
const {
  DraftStoreConflictError,
  DraftStoreUnavailableError,
  InvalidDraftDataError,
  draftStore,
  fetchCanonicalDraft,
  publicDraft,
  compareLiveSourceEvidence,
  renderWorkingPage,
  revisionSyncState,
  normalizedView,
  validPageKey,
} = require('../lib/funnel-tracker/draft-store');
const {captureDraftRevision} = require('../lib/funnel-tracker/draft-capture');
const {getTarget, pairedLiveTargets} = require('../lib/funnel-tracker/production-catalog');
const {
  BC_COMPARISON_VERSION,
  SNAPSHOT_TRACE_DIAGNOSTIC_VERSION,
  comparisonStructuralDigests,
  snapshotTraceStructuralDigests,
  fetchVerifiedLiveSource,
  fetchVerifiedLiveViews,
  buildVerifiedLiveRuntimeMap,
  LiveSourceError,
} = require('../lib/funnel-tracker/live-source');
const {requestOidcTokenProvider} = require('../lib/funnel-tracker/production-monitor');
const {initializeWorkingViews} = require('../lib/funnel-tracker/view-initialization');
const {
  createLiveCheckCache,
  liveCheckCacheKey,
} = require('../lib/funnel-tracker/live-check-cache');
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
  live_source_unavailable: 'The live template could not be verified. Your working page is unchanged. Try again shortly.',
  live_sections_unmatched: 'Some sections could not be matched to the live template. Your working page is unchanged.',
  section_copy_conflict: 'One of the selected pages changed. Nothing was copied. Refresh the page list and review the selected versions again.',
  invalid_section_copy: 'Choose a saved section and matching sections within the same page family. Nothing was copied.',
  archived_variation: 'This variation is archived and read-only. Restore it before making changes.',
  deleted_variation: 'This variation was deleted. Its protected history is retained, but it cannot be changed or restored.',
  invalid_variation_lifecycle: 'Choose a current variation and try that variation action again.',
  invalid_variation_promotion: 'Choose a current variation, release type, and change summary before making it Main.',
  variation_delete_confirmation_mismatch: 'Type the exact variation name to delete it.',
  variation_lifecycle_conflict: 'This variation changed while you were working. Refresh before archiving, restoring, or deleting it.',
  variation_name_conflict: 'That variation name is already in use for this category. Choose another name.',
  variation_not_found: 'That variation is no longer available.',
  variation_promotion_conflict: 'The variation or Main changed while you were working. Refresh both before making it Main.',
  variation_promotion_missing: 'The variation or its Main working page is no longer available.',
  variation_promotion_views_required: 'Both the variation and Main need Desktop and Mobile working pages before promotion.',
  invalid_variation: 'Give this variation a name and start from the current main working version.',
  same_origin_required: 'Open the tracker page directly before uploading a private image.',
  storage_not_configured: 'Shared tracker storage has not been configured yet.',
});
const WORKING_CHECK_SECONDS = 2 * 60;
const LIVE_CHECK_STATUSES = new Set(['current', 'changed', 'unavailable']);

function workingCheckSignature(encoded, environment = process.env) {
  const secret = configuredSessionSecret(environment);
  if (!secret) return null;
  return createHmac('sha256', secret)
    .update('funnel-working-check-v1\n', 'ascii')
    .update(encoded, 'ascii')
    .digest('base64url');
}

function workingCheckSubjectDigest(subject, environment = process.env) {
  const secret = configuredSessionSecret(environment);
  if (!secret || typeof subject !== 'string' || !/^[A-Za-z0-9_-]{6,255}$/.test(subject)) {
    return null;
  }
  return createHmac('sha256', secret)
    .update('funnel-working-check-subject-v1\n', 'ascii')
    .update(subject, 'utf8')
    .digest('base64url');
}

function createWorkingCheckReceipt(draft, pageKey, revisionId, subject, {
  environment = process.env,
  now = new Date(),
} = {}) {
  const subjectDigest = workingCheckSubjectDigest(subject, environment);
  if (!draft || draft.revision !== revisionId || !validPageKey(pageKey) || !subjectDigest
      || !draft.liveChecks || !['desktop', 'mobile'].every(view => (
        LIVE_CHECK_STATUSES.has(draft.liveChecks[view]?.status)
      ))) return null;
  const issuedAt = Math.floor(now.getTime() / 1000);
  const payload = {
    v:1,
    kind:'working-check',
    pageKey,
    revisionId,
    subjectDigest,
    statuses:{
      desktop:draft.liveChecks.desktop.status,
      mobile:draft.liveChecks.mobile.status,
    },
    iat:issuedAt,
    exp:issuedAt + WORKING_CHECK_SECONDS,
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = workingCheckSignature(encoded, environment);
  return signature ? `${encoded}.${signature}` : null;
}

function readWorkingCheckReceipt(value, pageKey, revisionId, subject, {
  environment = process.env,
  now = () => new Date(),
} = {}) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  const parts = value.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const signature = workingCheckSignature(parts[0], environment);
  if (!signature) return null;
  const actual = Buffer.from(parts[1], 'base64url');
  const expected = Buffer.from(signature, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); }
  catch { return null; }
  if (!payload || Object.keys(payload).sort().join(',')
      !== 'exp,iat,kind,pageKey,revisionId,statuses,subjectDigest,v'
      || payload.v !== 1 || payload.kind !== 'working-check'
      || payload.pageKey !== pageKey || payload.revisionId !== revisionId
      || !payload.statuses || Object.keys(payload.statuses).sort().join(',') !== 'desktop,mobile'
      || !['desktop', 'mobile'].every(view => LIVE_CHECK_STATUSES.has(payload.statuses[view]))
      || !Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp)
      || payload.exp !== payload.iat + WORKING_CHECK_SECONDS) return null;
  const subjectDigest = workingCheckSubjectDigest(subject, environment);
  if (!subjectDigest || typeof payload.subjectDigest !== 'string') return null;
  const actualSubject = Buffer.from(payload.subjectDigest, 'base64url');
  const expectedSubject = Buffer.from(subjectDigest, 'base64url');
  if (actualSubject.length !== expectedSubject.length
      || !timingSafeEqual(actualSubject, expectedSubject)) return null;
  const current = Math.floor(now().getTime() / 1000);
  return payload.iat <= current + 60 && payload.exp > current ? payload : null;
}

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

function redirectToTracker(res, pageKey, view = null) {
  const target = getTarget(pageKey);
  const params = new URLSearchParams({mode:'review',page:target.family,variant:target.variant,pageKey});
  if (view !== null && view !== '') params.set('view', normalizedView(view) || 'desktop');
  res.statusCode = 302;
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Location', `/funnel/tracker?${params}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.end();
}

function sendWorkingHtml(res, html, req) {
  const nonce = randomBytes(18).toString('base64');
  const origin = expectedOrigin(req);
  const editor = `<link rel="stylesheet" href="${origin}/funnel/tracker/working-editor.css"><script nonce="${nonce}" defer src="${origin}/funnel/tracker/working-editor.js"></script>`;
  html = html.replace('</head>', `${editor}</head>`);
  res.statusCode = 200;
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Content-Security-Policy', `default-src 'self' https: data: blob:; script-src 'nonce-${nonce}'; style-src 'self' 'unsafe-inline' https:; object-src 'none'; base-uri 'self' https://zodiac-pages.vercel.app https://zodiac.fm https://app.zodiac.fm; frame-ancestors 'self'; form-action 'self' https://zodiac-pages.vercel.app`);
  return res.end(html);
}

function escapeHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function sendWorkingShell(res, req, {pageKey, revisionId, view, draft}) {
  const origin = expectedOrigin(req);
  const width = view === 'mobile' ? 390 : 1280;
  const label = view === 'mobile' ? 'Mobile web' : 'Desktop web';
  const revision = draft.history.find(item => item.id === revisionId);
  const version = revision?.version ? `Version ${revision.version}`
    : `Setup archive ${revision?.archiveNumber || 1}`;
  const activeSync = revision?.sync || null;
  const overallSync = revision?.overallSync || activeSync;
  const hasUnavailable = activeSync?.checkStatus === 'unavailable'
    || Object.values(overallSync?.views || {}).some(item => item.checkStatus === 'unavailable');
  const hasUnsynced = activeSync?.status === 'unsynced' || overallSync?.status === 'unsynced';
  const pendingCheck = draft.liveCheckPending === true;
  const pending = pendingCheck && !hasUnsynced;
  const status = hasUnsynced ? 'Unsynced'
    : pending ? 'Checking live…' : hasUnavailable ? 'Check unavailable' : 'Synced';
  const overallStatus = overallSync?.status === 'unsynced'
    ? 'Unsynced' : pending ? 'Checking live…' : hasUnavailable ? 'Check unavailable' : 'Synced';
  const identity = `${revision?.identity || `${draft.baseLabel} · ${version}`} · ${label} · ${status} · Overall ${overallStatus}`;
  const params = new URLSearchParams({
    action:'draft-html',pageKey,revision:revisionId,view,embedded:'1',
  });
  if (pendingCheck) {
    params.set('check', 'defer');
  } else {
    const checkReceipt = createWorkingCheckReceipt(
      draft, pageKey, revisionId, requestIdentity(req)?.user?.sub,
    );
    if (checkReceipt) params.set('check', checkReceipt);
  }
  const source = `${origin}/api/funnel-review?${params}`;
  const html = `<!doctype html><html lang="en" data-funnel-working-shell><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(identity)}</title><style>html,body{margin:0;min-height:100%;background:#eeeaf1;color:#211b2a;font:14px/1.4 system-ui,sans-serif}.working-shell{padding:12px}.working-shell__title{margin:0 0 10px;font-weight:750}.working-shell__viewport{overflow:auto;width:${width}px;max-width:100%;margin-inline:auto;border:1px solid #cfc7d4;border-radius:8px;background:#fff;box-shadow:0 8px 30px #211b2a1c}.working-shell iframe{display:block;width:${width}px;height:900px;border:0;background:#fff}</style></head><body data-funnel-working-shell><main class="working-shell"><p class="working-shell__title">${escapeHtml(identity)} · ${width}px viewport</p><div class="working-shell__viewport"><iframe id="funnel-working-view-frame" title="${escapeHtml(`${label} working page`)}" src="${escapeHtml(source)}"></iframe></div></main></body></html>`;
  res.statusCode = 200;
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'self'; base-uri 'none'");
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
  liveSourceFetcher = fetchVerifiedLiveSource,
  liveViewsFetcher = fetchVerifiedLiveViews,
  captureRevision = captureDraftRevision,
  work = workStore,
  checkCache = createLiveCheckCache(),
} = {}) {
  async function withLiveCheckUncached(req, value, view = 'desktop') {
    let draft = publicDraft(value, {view});
    const tokenProvider = requestOidcTokenProvider(req);
    const includeComparisonDiagnostics = value.family === 'bc'
      && requestIdentity(req)?.kind === 'browser';
    const includeSnapshotTraceDiagnostics = value.family === 'join'
      && requestIdentity(req)?.kind === 'browser';
    const safeErrorCode = error => {
      const code=typeof error?.code==='string' ? error.code.toLowerCase() : '';
      return /^[a-z][a-z0-9_]{0,63}$/.test(code) ? code : 'live_source_unavailable';
    };
    if (value.views) {
      const contexts = Object.fromEntries(['desktop','mobile'].map(checkView => {
        const viewDraft = publicDraft(value, {view:checkView});
        const publication = viewDraft.latestPagePublication || null;
        const initialized = [...value.revisions].reverse().find(item => item.kind === 'initialized'
          && (item.views?.[checkView]?.sourceEvidence || item.sourceEvidence));
        const evidence = initialized
          ? initialized.views?.[checkView]?.sourceEvidence || initialized.sourceEvidence : null;
        const liveUrl = publication?.liveUrl || evidence?.liveUrl || null;
        const channel = liveUrl
          ? pairedLiveTargets(viewDraft.pageKey).find(item => item.productionUrl === liveUrl)?.channel
          : null;
        return [checkView, {viewDraft,publication,evidence,channel,
          shouldCheck:Boolean(publication || evidence)}];
      }));
      if (contexts.desktop.shouldCheck || contexts.mobile.shouldCheck) {
        const checkedAt = new Date().toISOString();
        const checks = {desktop:null,mobile:null};
        const statusFor = (matchStatus) => matchStatus === 'check-needed' ? 'changed'
          : matchStatus === 'unavailable' ? 'unavailable' : 'current';
        const checkObserved = async (checkView, observed) => {
          if (!contexts[checkView].shouldCheck) return;
          try {
            const matchStatus = compareLiveSourceEvidence(value, observed.evidence, checkView);
            checks[checkView] = {status:statusFor(matchStatus),matchStatus,checkedAt};
            const context = contexts[checkView];
            const storedSha256 = context.publication?.liveComparisonSha256
              || context.evidence?.comparisonSha256 || null;
            if (includeComparisonDiagnostics && matchStatus === 'check-needed'
                && context.evidence?.comparisonVersion === BC_COMPARISON_VERSION
                && observed.evidence?.comparisonVersion === BC_COMPARISON_VERSION
                && typeof storedSha256 === 'string'
                && typeof observed.evidence.comparisonSha256 === 'string'
                && typeof observed.html === 'string') {
              checks[checkView].comparison = {
                version:BC_COMPARISON_VERSION,
                storedSha256,
                observedSha256:observed.evidence.comparisonSha256,
                observed:comparisonStructuralDigests(observed.html),
              };
            } else if (includeSnapshotTraceDiagnostics && matchStatus === 'check-needed'
                && context.evidence?.comparisonVersion === undefined
                && observed.evidence?.comparisonVersion === undefined
                && /^[a-f0-9]{64}$/.test(context.evidence?.contentSha256 || '')
                && /^[a-f0-9]{64}$/.test(observed.evidence?.contentSha256 || '')
                && typeof observed.html === 'string') {
              checks[checkView].comparison = {
                version:SNAPSHOT_TRACE_DIAGNOSTIC_VERSION,
                storedRawSha256:context.evidence.contentSha256,
                observedRawSha256:observed.evidence.contentSha256,
                observed:snapshotTraceStructuralDigests(observed.html,value.pageKey),
              };
            }
          } catch (error) {
            checks[checkView] = {status:'unavailable',checkedAt,
              ...(includeComparisonDiagnostics ? {errorCode:safeErrorCode(error)} : {})};
          }
        };
        const distinctChannels = new Set(['desktop','mobile']
          .filter(checkView => contexts[checkView].shouldCheck)
          .map(checkView => contexts[checkView].channel));
        if (value.family === 'bc' || distinctChannels.size > 1) {
          await Promise.all(['desktop','mobile'].map(async checkView => {
            if (!contexts[checkView].shouldCheck) return;
            try {
              const observed = await liveSourceFetcher(draft.mainPageKey, {
                channel:contexts[checkView].channel,view:checkView,
                tokenProvider,
              });
              await checkObserved(checkView, observed);
            } catch (error) { checks[checkView] = {status:'unavailable',checkedAt,
              ...(includeComparisonDiagnostics ? {errorCode:safeErrorCode(error)} : {})}; }
          }));
        } else {
          const representative = contexts[view].shouldCheck ? view
            : contexts.desktop.shouldCheck ? 'desktop' : 'mobile';
          try {
            const observed = await liveSourceFetcher(draft.mainPageKey, {
              channel:contexts[representative].channel,view:representative,
              tokenProvider,
            });
            await Promise.all(['desktop','mobile'].map(checkView => checkObserved(checkView, observed)));
          } catch (error) {
            for (const checkView of ['desktop','mobile']) {
              if (contexts[checkView].shouldCheck) checks[checkView] = {
                status:'unavailable',checkedAt,
                ...(includeComparisonDiagnostics ? {errorCode:safeErrorCode(error)} : {}),
              };
            }
          }
        }
        const syncStatusByView = Object.fromEntries(['desktop','mobile'].map(checkView => [
          checkView,checks[checkView]?.status || null,
        ]));
        draft = publicDraft(value, {syncStatusByView,view});
        draft.liveChecks = checks;
        draft.liveCheck = checks[view];
        return draft;
      }
      return draft;
    }
    const publication = draft.latestPagePublication?.revisionId === draft.revision ? draft.latestPagePublication : null;
    if (draft.liveSource || publication) {
      const checkedAt = new Date().toISOString();
      try {
        const channel = publication ? pairedLiveTargets(draft.pageKey).find(item => item.productionUrl === publication.liveUrl)?.channel : draft.liveSource.channel;
        const observed = await liveSourceFetcher(draft.mainPageKey, {
          channel, view, tokenProvider,
        });
        const matchStatus = compareLiveSourceEvidence(value, observed.evidence, view);
        draft.liveCheck = {status: matchStatus === 'check-needed' ? 'changed' : matchStatus === 'unavailable' ? 'unavailable' : 'current', matchStatus, checkedAt};
      } catch { draft.liveCheck = {status: 'unavailable', checkedAt}; }
    }
    const liveCheck = draft.liveCheck;
    draft = publicDraft(value, {syncStatus: liveCheck?.status || null,view});
    if (liveCheck) draft.liveCheck = liveCheck;
    return draft;
  }
  async function withLiveCheck(req, value, view = 'desktop', {force = false} = {}) {
    const identity = requestIdentity(req);
    if (!identity) throw new InvalidDraftDataError('company_access_required');
    const key = liveCheckCacheKey(value, view, identity.kind);
    const result = await checkCache.getOrLoad(
      key,
      () => withLiveCheckUncached(req, value, view),
      {force},
    );
    const draft = result.value;
    draft.liveCheckMode = result.mode;
    draft.liveCheckCached = ['cached', 'shared'].includes(result.mode);
    draft.liveCheckPending = false;
    return draft;
  }

  function deferredLiveCheck(value, view = 'desktop') {
    const draft = publicDraft(value, {view});
    if (value.views) {
      draft.liveChecks = Object.fromEntries(['desktop', 'mobile'].map(checkView => {
        const candidate = publicDraft(value, {view:checkView});
        const shouldCheck = Boolean(candidate.liveSource || candidate.latestPagePublication);
        return [checkView, shouldCheck ? {status:'pending',checkedAt:null} : null];
      }));
      draft.liveCheck = draft.liveChecks[view];
    } else if (draft.liveSource || draft.latestPagePublication) {
      draft.liveCheck = {status:'pending',checkedAt:null};
    }
    draft.liveCheckMode = 'deferred';
    draft.liveCheckCached = false;
    draft.liveCheckPending = Boolean(draft.liveCheck
      || Object.values(draft.liveChecks || {}).some(Boolean));
    return draft;
  }

  return async function handler(req, res) {
    if (!authConfigured()) return fail(res, 503, 'auth_not_configured', {setupPending: true});
    const params = query(req);
    const action = params.get('action');
    const identity = requestIdentity(req);
    if (!identity) {
      const pageKey = params.get('pageKey');
      if (req.method === 'GET' && action === 'draft-html' && validPageKey(pageKey)
          && !hasAuthorizationHeader(req)) return redirectToTracker(res, pageKey, params.get('view'));
      return fail(res, 401, hasAuthorizationHeader(req) ? 'agent_access_denied' : 'company_access_required');
    }
    if (!storageConfigured()) return fail(res, 503, 'storage_not_configured', {setupPending: true, user: identity.user});

    if (req.method === 'GET' && action === 'working-pages') {
      try {
        const includeArchived = params.get('includeArchived');
        if (![null, '1'].includes(includeArchived)) return fail(res, 400, 'invalid_request');
        const current = await drafts.readManifest();
        const visible = current.data.drafts.filter(draft => {
          const status = draft.lifecycle?.status || 'active';
          return status === 'active' || (includeArchived === '1' && status === 'archived');
        });
        return sendJson(res, 200, {drafts: visible.map(publicDraft), user: identity.user});
      } catch { return fail(res, 503, 'review_unavailable'); }
    }

    if (req.method === 'POST' && [
      'copy-section', 'create-variation', 'start-versioning', 'promote-variation',
      'archive-variation', 'restore-variation', 'delete-variation',
    ].includes(action)) {
      if (identity.kind !== 'browser' || hasAuthorizationHeader(req)) return fail(res, 403, 'agent_scope_denied');
      if (!isSameOrigin(req)) return fail(res, 403, 'same_origin_required');
      const body = parsedJsonBody(req);
      if (!body) return fail(res, 400, 'invalid_request');
      try {
        if (action === 'start-versioning') {
          const result = await drafts.startVersioning({expectedPages:body.expectedPages, editor:identity.user});
          return sendJson(res, 200, {drafts:result.drafts.map(item=>publicDraft(item)), anchoredPageKeys:result.anchoredPageKeys, user:identity.user});
        }
        if (action === 'create-variation') {
          const result = await drafts.createVariation({pageKey:body.pageKey, expectedRevision:body.expectedRevision, name:body.name, editor:identity.user});
          try { await captureRevision(result.draft.pageKey, result.draft.currentRevisionId, {drafts, review:store}); } catch {}
          const latest = (await drafts.getDraft(result.draft.pageKey)).draft || result.draft;
          return sendJson(res, 201, {draft:publicDraft(latest), user:identity.user});
        }
        if (action === 'promote-variation') {
          const result = await drafts.promoteVariation({
            pageKey:body.pageKey,expectedRevision:body.expectedRevision,
            expectedUpdatedAt:body.expectedUpdatedAt,
            expectedMainRevision:body.expectedMainRevision,
            releaseType:body.releaseType,changeSummary:body.changeSummary,
            editor:identity.user,
          });
          // Promotion already saves both immutable working views atomically. The existing
          // capture monitor records their pending screenshots without holding this request
          // open for two browser captures.
          const latestMain = result.draft;
          const latestVariation = result.variation;
          return sendJson(res, 201, {
            draft:publicDraft(latestMain),draftMain:publicDraft(latestMain),
            variation:publicDraft(latestVariation),
            user:identity.user,
          });
        }
        if (['archive-variation', 'restore-variation', 'delete-variation'].includes(action)) {
          const lifecycleAction = action.slice(0, action.indexOf('-'));
          const result = await drafts.changeVariationLifecycle({
            action:lifecycleAction,pageKey:body.pageKey,
            expectedRevision:body.expectedRevision,
            expectedUpdatedAt:body.expectedUpdatedAt,
            confirmationName:body.confirmationName,editor:identity.user,
          });
          return sendJson(res, 200, {draft:publicDraft(result.draft),user:identity.user});
        }
        const result = await drafts.copySection({
          sourcePageKey:body.sourcePageKey, sourceSectionId:body.sourceSectionId,
          sourceRevision:body.sourceRevision, targets:body.targets, editor:identity.user,
          releaseType:body.releaseType, changeSummary:body.changeSummary,
        });
        // Each immutable page is saved atomically above. The existing cron captures
        // pending screenshots without stretching a multi-page edit past its request budget.
        return sendJson(res, 201, {drafts:result.drafts.map(publicDraft), user:identity.user});
      } catch (error) {
        if (error instanceof DraftStoreConflictError) {
          const code = action === 'copy-section' ? 'section_copy_conflict'
            : action === 'promote-variation' ? 'variation_promotion_conflict'
              : ['archive-variation','restore-variation','delete-variation'].includes(action)
                ? 'variation_lifecycle_conflict'
                : 'draft_conflict';
          return fail(res, 409, code);
        }
        if (error instanceof InvalidDraftDataError) {
          if (['archived_variation', 'deleted_variation'].includes(error.code)) {
            return fail(res, error.code === 'deleted_variation' ? 410 : 409, error.code);
          }
          if ([
            'invalid_variation_lifecycle', 'invalid_variation_promotion',
            'variation_delete_confirmation_mismatch', 'variation_not_found',
            'variation_promotion_missing', 'variation_promotion_views_required',
          ].includes(error.code)) return fail(res, 400, error.code);
          const code = error.code === 'variation_name_conflict' ? 'variation_name_conflict'
            : action === 'copy-section' ? 'invalid_section_copy' : 'invalid_variation';
          return fail(res, 400, code);
        }
        return fail(res, 503, 'review_unavailable');
      }
    }

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
        const events = current.data.drafts
          .filter(draft => draft.lifecycle?.status !== 'deleted')
          .flatMap(draft => [
          ...draft.revisions.filter((item, index) => item.kind === 'initialized' && index > 0).map(item => ({
            id: item.id, type: 'source', sectionId: null,
            pageKey: draft.pageKey, family: draft.family, variant: draft.variant,
            pageLabel: draft.label, createdAt: item.createdAt, editor: item.editor,
            summary: item.sourceEvidence ? 'Working draft synced from live. Earlier versions remain in history.' : 'Working page updated from the selected Vercel source. Earlier versions remain in history.',
          })),
          ...draft.revisions.filter(item => ['edit','section-copy'].includes(item.kind)).map(item => ({
            id: item.id, type: item.operationType, sectionId: item.sectionId,
            pageKey: draft.pageKey, family: draft.family, variant: draft.variant,
            pageLabel: draft.label, createdAt: item.createdAt, editor: item.editor,
            summary: item.kind === 'section-copy' ? `Section copied from ${item.after.sourceSectionId}. This version is unsynced.` : item.operationType === 'text' ? String(item.after).slice(0, 240) : 'Replacement image saved',
          })),
          ...draft.revisions.filter(item => item.kind === 'variation-promotion').map(item => ({
            id:item.id,type:'variation-promotion',sectionId:null,
            pageKey:draft.pageKey,family:draft.family,variant:draft.variant,
            pageLabel:draft.label,createdAt:item.createdAt,editor:item.editor,
            summary:item.changeSummary,
          })),
          ...(draft.branch ? [{id:draft.revisions[0].id,type:'variation',sectionId:null,
            pageKey:draft.pageKey,family:draft.family,variant:draft.variant,pageLabel:draft.label,
            createdAt:draft.createdAt,editor:draft.revisions[0].editor,summary:`Variation created: ${draft.branch.name}`}]:[]),
          ...draft.publications.map(item => ({
            id: item.id, type: 'published', sectionId: item.sectionId,
            pageKey: draft.pageKey, family: draft.family, variant: draft.variant,
            pageLabel: draft.label, createdAt: item.confirmedAt, editor: item.editor,
            summary: 'Customer publication confirmed',
          })),
        ]).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(event => {
          const draft = publicDraft(current.data.drafts.find(item=>item.pageKey === event.pageKey));
          const publication = draft.publications.find(item=>item.id === event.id);
          const revision = draft.history.find(item=>item.id === (publication?.revisionId || event.id));
          return {...event, version:revision?.version, setup:revision?.setup, archiveNumber:revision?.archiveNumber,
            workingUrl:revision?.workingUrl, summary:revision?.changeSummary || event.summary};
        });
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
      const view = normalizedView(params.get('view'));
      const checkMode = params.get('check');
      if (!validPageKey(pageKey) || !view
          || ![null, 'defer', 'fresh'].includes(checkMode)) return fail(res, 400, 'invalid_draft');
      try {
        const current = await drafts.getDraft(pageKey);
        if (!current.draft) return fail(res, 404, 'draft_not_found');
        if (current.draft.lifecycle?.status === 'deleted') {
          return fail(res, 410, 'deleted_variation');
        }
        const draft = checkMode === 'defer'
          ? deferredLiveCheck(current.draft, view)
          : await withLiveCheck(req, current.draft, view, {force:checkMode === 'fresh'});
        return sendJson(res, 200, {draft, user: identity.user});
      } catch (error) {
        if (error instanceof InvalidDraftDataError) {
          if (['archived_variation', 'deleted_variation'].includes(error.code)) {
            return fail(res, error.code === 'deleted_variation' ? 410 : 409, error.code);
          }
          return fail(res, 400, 'invalid_draft');
        }
        return fail(res, 503, 'review_unavailable');
      }
    }

    if (req.method === 'GET' && action === 'draft-html') {
      if (identity.kind !== 'browser' || hasAuthorizationHeader(req)) return fail(res, 403, 'agent_scope_denied');
      const pageKey = params.get('pageKey');
      const view = normalizedView(params.get('view'));
      if (!validPageKey(pageKey) || !view) return fail(res, 404, 'draft_not_found');
      try {
        const current = await drafts.getDraft(pageKey);
        if (!current.draft) return fail(res, 404, 'draft_not_found');
        if (current.draft.lifecycle?.status === 'deleted') {
          return fail(res, 410, 'deleted_variation');
        }
        const revisionId = params.get('revision') || current.draft.currentRevisionId;
        const result = await drafts.getHtmlByRevision(current.draft, revisionId, view);
        if (!result) return fail(res, 404, 'draft_not_found');
        const embedded = params.get('embedded') === '1';
        const standalone = params.get('standalone') === '1' && !embedded;
        const requestedCheck = params.get('check');
        if (!embedded && ![null, 'defer', 'fresh'].includes(requestedCheck)) {
          return fail(res, 400, 'invalid_draft');
        }
        const deferred = requestedCheck === 'defer'
          || (standalone && requestedCheck === null);
        const inheritedCheck = embedded && !deferred
          ? readWorkingCheckReceipt(
            requestedCheck, pageKey, revisionId, identity.user.sub,
          ) : null;
        let checked = null;
        if (revisionId === current.draft.currentRevisionId) {
          if (deferred) {
            checked = deferredLiveCheck(current.draft, view);
          } else if (inheritedCheck) {
            checked = publicDraft(current.draft, {
              view,
              syncStatusByView:inheritedCheck.statuses,
            });
            checked.liveChecks = Object.fromEntries(['desktop', 'mobile'].map(checkView => [
              checkView,
              {status:inheritedCheck.statuses[checkView],checkedAt:new Date(inheritedCheck.iat * 1000).toISOString()},
            ]));
            checked.liveCheck = checked.liveChecks[view];
            checked.liveCheckMode = 'receipt';
            checked.liveCheckCached = true;
            checked.liveCheckPending = false;
          } else {
            checked = await withLiveCheck(req, current.draft, view, {
              force:requestedCheck === 'fresh'
                || (embedded && requestedCheck !== null && !inheritedCheck),
            });
          }
        }
        const publicValue = checked || publicDraft(current.draft, {view});
        res.setHeader('X-Funnel-Live-Check', checked?.liveCheckMode || 'historical');
        const checkedAt = checked?.liveCheck?.checkedAt;
        if (typeof checkedAt === 'string') res.setHeader('X-Funnel-Live-Checked-At', checkedAt);
        if (standalone) {
          return sendWorkingShell(res, req, {pageKey,revisionId,view,draft:publicValue});
        }
        return sendWorkingHtml(res, renderWorkingPage(current.draft, result.html, revisionId, {
          syncStatus:['current','changed','unavailable'].includes(checked?.liveCheck?.status)
            ? checked.liveCheck.status : null,
          syncStatusByView:checked?.liveChecks ? Object.fromEntries(
            ['desktop','mobile'].map(checkView => [
              checkView,['current','changed','unavailable']
                .includes(checked.liveChecks[checkView]?.status)
                ? checked.liveChecks[checkView].status : null,
            ]),
          ) : null,
          view,
          liveCheckPending:checked?.liveCheckPending === true,
        }), req);
      } catch {
        return fail(res, 503, 'review_unavailable');
      }
    }

    if (req.method === 'GET' && action === 'draft-screenshot') {
      if (identity.kind !== 'browser' || hasAuthorizationHeader(req)) return fail(res, 403, 'agent_scope_denied');
      const pageKey = params.get('pageKey');
      const revisionId = params.get('revision');
      const view = normalizedView(params.get('view'));
      if (!validPageKey(pageKey) || typeof revisionId !== 'string' || !view) return fail(res, 404, 'draft_not_found');
      try {
        const current = await drafts.getDraft(pageKey);
        if (current.draft?.lifecycle?.status === 'deleted') {
          return fail(res, 410, 'deleted_variation');
        }
        const result = await drafts.getScreenshot(pageKey, revisionId, view);
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

    if (req.method === 'POST' && action === 'sync-live') {
      if (identity.kind !== 'browser' || hasAuthorizationHeader(req)) return fail(res, 403, 'agent_scope_denied');
      if (!isSameOrigin(req)) return fail(res, 403, 'same_origin_required');
      const body = parsedJsonBody(req);
      const target = body && validPageKey(body.pageKey) ? getTarget(body.pageKey) : null;
      if (!target || target.variationOf || !['lander', 'results'].includes(target.family) || typeof body.expectedRevision !== 'string') {
        return fail(res, 400, 'invalid_draft');
      }
      try {
        const existing = await drafts.getDraft(body.pageKey);
        if (!existing.draft) return fail(res, 404, 'draft_not_found');
        if (existing.draft.currentRevisionId !== body.expectedRevision) throw new DraftStoreConflictError('draft revision conflict');
        const latestInitialization = existing.draft.revisions.findLastIndex(item => item.kind === 'initialized');
        if (existing.draft.revisions.slice(latestInitialization + 1).some(item => item.kind !== 'initialized')) {
          throw new DraftStoreConflictError('draft_has_unmerged_edits');
        }
        const [mapResult, trackerResult, source] = await Promise.all([
          store.readMap(), tracker.read(), liveSourceFetcher(body.pageKey, {tokenProvider: requestOidcTokenProvider(req)}),
        ]);
        const existingHtml = await drafts.getHtmlByRevision(existing.draft, existing.draft.currentRevisionId);
        const sectionNames = Object.fromEntries(trackerResult.data.sections.map(item => [item.id, item.name]));
        const mapped = buildVerifiedLiveRuntimeMap(body.pageKey, source, mapResult.data, sectionNames);
        const expectedSections = Object.keys(mapped.runtimeMap.sections);
        const alreadyMatches = publicDraft(existing.draft).liveSource
          && body.releaseType !== 'major'
          && ['synced-from-live','confirmed-live'].includes(compareLiveSourceEvidence(existing.draft, source.evidence))
          && expectedSections.length === existing.draft.workingBindings.length
          && expectedSections.every(id => existing.draft.workingBindings.some(item => item.sectionId === id))
          && existingHtml?.html.includes('data-funnel-working-style="2"');
        let latest = existing.draft;
        if (!alreadyMatches) {
          const result = await drafts.rebase({
            pageKey: body.pageKey, expectedRevision: body.expectedRevision,
            sourceHtml: source.html, sourceSha256: source.sha256, sourceEvidence: source.evidence,
            runtimeMap: mapped.runtimeMap, sectionNames, editor: identity.user,
            releaseType:body.releaseType, changeSummary:body.changeSummary,
          });
          latest = result.draft;
        }
        try {
          await captureRevision(body.pageKey, latest.currentRevisionId, {drafts, review: store});
          latest = (await drafts.getDraft(body.pageKey)).draft || latest;
        } catch {}
        const draft = publicDraft(latest);
        const matchStatus = compareLiveSourceEvidence(latest, source.evidence);
        draft.liveCheck = {status: matchStatus === 'check-needed' ? 'changed' : 'current', matchStatus, checkedAt: new Date().toISOString()};
        draft.sync = revisionSyncState(latest, latest.currentRevisionId, {syncStatus:draft.liveCheck.status});
        return sendJson(res, 200, {draft, synced: !alreadyMatches, user: identity.user});
      } catch (error) {
        if (error instanceof DraftStoreConflictError) {
          const latest = await drafts.getDraft(body.pageKey).catch(() => null);
          return fail(res, 409, error.message === 'draft_has_unmerged_edits' ? 'draft_has_unmerged_edits' : 'draft_conflict', {
            draft: latest?.draft ? publicDraft(latest.draft) : null,
          });
        }
        if (error instanceof LiveSourceError && error.code === 'live_sections_unmatched') {
          return fail(res, 422, 'live_sections_unmatched', {unmatched: error.details.unmatched.map(item => item.sectionId)});
        }
        if (error instanceof InvalidDraftDataError) {
          if (['archived_variation', 'deleted_variation'].includes(error.code)) {
            return fail(res, error.code === 'deleted_variation' ? 410 : 409, error.code);
          }
          return fail(res, 400, 'invalid_draft');
        }
        return fail(res, 503, 'live_source_unavailable');
      }
    }

    if (req.method === 'POST' && action === 'initialize-views') {
      if (identity.kind !== 'browser' || hasAuthorizationHeader(req)) return fail(res, 403, 'agent_scope_denied');
      if (!isSameOrigin(req)) return fail(res, 403, 'same_origin_required');
      const body = parsedJsonBody(req);
      const view = normalizedView(body?.view);
      if (!body || !validPageKey(body.pageKey)
          || !(body.expectedRevision === null || typeof body.expectedRevision === 'string')
          || !view || typeof liveViewsFetcher !== 'function') {
        return fail(res, 400, 'invalid_draft');
      }
      try {
        const initialized = await initializeWorkingViews({
          pageKey:body.pageKey,expectedRevision:body.expectedRevision,view,
          tokenProvider:requestOidcTokenProvider(req),drafts,review:store,tracker,
          fetchViews:liveViewsFetcher,editor:identity.user,
        });
        return sendJson(res, initialized.initialized ? 201 : 200, {
          draft:initialized.draft,user:identity.user,initialized:initialized.initialized,
        });
      } catch (error) {
        if (error instanceof DraftStoreConflictError) {
          const latest = await drafts.getDraft(body.pageKey).catch(() => null);
          return fail(res, 409, error.message === 'draft_has_unmerged_edits'
            ? 'draft_has_unmerged_edits' : 'draft_conflict', {
            draft:latest?.draft ? publicDraft(latest.draft, {view}) : null,
          });
        }
        if (error instanceof InvalidDraftDataError) return fail(res, 400, 'invalid_draft');
        if (error instanceof LiveSourceError) return fail(res, 503, 'live_source_unavailable');
        return fail(res, 503, 'review_unavailable');
      }
    }

    if (req.method === 'POST' && action === 'initialize-draft') {
      if (identity.kind !== 'browser' || hasAuthorizationHeader(req)) return fail(res, 403, 'agent_scope_denied');
      if (!isSameOrigin(req)) return fail(res, 403, 'same_origin_required');
      const body = parsedJsonBody(req);
      if (!body || !validPageKey(body.pageKey)) return fail(res, 400, 'invalid_draft');
      if (['bc','join'].includes(getTarget(body.pageKey)?.family)) {
        return fail(res, 400, 'invalid_draft');
      }
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
      const view = normalizedView(body.view);
      if (!view) return fail(res, 400, 'invalid_draft');
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
          view,
          scope:body.scope,
          releaseType: body.releaseType,
          changeSummary: body.changeSummary,
          editor: identity.user,
        });
        let latest = changed.draft;
        const captureViews = !changed.draft.views ? ['desktop']
          : (body.scope === undefined || body.scope === null || body.scope === ''
            || body.scope === 'shared') ? ['desktop','mobile'] : [view];
        for (const captureView of captureViews) {
          try {
            await captureRevision(body.pageKey, changed.revision.id, {
              drafts,review:store,view:captureView,
            });
            latest = (await drafts.getDraft(body.pageKey)).draft || latest;
          } catch {}
        }
        const publicLatest = publicDraft(latest, {view});
        return sendJson(res, 201, {
          draft: publicLatest,
          user: identity.user,
          event: publicLatest.history.find(item => item.id === changed.revision.id),
        });
      } catch (error) {
        if (error instanceof DraftStoreConflictError) {
          try {
            const latest = await drafts.getDraft(body.pageKey);
            return fail(res, 409, 'draft_conflict', {
              draft:latest.draft ? publicDraft(latest.draft, {view}) : null,
            });
          } catch {
            return fail(res, 409, 'draft_conflict');
          }
        }
        if (error instanceof InvalidDraftDataError) {
          if (['archived_variation', 'deleted_variation'].includes(error.code)) {
            return fail(res, error.code === 'deleted_variation' ? 410 : 409, error.code);
          }
          return fail(res, 400, 'invalid_draft');
        }
        return fail(res, 503, 'review_unavailable');
      }
    }

    if (req.method === 'POST' && ['confirm-published', 'confirm-page-published'].includes(action)) {
      if (identity.kind !== 'browser' || hasAuthorizationHeader(req)) return fail(res, 403, 'agent_scope_denied');
      if (!isSameOrigin(req)) return fail(res, 403, 'same_origin_required');
      const body = parsedJsonBody(req);
      if (!body) return fail(res, 400, 'invalid_publication');
      const view = normalizedView(body.view);
      if (!view) return fail(res, 400, 'invalid_publication');
      try {
        let liveEvidence = {};
        if (action === 'confirm-page-published') {
          const target = getTarget(body.pageKey);
          const paired = pairedLiveTargets(body.pageKey);
          if (paired.length) {
            const channel = paired.find(item => item.productionUrl === body.liveUrl);
            if (!channel || body.confirmed !== true) return fail(res, 400, 'invalid_publication');
            const observed = await liveSourceFetcher(target.variationOf || body.pageKey, {
              channel:channel.channel, view, tokenProvider:requestOidcTokenProvider(req),
            });
            liveEvidence = {
              liveContentSha256:observed.evidence.contentSha256,
              liveSourceCommit:observed.evidence.sourceCommit,
              ...(observed.evidence.comparisonVersion === undefined ? {} : {
                liveComparisonVersion:observed.evidence.comparisonVersion,
                liveComparisonSha256:observed.evidence.comparisonSha256,
              }),
            };
          }
        }
        const confirmed = await drafts.confirmPublished({
          pageKey:body.pageKey,revisionId:body.revisionId,
          sectionId:action === 'confirm-page-published' ? null : body.sectionId,
          view,
          confirmed:body.confirmed,liveUrl:body.liveUrl,note:body.note,...liveEvidence,editor:identity.user,
        });
        return sendJson(res, 201, {
          draft: publicDraft(confirmed.draft, {view}),
          user: identity.user,
          publication: confirmed.publication,
        });
      } catch (error) {
        if (error instanceof DraftStoreConflictError) return fail(res, 409, 'draft_conflict');
        if (error instanceof InvalidDraftDataError) {
          if (['archived_variation', 'deleted_variation'].includes(error.code)) {
            return fail(res, error.code === 'deleted_variation' ? 410 : 409, error.code);
          }
          return fail(res, 400, 'invalid_publication');
        }
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
  createWorkingCheckReceipt,
  createHandler,
  expectedOrigin,
  isSameOrigin,
  query,
  rawBody,
  readWorkingCheckReceipt,
  parsedJsonBody,
  requestIdentity,
};
