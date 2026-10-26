'use strict';

const {randomUUID} = require('node:crypto');
const {BlobNotFoundError, BlobPreconditionFailedError, get, head, put} = require('@vercel/blob');
const {validPageKey} = require('./draft-store');

const WORK_MANIFEST_PATH = 'funnel-tracker/review/linear-work.json';
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_ENTRIES = 500;

class WorkStoreUnavailableError extends Error {}
class WorkStoreConflictError extends Error {}
class InvalidWorkDataError extends Error {}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validIso(value) {
  return typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));
}

function normalizedText(value, min, max) {
  if (typeof value !== 'string') return null;
  const result = value.trim().replace(/\s+/g, ' ');
  return result.length >= min && result.length <= max && !/[\u0000-\u001f\u007f]/.test(result) ? result : null;
}

function validEditor(value) {
  return isPlainObject(value) && Object.keys(value).length === 3
    && typeof value.sub === 'string' && /^[A-Za-z0-9_-]{6,255}$/.test(value.sub)
    && typeof value.email === 'string' && value.email === value.email.toLowerCase()
    && /^[^@\s]+@zodiac\.fm$/.test(value.email)
    && normalizedText(value.name, 1, 120) === value.name;
}

function validIssueId(value) {
  return typeof value === 'string' && /^(?:ZFM|ENG)-[1-9][0-9]*$/.test(value);
}

function validIssueUrl(value, issueId) {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.origin === 'https://linear.app'
      && !url.username && !url.password && !url.port && !url.hash
      && new RegExp(`^/zodiacfm/issue/${issueId.toLowerCase()}/[a-z0-9-]{1,240}$`).test(url.pathname.toLowerCase());
  } catch {
    return false;
  }
}

function validWorkId(value) {
  return typeof value === 'string' && /^work_[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(value);
}

function validPageKeys(value) {
  return Array.isArray(value) && value.length >= 1 && value.length <= 20
    && value.every(validPageKey) && new Set(value).size === value.length;
}

function validEntry(value) {
  if (!isPlainObject(value) || Object.keys(value).sort().join(',')
      !== 'assignee,checkedAt,editor,id,issueId,issueUrl,linkedAt,note,pageKeys,status,title') return false;
  return validWorkId(value.id) && validPageKeys(value.pageKeys)
    && validIssueId(value.issueId) && validIssueUrl(value.issueUrl, value.issueId)
    && normalizedText(value.title, 1, 200) === value.title
    && normalizedText(value.status, 1, 100) === value.status
    && (value.assignee === null || normalizedText(value.assignee, 1, 120) === value.assignee)
    && validIso(value.checkedAt)
    && (value.note === null || normalizedText(value.note, 1, 2000) === value.note)
    && validIso(value.linkedAt) && validEditor(value.editor);
}

function createEmptyWorkManifest(now = new Date()) {
  return {schema: 1, updatedAt: now.toISOString(), entries: []};
}

function validateWorkManifest(value) {
  if (!isPlainObject(value) || Object.keys(value).sort().join(',') !== 'entries,schema,updatedAt'
      || value.schema !== 1 || !validIso(value.updatedAt) || !Array.isArray(value.entries)
      || value.entries.length > MAX_ENTRIES) throw new InvalidWorkDataError('invalid work manifest');
  const issues = new Set();
  for (const entry of value.entries) {
    if (!validEntry(entry) || issues.has(entry.issueId)) throw new InvalidWorkDataError('invalid work entry');
    issues.add(entry.issueId);
  }
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_MANIFEST_BYTES) {
    throw new InvalidWorkDataError('work manifest is too large');
  }
  return value;
}

function authOptions(environment = process.env) {
  const storeId = environment.FUNNEL_TRACKER_BLOB_STORE_ID;
  const token = environment.FUNNEL_TRACKER_BLOB_READ_WRITE_TOKEN;
  if (typeof storeId === 'string' && /^store_[A-Za-z0-9]+$/.test(storeId)) return {storeId};
  if (typeof token === 'string' && token.length >= 32) return {token};
  throw new WorkStoreUnavailableError('work storage is not configured');
}

