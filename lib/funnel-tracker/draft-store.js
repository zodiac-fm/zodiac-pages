'use strict';

const {createHash, randomUUID} = require('node:crypto');
const {BlobNotFoundError, BlobPreconditionFailedError, get, head, put} = require('@vercel/blob');
const parse5 = require('parse5');
const {
  getTarget, pairedLiveTargets, variationBaseId, variationPageKey,
} = require('./production-catalog');
const {
  BC_CAPTURE_VERSION,
  BC_COMPARISON_VERSION,
  BC_LEGACY_COMPARISON_VERSION,
  JOIN_COMPARISON_VERSION,
  comparisonContentSha256,
  normalizedContentSha256,
} = require('./live-source');
const {normalizedChangeMaterial} = require('./state');
const preparedLayoutRegistry = require('./prepared-layouts');

const DRAFT_MANIFEST_PATH = 'funnel-tracker/review/drafts.json';
const DRAFT_HTML_PREFIX = 'funnel-tracker/review/drafts';
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAX_SOURCE_BYTES = 12 * 1024 * 1024;
const MAX_SCREENSHOT_BYTES = 24 * 1024 * 1024;
const MAX_REVISIONS = 2000;
const MAX_PUBLICATIONS = 2000;
const MAX_DRAFTS = 100;
const MAX_CHANGE_SUMMARY_LENGTH = 300;
const SOURCE_FETCH_TIMEOUT_MS = 15000;
const DRAFT_VIEWS = Object.freeze(['desktop', 'mobile']);
const PREPARED_LANDER_SECTIONS = Object.freeze({
  g:Object.freeze(['LG-01','LG-02']),
  m:Object.freeze(['LM-01','LM-02']),
  a:Object.freeze(['LA-01','LA-02']),
});
const MAIN_LAYOUT_AMENDMENTS = Object.freeze({
  g:Object.freeze({layoutId:'general-desktop-srini-02',sectionId:'LG-02'}),
  m:Object.freeze({layoutId:'manifestation-desktop-srini-01',sectionId:'LM-02'}),
  a:Object.freeze({layoutId:'astrology-desktop-srini-01',sectionId:'LA-02'}),
});
const TEXT_TAGS = new Set([
  'a', 'b', 'blockquote', 'button', 'dd', 'dt', 'em', 'figcaption',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'i', 'label', 'li', 'p',
  'small', 'span', 'strong',
]);
const WORKING_TEXT_GUARD = `(()=>{
  if(window.__funnelWorkingTextGuard)return;
  window.__funnelWorkingTextGuard=true;
  document.addEventListener('click',event=>{
    const anchor=event.target.closest?.('a[href^="#"]');
    if(!anchor)return;
    const fragment=anchor.getAttribute('href').slice(1);
    let destination;
    try{destination=fragment?document.getElementById(decodeURIComponent(fragment)):document.body;}catch{return;}
    if(!destination)return;
    event.preventDefault();
    destination.scrollIntoView({behavior:'smooth',block:'start'});
  });
  const descriptor=Object.getOwnPropertyDescriptor(Node.prototype,'textContent');
  if(!descriptor||typeof descriptor.set!=='function')return;
  Object.defineProperty(Node.prototype,'textContent',{...descriptor,set(value){
    if(this&&this.nodeType===1){
      if(this.matches?.('funnel-copy[data-funnel-fixed="true"]'))return;
      if(this.querySelector?.('funnel-copy[data-funnel-fixed="true"]'))return;
      const children=Array.from(this.children||[]);
      const wrapper=children.length===1&&children[0].matches?.('funnel-copy[data-funnel-edit-id]')?children[0]:null;
      const otherText=Array.from(this.childNodes||[]).some(node=>node.nodeType===3&&String(node.textContent||'').trim());
      if(wrapper&&!otherText){descriptor.set.call(wrapper,value);return;}
    }
    descriptor.set.call(this,value);
  }});
})();`;

class DraftStoreUnavailableError extends Error {}
class DraftStoreConflictError extends Error {}
class InvalidDraftDataError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function validView(value) {
  return DRAFT_VIEWS.includes(value);
}

function normalizedView(value) {
  return value === undefined || value === null || value === '' ? 'desktop'
    : validView(value) ? value : null;
}

function normalizedEditScope(value, view = 'desktop') {
  const scope = value === undefined || value === null || value === '' ? 'shared' : value;
  return scope === 'shared' || scope === view ? scope : null;
}

function preparedLayoutMatchesTarget(draft, layout) {
  const target=getTarget(draft?.pageKey);
  const sectionIds=PREPARED_LANDER_SECTIONS[draft?.variant];
  return Boolean(target && sectionIds
    && target.family==='lander' && target.stage==='draft'
    && draft.family===target.family && draft.variant===target.variant
    && draft.category===target.category
    && layout.family===target.family && layout.variant===target.variant
    && sectionIds.includes(layout.sectionId) && layout.view==='desktop');
}

function availableMainLayoutAmendment(draft) {
  const amendment=MAIN_LAYOUT_AMENDMENTS[draft?.variant];
  if(!amendment || draft.branch || !draft.views || !draft.release
      || draft.currentRevisionId===draft.release.anchorRevisionId
      || draft.revisions.some(revision=>revision.layoutId===amendment.layoutId)
      || draft.publications.some(publication=>publication.revisionId===draft.currentRevisionId)) {
    return null;
  }
  const release=revisionReleaseState(draft,draft.currentRevisionId);
  if(release.version!=='1.1D'
      || release.sync.status!=='unsynced'
      || release.sync.views.desktop.status!=='unsynced'
      || release.sync.views.mobile.status!=='synced')return null;
  return amendment;
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function validIso(value) {
  return typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));
}

function validEditor(value) {
  return isPlainObject(value) && Object.keys(value).length === 3
    && typeof value.sub === 'string' && /^[A-Za-z0-9_-]{6,255}$/.test(value.sub)
    && typeof value.email === 'string' && value.email === value.email.toLowerCase()
    && /^[^@\s]+@zodiac\.fm$/.test(value.email)
    && typeof value.name === 'string' && value.name.length >= 1 && value.name.length <= 120
    && value.name === value.name.trim().replace(/\s+/g, ' ')
    && !/[\u0000-\u001f\u007f]/.test(value.name);
}

function normalizedText(value, min, max, preserveNewlines = false) {
  if (typeof value !== 'string') return null;
  const cleaned = preserveNewlines
    ? value.replace(/\r\n?/g, '\n').trim()
    : value.trim().replace(/\s+/g, ' ');
  return cleaned.length >= min && cleaned.length <= max
    && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(cleaned)
    ? cleaned : null;
}

function normalizedReleaseInput(releaseType = 'minor', changeSummary = null) {
  if (!['minor', 'major'].includes(releaseType)) {
    throw new InvalidDraftDataError('invalid_release_type');
  }
  const summary = changeSummary === undefined || changeSummary === null || changeSummary === ''
    ? null : normalizedText(changeSummary, 1, MAX_CHANGE_SUMMARY_LENGTH);
  if (changeSummary !== undefined && changeSummary !== null && changeSummary !== '' && !summary) {
    throw new InvalidDraftDataError('invalid_change_summary');
  }
  return {releaseType, changeSummary: summary};
}

function validPageKey(value) {
  const target = typeof value === 'string' ? getTarget(value) : null;
  return Boolean(target && target.stage === 'draft' && target.id === value);
}

function validMainPageKey(value) {
  return validPageKey(value) && variationBaseId(value) === null;
}

function validRevisionId(value) {
  return typeof value === 'string' && /^draftrev_[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(value);
}

function validPublicationId(value) {
  return typeof value === 'string' && /^publication_[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(value);
}

function validEditId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
}

function validSectionId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/.test(value);
}

function validAttachmentId(value) {
  return typeof value === 'string' && /^att_[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(value);
}

function validLiveUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return false;
    const labels = url.hostname.toLowerCase().split('.');
    return (url.hostname.toLowerCase() === 'zodiac.fm' || url.hostname.toLowerCase().endsWith('.zodiac.fm'))
      && !labels.some(label => ['dev', 'development', 'preview', 'staging', 'test'].includes(label));
  } catch {
    return false;
  }
}

function validSourceEvidence(value, pageKey, sourceSha256 = null) {
  const keys = isPlainObject(value) ? Object.keys(value).sort().join(',') : '';
  const snapshotKeys = 'category,channel,contentSha256,family,kind,liveUrl,snapshotUrl,sourceCommit,sourceFingerprint,synthetic,targetId';
  const snapshotViewKeys = `${snapshotKeys},view`.split(',').sort().join(',');
  const renderedKeys = snapshotViewKeys;
  const comparedRenderedKeys = `${renderedKeys},comparisonSha256,comparisonVersion`
    .split(',').sort().join(',');
  const comparedSnapshotKeys = `${snapshotKeys},comparisonSha256,comparisonVersion`
    .split(',').sort().join(',');
  const readyComparedRenderedKeys = `${renderedKeys},captureVersion,comparisonSha256,comparisonVersion`
    .split(',').sort().join(',');
  if (!isPlainObject(value)
      || ![snapshotKeys, comparedSnapshotKeys,
        snapshotViewKeys, renderedKeys,
        comparedRenderedKeys, readyComparedRenderedKeys].includes(keys)
      || !['verified-live-snapshot', 'verified-live-render'].includes(value.kind)
      || (value.kind === 'verified-live-render'
        && ![renderedKeys, comparedRenderedKeys, readyComparedRenderedKeys].includes(keys))
      || (value.kind === 'verified-live-snapshot'
        && ![snapshotKeys, snapshotViewKeys, comparedSnapshotKeys].includes(keys))
      || (keys === comparedSnapshotKeys
        && (value.kind !== 'verified-live-snapshot' || value.family !== 'join'))
      || ([comparedRenderedKeys, readyComparedRenderedKeys].includes(keys)
        && (value.kind !== 'verified-live-render' || value.family !== 'bc'))
      || (value.view !== undefined && !validView(value.view))
      || typeof value.targetId !== 'string'
      || !validLiveUrl(value.liveUrl)
      || !validLiveUrl(value.snapshotUrl)
      || typeof value.sourceCommit !== 'string' || !/^[a-f0-9]{40}$/.test(value.sourceCommit)
      || typeof value.sourceFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.sourceFingerprint)
      || typeof value.contentSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.contentSha256)
      || ([comparedRenderedKeys, readyComparedRenderedKeys, comparedSnapshotKeys].includes(keys)
        && (!(keys === comparedSnapshotKeys
          ? value.comparisonVersion === JOIN_COMPARISON_VERSION
          : [BC_LEGACY_COMPARISON_VERSION,BC_COMPARISON_VERSION]
            .includes(value.comparisonVersion))
          || typeof value.comparisonSha256 !== 'string'
          || !/^[a-f0-9]{64}$/.test(value.comparisonSha256)))
      || (keys === readyComparedRenderedKeys && value.captureVersion !== BC_CAPTURE_VERSION)
      || typeof value.synthetic !== 'boolean') return false;
  if (sourceSha256 !== null && value.sourceFingerprint !== sourceSha256) return false;
  const liveTarget = pairedLiveTargets(pageKey).find(item => item.id === value.targetId);
  const expectedSnapshotUrl = value.kind === 'verified-live-render'
    ? liveTarget?.productionUrl : liveTarget?.snapshotPath;
  return Boolean(liveTarget
    && liveTarget.productionUrl === value.liveUrl
    && expectedSnapshotUrl === value.snapshotUrl
    && liveTarget.family === value.family
    && liveTarget.category === value.category
    && liveTarget.channel === value.channel
    && (value.kind !== 'verified-live-render'
      || (value.family === 'bc' && value.snapshotUrl === value.liveUrl))
    && (value.synthetic === (liveTarget.family === 'results')
      || (liveTarget.family === 'join' && value.synthetic === true)));
}

function sourceEvidenceMatchesHtml(value, html) {
  if (value === null) return true;
  try {
    return value.contentSha256 === normalizedContentSha256(html)
      && (value.comparisonVersion === undefined
        || value.comparisonSha256 === comparisonContentSha256(html,value.comparisonVersion));
  } catch {
    return false;
  }
}

function validDraftSourceUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.origin === 'https://zodiac-pages.vercel.app'
      && !url.port && !url.hash && !url.username && !url.password
      && /^\/(?:landers|funnel|site)(?:\/|$)/.test(url.pathname);
  } catch {
    return false;
  }
}

function workingRevisionUrl(pageKey, sourceUrl, revisionId = null, sectionId = null, view = 'desktop') {
  const params = new URL(sourceUrl).searchParams;
  params.set('view', normalizedView(view) || 'desktop');
  if (revisionId) params.set('revision', revisionId);
  const query = params.toString();
  const fragment = sectionId ? `#funnel-section-${encodeURIComponent(sectionId)}` : '';
  return `/funnel/working/${encodeURIComponent(pageKey)}${query ? `?${query}` : ''}${fragment}`;
}

function absoluteWorkingUrl(pageKey, sourceUrl, revisionId = null, sectionId = null, view = 'desktop') {
  return `https://zodiac-pages.vercel.app${workingRevisionUrl(pageKey, sourceUrl, revisionId, sectionId, view)}`;
}

function getAttr(node, name) {
  return node?.attrs?.find(attribute => attribute.name === name)?.value ?? null;
}

function hasAttr(node, name) {
  return Boolean(node?.attrs?.some(attribute => attribute.name === name));
}

function setAttr(node, name, value) {
  if (!Array.isArray(node.attrs)) node.attrs = [];
  const existing = node.attrs.find(attribute => attribute.name === name);
  if (existing) existing.value = String(value);
  else node.attrs.push({name, value: String(value)});
}

function removeAttr(node, name) {
  if (Array.isArray(node.attrs)) node.attrs = node.attrs.filter(attribute => attribute.name !== name);
}

function elements(node, result = []) {
  if (!node || typeof node !== 'object') return result;
  if (typeof node.tagName === 'string') result.push(node);
  for (const child of node.childNodes || []) elements(child, result);
  if (node.content) elements(node.content, result);
  return result;
}

function selectorMatches(node, selector) {
  if (selector.startsWith('#')) return getAttr(node, 'id') === selector.slice(1);
  const parts = selector.split('.');
  const tag = parts.shift();
  if (!/^[a-z][a-z0-9-]*$/.test(tag) || node.tagName !== tag) return false;
  const classes = new Set(String(getAttr(node, 'class') || '').split(/\s+/).filter(Boolean));
  return parts.every(item => classes.has(item));
}

