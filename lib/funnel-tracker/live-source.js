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
const {createProductionRenderer} = require('./production-renderer');

const MAX_LIVE_SOURCE_BYTES = 12 * 1024 * 1024;
const LIVE_SOURCE_TIMEOUT_MS = 15000;
const BC_COMPARISON_VERSION = 'bc-hydrated-v1';
const VOLATILE_TRACE_META_NAMES = new Set(['baggage', 'sentry-trace']);
const HERO_CLASSES = new Set(['frequency-hero', 'ah2-hero']);
const SHARED_FOOTER_IDS = Object.freeze({lander: 'LF-00', results: 'RF-00'});

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
  if (!draft || draft.stage !== 'draft' || !['lander', 'results', 'bc', 'join'].includes(draft.family)) {
    throw new LiveSourceError('live_source_not_supported');
  }
  const defaultChannel = ['lander', 'bc'].includes(draft.family) ? 'direct'
    : draft.family === 'join' && draft.variant === 'paid' ? 'paid' : 'affiliate';
  const channel = requestedChannel || defaultChannel;
  const target = pairedLiveTargets(pageKey).find(item => item.channel === channel) || null;
  if (!target) throw new LiveSourceError('live_source_channel_not_available');
  const normalized = validateCatalogTarget(target);
  if (!normalized.protectedFeed && draft.family !== 'bc') throw new LiveSourceError('live_source_feed_required');
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

function comparisonDocument(html) {
  if (typeof html !== 'string') throw new LiveSourceError('invalid_live_source_content');
  const document = parse5.parse(html);
  const nodes = elements(document);
  const markers = nodes.filter(node => (
    node.tagName === 'meta' && attrs(node).name === 'funnel-snapshot'
  ));
  if (markers.length !== 1 || !markers[0].parentNode?.childNodes) {
    throw new LiveSourceError('invalid_live_source_content');
  }
  const ignored = new Set([
    markers[0],
    ...nodes.filter(node => node.tagName === 'meta' && node.parentNode?.tagName === 'head'
      && VOLATILE_TRACE_META_NAMES.has(attrs(node).name)),
  ]);
  for (const node of ignored) {
    if (node.parentNode?.childNodes) {
      node.parentNode.childNodes = node.parentNode.childNodes.filter(child => child !== node);
    }
  }
  return document;
}

// The public birth-chart page receives a new distributed-tracing context for
// every request. Those head metas are neither rendered content nor a source
// change, so BC live comparison uses a separately versioned digest that omits
// only the two proven request-scoped nodes. The legacy digest remains intact
// for validating immutable evidence written before this comparator existed.
function comparisonContentSha256(html) {
  return hash(Buffer.from(parse5.serialize(comparisonDocument(html)), 'utf8'));
}

function comparisonStructuralDigests(html) {
  const document = comparisonDocument(html);
  const nodes = elements(document);
  const one = (predicate) => {
    const matches = nodes.filter(predicate);
    return matches.length === 1 ? matches[0] : null;
  };
  const head = one(node => node.tagName === 'head');
  const body = one(node => node.tagName === 'body');
  const htmlRoot = one(node => node.tagName === 'html');
  const sortedAttrs = node => (node?.attrs || [])
    .map(({name,value}) => [name,value])
    .sort(([left],[right]) => left.localeCompare(right));
  const sectionNodes = {
    'BC-01':one(node => attrs(node).id === 'birth-chart-hero'),
    'BC-02':one(node => attrs(node).id === 'birth-information-form'),
    'BC-03':one(node => attrs(node).id === 'important-tip'),
    'BC-04':one(node => attrs(node).id === 'real-transformations'),
    'BC-05':one(node => node.tagName === 'footer'),
  };
  const nodeSha256 = node => node ? hash(Buffer.from(parse5.serializeOuter(node), 'utf8')) : null;
  return {
    version:BC_COMPARISON_VERSION,
    headSha256:nodeSha256(head),
    bodySha256:nodeSha256(body),
    rootAttributesSha256:hash(Buffer.from(JSON.stringify({
      html:sortedAttrs(htmlRoot),body:sortedAttrs(body),
    }), 'utf8')),
    sectionSha256:Object.fromEntries(Object.entries(sectionNodes)
      .map(([sectionId,node]) => [sectionId,nodeSha256(node)])),
    counts:{
      location:nodes.filter(node => attrs(node).id === 'location').length,
      desktopDateReady:nodes.filter(node => attrs(node).role === 'group'
        && attrs(node)['aria-label'] === 'Date of birth').length,
      mobileDateReady:nodes.filter(node => attrs(node)['data-funnel-mobile-date-ready'] === 'true').length,
    },
  };
}

