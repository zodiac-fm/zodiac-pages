'use strict';

const {createHash, randomUUID} = require('node:crypto');
const {BlobNotFoundError, BlobPreconditionFailedError, get, head, put} = require('@vercel/blob');
const parse5 = require('parse5');
const {getTarget, pairedLiveTargets} = require('./production-catalog');
const {normalizedContentSha256} = require('./live-source');
const {normalizedChangeMaterial} = require('./state');

const DRAFT_MANIFEST_PATH = 'funnel-tracker/review/drafts.json';
const DRAFT_HTML_PREFIX = 'funnel-tracker/review/drafts';
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAX_SOURCE_BYTES = 12 * 1024 * 1024;
const MAX_SCREENSHOT_BYTES = 24 * 1024 * 1024;
const MAX_REVISIONS = 2000;
const MAX_PUBLICATIONS = 2000;
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

function validPageKey(value) {
  const target = typeof value === 'string' ? getTarget(value) : null;
  return Boolean(target && target.stage === 'draft' && target.id === value);
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

function workingRevisionUrl(pageKey, sourceUrl, revisionId = null) {
  const params = new URL(sourceUrl).searchParams;
  if (revisionId) params.set('revision', revisionId);
  const query = params.toString();
  return `/funnel/working/${encodeURIComponent(pageKey)}${query ? `?${query}` : ''}`;
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
  const params = new URLSearchParams({mode: 'review', page: target.family, variant: target.variant});
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
  const sourceReferenceUrl = target.referenceUrl || target.productionUrl;
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
  prependParsedFragment(body, `<div class="funnel-working-banner" data-funnel-working-banner><strong class="funnel-working-badge">DRAFT</strong><span class="funnel-working-identity">${escapeText(target.label || title)}${sourceVersion ? ` <span class="funnel-working-source">· ${escapeText(sourceVersion)}</span>` : ''}</span>${liveTarget ? `<a href="${escapeAttribute(liveTarget.productionUrl)}" target="_blank" rel="noopener">Live page</a>` : ''}<a href="${escapeAttribute(sourceReferenceUrl)}" target="_blank" rel="noopener">Source reference</a><a href="${escapeAttribute(trackerUrl)}">Open tracker</a></div>`);

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
    const before = normalizedText(textNodes[0].value, 1, 24000, true);
    textNodes[0].value = value;
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

function publicRevision(value, pageKey) {
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
    htmlSha256: value.htmlSha256,
    workingUrl: workingRevisionUrl(pageKey, getTarget(pageKey).productionUrl, value.id),
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
  const liveSource = latestLiveSource(value);
  if (!liveSource) return 'not-synced';
  if (liveSource.revision.sourceEvidence.contentSha256
      !== observedEvidence.contentSha256) return 'check-needed';
  return sourceMatchStatus(value);
}

function publicDraft(value) {
  const target = getTarget(value.pageKey);
  const livePages = pairedLiveTargets(value.pageKey).map(item => ({
    id: item.id, label: item.label, channel: item.channel, url: item.productionUrl,
  }));
  const latestPagePublication = [...value.publications].reverse()
    .find(item => item.sectionId === null) || null;
  const confirmedRevisionIndex = latestPagePublication
    ? value.revisions.findIndex(item => item.id === latestPagePublication.revisionId) : -1;
  const pendingEditCount = value.revisions
    .slice(confirmedRevisionIndex + 1)
    .filter(item => item.kind === 'edit').length;
  const pageStatus = latestPagePublication
    ? (latestPagePublication.revisionId === value.currentRevisionId
      ? 'confirmed-live' : 'changes-not-live')
    : 'unconfirmed';
  const liveSource = latestLiveSource(value);
  const initialized = currentInitialization(value);
  const contentBaseUrl = initialized?.revision.sourceEvidence?.liveUrl || target.productionUrl;
  return {
    pageKey: value.pageKey,
    targetId: value.targetId,
    label: value.label,
    family: value.family,
    variant: value.variant,
    category: value.category,
    sourceUrl: value.sourceUrl,
    selectedSourceUrl: target.productionUrl,
    selectedLabel: target.label,
    sourceVersion: target.sourceVersion || null,
    referenceUrl: target.referenceUrl || target.productionUrl,
    contentBaseUrl,
    livePages,
    sourceOutdated: value.sourceUrl !== target.productionUrl || value.label !== target.label,
    pageStatus,
    pendingEditCount,
    latestPagePublication: latestPagePublication
      ? {...latestPagePublication, editor: {...latestPagePublication.editor}} : null,
    sourceMatchStatus: sourceMatchStatus(value),
    liveSource: liveSource ? {
      revisionId: liveSource.revision.id,
      createdAt: liveSource.revision.createdAt,
      editor: {...liveSource.revision.editor},
      ...liveSource.revision.sourceEvidence,
    } : null,
    workingUrl: workingRevisionUrl(value.pageKey, value.sourceUrl),
    revision: value.currentRevisionId,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    editor: {...value.editor},
    editableNodes: value.editableNodes.map(item => ({...item})),
    workingBindings: value.workingBindings.map(item => ({
      ...item,
      element: {...item.element, classes: [...item.element.classes]},
      firstHeading: item.firstHeading ? {...item.firstHeading} : null,
    })),
    history: value.revisions.map(item => publicRevision(item, value.pageKey)),
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

function validateManifest(value) {
  if (!isPlainObject(value) || Object.keys(value).sort().join(',') !== 'drafts,schema,updatedAt'
      || value.schema !== 1 || !validIso(value.updatedAt) || !Array.isArray(value.drafts)
      || value.drafts.length > 9) throw new InvalidDraftDataError('invalid_draft_manifest');
  const keys = new Set();
  for (const draft of value.drafts) {
    if (!isPlainObject(draft)
        || Object.keys(draft).sort().join(',') !== 'category,createdAt,currentRevisionId,editableNodes,editor,family,label,pageKey,publications,revisions,sourceSha256,sourceUrl,targetId,updatedAt,variant,workingBindings'
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
    for (const [revisionIndex, revision] of draft.revisions.entries()) {
      const revisionKeys = Object.keys(revision).sort().join(',');
      const expectedRevisionKeys = 'after,before,blobPath,capture,createdAt,editId,editor,htmlSha256,id,kind,material,operationType,sectionId';
      const expectedSourcedRevisionKeys = `${expectedRevisionKeys},sourceEvidence`.split(',').sort().join(',');
      if (!isPlainObject(revision)
          || (revisionKeys !== expectedRevisionKeys && revisionKeys !== expectedSourcedRevisionKeys)
          || !validRevisionId(revision.id) || revisionIds.has(revision.id)
          || !['initialized', 'edit'].includes(revision.kind) || !validIso(revision.createdAt)
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
      } else if (revision.sourceEvidence !== undefined
          || !validSectionId(revision.sectionId) || !validEditId(revision.editId)
          || !['text', 'image'].includes(revision.operationType)
          || !bindingIds.has(revision.sectionId)
          || (revisionIndex > latestInitializationIndex && (!editIds.has(revision.editId)
            || draft.editableNodes.find(item => item.editId === revision.editId)?.sectionId !== revision.sectionId))
          || (revision.operationType === 'text'
            ? !(normalizedText(revision.before, 1, 24000, true) === revision.before
              && normalizedText(revision.after, 1, 24000, true) === revision.after)
            : !(validImageState(revision.before) && validImageState(revision.after)))) {
        throw new InvalidDraftDataError('invalid_edit_revision');
      }
      revisionIds.add(revision.id);
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
      if (!isPlainObject(publication)
          || Object.keys(publication).sort().join(',') !== 'confirmedAt,editor,id,liveUrl,note,revisionId,sectionId'
          || !validPublicationId(publication.id)
          || publicationIds.has(publication.id) || !revisionIds.has(publication.revisionId)
          || !(publication.sectionId === null || validSectionId(publication.sectionId))
          || !validLiveUrl(publication.liveUrl)
          || !(publication.note === null || normalizedText(publication.note, 1, 4000, true) === publication.note)
          || !validIso(publication.confirmedAt) || !validEditor(publication.editor)) {
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
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_MANIFEST_BYTES) {
    throw new InvalidDraftDataError('draft_manifest_too_large');
  }
  return value;
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

  async function initialize({pageKey, sourceHtml, sourceSha256, runtimeMap, sectionNames, editor,
    sourceEvidence = null, now = new Date(), idFactory = randomUUID}) {
    if (!validPageKey(pageKey) || typeof sourceHtml !== 'string' || hash(sourceHtml) !== sourceSha256
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
    expectedRevision, sourceEvidence = null, now = new Date(), idFactory = randomUUID}) {
    if (!validPageKey(pageKey) || typeof sourceHtml !== 'string' || hash(sourceHtml) !== sourceSha256
        || !isPlainObject(runtimeMap?.sections) || !isPlainObject(sectionNames) || !validEditor(editor)
        || !validRevisionId(expectedRevision)
        || (sourceEvidence !== null && (!validSourceEvidence(sourceEvidence, pageKey, sourceSha256)
          || !sourceEvidenceMatchesHtml(sourceEvidence, sourceHtml)))) {
      throw new InvalidDraftDataError('invalid_source_rebase');
    }
    const beforeState = await getDraft(pageKey);
    if (!beforeState.draft) throw new InvalidDraftDataError('draft_not_initialized');
    if (beforeState.draft.currentRevisionId !== expectedRevision) {
      throw new DraftStoreConflictError('draft revision conflict');
    }
    const latestInitializationIndex = beforeState.draft.revisions
      .findLastIndex(revision => revision.kind === 'initialized');
    if (beforeState.draft.revisions.slice(latestInitializationIndex + 1)
      .some(revision => revision.kind === 'edit')) {
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
      if (draft.revisions.slice(latestIndex + 1).some(item => item.kind === 'edit')) {
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

  async function edit({pageKey, sectionId, editId, expectedRevision, operation, material, editor, now = new Date(), idFactory = randomUUID}) {
    if (!validPageKey(pageKey) || !validSectionId(sectionId) || !validEditId(editId)
        || !validRevisionId(expectedRevision) || !isPlainObject(operation) || !validEditor(editor)) {
      throw new InvalidDraftDataError('invalid_draft_edit');
    }
    const beforeState = await getDraft(pageKey);
    if (!beforeState.draft) throw new InvalidDraftDataError('draft_not_initialized');
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

  async function confirmPublished({pageKey, sectionId, revisionId, liveUrl, confirmed, note, editor, now = new Date(), idFactory = randomUUID}) {
    const normalizedNote = note === undefined || note === null || note === ''
      ? null : normalizedText(note, 1, 4000, true);
    if (!validPageKey(pageKey) || !(sectionId === null || validSectionId(sectionId))
        || !validRevisionId(revisionId)
        || !validLiveUrl(liveUrl) || confirmed !== true || !validEditor(editor)
        || (note !== undefined && note !== null && note !== '' && !normalizedNote)) {
      throw new InvalidDraftDataError('invalid_publication_confirmation');
    }
    const confirmedAt = now.toISOString();
    const publication = {
      id: `publication_${idFactory()}`, revisionId, sectionId, liveUrl,
      note: normalizedNote, confirmedAt, editor: {...editor},
    };
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
    initialize,
    rebase,
    edit,
    confirmPublished,
    putScreenshot,
    updateCapture,
    getScreenshot,
  };
}

async function fetchCanonicalDraft(pageKey, {fetcher = fetch, timeoutMs = SOURCE_FETCH_TIMEOUT_MS} = {}) {
  if (!validPageKey(pageKey)) throw new InvalidDraftDataError('invalid_page_key');
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
  SOURCE_FETCH_TIMEOUT_MS,
  compareLiveSourceEvidence,
  createDraftStore,
  deriveWorkingBindings,
  draftStore: createDraftStore(),
  fetchCanonicalDraft,
  injectWorkingControls,
  mutateWorkingHtml,
  publicDraft,
  sourceMatchStatus,
  validateManifest,
  validSourceEvidence,
  validLiveUrl,
  validPageKey,
  workingRevisionUrl,
};