function findBySelector(document, selector) {
  if (typeof selector !== 'string' || !/^(?:#[A-Za-z0-9_-]+|[a-z][a-z0-9-]*(?:\.[A-Za-z_-][A-Za-z0-9_-]*)*)$/.test(selector)) {
    throw new InvalidDraftDataError('invalid_binding_selector');
  }
  return elements(document).filter(node => selectorMatches(node, selector));
}

function firstElement(document, tagName) {
  return elements(document).find(node => node.tagName === tagName) || null;
}

function textContent(node) {
  if (!node) return '';
  if (node.nodeName === '#text') return node.value || '';
  return (node.childNodes || []).map(textContent).join('');
}

function normalizedNodeText(node) {
  return textContent(node).trim().replace(/\s+/g, ' ');
}

function appendParsedFragment(parent, html) {
  const fragment = parse5.parseFragment(parent, html);
  const children = fragment.childNodes || [];
  parent.childNodes = [...(parent.childNodes || []), ...children];
  for (const child of children) child.parentNode = parent;
}

function prependParsedFragment(parent, html) {
  const fragment = parse5.parseFragment(parent, html);
  const children = fragment.childNodes || [];
  parent.childNodes = [...children, ...(parent.childNodes || [])];
  for (const child of children) child.parentNode = parent;
}

function installWorkingTextGuard(document) {
  if (elements(document).some(node => hasAttr(node, 'data-funnel-working-runtime'))) return;
  const head = firstElement(document, 'head');
  if (!head) throw new InvalidDraftDataError('invalid_source_html');
  prependParsedFragment(head, `<script data-funnel-working-runtime>${WORKING_TEXT_GUARD}</script>`);
}

function workingPageLabel(target) {
  const category = target.category === 'general' ? 'General'
    : target.category === 'manifesting' ? 'Manifestation'
      : target.category === 'astrology' ? 'Astrology & Human Design' : '';
  if (target.family === 'lander') return `${category} Lander`;
  if (target.family === 'results') return `${category} Results`;
  if (target.family === 'bc') return 'Birth Chart';
  if (target.family === 'join') return target.variant === 'paid' ? 'Paid Join' : 'Free Join';
  return target.label;
}

function preferredLiveTarget(target) {
  const liveTargets = pairedLiveTargets(target.id);
  const preferredChannel = target.family === 'lander' ? 'direct'
    : target.family === 'results' ? 'affiliate' : null;
  return liveTargets.find(item => item.channel === preferredChannel) || liveTargets[0] || null;
}

function trackerReviewUrl(target, sectionId = null) {
  const params = new URLSearchParams({
    mode: 'review', page: target.family, variant: target.variant, pageKey: target.id,
  });
  if (sectionId) params.set('section', sectionId);
  return `https://zodiac-pages.vercel.app/funnel/tracker/?${params.toString()}`;
}

function assertBinding(node, binding) {
  if (node.tagName !== binding.element.tag) throw new InvalidDraftDataError('binding_tag_mismatch');
  if ((getAttr(node, 'id') || null) !== binding.element.id) throw new InvalidDraftDataError('binding_id_mismatch');
  const classes = String(getAttr(node, 'class') || '').split(/\s+/).filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
  if (classes.length !== binding.element.classes.length
      || classes.some((item, index) => item !== binding.element.classes[index])) {
    throw new InvalidDraftDataError('binding_classes_mismatch');
  }
  const heading = elements(node).find(candidate => /^h[1-6]$/.test(candidate.tagName));
  if (binding.firstHeading === null) {
    if (heading) throw new InvalidDraftDataError('binding_heading_unexpected');
  } else if (!heading || heading.tagName !== binding.firstHeading.tag
      || normalizedNodeText(heading) !== binding.firstHeading.text) {
    throw new InvalidDraftDataError('binding_heading_mismatch');
  }
}

function descriptorForTextNode(parent, textNode, sectionId, sectionName, index) {
  if (!TEXT_TAGS.has(parent.tagName)) return null;
  const value = normalizedText(textNode.value, 1, 24000, true);
  if (!value) return null;
  const editId = `${sectionId}-text-${String(index).padStart(3, '0')}`;
  const wrapper = {
    nodeName: 'funnel-copy',
    tagName: 'funnel-copy',
    attrs: [
      {name: 'data-funnel-edit-id', value: editId},
      {name: 'style', value: 'display:contents;font:inherit;color:inherit'},
    ],
    namespaceURI: 'http://www.w3.org/1999/xhtml',
    childNodes: [textNode],
    parentNode: parent,
  };
  textNode.parentNode = wrapper;
  const offset = parent.childNodes.indexOf(textNode);
  parent.childNodes.splice(offset, 1, wrapper);
  return {
    editId, sectionId, type: 'text', tag: 'funnel-copy', parentTag: parent.tagName,
    label: `${sectionName} · ${parent.tagName.toUpperCase()} copy ${index}`,
    value,
  };
}

function descriptorForImage(node, sectionId, sectionName, index) {
  const editId = `${sectionId}-image-${String(index).padStart(3, '0')}`;
  setAttr(node, 'data-funnel-edit-id', editId);
  return {
    editId, sectionId, type: 'image', tag: 'img',
    label: `${sectionName} · image ${index}`,
    value: getAttr(node, 'src') || '',
    alt: getAttr(node, 'alt') || '',
  };
}

function injectWorkingControls(html, {
  target, bindings, sectionNames, contentBaseUrl = target?.productionUrl, bannerLiveTarget = null, liveSynchronized = false,
}) {
  if (typeof html !== 'string' || Buffer.byteLength(html, 'utf8') > MAX_SOURCE_BYTES) {
    throw new InvalidDraftDataError('invalid_source_html');
  }
  const document = parse5.parse(html);
  const head = firstElement(document, 'head');
  const body = firstElement(document, 'body');
  if (!head || !body) throw new InvalidDraftDataError('invalid_source_html');
  const title = workingPageLabel(target);
  const trackerUrl = trackerReviewUrl(target);
  const sourceVersion = liveSynchronized ? 'Synced from live' : normalizedText(target.sourceVersion, 1, 120);
  const liveTarget = bannerLiveTarget || preferredLiveTarget(target);
  prependParsedFragment(head, `<base href="${escapeAttribute(contentBaseUrl)}">`);
  installWorkingTextGuard(document);
  appendParsedFragment(head, `<style data-funnel-working-style="2">
    .funnel-working-banner{position:sticky;top:0;z-index:2147483647;display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;padding:10px 16px;background:#fff;color:#211b2a;border-bottom:1px solid #d8d2dc;font:700 14px/1.3 system-ui,sans-serif;box-shadow:0 2px 10px #211b2a12}
    .funnel-working-banner a{color:#245ca6;text-decoration:underline}.funnel-working-badge{background:#a82759;color:#fff;border-radius:999px;padding:4px 9px;letter-spacing:.08em}
    .funnel-working-identity{margin-right:auto}.funnel-working-source{font-weight:500;color:#62596a}
    funnel-copy{display:contents;font:inherit;color:inherit}
    .funnel-working-section-label{display:block;width:max-content;max-width:calc(100% - 16px);margin:8px;padding:5px 9px;border:1px solid #d8d2dc;border-radius:5px;background:#fff;color:#245ca6;font:700 12px/1.25 system-ui,sans-serif;letter-spacing:.02em;text-decoration:underline}
    [data-funnel-section-id]{outline:2px dashed rgba(77,46,125,.55);outline-offset:-2px}
  </style>`);
  prependParsedFragment(body, `<div class="funnel-working-banner" data-funnel-working-banner><strong class="funnel-working-badge">DRAFT</strong><span class="funnel-working-identity">${escapeText(target.label || title)}${sourceVersion ? ` <span class="funnel-working-source">· ${escapeText(sourceVersion)}</span>` : ''}</span>${liveTarget ? `<a href="${escapeAttribute(liveTarget.productionUrl)}" target="_blank" rel="noopener">Live page</a>` : ''}<a href="${escapeAttribute(trackerUrl)}">Open tracker</a></div>`);

  const editableNodes = [];
  for (const binding of bindings) {
    const matches = findBySelector(document, binding.selector);
    if (matches.length !== 1) throw new InvalidDraftDataError(matches.length ? 'binding_selector_not_unique' : 'binding_selector_missing');
    const section = matches[0];
    assertBinding(section, binding);
    const sectionName = normalizedText(sectionNames[binding.sectionId], 1, 200)
      || binding.sectionId;
    setAttr(section, 'data-funnel-section-id', binding.sectionId);
    prependParsedFragment(section, `<a class="funnel-working-section-label" style="color:#245ca6!important;background:#fff!important;-webkit-text-fill-color:#245ca6!important" data-funnel-working-label href="${escapeAttribute(trackerReviewUrl(target, binding.sectionId))}">${escapeText(binding.sectionId)} · ${escapeText(sectionName)}</a>`);
    const descendants = elements(section).filter(node => node !== section);
    let textIndex = 0;
    let imageIndex = 0;
    for (const node of descendants) {
      if (node.tagName === 'img') {
        imageIndex += 1;
        editableNodes.push(descriptorForImage(node, binding.sectionId, sectionName, imageIndex));
      } else {
        let insideLabel = false;
        for (let ancestor = node; ancestor; ancestor = ancestor.parentNode) {
          if (hasAttr(ancestor, 'data-funnel-working-label')) { insideLabel = true; break; }
          if (ancestor === section) break;
        }
        if (insideLabel) continue;
        for (const textNode of [...(node.childNodes || [])].filter(child => child.nodeName === '#text')) {
          const descriptor = descriptorForTextNode(
            node, textNode, binding.sectionId, sectionName, textIndex + 1,
          );
          if (descriptor) {
            textIndex += 1;
            editableNodes.push(descriptor);
          }
        }
      }
    }
  }
  if (editableNodes.length === 0) throw new InvalidDraftDataError('no_editable_nodes');
  return {html: parse5.serialize(document), editableNodes};
}

function escapeText(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttribute(value) {
  return escapeText(value).replace(/"/g, '&quot;');
}

function findEditableNode(document, editId) {
  return elements(document).filter(node => getAttr(node, 'data-funnel-edit-id') === editId);
}

function imageState(node) {
  const parent = node.parentNode;
  const sources = parent?.tagName === 'picture'
    ? (parent.childNodes || []).filter(child => child.tagName === 'source') : [];
  return {
    url: getAttr(node, 'src') || '',
    srcset: getAttr(node, 'srcset') || '',
    pictureSources: sources.map(source => getAttr(source, 'srcset') || ''),
  };
}

function deriveWorkingBindings(html, initializedBindings) {
  const document = parse5.parse(html);
  return initializedBindings.map(binding => {
    const matches = elements(document).filter(node => (
      getAttr(node, 'data-funnel-section-id') === binding.sectionId
    ));
    if (matches.length !== 1) throw new InvalidDraftDataError('working_binding_missing');
    const section = matches[0];
    if (section.tagName !== binding.element.tag
        || (getAttr(section, 'id') || null) !== binding.element.id) {
      throw new InvalidDraftDataError('working_binding_identity_changed');
    }
    const classes = String(getAttr(section, 'class') || '').split(/\s+/).filter(Boolean)
      .sort((left, right) => left.localeCompare(right));
    if (classes.length !== binding.element.classes.length
        || classes.some((item, index) => item !== binding.element.classes[index])) {
      throw new InvalidDraftDataError('working_binding_identity_changed');
    }
    const heading = elements(section).find(node => /^h[1-6]$/.test(node.tagName));
    return {
      sectionId: binding.sectionId,
      selector: binding.selector,
      element: {
        tag: binding.element.tag,
        id: binding.element.id,
        classes: [...binding.element.classes],
      },
      firstHeading: heading ? {tag: heading.tagName, text: normalizedNodeText(heading)} : null,
    };
  });
}

function mutateWorkingHtml(html, {sectionId, editId, operation}) {
  if (!validSectionId(sectionId) || !validEditId(editId) || !isPlainObject(operation)) {
    throw new InvalidDraftDataError('invalid_draft_edit');
  }
  const document = parse5.parse(html);
  installWorkingTextGuard(document);
  const matches = findEditableNode(document, editId);
  if (matches.length !== 1) throw new InvalidDraftDataError('editable_node_missing');
  const node = matches[0];
  let ancestor = node;
  while (ancestor && getAttr(ancestor, 'data-funnel-section-id') === null) ancestor = ancestor.parentNode;
  if (!ancestor || getAttr(ancestor, 'data-funnel-section-id') !== sectionId) {
    throw new InvalidDraftDataError('editable_node_section_mismatch');
  }
  if (operation.type === 'text') {
    const value = normalizedText(operation.value, 1, 24000, true);
    const textNodes = (node.childNodes || []).filter(child => child.nodeName === '#text');
    const elementChildren = (node.childNodes || []).filter(child => typeof child.tagName === 'string');
    if (!value || node.tagName !== 'funnel-copy' || textNodes.length !== 1 || elementChildren.length !== 0) {
      throw new InvalidDraftDataError('invalid_text_edit');
    }
    const originalText = textNodes[0].value;
    const before = normalizedText(originalText, 1, 24000, true);
    const leadingSpace = originalText.match(/^\s*/)[0];
    const trailingSpace = originalText.match(/\s*$/)[0];
    textNodes[0].value = `${leadingSpace}${value}${trailingSpace}`;
    setAttr(node, 'data-funnel-fixed', 'true');
    return {html: parse5.serialize(document), before, after: value, type: 'text'};
  }
  if (operation.type === 'image') {
    if (node.tagName !== 'img' || !validAttachmentId(operation.attachmentId)) {
      throw new InvalidDraftDataError('invalid_image_edit');
    }
    const before = imageState(node);
    const src = `https://zodiac-pages.vercel.app/api/funnel-review?action=image&attachmentId=${encodeURIComponent(operation.attachmentId)}`;
    setAttr(node, 'src', src);
    removeAttr(node, 'srcset');
    const parent = node.parentNode;
    if (parent?.tagName === 'picture') {
      for (const source of (parent.childNodes || []).filter(child => child.tagName === 'source')) {
        setAttr(source, 'srcset', src);
      }
    }
    return {html: parse5.serialize(document), before, after: imageState(node), type: 'image'};
  }
  throw new InvalidDraftDataError('invalid_draft_edit');
}

function refreshDescriptors(html, priorDescriptors) {
  const document = parse5.parse(html);
  const nodes = new Map(elements(document)
    .filter(node => getAttr(node, 'data-funnel-edit-id'))
    .map(node => [getAttr(node, 'data-funnel-edit-id'), node]));
  return priorDescriptors.map(descriptor => {
    const node = nodes.get(descriptor.editId);
    if (!node) throw new InvalidDraftDataError('editable_node_missing');
    if (descriptor.type === 'text') {
      return {...descriptor, value: normalizedNodeText(node)};
    }
    return {...descriptor, value: getAttr(node, 'src') || '', alt: getAttr(node, 'alt') || ''};
  });
}

function publicCapture(value, pageKey, revisionId, view = 'desktop') {
  return {
    status: value.status,
    lastAttemptAt: value.lastAttemptAt,
    error: value.error ? {...value.error} : null,
    imageSha256: value.imageSha256,
    width: value.width,
    height: value.height,
    imageUrl: value.status === 'ready'
      ? `/api/funnel-review?action=draft-screenshot&pageKey=${encodeURIComponent(pageKey)}&revision=${encodeURIComponent(revisionId)}&view=${encodeURIComponent(view)}`
      : null,
  };
}

function revisionAffectsView(revision, view) {
  if (!revision?.views) return true;
  if (['initialized', 'section-copy'].includes(revision.kind)) return true;
  if (revision.kind === 'variation-promotion') {
    if (!Array.isArray(revision.sectionChanges)) return true;
    return revision.sectionChanges.some(change => change.views.includes(view));
  }
  return revision.scope === 'shared' || revision.scope === view;
}

function revisionViewSyncState(draft, revisionId, view, {syncStatus = null} = {}) {
  if (!validView(view)) throw new InvalidDraftDataError('invalid_view');
  const revisionIndex = draft?.revisions?.findIndex(item => item.id === revisionId) ?? -1;
  if (revisionIndex < 0) throw new InvalidDraftDataError('invalid_revision');
  if (!draft.views) return revisionSyncState(draft, revisionId, {syncStatus, legacyOnly: true});
  let contentIndex = revisionIndex;
  while (contentIndex > 0 && !revisionAffectsView(draft.revisions[contentIndex], view)) {
    contentIndex -= 1;
  }
  const contentRevision = draft.revisions[contentIndex];
  const confirmed = draft.publications.some(item => {
    if (item.sectionId !== null || !(item.view === undefined || item.view === view)) return false;
    const publicationIndex = draft.revisions.findIndex(revision => revision.id === item.revisionId);
    return publicationIndex >= contentIndex && publicationIndex <= revisionIndex;
  });
  const sourced = contentRevision.kind === 'initialized'
    && Boolean(revisionViewRecord(contentRevision, view)?.sourceEvidence
      || contentRevision.sourceEvidence);
  const anchorIndex = draft.release
    ? draft.revisions.findIndex(item => item.id === draft.release.anchorRevisionId) : -1;
  const anchored = anchorIndex >= contentIndex && draft.release?.initialSync === 'synced';
  let status = confirmed || sourced || anchored ? 'synced' : 'unsynced';
  let reason = confirmed ? 'confirmed-live'
    : sourced ? 'verified-live-source'
      : anchored ? 'versioning-baseline' : 'draft-change';
  if (syncStatus === 'changed') {
    status = 'unsynced';
    reason = 'live-changed';
  }
  return {status, reason, checkStatus: syncStatus};
}

function revisionReleaseState(draft, revisionId, {syncStatus = null, syncStatusByView = null} = {}) {
  const index = draft?.revisions?.findIndex(item => item.id === revisionId) ?? -1;
  if (index < 0) throw new InvalidDraftDataError('invalid_revision');
  const anchorIndex = draft.release
    ? draft.revisions.findIndex(item => item.id === draft.release.anchorRevisionId) : -1;
  if (anchorIndex < 0 || index < anchorIndex) {
    return {
      version: null, setup: true, archiveNumber: index + 1,
      sync: revisionSyncState(draft, revisionId, {syncStatus,syncStatusByView}),
    };
  }
  let major = 1;
  let minor = 0;
  for (const revision of draft.revisions.slice(anchorIndex + 1, index + 1)) {
    if (revision.releaseType === 'major') {
      major += 1;
      minor = 0;
    } else if (revision.releaseType === 'minor') {
      minor += 1;
    }
  }
  const sync = revisionSyncState(draft, revisionId, {syncStatus,syncStatusByView});
  const base = minor === 0 ? String(major) : `${major}.${minor}`;
  return {
    version: `${base}${sync.status === 'unsynced' ? 'D' : ''}`,
    setup: false,
    archiveNumber: null,
    sync,
  };
}

function revisionVersion(draft, revisionId, options = {}) {
  return revisionReleaseState(draft, revisionId, isPlainObject(options) ? options : {}).version;
}

function revisionSyncState(draft, revisionId, {
  syncStatus = null, syncStatusByView = null, legacyOnly = false,
} = {}) {
  if (![null, 'current', 'changed', 'unavailable'].includes(syncStatus)) {
    throw new InvalidDraftDataError('invalid_sync_status');
  }
  const revision = draft?.revisions?.find(item => item.id === revisionId);
  if (!revision) throw new InvalidDraftDataError('invalid_revision');
  if (draft.views && !legacyOnly) {
    if (syncStatusByView !== null && (!isPlainObject(syncStatusByView)
        || Object.keys(syncStatusByView).sort().join(',') !== 'desktop,mobile'
        || !DRAFT_VIEWS.every(view => [null, 'current', 'changed', 'unavailable']
          .includes(syncStatusByView[view])))) {
      throw new InvalidDraftDataError('invalid_sync_status');
    }
    const views = Object.fromEntries(DRAFT_VIEWS.map(view => [
      view, revisionViewSyncState(draft, revisionId, view, {
        syncStatus:syncStatusByView?.[view] ?? syncStatus,
      }),
    ]));
    const allSynced = DRAFT_VIEWS.every(view => views[view].status === 'synced');
    const reasons = new Set(DRAFT_VIEWS.map(view => views[view].reason));
    const sharedReason = reasons.size === 1 ? [...reasons][0] : null;
    return {
      status: allSynced ? 'synced' : 'unsynced',
      reason: allSynced ? 'all-views-verified'
        : sharedReason || 'view-change',
      checkStatus: syncStatus,
      views,
    };
  }
  const confirmed = draft.publications.some(item => (
    item.sectionId === null && item.revisionId === revisionId
  ));
  const sourced = revision.kind === 'initialized' && Boolean(revision.sourceEvidence);
  const anchoredMain = !draft.branch && draft.release?.anchorRevisionId === revisionId
    && draft.release.initialSync === 'synced';
  let status = confirmed || sourced || anchoredMain ? 'synced' : 'unsynced';
  let reason = confirmed ? 'confirmed-live'
    : sourced ? 'verified-live-source'
      : anchoredMain ? 'versioning-baseline' : 'draft-change';
  if (syncStatus === 'changed') {
    status = 'unsynced';
    reason = 'live-changed';
  }
  return {status, reason, checkStatus: syncStatus};
}

function categoryDisplayName(category) {
  if (category === 'general') return 'General';
  if (category === 'manifesting') return 'Manifestation';
  if (category === 'astrology') return 'Astrology and Human Design';
  if (category === 'paid') return 'Paid';
  if (category === 'free') return 'Free';
  return category === 'shared' ? null : category;
}

function familyDisplayName(family) {
  if (family === 'lander') return 'Lander';
  if (family === 'results') return 'Results';
  if (family === 'bc') return 'Birth Chart';
  if (family === 'join') return 'Join';
  return family;
}

function workingIdentity(draft, revisionId, options = {}) {
  const category = categoryDisplayName(draft.category);
  const family = familyDisplayName(draft.family);
  const branch = draft.branch?.name || 'Main';
  const release = revisionReleaseState(draft, revisionId, isPlainObject(options) ? options : {});
  const versionLabel = release.version === null
    ? `Setup archive ${release.archiveNumber}` : `Version ${release.version}`;
  return [category, family, branch, versionLabel]
    .filter(Boolean).join(' · ');
}

function concreteChangeSummary(revision) {
  if (revision.changeSummary) return revision.changeSummary;
  if (revision.kind === 'edit' && revision.operationType === 'text') {
    return `Updated copy in ${revision.sectionId}`;
  }
  if (revision.kind === 'edit' && revision.operationType === 'image') {
    return `Replaced image in ${revision.sectionId}`;
  }
  if (revision.kind === 'section-copy') {
    return `Copied ${revision.after.sourceSectionId} into ${revision.sectionId}`;
  }
  if (revision.kind === 'section-layout') {
    return `Applied ${revision.layoutId} to ${revision.sectionId}`;
  }
  if (revision.kind === 'variation-promotion') {
    return revision.changeSummary || 'Made an approved variation the Main working page';
  }
  if (revision.kind === 'initialized' && revision.sourceEvidence) {
    return 'Synced working page from live';
  }
  if (revision.kind === 'initialized') return 'Updated working-page source';
  return 'Updated working page';
}

function syncBaselineIndex(draft, revisionIndex, view = null) {
  let baselineIndex = draft.release
    ? draft.revisions.findIndex(item => item.id === draft.release.anchorRevisionId) : -1;
  for (let index = 0; index <= revisionIndex; index += 1) {
    const revision = draft.revisions[index];
    const sourced = revision.kind === 'initialized' && (view === null
      ? revision.sourceEvidence
      : revisionViewRecord(revision, view)?.sourceEvidence || revision.sourceEvidence);
    const published = draft.publications.some(item => item.sectionId === null
      && item.revisionId === revision.id
      && (view === null || item.view === undefined || item.view === view));
    if (sourced || published) {
      baselineIndex = Math.max(baselineIndex, index);
    }
  }
  return baselineIndex;
}

function changedSectionsForRevision(draft, revisionId, view = null) {
  const revisionIndex = draft.revisions.findIndex(item => item.id === revisionId);
  if (revisionIndex < 0) throw new InvalidDraftDataError('invalid_revision');
  const activeView = view === null ? null : normalizedView(view);
  if (view !== null && !activeView) throw new InvalidDraftDataError('invalid_view');
  const baselineIndex = syncBaselineIndex(draft, revisionIndex, activeView);
  const changed = new Map();
  for (const revision of draft.revisions.slice(baselineIndex + 1, revisionIndex + 1)) {
    if (activeView && !revisionAffectsView(revision, activeView)) continue;
    if (!revision.sectionId && revision.releaseType === undefined) continue;
    if (revision.kind === 'variation-promotion'
        && Array.isArray(revision.sectionChanges) && revision.sectionChanges.length > 0) {
      for (const sectionChange of revision.sectionChanges) {
        if (activeView && !sectionChange.views.includes(activeView)) continue;
        const existing = changed.get(sectionChange.sectionId) || {
          sectionId:sectionChange.sectionId,label:sectionChange.sectionId,
          summary:null,revisionIds:[],
        };
        existing.summary = concreteChangeSummary(revision);
        existing.revisionIds.push(revision.id);
        changed.set(sectionChange.sectionId, existing);
      }
      continue;
    }
    const key = revision.sectionId || '__page_structure__';
    const existing = changed.get(key) || {
      sectionId: revision.sectionId, label: revision.sectionId || 'Page structure',
      summary: null, revisionIds: [],
    };
    existing.summary = concreteChangeSummary(revision);
    existing.revisionIds.push(revision.id);
    changed.set(key, existing);
  }
  return [...changed.values()];
}

function removeElement(node) {
  if (!node?.parentNode?.childNodes) return;
  node.parentNode.childNodes = node.parentNode.childNodes.filter(item => item !== node);
}

function renderWorkingPage(draft, immutableHtml, revisionId, {
  syncStatus = null, syncStatusByView = null, view = 'desktop', liveCheckPending = false,
} = {}) {
  const activeView = normalizedView(view);
  if (!draft || !validPageKey(draft.pageKey) || typeof immutableHtml !== 'string'
      || !activeView || Buffer.byteLength(immutableHtml, 'utf8') > MAX_SOURCE_BYTES) {
    throw new InvalidDraftDataError('invalid_working_page');
  }
  const revision = draft.revisions.find(item => item.id === revisionId);
  const viewRecord = revisionViewRecord(revision, activeView);
  if (!revision || !viewRecord || hash(immutableHtml) !== viewRecord.htmlSha256) {
    throw new InvalidDraftDataError('invalid_working_revision');
  }
  const document = parse5.parse(immutableHtml);
  const head = firstElement(document, 'head');
  const body = firstElement(document, 'body');
  if (!head || !body) throw new InvalidDraftDataError('invalid_working_page');
  for (const node of [...elements(document)]) {
    if (hasAttr(node, 'data-funnel-working-banner')
        || hasAttr(node, 'data-funnel-working-presentation')) removeElement(node);
  }
  const target = getTarget(draft.pageKey);
  if (!target) throw new InvalidDraftDataError('invalid_page_key');
  const workingUrl = absoluteWorkingUrl(draft.pageKey, draft.sourceUrl, revisionId, null, activeView);
  for (const label of elements(document).filter(node => hasAttr(node, 'data-funnel-working-label'))) {
    let section = label.parentNode;
    while (section && getAttr(section, 'data-funnel-section-id') === null) section = section.parentNode;
    const sectionId = section ? getAttr(section, 'data-funnel-section-id') : null;
    if (sectionId) {
      const anchorId = `funnel-section-${sectionId}`;
      if (!elements(document).some(node => node !== label && getAttr(node, 'id') === anchorId)) {
        setAttr(label, 'id', anchorId);
      }
      setAttr(label, 'href', absoluteWorkingUrl(
        draft.pageKey, draft.sourceUrl, revisionId, sectionId, activeView,
      ));
      setAttr(label, 'data-funnel-working-link', '');
    }
  }
  const sync = draft.views
    ? revisionViewSyncState(draft, revisionId, activeView, {
      syncStatus:syncStatusByView?.[activeView] ?? syncStatus,
    })
    : revisionSyncState(draft, revisionId, {syncStatus});
  const release = revisionReleaseState(draft, revisionId, {syncStatus,syncStatusByView});
  const unavailableCheck = sync.checkStatus === 'unavailable'
    || Object.values(release.sync.views || {}).some(item => item.checkStatus === 'unavailable');
  const displayUnsynced = sync.status === 'unsynced' || release.sync.status === 'unsynced';
  const displayPending = liveCheckPending === true && !displayUnsynced;
  const displayStatus = displayUnsynced ? 'Unsynced'
    : displayPending ? 'Checking live…' : unavailableCheck ? 'Check unavailable' : 'Synced';
  const displayDataStatus = displayUnsynced ? 'unsynced'
    : displayPending ? 'pending' : unavailableCheck ? 'unavailable' : 'synced';
  const publication = [...draft.publications].reverse().find(item => item.sectionId === null
    && item.revisionId === revisionId
    && (!draft.views || item.view === undefined || item.view === activeView));
  const liveTarget = pairedLiveTargets(target.id).find(item => item.productionUrl === (publication?.liveUrl || revision.sourceEvidence?.liveUrl)) || preferredLiveTarget(target);
  for (const title of [...(head.childNodes || [])].filter(node => node.tagName === 'title')) removeElement(title);
  appendParsedFragment(head, `<title>${escapeText(workingIdentity(draft, revisionId, {syncStatus,syncStatusByView}))} · ${displayStatus}</title>`);
  const checkText = displayUnsynced && sync.checkStatus === 'changed' ? ' · Live changed' : '';
  const changedSections = revisionId === draft.currentRevisionId && sync.status === 'unsynced'
    ? changedSectionsForRevision(draft, revisionId, activeView) : [];
  const changedText = changedSections.length > 0
    ? `<details class="funnel-working-changes"${changedSections.length <= 3 ? ' open' : ''}><summary>Draft changes: ${changedSections.length} ${changedSections.length === 1 ? 'section' : 'sections'}</summary><ul>${changedSections.map(item => {
      const label = item.sectionId || 'Page structure';
      const href = absoluteWorkingUrl(
        draft.pageKey, draft.sourceUrl, revisionId, item.sectionId, activeView,
      );
      return `<li><a data-funnel-working-link href="${escapeAttribute(href)}">${escapeText(label)}</a>: ${escapeText(item.summary)}</li>`;
    }).join('')}</ul></details>`
    : sync.status === 'unsynced'
      ? `<span class="funnel-working-changes-empty">${draft.branch ? 'No section changes saved in this variation yet.' : 'No section changes saved yet.'}</span>`
      : '';
  appendParsedFragment(head, `<style data-funnel-working-presentation>
    .funnel-working-status{border-radius:999px;padding:4px 9px;background:#ece8f0;color:#3b3343;letter-spacing:.04em}
    .funnel-working-status[data-status="synced"]{background:#e2f2e8;color:#21623d}
    .funnel-working-status[data-status="unsynced"]{background:#fff0d9;color:#7a4910}
    .funnel-working-status[data-status="unavailable"]{background:#ece8f0;color:#3b3343}
    .funnel-working-status[data-status="pending"]{background:#ece8f0;color:#3b3343}
    .funnel-working-changes,.funnel-working-changes-empty{flex-basis:100%;font-weight:500;color:#62596a}
    .funnel-working-changes{max-height:140px;overflow:auto}.funnel-working-changes summary{cursor:pointer;font-weight:700}.funnel-working-changes ul{margin:6px 0 0;padding-left:22px}.funnel-working-changes li{margin:3px 0}
  </style>`);
  const lifecycle = lifecycleStatus(draft);
  const lifecycleLabel = lifecycle === 'archived' ? 'Archived variation · '
    : lifecycle === 'deleted' ? 'Deleted variation · ' : '';
  const viewLabel = `${lifecycleLabel}${activeView === 'desktop' ? 'Desktop web' : 'Mobile web'}`;
  const otherView = activeView === 'desktop' ? 'mobile' : 'desktop';
  const otherLabel = otherView === 'desktop' ? 'Desktop web' : 'Mobile web';
  const otherUrl = absoluteWorkingUrl(draft.pageKey, draft.sourceUrl, revisionId, null, otherView);
  const desktopUrl = absoluteWorkingUrl(draft.pageKey, draft.sourceUrl, revisionId, null, 'desktop');
  const mobileUrl = absoluteWorkingUrl(draft.pageKey, draft.sourceUrl, revisionId, null, 'mobile');
  prependParsedFragment(body, `<div class="funnel-working-banner" data-funnel-working-banner data-funnel-working-page="${escapeAttribute(draft.pageKey)}" data-funnel-working-revision="${escapeAttribute(revisionId)}" data-funnel-working-version="${escapeAttribute(release.version || `setup-${release.archiveNumber}`)}" data-funnel-working-view="${activeView}" data-funnel-sync-status="${sync.status}"><strong class="funnel-working-badge">DRAFT</strong><span class="funnel-working-identity">${escapeText(viewLabel)} · ${escapeText(workingIdentity(draft, revisionId, {syncStatus,syncStatusByView}))}</span><span class="funnel-working-status" data-status="${displayDataStatus}">${escapeText(displayStatus)}${escapeText(checkText)}</span><nav class="funnel-working-view-toggle" aria-label="Working page view"><button type="button" data-funnel-working-view-toggle="desktop" data-href="${escapeAttribute(desktopUrl)}">Desktop web</button><button type="button" data-funnel-working-view-toggle="mobile" data-href="${escapeAttribute(mobileUrl)}">Mobile web</button><noscript><a href="${escapeAttribute(otherUrl)}">${escapeText(otherLabel)}</a></noscript></nav>${liveTarget ? `<a href="${escapeAttribute(liveTarget.productionUrl)}" target="_blank" rel="noopener">Live page</a>` : ''}<a data-funnel-working-link href="${escapeAttribute(workingUrl)}">Working page</a>${changedText}</div>`);
  const banner = elements(body).find(node => hasAttr(node, 'data-funnel-working-banner'));
  if (banner) setAttr(banner, 'data-funnel-working-lifecycle', lifecycle);
  return parse5.serialize(document);
}

function publicRevision(value, pageKey, draft, options = {}) {
  const normalizedOptions = isPlainObject(options) ? options : {};
  const activeView = normalizedView(normalizedOptions.view) || 'desktop';
  const release = revisionReleaseState(draft, value.id, normalizedOptions);
  const viewSync = draft.views
    ? revisionViewSyncState(draft, value.id, activeView, {
      syncStatus:normalizedOptions.syncStatusByView?.[activeView]
        ?? normalizedOptions.syncStatus ?? null,
    }) : release.sync;
  const changedSections = changedSectionsForRevision(draft, value.id, activeView).map(item => ({
    ...item,
    workingUrl: workingRevisionUrl(pageKey, draft.sourceUrl, value.id, item.sectionId, activeView),
  }));
  return {
    id: value.id,
    kind: value.kind,
    createdAt: value.createdAt,
    editor: {...value.editor},
    sectionId: value.sectionId,
    editId: value.editId,
    operationType: value.operationType,
    before: structuredClone(value.before),
    after: structuredClone(value.after),
    material: value.material ? {...value.material} : null,
    sourceEvidence: value.sourceEvidence ? {...value.sourceEvidence} : null,
    promotion: value.promotion ? {...value.promotion} : null,
    layoutId: value.layoutId || null,
    amendsRevisionId: value.amendsRevisionId || null,
    sectionChanges: value.sectionChanges ? structuredClone(value.sectionChanges) : null,
    identity: workingIdentity(draft, value.id, normalizedOptions),
    version: release.version,
    setup: release.setup,
    archiveNumber: release.archiveNumber,
    releaseType: value.releaseType || null,
    changeSummary: concreteChangeSummary(value),
    sync:viewSync,
    overallSync:release.sync,
    changedSections,
    htmlSha256: value.htmlSha256,
    view: value.view || null,
    scope: value.scope || null,
    viewChanges: value.viewChanges ? structuredClone(value.viewChanges) : null,
    workingUrl: workingRevisionUrl(pageKey, draft.sourceUrl, value.id, null, activeView),
    screenshot: publicCapture(revisionViewRecord(value, activeView).capture, pageKey, value.id, activeView),
    views: Object.fromEntries(DRAFT_VIEWS.map(view => {
      const record = revisionViewRecord(value, view);
      return [view, {
        workingUrl: workingRevisionUrl(pageKey, draft.sourceUrl, value.id, null, view),
        htmlSha256: record.htmlSha256,
        screenshot: publicCapture(record.capture, pageKey, value.id, view),
      }];
    })),
  };
}

function latestLiveSource(value) {
  for (let index = value.revisions.length - 1; index >= 0; index -= 1) {
    const revision = value.revisions[index];
    if (revision.kind === 'initialized' && revision.sourceEvidence) {
      return {index, revision};
    }
  }
  return null;
}

function currentInitialization(value) {
  const index = value.revisions.findLastIndex(item => item.kind === 'initialized');
  return index < 0 ? null : {index, revision: value.revisions[index]};
}

function sourceMatchStatus(value) {
  const liveSource = latestLiveSource(value);
  if (!liveSource) return 'not-synced';
  return liveSource.index === value.revisions.length - 1
    ? 'synced-from-live' : 'changes-not-live';
}

function liveEvidenceContentMatches(storedEvidence, observedEvidence) {
  const storedCompared = storedEvidence?.comparisonVersion !== undefined
    || storedEvidence?.comparisonSha256 !== undefined;
  const observedCompared = observedEvidence?.comparisonVersion !== undefined
    || observedEvidence?.comparisonSha256 !== undefined;
  if (storedCompared || observedCompared) {
    return storedCompared && observedCompared
      && storedEvidence.comparisonVersion === observedEvidence.comparisonVersion
      && storedEvidence.comparisonSha256 === observedEvidence.comparisonSha256;
  }
  return storedEvidence?.contentSha256 === observedEvidence?.contentSha256;
}

function publicationEvidenceContentMatches(publication, observedEvidence) {
  return liveEvidenceContentMatches({
    contentSha256:publication.liveContentSha256,
    ...(publication.liveComparisonVersion === undefined ? {} : {
      comparisonVersion:publication.liveComparisonVersion,
      comparisonSha256:publication.liveComparisonSha256,
    }),
  }, observedEvidence);
}

function compareLiveSourceEvidence(value, observedEvidence, view = 'desktop') {
  const activeView = normalizedView(view);
  if (!value || !validPageKey(value.pageKey)
      || !activeView || !validSourceEvidence(observedEvidence, value.pageKey)) {
    throw new InvalidDraftDataError('invalid_source_evidence');
  }
  if (value.views) {
    const currentIndex = value.revisions.length - 1;
    let contentIndex = currentIndex;
    while (contentIndex > 0 && !revisionAffectsView(value.revisions[contentIndex], activeView)) {
      contentIndex -= 1;
    }
    const currentPublication = [...value.publications].reverse().find(item => {
      if (item.sectionId !== null || !(item.view === undefined || item.view === activeView)) return false;
      const publicationIndex = value.revisions.findIndex(revision => revision.id === item.revisionId);
      return publicationIndex >= contentIndex && publicationIndex <= currentIndex;
    });
    if (currentPublication) {
      if (!currentPublication.liveContentSha256) return 'unavailable';
      if (currentPublication.liveUrl !== observedEvidence.liveUrl) return 'unavailable';
      return publicationEvidenceContentMatches(currentPublication, observedEvidence)
        ? 'confirmed-live' : 'check-needed';
    }
    let sourceIndex = contentIndex;
    while (sourceIndex >= 0) {
      const revision = value.revisions[sourceIndex];
      const evidence = revision.kind === 'initialized'
        ? revisionViewRecord(revision, activeView)?.sourceEvidence || revision.sourceEvidence : null;
      if (evidence) {
        if (evidence.liveUrl !== observedEvidence.liveUrl) return 'unavailable';
        if (!liveEvidenceContentMatches(evidence, observedEvidence)) return 'check-needed';
        return sourceIndex === contentIndex ? 'synced-from-live' : 'changes-not-live';
      }
      sourceIndex -= 1;
    }
    return 'not-synced';
  }
  const currentPublication = [...value.publications].reverse().find(item => (
    item.sectionId === null && item.revisionId === value.currentRevisionId
  ));
  if (currentPublication) {
    if (!currentPublication.liveContentSha256) return 'unavailable';
    if (currentPublication.liveUrl !== observedEvidence.liveUrl) return 'unavailable';
    return publicationEvidenceContentMatches(currentPublication, observedEvidence)
      ? 'confirmed-live' : 'check-needed';
  }
  const liveSource = latestLiveSource(value);
  if (!liveSource) return 'not-synced';
  if (!liveEvidenceContentMatches(liveSource.revision.sourceEvidence, observedEvidence)) {
    return 'check-needed';
  }
  return sourceMatchStatus(value);
}

function publicDraft(value, options = {}) {
  const normalizedOptions = isPlainObject(options) ? options : {};
  const activeView = normalizedView(normalizedOptions.view) || 'desktop';
  const syncStatus = normalizedOptions.syncStatus ?? null;
  const syncStatusByView = normalizedOptions.syncStatusByView ?? null;
  const target = getTarget(value.pageKey);
  const livePages = pairedLiveTargets(value.pageKey).map(item => ({
    id: item.id, label: item.label, channel: item.channel, url: item.productionUrl,
  }));
  const latestPagePublication = [...value.publications].reverse()
    .find(item => item.sectionId === null
      && (!value.views || item.view === undefined || item.view === activeView)) || null;
  const confirmedRevisionIndex = syncBaselineIndex(
    value, value.revisions.length - 1, value.views ? activeView : null,
  );
  const pendingEditCount = value.revisions
    .slice(confirmedRevisionIndex + 1)
    .filter(item => item.kind !== 'initialized'
      && (!value.views || revisionAffectsView(item, activeView))).length;
  const activeViewSync = value.views
    ? revisionViewSyncState(value, value.currentRevisionId, activeView, {
      syncStatus:syncStatusByView?.[activeView] ?? syncStatus,
    })
    : revisionSyncState(value, value.currentRevisionId, {syncStatus});
  const currentRevisionIndex = value.revisions.length - 1;
  let activeContentIndex = currentRevisionIndex;
  while (value.views && activeContentIndex > 0
      && !revisionAffectsView(value.revisions[activeContentIndex], activeView)) {
    activeContentIndex -= 1;
  }
  const latestPublicationIndex = latestPagePublication
    ? value.revisions.findIndex(item => item.id === latestPagePublication.revisionId) : -1;
  const pageStatus = latestPagePublication
    ? (latestPublicationIndex >= activeContentIndex && activeViewSync.status === 'synced'
      ? 'confirmed-live' : 'changes-not-live')
    : 'unconfirmed';
  const liveSource = latestLiveSource(value);
  const initialized = currentInitialization(value);
  const contentBaseUrl = value.branch?.contentBaseUrl
    || initialized?.revision.sourceEvidence?.liveUrl || target.productionUrl;
  const releaseState = revisionReleaseState(
    value, value.currentRevisionId, {syncStatus,syncStatusByView},
  );
  const version = releaseState.version;
  const changedSections = changedSectionsForRevision(value, value.currentRevisionId, activeView).map(item => ({
    ...item,
    workingUrl: workingRevisionUrl(
      value.pageKey, value.sourceUrl, value.currentRevisionId, item.sectionId, activeView,
    ),
  }));
  const mainPageKey = value.branch?.parentPageKey || variationBaseId(value.pageKey) || value.pageKey;
  const branch = value.branch ? {...value.branch, editor: {...value.branch.editor}} : null;
  const publicViews = Object.fromEntries(DRAFT_VIEWS.map(view => {
    const metadata = currentViewMetadata(value, view);
    const available = Boolean(value.views) || view === 'desktop';
    const sync = value.views
      ? revisionViewSyncState(value, value.currentRevisionId, view, {
        syncStatus:syncStatusByView?.[view] ?? syncStatus,
      })
      : view === 'desktop'
        ? revisionSyncState(value, value.currentRevisionId, {syncStatus})
        : {status:'unavailable',reason:'views-not-initialized',checkStatus:null};
    return [view, {
      view,
      label: view === 'desktop' ? 'Desktop web' : 'Mobile web',
      available,
      revision: value.currentRevisionId,
      sync,
      workingUrl: workingRevisionUrl(value.pageKey, value.sourceUrl, value.currentRevisionId, null, view),
      stableWorkingUrl: workingRevisionUrl(value.pageKey, value.sourceUrl, null, null, view),
      editableNodes: metadata.editableNodes.map(item => ({
        ...item,
        workingUrl: workingRevisionUrl(
          value.pageKey, value.sourceUrl, value.currentRevisionId, item.sectionId, view,
        ),
      })),
      workingBindings: metadata.workingBindings.map(item => ({
        ...item,
        element: {...item.element, classes: [...item.element.classes]},
        firstHeading: item.firstHeading ? {...item.firstHeading} : null,
        workingUrl: workingRevisionUrl(
          value.pageKey, value.sourceUrl, value.currentRevisionId, item.sectionId, view,
        ),
      })),
      screenshot: publicCapture(
        revisionViewRecord(value.revisions.at(-1), view).capture,
        value.pageKey,
        value.currentRevisionId,
        view,
      ),
    }];
  }));
  const activeMetadata = publicViews[activeView];
  const mainLayoutAmendment = availableMainLayoutAmendment(value);
  return {
    pageKey: value.pageKey,
    targetId: value.targetId,
    label: workingIdentity(value, value.currentRevisionId, {syncStatus,syncStatusByView}),
    baseLabel: value.label,
    family: value.family,
    variant: value.variant,
    category: value.category,
    sourceUrl: value.sourceUrl,
    selectedSourceUrl: target.productionUrl,
    selectedLabel: value.branch ? value.label : target.label,
    sourceVersion: target.sourceVersion || null,
    referenceUrl: target.referenceUrl || target.productionUrl,
    contentBaseUrl,
    activeView,
    views: publicViews,
    viewSetupRequired:!value.views,
    viewSync:value.views ? releaseState.sync : {
      status:'unsynced',reason:'views-not-initialized',checkStatus:null,
      views:{desktop:publicViews.desktop.sync,mobile:publicViews.mobile.sync},
    },
    version,
    setup: releaseState.setup,
    archiveNumber: releaseState.archiveNumber,
    releaseStarted: Boolean(value.release),
    mainLayoutAmendment: mainLayoutAmendment ? {...mainLayoutAmendment} : null,
    changedSections,
    mainPageKey,
    variation: branch ? {name: branch.name, pageKey: value.pageKey} : null,
    branch,
    lifecycle: {
      status:lifecycleStatus(value),
      events:(value.lifecycle?.events || []).map(event => ({
        ...event, editor:{...event.editor},
      })),
    },
    livePages,
    sourceOutdated: value.sourceUrl !== target.productionUrl
      || (!value.branch && value.label !== target.label),
    pageStatus,
    pendingEditCount,
    latestPagePublication: latestPagePublication
      ? {...latestPagePublication, editor: {...latestPagePublication.editor}} : null,
    sync: releaseState.sync,
    sourceMatchStatus: sourceMatchStatus(value),
    liveSource: liveSource ? {
      revisionId: liveSource.revision.id,
      createdAt: liveSource.revision.createdAt,
      editor: {...liveSource.revision.editor},
      ...liveSource.revision.sourceEvidence,
    } : null,
    workingUrl: activeMetadata.workingUrl,
    stableWorkingUrl: activeMetadata.stableWorkingUrl,
    revision: value.currentRevisionId,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    editor: {...value.editor},
    editableNodes: activeMetadata.editableNodes,
    workingBindings: activeMetadata.workingBindings,
    history: value.revisions.map(item => publicRevision(
      item, value.pageKey, value,
      item.id === value.currentRevisionId
        ? {syncStatus,syncStatusByView,view:activeView} : {view:activeView},
    )),
    changeLog: value.revisions.map(item => {
      const release = revisionReleaseState(
        value, item.id, item.id === value.currentRevisionId ? {syncStatus} : {},
      );
      return {
        revisionId: item.id,
        version: release.version,
        setup: release.setup,
        archiveNumber: release.archiveNumber,
        createdAt: item.createdAt,
        editor: {...item.editor},
        sectionId: item.sectionId,
        releaseType: item.releaseType || null,
        summary: concreteChangeSummary(item),
      };
    }),
    publications: value.publications.map(item => ({...item, editor: {...item.editor}})),
  };
}

function authOptions(environment) {
  const storeId = environment.FUNNEL_TRACKER_BLOB_STORE_ID;
  const token = environment.FUNNEL_TRACKER_BLOB_READ_WRITE_TOKEN;
  if (typeof storeId === 'string' && /^store_[A-Za-z0-9]+$/.test(storeId)) return {storeId};
  if (typeof token === 'string' && token.length >= 32) return {token};
  throw new DraftStoreUnavailableError('draft storage is not configured');
}

function isNotFound(error) {
  return error instanceof BlobNotFoundError || error?.name === 'BlobNotFoundError';
}

function isConflict(error) {
  return error instanceof BlobPreconditionFailedError || error?.name === 'BlobPreconditionFailedError';
}

function sameEtag(left, right) {
  return typeof left === 'string' && typeof right === 'string'
    && left.replace(/^W\//, '') === right.replace(/^W\//, '');
}

function createEmptyManifest(now = new Date()) {
  return {schema: 1, updatedAt: now.toISOString(), drafts: []};
}

function validWorkingBinding(value) {
  return isPlainObject(value)
    && Object.keys(value).sort().join(',') === 'element,firstHeading,sectionId,selector'
    && validSectionId(value.sectionId)
    && typeof value.selector === 'string' && value.selector.length >= 1 && value.selector.length <= 500
    && isPlainObject(value.element)
    && Object.keys(value.element).sort().join(',') === 'classes,id,tag'
    && typeof value.element.tag === 'string' && /^[a-z][a-z0-9-]{0,39}$/.test(value.element.tag)
    && (value.element.id === null || (typeof value.element.id === 'string' && value.element.id.length <= 160))
    && Array.isArray(value.element.classes) && value.element.classes.length <= 100
    && value.element.classes.every(item => typeof item === 'string' && /^[^\s<>"'\u0000-\u001f\u007f]{1,512}$/.test(item))
    && new Set(value.element.classes).size === value.element.classes.length
    && (value.firstHeading === null || (isPlainObject(value.firstHeading)
      && Object.keys(value.firstHeading).sort().join(',') === 'tag,text'
      && /^h[1-6]$/.test(value.firstHeading.tag)
      && normalizedText(value.firstHeading.text, 1, 500) === value.firstHeading.text));
}

function validImageState(value) {
  return isPlainObject(value)
    && Object.keys(value).sort().join(',') === 'pictureSources,srcset,url'
    && typeof value.url === 'string' && value.url.length <= 2048
    && typeof value.srcset === 'string' && value.srcset.length <= 4096
    && Array.isArray(value.pictureSources) && value.pictureSources.length <= 20
    && value.pictureSources.every(item => typeof item === 'string' && item.length <= 4096);
}

function pendingCapture() {
  return {
    status: 'pending', lastAttemptAt: null, error: null,
    imageSha256: null, width: null, height: null, blobPath: null,
  };
}

function revisionViewRecord(revision, view = 'desktop') {
  const normalized = normalizedView(view);
  if (!revision || !normalized) return null;
  return revision.views?.[normalized] || {
    htmlSha256: revision.htmlSha256,
    blobPath: revision.blobPath,
    capture: revision.capture,
  };
}

function currentViewMetadata(draft, view = 'desktop') {
  const normalized = normalizedView(view);
  if (!draft || !normalized) return null;
  return draft.views?.[normalized] || {
    editableNodes: draft.editableNodes,
    workingBindings: draft.workingBindings,
  };
}

function dualViewRecords(desktop, mobile) {
  const records = {
    desktop: {
      htmlSha256: desktop.htmlSha256,
      blobPath: desktop.blobPath,
      capture: desktop.capture,
    },
    mobile: {
      htmlSha256: mobile.htmlSha256,
      blobPath: mobile.blobPath,
      capture: mobile.capture,
    },
  };
  for (const view of DRAFT_VIEWS) {
    if ((view === 'desktop' ? desktop : mobile).sourceEvidence) {
      records[view].sourceEvidence = structuredClone(
        (view === 'desktop' ? desktop : mobile).sourceEvidence,
      );
    }
  }
  return records;
}

function validCapture(value, pageKey, revisionId, view = 'desktop') {
  if (!isPlainObject(value)
      || Object.keys(value).sort().join(',') !== 'blobPath,error,height,imageSha256,lastAttemptAt,status,width'
      || !['pending', 'ready', 'error'].includes(value.status)
      || !(value.lastAttemptAt === null || validIso(value.lastAttemptAt))) return false;
  if (value.status === 'pending') {
    return value.lastAttemptAt === null && value.error === null && value.imageSha256 === null
      && value.width === null && value.height === null && value.blobPath === null;
  }
  if (value.status === 'error') {
    return value.lastAttemptAt !== null && isPlainObject(value.error)
      && Object.keys(value.error).sort().join(',') === 'code,message'
      && typeof value.error.code === 'string' && /^[a-z0-9_]{1,80}$/.test(value.error.code)
      && normalizedText(value.error.message, 1, 500) === value.error.message
      && value.imageSha256 === null && value.width === null && value.height === null
      && value.blobPath === null;
  }
  return value.error === null && value.lastAttemptAt !== null
    && typeof value.imageSha256 === 'string' && /^[a-f0-9]{64}$/.test(value.imageSha256)
    && value.width === (view === 'mobile' ? 390 : 1280)
    && Number.isSafeInteger(value.height) && value.height >= 1 && value.height <= 50000
    && typeof value.blobPath === 'string'
    && value.blobPath.startsWith(`${DRAFT_HTML_PREFIX}/${pageKey}/screenshots/${revisionId}/`)
    && value.blobPath.endsWith('.png');
}

function exactMaterial(value) {
  if (!isPlainObject(value)) return false;
  const normalized = normalizedChangeMaterial(value);
  return normalized && Object.keys(normalized).length === Object.keys(value).length
    && Object.entries(normalized).every(([key, item]) => value[key] === item);
}

function validBranch(value, pageKey) {
  const keys = isPlainObject(value) ? Object.keys(value).sort().join(',') : '';
  const legacyKeys = 'createdAt,editor,kind,name,parentPageKey,parentRevisionId';
  const currentKeys = `${legacyKeys},contentBaseUrl`.split(',').sort().join(',');
  return isPlainObject(value)
    && (keys === legacyKeys || keys === currentKeys)
    && value.kind === 'variation'
    && variationBaseId(pageKey) === value.parentPageKey
    && validMainPageKey(value.parentPageKey)
    && validRevisionId(value.parentRevisionId)
    && normalizedText(value.name, 1, 80) === value.name
    && (value.contentBaseUrl === undefined
      || validDraftSourceUrl(value.contentBaseUrl) || validLiveUrl(value.contentBaseUrl))
    && validIso(value.createdAt)
    && validEditor(value.editor);
}

function validRelease(value) {
  const keys = isPlainObject(value) ? Object.keys(value).sort().join(',') : '';
  return isPlainObject(value)
    && (keys === 'anchorRevisionId,anchoredAt,editor'
      || keys === 'anchorRevisionId,anchoredAt,editor,initialSync')
    && validRevisionId(value.anchorRevisionId)
    && validIso(value.anchoredAt)
    && validEditor(value.editor)
    && (value.initialSync === undefined || ['synced', 'unsynced'].includes(value.initialSync));
}

function lifecycleStatus(draft) {
  return draft?.lifecycle?.status || 'active';
}

function assertActiveDraft(draft) {
  const status = lifecycleStatus(draft);
  if (status !== 'active') {
    throw new InvalidDraftDataError(status === 'deleted'
      ? 'deleted_variation' : 'archived_variation');
  }
}

function validLifecycle(value) {
  if (!isPlainObject(value)
      || Object.keys(value).sort().join(',') !== 'events,status'
      || !['active', 'archived', 'deleted'].includes(value.status)
      || !Array.isArray(value.events) || value.events.length < 1 || value.events.length > 2000) {
    return false;
  }
  let status = 'active';
  for (const event of value.events) {
    if (!isPlainObject(event)
        || Object.keys(event).sort().join(',') !== 'action,at,editor'
        || !['archive', 'restore', 'delete'].includes(event.action)
        || !validIso(event.at) || !validEditor(event.editor)) return false;
    if ((event.action === 'archive' && status !== 'active')
        || (event.action === 'restore' && status !== 'archived')
        || (event.action === 'delete' && !['active', 'archived'].includes(status))) return false;
    status = event.action === 'archive' ? 'archived'
      : event.action === 'restore' ? 'active' : 'deleted';
  }
  return status === value.status;
}

function validPromotion(value, pageKey) {
  return isPlainObject(value)
    && Object.keys(value).sort().join(',') === 'sourcePageKey,sourceRevision,sourceVariationName'
    && variationBaseId(value.sourcePageKey) === pageKey
    && validRevisionId(value.sourceRevision)
    && normalizedText(value.sourceVariationName, 1, 80) === value.sourceVariationName;
}

function validPromotionSectionChanges(value) {
  if (!Array.isArray(value) || value.length > 1000) return false;
  const ids = new Set();
  return value.every(item => isPlainObject(item)
    && Object.keys(item).sort().join(',') === 'sectionId,views'
    && validSectionId(item.sectionId) && !ids.has(item.sectionId) && ids.add(item.sectionId)
    && Array.isArray(item.views) && item.views.length >= 1 && item.views.length <= DRAFT_VIEWS.length
    && item.views.every(validView) && new Set(item.views).size === item.views.length);
}

function validSectionCopyBefore(value) {
  return isPlainObject(value)
    && Object.keys(value).sort().join(',') === 'sectionSha256'
    && typeof value.sectionSha256 === 'string' && /^[a-f0-9]{64}$/.test(value.sectionSha256);
}

function validSectionCopyAfter(value) {
  return isPlainObject(value)
    && Object.keys(value).sort().join(',') === 'sectionSha256,sourcePageKey,sourceRevision,sourceSectionId'
    && validPageKey(value.sourcePageKey)
    && validRevisionId(value.sourceRevision)
    && validSectionId(value.sourceSectionId)
    && typeof value.sectionSha256 === 'string' && /^[a-f0-9]{64}$/.test(value.sectionSha256);
}

function validSectionLayoutAfter(value) {
  return isPlainObject(value)
    && Object.keys(value).sort().join(',') === 'layoutId,sectionSha256'
    && Boolean(preparedLayoutRegistry.preparedLayoutMetadata(value.layoutId))
    && typeof value.sectionSha256 === 'string' && /^[a-f0-9]{64}$/.test(value.sectionSha256);
}

function validViewMetadata(value) {
  if (!isPlainObject(value)
      || Object.keys(value).sort().join(',') !== 'editableNodes,workingBindings'
      || !Array.isArray(value.editableNodes) || value.editableNodes.length > 1000
      || !Array.isArray(value.workingBindings) || value.workingBindings.length < 1
      || value.workingBindings.length > 1000) return false;
  const bindingIds = new Set();
  for (const binding of value.workingBindings) {
    if (!validWorkingBinding(binding) || bindingIds.has(binding.sectionId)) return false;
    bindingIds.add(binding.sectionId);
  }
  const editIds = new Set();
  for (const node of value.editableNodes) {
    const expected = node.type === 'image'
      ? 'alt,editId,label,sectionId,tag,type,value'
      : 'editId,label,parentTag,sectionId,tag,type,value';
    if (!isPlainObject(node) || Object.keys(node).sort().join(',') !== expected
        || !validEditId(node.editId) || editIds.has(node.editId)
        || !validSectionId(node.sectionId) || !['text', 'image'].includes(node.type)
        || (node.type === 'image' ? node.tag !== 'img'
          : (node.tag !== 'funnel-copy' || !TEXT_TAGS.has(node.parentTag)))
        || normalizedText(node.label, 1, 300) !== node.label
        || typeof node.value !== 'string' || node.value.length > 24000
        || (node.type === 'image'
          && (typeof node.alt !== 'string' || node.alt.length > 2000))
        || !bindingIds.has(node.sectionId)) return false;
    editIds.add(node.editId);
  }
  return true;
}

function validRevisionViews(value, pageKey, revisionId) {
  if (!isPlainObject(value) || Object.keys(value).sort().join(',') !== 'desktop,mobile') return false;
  return DRAFT_VIEWS.every(view => {
    const record = value[view];
    const keys = isPlainObject(record) ? Object.keys(record).sort().join(',') : '';
    return isPlainObject(record)
      && (keys === 'blobPath,capture,htmlSha256'
        || keys === 'blobPath,capture,htmlSha256,sourceEvidence')
      && typeof record.htmlSha256 === 'string' && /^[a-f0-9]{64}$/.test(record.htmlSha256)
      && record.blobPath === `${DRAFT_HTML_PREFIX}/${pageKey}/history/${revisionId}/${view}.html`
      && validCapture(record.capture, pageKey, revisionId, view)
      && (record.sourceEvidence === undefined
        || validSourceEvidence(record.sourceEvidence, pageKey));
  });
}

function validViewChanges(value, revision) {
  if (!isPlainObject(value) || Object.keys(value).sort().join(',') !== 'desktop,mobile') return false;
  return DRAFT_VIEWS.every(view => {
    const change = value[view];
    if (change === null) return revision.scope !== 'shared' && revision.scope !== view;
    if (!isPlainObject(change)
        || Object.keys(change).sort().join(',') !== 'after,before,operationType'
        || change.operationType !== revision.operationType) return false;
    return revision.operationType === 'text'
      ? normalizedText(change.before, 1, 24000, true) === change.before
        && normalizedText(change.after, 1, 24000, true) === change.after
      : validImageState(change.before) && validImageState(change.after);
  });
}

function validateManifest(value) {
  if (!isPlainObject(value) || Object.keys(value).sort().join(',') !== 'drafts,schema,updatedAt'
      || value.schema !== 1 || !validIso(value.updatedAt) || !Array.isArray(value.drafts)
      || value.drafts.length > MAX_DRAFTS) throw new InvalidDraftDataError('invalid_draft_manifest');
  const keys = new Set();
  for (const draft of value.drafts) {
    const draftKeys = Object.keys(draft).sort().join(',');
    const mainDraftKeys = 'category,createdAt,currentRevisionId,editableNodes,editor,family,label,pageKey,publications,revisions,sourceSha256,sourceUrl,targetId,updatedAt,variant,workingBindings';
    const dualDraftKeys = `${mainDraftKeys},views`.split(',').sort().join(',');
    const branchDraftKeys = `${mainDraftKeys},branch`.split(',').sort().join(',');
    const releasedDraftKeys = `${mainDraftKeys},release`.split(',').sort().join(',');
    const releasedBranchDraftKeys = `${mainDraftKeys},branch,release`.split(',').sort().join(',');
    const ordinaryDraftKeys = [
      mainDraftKeys, branchDraftKeys, releasedDraftKeys, releasedBranchDraftKeys,
      dualDraftKeys,
      `${dualDraftKeys},branch`.split(',').sort().join(','),
      `${dualDraftKeys},release`.split(',').sort().join(','),
      `${dualDraftKeys},branch,release`.split(',').sort().join(','),
    ];
    const allowedDraftKeys = new Set(ordinaryDraftKeys.flatMap(keys => [
      keys, `${keys},lifecycle`.split(',').sort().join(','),
    ]));
    if (!isPlainObject(draft)
        || !allowedDraftKeys.has(draftKeys)
        || !validPageKey(draft.pageKey) || draft.targetId !== draft.pageKey
        || keys.has(draft.pageKey) || !validIso(draft.createdAt) || !validIso(draft.updatedAt)
        || !validEditor(draft.editor) || !validRevisionId(draft.currentRevisionId)
        || !Array.isArray(draft.editableNodes) || draft.editableNodes.length > 1000
        || !Array.isArray(draft.workingBindings) || draft.workingBindings.length < 1
        || draft.workingBindings.length > 1000
        || !Array.isArray(draft.revisions) || draft.revisions.length < 1 || draft.revisions.length > MAX_REVISIONS
        || !Array.isArray(draft.publications) || draft.publications.length > MAX_PUBLICATIONS) {
      throw new InvalidDraftDataError('invalid_draft_record');
    }
    if (draft.views !== undefined && (!isPlainObject(draft.views)
        || Object.keys(draft.views).sort().join(',') !== 'desktop,mobile'
        || !DRAFT_VIEWS.every(view => validViewMetadata(draft.views[view]))
        || JSON.stringify(draft.editableNodes) !== JSON.stringify(draft.views.desktop.editableNodes)
        || JSON.stringify(draft.workingBindings) !== JSON.stringify(draft.views.desktop.workingBindings))) {
      throw new InvalidDraftDataError('invalid_draft_views');
    }
    if ((variationBaseId(draft.pageKey) === null) !== (draft.branch === undefined)
        || (draft.branch !== undefined && !validBranch(draft.branch, draft.pageKey))) {
      throw new InvalidDraftDataError('invalid_draft_branch');
    }
    if (draft.lifecycle !== undefined
        && (!draft.branch || !validLifecycle(draft.lifecycle))) {
      throw new InvalidDraftDataError('invalid_draft_lifecycle');
    }
    if (draft.release !== undefined && !validRelease(draft.release)) {
      throw new InvalidDraftDataError('invalid_draft_release');
    }
    keys.add(draft.pageKey);
    const target = getTarget(draft.pageKey);
    if (normalizedText(draft.label, 1, 200) !== draft.label
        || draft.family !== target.family || draft.variant !== target.variant
        || draft.category !== target.category || !validDraftSourceUrl(draft.sourceUrl)
        || !/^[a-f0-9]{64}$/.test(draft.sourceSha256)) throw new InvalidDraftDataError('invalid_draft_source');
    const bindingIds = new Set();
    for (const binding of draft.workingBindings) {
      if (!validWorkingBinding(binding) || bindingIds.has(binding.sectionId)) {
        throw new InvalidDraftDataError('invalid_working_binding');
      }
      bindingIds.add(binding.sectionId);
    }
    const editIds = new Set();
    for (const node of draft.editableNodes) {
      const expected = node.type === 'image' ? 'alt,editId,label,sectionId,tag,type,value' : 'editId,label,parentTag,sectionId,tag,type,value';
      if (!isPlainObject(node) || Object.keys(node).sort().join(',') !== expected
          || !validEditId(node.editId) || editIds.has(node.editId) || !validSectionId(node.sectionId)
          || !['text', 'image'].includes(node.type)
          || (node.type === 'image' ? node.tag !== 'img' : (node.tag !== 'funnel-copy' || !TEXT_TAGS.has(node.parentTag)))
          || normalizedText(node.label, 1, 300) !== node.label || typeof node.value !== 'string'
          || node.value.length > 24000 || (node.type === 'image'
            && (typeof node.alt !== 'string' || node.alt.length > 2000))) {
        throw new InvalidDraftDataError('invalid_editable_node');
      }
      if (!bindingIds.has(node.sectionId)) throw new InvalidDraftDataError('invalid_editable_section');
      editIds.add(node.editId);
    }
    const bindingIdsByView = Object.fromEntries((draft.views ? DRAFT_VIEWS : ['desktop']).map(view => {
      const metadata = currentViewMetadata(draft, view);
      return [view, new Set(metadata.workingBindings.map(binding => binding.sectionId))];
    }));
    const editNodesByView = Object.fromEntries((draft.views ? DRAFT_VIEWS : ['desktop']).map(view => {
      const metadata = currentViewMetadata(draft, view);
      return [view, new Map(metadata.editableNodes.map(node => [node.editId, node]))];
    }));
    const revisionIds = new Set();
    const latestInitializationIndex = draft.revisions.findLastIndex(revision => revision.kind === 'initialized');
    if (latestInitializationIndex < 0) throw new InvalidDraftDataError('invalid_initial_revision');
    const latestStructureIndex = draft.revisions.findLastIndex(revision => (
      ['initialized', 'section-copy', 'section-layout', 'variation-promotion'].includes(revision.kind)
    ));
    for (const [revisionIndex, revision] of draft.revisions.entries()) {
      const expectedRevisionKeys = 'after,before,blobPath,capture,createdAt,editId,editor,htmlSha256,id,kind,material,operationType,sectionId';
      const revisionKeys = Object.keys(revision);
      const allowedRevisionKeys = new Set([
        ...expectedRevisionKeys.split(','), 'sourceEvidence', 'releaseType', 'changeSummary',
        'promotion', 'sectionChanges', 'layoutId', 'amendsRevisionId',
        'views', 'scope', 'view', 'viewChanges',
      ]);
      const hasReleaseType = revision.releaseType !== undefined;
      const hasChangeSummary = revision.changeSummary !== undefined;
      if (!isPlainObject(revision)
          || revisionKeys.some(key => !allowedRevisionKeys.has(key))
          || expectedRevisionKeys.split(',').some(key => !(key in revision))
          || (hasReleaseType && !['minor', 'major', 'amendment'].includes(revision.releaseType))
          || (hasReleaseType && !hasChangeSummary)
          || (hasChangeSummary && !(revision.changeSummary === null
            || normalizedText(revision.changeSummary, 1, MAX_CHANGE_SUMMARY_LENGTH) === revision.changeSummary))
          || ((revision.kind === 'section-layout') !== (revision.layoutId !== undefined))
          || (revision.amendsRevisionId !== undefined && revision.kind !== 'section-layout')
          || (revision.releaseType === 'amendment' && revision.kind !== 'section-layout')
          || !validRevisionId(revision.id) || revisionIds.has(revision.id)
          || !['initialized', 'edit', 'section-copy', 'section-layout', 'variation-promotion'].includes(revision.kind) || !validIso(revision.createdAt)
          || !validEditor(revision.editor) || !/^[a-f0-9]{64}$/.test(revision.htmlSha256)
          || !validCapture(revision.capture, draft.pageKey, revision.id)
          || (revision.views === undefined
            ? revision.blobPath !== `${DRAFT_HTML_PREFIX}/${draft.pageKey}/history/${revision.id}.html`
            : revision.blobPath !== `${DRAFT_HTML_PREFIX}/${draft.pageKey}/history/${revision.id}/desktop.html`)
          || !(revision.material === null || exactMaterial(revision.material))) {
        throw new InvalidDraftDataError('invalid_draft_revision');
      }
      if (revision.views !== undefined && (!validRevisionViews(
        revision.views, draft.pageKey, revision.id,
      ) || revision.htmlSha256 !== revision.views.desktop.htmlSha256
          || revision.blobPath !== revision.views.desktop.blobPath
          || JSON.stringify(revision.capture) !== JSON.stringify(revision.views.desktop.capture)
          || !['shared', 'desktop', 'mobile'].includes(revision.scope)
          || !validView(revision.view))) {
        throw new InvalidDraftDataError('invalid_draft_revision_views');
      }
      if ((revision.viewChanges !== undefined) !== (revision.kind === 'edit' && revision.views !== undefined)
          || (revision.viewChanges !== undefined && !validViewChanges(revision.viewChanges, revision))) {
        throw new InvalidDraftDataError('invalid_draft_revision_views');
      }
      const relevantViews = draft.views && revision.views
        ? (revision.scope === 'shared' ? DRAFT_VIEWS : [revision.view]) : ['desktop'];
      const sectionMapped = revision.sectionId === null || relevantViews.every(view => (
        bindingIdsByView[view]?.has(revision.sectionId)
      ));
      const editMapped = revision.editId === null || relevantViews.every(view => (
        editNodesByView[view]?.get(revision.editId)?.sectionId === revision.sectionId
      ));
      if (revision.kind === 'initialized') {
        if (revision.sectionId !== null || revision.editId !== null || revision.operationType !== 'initialize'
            || revision.before !== null || revision.after !== null || revision.material !== null
            || revision.promotion !== undefined || revision.sectionChanges !== undefined
            || (revision.sourceEvidence !== undefined
              && !validSourceEvidence(revision.sourceEvidence, draft.pageKey))) {
          throw new InvalidDraftDataError('invalid_initial_revision');
        }
      } else if (revision.kind === 'variation-promotion') {
        if (revision.sourceEvidence !== undefined || revision.sectionId !== null
            || revision.editId !== null || revision.operationType !== 'variation-promotion'
            || revision.before !== null || revision.after !== null || revision.material !== null
            || !validPromotion(revision.promotion, draft.pageKey)
            || !validPromotionSectionChanges(revision.sectionChanges)
            || revision.scope !== 'shared' || revision.view !== 'desktop') {
          throw new InvalidDraftDataError('invalid_variation_promotion_revision');
        }
      } else if (revision.kind === 'section-copy') {
        if (revision.promotion !== undefined || revision.sectionChanges !== undefined
            || revision.sourceEvidence !== undefined || !validSectionId(revision.sectionId)
            || revision.editId !== null || revision.operationType !== 'section-copy'
            || revision.material !== null || !validSectionCopyBefore(revision.before)
            || !validSectionCopyAfter(revision.after) || !sectionMapped) {
          throw new InvalidDraftDataError('invalid_section_copy_revision');
        }
      } else if (revision.kind === 'section-layout') {
        const layout = preparedLayoutRegistry.preparedLayoutMetadata(revision.layoutId);
        const allowedAmendment=MAIN_LAYOUT_AMENDMENTS[draft.variant];
        const amendment = !draft.branch && revision.releaseType === 'amendment'
          && validRevisionId(revision.amendsRevisionId)
          && draft.revisions[revisionIndex-1]?.id === revision.amendsRevisionId
          && allowedAmendment?.layoutId===revision.layoutId
          && allowedAmendment?.sectionId===revision.sectionId;
        const variationLayout = Boolean(draft.branch) && revision.releaseType === 'minor'
          && revision.amendsRevisionId === undefined;
        if (!layout || !draft.views || !(amendment || variationLayout)
            || !preparedLayoutMatchesTarget(draft, layout)
            || revision.sectionId !== layout.sectionId
            || revision.promotion !== undefined || revision.sectionChanges !== undefined
            || revision.sourceEvidence !== undefined || revision.editId !== null
            || revision.operationType !== 'section-layout' || revision.material !== null
            || revision.scope !== layout.view || revision.view !== layout.view
            || !revision.changeSummary
            || !validSectionCopyBefore(revision.before)
            || !validSectionLayoutAfter(revision.after)
            || revision.after.layoutId !== revision.layoutId || !sectionMapped) {
          throw new InvalidDraftDataError('invalid_section_layout_revision');
        }
      } else if (revision.promotion !== undefined || revision.sectionChanges !== undefined
          || revision.sourceEvidence !== undefined
          || !validSectionId(revision.sectionId) || !validEditId(revision.editId)
          || !['text', 'image'].includes(revision.operationType)
          || !sectionMapped
          || (revisionIndex > latestStructureIndex && !editMapped)
          || (revision.operationType === 'text'
            ? !(normalizedText(revision.before, 1, 24000, true) === revision.before
              && normalizedText(revision.after, 1, 24000, true) === revision.after)
            : !(validImageState(revision.before) && validImageState(revision.after)))) {
        throw new InvalidDraftDataError('invalid_edit_revision');
      }
      revisionIds.add(revision.id);
    }
    if (draft.release !== undefined) {
      const anchorIndex = draft.revisions.findIndex(item => item.id === draft.release.anchorRevisionId);
      if (anchorIndex < 0 || draft.revisions.some((revision, index) => (
        index < anchorIndex
          ? revision.releaseType !== undefined
          : index === anchorIndex
            ? revision.releaseType !== undefined
            : revision.releaseType === undefined || revision.changeSummary === undefined
      ))) {
        throw new InvalidDraftDataError('invalid_draft_release_history');
      }
    } else if (draft.revisions.some(revision => (
      revision.releaseType !== undefined || revision.changeSummary !== undefined
    ))) {
      throw new InvalidDraftDataError('invalid_draft_release_history');
    }
    const latestInitialization = draft.revisions[latestInitializationIndex];
    if (latestInitialization.sourceEvidence
        && latestInitialization.sourceEvidence.sourceFingerprint !== draft.sourceSha256) {
      throw new InvalidDraftDataError('invalid_draft_source_evidence');
    }
    if (!revisionIds.has(draft.currentRevisionId)
        || draft.revisions.at(-1).id !== draft.currentRevisionId) {
      throw new InvalidDraftDataError('invalid_current_revision');
    }
    const publicationIds = new Set();
    for (const publication of draft.publications) {
      const publicationKeys = isPlainObject(publication)
        ? Object.keys(publication).sort().join(',') : '';
      const legacyPublicationKeys = 'confirmedAt,editor,id,liveUrl,note,revisionId,sectionId';
      const evidencedPublicationKeys = `${legacyPublicationKeys},liveContentSha256,liveSourceCommit`
        .split(',').sort().join(',');
      const comparedPublicationKeys = `${evidencedPublicationKeys},liveComparisonSha256,liveComparisonVersion`
        .split(',').sort().join(',');
      const viewPublicationKeys = `${legacyPublicationKeys},view`.split(',').sort().join(',');
      const evidencedViewPublicationKeys = `${evidencedPublicationKeys},view`.split(',').sort().join(',');
      const comparedViewPublicationKeys = `${comparedPublicationKeys},view`.split(',').sort().join(',');
      if (!isPlainObject(publication)
          || ![legacyPublicationKeys, evidencedPublicationKeys, viewPublicationKeys,
            evidencedViewPublicationKeys, comparedPublicationKeys,
            comparedViewPublicationKeys].includes(publicationKeys)
          || !validPublicationId(publication.id)
          || publicationIds.has(publication.id) || !revisionIds.has(publication.revisionId)
          || !(publication.sectionId === null || validSectionId(publication.sectionId))
          || !validLiveUrl(publication.liveUrl)
          || !(publication.note === null || normalizedText(publication.note, 1, 4000, true) === publication.note)
          || !validIso(publication.confirmedAt) || !validEditor(publication.editor)
          || (publication.view !== undefined && !validView(publication.view))
          || ([evidencedPublicationKeys, evidencedViewPublicationKeys,
            comparedPublicationKeys, comparedViewPublicationKeys].includes(publicationKeys)
            && (publication.sectionId !== null
              || !/^[a-f0-9]{64}$/.test(publication.liveContentSha256)
              || !/^[a-f0-9]{40}$/.test(publication.liveSourceCommit)))
          || ([comparedPublicationKeys, comparedViewPublicationKeys].includes(publicationKeys)
            && (!(draft.family === 'bc'
              ? [BC_LEGACY_COMPARISON_VERSION,BC_COMPARISON_VERSION]
              : draft.family === 'join' ? [JOIN_COMPARISON_VERSION] : [])
              .includes(publication.liveComparisonVersion)
              || !/^[a-f0-9]{64}$/.test(publication.liveComparisonSha256)))) {
        throw new InvalidDraftDataError('invalid_publication');
      }
      const revision = draft.revisions.find(item => item.id === publication.revisionId);
      if (publication.sectionId !== null
          && (revision.kind !== 'edit' || revision.sectionId !== publication.sectionId
            || (draft.views && publication.view !== undefined
              && !revisionAffectsView(revision, publication.view)))) {
        throw new InvalidDraftDataError('invalid_publication_revision');
      }
      publicationIds.add(publication.id);
    }
  }
  const draftsByKey = new Map(value.drafts.map(draft => [draft.pageKey, draft]));
  for (const draft of value.drafts) {
    if (!draft.branch) continue;
    const parent = draftsByKey.get(draft.branch.parentPageKey);
    if (!parent || !parent.revisions.some(revision => revision.id === draft.branch.parentRevisionId)) {
      throw new InvalidDraftDataError('invalid_draft_branch_parent');
    }
  }
  for (const draft of value.drafts) {
    for (const revision of draft.revisions.filter(item => item.kind === 'variation-promotion')) {
      const source = draftsByKey.get(revision.promotion.sourcePageKey);
      if (!source?.branch
          || source.branch.parentPageKey !== draft.pageKey
          || source.branch.name !== revision.promotion.sourceVariationName
          || !source.revisions.some(item => item.id === revision.promotion.sourceRevision)) {
        throw new InvalidDraftDataError('invalid_variation_promotion_source');
      }
    }
  }
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_MANIFEST_BYTES) {
    throw new InvalidDraftDataError('draft_manifest_too_large');
  }
  return value;
}

function exactSection(document, sectionId) {
  const matches = elements(document).filter(node => getAttr(node, 'data-funnel-section-id') === sectionId);
  if (matches.length !== 1) {
    throw new InvalidDraftDataError(matches.length ? 'copy_section_not_unique' : 'copy_section_missing');
  }
  return matches[0];
}

function documentBaseUrl(document) {
  const value = getAttr(elements(document).find(node => node.tagName === 'base'), 'href');
  if (!value) return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function absoluteResourceUrl(value, baseUrl) {
  if (typeof value !== 'string' || !baseUrl) return value;
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith('#')
      || /^(?:data|blob|javascript):/i.test(trimmed)) return value;
  try { return new URL(trimmed, baseUrl).href; } catch { return value; }
}

function absoluteSrcset(value, baseUrl) {
  if (typeof value !== 'string' || !baseUrl || /(?:^|,)\s*data:/i.test(value)) return value;
  return value.split(',').map(candidate => {
    const match = candidate.trim().match(/^(\S+)([\s\S]*)$/);
    if (!match) return candidate.trim();
    return `${absoluteResourceUrl(match[1], baseUrl)}${match[2]}`;
  }).join(', ');
}

function absoluteCssUrls(value, baseUrl) {
  if (typeof value !== 'string' || !baseUrl) return value;
  return value.replace(/url\(\s*(['"]?)([^'"\)]+)\1\s*\)/gi, (match, quote, url) => {
    const absolute = absoluteResourceUrl(url, baseUrl);
    if (absolute === url) return match;
    const wrapper = quote || '"';
    return `url(${wrapper}${absolute}${wrapper})`;
  });
}

function absolutizeCopiedResources(section, baseUrl) {
  if (!baseUrl) return;
  for (const node of elements(section)) {
    const src = getAttr(node, 'src');
    if (src !== null) setAttr(node, 'src', absoluteResourceUrl(src, baseUrl));
    const srcset = getAttr(node, 'srcset');
    if (srcset !== null) setAttr(node, 'srcset', absoluteSrcset(srcset, baseUrl));
    const poster = getAttr(node, 'poster');
    if (poster !== null) setAttr(node, 'poster', absoluteResourceUrl(poster, baseUrl));
    if (node.tagName === 'image') {
      for (const attribute of ['href', 'xlink:href']) {
        const value = getAttr(node, attribute);
        if (value !== null) setAttr(node, attribute, absoluteResourceUrl(value, baseUrl));
      }
    }
    const style = getAttr(node, 'style');
    if (style !== null) setAttr(node, 'style', absoluteCssUrls(style, baseUrl));
    if (node.tagName === 'style') {
      for (const text of (node.childNodes || []).filter(child => child.nodeName === '#text')) {
        text.value = absoluteCssUrls(text.value, baseUrl);
      }
    }
  }
}

function sectionDisplayName(section, fallback) {
  const label = elements(section).find(node => hasAttr(node, 'data-funnel-working-label'));
  const text = label ? normalizedNodeText(label) : '';
  const separator = text.indexOf(' · ');
  return normalizedText(separator >= 0 ? text.slice(separator + 3) : '', 1, 200) || fallback;
}

function descriptorsForInstrumentedSection(section, sectionId, sectionName) {
  const descriptors = [];
  let textIndex = 0;
  let imageIndex = 0;
  for (const node of elements(section).filter(item => item !== section)) {
    if (hasAttr(node, 'data-funnel-working-label')) continue;
    if (node.tagName === 'img') {
      imageIndex += 1;
      const editId = `${sectionId}-image-${String(imageIndex).padStart(3, '0')}`;
      setAttr(node, 'data-funnel-edit-id', editId);
      descriptors.push({
        editId, sectionId, type: 'image', tag: 'img',
        label: `${sectionName} · image ${imageIndex}`,
        value: getAttr(node, 'src') || '', alt: getAttr(node, 'alt') || '',
      });
    } else if (node.tagName === 'funnel-copy') {
      textIndex += 1;
      const editId = `${sectionId}-text-${String(textIndex).padStart(3, '0')}`;
      const value = normalizedText(normalizedNodeText(node), 1, 24000, true);
      if (!value || !TEXT_TAGS.has(node.parentNode?.tagName)) {
        throw new InvalidDraftDataError('copy_section_invalid_editable_node');
      }
      setAttr(node, 'data-funnel-edit-id', editId);
      descriptors.push({
        editId, sectionId, type: 'text', tag: 'funnel-copy', parentTag: node.parentNode.tagName,
        label: `${sectionName} · ${node.parentNode.tagName.toUpperCase()} copy ${textIndex}`,
        value,
      });
    }
  }
  if (descriptors.length === 0) throw new InvalidDraftDataError('copy_section_no_editable_nodes');
  return descriptors;
}

function preparedEditIdIndex(editId, sectionId, type) {
  const prefix = `${sectionId}-${type}-`;
  if (!editId.startsWith(prefix)) return null;
  const suffix = editId.slice(prefix.length);
  if (!/^\d+$/.test(suffix)) return null;
  const index = Number(suffix);
  return Number.isSafeInteger(index) && index >= 1 ? index : null;
}

function descriptorsForPreparedLayoutSection(section, sectionId, sectionName, priorDescriptors) {
  const descriptors = [];
  const reserved = new Set(priorDescriptors.map(item => item.editId));
  const priorById = new Map(priorDescriptors
    .filter(item => item.sectionId === sectionId)
    .map(item => [item.editId, item]));
  const used = new Set();
  const nextIndex = {text: 0, image: 0};
  for (const descriptor of priorDescriptors.filter(item => item.sectionId === sectionId)) {
    const index = preparedEditIdIndex(descriptor.editId, sectionId, descriptor.type);
    if (index !== null) nextIndex[descriptor.type] = Math.max(nextIndex[descriptor.type], index);
  }
  const nextEditId = type => {
    let editId;
    do {
      nextIndex[type] += 1;
      editId = `${sectionId}-${type}-${String(nextIndex[type]).padStart(3, '0')}`;
    } while (reserved.has(editId) || used.has(editId));
    return editId;
  };
  for (const node of elements(section).filter(item => item !== section)) {
    if (hasAttr(node, 'data-funnel-working-label')) continue;
    const type = node.tagName === 'img' ? 'image'
      : node.tagName === 'funnel-copy' ? 'text' : null;
    if (!type) continue;
    const value = type === 'text'
      ? normalizedText(normalizedNodeText(node), 1, 24000, true)
      : getAttr(node, 'src') || '';
    if (type === 'text' && (!value || !TEXT_TAGS.has(node.parentNode?.tagName))) {
      throw new InvalidDraftDataError('copy_section_invalid_editable_node');
    }
    const existingId = getAttr(node, 'data-funnel-edit-id');
    let prior = null;
    let editId;
    if (existingId !== null) {
      prior = priorById.get(existingId) || null;
      if (!prior || prior.type !== type || used.has(existingId)) {
        throw new InvalidDraftDataError('prepared_layout_edit_id_conflict');
      }
      editId = existingId;
    } else {
      editId = nextEditId(type);
      setAttr(node, 'data-funnel-edit-id', editId);
    }
    used.add(editId);
    const descriptorIndex = preparedEditIdIndex(editId, sectionId, type) || nextIndex[type];
    if (type === 'image') {
      descriptors.push({
        editId, sectionId, type, tag:'img',
        label:`${sectionName} · image ${descriptorIndex}`,
        value, alt:getAttr(node, 'alt') || '',
      });
    } else {
      descriptors.push({
        editId, sectionId, type, tag:'funnel-copy', parentTag:node.parentNode.tagName,
        label:`${sectionName} · ${node.parentNode.tagName.toUpperCase()} copy ${descriptorIndex}`,
        value,
      });
    }
  }
  if (descriptors.length === 0) throw new InvalidDraftDataError('copy_section_no_editable_nodes');
  return descriptors;
}

function uniqueBindingForSection(document, section, sectionId) {
  const id = getAttr(section, 'id') || null;
  const classes = String(getAttr(section, 'class') || '').split(/\s+/).filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
  const selector = id ? `#${id}` : `${section.tagName}${classes.map(item => `.${item}`).join('')}`;
  if (findBySelector(document, selector).length !== 1) {
    throw new InvalidDraftDataError('copy_section_selector_conflict');
  }
  const heading = elements(section).find(node => /^h[1-6]$/.test(node.tagName));
  return {
    sectionId, selector,
    element: {tag: section.tagName, id, classes},
    firstHeading: heading ? {tag: heading.tagName, text: normalizedNodeText(heading)} : null,
  };
}

function copySectionHtml(targetHtml, sourceHtml, {
  target, sourceSectionId, targetSectionId, targetBindings, targetDescriptors,
  preservePreparedEditIds = false,
}) {
  const sourceDocument = parse5.parse(sourceHtml);
  const targetDocument = parse5.parse(targetHtml);
  const sourceSection = exactSection(sourceDocument, sourceSectionId);
  const oldTargetSection = exactSection(targetDocument, targetSectionId);
  const targetName = sectionDisplayName(oldTargetSection, targetSectionId);
  const before = hash(Buffer.from(parse5.serializeOuter(oldTargetSection), 'utf8'));
  const fragment = parse5.parseFragment(oldTargetSection.parentNode, parse5.serializeOuter(sourceSection));
  const copied = (fragment.childNodes || []).find(node => typeof node.tagName === 'string');
  if (!copied || !oldTargetSection.parentNode?.childNodes) {
    throw new InvalidDraftDataError('copy_section_invalid_source');
  }
  absolutizeCopiedResources(copied, documentBaseUrl(sourceDocument));
  for (const label of elements(copied).filter(node => hasAttr(node, 'data-funnel-working-label'))) {
    removeElement(label);
  }
  const targetOuterId = getAttr(oldTargetSection, 'id');
  if (targetOuterId === null) removeAttr(copied, 'id');
  else setAttr(copied, 'id', targetOuterId);
  setAttr(copied, 'data-funnel-section-id', targetSectionId);
  prependParsedFragment(copied, `<a class="funnel-working-section-label" style="color:#245ca6!important;background:#fff!important;-webkit-text-fill-color:#245ca6!important" data-funnel-working-label href="${escapeAttribute(trackerReviewUrl(target, targetSectionId))}">${escapeText(targetSectionId)} · ${escapeText(targetName)}</a>`);
  const offset = oldTargetSection.parentNode.childNodes.indexOf(oldTargetSection);
  copied.parentNode = oldTargetSection.parentNode;
  oldTargetSection.parentNode.childNodes.splice(offset, 1, copied);
  for (const id of elements(copied).map(node => getAttr(node, 'id')).filter(Boolean)) {
    if (elements(targetDocument).filter(node => getAttr(node, 'id') === id).length !== 1) {
      throw new InvalidDraftDataError('copy_section_dom_id_conflict');
    }
  }
  const descriptors = preservePreparedEditIds
    ? descriptorsForPreparedLayoutSection(copied, targetSectionId, targetName, targetDescriptors)
    : descriptorsForInstrumentedSection(copied, targetSectionId, targetName);
  const binding = uniqueBindingForSection(targetDocument, copied, targetSectionId);
  const html = parse5.serialize(targetDocument);
  const unchangedBindings = deriveWorkingBindings(
    html, targetBindings.filter(item => item.sectionId !== targetSectionId),
  );
  const workingBindings = targetBindings.map(item => (
    item.sectionId === targetSectionId ? binding
      : unchangedBindings.find(bindingItem => bindingItem.sectionId === item.sectionId)
  ));
  const firstDescriptorIndex = targetDescriptors.findIndex(item => item.sectionId === targetSectionId);
  const editableNodes = targetDescriptors.filter(item => item.sectionId !== targetSectionId);
  editableNodes.splice(firstDescriptorIndex < 0 ? editableNodes.length : firstDescriptorIndex, 0, ...descriptors);
  return {
    html, editableNodes, workingBindings, before,
    after: hash(Buffer.from(parse5.serializeOuter(copied), 'utf8')),
  };
}

function describeTransformedPreparedLayout(beforeHtml, transformedHtml, {
  sectionId, targetBindings, targetDescriptors,
}) {
  const beforeDocument = parse5.parse(beforeHtml);
  const document = parse5.parse(transformedHtml);
  const beforeSection = exactSection(beforeDocument, sectionId);
  const section = exactSection(document, sectionId);
  const sectionName = sectionDisplayName(section, sectionId);
  const descriptors = descriptorsForPreparedLayoutSection(
    section, sectionId, sectionName, targetDescriptors,
  );
  const binding = uniqueBindingForSection(document, section, sectionId);
  const html = parse5.serialize(document);
  const unchangedBindings = deriveWorkingBindings(
    html, targetBindings.filter(item => item.sectionId !== sectionId),
  );
  const workingBindings = targetBindings.map(item => (
    item.sectionId === sectionId ? binding
      : unchangedBindings.find(bindingItem => bindingItem.sectionId === item.sectionId)
  ));
  const firstDescriptorIndex = targetDescriptors.findIndex(item => item.sectionId === sectionId);
  const editableNodes = targetDescriptors.filter(item => item.sectionId !== sectionId);
  editableNodes.splice(
    firstDescriptorIndex < 0 ? editableNodes.length : firstDescriptorIndex, 0, ...descriptors,
  );
  return {
    html, editableNodes, workingBindings,
    before:hash(Buffer.from(parse5.serializeOuter(beforeSection), 'utf8')),
    after:hash(Buffer.from(parse5.serializeOuter(section), 'utf8')),
  };
}

function documentWithoutSection(html, sectionId) {
  const document = parse5.parse(html);
  removeElement(exactSection(document, sectionId));
  return parse5.serialize(document);
}

function assertPreparedLayoutIsolation(beforeHtml, afterHtml, sectionId) {
  const beforeHead = beforeHtml.match(/<head(?:\s[^>]*)?>[\s\S]*?<\/head>/i)?.[0] || null;
  const afterHead = typeof afterHtml === 'string'
    ? afterHtml.match(/<head(?:\s[^>]*)?>[\s\S]*?<\/head>/i)?.[0] || null : null;
  if (typeof afterHtml !== 'string' || Buffer.byteLength(afterHtml, 'utf8') > MAX_SOURCE_BYTES
      || beforeHead === null || beforeHead !== afterHead
      || documentWithoutSection(beforeHtml, sectionId) !== documentWithoutSection(afterHtml, sectionId)) {
    throw new InvalidDraftDataError('prepared_layout_scope_violation');
  }
  const section = exactSection(parse5.parse(afterHtml), sectionId);
  if (!elements(section).some(node => node.tagName === 'style')) {
    throw new InvalidDraftDataError('prepared_layout_style_missing');
  }
}

function createDraftStore({
  getBlob = get, headBlob = head, putBlob = put, environment = process.env,
  preparedLayouts = preparedLayoutRegistry,
} = {}) {
  const auth = () => authOptions(environment);

  async function readManifest() {
    let metadata;
    try {
      metadata = await headBlob(DRAFT_MANIFEST_PATH, auth());
    } catch (error) {
      if (isNotFound(error)) return {data: createEmptyManifest(), revision: null};
      throw new DraftStoreUnavailableError('draft manifest is unavailable', {cause: error});
    }
    let result;
    try {
      result = await getBlob(DRAFT_MANIFEST_PATH, {access: 'private', useCache: false, ...auth()});
    } catch (error) {
      if (isNotFound(error)) throw new DraftStoreConflictError('draft manifest changed while reading');
      throw new DraftStoreUnavailableError('draft manifest is unavailable', {cause: error});
    }
    if (!result?.stream || !sameEtag(metadata?.etag, result.blob?.etag)) {
      throw new DraftStoreConflictError('draft manifest changed while reading');
    }
    const raw = await new Response(result.stream).text();
    if (Buffer.byteLength(raw, 'utf8') > MAX_MANIFEST_BYTES) throw new DraftStoreUnavailableError('draft manifest is too large');
    try {
      return {data: validateManifest(JSON.parse(raw)), revision: metadata.etag};
    } catch (error) {
      throw new DraftStoreUnavailableError('draft manifest is invalid', {cause: error});
    }
  }

  async function writeManifest(data, revision) {
    validateManifest(data);
    const options = {
      access: 'private', addRandomSuffix: false, contentType: 'application/json',
      cacheControlMaxAge: 60, ...auth(),
    };
    if (revision === null) options.allowOverwrite = false;
    else { options.allowOverwrite = true; options.ifMatch = revision; }
    try {
      await putBlob(DRAFT_MANIFEST_PATH, `${JSON.stringify(data, null, 2)}\n`, options);
    } catch (error) {
      if (isConflict(error)) throw new DraftStoreConflictError('draft manifest changed', {cause: error});
      throw new DraftStoreUnavailableError('draft manifest write failed', {cause: error});
    }
    return readManifest();
  }

  async function mutateManifest(mutator, attempts = 5) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const current = await readManifest();
      const next = await mutator(structuredClone(current.data), current);
      try {
        return await writeManifest(next, current.revision);
      } catch (error) {
        if (!(error instanceof DraftStoreConflictError) || attempt === attempts - 1) throw error;
      }
    }
    throw new DraftStoreConflictError('draft manifest changed repeatedly');
  }

  async function putHtml(pageKey, revisionId, html, view = null) {
    if (!(view === null || validView(view))) throw new InvalidDraftDataError('invalid_view');
    const blobPath = view === null
      ? `${DRAFT_HTML_PREFIX}/${pageKey}/history/${revisionId}.html`
      : `${DRAFT_HTML_PREFIX}/${pageKey}/history/${revisionId}/${view}.html`;
    try {
      await putBlob(blobPath, html, {
        access: 'private', allowOverwrite: false, addRandomSuffix: false,
        contentType: 'text/html; charset=utf-8', cacheControlMaxAge: 31536000, ...auth(),
      });
    } catch (error) {
      throw new DraftStoreUnavailableError('working draft HTML write failed', {cause: error});
    }
    return blobPath;
  }

  async function putScreenshot(pageKey, revisionId, image, viewOrOptions = 'desktop', maybeOptions = {}) {
    const view = isPlainObject(viewOrOptions) ? 'desktop' : viewOrOptions;
    const {idFactory = randomUUID} = isPlainObject(viewOrOptions) ? viewOrOptions : maybeOptions;
    if (!validPageKey(pageKey) || !validRevisionId(revisionId) || !Buffer.isBuffer(image)
        || !validView(view)
        || image.length < 8 || image.length > MAX_SCREENSHOT_BYTES
        || !image.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
      throw new InvalidDraftDataError('invalid_draft_screenshot');
    }
    const captureId = idFactory();
    if (typeof captureId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(captureId)) {
      throw new InvalidDraftDataError('invalid_capture_id');
    }
    const current = await getDraft(pageKey);
    if (!current.draft) throw new InvalidDraftDataError('draft_not_initialized');
    assertActiveDraft(current.draft);
    const blobPath = `${DRAFT_HTML_PREFIX}/${pageKey}/screenshots/${revisionId}/${view}/${captureId}.png`;
    try {
      await putBlob(blobPath, image, {
        access: 'private', allowOverwrite: false, addRandomSuffix: false,
        contentType: 'image/png', cacheControlMaxAge: 31536000, ...auth(),
      });
    } catch (error) {
      throw new DraftStoreUnavailableError('working draft screenshot write failed', {cause: error});
    }
    return {blobPath, imageSha256: hash(image)};
  }

  async function updateCapture(pageKey, revisionId, capture, now = new Date(), view = 'desktop') {
    if (!validView(view)) throw new InvalidDraftDataError('invalid_view');
    const updatedAt = now.toISOString();
    const stored = await mutateManifest(manifest => {
      const draft = manifest.drafts.find(item => item.pageKey === pageKey);
      const revision = draft?.revisions.find(item => item.id === revisionId);
      if (!draft || !revision) throw new InvalidDraftDataError('draft_not_initialized');
      assertActiveDraft(draft);
      const record = revisionViewRecord(revision, view);
      if (!record) throw new InvalidDraftDataError('invalid_view');
      if (record.capture.status === 'ready') return manifest;
      if (revision.views) {
        revision.views[view].capture = capture;
        if (view === 'desktop') revision.capture = capture;
      } else {
        revision.capture = capture;
      }
      draft.updatedAt = updatedAt;
      manifest.updatedAt = updatedAt;
      return manifest;
    });
    return stored.data.drafts.find(item => item.pageKey === pageKey);
  }

  async function getScreenshot(pageKey, revisionId, view = 'desktop') {
    if (!validView(view)) throw new InvalidDraftDataError('invalid_view');
    const current = await getDraft(pageKey);
    const revision = current.draft?.revisions.find(item => item.id === revisionId);
    const record = revisionViewRecord(revision, view);
    if (!record || record.capture.status !== 'ready') return null;
    let result;
    try {
      result = await getBlob(record.capture.blobPath, {access: 'private', useCache: false, ...auth()});
    } catch (error) {
      if (isNotFound(error)) return null;
      throw new DraftStoreUnavailableError('working draft screenshot is unavailable', {cause: error});
    }
    if (!result?.stream) return null;
    const image = Buffer.from(await new Response(result.stream).arrayBuffer());
    if (image.length > MAX_SCREENSHOT_BYTES || hash(image) !== record.capture.imageSha256) {
      throw new DraftStoreUnavailableError('working draft screenshot integrity check failed');
    }
    return {image, capture: record.capture};
  }

  async function getHtmlByRevision(draft, revisionId = draft.currentRevisionId, view = 'desktop') {
    if (!validView(view)) throw new InvalidDraftDataError('invalid_view');
    const revision = draft.revisions.find(item => item.id === revisionId);
    const record = revisionViewRecord(revision, view);
    if (!revision || !record) return null;
    let result;
    try {
      result = await getBlob(record.blobPath, {access: 'private', useCache: false, ...auth()});
    } catch (error) {
      if (isNotFound(error)) return null;
      throw new DraftStoreUnavailableError('working draft HTML is unavailable', {cause: error});
    }
    if (!result?.stream) return null;
    const html = await new Response(result.stream).text();
    if (Buffer.byteLength(html, 'utf8') > MAX_SOURCE_BYTES || hash(html) !== record.htmlSha256) {
      throw new DraftStoreUnavailableError('working draft HTML integrity check failed');
    }
    return {html, revision, view, viewRecord: record};
  }

  async function getDraft(pageKey) {
    if (!validPageKey(pageKey)) throw new InvalidDraftDataError('invalid_page_key');
    const current = await readManifest();
    const draft = current.data.drafts.find(item => item.pageKey === pageKey) || null;
    return {draft, revision: current.revision};
  }

  async function startVersioning({expectedPages, editor, now = new Date(), idFactory = randomUUID}) {
    if (!Array.isArray(expectedPages) || expectedPages.length < 1
        || expectedPages.length > MAX_DRAFTS || !validEditor(editor)) {
      throw new InvalidDraftDataError('invalid_versioning_start');
    }
    const normalizedPages = expectedPages.map(item => {
      if (!isPlainObject(item)
          || Object.keys(item).sort().join(',') !== 'expectedRevision,pageKey'
          || !validPageKey(item.pageKey) || !validRevisionId(item.expectedRevision)) {
        throw new InvalidDraftDataError('invalid_versioning_page');
      }
      return {...item};
    });
    if (new Set(normalizedPages.map(item => item.pageKey)).size !== normalizedPages.length) {
      throw new InvalidDraftDataError('duplicate_versioning_page');
    }
    const state = await readManifest();
    const selected = normalizedPages.map(item => {
      const draft = state.data.drafts.find(candidate => candidate.pageKey === item.pageKey);
      if (!draft) throw new InvalidDraftDataError('draft_not_initialized');
      assertActiveDraft(draft);
      if (!draft.release && draft.currentRevisionId !== item.expectedRevision) {
        throw new DraftStoreConflictError('versioning_revision_conflict');
      }
      if (!draft.release && draft.revisions.length >= MAX_REVISIONS) {
        throw new InvalidDraftDataError('draft_revision_limit');
      }
      return {request: item, draft};
    });
    const anchoredPageKeys = selected
      .filter(item => !item.draft.release).map(item => item.request.pageKey);
    if (anchoredPageKeys.length === 0) {
      return {drafts: selected.map(item => item.draft), anchoredPageKeys};
    }
    const anchoredAt = now.toISOString();
    const usedRevisionIds = new Set(state.data.drafts.flatMap(
      draft => draft.revisions.map(revision => revision.id),
    ));
    const prepared = [];
    for (const {draft} of selected.filter(item => !item.draft.release)) {
      const current = draft.revisions.find(item => item.id === draft.currentRevisionId);
      const immutable = await getHtmlByRevision(draft, draft.currentRevisionId);
      if (!current || !immutable) {
        throw new DraftStoreUnavailableError('versioning source HTML is unavailable');
      }
      const revisionId = `draftrev_${idFactory()}`;
      if (!validRevisionId(revisionId) || usedRevisionIds.has(revisionId)) {
        throw new InvalidDraftDataError('invalid_revision_id');
      }
      usedRevisionIds.add(revisionId);
      const revision = {
        id: revisionId, kind: 'initialized', createdAt: anchoredAt, editor: {...editor},
        sectionId: null, editId: null, operationType: 'initialize', before: null, after: null,
        material: null, htmlSha256: current.htmlSha256, blobPath: null,
        capture: pendingCapture(),
        changeSummary: 'Starting Version 1. Earlier work is preserved in setup history.',
      };
      if (current.kind === 'initialized' && current.sourceEvidence) {
        revision.sourceEvidence = {...current.sourceEvidence};
      }
      const confirmed = draft.publications.some(item => (
        item.sectionId === null && item.revisionId === current.id
      ));
      prepared.push({
        pageKey: draft.pageKey,
        revision,
        html: immutable.html,
        initialSync: revision.sourceEvidence || confirmed ? 'synced' : 'unsynced',
      });
    }
    for (const item of prepared) {
      item.revision.blobPath = await putHtml(item.pageKey, item.revision.id, item.html);
    }
    const next = structuredClone(state.data);
    for (const item of prepared) {
      const draft = next.drafts.find(candidate => candidate.pageKey === item.pageKey);
      draft.currentRevisionId = item.revision.id;
      draft.updatedAt = anchoredAt;
      draft.editor = {...editor};
      draft.revisions.push(item.revision);
      draft.release = {
        anchorRevisionId: item.revision.id,
        anchoredAt,
        editor: {...editor},
        initialSync: item.initialSync,
      };
    }
    next.updatedAt = anchoredAt;
    let stored;
    try {
      stored = await writeManifest(next, state.revision);
    } catch (error) {
      if (error instanceof DraftStoreConflictError) {
        throw new DraftStoreConflictError('versioning_manifest_conflict');
      }
      throw error;
    }
    return {
      drafts: normalizedPages.map(item => stored.data.drafts.find(
        draft => draft.pageKey === item.pageKey,
      )),
      anchoredPageKeys,
    };
  }

  async function initialize({pageKey, sourceHtml, sourceSha256, runtimeMap, sectionNames, editor,
    sourceEvidence = null, now = new Date(), idFactory = randomUUID}) {
    if (!validMainPageKey(pageKey) || typeof sourceHtml !== 'string' || hash(sourceHtml) !== sourceSha256
        || !isPlainObject(runtimeMap?.sections) || !isPlainObject(sectionNames) || !validEditor(editor)
        || (sourceEvidence !== null && (!validSourceEvidence(sourceEvidence, pageKey, sourceSha256)
          || !sourceEvidenceMatchesHtml(sourceEvidence, sourceHtml)))) {
      throw new InvalidDraftDataError('invalid_initialization');
    }
    const existing = await getDraft(pageKey);
    if (existing.draft) return {draft: existing.draft, created: false};
    const target = getTarget(pageKey);
    const bindings = Object.entries(runtimeMap.sections)
      .filter(([, item]) => item.previewUrl === target.productionUrl)
      .map(([sectionId, item]) => ({sectionId, ...item}));
    if (bindings.length === 0 || bindings.some(binding => (
      !sectionNames[binding.sectionId] || binding.sourceSha256 !== sourceSha256
    ))) {
      throw new InvalidDraftDataError('draft_bindings_missing');
    }
    const bannerLiveTarget = sourceEvidence === null ? null
      : pairedLiveTargets(pageKey).find(item => item.id === sourceEvidence.targetId);
    const prepared = injectWorkingControls(sourceHtml, {
      target, bindings, sectionNames,
      contentBaseUrl: sourceEvidence?.liveUrl || target.productionUrl,
      liveSynchronized: sourceEvidence !== null,
      bannerLiveTarget,
    });
    const createdAt = now.toISOString();
    const revisionId = `draftrev_${idFactory()}`;
    if (!validRevisionId(revisionId)) throw new InvalidDraftDataError('invalid_revision_id');
    const desktopBlobPath = await putHtml(pageKey, revisionId, prepared.html, 'desktop');
    const mobileBlobPath = await putHtml(pageKey, revisionId, prepared.html, 'mobile');
    const views = dualViewRecords(
      {htmlSha256:hash(prepared.html),blobPath:desktopBlobPath,capture:pendingCapture(),sourceEvidence},
      {htmlSha256:hash(prepared.html),blobPath:mobileBlobPath,capture:pendingCapture(),sourceEvidence},
    );
    const revision = {
      id: revisionId, kind: 'initialized', createdAt, editor: {...editor},
      sectionId: null, editId: null, operationType: 'initialize', before: null, after: null,
      material: null, htmlSha256: views.desktop.htmlSha256,
      blobPath: views.desktop.blobPath, capture: views.desktop.capture,
      views, scope:'shared', view:'desktop',
    };
    if (sourceEvidence) revision.sourceEvidence = {...sourceEvidence};
    const candidate = {
      pageKey, targetId: pageKey, label: target.label, family: target.family,
      variant: target.variant, category: target.category, sourceUrl: target.productionUrl,
      sourceSha256, createdAt, updatedAt: createdAt, editor: {...editor},
      currentRevisionId: revisionId, editableNodes: prepared.editableNodes,
      workingBindings: deriveWorkingBindings(prepared.html, bindings),
      views: {
        desktop: {
          editableNodes:structuredClone(prepared.editableNodes),
          workingBindings:deriveWorkingBindings(prepared.html, bindings),
        },
        mobile: {
          editableNodes:structuredClone(prepared.editableNodes),
          workingBindings:deriveWorkingBindings(prepared.html, bindings),
        },
      },
      revisions: [revision], publications: [],
      release: {
        anchorRevisionId: revisionId, anchoredAt: createdAt,
        editor: {...editor}, initialSync: sourceEvidence ? 'synced' : 'unsynced',
      },
    };
    const stored = await mutateManifest(manifest => {
      if (!manifest.drafts.some(item => item.pageKey === pageKey)) manifest.drafts.push(candidate);
      manifest.updatedAt = createdAt;
      return manifest;
    });
    const draft = stored.data.drafts.find(item => item.pageKey === pageKey);
    return {draft, created: draft.currentRevisionId === revisionId};
  }

  async function initializeViews({pageKey, expectedRevision = null, sources, sectionNames, editor,
    allowLegacyEvidenceUpgrade = false, now = new Date(), idFactory = randomUUID}) {
    if (!validMainPageKey(pageKey) || !isPlainObject(sources)
        || Object.keys(sources).sort().join(',') !== 'desktop,mobile'
        || !isPlainObject(sectionNames) || !validEditor(editor)
        || typeof allowLegacyEvidenceUpgrade !== 'boolean'
        || !(expectedRevision === null || validRevisionId(expectedRevision))) {
      throw new InvalidDraftDataError('invalid_view_initialization');
    }
    const target = getTarget(pageKey);
    const preparedViews = {};
    for (const view of DRAFT_VIEWS) {
      const source = sources[view];
      if (!isPlainObject(source) || typeof source.sourceHtml !== 'string'
          || hash(source.sourceHtml) !== source.sourceSha256
          || !isPlainObject(source.runtimeMap?.sections)
          || (source.sourceEvidence !== null && source.sourceEvidence !== undefined
            && (!validSourceEvidence(source.sourceEvidence, pageKey, source.sourceSha256)
              || !sourceEvidenceMatchesHtml(source.sourceEvidence, source.sourceHtml)))) {
        throw new InvalidDraftDataError('invalid_view_source');
      }
      const evidence = source.sourceEvidence || null;
      const previewUrls = new Set([target.productionUrl, evidence?.liveUrl].filter(Boolean));
      const bindings = Object.entries(source.runtimeMap.sections)
        .filter(([, item]) => previewUrls.has(item.previewUrl))
        .map(([sectionId, item]) => ({sectionId, ...item}));
      if (bindings.length === 0 || bindings.some(binding => (
        !sectionNames[binding.sectionId] || binding.sourceSha256 !== source.sourceSha256
      ))) {
        throw new InvalidDraftDataError('draft_bindings_missing');
      }
      const bannerLiveTarget = evidence === null ? null
        : pairedLiveTargets(pageKey).find(item => item.id === evidence.targetId);
      const prepared = injectWorkingControls(source.sourceHtml, {
        target, bindings, sectionNames,
        contentBaseUrl:evidence?.liveUrl || target.productionUrl,
        liveSynchronized:evidence !== null,
        bannerLiveTarget,
      });
      preparedViews[view] = {
        ...prepared,
        sourceSha256:source.sourceSha256,
        sourceEvidence:evidence,
        workingBindings:deriveWorkingBindings(prepared.html, bindings),
      };
    }
    const state = await readManifest();
    const existing = state.data.drafts.find(item => item.pageKey === pageKey) || null;
    if ((existing && existing.currentRevisionId !== expectedRevision)
        || (!existing && expectedRevision !== null)) {
      throw new DraftStoreConflictError('draft revision conflict');
    }
    let legacyEvidenceUpgrade = false;
    if (existing?.views) {
      const current = existing.revisions.at(-1);
      const currentViewEvidence = DRAFT_VIEWS.map(view => (
        revisionViewRecord(current, view)?.sourceEvidence || null
      ));
      const alreadyCompared = current?.kind === 'initialized'
        && currentViewEvidence.every(evidence => (
          evidence?.comparisonVersion === (existing.family === 'join'
            ? JOIN_COMPARISON_VERSION : BC_COMPARISON_VERSION)
          && (existing.family !== 'bc' || evidence?.captureVersion === BC_CAPTURE_VERSION)
          && /^[a-f0-9]{64}$/.test(evidence.comparisonSha256 || '')
        ));
      if (alreadyCompared) return {draft:existing, created:false};
      const currentPublished = existing.publications.some(item => item.revisionId === current?.id);
      const untouchedVersionOne = ['bc','join'].includes(existing.family)
        && existing.currentRevisionId === current?.id
        && existing.release?.anchorRevisionId === current?.id
        && revisionReleaseState(existing, current.id).version === '1'
        && current?.kind === 'initialized'
        && current?.operationType === 'initialize'
        && current?.views
        && !currentPublished
        && currentViewEvidence.every((evidence, index) => (
          evidence?.kind === (existing.family === 'bc'
            ? 'verified-live-render' : 'verified-live-snapshot')
          && (existing.family !== 'bc' || evidence.view === DRAFT_VIEWS[index])
          && (existing.family === 'join'
            ? evidence.comparisonVersion === undefined
              && evidence.comparisonSha256 === undefined
            : (evidence.comparisonVersion === undefined
                ? evidence.captureVersion === undefined
                : evidence.comparisonVersion === BC_LEGACY_COMPARISON_VERSION
                  && evidence.captureVersion === BC_CAPTURE_VERSION
                  && /^[a-f0-9]{64}$/.test(evidence.comparisonSha256 || '')))
        ));
      if (!allowLegacyEvidenceUpgrade || !untouchedVersionOne) {
        throw new DraftStoreConflictError('draft_has_unmerged_edits');
      }
      legacyEvidenceUpgrade = true;
    }
    if (existing?.release && existing.release.anchorRevisionId !== existing.currentRevisionId) {
      throw new DraftStoreConflictError('draft_has_unmerged_edits');
    }
    if (existing && existing.revisions.length >= MAX_REVISIONS) {
      throw new InvalidDraftDataError('draft_revision_limit');
    }
    const createdAt = now.toISOString();
    const revisionId = `draftrev_${idFactory()}`;
    if (!validRevisionId(revisionId)
        || state.data.drafts.some(draft => draft.revisions.some(item => item.id === revisionId))) {
      throw new InvalidDraftDataError('invalid_revision_id');
    }
    const records = {};
    for (const view of DRAFT_VIEWS) {
      const prepared = preparedViews[view];
      records[view] = {
        htmlSha256:hash(prepared.html),
        blobPath:await putHtml(pageKey, revisionId, prepared.html, view),
        capture:pendingCapture(),
        ...(prepared.sourceEvidence ? {sourceEvidence:{...prepared.sourceEvidence}} : {}),
      };
    }
    const revision = {
      id:revisionId,kind:'initialized',createdAt,editor:{...editor},
      sectionId:null,editId:null,operationType:'initialize',before:null,after:null,
      material:null,htmlSha256:records.desktop.htmlSha256,
      blobPath:records.desktop.blobPath,capture:records.desktop.capture,
      views:records,scope:'shared',view:'desktop',
      changeSummary:legacyEvidenceUpgrade
        ? 'Refreshed the verified Desktop web and Mobile web source comparison. Earlier work is preserved in history.'
        : 'Starting Desktop web and Mobile web Version 1. Earlier work is preserved in setup history.',
      ...(preparedViews.desktop.sourceEvidence
        ? {sourceEvidence:{...preparedViews.desktop.sourceEvidence}} : {}),
    };
    const viewMetadata = Object.fromEntries(DRAFT_VIEWS.map(view => [view, {
      editableNodes:preparedViews[view].editableNodes,
      workingBindings:preparedViews[view].workingBindings,
    }]));
    const next = structuredClone(state.data);
    let draft = next.drafts.find(item => item.pageKey === pageKey);
    if (!draft) {
      draft = {
        pageKey,targetId:pageKey,label:target.label,family:target.family,
        variant:target.variant,category:target.category,sourceUrl:target.productionUrl,
        sourceSha256:preparedViews.desktop.sourceSha256,createdAt,updatedAt:createdAt,
        editor:{...editor},currentRevisionId:revisionId,
        editableNodes:viewMetadata.desktop.editableNodes,
        workingBindings:viewMetadata.desktop.workingBindings,
        views:viewMetadata,revisions:[revision],publications:[],
        release:{anchorRevisionId:revisionId,anchoredAt:createdAt,editor:{...editor},
          initialSync:DRAFT_VIEWS.every(view => preparedViews[view].sourceEvidence) ? 'synced' : 'unsynced'},
      };
      next.drafts.push(draft);
    } else {
      draft.label = target.label;
      draft.sourceUrl = target.productionUrl;
      draft.sourceSha256 = preparedViews.desktop.sourceSha256;
      draft.updatedAt = createdAt;
      draft.editor = {...editor};
      draft.currentRevisionId = revisionId;
      draft.editableNodes = viewMetadata.desktop.editableNodes;
      draft.workingBindings = viewMetadata.desktop.workingBindings;
      draft.views = viewMetadata;
      draft.revisions.push(revision);
      draft.release = {
        anchorRevisionId:revisionId,
        anchoredAt:draft.release?.anchoredAt || createdAt,
        editor:{...editor},
        initialSync:DRAFT_VIEWS.every(view => preparedViews[view].sourceEvidence)
          ? 'synced' : 'unsynced',
      };
    }
    next.updatedAt = createdAt;
    const stored = await writeManifest(next, state.revision);
    return {
      draft:stored.data.drafts.find(item => item.pageKey === pageKey),
      revision,
      created:true,
    };
  }

  async function rebase({pageKey, sourceHtml, sourceSha256, runtimeMap, sectionNames, editor,
    expectedRevision, sourceEvidence = null, releaseType = 'minor', changeSummary = null,
    now = new Date(), idFactory = randomUUID}) {
    const releaseInput = normalizedReleaseInput(releaseType, changeSummary);
    if (!validMainPageKey(pageKey) || typeof sourceHtml !== 'string' || hash(sourceHtml) !== sourceSha256
        || !isPlainObject(runtimeMap?.sections) || !isPlainObject(sectionNames) || !validEditor(editor)
        || !validRevisionId(expectedRevision)
        || (sourceEvidence !== null && (!validSourceEvidence(sourceEvidence, pageKey, sourceSha256)
          || !sourceEvidenceMatchesHtml(sourceEvidence, sourceHtml)))) {
      throw new InvalidDraftDataError('invalid_source_rebase');
    }
    const beforeState = await getDraft(pageKey);
    if (!beforeState.draft) throw new InvalidDraftDataError('draft_not_initialized');
    assertActiveDraft(beforeState.draft);
    if (!beforeState.draft.release) throw new InvalidDraftDataError('versioning_not_started');
    if (beforeState.draft.currentRevisionId !== expectedRevision) {
      throw new DraftStoreConflictError('draft revision conflict');
    }
    const latestInitializationIndex = beforeState.draft.revisions
      .findLastIndex(revision => revision.kind === 'initialized');
    if (beforeState.draft.revisions.slice(latestInitializationIndex + 1)
      .some(revision => revision.kind !== 'initialized')) {
      throw new DraftStoreConflictError('draft_has_unmerged_edits');
    }
    const target = getTarget(pageKey);
    const bindings = Object.entries(runtimeMap.sections)
      .filter(([, item]) => item.previewUrl === target.productionUrl)
      .map(([sectionId, item]) => ({sectionId, ...item}));
    if (bindings.length === 0 || bindings.some(binding => (
      !sectionNames[binding.sectionId] || binding.sourceSha256 !== sourceSha256
    ))) {
      throw new InvalidDraftDataError('draft_bindings_missing');
    }
    const bannerLiveTarget = sourceEvidence === null ? null
      : pairedLiveTargets(pageKey).find(item => item.id === sourceEvidence.targetId);
    const prepared = injectWorkingControls(sourceHtml, {
      target, bindings, sectionNames,
      contentBaseUrl: sourceEvidence?.liveUrl || target.productionUrl,
      liveSynchronized: sourceEvidence !== null,
      bannerLiveTarget,
    });
    const createdAt = now.toISOString();
    const revisionId = `draftrev_${idFactory()}`;
    if (!validRevisionId(revisionId)) throw new InvalidDraftDataError('invalid_revision_id');
    const dual = Boolean(beforeState.draft.views);
    let revision;
    if (dual) {
      const records = {};
      for (const view of DRAFT_VIEWS) {
        records[view] = {
          htmlSha256:hash(prepared.html),
          blobPath:await putHtml(pageKey, revisionId, prepared.html, view),
          capture:pendingCapture(),
          ...(sourceEvidence ? {sourceEvidence:{...sourceEvidence,view}} : {}),
        };
      }
      revision = {
        id:revisionId,kind:'initialized',createdAt,editor:{...editor},
        sectionId:null,editId:null,operationType:'initialize',before:null,after:null,
        material:null,htmlSha256:records.desktop.htmlSha256,
        blobPath:records.desktop.blobPath,capture:records.desktop.capture,
        views:records,scope:'shared',view:'desktop',...releaseInput,
      };
    } else {
      const blobPath = await putHtml(pageKey, revisionId, prepared.html);
      revision = {
        id: revisionId, kind: 'initialized', createdAt, editor: {...editor},
        sectionId: null, editId: null, operationType: 'initialize', before: null, after: null,
        material: null, htmlSha256: hash(prepared.html), blobPath, capture: pendingCapture(),
        ...releaseInput,
      };
    }
    if (sourceEvidence) revision.sourceEvidence = {...sourceEvidence};
    const editableNodes = prepared.editableNodes;
    const workingBindings = deriveWorkingBindings(prepared.html, bindings);
    const stored = await mutateManifest(manifest => {
      const draft = manifest.drafts.find(item => item.pageKey === pageKey);
      if (!draft) throw new InvalidDraftDataError('draft_not_initialized');
      assertActiveDraft(draft);
      if (draft.currentRevisionId !== expectedRevision) {
        throw new DraftStoreConflictError('draft revision conflict');
      }
      const latestIndex = draft.revisions.findLastIndex(item => item.kind === 'initialized');
      if (draft.revisions.slice(latestIndex + 1).some(item => item.kind !== 'initialized')) {
        throw new DraftStoreConflictError('draft_has_unmerged_edits');
      }
      if (draft.revisions.length >= MAX_REVISIONS) throw new InvalidDraftDataError('draft_revision_limit');
      draft.label = target.label;
      draft.sourceUrl = target.productionUrl;
      draft.sourceSha256 = sourceSha256;
      draft.updatedAt = createdAt;
      draft.editor = {...editor};
      draft.currentRevisionId = revisionId;
      draft.editableNodes = editableNodes;
      draft.workingBindings = workingBindings;
      if (dual) {
        draft.views = Object.fromEntries(DRAFT_VIEWS.map(view => [view, {
          editableNodes:structuredClone(editableNodes),
          workingBindings:structuredClone(workingBindings),
        }]));
      }
      draft.revisions.push(revision);
      manifest.updatedAt = createdAt;
      return manifest;
    });
    return {draft: stored.data.drafts.find(item => item.pageKey === pageKey), revision};
  }

  async function edit({pageKey, sectionId, editId, expectedRevision, operation, material, editor,
    view = 'desktop', scope = 'shared', releaseType = 'minor', changeSummary = null,
    now = new Date(), idFactory = randomUUID}) {
    const releaseInput = normalizedReleaseInput(releaseType, changeSummary);
    const activeView = normalizedView(view);
    const editScope = activeView ? normalizedEditScope(scope, activeView) : null;
    if (!validPageKey(pageKey) || !validSectionId(sectionId) || !validEditId(editId)
        || !validRevisionId(expectedRevision) || !isPlainObject(operation) || !validEditor(editor)
        || !activeView || !editScope) {
      throw new InvalidDraftDataError('invalid_draft_edit');
    }
    const beforeState = await getDraft(pageKey);
    if (!beforeState.draft) throw new InvalidDraftDataError('draft_not_initialized');
    assertActiveDraft(beforeState.draft);
    if (!beforeState.draft.release) throw new InvalidDraftDataError('versioning_not_started');
    if (beforeState.draft.currentRevisionId !== expectedRevision) throw new DraftStoreConflictError('draft revision conflict');
    const dual = Boolean(beforeState.draft.views);
    const affectedViews = dual
      ? (editScope === 'shared' ? DRAFT_VIEWS : [editScope]) : ['desktop'];
    const htmlByView = {};
    const changes = {};
    const activeDescriptor = currentViewMetadata(beforeState.draft, activeView)
      .editableNodes.find(node => node.editId === editId && node.sectionId === sectionId);
    if (!activeDescriptor || activeDescriptor.type !== operation.type) {
      throw new InvalidDraftDataError('editable_node_missing');
    }
    for (const currentView of (dual ? DRAFT_VIEWS : ['desktop'])) {
      const currentHtml = await getHtmlByRevision(beforeState.draft, expectedRevision, currentView);
      if (!currentHtml) throw new DraftStoreUnavailableError('working draft HTML is unavailable');
      htmlByView[currentView] = currentHtml.html;
      if (!affectedViews.includes(currentView)) {
        changes[currentView] = null;
        continue;
      }
      const descriptor = currentViewMetadata(beforeState.draft, currentView)
        .editableNodes.find(node => node.editId === editId && node.sectionId === sectionId);
      if (!descriptor || descriptor.type !== operation.type
          || (editScope === 'shared' && operation.type === 'text'
            && descriptor.value !== activeDescriptor.value)) {
        throw new InvalidDraftDataError('shared_edit_not_aligned');
      }
      changes[currentView] = mutateWorkingHtml(currentHtml.html, {sectionId, editId, operation});
    }
    const changed = changes[activeView] || changes[affectedViews[0]];
    let recordedMaterial = material === undefined ? {} : material;
    if (!isPlainObject(recordedMaterial)) throw new InvalidDraftDataError('invalid_change_material');
    recordedMaterial = {...recordedMaterial};
    if (changed.type === 'text') {
      if (recordedMaterial.replacementCopy !== undefined && recordedMaterial.replacementCopy.trim() !== changed.after) {
        throw new InvalidDraftDataError('invalid_change_material');
      }
      recordedMaterial.replacementCopy = changed.after;
    } else {
      if (recordedMaterial.attachmentId !== undefined && recordedMaterial.attachmentId !== operation.attachmentId) {
        throw new InvalidDraftDataError('invalid_change_material');
      }
      recordedMaterial.attachmentId = operation.attachmentId;
    }
    recordedMaterial = normalizedChangeMaterial(recordedMaterial);
    if (!recordedMaterial) throw new InvalidDraftDataError('invalid_change_material');
    const createdAt = now.toISOString();
    const revisionId = `draftrev_${idFactory()}`;
    if (!validRevisionId(revisionId)) throw new InvalidDraftDataError('invalid_revision_id');
    let revision;
    let nextViewMetadata = null;
    if (dual) {
      const records = {};
      nextViewMetadata = {};
      for (const currentView of DRAFT_VIEWS) {
        const html = changes[currentView]?.html || htmlByView[currentView];
        records[currentView] = {
          htmlSha256:hash(html),
          blobPath:await putHtml(pageKey, revisionId, html, currentView),
          capture:pendingCapture(),
        };
        const priorMetadata = currentViewMetadata(beforeState.draft, currentView);
        nextViewMetadata[currentView] = {
          editableNodes:refreshDescriptors(html, priorMetadata.editableNodes),
          workingBindings:deriveWorkingBindings(html, priorMetadata.workingBindings),
        };
      }
      revision = {
        id:revisionId,kind:'edit',createdAt,editor:{...editor},sectionId,editId,
        operationType:changed.type,before:changed.before,after:changed.after,
        material:recordedMaterial,htmlSha256:records.desktop.htmlSha256,
        blobPath:records.desktop.blobPath,capture:records.desktop.capture,
        views:records,view:activeView,scope:editScope,
        viewChanges:Object.fromEntries(DRAFT_VIEWS.map(currentView => [
          currentView,
          changes[currentView] ? {
            operationType:changes[currentView].type,
            before:changes[currentView].before,
            after:changes[currentView].after,
          } : null,
        ])),
        ...releaseInput,
      };
    } else {
      const blobPath = await putHtml(pageKey, revisionId, changed.html);
      revision = {
        id: revisionId, kind: 'edit', createdAt, editor: {...editor}, sectionId, editId,
        operationType: changed.type, before: changed.before, after: changed.after,
        material: recordedMaterial, htmlSha256: hash(changed.html), blobPath, capture: pendingCapture(),
        ...releaseInput,
      };
    }
    const editableNodes = dual ? nextViewMetadata.desktop.editableNodes
      : refreshDescriptors(changed.html, beforeState.draft.editableNodes);
    const workingBindings = dual ? nextViewMetadata.desktop.workingBindings
      : deriveWorkingBindings(changed.html, beforeState.draft.workingBindings);
    const stored = await mutateManifest(manifest => {
      const draft = manifest.drafts.find(item => item.pageKey === pageKey);
      if (!draft) throw new InvalidDraftDataError('draft_not_initialized');
      assertActiveDraft(draft);
      if (draft.currentRevisionId !== expectedRevision) throw new DraftStoreConflictError('draft revision conflict');
      if (draft.revisions.length >= MAX_REVISIONS) throw new InvalidDraftDataError('draft_revision_limit');
      draft.currentRevisionId = revisionId;
      draft.updatedAt = createdAt;
      draft.editor = {...editor};
      draft.editableNodes = editableNodes;
      draft.workingBindings = workingBindings;
      if (dual) draft.views = nextViewMetadata;
      draft.revisions.push(revision);
      manifest.updatedAt = createdAt;
      return manifest;
    });
    return {draft: stored.data.drafts.find(item => item.pageKey === pageKey), revision};
  }

  async function copySection({sourcePageKey, sourceSectionId, sourceRevision, targets, editor,
    releaseType = 'minor', changeSummary = null, now = new Date(), idFactory = randomUUID}) {
    const releaseInput = normalizedReleaseInput(releaseType, changeSummary);
    if (!validPageKey(sourcePageKey) || !validSectionId(sourceSectionId)
        || !validRevisionId(sourceRevision) || !Array.isArray(targets)
        || targets.length < 1 || targets.length > 20 || !validEditor(editor)) {
      throw new InvalidDraftDataError('invalid_section_copy');
    }
    const normalizedTargets = targets.map(item => {
      if (!isPlainObject(item) || Object.keys(item).sort().join(',') !== 'expectedRevision,pageKey,sectionId'
          || !validPageKey(item.pageKey) || !validSectionId(item.sectionId)
          || !validRevisionId(item.expectedRevision)) {
        throw new InvalidDraftDataError('invalid_section_copy_target');
      }
      return {...item};
    });
    const targetPageKeys = new Set(normalizedTargets.map(item => item.pageKey));
    if (targetPageKeys.size !== normalizedTargets.length || targetPageKeys.has(sourcePageKey)) {
      throw new InvalidDraftDataError('duplicate_section_copy_target');
    }
    const state = await readManifest();
    const sourceDraft = state.data.drafts.find(item => item.pageKey === sourcePageKey);
    const sourceStoredRevision = sourceDraft?.revisions.find(item => item.id === sourceRevision);
    if (!sourceDraft || !sourceStoredRevision) {
      throw new InvalidDraftDataError('section_copy_source_missing');
    }
    assertActiveDraft(sourceDraft);
    const sourceTarget = getTarget(sourcePageKey);
    const targetDrafts = normalizedTargets.map(item => {
      const draft = state.data.drafts.find(candidate => candidate.pageKey === item.pageKey);
      if (!draft) throw new InvalidDraftDataError('section_copy_target_missing');
      assertActiveDraft(draft);
      if (!draft.release) throw new InvalidDraftDataError('versioning_not_started');
      if (draft.currentRevisionId !== item.expectedRevision) {
        throw new DraftStoreConflictError('section_copy_revision_conflict');
      }
      if (getTarget(item.pageKey)?.family !== sourceTarget.family) {
        throw new InvalidDraftDataError('section_copy_family_mismatch');
      }
      if (draft.revisions.length >= MAX_REVISIONS) {
        throw new InvalidDraftDataError('draft_revision_limit');
      }
      return {request: item, draft};
    });
    const sourceResult = await getHtmlByRevision(sourceDraft, sourceRevision, 'desktop');
    if (!sourceResult) throw new DraftStoreUnavailableError('section copy source HTML is unavailable');
    const createdAt = now.toISOString();
    const prepared = [];
    const revisionIds = new Set(state.data.drafts.flatMap(draft => draft.revisions.map(item => item.id)));
    for (const {request, draft} of targetDrafts) {
      const targetResult = await getHtmlByRevision(draft, request.expectedRevision, 'desktop');
      if (!targetResult) throw new DraftStoreUnavailableError('section copy target HTML is unavailable');
      const changed = copySectionHtml(targetResult.html, sourceResult.html, {
        target: getTarget(request.pageKey), sourceSectionId, targetSectionId: request.sectionId,
        targetBindings: draft.workingBindings, targetDescriptors: draft.editableNodes,
      });
      const revisionId = `draftrev_${idFactory()}`;
      if (!validRevisionId(revisionId) || revisionIds.has(revisionId)) {
        throw new InvalidDraftDataError('invalid_revision_id');
      }
      revisionIds.add(revisionId);
      let revision = {
        id: revisionId, kind: 'section-copy', createdAt, editor: {...editor},
        sectionId: request.sectionId, editId: null, operationType: 'section-copy',
        before: {sectionSha256: changed.before},
        after: {
          sourcePageKey, sourceSectionId, sourceRevision, sectionSha256: changed.after,
        },
        material: null, htmlSha256: hash(changed.html),
        blobPath: null, capture: pendingCapture(),
        ...releaseInput,
      };
      let changesByView = null;
      if (draft.views) {
        changesByView = {desktop:changed};
        const [mobileTarget, mobileSource] = await Promise.all([
          getHtmlByRevision(draft, request.expectedRevision, 'mobile'),
          getHtmlByRevision(sourceDraft, sourceRevision, 'mobile'),
        ]);
        if (!mobileTarget || !mobileSource) {
          throw new DraftStoreUnavailableError('section copy view HTML is unavailable');
        }
        const mobileMetadata = currentViewMetadata(draft, 'mobile');
        changesByView.mobile = copySectionHtml(mobileTarget.html, mobileSource.html, {
          target:getTarget(request.pageKey),sourceSectionId,targetSectionId:request.sectionId,
          targetBindings:mobileMetadata.workingBindings,
          targetDescriptors:mobileMetadata.editableNodes,
        });
        revision = {
          ...revision,views:null,scope:'shared',view:'desktop',
        };
      }
      prepared.push({request, changed, changesByView, revision});
    }
    for (const item of prepared) {
      if (item.changesByView) {
        const records = {};
        for (const view of DRAFT_VIEWS) {
          const html = item.changesByView[view].html;
          records[view] = {
            htmlSha256:hash(html),
            blobPath:await putHtml(item.request.pageKey, item.revision.id, html, view),
            capture:pendingCapture(),
          };
        }
        item.revision.views = records;
        item.revision.htmlSha256 = records.desktop.htmlSha256;
        item.revision.blobPath = records.desktop.blobPath;
        item.revision.capture = records.desktop.capture;
      } else {
        item.revision.blobPath = await putHtml(
          item.request.pageKey, item.revision.id, item.changed.html,
        );
      }
    }
    const next = structuredClone(state.data);
    for (const item of prepared) {
      const draft = next.drafts.find(candidate => candidate.pageKey === item.request.pageKey);
      if (!draft || draft.currentRevisionId !== item.request.expectedRevision) {
        throw new DraftStoreConflictError('section_copy_revision_conflict');
      }
      draft.currentRevisionId = item.revision.id;
      draft.updatedAt = createdAt;
      draft.editor = {...editor};
      draft.editableNodes = item.changed.editableNodes;
      draft.workingBindings = item.changed.workingBindings;
      if (item.changesByView) {
        draft.views = Object.fromEntries(DRAFT_VIEWS.map(view => [view, {
          editableNodes:item.changesByView[view].editableNodes,
          workingBindings:item.changesByView[view].workingBindings,
        }]));
      }
      draft.revisions.push(item.revision);
    }
    next.updatedAt = createdAt;
    const stored = await writeManifest(next, state.revision);
    return {
      drafts: prepared.map(item => stored.data.drafts.find(
        draft => draft.pageKey === item.request.pageKey,
      )),
      revisions: prepared.map(item => ({...item.revision})),
    };
  }

  async function applyPreparedLayout({pageKey, expectedRevision, expectedUpdatedAt,
    layoutId, changeSummary, editor, now = new Date(), idFactory = randomUUID}) {
    const releaseInput = normalizedReleaseInput('minor', changeSummary);
    if (!validPageKey(pageKey) || !validRevisionId(expectedRevision)
        || !validIso(expectedUpdatedAt) || !validEditor(editor)
        || !releaseInput.changeSummary || typeof layoutId !== 'string') {
      throw new InvalidDraftDataError('invalid_prepared_layout');
    }
    const layout = preparedLayouts.getPreparedLayout(layoutId);
    if (!layout) throw new InvalidDraftDataError('invalid_prepared_layout');
    const state = await readManifest();
    const draft = state.data.drafts.find(item => item.pageKey === pageKey);
    if (!draft) throw new InvalidDraftDataError('draft_not_initialized');
    assertActiveDraft(draft);
    if (!draft.branch) throw new InvalidDraftDataError('prepared_layout_requires_variation');
    if (!draft.views || !draft.release) {
      throw new InvalidDraftDataError('prepared_layout_views_required');
    }
    if (!preparedLayoutMatchesTarget(draft, layout)) {
      throw new InvalidDraftDataError('prepared_layout_target_mismatch');
    }
    if (draft.currentRevisionId !== expectedRevision || draft.updatedAt !== expectedUpdatedAt) {
      throw new DraftStoreConflictError('prepared_layout_conflict');
    }
    if (draft.revisions.length >= MAX_REVISIONS) {
      throw new InvalidDraftDataError('draft_revision_limit');
    }
    const [desktopResult, mobileResult] = await Promise.all([
      getHtmlByRevision(draft, expectedRevision, 'desktop'),
      getHtmlByRevision(draft, expectedRevision, 'mobile'),
    ]);
    if (!desktopResult || !mobileResult) {
      throw new DraftStoreUnavailableError('prepared layout source HTML is unavailable');
    }
    const transformed = layout.transform(desktopResult.html);
    assertPreparedLayoutIsolation(desktopResult.html, transformed, layout.sectionId);
    const desktopMetadata = currentViewMetadata(draft, 'desktop');
    const changed = copySectionHtml(desktopResult.html, transformed, {
      target:getTarget(pageKey),sourceSectionId:layout.sectionId,targetSectionId:layout.sectionId,
      targetBindings:desktopMetadata.workingBindings,
      targetDescriptors:desktopMetadata.editableNodes,
      preservePreparedEditIds:true,
    });
    assertPreparedLayoutIsolation(desktopResult.html, changed.html, layout.sectionId);
    const revisionId = `draftrev_${idFactory()}`;
    if (!validRevisionId(revisionId)
        || state.data.drafts.some(item => item.revisions.some(revision => revision.id === revisionId))) {
      throw new InvalidDraftDataError('invalid_revision_id');
    }
    const createdAt = new Date(Math.max(
      now.getTime(), Date.parse(draft.updatedAt) + 1,
    )).toISOString();
    const htmlByView = {desktop:changed.html,mobile:mobileResult.html};
    const records = {};
    for (const view of DRAFT_VIEWS) {
      records[view] = {
        htmlSha256:hash(htmlByView[view]),
        blobPath:await putHtml(pageKey, revisionId, htmlByView[view], view),
        capture:pendingCapture(),
      };
    }
    const revision = {
      id:revisionId,kind:'section-layout',createdAt,editor:{...editor},
      sectionId:layout.sectionId,editId:null,operationType:'section-layout',
      before:{sectionSha256:changed.before},
      after:{layoutId:layout.id,sectionSha256:changed.after},
      layoutId:layout.id,material:null,
      htmlSha256:records.desktop.htmlSha256,
      blobPath:records.desktop.blobPath,capture:records.desktop.capture,
      views:records,scope:'desktop',view:'desktop',
      ...releaseInput,
    };
    const next = structuredClone(state.data);
    const nextDraft = next.drafts.find(item => item.pageKey === pageKey);
    if (!nextDraft || lifecycleStatus(nextDraft) !== 'active'
        || nextDraft.currentRevisionId !== expectedRevision
        || nextDraft.updatedAt !== expectedUpdatedAt) {
      throw new DraftStoreConflictError('prepared_layout_conflict');
    }
    nextDraft.currentRevisionId = revisionId;
    nextDraft.updatedAt = createdAt;
    nextDraft.editor = {...editor};
    nextDraft.editableNodes = structuredClone(changed.editableNodes);
    nextDraft.workingBindings = structuredClone(changed.workingBindings);
    nextDraft.views = {
      desktop:{
        editableNodes:structuredClone(changed.editableNodes),
        workingBindings:structuredClone(changed.workingBindings),
      },
      mobile:structuredClone(currentViewMetadata(draft, 'mobile')),
    };
    nextDraft.revisions.push(revision);
    next.updatedAt = createdAt;
    let stored;
    try {
      stored = await writeManifest(next, state.revision);
    } catch (error) {
      if (error instanceof DraftStoreConflictError) {
        throw new DraftStoreConflictError('prepared_layout_conflict');
      }
      throw error;
    }
    return {
      draft:stored.data.drafts.find(item => item.pageKey === pageKey),
      revision,
    };
  }

  async function amendMainPreparedLayout({pageKey, expectedRevision, expectedUpdatedAt,
    layoutId, changeSummary, editor, now = new Date(), idFactory = randomUUID}) {
    const summary=normalizedText(changeSummary,1,MAX_CHANGE_SUMMARY_LENGTH);
    if(!validMainPageKey(pageKey)||!validRevisionId(expectedRevision)
        ||!validIso(expectedUpdatedAt)||!validEditor(editor)
        ||!summary||typeof layoutId!=='string') {
      throw new InvalidDraftDataError('invalid_main_layout_amendment');
    }
    const layout=preparedLayouts.getPreparedLayout(layoutId);
    if(!layout)throw new InvalidDraftDataError('invalid_main_layout_amendment');
    const state=await readManifest();
    const draft=state.data.drafts.find(item=>item.pageKey===pageKey);
    if(!draft)throw new InvalidDraftDataError('draft_not_initialized');
    assertActiveDraft(draft);
    if(draft.currentRevisionId!==expectedRevision||draft.updatedAt!==expectedUpdatedAt) {
      throw new DraftStoreConflictError('main_layout_amendment_conflict');
    }
    const amendment=availableMainLayoutAmendment(draft);
    if(!amendment)throw new InvalidDraftDataError('main_layout_amendment_not_allowed');
    if(layout.id!==amendment.layoutId||layout.sectionId!==amendment.sectionId
        ||!preparedLayoutMatchesTarget(draft,layout)) {
      throw new InvalidDraftDataError('main_layout_amendment_target_mismatch');
    }
    if(draft.revisions.length>=MAX_REVISIONS) {
      throw new InvalidDraftDataError('draft_revision_limit');
    }
    const [desktopResult,mobileResult]=await Promise.all([
      getHtmlByRevision(draft,expectedRevision,'desktop'),
      getHtmlByRevision(draft,expectedRevision,'mobile'),
    ]);
    if(!desktopResult||!mobileResult) {
      throw new DraftStoreUnavailableError('main layout amendment source HTML is unavailable');
    }
    const transformed=layout.transform(desktopResult.html);
    assertPreparedLayoutIsolation(desktopResult.html,transformed,layout.sectionId);
    const desktopMetadata=currentViewMetadata(draft,'desktop');
    const changed=describeTransformedPreparedLayout(desktopResult.html,transformed,{
      sectionId:layout.sectionId,targetBindings:desktopMetadata.workingBindings,
      targetDescriptors:desktopMetadata.editableNodes,
    });
    assertPreparedLayoutIsolation(desktopResult.html,changed.html,layout.sectionId);
    const revisionId=`draftrev_${idFactory()}`;
    if(!validRevisionId(revisionId)
        ||state.data.drafts.some(item=>item.revisions.some(revision=>revision.id===revisionId))) {
      throw new InvalidDraftDataError('invalid_revision_id');
    }
    const createdAt=new Date(Math.max(now.getTime(),Date.parse(draft.updatedAt)+1)).toISOString();
    const htmlByView={desktop:changed.html,mobile:mobileResult.html};
    const records={};
    for(const view of DRAFT_VIEWS) {
      records[view]={
        htmlSha256:hash(htmlByView[view]),
        blobPath:await putHtml(pageKey,revisionId,htmlByView[view],view),
        capture:pendingCapture(),
      };
    }
    const revision={
      id:revisionId,kind:'section-layout',createdAt,editor:{...editor},
      sectionId:layout.sectionId,editId:null,operationType:'section-layout',
      before:{sectionSha256:changed.before},
      after:{layoutId:layout.id,sectionSha256:changed.after},
      layoutId:layout.id,amendsRevisionId:expectedRevision,material:null,
      htmlSha256:records.desktop.htmlSha256,
      blobPath:records.desktop.blobPath,capture:records.desktop.capture,
      views:records,scope:'desktop',view:'desktop',
      releaseType:'amendment',changeSummary:summary,
    };
    const next=structuredClone(state.data);
    const nextDraft=next.drafts.find(item=>item.pageKey===pageKey);
    if(!nextDraft||nextDraft.branch||lifecycleStatus(nextDraft)!=='active'
        ||nextDraft.currentRevisionId!==expectedRevision
        ||nextDraft.updatedAt!==expectedUpdatedAt) {
      throw new DraftStoreConflictError('main_layout_amendment_conflict');
    }
    nextDraft.currentRevisionId=revisionId;
    nextDraft.updatedAt=createdAt;
    nextDraft.editor={...editor};
    nextDraft.editableNodes=structuredClone(changed.editableNodes);
    nextDraft.workingBindings=structuredClone(changed.workingBindings);
    nextDraft.views={
      desktop:{
        editableNodes:structuredClone(changed.editableNodes),
        workingBindings:structuredClone(changed.workingBindings),
      },
      mobile:structuredClone(currentViewMetadata(draft,'mobile')),
    };
    nextDraft.revisions.push(revision);
    next.updatedAt=createdAt;
    let stored;
    try {
      stored=await writeManifest(next,state.revision);
    } catch(error) {
      if(error instanceof DraftStoreConflictError) {
        throw new DraftStoreConflictError('main_layout_amendment_conflict');
      }
      throw error;
    }
    return {draft:stored.data.drafts.find(item=>item.pageKey===pageKey),revision};
  }

  async function createVariation({pageKey, expectedRevision, name, editor,
    now = new Date(), idFactory = randomUUID}) {
    const normalizedName = normalizedText(name, 1, 80);
    if (!validMainPageKey(pageKey) || !validRevisionId(expectedRevision)
        || !normalizedName || normalizedName !== name || !validEditor(editor)) {
      throw new InvalidDraftDataError('invalid_variation');
    }
    const state = await readManifest();
    if (state.data.drafts.length >= MAX_DRAFTS) throw new InvalidDraftDataError('draft_limit');
    const parent = state.data.drafts.find(item => item.pageKey === pageKey);
    if (!parent) throw new InvalidDraftDataError('draft_not_initialized');
    assertActiveDraft(parent);
    if (parent.branch || parent.currentRevisionId !== expectedRevision) {
      throw new DraftStoreConflictError('variation_revision_conflict');
    }
    if (state.data.drafts.some(item => item.branch?.parentPageKey === pageKey
        && item.branch.name.toLowerCase() === normalizedName.toLowerCase())) {
      throw new InvalidDraftDataError('variation_name_conflict');
    }
    const parentHtml = await getHtmlByRevision(parent, expectedRevision, 'desktop');
    if (!parentHtml) throw new DraftStoreUnavailableError('variation source HTML is unavailable');
    const variationId = idFactory();
    const variationKey = variationPageKey(pageKey, variationId);
    if (!variationKey || state.data.drafts.some(item => item.pageKey === variationKey)) {
      throw new InvalidDraftDataError('invalid_variation_id');
    }
    const revisionId = `draftrev_${idFactory()}`;
    if (!validRevisionId(revisionId)
        || state.data.drafts.some(draft => draft.revisions.some(item => item.id === revisionId))) {
      throw new InvalidDraftDataError('invalid_revision_id');
    }
    const createdAt = now.toISOString();
    let revision;
    if (parent.views) {
      const records = {};
      for (const view of DRAFT_VIEWS) {
        const immutable = view === 'desktop'
          ? parentHtml : await getHtmlByRevision(parent, expectedRevision, view);
        if (!immutable) throw new DraftStoreUnavailableError('variation source HTML is unavailable');
        records[view] = {
          htmlSha256:hash(immutable.html),
          blobPath:await putHtml(variationKey, revisionId, immutable.html, view),
          capture:pendingCapture(),
        };
      }
      revision = {
        id:revisionId,kind:'initialized',createdAt,editor:{...editor},
        sectionId:null,editId:null,operationType:'initialize',before:null,after:null,
        material:null,htmlSha256:records.desktop.htmlSha256,
        blobPath:records.desktop.blobPath,capture:records.desktop.capture,
        views:records,scope:'shared',view:'desktop',
      };
    } else {
      const blobPath = await putHtml(variationKey, revisionId, parentHtml.html);
      revision = {
        id: revisionId, kind: 'initialized', createdAt, editor: {...editor},
        sectionId: null, editId: null, operationType: 'initialize', before: null, after: null,
        material: null, htmlSha256: hash(parentHtml.html), blobPath, capture: pendingCapture(),
      };
    }
    const target = getTarget(pageKey);
    const parentInitialization = currentInitialization(parent);
    const contentBaseUrl = parentInitialization?.revision.sourceEvidence?.liveUrl
      || target.productionUrl;
    const candidate = {
      pageKey: variationKey, targetId: variationKey,
      label: `${target.label} · ${normalizedName}`,
      family: parent.family, variant: parent.variant, category: parent.category,
      sourceUrl: parent.sourceUrl, sourceSha256: parent.sourceSha256,
      createdAt, updatedAt: createdAt, editor: {...editor}, currentRevisionId: revisionId,
      editableNodes: structuredClone(parent.editableNodes),
      workingBindings: structuredClone(parent.workingBindings), revisions: [revision], publications: [],
      ...(parent.views ? {views:structuredClone(parent.views)} : {}),
      release: {
        anchorRevisionId: revisionId, anchoredAt: createdAt,
        editor: {...editor}, initialSync: 'unsynced',
      },
      branch: {
        kind: 'variation', name: normalizedName, parentPageKey: pageKey,
        parentRevisionId: expectedRevision, contentBaseUrl, createdAt, editor: {...editor},
      },
    };
    const next = structuredClone(state.data);
    if (next.drafts.some(item => item.pageKey === variationKey)) {
      throw new DraftStoreConflictError('variation_key_conflict');
    }
    next.drafts.push(candidate);
    next.updatedAt = createdAt;
    const stored = await writeManifest(next, state.revision);
    return {
      draft: stored.data.drafts.find(item => item.pageKey === variationKey),
      revision,
    };
  }

  async function promoteVariation({pageKey, expectedRevision, expectedUpdatedAt,
    expectedMainRevision, releaseType = 'minor', changeSummary = null, editor,
    now = new Date(), idFactory = randomUUID}) {
    const releaseInput = normalizedReleaseInput(releaseType, changeSummary);
    if (!validPageKey(pageKey) || variationBaseId(pageKey) === null
        || !validRevisionId(expectedRevision) || !validIso(expectedUpdatedAt)
        || !validRevisionId(expectedMainRevision) || !validEditor(editor)
        || !releaseInput.changeSummary) {
      throw new InvalidDraftDataError('invalid_variation_promotion');
    }
    const state = await readManifest();
    const source = state.data.drafts.find(item => item.pageKey === pageKey);
    const mainPageKey = variationBaseId(pageKey);
    const main = state.data.drafts.find(item => item.pageKey === mainPageKey);
    if (!source || !source.branch || !main) {
      throw new InvalidDraftDataError('variation_promotion_missing');
    }
    assertActiveDraft(source);
    assertActiveDraft(main);
    if (!source.views || !main.views || !source.release || !main.release) {
      throw new InvalidDraftDataError('variation_promotion_views_required');
    }
    if (source.currentRevisionId !== expectedRevision
        || source.updatedAt !== expectedUpdatedAt
        || main.currentRevisionId !== expectedMainRevision) {
      throw new DraftStoreConflictError('variation_promotion_conflict');
    }
    if (main.revisions.length >= MAX_REVISIONS) {
      throw new InvalidDraftDataError('draft_revision_limit');
    }
    const revisionId = `draftrev_${idFactory()}`;
    if (!validRevisionId(revisionId)
        || main.revisions.some(item => item.id === revisionId)) {
      throw new InvalidDraftDataError('invalid_revision_id');
    }
    const createdAt = now.toISOString();
    const records = {};
    const sourceHtmlByView = {};
    const mainHtmlByView = {};
    for (const view of DRAFT_VIEWS) {
      const [immutable, mainImmutable] = await Promise.all([
        getHtmlByRevision(source, expectedRevision, view),
        getHtmlByRevision(main, expectedMainRevision, view),
      ]);
      if (!immutable || !mainImmutable) {
        throw new DraftStoreUnavailableError('variation promotion HTML is unavailable');
      }
      sourceHtmlByView[view] = immutable.html;
      mainHtmlByView[view] = mainImmutable.html;
      records[view] = {
        htmlSha256:hash(immutable.html),
        blobPath:await putHtml(mainPageKey, revisionId, immutable.html, view),
        capture:pendingCapture(),
      };
    }
    const changedViewsBySection = new Map();
    for (const view of DRAFT_VIEWS) {
      const sourceDocument = parse5.parse(sourceHtmlByView[view]);
      const mainDocument = parse5.parse(mainHtmlByView[view]);
      const sourceMetadata = currentViewMetadata(source, view);
      const mainMetadata = currentViewMetadata(main, view);
      const sectionIds = [...new Set([
        ...sourceMetadata.workingBindings.map(item => item.sectionId),
        ...mainMetadata.workingBindings.map(item => item.sectionId),
      ])];
      for (const sectionId of sectionIds) {
        let changed = false;
        try {
          changed = parse5.serializeOuter(exactSection(sourceDocument, sectionId))
            !== parse5.serializeOuter(exactSection(mainDocument, sectionId));
        } catch {
          changed = true;
        }
        if (changed) {
          const views = changedViewsBySection.get(sectionId) || [];
          views.push(view);
          changedViewsBySection.set(sectionId, views);
        }
      }
    }
    const sectionChanges = [...changedViewsBySection].map(([sectionId, views]) => ({
      sectionId, views,
    }));
    const revision = {
      id:revisionId,kind:'variation-promotion',createdAt,editor:{...editor},
      sectionId:null,editId:null,operationType:'variation-promotion',
      before:null,after:null,material:null,
      htmlSha256:records.desktop.htmlSha256,
      blobPath:records.desktop.blobPath,capture:records.desktop.capture,
      views:records,scope:'shared',view:'desktop',
      promotion:{
        sourcePageKey:pageKey,sourceRevision:expectedRevision,
        sourceVariationName:source.branch.name,
      },
      sectionChanges,
      ...releaseInput,
    };
    const next = structuredClone(state.data);
    const nextSource = next.drafts.find(item => item.pageKey === pageKey);
    const nextMain = next.drafts.find(item => item.pageKey === mainPageKey);
    if (!nextSource || !nextMain
        || lifecycleStatus(nextSource) !== 'active'
        || nextSource.currentRevisionId !== expectedRevision
        || nextSource.updatedAt !== expectedUpdatedAt
        || nextMain.currentRevisionId !== expectedMainRevision) {
      throw new DraftStoreConflictError('variation_promotion_conflict');
    }
    nextMain.currentRevisionId = revisionId;
    nextMain.updatedAt = createdAt;
    nextMain.editor = {...editor};
    nextMain.editableNodes = structuredClone(nextSource.editableNodes);
    nextMain.workingBindings = structuredClone(nextSource.workingBindings);
    nextMain.views = structuredClone(nextSource.views);
    nextMain.revisions.push(revision);
    next.updatedAt = createdAt;
    let stored;
    try {
      stored = await writeManifest(next, state.revision);
    } catch (error) {
      if (error instanceof DraftStoreConflictError) {
        throw new DraftStoreConflictError('variation_promotion_conflict');
      }
      throw error;
    }
    return {
      draft:stored.data.drafts.find(item => item.pageKey === mainPageKey),
      variation:stored.data.drafts.find(item => item.pageKey === pageKey),
      revision,
    };
  }

  async function changeVariationLifecycle({action, pageKey, expectedRevision,
    expectedUpdatedAt, confirmationName = null, editor, now = new Date()}) {
    if (!['archive', 'restore', 'delete'].includes(action)
        || !validPageKey(pageKey) || variationBaseId(pageKey) === null
        || !validRevisionId(expectedRevision) || !validIso(expectedUpdatedAt)
        || !validEditor(editor)) {
      throw new InvalidDraftDataError('invalid_variation_lifecycle');
    }
    const stored = await mutateManifest(manifest => {
      const draft = manifest.drafts.find(item => item.pageKey === pageKey);
      if (!draft || !draft.branch) {
        throw new InvalidDraftDataError('variation_not_found');
      }
      if (draft.currentRevisionId !== expectedRevision
          || draft.updatedAt !== expectedUpdatedAt) {
        throw new DraftStoreConflictError('variation_lifecycle_conflict');
      }
      const currentStatus = lifecycleStatus(draft);
      if ((action === 'archive' && currentStatus !== 'active')
          || (action === 'restore' && currentStatus !== 'archived')
          || (action === 'delete' && !['active', 'archived'].includes(currentStatus))) {
        throw new InvalidDraftDataError(currentStatus === 'deleted'
          ? 'deleted_variation'
          : currentStatus === 'archived' ? 'archived_variation'
            : 'invalid_variation_lifecycle');
      }
      if (action === 'delete' && confirmationName !== draft.branch.name) {
        throw new InvalidDraftDataError('variation_delete_confirmation_mismatch');
      }
      const changedAt = new Date(Math.max(
        now.getTime(), Date.parse(draft.updatedAt) + 1,
      )).toISOString();
      const status = action === 'archive' ? 'archived'
        : action === 'restore' ? 'active' : 'deleted';
      const events = draft.lifecycle?.events || [];
      draft.lifecycle = {
        status,
        events:[...events, {action, at:changedAt, editor:{...editor}}],
      };
      draft.updatedAt = changedAt;
      draft.editor = {...editor};
      manifest.updatedAt = new Date(Math.max(
        Date.parse(manifest.updatedAt) + 1, Date.parse(changedAt),
      )).toISOString();
      return manifest;
    });
    return {draft:stored.data.drafts.find(item => item.pageKey === pageKey)};
  }

  async function confirmPublished({pageKey, sectionId, revisionId, view = 'desktop', liveUrl, confirmed, note,
    liveContentSha256, liveSourceCommit, liveComparisonVersion, liveComparisonSha256,
    editor, now = new Date(), idFactory = randomUUID}) {
    const normalizedNote = note === undefined || note === null || note === ''
      ? null : normalizedText(note, 1, 4000, true);
    const hasLiveEvidence = liveContentSha256 !== undefined || liveSourceCommit !== undefined
      || liveComparisonVersion !== undefined || liveComparisonSha256 !== undefined;
    const hasComparisonEvidence = liveComparisonVersion !== undefined
      || liveComparisonSha256 !== undefined;
    if (!validPageKey(pageKey) || !(sectionId === null || validSectionId(sectionId))
        || !validRevisionId(revisionId)
        || !validLiveUrl(liveUrl) || confirmed !== true || !validEditor(editor)
        || !(view === null || validView(view))
        || (note !== undefined && note !== null && note !== '' && !normalizedNote)
        || (hasLiveEvidence && (sectionId !== null
          || typeof liveContentSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(liveContentSha256)
          || typeof liveSourceCommit !== 'string' || !/^[a-f0-9]{40}$/.test(liveSourceCommit)))
        || (hasComparisonEvidence && (![BC_LEGACY_COMPARISON_VERSION,
          BC_COMPARISON_VERSION,JOIN_COMPARISON_VERSION]
          .includes(liveComparisonVersion)
          || typeof liveComparisonSha256 !== 'string'
          || !/^[a-f0-9]{64}$/.test(liveComparisonSha256)))) {
      throw new InvalidDraftDataError('invalid_publication_confirmation');
    }
    const confirmedAt = now.toISOString();
    const publication = {
      id: `publication_${idFactory()}`, revisionId, sectionId, liveUrl,
      note: normalizedNote, confirmedAt, editor: {...editor},
    };
    if (view !== null) publication.view = view;
    if (hasLiveEvidence) {
      publication.liveContentSha256 = liveContentSha256;
      publication.liveSourceCommit = liveSourceCommit;
      if (hasComparisonEvidence) {
        publication.liveComparisonVersion = liveComparisonVersion;
        publication.liveComparisonSha256 = liveComparisonSha256;
      }
    }
    if (!validPublicationId(publication.id)) throw new InvalidDraftDataError('invalid_publication_id');
    const stored = await mutateManifest(manifest => {
      const draft = manifest.drafts.find(item => item.pageKey === pageKey);
      const revision = draft?.revisions.find(item => item.id === revisionId);
      if (!draft) throw new InvalidDraftDataError('draft_not_initialized');
      assertActiveDraft(draft);
      if (hasComparisonEvidence && !(draft.family === 'bc'
        ? [BC_LEGACY_COMPARISON_VERSION,BC_COMPARISON_VERSION]
        : draft.family === 'join' ? [JOIN_COMPARISON_VERSION] : [])
        .includes(liveComparisonVersion)) {
        throw new InvalidDraftDataError('invalid_publication_confirmation');
      }
      if (draft.views && !validView(view)) {
        throw new InvalidDraftDataError('invalid_publication_view');
      }
      if (!revision || (sectionId === null
        ? draft.currentRevisionId !== revisionId
        : (revision.kind !== 'edit' || revision.sectionId !== sectionId
          || (draft.views && !revisionAffectsView(revision, view))))) {
        throw new InvalidDraftDataError('invalid_publication_revision');
      }
      if (sectionId === null) {
        const allowedLiveUrls = new Set(pairedLiveTargets(pageKey).map(item => item.productionUrl));
        if (allowedLiveUrls.size > 0 && !allowedLiveUrls.has(liveUrl)) {
          throw new InvalidDraftDataError('invalid_publication_live_url');
        }
      }
      if (draft.publications.length >= MAX_PUBLICATIONS) throw new InvalidDraftDataError('publication_limit');
      draft.publications.push(publication);
      draft.updatedAt = confirmedAt;
      manifest.updatedAt = confirmedAt;
      return manifest;
    });
    return {draft: stored.data.drafts.find(item => item.pageKey === pageKey), publication};
  }

  return {
    readManifest,
    getDraft,
    getHtmlByRevision,
    startVersioning,
    initialize,
    initializeViews,
    rebase,
    edit,
    copySection,
    applyPreparedLayout,
    amendMainPreparedLayout,
    createVariation,
    promoteVariation,
    changeVariationLifecycle,
    confirmPublished,
    putScreenshot,
    updateCapture,
    getScreenshot,
  };
}

async function fetchCanonicalDraft(pageKey, {fetcher = fetch, timeoutMs = SOURCE_FETCH_TIMEOUT_MS} = {}) {
  if (!validMainPageKey(pageKey)) throw new InvalidDraftDataError('invalid_page_key');
  const target = getTarget(pageKey);
  let response;
  try {
    response = await fetcher(target.productionUrl, {
      method: 'GET', redirect: 'manual', credentials: 'omit',
      headers: {Accept: 'text/html'}, signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new DraftStoreUnavailableError('canonical draft source is unavailable', {cause: error});
  }
  const contentType = response.headers?.get?.('content-type') || '';
  if (response.status !== 200 || response.url !== target.productionUrl
      || !/^text\/html(?:;|$)/i.test(contentType)) {
    throw new DraftStoreUnavailableError('canonical draft source returned an invalid response');
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length < 64 || buffer.length > MAX_SOURCE_BYTES) {
    throw new DraftStoreUnavailableError('canonical draft source returned an invalid document size');
  }
  return {html: buffer.toString('utf8'), sha256: hash(buffer)};
}

module.exports = {
  DRAFT_VIEWS,
  DRAFT_HTML_PREFIX,
  DRAFT_MANIFEST_PATH,
  DraftStoreConflictError,
  DraftStoreUnavailableError,
  InvalidDraftDataError,
  MAX_SOURCE_BYTES,
  MAX_DRAFTS,
  SOURCE_FETCH_TIMEOUT_MS,
  compareLiveSourceEvidence,
  createDraftStore,
  deriveWorkingBindings,
  draftStore: createDraftStore(),
  fetchCanonicalDraft,
  injectWorkingControls,
  mutateWorkingHtml,
  normalizedView,
  publicDraft,
  renderWorkingPage,
  revisionReleaseState,
  revisionSyncState,
  revisionViewSyncState,
  revisionVersion,
  sourceMatchStatus,
  validateManifest,
  validSourceEvidence,
  validLiveUrl,
  validPageKey,
  workingRevisionUrl,
};
