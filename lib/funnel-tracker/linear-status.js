'use strict';

const {validIssueId, validIssueUrl} = require('./work-store');

const LINEAR_ENDPOINT = 'https://api.linear.app/graphql';
const MAX_ISSUES = 500;
const BATCH_SIZE = 25;
const WORKFLOW_TYPES = new Set(['triage', 'backlog', 'unstarted', 'started', 'completed', 'canceled']);

function cleanText(value, max) {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim().replace(/\s+/g, ' ');
  return cleaned && cleaned.length <= max && !/[\u0000-\u001f\u007f]/.test(cleaned) ? cleaned : null;
}

function validDateOrNull(value) {
  return value === null || (typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value)));
}

function validAssociation(entry) {
  return entry && validIssueId(entry.issueId) && validIssueUrl(entry.issueUrl, entry.issueId)
    && Array.isArray(entry.pageKeys) && entry.pageKeys.length >= 1;
}

function queryFor(count) {
  const variables = Array.from({length: count}, (_, index) => `$id${index}: String!`).join(', ');
  const fields = Array.from({length: count}, (_, index) => (
    `issue${index}: issue(id: $id${index}) { identifier title url archivedAt completedAt canceledAt state { name type } assignee { name } }`
  )).join('\n');
  return `query FunnelTrackerIssues(${variables}) {\n${fields}\n}`;
}

function issueFromResponse(raw, association, checkedAt) {
  if (!raw || raw.identifier !== association.issueId || !validIssueId(raw.identifier)) return null;
  const title = cleanText(raw.title, 200);
  const status = cleanText(raw.state?.name, 100);
  const stateType = raw.state?.type;
  const assignee = raw.assignee === null ? null : cleanText(raw.assignee?.name, 120);
  if (!title || !status || !WORKFLOW_TYPES.has(stateType) || assignee === null && raw.assignee !== null
      || !validIssueUrl(raw.url, raw.identifier) || !validDateOrNull(raw.archivedAt)
      || !validDateOrNull(raw.completedAt) || !validDateOrNull(raw.canceledAt)) return null;
  const active = !raw.archivedAt && !raw.completedAt && !raw.canceledAt
    && stateType !== 'completed' && stateType !== 'canceled';
  return {active, entry: {
    issueId: raw.identifier,
    issueUrl: raw.url,
    title,
    status,
    assignee,
    checkedAt,
    pageKeys: [...association.pageKeys],
  }};
}

function createLinearStatusResolver({
  fetchImpl = globalThis.fetch,
  environment = process.env,
  now = () => new Date(),
  timeoutMs = 8000,
} = {}) {
  async function resolve(associations) {
    if (!Array.isArray(associations) || associations.length > MAX_ISSUES
        || !associations.every(validAssociation)) return {entries: [], connection: 'unavailable'};
    const apiKey = environment.FUNNEL_TRACKER_LINEAR_API_KEY;
    if (typeof apiKey !== 'string' || apiKey.trim().length < 20) {
      return {entries: [], connection: 'not_configured'};
    }
    if (!associations.length) return {entries: [], connection: 'current', checkedAt: now().toISOString()};
    if (typeof fetchImpl !== 'function') return {entries: [], connection: 'unavailable'};
    const checkedAt = now().toISOString();
    const resolved = [];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      for (let offset = 0; offset < associations.length; offset += BATCH_SIZE) {
        const batch = associations.slice(offset, offset + BATCH_SIZE);
        const response = await fetchImpl(LINEAR_ENDPOINT, {
          method: 'POST',
          headers: {'Authorization': apiKey.trim(), 'Content-Type': 'application/json'},
          body: JSON.stringify({
            query: queryFor(batch.length),
            variables: Object.fromEntries(batch.map((entry, index) => [`id${index}`, entry.issueId])),
          }),
          signal: controller.signal,
        });
        if (!response?.ok) throw new Error('linear request failed');
        const body = await response.json();
        if (!body || !body.data || (Array.isArray(body.errors) && body.errors.length)) throw new Error('linear response failed');
        for (let index = 0; index < batch.length; index += 1) {
          const issue = issueFromResponse(body.data[`issue${index}`], batch[index], checkedAt);
          if (!issue) throw new Error('linear response invalid');
          if (issue.active) resolved.push(issue.entry);
        }
      }
      return {entries: resolved, connection: 'current', checkedAt};
    } catch {
      return {entries: [], connection: 'unavailable'};
    } finally { clearTimeout(timer); }
  }

  return {resolve};
}

module.exports = {
  BATCH_SIZE,
  LINEAR_ENDPOINT,
  MAX_ISSUES,
  createLinearStatusResolver,
  linearStatusResolver: createLinearStatusResolver(),
};
