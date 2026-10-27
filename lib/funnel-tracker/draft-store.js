'use strict';

const {createHash, randomUUID} = require('node:crypto');
const {BlobNotFoundError, BlobPreconditionFailedError, get, head, put} = require('@vercel/blob');
const parse5 = require('parse5');
const {
  getTarget, pairedLiveTargets, variationBaseId, variationPageKey,
} = require('./production-catalog');
const {normalizedContentSha256} = require('./live-source');
const {normalizedChangeMaterial} = require('./state');

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
  if (!isPlainObject(value)
      || Object.keys(value).sort().join(',') !== 'category,channel,contentSha256,family,kind,liveUrl,snapshotUrl,sourceCommit,sourceFingerprint,synthetic,targetId'
      || value.kind !== 'verified-live-snapshot'
      || typeof value.targetId !== 'string'
      || !validLiveUrl(value.liveUrl)
      || !validLiveUrl(value.snapshotUrl)
      || typeof value.sourceCommit !== 'string' || !/^[a-f0-9]{40}$/.test(value.sourceCommit)
      || typeof value.sourceFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.sourceFingerprint)
      || typeof value.contentSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.contentSha256)
      || typeof value.synthetic !== 'boolean') return false;
  if (sourceSha256 !== null && value.sourceFingerprint !== sourceSha256) return false;
  const liveTarget = pairedLiveTargets(pageKey).find(item => item.id === value.targetId);
  return Boolean(liveTarget
    && liveTarget.productionUrl === value.liveUrl
    && liveTarget.snapshotPath === value.snapshotUrl
    && liveTarget.family === value.family
    && liveTarget.category === value.category
    && liveTarget.channel === value.channel
    && value.synthetic === (liveTarget.family === 'results'));
}

