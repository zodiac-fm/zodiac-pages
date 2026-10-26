'use strict';

const {randomUUID} = require('node:crypto');
const {getVercelOidcToken} = require('@vercel/oidc');
const {TARGETS} = require('./production-catalog');
const {
  CaptureUnavailableError,
  CORPORATE_FINGERPRINT_ALGORITHM,
  FINGERPRINT_ALGORITHM,
  createProductionRenderer,
} = require('./production-renderer');
const {productionStore, validComparisonDetails} = require('./production-store');
const {reviewStore} = require('./review-store');

const PRODUCTION_ORIGINS = new Set(['https://zodiac.fm', 'https://app.zodiac.fm']);
const DRAFT_ORIGIN = 'https://zodiac-pages.vercel.app';
const ALLOWED_DRAFT_PATH = /^\/(?:landers|funnel|site)(?:\/|$)/;
const FAMILY_VARIANTS = Object.freeze({
  lander: new Set(['g', 'a', 'm']),
  results: new Set(['g', 'a', 'm']),
  bc: new Set(['shared']),
  join: new Set(['paid', 'free']),
  corporate: new Set(['home']),
});
const OIDC_TOKEN_TIMEOUT_MS = 5000;
const TARGET_CHECK_TIMEOUT_MS = 20000;
const RENDERER_CLOSE_TIMEOUT_MS = 5000;
const MONITOR_BUDGET_MS = 700000;
const MAX_CHANGE_SUMMARY_ITEMS = 50;
const REVIEW_MAP_TIMEOUT_MS = 3000;

function expectedFingerprintAlgorithm(target) {
  return target?.id === 'corporate-home'
    && target.family === 'corporate'
    && target.variant === 'home'
    && target.captureKind === 'public-site'
    ? CORPORATE_FINGERPRINT_ALGORITHM
    : FINGERPRINT_ALGORITHM;
}

class InvalidProductionRequestError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

