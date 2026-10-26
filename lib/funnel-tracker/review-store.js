'use strict';

const {createHash, randomUUID} = require('node:crypto');
const {
  BlobNotFoundError,
  BlobPreconditionFailedError,
  get,
  head,
  put,
} = require('@vercel/blob');

const MAP_PATH = 'funnel-tracker/review/runtime-map.json';
const ATTACHMENT_INDEX_PATH = 'funnel-tracker/review/attachments.json';
const ATTACHMENT_PREFIX = 'funnel-tracker/review/attachments';
const MAX_MAP_BYTES = 2 * 1024 * 1024;
const MAX_INDEX_BYTES = 2 * 1024 * 1024;
const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
const MAX_ATTACHMENTS = 5000;

class ReviewStoreUnavailableError extends Error {}
class ReviewStoreConflictError extends Error {}
class InvalidReviewDataError extends Error {}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validIso(value) {
  return typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));
}

function validDateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validGeneratedAt(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? validDateOnly(value)
    : validIso(value);
}

function validEditor(value) {
  return isPlainObject(value) && Object.keys(value).length === 3
    && typeof value.sub === 'string' && /^[A-Za-z0-9_-]{6,255}$/.test(value.sub)
    && typeof value.email === 'string' && /^[^@\s]+@zodiac\.fm$/.test(value.email)
    && value.email === value.email.toLowerCase()
    && typeof value.name === 'string' && value.name.length >= 1 && value.name.length <= 120
    && value.name === value.name.trim().replace(/\s+/g, ' ')
    && !/[\u0000-\u001f\u007f]/.test(value.name);
}

function validDraftUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.origin === 'https://zodiac-pages.vercel.app'
      && !url.port && !url.hash && /^\/(?:landers|funnel|site)(?:\/|$)/.test(url.pathname);
  } catch {
    return false;
  }
}

function normalizedText(value, min, max) {
  if (typeof value !== 'string') return null;
  const result = value.trim().replace(/\s+/g, ' ');
  return result.length >= min && result.length <= max
    && !/[\u0000-\u001f\u007f]/.test(result) ? result : null;
}

function validateRuntimeMap(value) {
  if (!isPlainObject(value) || Object.keys(value).sort().join(',') !== 'generatedAt,schema,sections'
      || value.schema !== 1
      || !validGeneratedAt(value.generatedAt)
      || !isPlainObject(value.sections) || Object.keys(value.sections).length > 1000) {
    throw new InvalidReviewDataError('invalid runtime review map');
  }
  const sections = {};
  for (const [sectionId, source] of Object.entries(value.sections)) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/.test(sectionId)
        || !isPlainObject(source)
        || Object.keys(source).sort().join(',') !== 'element,firstHeading,gaps,previewUrl,selector,sourceSha256'
        || !validDraftUrl(source.previewUrl)
        || typeof source.selector !== 'string' || source.selector.length < 1 || source.selector.length > 500
        || /[\u0000-\u001f\u007f]/.test(source.selector)
        || !isPlainObject(source.element)
        || Object.keys(source.element).sort().join(',') !== 'classes,id,tag'
        || typeof source.element.tag !== 'string' || !/^[a-z][a-z0-9-]{0,39}$/.test(source.element.tag)
        || !(source.element.id === null || (typeof source.element.id === 'string'
          && source.element.id.length >= 1 && source.element.id.length <= 160
          && !/[\u0000-\u001f\u007f]/.test(source.element.id)))
        || !Array.isArray(source.element.classes) || source.element.classes.length > 100
        || source.element.classes.some(item => typeof item !== 'string' || !/^[A-Za-z_-][A-Za-z0-9_-]{0,159}$/.test(item))
        || new Set(source.element.classes).size !== source.element.classes.length
        || source.element.classes.some((item, index, array) => index > 0 && array[index - 1].localeCompare(item) >= 0)
        || !(source.firstHeading === null || (isPlainObject(source.firstHeading)
          && Object.keys(source.firstHeading).sort().join(',') === 'tag,text'
          && /^h[1-6]$/.test(source.firstHeading.tag)
          && normalizedText(source.firstHeading.text, 1, 500) === source.firstHeading.text))
        || !Array.isArray(source.gaps) || source.gaps.length > 50
        || source.gaps.some(gap => normalizedText(gap, 1, 4000) !== gap)
        || typeof source.sourceSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(source.sourceSha256)) {
      throw new InvalidReviewDataError('invalid runtime review section');
    }
    sections[sectionId] = {
      previewUrl: source.previewUrl,
      selector: source.selector,
      element: {
        tag: source.element.tag,
        id: source.element.id,
        classes: [...source.element.classes],
      },
      firstHeading: source.firstHeading === null ? null : {...source.firstHeading},
      gaps: [...source.gaps],
      sourceSha256: source.sourceSha256,
    };
  }
  const sanitized = {schema: 1, generatedAt: value.generatedAt, sections};
  if (Buffer.byteLength(JSON.stringify(sanitized), 'utf8') > MAX_MAP_BYTES) {
    throw new InvalidReviewDataError('runtime review map is too large');
  }
  return sanitized;
}

