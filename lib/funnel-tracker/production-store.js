'use strict';

const {
  BlobNotFoundError,
  BlobPreconditionFailedError,
  get,
  head,
  put,
} = require('@vercel/blob');

const MANIFEST_PATH = 'funnel-tracker/production.json';
const IMAGE_PREFIX = 'funnel-tracker/production/archives';
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAX_LEGACY_MANIFEST_BYTES = 16 * 1024 * 1024;
const MAX_IMAGE_BYTES = 24 * 1024 * 1024;
const MAX_ARCHIVES = 20000;
const MAX_COMPARISON_RESOURCES = 512;
const MAX_CHANGE_SUMMARY_ITEMS = 50;
const STATUSES = new Set(['baseline', 'current', 'changed', 'needs_connection', 'error']);
const COMPARISON_VERSION = 'semantic-v2';
const COMPARISON_VERSIONS = new Set([
  'semantic-v1',
  COMPARISON_VERSION,
  'corporate-source-v1',
  'bc-public-v1',
  'join-snapshot-v1',
]);
const BINDING_CODES = new Set([
  'ok',
  'binding_check_failed',
  'binding_invalid',
  'classes_mismatch',
  'heading_mismatch',
  'heading_missing',
  'heading_unexpected',
  'id_mismatch',
  'selector_invalid',
  'selector_missing',
  'selector_not_unique',
  'tag_mismatch',
]);
const CUSTOM_FAMILY_VARIANTS = Object.freeze({
  lander: new Set(['g', 'a', 'm']),
  results: new Set(['g', 'a', 'm']),
  bc: new Set(['shared']),
  join: new Set(['paid', 'free']),
  corporate: new Set(['home']),
});

class ProductionStoreUnavailableError extends Error {}
class ProductionStoreConflictError extends Error {}
class InvalidProductionManifestError extends Error {}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validIso(value) {
  return typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));
}

function validId(value) {
  return typeof value === 'string' && value.length >= 1 && value.length <= 180
    && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);
}

