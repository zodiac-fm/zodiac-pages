const {randomUUID} = require('node:crypto');

const MAX_STORE_BYTES = 5 * 1024 * 1024;
const MAX_PAYLOAD_BYTES = 48 * 1024;
const MAX_EVENTS = 20000;
const REPOSITORY_REF_STATUS = 'client-supplied-unverified';

class InvalidStateError extends Error {}
class InvalidMutationError extends Error {
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

function validIdentifier(value, maxLength = 160) {
  return typeof value === 'string' && value.length >= 1 && value.length <= maxLength
    && /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value);
}

function normalizedEditor(value) {
  if (!isPlainObject(value)) return null;
  const sub = typeof value.sub === 'string' ? value.sub.trim() : '';
  const email = typeof value.email === 'string' ? value.email.trim().toLowerCase() : '';
  const name = typeof value.name === 'string' ? value.name.trim().replace(/\s+/g, ' ') : '';
  if (!/^[A-Za-z0-9_-]{6,255}$/.test(sub)
      || email.length > 254 || !/^[^@\s]+@zodiac\.fm$/.test(email)
      || name.length < 1 || name.length > 120
      || /[\u0000-\u001f\u007f]/.test(name)) return null;
  return {sub, email, name};
}

function validRecordedEditor(editor, author) {
  const normalized = normalizedEditor(editor);
  return normalized !== null
    && Object.keys(editor).length === 3
    && normalized.sub === editor.sub
    && normalized.email === editor.email
    && normalized.name === editor.name
    && author === normalized.email;
}

function normalizedRepositoryRef(value) {
  if (!isPlainObject(value)) return null;
  const keys = Object.keys(value).sort();
  const expectedKeys = value.path === undefined
    ? ['commit', 'repository']
    : ['commit', 'path', 'repository'];
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    return null;
  }
  if (typeof value.repository !== 'string'
      || !/^zodiac-fm\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(value.repository)
      || value.repository.endsWith('.') || value.repository.endsWith('.git')
      || typeof value.commit !== 'string' || !/^[A-Fa-f0-9]{40}$/.test(value.commit)) {
    return null;
  }
  const reference = {
    repository: value.repository,
    commit: value.commit.toLowerCase(),
  };
  if (value.path !== undefined) {
    if (typeof value.path !== 'string' || value.path.length < 1 || value.path.length > 1024
        || value.path.startsWith('/') || value.path.includes('\\')
        || /[\u0000-\u001f\u007f]/.test(value.path)
        || value.path.split('/').some((part) => !part || part === '.' || part === '..')) {
      return null;
    }
    reference.path = value.path;
  }
  return reference;
}

function validRecordedRepositoryRef(record) {
  if (record.repositoryRef === undefined) return record.repositoryRefStatus === undefined;
  const normalized = normalizedRepositoryRef(record.repositoryRef);
  return normalized !== null
    && normalized.repository === record.repositoryRef.repository
    && normalized.commit === record.repositoryRef.commit
    && normalized.path === record.repositoryRef.path
    && record.repositoryRefStatus === REPOSITORY_REF_STATUS;
}

function validateSafeJson(value, depth = 0) {
  if (depth > 5) return false;
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') {
    return value.length <= 30000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
  }
  if (Array.isArray(value)) {
    return value.length <= 100 && value.every((item) => validateSafeJson(item, depth + 1));
  }
  if (!isPlainObject(value) || Object.keys(value).length > 100) return false;
  return Object.entries(value).every(([key, item]) => (
    key.length >= 1 && key.length <= 80
      && !['__proto__', 'prototype', 'constructor'].includes(key)
      && /^[A-Za-z][A-Za-z0-9_-]*$/.test(key)
      && validateSafeJson(item, depth + 1)
  ));
}

function validSchema(value) {
  return (Number.isSafeInteger(value) && value >= 1)
    || (typeof value === 'string' && value.length >= 1 && value.length <= 80);
}

