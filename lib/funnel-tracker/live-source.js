'use strict';

const {createHash} = require('node:crypto');
const parse5 = require('parse5');
const {getTarget, pairedLiveTargets} = require('./production-catalog');
const {
  acquireOidcToken,
  validateCatalogTarget,
  validateFeedCapture,
} = require('./production-monitor');
const {validateRuntimeMap} = require('./review-store');

const MAX_LIVE_SOURCE_BYTES = 12 * 1024 * 1024;
const LIVE_SOURCE_TIMEOUT_MS = 15000;
const HERO_CLASSES = new Set(['frequency-hero', 'ah2-hero']);

class LiveSourceError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.code = code;
    this.details = details;
  }
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function attrs(node) {
  return Object.fromEntries((node?.attrs || []).map(item => [item.name, item.value]));
}

function elements(node, result = []) {
  if (!node || typeof node !== 'object') return result;
  if (typeof node.tagName === 'string') result.push(node);
  for (const child of node.childNodes || []) elements(child, result);
  if (node.content) elements(node.content, result);
  return result;
}

function textContent(node) {
  if (!node) return '';
  if (node.nodeName === '#text') return node.value || '';
  return (node.childNodes || []).map(textContent).join('');
}

function normalizedText(node) {
  return textContent(node).trim().replace(/\s+/g, ' ');
}

function selectorMatches(node, selector) {
  if (selector.startsWith('#')) return attrs(node).id === selector.slice(1);
  const parts = selector.split('.');
  const tag = parts.shift();
  if (!/^[a-z][a-z0-9-]*$/.test(tag) || node.tagName !== tag) return false;
  const classes = new Set(String(attrs(node).class || '').split(/\s+/).filter(Boolean));
  return parts.every(item => classes.has(item));
}

function targetForDraft(pageKey, requestedChannel = null) {
  const draft = getTarget(pageKey);
  if (!draft || draft.stage !== 'draft' || !['lander', 'results'].includes(draft.family)) {
    throw new LiveSourceError('live_source_not_supported');
  }
  const defaultChannel = draft.family === 'lander' ? 'direct' : 'affiliate';
  const channel = requestedChannel || defaultChannel;
  const target = pairedLiveTargets(pageKey).find(item => item.channel === channel) || null;
  if (!target) throw new LiveSourceError('live_source_channel_not_available');
  const normalized = validateCatalogTarget(target);
  if (!normalized.protectedFeed) throw new LiveSourceError('live_source_feed_required');
  return {draft, target, normalized};
}

function snapshotMarker(document) {
  const nodes = elements(document);
  const meta = nodes.find(node => node.tagName === 'meta' && attrs(node).name === 'funnel-snapshot');
  return meta ? attrs(meta).content || null : null;
}

function normalizedContentSha256(html) {
  if (typeof html !== 'string') throw new LiveSourceError('invalid_live_source_content');
  const document = parse5.parse(html);
  const markers = elements(document)
    .filter(node => node.tagName === 'meta' && attrs(node).name === 'funnel-snapshot');
  if (markers.length !== 1 || !markers[0].parentNode?.childNodes) {
    throw new LiveSourceError('invalid_live_source_content');
  }
  const marker = markers[0];
  marker.parentNode.childNodes = marker.parentNode.childNodes.filter(node => node !== marker);
  return hash(Buffer.from(parse5.serialize(document), 'utf8'));
}