function validHash(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function validCommit(value) {
  return value === null || (typeof value === 'string' && /^[a-f0-9]{40}$/.test(value));
}

function validHttpsUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

function validResourceUrl(value) {
  if (!validHttpsUrl(value)) return false;
  const url = new URL(value);
  return !url.port && !url.hash;
}

function validComparisonResource(value) {
  return isPlainObject(value) && Object.keys(value).length === 3
    && ['css', 'font', 'image', 'script'].includes(value.type)
    && validResourceUrl(value.url) && validHash(value.bodySha256);
}

function validComparisonDetails(value) {
  if (!isPlainObject(value) || Object.keys(value).length !== 6
      || !COMPARISON_VERSIONS.has(value.version)
      || !validHash(value.mainHtmlSha256) || !validHash(value.normalizedDomSha256)
      || !validHash(value.inlineCssSha256) || !validHash(value.resourceSetSha256)
      || !Array.isArray(value.resources) || value.resources.length > MAX_COMPARISON_RESOURCES) return false;
  const keys = new Set();
  for (const resource of value.resources) {
    if (!validComparisonResource(resource)) return false;
    const key = `${resource.type}\u0000${resource.url}`;
    if (keys.has(key)) return false;
    keys.add(key);
  }
  return true;
}

function validChangedResource(value) {
  return isPlainObject(value) && Object.keys(value).length === 4
    && ['css', 'font', 'image', 'script'].includes(value.type)
    && validResourceUrl(value.url) && validHash(value.beforeBodySha256)
    && validHash(value.afterBodySha256);
}

function validChangeSummary(value) {
  if (!isPlainObject(value)) return false;
  if (value.diagnosticBaseline === true) return Object.keys(value).length === 1;
  if (Object.keys(value).length !== 12 || value.diagnosticBaseline !== false
      || typeof value.mainHtmlChanged !== 'boolean'
      || typeof value.normalizedDomChanged !== 'boolean'
      || typeof value.inlineCssChanged !== 'boolean'
      || typeof value.resourceSetChanged !== 'boolean'
      || !Number.isSafeInteger(value.resourcesAddedCount) || value.resourcesAddedCount < 0
      || !Number.isSafeInteger(value.resourcesRemovedCount) || value.resourcesRemovedCount < 0
      || !Number.isSafeInteger(value.resourcesChangedCount) || value.resourcesChangedCount < 0
      || typeof value.resourceChangesTruncated !== 'boolean'
      || !Array.isArray(value.resourcesAdded) || value.resourcesAdded.length > MAX_CHANGE_SUMMARY_ITEMS
      || !Array.isArray(value.resourcesRemoved) || value.resourcesRemoved.length > MAX_CHANGE_SUMMARY_ITEMS
      || !Array.isArray(value.resourcesChanged) || value.resourcesChanged.length > MAX_CHANGE_SUMMARY_ITEMS
      || !value.resourcesAdded.every(validComparisonResource)
      || !value.resourcesRemoved.every(validComparisonResource)
      || !value.resourcesChanged.every(validChangedResource)) return false;
  return value.resourcesAddedCount >= value.resourcesAdded.length
    && value.resourcesRemovedCount >= value.resourcesRemoved.length
    && value.resourcesChangedCount >= value.resourcesChanged.length;
}

function validSectionBindings(value) {
  if (!isPlainObject(value)
      || Object.keys(value).sort().join(',') !== 'checkedAt,items,mapped,status,total,unmapped'
      || !['mapped', 'unmapped', 'unavailable'].includes(value.status)
      || !validIso(value.checkedAt)
      || !Number.isSafeInteger(value.total) || value.total < 0 || value.total > 1000
      || !Number.isSafeInteger(value.mapped) || value.mapped < 0
      || !Number.isSafeInteger(value.unmapped) || value.unmapped < 0
      || value.mapped + value.unmapped !== value.total
      || !Array.isArray(value.items) || value.items.length !== value.total) return false;
  if (value.status === 'unavailable') {
    return value.total === 0 && value.mapped === 0 && value.unmapped === 0;
  }
  if (value.status === 'mapped' && (value.total < 1 || value.unmapped !== 0)) return false;
  if (value.status === 'unmapped' && value.unmapped === 0 && value.total !== 0) return false;
  const ids = new Set();
  let mapped = 0;
  for (const item of value.items) {
    if (!isPlainObject(item) || Object.keys(item).sort().join(',') !== 'code,sectionId,status'
        || typeof item.sectionId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/.test(item.sectionId)
        || !['mapped', 'unmapped'].includes(item.status) || !BINDING_CODES.has(item.code)
        || (item.status === 'mapped') !== (item.code === 'ok') || ids.has(item.sectionId)) return false;
    ids.add(item.sectionId);
    if (item.status === 'mapped') mapped += 1;
  }
  return mapped === value.mapped;
}

function validDraftProductionUrl(value) {
  if (!validHttpsUrl(value)) return false;
  const url = new URL(value);
  return url.origin === 'https://zodiac-pages.vercel.app' && !url.port && !url.hash
    && /^\/(?:landers|funnel|site)(?:\/|$)/.test(url.pathname);
}

function validEditor(value) {
  if (!isPlainObject(value) || Object.keys(value).length !== 3) return false;
  return typeof value.sub === 'string' && /^[A-Za-z0-9_-]{6,255}$/.test(value.sub)
    && typeof value.email === 'string' && value.email === value.email.toLowerCase()
    && /^[^@\s]+@zodiac\.fm$/.test(value.email)
    && typeof value.name === 'string' && value.name.length >= 1 && value.name.length <= 120
    && value.name === value.name.trim().replace(/\s+/g, ' ')
    && !/[\u0000-\u001f\u007f]/.test(value.name);
}

function validArchive(value, targetId) {
  const hasComparisonVersion = COMPARISON_VERSIONS.has(value?.comparisonVersion);
  if (!isPlainObject(value) || !validId(value.id) || value.targetId !== targetId
      || !['baseline', 'changed'].includes(value.kind) || !validIso(value.createdAt)
      || !['draft', 'production'].includes(value.stage)
      || !validHttpsUrl(value.sourceUrl) || !validCommit(value.sourceCommit)
      || !(value.sourceResponseAt === null || validIso(value.sourceResponseAt))
      || !(value.sourceFingerprint === null || validHash(value.sourceFingerprint))
      || !validHash(value.renderFingerprint) || !validHash(value.imageSha256)
      || !(value.comparisonVersion === undefined || hasComparisonVersion)
      || (hasComparisonVersion
        ? typeof value.comparisonBaseline !== 'boolean'
        : value.comparisonBaseline !== undefined)
      || !(value.comparisonDetails === undefined || validComparisonDetails(value.comparisonDetails))
      || (value.comparisonDetails !== undefined
        && value.comparisonDetails.version !== value.comparisonVersion)
      || !(value.changeSummary === undefined || validChangeSummary(value.changeSummary))
      || !(value.sectionBindings === undefined || validSectionBindings(value.sectionBindings))
      || !Number.isSafeInteger(value.width) || ![390, 1280].includes(value.width)
      || !Number.isSafeInteger(value.height) || value.height < 1 || value.height > 50000
      || typeof value.blobPath !== 'string'
      || value.blobPath !== `${IMAGE_PREFIX}/${targetId}/${value.id}.png`) return false;
  return true;
}

function validTargetState(value, targetId) {
  const hasComparisonVersion = COMPARISON_VERSIONS.has(value?.comparisonVersion);
  if (!isPlainObject(value) || value.id !== targetId || !STATUSES.has(value.status)
      || !validIso(value.lastCheckedAt)
      || !(value.lastChangedAt === null || validIso(value.lastChangedAt))
      || !(value.lastResponseAt === null || validIso(value.lastResponseAt))
      || !(value.currentArchiveId === null || validId(value.currentArchiveId))
      || !(value.sourceCommit === null || validCommit(value.sourceCommit))
      || !(value.sourceFingerprint === null || validHash(value.sourceFingerprint))
      || !(value.renderFingerprint === null || validHash(value.renderFingerprint))
      || !(value.comparisonVersion === undefined || value.comparisonVersion === null
        || hasComparisonVersion)
      || !(value.comparisonDetails === undefined || value.comparisonDetails === null
        || validComparisonDetails(value.comparisonDetails))
      || (value.comparisonDetails && value.comparisonDetails.version !== value.comparisonVersion)
      || !(value.sectionBindings === undefined || validSectionBindings(value.sectionBindings))
      || !(value.error === null || (isPlainObject(value.error)
        && typeof value.error.code === 'string' && /^[a-z0-9_]{1,80}$/.test(value.error.code)
        && typeof value.error.message === 'string' && value.error.message.length >= 1
        && value.error.message.length <= 500 && validIso(value.error.at)))
      || !Array.isArray(value.archives)) return false;
  const ids = new Set();
  for (const archive of value.archives) {
    if (!validArchive(archive, targetId) || ids.has(archive.id)) return false;
    ids.add(archive.id);
  }
  if ((value.currentArchiveId === null) !== (value.archives.length === 0)) return false;
  if (value.currentArchiveId !== null && !ids.has(value.currentArchiveId)) return false;
  return true;
}

function validCustomTarget(value) {
  if (!isPlainObject(value) || !validId(value.id) || !value.id.startsWith('draft-custom-')
      || typeof value.name !== 'string' || value.name.length < 1 || value.name.length > 120
      || typeof value.family !== 'string' || !CUSTOM_FAMILY_VARIANTS[value.family]?.has(value.variant)
      || !validDraftProductionUrl(value.productionUrl) || value.stage !== 'draft'
      || value.channel !== 'draft' || value.snapshotPath !== null
      || value.sourceRepo !== 'zodiac-fm/zodiac-pages' || value.captureKind !== 'draft'
      || !validIso(value.registeredAt) || !validEditor(value.editor)) return false;
  return true;
}

function createEmptyManifest(now = new Date()) {
  return {
    schema: 1,
    updatedAt: now.toISOString(),
    customTargets: [],
    targets: {},
  };
}

function validateManifest(value) {
  if (!isPlainObject(value) || value.schema !== 1 || !validIso(value.updatedAt)
      || !Array.isArray(value.customTargets) || !isPlainObject(value.targets)) {
    throw new InvalidProductionManifestError('invalid production manifest');
  }
  const customIds = new Set();
  for (const target of value.customTargets) {
    if (!validCustomTarget(target) || customIds.has(target.id)) {
      throw new InvalidProductionManifestError('invalid custom production target');
    }
    customIds.add(target.id);
  }
  let archiveCount = 0;
  for (const [targetId, state] of Object.entries(value.targets)) {
    if (!validId(targetId) || !validTargetState(state, targetId)) {
      throw new InvalidProductionManifestError('invalid production target state');
    }
    archiveCount += state.archives.length;
  }
  if (archiveCount > MAX_ARCHIVES) {
    throw new InvalidProductionManifestError('production manifest has too many archives');
  }
  let encoded;
  try {
    encoded = JSON.stringify(value);
  } catch (error) {
    throw new InvalidProductionManifestError('production manifest cannot be encoded', {cause: error});
  }
  if (Buffer.byteLength(encoded, 'utf8') > MAX_MANIFEST_BYTES) {
    throw new InvalidProductionManifestError('production manifest is too large');
  }
  return value;
}

function blobAuthOptions(environment = process.env) {
  const storeId = environment.FUNNEL_TRACKER_BLOB_STORE_ID;
  const token = environment.FUNNEL_TRACKER_BLOB_READ_WRITE_TOKEN;
  if (typeof storeId === 'string' && /^store_[A-Za-z0-9]+$/.test(storeId)) return {storeId};
  if (typeof token === 'string' && token.length >= 32) return {token};
  throw new ProductionStoreUnavailableError('production storage is not configured');
}

function productionStorageConfigured(environment = process.env) {
  try {
    blobAuthOptions(environment);
    return true;
  } catch {
    return false;
  }
}

function isNotFound(error) {
  return error instanceof BlobNotFoundError || error?.name === 'BlobNotFoundError';
}

function isConflict(error) {
  return error instanceof BlobPreconditionFailedError
    || error?.name === 'BlobPreconditionFailedError';
}

function sameEtag(left, right) {
  return typeof left === 'string' && typeof right === 'string'
    && left.replace(/^W\//, '') === right.replace(/^W\//, '');
}

function createProductionStore({
  getBlob = get,
  headBlob = head,
  putBlob = put,
  environment = process.env,
} = {}) {
  const auth = () => blobAuthOptions(environment);

  async function readExisting() {
    let metadata;
    try {
      metadata = await headBlob(MANIFEST_PATH, auth());
    } catch (error) {
      if (isNotFound(error)) return null;
      throw new ProductionStoreUnavailableError('production manifest is unavailable', {cause: error});
    }
    if (!metadata || typeof metadata.etag !== 'string') {
      throw new ProductionStoreConflictError('production manifest changed while reading');
    }

    let result;
    try {
      result = await getBlob(MANIFEST_PATH, {access: 'private', useCache: false, ...auth()});
    } catch (error) {
      if (isNotFound(error)) throw new ProductionStoreConflictError('production manifest changed while reading', {cause: error});
      throw new ProductionStoreUnavailableError('production manifest is unavailable', {cause: error});
    }
    if (result === null || !result?.stream || !sameEtag(metadata.etag, result.blob?.etag)) {
      throw new ProductionStoreConflictError('production manifest changed while reading');
    }
    let raw;
    try {
      raw = await new Response(result.stream).text();
    } catch (error) {
      throw new ProductionStoreUnavailableError('production manifest is unreadable', {cause: error});
    }
    if (Buffer.byteLength(raw, 'utf8') > MAX_LEGACY_MANIFEST_BYTES) {
      throw new ProductionStoreUnavailableError('production manifest is too large');
    }
    try {
      return {data: validateManifest(JSON.parse(raw)), revision: metadata.etag};
    } catch (error) {
      throw new ProductionStoreUnavailableError('production manifest is invalid', {cause: error});
    }
  }

  async function read({attempts = 3} = {}) {
    if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 10) {
      throw new ProductionStoreUnavailableError('invalid production read attempt count');
    }
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const existing = await readExisting();
        return existing || {data: createEmptyManifest(), revision: null};
      } catch (error) {
        if (!(error instanceof ProductionStoreConflictError) || attempt === attempts - 1) throw error;
      }
    }
    throw new ProductionStoreConflictError('production manifest changed repeatedly while reading');
  }

  async function write(data, revision) {
    validateManifest(data);
    const body = JSON.stringify(data);
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
      await putBlob(MANIFEST_PATH, body, options);
    } catch (error) {
      if (error instanceof ProductionStoreUnavailableError) throw error;
      if (isConflict(error)) throw new ProductionStoreConflictError('production manifest changed', {cause: error});
      if (revision === null) {
        try {
          const current = await read();
          if (current.revision !== null) {
            throw new ProductionStoreConflictError('production manifest was created concurrently', {cause: error});
          }
        } catch (readError) {
          if (readError instanceof ProductionStoreConflictError) throw readError;
        }
      }
      throw new ProductionStoreUnavailableError('production manifest write failed', {cause: error});
    }
    try {
      const stored = await read();
      if (stored.revision === null) {
        throw new ProductionStoreUnavailableError('production manifest write was not confirmed');
      }
      return stored;
    } catch (error) {
      if (error instanceof ProductionStoreUnavailableError
          && error.message === 'production manifest write was not confirmed') throw error;
      throw new ProductionStoreUnavailableError('production manifest write could not be confirmed', {cause: error});
    }
  }

  async function mutate(mutator, {attempts = 5} = {}) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const current = await read();
      const draft = JSON.parse(JSON.stringify(current.data));
      const next = await mutator(draft, current);
      validateManifest(next);
      try {
        return await write(next, current.revision);
      } catch (error) {
        if (!(error instanceof ProductionStoreConflictError) || attempt === attempts - 1) throw error;
      }
    }
    throw new ProductionStoreConflictError('production manifest changed repeatedly');
  }

  async function putImage(targetId, archiveId, image) {
    if (!validId(targetId) || !validId(archiveId) || !Buffer.isBuffer(image)
        || image.length < 8 || image.length > MAX_IMAGE_BYTES
        || !image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      throw new ProductionStoreUnavailableError('invalid production image');
    }
    const blobPath = `${IMAGE_PREFIX}/${targetId}/${archiveId}.png`;
    try {
      await putBlob(blobPath, image, {
        access: 'private',
        allowOverwrite: false,
        addRandomSuffix: false,
        contentType: 'image/png',
        cacheControlMaxAge: 31536000,
        ...auth(),
      });
    } catch (error) {
      throw new ProductionStoreUnavailableError('production image write failed', {cause: error});
    }
    return blobPath;
  }

  async function readImage(blobPath) {
    if (typeof blobPath !== 'string'
        || !new RegExp(`^${IMAGE_PREFIX.replaceAll('/', '\\/')}\/[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*\\.png$`).test(blobPath)) {
      throw new ProductionStoreUnavailableError('invalid production image path');
    }
    try {
      const result = await getBlob(blobPath, {access: 'private', useCache: false, ...auth()});
      return result && result.stream ? result : null;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw new ProductionStoreUnavailableError('production image is unavailable', {cause: error});
    }
  }

  return {read, write, mutate, putImage, readImage};
}

module.exports = {
  COMPARISON_VERSION,
  IMAGE_PREFIX,
  MANIFEST_PATH,
  MAX_LEGACY_MANIFEST_BYTES,
  MAX_MANIFEST_BYTES,
  MAX_IMAGE_BYTES,
  InvalidProductionManifestError,
  ProductionStoreConflictError,
  ProductionStoreUnavailableError,
  createEmptyManifest,
  createProductionStore,
  productionStore: createProductionStore(),
  productionStorageConfigured,
  sameEtag,
  validChangeSummary,
  validComparisonDetails,
  validSectionBindings,
  validateManifest,
};