function validateState(data) {
  if (!isPlainObject(data) || !validSchema(data.schema)
      || !Array.isArray(data.sections) || !Array.isArray(data.events)
      || data.events.length > MAX_EVENTS) {
    throw new InvalidStateError('invalid tracker state');
  }

  const sectionIds = new Set();
  const versionIds = new Set();
  const versionOwners = new Map();
  const versionsById = new Map();
  for (const section of data.sections) {
    if (!isPlainObject(section) || !validIdentifier(section.id) || sectionIds.has(section.id)
        || !Array.isArray(section.versions) || section.versions.length < 1
        || !(section.live === null || isPlainObject(section.live))) {
      throw new InvalidStateError('invalid tracker sections');
    }
    sectionIds.add(section.id);
    let priorNumber = 0;
    for (const version of section.versions) {
      if (!isPlainObject(version) || !validIdentifier(version.id) || versionIds.has(version.id)
          || !Number.isSafeInteger(version.number) || version.number !== priorNumber + 1
          || typeof version.createdAt !== 'string' || !Number.isFinite(Date.parse(version.createdAt))
          || typeof version.author !== 'string' || version.author.length < 1 || version.author.length > 254
          || typeof version.summary !== 'string' || version.summary.length < 1 || version.summary.length > 500
          || typeof version.content !== 'string' || version.content.length < 1 || version.content.length > 24000
          || !(version.previewUrl === null || validHttpsUrl(version.previewUrl))) {
        throw new InvalidStateError('invalid tracker versions');
      }
      if (version.editor !== undefined && !validRecordedEditor(version.editor, version.author)) {
        throw new InvalidStateError('invalid tracker version editor');
      }
      if (!validRecordedRepositoryRef(version)) {
        throw new InvalidStateError('invalid tracker version repository reference');
      }
      versionIds.add(version.id);
      versionOwners.set(version.id, section.id);
      versionsById.set(version.id, version);
      priorNumber = version.number;
    }
    if (section.live !== null) {
      const live = section.live;
      if (!validIdentifier(live.versionId) || !section.versions.some((version) => version.id === live.versionId)
          || !validDate(live.liveAt) || !validHttpsUrl(live.productionUrl)
          || typeof live.note !== 'string' || live.note.length < 1 || live.note.length > 2000
          || typeof live.author !== 'string' || live.author.length < 1 || live.author.length > 254
          || typeof live.recordedAt !== 'string' || !Number.isFinite(Date.parse(live.recordedAt))) {
        throw new InvalidStateError('invalid tracker live confirmation');
      }
      if (live.editor !== undefined && !validRecordedEditor(live.editor, live.author)) {
        throw new InvalidStateError('invalid tracker live editor');
      }
    }
  }

  const eventIds = new Set();
  for (const event of data.events) {
    if (!isPlainObject(event) || !validIdentifier(event.id)
        || !['revision', 'live'].includes(event.type)
        || !sectionIds.has(event.sectionId) || eventIds.has(event.id)
        || typeof event.createdAt !== 'string' || !Number.isFinite(Date.parse(event.createdAt))
        || typeof event.author !== 'string' || event.author.length < 1 || event.author.length > 254
        || typeof event.summary !== 'string' || event.summary.length < 1 || event.summary.length > 2000
        || !validIdentifier(event.versionId) || !versionIds.has(event.versionId)
        || versionOwners.get(event.versionId) !== event.sectionId) {
      throw new InvalidStateError('invalid tracker events');
    }
    if (event.editor !== undefined && !validRecordedEditor(event.editor, event.author)) {
      throw new InvalidStateError('invalid tracker event editor');
    }
    if (!validRecordedRepositoryRef(event)) {
      throw new InvalidStateError('invalid tracker event repository reference');
    }
    if (event.type === 'live') {
      if (!isPlainObject(event.production)
          || !validDate(event.production.liveAt)
          || !validProductionUrl(event.production.productionUrl)
          || typeof event.production.note !== 'string'
          || event.production.note.length < 1 || event.production.note.length > 2000) {
        throw new InvalidStateError('invalid tracker live event');
      }
    } else if (event.production !== undefined) {
      throw new InvalidStateError('invalid tracker revision event');
    }
    if (event.type === 'live' && event.repositoryRef !== undefined) {
      throw new InvalidStateError('invalid tracker live repository reference');
    }
    if (event.type === 'revision') {
      const version = versionsById.get(event.versionId);
      const eventRef = event.repositoryRef;
      const versionRef = version.repositoryRef;
      if ((eventRef === undefined) !== (versionRef === undefined)
          || (eventRef !== undefined && (
            eventRef.repository !== versionRef.repository
            || eventRef.commit !== versionRef.commit
            || eventRef.path !== versionRef.path
          ))
          || event.repositoryRefStatus !== version.repositoryRefStatus) {
        throw new InvalidStateError('mismatched tracker repository reference');
      }
    }
    eventIds.add(event.id);
  }

  let encoded;
  try {
    encoded = JSON.stringify(data);
  } catch (error) {
    throw new InvalidStateError('tracker state cannot be encoded', {cause: error});
  }
  if (Buffer.byteLength(encoded, 'utf8') > MAX_STORE_BYTES) {
    throw new InvalidStateError('tracker state is too large');
  }
  return data;
}

function normalizedPayload(value) {
  if (!isPlainObject(value) || !validateSafeJson(value)) {
    throw new InvalidMutationError('invalid_payload');
  }
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_PAYLOAD_BYTES) {
    throw new InvalidMutationError('payload_too_large');
  }
  return JSON.parse(serialized);
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