function isNotFound(error) { return error instanceof BlobNotFoundError || error?.name === 'BlobNotFoundError'; }
function isConflict(error) { return error instanceof BlobPreconditionFailedError || error?.name === 'BlobPreconditionFailedError'; }
function sameEtag(left, right) { return typeof left === 'string' && typeof right === 'string' && left.replace(/^W\//, '') === right.replace(/^W\//, ''); }

function normalizedPayload(payload) {
  if (!isPlainObject(payload) || !validPageKeys(payload.pageKeys) || !validIssueId(payload.issueId)
      || !validIssueUrl(payload.issueUrl, payload.issueId)) throw new InvalidWorkDataError('invalid work link');
  const title = normalizedText(payload.title, 1, 200);
  const status = normalizedText(payload.status, 1, 100);
  const assignee = payload.assignee === null || payload.assignee === undefined ? null : normalizedText(payload.assignee, 1, 120);
  const note = payload.note === null || payload.note === undefined || payload.note === '' ? null : normalizedText(payload.note, 1, 2000);
  if (!title || !status || (payload.assignee !== null && payload.assignee !== undefined && !assignee)
      || (payload.note !== null && payload.note !== undefined && payload.note !== '' && !note)) {
    throw new InvalidWorkDataError('invalid work link');
  }
  const checkedAt = payload.checkedAt === undefined ? new Date().toISOString() : payload.checkedAt;
  if (!validIso(checkedAt)) throw new InvalidWorkDataError('invalid work link');
  return {pageKeys: [...payload.pageKeys], issueId: payload.issueId, issueUrl: payload.issueUrl, title, status, assignee, checkedAt, note};
}

function createWorkStore({getBlob = get, headBlob = head, putBlob = put, environment = process.env} = {}) {
  const auth = () => authOptions(environment);

  async function readExisting() {
    let metadata;
    try { metadata = await headBlob(WORK_MANIFEST_PATH, auth()); }
    catch (error) {
      if (isNotFound(error)) return null;
      throw new WorkStoreUnavailableError('work manifest is unavailable', {cause: error});
    }
    if (!metadata || typeof metadata.etag !== 'string') throw new WorkStoreConflictError('work manifest changed while reading');
    let result;
    try { result = await getBlob(WORK_MANIFEST_PATH, {access: 'private', useCache: false, ...auth()}); }
    catch (error) {
      if (isNotFound(error)) throw new WorkStoreConflictError('work manifest changed while reading', {cause: error});
      throw new WorkStoreUnavailableError('work manifest is unavailable', {cause: error});
    }
    if (!result?.stream || !sameEtag(metadata.etag, result.blob?.etag)) throw new WorkStoreConflictError('work manifest changed while reading');
    let raw;
    try { raw = await new Response(result.stream).text(); }
    catch (error) { throw new WorkStoreUnavailableError('work manifest is unreadable', {cause: error}); }
    if (Buffer.byteLength(raw, 'utf8') > MAX_MANIFEST_BYTES) throw new WorkStoreUnavailableError('work manifest is too large');
    try { return {data: validateWorkManifest(JSON.parse(raw)), revision: metadata.etag}; }
    catch (error) { throw new WorkStoreUnavailableError('work manifest is invalid', {cause: error}); }
  }

  async function read({attempts = 3} = {}) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try { return await readExisting() || {data: createEmptyWorkManifest(), revision: null}; }
      catch (error) { if (!(error instanceof WorkStoreConflictError) || attempt === attempts - 1) throw error; }
    }
    throw new WorkStoreConflictError('work manifest changed repeatedly while reading');
  }

  async function write(data, revision) {
    validateWorkManifest(data);
    const options = {access: 'private', addRandomSuffix: false, contentType: 'application/json', cacheControlMaxAge: 60, ...auth()};
    if (revision === null) options.allowOverwrite = false;
    else { options.allowOverwrite = true; options.ifMatch = revision; }
    try { await putBlob(WORK_MANIFEST_PATH, `${JSON.stringify(data, null, 2)}\n`, options); }
    catch (error) {
      if (isConflict(error)) throw new WorkStoreConflictError('work manifest changed', {cause: error});
      throw new WorkStoreUnavailableError('work manifest write failed', {cause: error});
    }
    return read();
  }

  async function mutate(mutator, {attempts = 5} = {}) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const current = await read();
      const next = await mutator(structuredClone(current.data), current);
      try { return await write(next, current.revision); }
      catch (error) { if (!(error instanceof WorkStoreConflictError) || attempt === attempts - 1) throw error; }
    }
    throw new WorkStoreConflictError('work manifest changed repeatedly');
  }

  async function upsert(payload, editor, expectedRevision = undefined) {
    if (!validEditor(editor)) throw new InvalidWorkDataError('invalid work editor');
    const input = normalizedPayload(payload);
    const stored = await mutate((manifest, current) => {
      if (expectedRevision !== undefined && expectedRevision !== current.revision) {
        throw new WorkStoreConflictError('work manifest revision changed');
      }
      const index = manifest.entries.findIndex(entry => entry.issueId === input.issueId);
      if (index === -1) {
        if (manifest.entries.length >= MAX_ENTRIES) throw new InvalidWorkDataError('work entry limit reached');
        manifest.entries.push({id: `work_${randomUUID()}`, ...input, linkedAt: new Date().toISOString(), editor: structuredClone(editor)});
      } else {
        const original = manifest.entries[index];
        manifest.entries[index] = {...original, ...input};
      }
      manifest.updatedAt = new Date().toISOString();
      return manifest;
    });
    return {entry: stored.data.entries.find(entry => entry.issueId === input.issueId), revision: stored.revision};
  }

  async function list({pageKey = null} = {}) {
    if (pageKey !== null && !validPageKey(pageKey)) throw new InvalidWorkDataError('invalid work page key');
    const current = await read();
    return {entries: current.data.entries.filter(entry => !pageKey || entry.pageKeys.includes(pageKey)), revision: current.revision};
  }

  return {read, write, mutate, upsert, list};
}

module.exports = {
  WORK_MANIFEST_PATH,
  InvalidWorkDataError,
  WorkStoreConflictError,
  WorkStoreUnavailableError,
  createEmptyWorkManifest,
  createWorkStore,
  validateWorkManifest,
  validEntry,
  validIssueId,
  validIssueUrl,
  workStore: createWorkStore(),
};