async function fetchVerifiedLiveSource(pageKey, {
  channel = null,
  fetcher = fetch,
  tokenProvider,
  timeoutMs = LIVE_SOURCE_TIMEOUT_MS,
  view = 'desktop',
  rendererFactory = createProductionRenderer,
} = {}) {
  if (typeof fetcher !== 'function' || !Number.isSafeInteger(timeoutMs)
      || timeoutMs < 1 || timeoutMs > 30000) {
    throw new LiveSourceError('invalid_live_source_request');
  }
  const {draft, target, normalized} = targetForDraft(pageKey, channel);
  if (draft.family === 'bc') {
    if (!['desktop', 'mobile'].includes(view)) throw new LiveSourceError('invalid_live_source_request');
    // The public form hydrates a different date control for a coarse pointer.
    // Resolve the production app commit through its existing protected feed,
    // then capture a fresh public visit without a member session or submitted data.
    const appSource = await fetchVerifiedLiveSource('draft-results-g', {fetcher, tokenProvider, timeoutMs});
    const renderer = rendererFactory();
    try {
      const capture = await renderer.capture({url: normalized.captureUrl, view, includeDocumentHtml: true});
      if (capture.finalUrl !== normalized.captureUrl || typeof capture.documentHtml !== 'string') {
        throw new LiveSourceError('invalid_live_source_response');
      }
      const marker = `category=shared;channel=direct;sourceCommit=${appSource.evidence.sourceCommit};env=production`;
      const html = capture.documentHtml.replace('</head>', `<meta name="funnel-snapshot" content="${marker}"></head>`)
        .replace(/<body([^>]*)>/i, '<body$1 data-funnel-snapshot="true">');
      const sha256 = hash(Buffer.from(html, 'utf8'));
      const contentSha256 = normalizedContentSha256(html);
      const comparisonSha256 = comparisonContentSha256(html);
      return {html, sha256, contentSha256,
        referenceUrl: draft.referenceUrl || draft.productionUrl,
        evidence: {kind:'verified-live-render', targetId:target.id, liveUrl:target.productionUrl,
          snapshotUrl:normalized.captureUrl, family:target.family, category:target.category,
          channel:target.channel, sourceCommit:appSource.evidence.sourceCommit,
          sourceFingerprint:sha256, contentSha256, comparisonVersion:BC_COMPARISON_VERSION,
          comparisonSha256, synthetic:false, view}};
    } finally { await renderer.close().catch(() => undefined); }
  }
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
      synthetic: ['results', 'join'].includes(target.family),
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
      || !verifiedSource.evidence || !['verified-live-snapshot','verified-live-render'].includes(verifiedSource.evidence.kind)) {
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
    && evidence.synthetic === ['results', 'join'].includes(target.family)
    && (evidence.kind !== 'verified-live-render' || (target.family === 'bc' && ['desktop','mobile'].includes(evidence.view)))
    && /^[a-f0-9]{40}$/.test(evidence.sourceCommit || '')
    && evidence.sourceFingerprint === verifiedSource.sha256
    && evidence.contentSha256 === verifiedSource.contentSha256
    && (evidence.kind !== 'verified-live-render'
      || (evidence.comparisonVersion === BC_COMPARISON_VERSION
        && evidence.comparisonSha256 === comparisonContentSha256(verifiedSource.html)));
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
  if (draft.family === 'bc' || draft.family === 'join') {
    return buildWebFormRuntimeMap(draft, verifiedSource, sectionNames, now);
  }
  const expected = Object.entries(referenceMap.sections)
    .filter(([, item]) => item.previewUrl === draft.productionUrl);
  const sharedFooterId = SHARED_FOOTER_IDS[draft.family] || null;
  const sharedFooter = sharedFooterId ? referenceMap.sections[sharedFooterId] : null;
  if (sharedFooter && !expected.some(([sectionId]) => sectionId === sharedFooterId)) {
    expected.push([sharedFooterId, sharedFooter]);
  }
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
      const sharedFooterFailure = sectionId === sharedFooterId;
      unmatched.push({
        sectionId,
        code: sharedFooterFailure
          ? (match.nodes.length === 0 ? 'shared_footer_missing' : 'shared_footer_not_unique')
          : (match.nodes.length === 0 ? 'selector_missing' : 'selector_not_unique'),
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

function buildWebFormRuntimeMap(draft, source, sectionNames, now) {
  const documentElements = elements(parse5.parse(source.html));
  const selectors = draft.family === 'bc' ? {
    'BC-01':'#birth-chart-hero', 'BC-02':'#birth-information-form', 'BC-03':'#important-tip',
    'BC-04':'#real-transformations', 'BC-05':'footer',
  } : Object.fromEntries((draft.variant === 'paid' ? 'JP' : 'JF').split(',').flatMap(prefix =>
    ['offer-head','order','more','questions','voices','footer'].map((name,index) =>
      [`${prefix}-${String(index+1).padStart(2,'0')}`, `#funnel-join-${name}`])));
  const sections = {}, unmatched = [];
  for (const [sectionId, selector] of Object.entries(selectors)) {
    const matched = documentElements.filter(node=>selectorMatches(node,selector));
    if (matched.length !== 1 || typeof sectionNames[sectionId] !== 'string') {
      unmatched.push({sectionId,code:matched.length ? 'selector_not_unique' : 'selector_missing'});
      continue;
    }
    const node=matched[0];
    const classes=classesFor(node);
    sections[sectionId]={previewUrl:draft.productionUrl,selector,
      element:{tag:node.tagName,id:attrs(node).id||null,classes},firstHeading:firstHeading(node),gaps:[],sourceSha256:source.sha256};
  }
  if(unmatched.length)throw new LiveSourceError('live_sections_unmatched',{unmatched});
  const runtimeMap={schema:1,generatedAt:now.toISOString(),sections};
  validateRuntimeMap(runtimeMap);
  return {runtimeMap,modes:Object.fromEntries(Object.keys(sections).map(id=>[id,'live-web-form'])),unmatched:[]};
}

async function fetchVerifiedLiveViews(pageKey, {referenceMap, sectionNames, ...options} = {}) {
  const draft=getTarget(pageKey);
  if(!draft)throw new LiveSourceError('live_source_not_supported');
  const desktop=await fetchVerifiedLiveSource(pageKey,{...options,view:'desktop'});
  const mobile=draft.family === 'bc'
    ? await fetchVerifiedLiveSource(pageKey,{...options,view:'mobile'}) : desktop;
  return {sources:Object.fromEntries([['desktop',desktop],['mobile',mobile]].map(([view,source])=>{
    const mapped=buildVerifiedLiveRuntimeMap(pageKey,source,referenceMap,sectionNames);
    return [view,{sourceHtml:source.html,sourceSha256:source.sha256,runtimeMap:mapped.runtimeMap,sourceEvidence:source.evidence}];
  }))};
}

module.exports = {
  BC_COMPARISON_VERSION,
  HERO_CLASSES,
  LIVE_SOURCE_TIMEOUT_MS,
  LiveSourceError,
  MAX_LIVE_SOURCE_BYTES,
  buildVerifiedLiveRuntimeMap,
  fetchVerifiedLiveSource,
  fetchVerifiedLiveViews,
  buildWebFormRuntimeMap,
  assertVerifiedSource,
  comparisonContentSha256,
  comparisonStructuralDigests,
  normalizedContentSha256,
  targetForDraft,
};