async function fetchVerifiedLiveSource(pageKey, {
  channel = null,
  fetcher = fetch,
  tokenProvider,
  timeoutMs = LIVE_SOURCE_TIMEOUT_MS,
} = {}) {
  if (typeof fetcher !== 'function' || !Number.isSafeInteger(timeoutMs)
      || timeoutMs < 1 || timeoutMs > 30000) {
    throw new LiveSourceError('invalid_live_source_request');
  }
  const {draft, target, normalized} = targetForDraft(pageKey, channel);
  const token = await acquireOidcToken(tokenProvider, Math.min(timeoutMs, 5000));
  let response;
  try {
    response = await fetcher(normalized.captureUrl, {
      method: 'GET',
      redirect: 'manual',
      credentials: 'omit',
      headers: {
        Accept: 'text/html',
        'X-Funnel-Tracker-Token': token,
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new LiveSourceError('live_source_unavailable', {cause: error});
  }
  const finalUrl = response?.url || normalized.captureUrl;
  const contentType = response?.headers?.get?.('content-type') || '';
  if (response?.status !== 200 || finalUrl !== normalized.captureUrl
      || !/^text\/html(?:;|$)/i.test(contentType)) {
    throw new LiveSourceError('invalid_live_source_response');
  }
  let buffer;
  try {
    buffer = Buffer.from(await response.arrayBuffer());
  } catch (error) {
    throw new LiveSourceError('live_source_unavailable', {cause: error});
  }
  if (buffer.length < 64 || buffer.length > MAX_LIVE_SOURCE_BYTES) {
    throw new LiveSourceError('invalid_live_source_size');
  }
  const html = buffer.toString('utf8');
  const document = parse5.parse(html);
  const responseHeaders = {};
  for (const [name, value] of response.headers.entries()) responseHeaders[name.toLowerCase()] = value;
  const capture = {
    responseHeaders,
    responseBodySha256: hash(buffer),
    marker: snapshotMarker(document),
    snapshotRoot: elements(document).some(node => attrs(node)['data-funnel-snapshot'] === 'true'),
  };
  let verified;
  try {
    verified = validateFeedCapture(target, capture);
  } catch (error) {
    throw new LiveSourceError('live_source_verification_failed', {cause: error});
  }
  const contentSha256 = normalizedContentSha256(html);
  return {
    html,
    sha256: capture.responseBodySha256,
    contentSha256,
    referenceUrl: draft.referenceUrl || draft.productionUrl,
    evidence: {
      kind: 'verified-live-snapshot',
      targetId: target.id,
      liveUrl: target.productionUrl,
      snapshotUrl: normalized.captureUrl,
      family: target.family,
      category: target.category,
      channel: target.channel,
      sourceCommit: verified.sourceCommit,
      sourceFingerprint: verified.sourceFingerprint,
      contentSha256,
      synthetic: target.family === 'results',
    },
  };
}

function classesFor(node) {
  return [...new Set(String(attrs(node).class || '').split(/\s+/).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function firstHeading(node) {
  const heading = elements(node).find(item => /^h[1-6]$/.test(item.tagName));
  return heading ? {tag: heading.tagName, text: normalizedText(heading)} : null;
}

function stableMatches(documentElements, sectionId, reference) {
  const direct = documentElements.filter(node => selectorMatches(node, reference.selector));
  if (direct.length === 1) return {nodes: direct, mode: 'reference-selector'};
  if (direct.length !== 0 || !/-01$/.test(sectionId) || !reference.firstHeading?.text) {
    return {nodes: direct, mode: 'reference-selector'};
  }
  const semantic = documentElements.filter(node => {
    if (node.tagName !== 'section') return false;
    const classes = classesFor(node);
    if (!classes.some(item => HERO_CLASSES.has(item))) return false;
    const heading = firstHeading(node);
    return heading?.text === reference.firstHeading.text;
  });
  return {nodes: semantic, mode: 'hero-role-heading'};
}

function assertVerifiedSource(pageKey, verifiedSource) {
  if (!verifiedSource || typeof verifiedSource.html !== 'string'
      || !/^[a-f0-9]{64}$/.test(verifiedSource.sha256 || '')
      || hash(Buffer.from(verifiedSource.html, 'utf8')) !== verifiedSource.sha256
      || normalizedContentSha256(verifiedSource.html) !== verifiedSource.contentSha256
      || !verifiedSource.evidence || verifiedSource.evidence.kind !== 'verified-live-snapshot') {
    throw new LiveSourceError('invalid_live_mapping_input');
  }
  const evidence = verifiedSource.evidence;
  const {draft, target, normalized} = targetForDraft(pageKey, evidence.channel);
  const exact = evidence.targetId === target.id
    && evidence.liveUrl === target.productionUrl
    && evidence.snapshotUrl === normalized.captureUrl
    && evidence.family === target.family
    && evidence.category === target.category
    && evidence.channel === target.channel
    && evidence.synthetic === (target.family === 'results')
    && /^[a-f0-9]{40}$/.test(evidence.sourceCommit || '')
    && evidence.sourceFingerprint === verifiedSource.sha256
    && evidence.contentSha256 === verifiedSource.contentSha256;
  if (!exact || verifiedSource.referenceUrl !== (draft.referenceUrl || draft.productionUrl)) {
    throw new LiveSourceError('invalid_live_mapping_input');
  }
  return {draft, target};
}

function buildVerifiedLiveRuntimeMap(pageKey, verifiedSource, referenceMap, sectionNames, now = new Date()) {
  if (!referenceMap?.sections || typeof referenceMap.sections !== 'object'
      || !sectionNames || typeof sectionNames !== 'object') {
    throw new LiveSourceError('invalid_live_mapping_input');
  }
  const {draft} = assertVerifiedSource(pageKey, verifiedSource);
  const expected = Object.entries(referenceMap.sections)
    .filter(([, item]) => item.previewUrl === draft.productionUrl);
  if (expected.length === 0) throw new LiveSourceError('live_sections_not_configured');
  const document = parse5.parse(verifiedSource.html);
  const documentElements = elements(document);
  const sections = {};
  const unmatched = [];
  const modes = {};
  for (const [sectionId, reference] of expected) {
    if (typeof sectionNames[sectionId] !== 'string') {
      unmatched.push({sectionId, code: 'section_name_missing'});
      continue;
    }
    const match = stableMatches(documentElements, sectionId, reference);
    if (match.nodes.length !== 1) {
      unmatched.push({
        sectionId,
        code: match.nodes.length === 0 ? 'selector_missing' : 'selector_not_unique',
        selector: reference.selector,
      });
      continue;
    }
    const node = match.nodes[0];
    const nodeAttrs = attrs(node);
    const classes = classesFor(node);
    const selector = nodeAttrs.id
      ? `#${nodeAttrs.id}`
      : `${node.tagName}${classes.map(item => `.${item}`).join('')}`;
    if (documentElements.filter(item => selectorMatches(item, selector)).length !== 1) {
      unmatched.push({sectionId, code: 'derived_selector_not_unique', selector});
      continue;
    }
    sections[sectionId] = {
      previewUrl: draft.productionUrl,
      selector,
      element: {tag: node.tagName, id: nodeAttrs.id || null, classes},
      firstHeading: firstHeading(node),
      gaps: [],
      sourceSha256: verifiedSource.sha256,
    };
    modes[sectionId] = match.mode;
  }
  if (unmatched.length > 0) {
    throw new LiveSourceError('live_sections_unmatched', {unmatched});
  }
  const runtimeMap = {
    schema: 1,
    generatedAt: now.toISOString(),
    sections,
  };
  validateRuntimeMap(runtimeMap);
  return {runtimeMap, modes, unmatched: []};
}

module.exports = {
  HERO_CLASSES,
  LIVE_SOURCE_TIMEOUT_MS,
  LiveSourceError,
  MAX_LIVE_SOURCE_BYTES,
  buildVerifiedLiveRuntimeMap,
  fetchVerifiedLiveSource,
  assertVerifiedSource,
  normalizedContentSha256,
  targetForDraft,
};