async function acquireOidcToken(tokenProvider = getVercelOidcToken, timeoutMs = OIDC_TOKEN_TIMEOUT_MS) {
  if (typeof tokenProvider !== 'function' || !Number.isSafeInteger(timeoutMs)
      || timeoutMs < 1 || timeoutMs > 30000) {
    throw new CaptureUnavailableError(
      'snapshot_auth_unavailable',
      'The production snapshot connection is not authenticated.',
    );
  }
  let timer;
  try {
    const token = await Promise.race([
      Promise.resolve().then(() => tokenProvider()),
      new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error('oidc token acquisition timed out')), timeoutMs);
      }),
    ]);
    if (typeof token !== 'string' || token.length < 64 || token.length > 16384
        || /\s/.test(token)) throw new Error('invalid oidc token');
    return token;
  } catch {
    throw new CaptureUnavailableError(
      'snapshot_auth_unavailable',
      'The production snapshot connection is not authenticated.',
    );
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function cachedOidcTokenProvider(tokenProvider = getVercelOidcToken, timeoutMs = OIDC_TOKEN_TIMEOUT_MS) {
  let pending = null;
  return () => {
    if (!pending) pending = acquireOidcToken(tokenProvider, timeoutMs);
    return pending;
  };
}

function requestOidcTokenProvider(req, fallback = getVercelOidcToken) {
  const value = req?.headers?.['x-vercel-oidc-token'];
  const token = typeof value === 'string' ? value.trim() : '';
  return token ? () => Promise.resolve(token) : fallback;
}

async function closeRendererWithin(renderer, timeoutMs = RENDERER_CLOSE_TIMEOUT_MS) {
  if (!renderer || typeof renderer.close !== 'function') return;
  let timer;
  try {
    await Promise.race([
      Promise.resolve().then(() => renderer.close()).catch(() => undefined),
      new Promise(resolve => { timer = setTimeout(resolve, timeoutMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function parseHttpsUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return null;
    return url;
  } catch {
    return null;
  }
}

function validateDraftUrl(value) {
  const url = parseHttpsUrl(value);
  return url && url.origin === DRAFT_ORIGIN && ALLOWED_DRAFT_PATH.test(url.pathname)
    ? url.href : null;
}

function normalizedText(value, min, max) {
  if (typeof value !== 'string') return null;
  const text = value.trim().replace(/\s+/g, ' ');
  if (text.length < min || text.length > max || /[\u0000-\u001f\u007f]/.test(text)) return null;
  return text;
}

function normalizedCustomTarget(payload, editor, now = new Date(), idFactory = randomUUID) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new InvalidProductionRequestError('invalid_registration');
  }
  const name = normalizedText(payload.name, 1, 120);
  const family = normalizedText(payload.family, 1, 40)?.toLowerCase();
  const variant = normalizedText(payload.variant, 1, 80)?.toLowerCase();
  const productionUrl = validateDraftUrl(payload.url);
  if (!name || !family || !FAMILY_VARIANTS[family]?.has(variant) || !productionUrl
      || !editor || typeof editor.sub !== 'string' || typeof editor.email !== 'string'
      || typeof editor.name !== 'string') {
    throw new InvalidProductionRequestError('invalid_registration');
  }
  return {
    id: `draft-custom-${idFactory()}`,
    name,
    family,
    variant,
    productionUrl,
    stage: 'draft',
    channel: 'draft',
    sourceRepo: 'zodiac-fm/zodiac-pages',
    snapshotPath: null,
    captureKind: 'draft',
    registeredAt: now.toISOString(),
    editor: {sub: editor.sub, email: editor.email, name: editor.name},
  };
}

function publicCustomTarget(target) {
  return {
    id: target.id,
    family: target.family,
    variant: target.variant,
    category: 'custom',
    channel: 'draft',
    label: target.name,
    stage: 'draft',
    productionUrl: target.productionUrl,
    sourceRepo: target.sourceRepo,
    snapshotPath: null,
    captureKind: 'draft',
    expectedOffer: null,
    registeredAt: target.registeredAt,
    editor: target.editor,
  };
}

async function registerDraftTarget({
  payload,
  editor,
  store = productionStore,
  now = new Date(),
  idFactory,
  catalogTargets = TARGETS,
} = {}) {
  const target = normalizedCustomTarget(payload, editor, now, idFactory);
  await store.mutate((manifest) => {
    if (catalogTargets.some(existing => existing.productionUrl === target.productionUrl)
        || manifest.customTargets.some(existing => existing.productionUrl === target.productionUrl)) {
      throw new InvalidProductionRequestError('duplicate_draft');
    }
    manifest.customTargets.push(target);
    manifest.updatedAt = now.toISOString();
    return manifest;
  });
  return publicCustomTarget(target);
}

function validateCatalogTarget(target) {
  if (!target || typeof target !== 'object' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,179}$/.test(target.id || '')
      || !['draft', 'production'].includes(target.stage)) {
    throw new InvalidProductionRequestError('invalid_target');
  }
  const productionUrl = parseHttpsUrl(target.productionUrl);
  if (!productionUrl) throw new InvalidProductionRequestError('invalid_target');
  if (target.stage === 'draft') {
    if (!validateDraftUrl(target.productionUrl) || target.snapshotPath !== null) {
      throw new InvalidProductionRequestError('invalid_target');
    }
    return {captureUrl: productionUrl.href, protectedFeed: false};
  }
  const corporateHomepage = target.id === 'corporate-home'
    && target.family === 'corporate'
    && target.variant === 'home'
    && target.category === 'home'
    && target.channel === 'direct'
    && target.label === 'Corporate homepage'
    && target.productionUrl === 'https://zodiac.fm/'
    && productionUrl.href === 'https://zodiac.fm/'
    && target.sourceRepo === 'zodiac-fm/zodiac-website'
    && target.snapshotPath === null
    && target.captureKind === 'public-site'
    && target.expectedOffer === null;
  if (corporateHomepage) return {captureUrl: productionUrl.href, protectedFeed: false};
  const snapshotUrl = parseHttpsUrl(target.snapshotPath);
  if (!PRODUCTION_ORIGINS.has(productionUrl.origin) || !snapshotUrl
      || snapshotUrl.origin !== productionUrl.origin || snapshotUrl.pathname !== '/api/funnel-snapshot'
      || snapshotUrl.searchParams.get('category') !== target.category
      || snapshotUrl.searchParams.get('channel') !== target.channel) {
    throw new InvalidProductionRequestError('invalid_target');
  }
  return {captureUrl: snapshotUrl.href, protectedFeed: true};
}

function markerFields(marker) {
  if (typeof marker !== 'string' || marker.length < 1 || marker.length > 1000) return null;
  const result = {};
  for (const segment of marker.split(';')) {
    const separator = segment.indexOf('=');
    if (separator < 1) return null;
    const key = segment.slice(0, separator).trim();
    const value = segment.slice(separator + 1).trim();
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(key) || !value || result[key] !== undefined) return null;
    result[key] = value;
  }
  return result;
}

function invalidFeedCapture(code) {
  throw new CaptureUnavailableError(
    code,
    'The production snapshot connection returned incomplete or mismatched metadata.',
  );
}

function validateFeedCapture(target, capture) {
  const headers = capture.responseHeaders || {};
  const category = headers['x-funnel-snapshot-category'];
  const channel = headers['x-funnel-snapshot-channel'];
  const sourceCommit = headers['x-funnel-snapshot-source-commit'];
  const fingerprint = headers['x-funnel-snapshot-fingerprint'];
  const environment = headers['x-funnel-snapshot-environment'];
  const synthetic = headers['x-funnel-snapshot-synthetic'];
  if (!capture.snapshotRoot) invalidFeedCapture('snapshot_root_missing');
  if (typeof category !== 'string' || !category) invalidFeedCapture('snapshot_category_missing');
  if (category !== target.category) invalidFeedCapture('snapshot_category_mismatch');
  if (typeof channel !== 'string' || !channel) invalidFeedCapture('snapshot_channel_missing');
  if (channel !== target.channel) invalidFeedCapture('snapshot_channel_mismatch');
  if (typeof sourceCommit !== 'string' || !sourceCommit) invalidFeedCapture('snapshot_source_commit_missing');
  if (!/^[a-fA-F0-9]{40}$/.test(sourceCommit)) invalidFeedCapture('snapshot_source_commit_invalid');
  if (typeof fingerprint !== 'string' || !fingerprint) invalidFeedCapture('snapshot_body_fingerprint_missing');
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) invalidFeedCapture('snapshot_body_fingerprint_invalid');
  if (!/^[a-f0-9]{64}$/.test(capture.responseBodySha256 || '')) {
    invalidFeedCapture('snapshot_body_digest_invalid');
  }
  if (typeof environment !== 'string' || !environment) invalidFeedCapture('snapshot_environment_missing');
  if (environment !== 'production') invalidFeedCapture('snapshot_environment_mismatch');
  if (typeof capture.marker !== 'string' || !capture.marker) invalidFeedCapture('snapshot_marker_missing');
  const marker = markerFields(capture.marker);
  if (!marker) invalidFeedCapture('snapshot_marker_invalid');
  if (!marker.category) invalidFeedCapture('snapshot_marker_category_missing');
  if (marker.category !== category) invalidFeedCapture('snapshot_marker_category_mismatch');
  if (!marker.channel) invalidFeedCapture('snapshot_marker_channel_missing');
  if (marker.channel !== channel) invalidFeedCapture('snapshot_marker_channel_mismatch');
  if (!marker.sourceCommit) invalidFeedCapture('snapshot_marker_source_commit_missing');
  if (marker.sourceCommit.toLowerCase() !== sourceCommit.toLowerCase()) {
    invalidFeedCapture('snapshot_marker_source_commit_mismatch');
  }
  if (!marker.env) invalidFeedCapture('snapshot_marker_environment_missing');
  if (marker.env !== 'production') invalidFeedCapture('snapshot_marker_environment_mismatch');
  if (target.family === 'results') {
    if (!synthetic || !marker.synthetic) invalidFeedCapture('snapshot_synthetic_missing');
    if (synthetic !== 'true' || marker.synthetic !== 'true') {
      invalidFeedCapture('snapshot_synthetic_mismatch');
    }
  }
  if (fingerprint !== capture.responseBodySha256) {
    invalidFeedCapture('snapshot_body_fingerprint_mismatch');
  }
  return {sourceCommit: sourceCommit.toLowerCase(), sourceFingerprint: fingerprint};
}

function responseDate(value) {
  const time = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function emptyTargetState(targetId, checkedAt, status, error = null) {
  return {
    id: targetId,
    status,
    lastCheckedAt: checkedAt,
    lastChangedAt: null,
    lastResponseAt: null,
    currentArchiveId: null,
    sourceCommit: null,
    sourceFingerprint: null,
    renderFingerprint: null,
    comparisonVersion: null,
    comparisonDetails: null,
    error,
    archives: [],
  };
}

function comparisonChangeSummary(before, after) {
  if (!validComparisonDetails(before) || !validComparisonDetails(after)
      || before.version !== after.version) {
    return {diagnosticBaseline: true};
  }
  const beforeResources = new Map(before.resources.map(resource => [
    `${resource.type}\u0000${resource.url}`,
    resource,
  ]));
  const afterResources = new Map(after.resources.map(resource => [
    `${resource.type}\u0000${resource.url}`,
    resource,
  ]));
  const resourcesAdded = [];
  const resourcesRemoved = [];
  const resourcesChanged = [];
  for (const [key, resource] of afterResources) {
    const prior = beforeResources.get(key);
    if (!prior) resourcesAdded.push(resource);
    else if (prior.bodySha256 !== resource.bodySha256) {
      resourcesChanged.push({
        type: resource.type,
        url: resource.url,
        beforeBodySha256: prior.bodySha256,
        afterBodySha256: resource.bodySha256,
      });
    }
  }
  for (const [key, resource] of beforeResources) {
    if (!afterResources.has(key)) resourcesRemoved.push(resource);
  }
  const byResource = (left, right) => `${left.type}\u0000${left.url}`.localeCompare(`${right.type}\u0000${right.url}`);
  resourcesAdded.sort(byResource);
  resourcesRemoved.sort(byResource);
  resourcesChanged.sort(byResource);
  return {
    diagnosticBaseline: false,
    mainHtmlChanged: before.mainHtmlSha256 !== after.mainHtmlSha256,
    normalizedDomChanged: before.normalizedDomSha256 !== after.normalizedDomSha256,
    inlineCssChanged: before.inlineCssSha256 !== after.inlineCssSha256,
    resourceSetChanged: before.resourceSetSha256 !== after.resourceSetSha256,
    resourcesAddedCount: resourcesAdded.length,
    resourcesRemovedCount: resourcesRemoved.length,
    resourcesChangedCount: resourcesChanged.length,
    resourceChangesTruncated: resourcesAdded.length > MAX_CHANGE_SUMMARY_ITEMS
      || resourcesRemoved.length > MAX_CHANGE_SUMMARY_ITEMS
      || resourcesChanged.length > MAX_CHANGE_SUMMARY_ITEMS,
    resourcesAdded: resourcesAdded.slice(0, MAX_CHANGE_SUMMARY_ITEMS),
    resourcesRemoved: resourcesRemoved.slice(0, MAX_CHANGE_SUMMARY_ITEMS),
    resourcesChanged: resourcesChanged.slice(0, MAX_CHANGE_SUMMARY_ITEMS),
  };
}

function bindingsForTarget(runtimeMap, target) {
  if (target?.stage !== 'draft' || !runtimeMap?.sections) return [];
  return Object.entries(runtimeMap.sections)
    .filter(([, item]) => item.previewUrl === target.productionUrl)
    .map(([sectionId, item]) => ({
      sectionId,
      selector: item.selector,
      element: {
        tag: item.element.tag,
        id: item.element.id,
        classes: [...item.element.classes],
      },
      firstHeading: item.firstHeading === null ? null : {...item.firstHeading},
    }));
}

function sectionBindingDiagnostics(plan, results, checkedAt) {
  if (plan === null) return null;
  if (!plan.available) {
    return {status: 'unavailable', checkedAt, total: 0, mapped: 0, unmapped: 0, items: []};
  }
  const allowedCodes = new Set([
    'ok', 'binding_check_failed', 'binding_invalid', 'classes_mismatch', 'heading_mismatch',
    'heading_missing', 'heading_unexpected', 'id_mismatch', 'selector_invalid',
    'selector_missing', 'selector_not_unique', 'tag_mismatch',
  ]);
  const byId = new Map();
  for (const result of Array.isArray(results) ? results : []) {
    if (result && typeof result.sectionId === 'string' && !byId.has(result.sectionId)) byId.set(result.sectionId, result);
  }
  const items = plan.bindings.map(binding => {
    const result = byId.get(binding.sectionId);
    if (!result || !['mapped', 'unmapped'].includes(result.status) || !allowedCodes.has(result.code)
        || (result.status === 'mapped') !== (result.code === 'ok')) {
      return {sectionId: binding.sectionId, status: 'unmapped', code: 'binding_check_failed'};
    }
    return {sectionId: binding.sectionId, status: result.status, code: result.code};
  });
  const mapped = items.filter(item => item.status === 'mapped').length;
  const unmapped = items.length - mapped;
  return {
    status: items.length > 0 && unmapped === 0 ? 'mapped' : 'unmapped',
    checkedAt,
    total: items.length,
    mapped,
    unmapped,
    items,
  };
}

async function resolveBindingPlan(target, review, suppliedMap) {
  if (target?.stage !== 'draft') return null;
  let runtimeMap = suppliedMap;
  if (runtimeMap === undefined) {
    runtimeMap = await readSectionMap(review);
  }
  if (!runtimeMap) return {available: false, bindings: []};
  return {available: true, bindings: bindingsForTarget(runtimeMap, target)};
}

async function readSectionMap(review, timeoutMs = REVIEW_MAP_TIMEOUT_MS) {
  let timer;
  const load = Promise.resolve().then(() => review.readMap()).then(result => result.data).catch(() => false);
  try {
    return await Promise.race([
      load,
      new Promise(resolve => { timer = setTimeout(() => resolve(false), timeoutMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isStaleCheck(prior, checkedAt) {
  return prior && Number.isFinite(Date.parse(prior.lastCheckedAt))
    && Date.parse(prior.lastCheckedAt) >= Date.parse(checkedAt);
}

async function recordFailure({store, targetId, checkedAt, status, code, message}) {
  const error = {code, message, at: checkedAt};
  const stored = await store.mutate((manifest) => {
    const existing = manifest.targets[targetId];
    if (isStaleCheck(existing, checkedAt)) return manifest;
    const prior = existing || emptyTargetState(targetId, checkedAt, status, error);
    manifest.targets[targetId] = {
      ...prior,
      status,
      lastCheckedAt: checkedAt,
      error,
    };
    manifest.updatedAt = checkedAt;
    return manifest;
  });
  return stored.data.targets[targetId];
}

async function checkTargetWork(target, {
  store = productionStore,
  renderer = null,
  tokenProvider = getVercelOidcToken,
  now = () => new Date(),
  idFactory = randomUUID,
  tokenTimeoutMs = OIDC_TOKEN_TIMEOUT_MS,
  review = reviewStore,
  sectionMap,
} = {}) {
  const ownRenderer = !renderer;
  const activeRenderer = renderer || createProductionRenderer();
  try {
  const checkedAt = now().toISOString();
  let normalized;
  try {
    normalized = validateCatalogTarget(target);
    const bindingPlan = await resolveBindingPlan(target, review, sectionMap);
    const requestHeaders = {};
    if (normalized.protectedFeed) {
      const token = await acquireOidcToken(tokenProvider, tokenTimeoutMs);
      requestHeaders['X-Funnel-Tracker-Token'] = token;
    }
    const comparisonVersion = expectedFingerprintAlgorithm(target);
    const capture = await activeRenderer.capture({
      url: normalized.captureUrl,
      requestHeaders,
      protectedFeed: normalized.protectedFeed,
      sectionBindings: bindingPlan?.bindings || [],
      fingerprintAlgorithm: comparisonVersion,
    });
    const sectionBindings = sectionBindingDiagnostics(
      bindingPlan,
      capture.sectionBindingResults,
      checkedAt,
    );
    const feed = normalized.protectedFeed
      ? validateFeedCapture(target, capture)
      : {sourceCommit: null, sourceFingerprint: capture.responseBodySha256};
    if (capture.fingerprintAlgorithm !== comparisonVersion
        || !/^[a-f0-9]{64}$/.test(capture.renderFingerprint || '')
        || !validComparisonDetails(capture.comparisonDetails)
        || capture.comparisonDetails.version !== comparisonVersion) {
      throw new CaptureUnavailableError(
        'invalid_comparison_fingerprint',
        'The page capture did not produce a valid comparison fingerprint.',
      );
    }
    const sourceResponseAt = responseDate(capture.responseDate);
    const before = await store.read();
    const existing = before.data.targets[target.id];
    if (existing?.comparisonVersion === comparisonVersion
        && existing.renderFingerprint === capture.renderFingerprint) {
      const stored = await store.mutate((manifest) => {
        const current = manifest.targets[target.id];
        if (isStaleCheck(current, checkedAt)) return manifest;
        const prior = current || emptyTargetState(target.id, checkedAt, 'current');
        manifest.targets[target.id] = {
          ...prior,
          status: 'current',
          lastCheckedAt: checkedAt,
          lastResponseAt: sourceResponseAt,
          sourceCommit: feed.sourceCommit,
          sourceFingerprint: feed.sourceFingerprint,
          renderFingerprint: capture.renderFingerprint,
          comparisonVersion,
          comparisonDetails: capture.comparisonDetails,
          ...(sectionBindings ? {sectionBindings} : {}),
          error: null,
        };
        manifest.updatedAt = checkedAt;
        return manifest;
      });
      const state = stored.data.targets[target.id];
      return {targetId: target.id, status: state.status, changed: false, archiveId: state.currentArchiveId, state};
    }

    const archiveId = idFactory();
    const blobPath = await store.putImage(target.id, archiveId, capture.image);
    const stored = await store.mutate((manifest) => {
      const existingState = manifest.targets[target.id];
      if (isStaleCheck(existingState, checkedAt)) return manifest;
      const prior = existingState || emptyTargetState(target.id, checkedAt, 'baseline');
      if (prior.comparisonVersion === comparisonVersion
          && prior.renderFingerprint === capture.renderFingerprint && prior.currentArchiveId) {
        manifest.targets[target.id] = {
          ...prior,
          status: 'current',
          lastCheckedAt: checkedAt,
          lastResponseAt: sourceResponseAt,
          sourceCommit: feed.sourceCommit,
          sourceFingerprint: feed.sourceFingerprint,
          comparisonVersion,
          comparisonDetails: capture.comparisonDetails,
          ...(sectionBindings ? {sectionBindings} : {}),
          error: null,
        };
        manifest.updatedAt = checkedAt;
        return manifest;
      }
      const comparisonBaseline = prior.comparisonVersion !== comparisonVersion;
      const kind = comparisonBaseline ? 'baseline' : 'changed';
      const archive = {
        id: archiveId,
        targetId: target.id,
        kind,
        stage: target.stage,
        createdAt: checkedAt,
        sourceUrl: target.productionUrl,
        sourceCommit: feed.sourceCommit,
        sourceResponseAt,
        sourceFingerprint: feed.sourceFingerprint,
        renderFingerprint: capture.renderFingerprint,
        comparisonVersion,
        comparisonBaseline,
        comparisonDetails: capture.comparisonDetails,
        changeSummary: comparisonChangeSummary(prior.comparisonDetails, capture.comparisonDetails),
        ...(sectionBindings ? {sectionBindings} : {}),
        imageSha256: capture.imageSha256,
        width: capture.width,
        height: capture.height,
        blobPath,
      };
      const migratedLastChangedAt = comparisonBaseline
        && comparisonVersion === CORPORATE_FINGERPRINT_ALGORITHM
        ? null
        : prior.lastChangedAt;
      manifest.targets[target.id] = {
        ...prior,
        status: kind,
        lastCheckedAt: checkedAt,
        lastChangedAt: comparisonBaseline ? migratedLastChangedAt : checkedAt,
        lastResponseAt: sourceResponseAt,
        currentArchiveId: archiveId,
        sourceCommit: feed.sourceCommit,
        sourceFingerprint: feed.sourceFingerprint,
        renderFingerprint: capture.renderFingerprint,
        comparisonVersion,
        comparisonDetails: capture.comparisonDetails,
        ...(sectionBindings ? {sectionBindings} : {}),
        error: null,
        archives: [...prior.archives, archive],
      };
      manifest.updatedAt = checkedAt;
      return manifest;
    });
    const state = stored.data.targets[target.id];
    const associated = state.currentArchiveId === archiveId;
    return {
      targetId: target.id,
      status: state.status,
      changed: associated && state.status === 'changed',
      archiveId: state.currentArchiveId,
      state,
    };
  } catch (error) {
    const connection = error instanceof CaptureUnavailableError
      || error instanceof InvalidProductionRequestError;
    const status = connection ? 'needs_connection' : 'error';
    const code = connection ? (error.code || 'needs_connection') : 'monitor_failed';
    const message = connection
      ? (error.message || 'The page connection needs attention before it can be archived.')
      : 'The production monitor could not complete this check.';
    let state = null;
    try {
      state = await recordFailure({store, targetId: target?.id || 'unknown', checkedAt, status, code, message});
    } catch {}
    const recorded = state?.lastCheckedAt === checkedAt;
    return {
      targetId: target?.id || null,
      status: recorded ? status : (state?.status || status),
      changed: false,
      archiveId: state?.currentArchiveId || null,
      state,
      error: recorded ? {code, message} : null,
    };
  }
  } finally {
    if (ownRenderer) await closeRendererWithin(activeRenderer);
  }
}

async function checkTarget(target, options = {}) {
  const timeoutMs = options.checkTimeoutMs ?? TARGET_CHECK_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) {
    throw new InvalidProductionRequestError('invalid_check_timeout');
  }
  let timer;
  const work = Promise.resolve().then(() => checkTargetWork(target, options));
  work.catch(() => undefined);
  try {
    return await Promise.race([
      work,
      new Promise(resolve => {
        timer = setTimeout(() => resolve({
          targetId: target?.id || null,
          status: 'error',
          changed: false,
          archiveId: null,
          state: null,
          timedOut: true,
          error: {
            code: 'check_timed_out',
            message: 'The page check exceeded its time limit. Its previous screenshots remain available.',
          },
        }), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function customTargets(manifest) {
  return manifest.customTargets.map(publicCustomTarget);
}

async function checkAllTargets(catalogTargets, {
  store = productionStore,
  renderer,
  rendererFactory = createProductionRenderer,
  tokenProvider,
  now,
  idFactory,
  tokenTimeoutMs = OIDC_TOKEN_TIMEOUT_MS,
  checkTimeoutMs = TARGET_CHECK_TIMEOUT_MS,
  budgetMs = MONITOR_BUDGET_MS,
  clock = Date.now,
  review = reviewStore,
} = {}) {
  if (!Number.isSafeInteger(budgetMs) || budgetMs < 1 || budgetMs > 750000
      || typeof clock !== 'function' || typeof rendererFactory !== 'function') {
    throw new InvalidProductionRequestError('invalid_monitor_budget');
  }
  const ownRenderer = !renderer;
  const deadline = clock() + budgetMs;
  const current = await store.read();
  const allTargets = [...catalogTargets, ...customTargets(current.data)];
  const targets = [
    ...allTargets.filter(target => target.stage === 'draft'),
    ...allTargets.filter(target => target.stage !== 'draft'),
  ];
  let sectionMap = false;
  if (targets.some(target => target.stage === 'draft')) {
    sectionMap = await readSectionMap(review);
  }
  const sharedTokenProvider = cachedOidcTokenProvider(
    tokenProvider || getVercelOidcToken,
    tokenTimeoutMs,
  );
  const results = [];
  for (const target of targets) {
    const remainingMs = deadline - clock() - RENDERER_CLOSE_TIMEOUT_MS;
    if (remainingMs < 1) {
      results.push({
        targetId: target.id,
        status: 'skipped',
        changed: false,
        archiveId: null,
        state: null,
        skipped: true,
        error: {
          code: 'monitor_budget_exhausted',
          message: 'The scheduled check reached its time limit before this page was checked.',
        },
      });
      continue;
    }
    const targetRenderer = renderer || rendererFactory();
    try {
      results.push(await checkTarget(target, {
        store,
        renderer: targetRenderer,
        tokenProvider: sharedTokenProvider,
        now,
        idFactory,
        tokenTimeoutMs,
        checkTimeoutMs: Math.min(checkTimeoutMs, remainingMs),
        review,
        sectionMap,
      }));
    } finally {
      if (ownRenderer) await closeRendererWithin(targetRenderer);
    }
  }
  return results;
}

module.exports = {
  ALLOWED_DRAFT_PATH,
  DRAFT_ORIGIN,
  FAMILY_VARIANTS,
  InvalidProductionRequestError,
  MONITOR_BUDGET_MS,
  OIDC_TOKEN_TIMEOUT_MS,
  PRODUCTION_ORIGINS,
  RENDERER_CLOSE_TIMEOUT_MS,
  REVIEW_MAP_TIMEOUT_MS,
  TARGET_CHECK_TIMEOUT_MS,
  acquireOidcToken,
  cachedOidcTokenProvider,
  checkAllTargets,
  checkTarget,
  closeRendererWithin,
  customTargets,
  comparisonChangeSummary,
  expectedFingerprintAlgorithm,
  bindingsForTarget,
  markerFields,
  isStaleCheck,
  normalizedCustomTarget,
  publicCustomTarget,
  requestOidcTokenProvider,
  registerDraftTarget,
  readSectionMap,
  resolveBindingPlan,
  sectionBindingDiagnostics,
  validateCatalogTarget,
  validateDraftUrl,
  validateFeedCapture,
};