function validProductionUrl(value) {
  if (!validHttpsUrl(value)) return false;
  const hostname = new URL(value).hostname.toLowerCase();
  if (!(hostname === 'zodiac.fm' || hostname.endsWith('.zodiac.fm'))) return false;
  const nonProductionLabels = new Set(['staging', 'dev', 'development', 'preview', 'test']);
  return !hostname.split('.').some((label) => nonProductionLabels.has(label));
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function applyMutation(data, {
  action,
  sectionId,
  payload,
  editor,
  now = new Date(),
  createId = randomUUID,
}) {
  validateState(data);
  const verifiedEditor = normalizedEditor(editor);
  if (!['revision', 'live'].includes(action) || !validIdentifier(sectionId)) {
    throw new InvalidMutationError('invalid_request');
  }
  if (!verifiedEditor) throw new InvalidMutationError('invalid_editor');
  if (!data.sections.some((section) => section.id === sectionId)) {
    throw new InvalidMutationError('unknown_section');
  }
  if (data.events.length >= MAX_EVENTS) {
    throw new InvalidMutationError('event_limit_reached');
  }

  const cleanPayload = normalizedPayload(payload);
  const sectionIndex = data.sections.findIndex((section) => section.id === sectionId);
  const section = data.sections[sectionIndex];
  const createdAt = now.toISOString();
  let version;
  if (action === 'revision') {
    if (typeof cleanPayload.summary !== 'string' || cleanPayload.summary.trim().length < 1) {
      throw new InvalidMutationError('revision_summary_required');
    }
    cleanPayload.summary = cleanPayload.summary.trim();
    if (cleanPayload.previewUrl !== undefined && !validHttpsUrl(cleanPayload.previewUrl)) {
      throw new InvalidMutationError('invalid_preview_url');
    }
    if (typeof cleanPayload.content !== 'string' || cleanPayload.content.trim().length < 1
        || cleanPayload.content.length > 24000) {
      throw new InvalidMutationError('revision_content_required');
    }
    if (!validHttpsUrl(cleanPayload.previewUrl)) {
      throw new InvalidMutationError('invalid_preview_url');
    }
    const repositoryRef = cleanPayload.repositoryRef === undefined
      ? null
      : normalizedRepositoryRef(cleanPayload.repositoryRef);
    if (cleanPayload.repositoryRef !== undefined && !repositoryRef) {
      throw new InvalidMutationError('invalid_repository_ref');
    }
    const number = section.versions.length + 1;
    const preferredId = `${sectionId.toLowerCase()}-v${number}`;
    const versionId = data.sections.some((candidate) => (
      candidate.versions.some((item) => item.id === preferredId)
    )) ? `v_${createId()}` : preferredId;
    version = {
      id: versionId,
      number,
      createdAt,
      author: verifiedEditor.email,
      editor: verifiedEditor,
      summary: cleanPayload.summary,
      content: cleanPayload.content.trim(),
      previewUrl: cleanPayload.previewUrl,
      source: 'Tracker',
      state: 'draft',
      ...(repositoryRef ? {
        repositoryRef,
        repositoryRefStatus: REPOSITORY_REF_STATUS,
      } : {}),
    };
  }

  if (action === 'live') {
    if (cleanPayload.confirmed !== true) {
      throw new InvalidMutationError('live_confirmation_required');
    }
    if (!validIdentifier(cleanPayload.versionId)) {
      throw new InvalidMutationError('version_id_required');
    }
    version = section.versions.find((item) => item.id === cleanPayload.versionId);
    if (!version) throw new InvalidMutationError('unknown_version');
    if (!validProductionUrl(cleanPayload.productionUrl)) {
      throw new InvalidMutationError('invalid_production_url');
    }
    if (!validDate(cleanPayload.liveAt)) {
      throw new InvalidMutationError('invalid_live_date');
    }
    const currentDate = now.toISOString().slice(0, 10);
    if (cleanPayload.liveAt > currentDate) throw new InvalidMutationError('future_live_date');
    if (typeof cleanPayload.note !== 'string' || cleanPayload.note.trim().length < 1
        || cleanPayload.note.length > 2000) {
      throw new InvalidMutationError('live_note_required');
    }
  }

  const event = {
    id: `evt_${createId()}`,
    type: action,
    sectionId,
    createdAt,
    author: verifiedEditor.email,
    editor: verifiedEditor,
    summary: action === 'revision' ? version.summary : cleanPayload.note.trim(),
    versionId: version.id,
    ...(action === 'live' ? {
      production: {
        liveAt: cleanPayload.liveAt,
        productionUrl: cleanPayload.productionUrl,
        note: cleanPayload.note.trim(),
      },
    } : (version.repositoryRef ? {
      repositoryRef: version.repositoryRef,
      repositoryRefStatus: REPOSITORY_REF_STATUS,
    } : {})),
  };
  const nextSection = action === 'revision'
    ? {...section, versions: [...section.versions, version]}
    : {
        ...section,
        live: {
          versionId: version.id,
          liveAt: cleanPayload.liveAt,
          productionUrl: cleanPayload.productionUrl,
          note: cleanPayload.note.trim(),
          author: verifiedEditor.email,
          editor: verifiedEditor,
          recordedAt: createdAt,
        },
      };
  const nextSections = [...data.sections];
  nextSections[sectionIndex] = nextSection;
  const next = {
    ...data,
    updatedAt: createdAt,
    sections: nextSections,
    events: [...data.events, event],
  };
  validateState(next);
  return {data: next, event};
}

module.exports = {
  InvalidMutationError,
  InvalidStateError,
  MAX_STORE_BYTES,
  REPOSITORY_REF_STATUS,
  applyMutation,
  validateState,
};