function validAttachmentId(value) {
  return typeof value === 'string' && /^att_[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(value);
}

function validAttachment(value) {
  if (!isPlainObject(value) || Object.keys(value).sort().join(',') !== 'blobPath,createdAt,editor,fileName,id,mimeType,sha256,size'
      || !validAttachmentId(value.id)
      || !['image/png', 'image/jpeg', 'image/webp'].includes(value.mimeType)
      || !Number.isSafeInteger(value.size) || value.size < 8 || value.size > MAX_ATTACHMENT_BYTES
      || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)
      || normalizedText(value.fileName, 1, 120) !== value.fileName
      || !validIso(value.createdAt) || !validEditor(value.editor)) return false;
  const extension = {'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[value.mimeType];
  return value.blobPath === `${ATTACHMENT_PREFIX}/${value.id}.${extension}`;
}

function createEmptyAttachmentIndex(now = new Date()) {
  return {schema: 1, updatedAt: now.toISOString(), attachments: []};
}

function validateAttachmentIndex(value) {
  if (!isPlainObject(value) || Object.keys(value).sort().join(',') !== 'attachments,schema,updatedAt'
      || value.schema !== 1 || !validIso(value.updatedAt)
      || !Array.isArray(value.attachments) || value.attachments.length > MAX_ATTACHMENTS) {
    throw new InvalidReviewDataError('invalid review attachment index');
  }
  const ids = new Set();
  for (const item of value.attachments) {
    if (!validAttachment(item) || ids.has(item.id)) throw new InvalidReviewDataError('invalid review attachment');
    ids.add(item.id);
  }
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_INDEX_BYTES) {
    throw new InvalidReviewDataError('review attachment index is too large');
  }
  return value;
}

