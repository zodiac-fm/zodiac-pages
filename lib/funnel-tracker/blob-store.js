const {
  BlobNotFoundError,
  BlobPreconditionFailedError,
  get,
  head,
  put,
} = require('@vercel/blob');
const {MAX_STORE_BYTES, InvalidStateError, validateState} = require('./state');

const STORE_PATH = 'funnel-tracker/state.json';

class StoreUnavailableError extends Error {}
class StoreConflictError extends Error {}

function blobAuthOptions(environment = process.env) {
  const storeId = environment.FUNNEL_TRACKER_BLOB_STORE_ID;
  const token = environment.FUNNEL_TRACKER_BLOB_READ_WRITE_TOKEN;
  if (typeof storeId === 'string' && /^store_[A-Za-z0-9]+$/.test(storeId)) return {storeId};
  if (typeof token === 'string' && token.length >= 32) return {token};
  throw new StoreUnavailableError('tracker storage is not configured');
}

function storageConfigured(environment = process.env) {
  const storeId = environment.FUNNEL_TRACKER_BLOB_STORE_ID;
  const token = environment.FUNNEL_TRACKER_BLOB_READ_WRITE_TOKEN;
  return (typeof storeId === 'string' && /^store_[A-Za-z0-9]+$/.test(storeId))
    || (typeof token === 'string' && token.length >= 32);
}

function sameEtag(left, right) {
  return typeof left === 'string' && typeof right === 'string'
    && left.replace(/^W\//, '') === right.replace(/^W\//, '');
}

function createBlobStore({
  getBlob = get,
  headBlob = head,
  putBlob = put,
} = {}) {
  async function readExisting() {
    let metadata;
    try {
      metadata = await headBlob(STORE_PATH, blobAuthOptions());
    } catch (error) {
      if (error instanceof BlobNotFoundError || error?.name === 'BlobNotFoundError') return null;
      throw new StoreUnavailableError('tracker store unavailable', {cause: error});
    }

    let result;
    try {
      result = await getBlob(STORE_PATH, {
        access: 'private',
        useCache: false,
        ...blobAuthOptions(),
      });
    } catch (error) {
      throw new StoreUnavailableError('tracker store unavailable', {cause: error});
    }
    if (result === null) throw new StoreConflictError('tracker store changed while reading');
    if (!result?.stream || !sameEtag(metadata?.etag, result.blob?.etag)) {
      throw new StoreConflictError('tracker store changed while reading');
    }

    let raw;
    try {
      raw = await new Response(result.stream).text();
    } catch (error) {
      throw new StoreUnavailableError('tracker store unreadable', {cause: error});
    }
    if (Buffer.byteLength(raw, 'utf8') > MAX_STORE_BYTES) {
      throw new StoreUnavailableError('tracker store is too large');
    }

    let data;
    try {
      data = JSON.parse(raw);
      validateState(data);
    } catch (error) {
      const cause = error instanceof InvalidStateError ? error : new InvalidStateError('invalid JSON');
      throw new StoreUnavailableError('tracker store is invalid', {cause});
    }
    return {data, revision: metadata.etag};
  }

  return {
    async read() {
      const existing = await readExisting();
      if (existing) return existing;
      throw new StoreUnavailableError('tracker store is not initialized');
    },

    async write(data, revision) {
      validateState(data);
      try {
        await putBlob(STORE_PATH, `${JSON.stringify(data, null, 2)}\n`, {
          access: 'private',
          allowOverwrite: true,
          addRandomSuffix: false,
          ifMatch: revision,
          contentType: 'application/json',
          cacheControlMaxAge: 60,
          ...blobAuthOptions(),
        });
      } catch (error) {
        if (error instanceof BlobPreconditionFailedError
            || error?.name === 'BlobPreconditionFailedError') {
          throw new StoreConflictError('tracker store changed', {cause: error});
        }
        throw new StoreUnavailableError('tracker store unavailable', {cause: error});
      }
      const stored = await readExisting();
      if (!stored) throw new StoreUnavailableError('tracker store unavailable after write');
      return stored;
    },
  };
}

module.exports = {
  STORE_PATH,
  StoreConflictError,
  StoreUnavailableError,
  createBlobStore,
  blobStore: createBlobStore(),
  storageConfigured,
};