function sourceEvidenceMatchesHtml(value, html) {
  if (value === null) return true;
  try {
    return value.contentSha256 === normalizedContentSha256(html);
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

function workingRevisionUrl(pageKey, sourceUrl, revisionId = null, sectionId = null) {
  const params = new URL(sourceUrl).searchParams;
  if (revisionId) params.set('revision', revisionId);
  const query = params.toString();
  const fragment = sectionId ? `#funnel-section-${encodeURIComponent(sectionId)}` : '';
  return `/funnel/working/${encodeURIComponent(pageKey)}${query ? `?${query}` : ''}${fragment}`;
}

function absoluteWorkingUrl(pageKey, sourceUrl, revisionId = null, sectionId = null) {
  return `https://zodiac-pages.vercel.app${workingRevisionUrl(pageKey, sourceUrl, revisionId, sectionId)}`;
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

function publicCapture(value, pageKey, revisionId) {
  return {
    status: value.status,
    lastAttemptAt: value.lastAttemptAt,
    error: value.error ? {...value.error} : null,
    imageSha256: value.imageSha256,
    width: value.width,
    height: value.height,
    imageUrl: value.status === 'ready'
      ? `/api/funnel-review?action=draft-screenshot&pageKey=${encodeURIComponent(pageKey)}&revision=${encodeURIComponent(revisionId)}`
      : null,
  };
}

function revisionReleaseState(draft, revisionId, {syncStatus = null} = {}) {
  const index = draft?.revisions?.findIndex(item => item.id === revisionId) ?? -1;
  if (index < 0) throw new InvalidDraftDataError('invalid_revision');
  const anchorIndex = draft.release
    ? draft.revisions.findIndex(item => item.id === draft.release.anchorRevisionId) : -1;
  if (anchorIndex < 0 || index < anchorIndex) {
    return {
      version: null, setup: true, archiveNumber: index + 1,
      sync: revisionSyncState(draft, revisionId, {syncStatus}),
    };
  }
  let major = 1;
  let minor = 0;
  for (const revision of draft.revisions.slice(anchorIndex + 1, index + 1)) {
    if (revision.releaseType === 'major') {
      major += 1;
      minor = 0;
    } else {
      minor += 1;
    }
  }
  const sync = revisionSyncState(draft, revisionId, {syncStatus});
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

function revisionSyncState(draft, revisionId, {syncStatus = null} = {}) {
  if (![null, 'current', 'changed', 'unavailable'].includes(syncStatus)) {
    throw new InvalidDraftDataError('invalid_sync_status');
  }
  const revision = draft?.revisions?.find(item => item.id === revisionId);
  if (!revision) throw new InvalidDraftDataError('invalid_revision');
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
  if (revision.kind === 'initialized' && revision.sourceEvidence) {
    return 'Synced working page from live';
  }
  if (revision.kind === 'initialized') return 'Updated working-page source';
  return 'Updated working page';
}

function syncBaselineIndex(draft, revisionIndex) {
  let baselineIndex = draft.release
    ? draft.revisions.findIndex(item => item.id === draft.release.anchorRevisionId) : -1;
  for (let index = 0; index <= revisionIndex; index += 1) {
    const revision = draft.revisions[index];
    if ((revision.kind === 'initialized' && revision.sourceEvidence)
        || draft.publications.some(item => item.sectionId === null && item.revisionId === revision.id)) {
      baselineIndex = Math.max(baselineIndex, index);
    }
  }
  return baselineIndex;
}

function changedSectionsForRevision(draft, revisionId) {
  const revisionIndex = draft.revisions.findIndex(item => item.id === revisionId);
  if (revisionIndex < 0) throw new InvalidDraftDataError('invalid_revision');
  const baselineIndex = syncBaselineIndex(draft, revisionIndex);
  const changed = new Map();
  for (const revision of draft.revisions.slice(baselineIndex + 1, revisionIndex + 1)) {
    if (!revision.sectionId && revision.releaseType === undefined) continue;
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

function renderWorkingPage(draft, immutableHtml, revisionId, {syncStatus = null} = {}) {
  if (!draft || !validPageKey(draft.pageKey) || typeof immutableHtml !== 'string'
      || Buffer.byteLength(immutableHtml, 'utf8') > MAX_SOURCE_BYTES) {
    throw new InvalidDraftDataError('invalid_working_page');
  }
  const revision = draft.revisions.find(item => item.id === revisionId);
  if (!revision || hash(immutableHtml) !== revision.htmlSha256) {
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
  const workingUrl = absoluteWorkingUrl(draft.pageKey, draft.sourceUrl, revisionId);
  for (const label of elements(document).filter(node => hasAttr(node, 'data-funnel-working-label'))) {
    let section = label.parentNode;
    while (section && getAttr(section, 'data-funnel-section-id') === null) section = section.parentNode;
    const sectionId = section ? getAttr(section, 'data-funnel-section-id') : null;
    if (sectionId) {
      const anchorId = `funnel-section-${sectionId}`;
      if (!elements(document).some(node => node !== label && getAttr(node, 'id') === anchorId)) {
        setAttr(label, 'id', anchorId);
      }
      setAttr(label, 'href', absoluteWorkingUrl(draft.pageKey, draft.sourceUrl, revisionId, sectionId));
      setAttr(label, 'data-funnel-working-link', '');
    }
  }
  const sync = revisionSyncState(draft, revisionId, {syncStatus});
  const release = revisionReleaseState(draft, revisionId, {syncStatus});
  const publication = [...draft.publications].reverse().find(item => item.sectionId === null && item.revisionId === revisionId);
  const liveTarget = pairedLiveTargets(target.id).find(item => item.productionUrl === (publication?.liveUrl || revision.sourceEvidence?.liveUrl)) || preferredLiveTarget(target);
  for (const title of [...(head.childNodes || [])].filter(node => node.tagName === 'title')) removeElement(title);
  appendParsedFragment(head, `<title>${escapeText(workingIdentity(draft, revisionId, {syncStatus}))} · ${sync.status === 'synced' ? 'Synced' : 'Unsynced'}</title>`);
  const checkText = sync.checkStatus === 'unavailable' ? ' · Check unavailable'
    : sync.checkStatus === 'changed' ? ' · Live changed' : '';
  const changedSections = revisionId === draft.currentRevisionId && sync.status === 'unsynced'
    ? changedSectionsForRevision(draft, revisionId) : [];
  const changedText = changedSections.length > 0
    ? `<details class="funnel-working-changes"${changedSections.length <= 3 ? ' open' : ''}><summary>Draft changes: ${changedSections.length} ${changedSections.length === 1 ? 'section' : 'sections'}</summary><ul>${changedSections.map(item => {
      const label = item.sectionId || 'Page structure';
      const href = absoluteWorkingUrl(draft.pageKey, draft.sourceUrl, revisionId, item.sectionId);
      return `<li><a data-funnel-working-link href="${escapeAttribute(href)}">${escapeText(label)}</a>: ${escapeText(item.summary)}</li>`;
    }).join('')}</ul></details>`
    : sync.status === 'unsynced'
      ? `<span class="funnel-working-changes-empty">${draft.branch ? 'No section changes saved in this variation yet.' : 'No section changes saved yet.'}</span>`
      : '';
  appendParsedFragment(head, `<style data-funnel-working-presentation>
    .funnel-working-status{border-radius:999px;padding:4px 9px;background:#ece8f0;color:#3b3343;letter-spacing:.04em}
    .funnel-working-status[data-status="synced"]{background:#e2f2e8;color:#21623d}
    .funnel-working-status[data-status="unsynced"]{background:#fff0d9;color:#7a4910}
    .funnel-working-changes,.funnel-working-changes-empty{flex-basis:100%;font-weight:500;color:#62596a}
    .funnel-working-changes{max-height:140px;overflow:auto}.funnel-working-changes summary{cursor:pointer;font-weight:700}.funnel-working-changes ul{margin:6px 0 0;padding-left:22px}.funnel-working-changes li{margin:3px 0}
  </style>`);
  prependParsedFragment(body, `<div class="funnel-working-banner" data-funnel-working-banner data-funnel-working-page="${escapeAttribute(draft.pageKey)}" data-funnel-working-revision="${escapeAttribute(revisionId)}" data-funnel-working-version="${escapeAttribute(release.version || `setup-${release.archiveNumber}`)}" data-funnel-sync-status="${sync.status}"><strong class="funnel-working-badge">DRAFT</strong><span class="funnel-working-identity">${escapeText(workingIdentity(draft, revisionId, {syncStatus}))}</span><span class="funnel-working-status" data-status="${sync.status}">${sync.status === 'synced' ? 'Synced' : 'Unsynced'}${escapeText(checkText)}</span>${liveTarget ? `<a href="${escapeAttribute(liveTarget.productionUrl)}" target="_blank" rel="noopener">Live page</a>` : ''}<a data-funnel-working-link href="${escapeAttribute(workingUrl)}">Working page</a>${changedText}</div>`);
  return parse5.serialize(document);
}

function publicRevision(value, pageKey, draft, options = {}) {
  const normalizedOptions = isPlainObject(options) ? options : {};
  const release = revisionReleaseState(draft, value.id, normalizedOptions);
  const changedSections = changedSectionsForRevision(draft, value.id).map(item => ({
    ...item,
    workingUrl: workingRevisionUrl(pageKey, draft.sourceUrl, value.id, item.sectionId),
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
    version: release.version,
    setup: release.setup,
    archiveNumber: release.archiveNumber,
    releaseType: value.releaseType || null,
    changeSummary: concreteChangeSummary(value),
    changedSections,
    htmlSha256: value.htmlSha256,
    workingUrl: workingRevisionUrl(pageKey, draft.sourceUrl, value.id),
    screenshot: publicCapture(value.capture, pageKey, value.id),
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

function compareLiveSourceEvidence(value, observedEvidence) {
  if (!value || !validPageKey(value.pageKey)
      || !validSourceEvidence(observedEvidence, value.pageKey)) {
    throw new InvalidDraftDataError('invalid_source_evidence');
  }
  const currentPublication = [...value.publications].reverse().find(item => (
    item.sectionId === null && item.revisionId === value.currentRevisionId
  ));
  if (currentPublication) {
    if (!currentPublication.liveContentSha256) return 'unavailable';
    if (currentPublication.liveUrl !== observedEvidence.liveUrl) return 'unavailable';
    return currentPublication.liveContentSha256 === observedEvidence.contentSha256
      ? 'confirmed-live' : 'check-needed';
  }
  const liveSource = latestLiveSource(value);
  if (!liveSource) return 'not-synced';
  if (liveSource.revision.sourceEvidence.contentSha256
      !== observedEvidence.contentSha256) return 'check-needed';
  return sourceMatchStatus(value);
}

function publicDraft(value, options = {}) {
  const normalizedOptions = isPlainObject(options) ? options : {};
  const syncStatus = normalizedOptions.syncStatus ?? null;
  const target = getTarget(value.pageKey);
  const livePages = pairedLiveTargets(value.pageKey).map(item => ({
    id: item.id, label: item.label, channel: item.channel, url: item.productionUrl,
  }));
  const latestPagePublication = [...value.publications].reverse()
    .find(item => item.sectionId === null) || null;
  const confirmedRevisionIndex = syncBaselineIndex(value, value.revisions.length - 1);
  const pendingEditCount = value.revisions
    .slice(confirmedRevisionIndex + 1)
    .filter(item => item.kind !== 'initialized').length;
  const pageStatus = latestPagePublication
    ? (latestPagePublication.revisionId === value.currentRevisionId
      ? 'confirmed-live' : 'changes-not-live')
    : 'unconfirmed';
  const liveSource = latestLiveSource(value);
  const initialized = currentInitialization(value);
  const contentBaseUrl = value.branch?.contentBaseUrl
    || initialized?.revision.sourceEvidence?.liveUrl || target.productionUrl;
  const releaseState = revisionReleaseState(value, value.currentRevisionId, {syncStatus});
  const version = releaseState.version;
  const changedSections = changedSectionsForRevision(value, value.currentRevisionId).map(item => ({
    ...item,
    workingUrl: workingRevisionUrl(
      value.pageKey, value.sourceUrl, value.currentRevisionId, item.sectionId,
    ),
  }));
  const mainPageKey = value.branch?.parentPageKey || variationBaseId(value.pageKey) || value.pageKey;
  const branch = value.branch ? {...value.branch, editor: {...value.branch.editor}} : null;
  return {
    pageKey: value.pageKey,
    targetId: value.targetId,
    label: workingIdentity(value, value.currentRevisionId, {syncStatus}),
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
    version,
    setup: releaseState.setup,
    archiveNumber: releaseState.archiveNumber,
    releaseStarted: Boolean(value.release),
    changedSections,
    mainPageKey,
    variation: branch ? {name: branch.name, pageKey: value.pageKey} : null,
    branch,
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
    workingUrl: workingRevisionUrl(value.pageKey, value.sourceUrl, value.currentRevisionId),
    stableWorkingUrl: workingRevisionUrl(value.pageKey, value.sourceUrl),
    revision: value.currentRevisionId,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    editor: {...value.editor},
    editableNodes: value.editableNodes.map(item => ({
      ...item,
      workingUrl: workingRevisionUrl(
        value.pageKey, value.sourceUrl, value.currentRevisionId, item.sectionId,
      ),
    })),
    workingBindings: value.workingBindings.map(item => ({
      ...item,
      element: {...item.element, classes: [...item.element.classes]},
      firstHeading: item.firstHeading ? {...item.firstHeading} : null,
      workingUrl: workingRevisionUrl(
        value.pageKey, value.sourceUrl, value.currentRevisionId, item.sectionId,
      ),
    })),
    history: value.revisions.map(item => publicRevision(
      item, value.pageKey, value,
      item.id === value.currentRevisionId ? {syncStatus} : {},
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
    && value.element.classes.every(item => typeof item === 'string' && /^[A-Za-z_-][A-Za-z0-9_-]{0,159}$/.test(item))
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

function validCapture(value, pageKey, revisionId) {
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
    && value.width === 1280 && Number.isSafeInteger(value.height) && value.height >= 1 && value.height <= 50000
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

function validateManifest(value) {
  if (!isPlainObject(value) || Object.keys(value).sort().join(',') !== 'drafts,schema,updatedAt'
      || value.schema !== 1 || !validIso(value.updatedAt) || !Array.isArray(value.drafts)
      || value.drafts.length > MAX_DRAFTS) throw new InvalidDraftDataError('invalid_draft_manifest');
  const keys = new Set();
  for (const draft of value.drafts) {
    const draftKeys = Object.keys(draft).sort().join(',');
    const mainDraftKeys = 'category,createdAt,currentRevisionId,editableNodes,editor,family,label,pageKey,publications,revisions,sourceSha256,sourceUrl,targetId,updatedAt,variant,workingBindings';
    const branchDraftKeys = `${mainDraftKeys},branch`.split(',').sort().join(',');
    const releasedDraftKeys = `${mainDraftKeys},release`.split(',').sort().join(',');
    const releasedBranchDraftKeys = `${mainDraftKeys},branch,release`.split(',').sort().join(',');
    if (!isPlainObject(draft)
        || ![mainDraftKeys, branchDraftKeys, releasedDraftKeys, releasedBranchDraftKeys].includes(draftKeys)
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
    if ((variationBaseId(draft.pageKey) === null) !== (draft.branch === undefined)
        || (draft.branch !== undefined && !validBranch(draft.branch, draft.pageKey))) {
      throw new InvalidDraftDataError('invalid_draft_branch');
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
    const revisionIds = new Set();
    const latestInitializationIndex = draft.revisions.findLastIndex(revision => revision.kind === 'initialized');
    if (latestInitializationIndex < 0) throw new InvalidDraftDataError('invalid_initial_revision');
    const latestStructureIndex = draft.revisions.findLastIndex(revision => (
      revision.kind === 'initialized' || revision.kind === 'section-copy'
    ));
    for (const [revisionIndex, revision] of draft.revisions.entries()) {
      const expectedRevisionKeys = 'after,before,blobPath,capture,createdAt,editId,editor,htmlSha256,id,kind,material,operationType,sectionId';
      const revisionKeys = Object.keys(revision);
      const allowedRevisionKeys = new Set([
        ...expectedRevisionKeys.split(','), 'sourceEvidence', 'releaseType', 'changeSummary',
      ]);
      const hasReleaseType = revision.releaseType !== undefined;
      const hasChangeSummary = revision.changeSummary !== undefined;
      if (!isPlainObject(revision)
          || revisionKeys.some(key => !allowedRevisionKeys.has(key))
          || expectedRevisionKeys.split(',').some(key => !(key in revision))
          || (hasReleaseType && !['minor', 'major'].includes(revision.releaseType))
          || (hasReleaseType && !hasChangeSummary)
          || (hasChangeSummary && !(revision.changeSummary === null
            || normalizedText(revision.changeSummary, 1, MAX_CHANGE_SUMMARY_LENGTH) === revision.changeSummary))
          || !validRevisionId(revision.id) || revisionIds.has(revision.id)
          || !['initialized', 'edit', 'section-copy'].includes(revision.kind) || !validIso(revision.createdAt)
          || !validEditor(revision.editor) || !/^[a-f0-9]{64}$/.test(revision.htmlSha256)
          || !validCapture(revision.capture, draft.pageKey, revision.id)
          || revision.blobPath !== `${DRAFT_HTML_PREFIX}/${draft.pageKey}/history/${revision.id}.html`
          || !(revision.material === null || exactMaterial(revision.material))) {
        throw new InvalidDraftDataError('invalid_draft_revision');
      }
      if (revision.kind === 'initialized') {
        if (revision.sectionId !== null || revision.editId !== null || revision.operationType !== 'initialize'
            || revision.before !== null || revision.after !== null || revision.material !== null
            || (revision.sourceEvidence !== undefined
              && !validSourceEvidence(revision.sourceEvidence, draft.pageKey))) {
          throw new InvalidDraftDataError('invalid_initial_revision');
        }
      } else if (revision.kind === 'section-copy') {
        if (revision.sourceEvidence !== undefined || !validSectionId(revision.sectionId)
            || revision.editId !== null || revision.operationType !== 'section-copy'
            || revision.material !== null || !validSectionCopyBefore(revision.before)
            || !validSectionCopyAfter(revision.after) || !bindingIds.has(revision.sectionId)) {
          throw new InvalidDraftDataError('invalid_section_copy_revision');
        }
      } else if (revision.sourceEvidence !== undefined
          || !validSectionId(revision.sectionId) || !validEditId(revision.editId)
          || !['text', 'image'].includes(revision.operationType)
          || !bindingIds.has(revision.sectionId)
          || (revisionIndex > latestStructureIndex && (!editIds.has(revision.editId)
            || draft.editableNodes.find(item => item.editId === revision.editId)?.sectionId !== revision.sectionId))
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
          ? revision.releaseType !== undefined || revision.changeSummary !== undefined
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
      if (!isPlainObject(publication)
          || (publicationKeys !== legacyPublicationKeys
            && publicationKeys !== evidencedPublicationKeys)
          || !validPublicationId(publication.id)
          || publicationIds.has(publication.id) || !revisionIds.has(publication.revisionId)
          || !(publication.sectionId === null || validSectionId(publication.sectionId))
          || !validLiveUrl(publication.liveUrl)
          || !(publication.note === null || normalizedText(publication.note, 1, 4000, true) === publication.note)
          || !validIso(publication.confirmedAt) || !validEditor(publication.editor)
          || (publicationKeys === evidencedPublicationKeys
            && (publication.sectionId !== null
              || !/^[a-f0-9]{64}$/.test(publication.liveContentSha256)
              || !/^[a-f0-9]{40}$/.test(publication.liveSourceCommit)))) {
        throw new InvalidDraftDataError('invalid_publication');
      }
      const revision = draft.revisions.find(item => item.id === publication.revisionId);
      if (publication.sectionId !== null
          && (revision.kind !== 'edit' || revision.sectionId !== publication.sectionId)) {
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
  const descriptors = descriptorsForInstrumentedSection(copied, targetSectionId, targetName);
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

function createDraftStore({getBlob = get, headBlob = head, putBlob = put, environment = process.env} = {}) {
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

  async function putHtml(pageKey, revisionId, html) {
    const blobPath = `${DRAFT_HTML_PREFIX}/${pageKey}/history/${revisionId}.html`;
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

  async function putScreenshot(pageKey, revisionId, image, {idFactory = randomUUID} = {}) {
    if (!validPageKey(pageKey) || !validRevisionId(revisionId) || !Buffer.isBuffer(image)
        || image.length < 8 || image.length > MAX_SCREENSHOT_BYTES
        || !image.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
      throw new InvalidDraftDataError('invalid_draft_screenshot');
    }
    const captureId = idFactory();
    if (typeof captureId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(captureId)) {
      throw new InvalidDraftDataError('invalid_capture_id');
    }
    const blobPath = `${DRAFT_HTML_PREFIX}/${pageKey}/screenshots/${revisionId}/${captureId}.png`;
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

  async function updateCapture(pageKey, revisionId, capture, now = new Date()) {
    const updatedAt = now.toISOString();
    const stored = await mutateManifest(manifest => {
      const draft = manifest.drafts.find(item => item.pageKey === pageKey);
      const revision = draft?.revisions.find(item => item.id === revisionId);
      if (!draft || !revision) throw new InvalidDraftDataError('draft_not_initialized');
      if (revision.capture.status === 'ready') return manifest;
      revision.capture = capture;
      draft.updatedAt = updatedAt;
      manifest.updatedAt = updatedAt;
      return manifest;
    });
    return stored.data.drafts.find(item => item.pageKey === pageKey);
  }

  async function getScreenshot(pageKey, revisionId) {
    const current = await getDraft(pageKey);
    const revision = current.draft?.revisions.find(item => item.id === revisionId);
    if (!revision || revision.capture.status !== 'ready') return null;
    let result;
    try {
      result = await getBlob(revision.capture.blobPath, {access: 'private', useCache: false, ...auth()});
    } catch (error) {
      if (isNotFound(error)) return null;
      throw new DraftStoreUnavailableError('working draft screenshot is unavailable', {cause: error});
    }
    if (!result?.stream) return null;
    const image = Buffer.from(await new Response(result.stream).arrayBuffer());
    if (image.length > MAX_SCREENSHOT_BYTES || hash(image) !== revision.capture.imageSha256) {
      throw new DraftStoreUnavailableError('working draft screenshot integrity check failed');
    }
    return {image, capture: revision.capture};
  }

  async function getHtmlByRevision(draft, revisionId = draft.currentRevisionId) {
    const revision = draft.revisions.find(item => item.id === revisionId);
    if (!revision) return null;
    let result;
    try {
      result = await getBlob(revision.blobPath, {access: 'private', useCache: false, ...auth()});
    } catch (error) {
      if (isNotFound(error)) return null;
      throw new DraftStoreUnavailableError('working draft HTML is unavailable', {cause: error});
    }
    if (!result?.stream) return null;
    const html = await new Response(result.stream).text();
    if (Buffer.byteLength(html, 'utf8') > MAX_SOURCE_BYTES || hash(html) !== revision.htmlSha256) {
      throw new DraftStoreUnavailableError('working draft HTML integrity check failed');
    }
    return {html, revision};
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
    const blobPath = await putHtml(pageKey, revisionId, prepared.html);
    const revision = {
      id: revisionId, kind: 'initialized', createdAt, editor: {...editor},
      sectionId: null, editId: null, operationType: 'initialize', before: null, after: null,
      material: null, htmlSha256: hash(prepared.html), blobPath, capture: pendingCapture(),
    };
    if (sourceEvidence) revision.sourceEvidence = {...sourceEvidence};
    const candidate = {
      pageKey, targetId: pageKey, label: target.label, family: target.family,
      variant: target.variant, category: target.category, sourceUrl: target.productionUrl,
      sourceSha256, createdAt, updatedAt: createdAt, editor: {...editor},
      currentRevisionId: revisionId, editableNodes: prepared.editableNodes,
      workingBindings: deriveWorkingBindings(prepared.html, bindings),
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
    const blobPath = await putHtml(pageKey, revisionId, prepared.html);
    const revision = {
      id: revisionId, kind: 'initialized', createdAt, editor: {...editor},
      sectionId: null, editId: null, operationType: 'initialize', before: null, after: null,
      material: null, htmlSha256: hash(prepared.html), blobPath, capture: pendingCapture(),
      ...releaseInput,
    };
    if (sourceEvidence) revision.sourceEvidence = {...sourceEvidence};
    const editableNodes = prepared.editableNodes;
    const workingBindings = deriveWorkingBindings(prepared.html, bindings);
    const stored = await mutateManifest(manifest => {
      const draft = manifest.drafts.find(item => item.pageKey === pageKey);
      if (!draft) throw new InvalidDraftDataError('draft_not_initialized');
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
      draft.revisions.push(revision);
      manifest.updatedAt = createdAt;
      return manifest;
    });
    return {draft: stored.data.drafts.find(item => item.pageKey === pageKey), revision};
  }

  async function edit({pageKey, sectionId, editId, expectedRevision, operation, material, editor,
    releaseType = 'minor', changeSummary = null, now = new Date(), idFactory = randomUUID}) {
    const releaseInput = normalizedReleaseInput(releaseType, changeSummary);
    if (!validPageKey(pageKey) || !validSectionId(sectionId) || !validEditId(editId)
        || !validRevisionId(expectedRevision) || !isPlainObject(operation) || !validEditor(editor)) {
      throw new InvalidDraftDataError('invalid_draft_edit');
    }
    const beforeState = await getDraft(pageKey);
    if (!beforeState.draft) throw new InvalidDraftDataError('draft_not_initialized');
    if (!beforeState.draft.release) throw new InvalidDraftDataError('versioning_not_started');
    if (beforeState.draft.currentRevisionId !== expectedRevision) throw new DraftStoreConflictError('draft revision conflict');
    const currentHtml = await getHtmlByRevision(beforeState.draft);
    if (!currentHtml) throw new DraftStoreUnavailableError('working draft HTML is unavailable');
    const changed = mutateWorkingHtml(currentHtml.html, {sectionId, editId, operation});
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
    const blobPath = await putHtml(pageKey, revisionId, changed.html);
    const revision = {
      id: revisionId, kind: 'edit', createdAt, editor: {...editor}, sectionId, editId,
      operationType: changed.type, before: changed.before, after: changed.after,
      material: recordedMaterial, htmlSha256: hash(changed.html), blobPath, capture: pendingCapture(),
      ...releaseInput,
    };
    const editableNodes = refreshDescriptors(changed.html, beforeState.draft.editableNodes);
    const workingBindings = deriveWorkingBindings(changed.html, beforeState.draft.workingBindings);
    const stored = await mutateManifest(manifest => {
      const draft = manifest.drafts.find(item => item.pageKey === pageKey);
      if (!draft) throw new InvalidDraftDataError('draft_not_initialized');
      if (draft.currentRevisionId !== expectedRevision) throw new DraftStoreConflictError('draft revision conflict');
      if (draft.revisions.length >= MAX_REVISIONS) throw new InvalidDraftDataError('draft_revision_limit');
      draft.currentRevisionId = revisionId;
      draft.updatedAt = createdAt;
      draft.editor = {...editor};
      draft.editableNodes = editableNodes;
      draft.workingBindings = workingBindings;
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
    const sourceTarget = getTarget(sourcePageKey);
    const targetDrafts = normalizedTargets.map(item => {
      const draft = state.data.drafts.find(candidate => candidate.pageKey === item.pageKey);
      if (!draft) throw new InvalidDraftDataError('section_copy_target_missing');
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
    const sourceResult = await getHtmlByRevision(sourceDraft, sourceRevision);
    if (!sourceResult) throw new DraftStoreUnavailableError('section copy source HTML is unavailable');
    const createdAt = now.toISOString();
    const prepared = [];
    const revisionIds = new Set(state.data.drafts.flatMap(draft => draft.revisions.map(item => item.id)));
    for (const {request, draft} of targetDrafts) {
      const targetResult = await getHtmlByRevision(draft, request.expectedRevision);
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
      const revision = {
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
      prepared.push({request, changed, revision});
    }
    for (const item of prepared) {
      item.revision.blobPath = await putHtml(
        item.request.pageKey, item.revision.id, item.changed.html,
      );
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
    if (parent.branch || parent.currentRevisionId !== expectedRevision) {
      throw new DraftStoreConflictError('variation_revision_conflict');
    }
    if (state.data.drafts.some(item => item.branch?.parentPageKey === pageKey
        && item.branch.name.toLowerCase() === normalizedName.toLowerCase())) {
      throw new InvalidDraftDataError('variation_name_conflict');
    }
    const parentHtml = await getHtmlByRevision(parent, expectedRevision);
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
    const blobPath = await putHtml(variationKey, revisionId, parentHtml.html);
    const revision = {
      id: revisionId, kind: 'initialized', createdAt, editor: {...editor},
      sectionId: null, editId: null, operationType: 'initialize', before: null, after: null,
      material: null, htmlSha256: hash(parentHtml.html), blobPath, capture: pendingCapture(),
    };
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

  async function confirmPublished({pageKey, sectionId, revisionId, liveUrl, confirmed, note,
    liveContentSha256, liveSourceCommit, editor, now = new Date(), idFactory = randomUUID}) {
    const normalizedNote = note === undefined || note === null || note === ''
      ? null : normalizedText(note, 1, 4000, true);
    const hasLiveEvidence = liveContentSha256 !== undefined || liveSourceCommit !== undefined;
    if (!validPageKey(pageKey) || !(sectionId === null || validSectionId(sectionId))
        || !validRevisionId(revisionId)
        || !validLiveUrl(liveUrl) || confirmed !== true || !validEditor(editor)
        || (note !== undefined && note !== null && note !== '' && !normalizedNote)
        || (hasLiveEvidence && (sectionId !== null
          || typeof liveContentSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(liveContentSha256)
          || typeof liveSourceCommit !== 'string' || !/^[a-f0-9]{40}$/.test(liveSourceCommit)))) {
      throw new InvalidDraftDataError('invalid_publication_confirmation');
    }
    const confirmedAt = now.toISOString();
    const publication = {
      id: `publication_${idFactory()}`, revisionId, sectionId, liveUrl,
      note: normalizedNote, confirmedAt, editor: {...editor},
    };
    if (hasLiveEvidence) {
      publication.liveContentSha256 = liveContentSha256;
      publication.liveSourceCommit = liveSourceCommit;
    }
    if (!validPublicationId(publication.id)) throw new InvalidDraftDataError('invalid_publication_id');
    const stored = await mutateManifest(manifest => {
      const draft = manifest.drafts.find(item => item.pageKey === pageKey);
      const revision = draft?.revisions.find(item => item.id === revisionId);
      if (!draft) throw new InvalidDraftDataError('draft_not_initialized');
      if (!revision || (sectionId === null
        ? draft.currentRevisionId !== revisionId
        : (revision.kind !== 'edit' || revision.sectionId !== sectionId))) {
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
    rebase,
    edit,
    copySection,
    createVariation,
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
  publicDraft,
  renderWorkingPage,
  revisionReleaseState,
  revisionSyncState,
  revisionVersion,
  sourceMatchStatus,
  validateManifest,
  validSourceEvidence,
  validLiveUrl,
  validPageKey,
  workingRevisionUrl,
};