function detectImageMime(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF'
      && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

function cleanFileName(value, mimeType) {
  const extension = {'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[mimeType];
  if (typeof value !== 'string') return `attachment.${extension}`;
  const leaf = value.split(/[\\/]/).pop().replace(/[^A-Za-z0-9._ -]/g, '').trim().replace(/\s+/g, ' ');
  const normalized = normalizedText(leaf, 1, 120);
  return normalized || `attachment.${extension}`;
}

function publicAttachment(value) {
  return {
    id: value.id,
    mimeType: value.mimeType,
    size: value.size,
    sha256: value.sha256,
    fileName: value.fileName,
    createdAt: value.createdAt,
    editor: {...value.editor},
  };
}

function authOptions(environment) {
  const storeId = environment.FUNNEL_TRACKER_BLOB_STORE_ID;
  const token = environment.FUNNEL_TRACKER_BLOB_READ_WRITE_TOKEN;
  if (typeof storeId === 'string' && /^store_[A-Za-z0-9]+$/.test(storeId)) return {storeId};
  if (typeof token === 'string' && token.length >= 32) return {token};
  throw new ReviewStoreUnavailableError('review storage is not configured');
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

function createReviewStore({getBlob = get, headBlob = head, putBlob = put, environment = process.env} = {}) {
  const auth = () => authOptions(environment);

  async function readJson(path, maxBytes, validate, {missing = null} = {}) {
    let metadata;
    try {
      metadata = await headBlob(path, auth());
    } catch (error) {
      if (isNotFound(error)) return missing;
      throw new ReviewStoreUnavailableError('private review data is unavailable', {cause: error});
    }
    let result;
    try {
      result = await getBlob(path, {access: 'private', useCache: false, ...auth()});
    } catch (error) {
      if (isNotFound(error)) throw new ReviewStoreConflictError('private review data changed while reading');
      throw new ReviewStoreUnavailableError('private review data is unavailable', {cause: error});
    }
    if (!result?.stream || !sameEtag(metadata?.etag, result.blob?.etag)) {
      throw new ReviewStoreConflictError('private review data changed while reading');
    }
    let raw;
    try {
      raw = await new Response(result.stream).text();
    } catch (error) {
      throw new ReviewStoreUnavailableError('private review data is unreadable', {cause: error});
    }
    if (Buffer.byteLength(raw, 'utf8') > maxBytes) throw new ReviewStoreUnavailableError('private review data is too large');
    try {
      return {data: validate(JSON.parse(raw)), revision: metadata.etag};
    } catch (error) {
      throw new ReviewStoreUnavailableError('private review data is invalid', {cause: error});
    }
  }

  async function readMap() {
    const result = await readJson(MAP_PATH, MAX_MAP_BYTES, validateRuntimeMap);
    if (!result) throw new ReviewStoreUnavailableError('runtime review map is not initialized');
    return result;
  }

  async function readIndex() {
    return await readJson(ATTACHMENT_INDEX_PATH, MAX_INDEX_BYTES, validateAttachmentIndex, {
      missing: {data: createEmptyAttachmentIndex(), revision: null},
    });
  }

  async function writeIndex(data, revision) {
    validateAttachmentIndex(data);
    const options = {
      access: 'private',
      addRandomSuffix: false,
      contentType: 'application/json',
      cacheControlMaxAge: 60,
      ...auth(),
    };
    if (revision === null) options.allowOverwrite = false;
    else {
      options.allowOverwrite = true;
      options.ifMatch = revision;
    }
    try {
      await putBlob(ATTACHMENT_INDEX_PATH, `${JSON.stringify(data, null, 2)}\n`, options);
    } catch (error) {
      if (isConflict(error)) throw new ReviewStoreConflictError('review attachment index changed', {cause: error});
      throw new ReviewStoreUnavailableError('review attachment index write failed', {cause: error});
    }
    const stored = await readIndex();
    if (stored.revision === null) throw new ReviewStoreUnavailableError('review attachment index write was not confirmed');
    return stored;
  }

  async function mutateIndex(mutator, attempts = 5) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const current = await readIndex();
      const draft = JSON.parse(JSON.stringify(current.data));
      const next = await mutator(draft, current);
      try {
        return await writeIndex(next, current.revision);
      } catch (error) {
        if (!(error instanceof ReviewStoreConflictError) || attempt === attempts - 1) throw error;
      }
    }
    throw new ReviewStoreConflictError('review attachment index changed repeatedly');
  }

  async function putAttachment(buffer, {mimeType, fileName, editor, now = new Date(), idFactory = randomUUID} = {}) {
    const detected = detectImageMime(buffer);
    if (!Buffer.isBuffer(buffer) || buffer.length < 12 || buffer.length > MAX_ATTACHMENT_BYTES
        || detected === null || detected !== mimeType || !validEditor(editor)) {
      throw new InvalidReviewDataError('invalid review attachment upload');
    }
    const id = `att_${idFactory()}`;
    if (!validAttachmentId(id)) throw new InvalidReviewDataError('invalid review attachment id');
    const extension = {'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[mimeType];
    const item = {
      id,
      mimeType,
      size: buffer.length,
      sha256: createHash('sha256').update(buffer).digest('hex'),
      fileName: cleanFileName(fileName, mimeType),
      createdAt: now.toISOString(),
      editor: {sub: editor.sub, email: editor.email, name: editor.name},
      blobPath: `${ATTACHMENT_PREFIX}/${id}.${extension}`,
    };
    if (!validAttachment(item)) throw new InvalidReviewDataError('invalid review attachment metadata');
    try {
      await putBlob(item.blobPath, buffer, {
        access: 'private',
        allowOverwrite: false,
        addRandomSuffix: false,
        contentType: item.mimeType,
        cacheControlMaxAge: 31536000,
        ...auth(),
      });
    } catch (error) {
      throw new ReviewStoreUnavailableError('review attachment write failed', {cause: error});
    }
    await mutateIndex(index => {
      if (index.attachments.length >= MAX_ATTACHMENTS) throw new InvalidReviewDataError('review attachment limit reached');
      if (index.attachments.some(existing => existing.id === item.id)) throw new ReviewStoreConflictError('review attachment id collision');
      index.attachments.push(item);
      index.updatedAt = item.createdAt;
      return index;
    });
    return publicAttachment(item);
  }

  async function findAttachment(id) {
    if (!validAttachmentId(id)) return null;
    const current = await readIndex();
    return current.data.attachments.find(item => item.id === id) || null;
  }

  async function hasAttachment(id) {
    return Boolean(await findAttachment(id));
  }

  async function readAttachment(id) {
    const item = await findAttachment(id);
    if (!item) return null;
    let result;
    try {
      result = await getBlob(item.blobPath, {access: 'private', useCache: false, ...auth()});
    } catch (error) {
      if (isNotFound(error)) return null;
      throw new ReviewStoreUnavailableError('review attachment is unavailable', {cause: error});
    }
    if (!result?.stream) return null;
    let buffer;
    try {
      buffer = Buffer.from(await new Response(result.stream).arrayBuffer());
    } catch (error) {
      throw new ReviewStoreUnavailableError('review attachment is unreadable', {cause: error});
    }
    const digest = createHash('sha256').update(buffer).digest('hex');
    if (buffer.length !== item.size || buffer.length > MAX_ATTACHMENT_BYTES
        || detectImageMime(buffer) !== item.mimeType || digest !== item.sha256) {
      throw new ReviewStoreUnavailableError('review attachment integrity check failed');
    }
    return {attachment: publicAttachment(item), buffer};
  }

  return {readMap, readIndex, putAttachment, findAttachment, hasAttachment, readAttachment};
}

module.exports = {
  ATTACHMENT_INDEX_PATH,
  ATTACHMENT_PREFIX,
  MAP_PATH,
  MAX_ATTACHMENT_BYTES,
  InvalidReviewDataError,
  ReviewStoreConflictError,
  ReviewStoreUnavailableError,
  cleanFileName,
  createEmptyAttachmentIndex,
  createReviewStore,
  detectImageMime,
  publicAttachment,
  reviewStore: createReviewStore(),
  validateAttachmentIndex,
  validateRuntimeMap,
  validAttachmentId,
};
