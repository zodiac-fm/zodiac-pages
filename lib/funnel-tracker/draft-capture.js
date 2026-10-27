'use strict';

const {createProductionRenderer, closeRendererWithin} = (() => {
  const renderer = require('./production-renderer');
  return {
    createProductionRenderer: renderer.createProductionRenderer,
    closeRendererWithin: async (instance) => {
      if (!instance?.close) return;
      await Promise.race([
        Promise.resolve().then(() => instance.close()).catch(() => undefined),
        new Promise(resolve => setTimeout(resolve, 5000)),
      ]);
    },
  };
})();
const {deriveWorkingBindings, draftStore, workingRevisionUrl, renderWorkingPage} = require('./draft-store');
const {reviewStore, validAttachmentId} = require('./review-store');

const CAPTURE_TIMEOUT_MS = 35000;
const MAX_CRON_CAPTURES = 9;
const CRON_CAPTURE_BUDGET_MS = 60000;

function workingCaptureUrl(pageKey, sourceUrl, revisionId, view = 'desktop') {
  return new URL(
    workingRevisionUrl(pageKey, sourceUrl, revisionId, null, view),
    'https://zodiac-pages.vercel.app',
  ).href;
}

function attachmentResolver(review = reviewStore) {
  return async (value, resourceType) => {
    if (resourceType !== 'image') return null;
    let url;
    try {
      url = new URL(value);
    } catch {
      return null;
    }
    if (url.origin !== 'https://zodiac-pages.vercel.app'
        || url.pathname !== '/api/funnel-review' || url.searchParams.get('action') !== 'image') return null;
    const attachmentId = url.searchParams.get('attachmentId');
    if (!validAttachmentId(attachmentId)) return null;
    const result = await review.readAttachment(attachmentId);
    if (!result) return null;
    return {body: result.buffer, contentType: result.attachment.mimeType};
  };
}

function publicCaptureResult(pageKey, revisionId, capture, view = 'desktop') {
  return {
    pageKey,
    revisionId,
    view,
    status: capture.status,
    error: capture.error || null,
  };
}

async function captureDraftRevision(pageKey, revisionId, {
  drafts = draftStore,
  review = reviewStore,
  rendererFactory = createProductionRenderer,
  now = () => new Date(),
  timeoutMs = CAPTURE_TIMEOUT_MS,
  view = 'desktop',
} = {}) {
  if (!['desktop', 'mobile'].includes(view)) throw new Error('invalid capture view');
  const current = await drafts.getDraft(pageKey);
  const revision = current.draft?.revisions.find(item => item.id === revisionId);
  if (!revision) return {pageKey, revisionId, status: 'missing', error: null};
  const viewCapture = revision.views?.[view]?.capture || revision.capture;
  if (viewCapture.status === 'ready') {
    return publicCaptureResult(pageKey, revisionId, viewCapture, view);
  }
  const html = await drafts.getHtmlByRevision(current.draft, revisionId, view);
  if (!html) return {pageKey, revisionId, status: 'missing', error: null};
  // Selectors and element identity remain stable across direct copy/image edits,
  // while heading text belongs to the requested immutable HTML revision.
  const revisionBindings = deriveWorkingBindings(html.html, current.draft.views?.[view]?.workingBindings || current.draft.workingBindings);
  const renderer = rendererFactory();
  const attemptedAt = now().toISOString();
  let timer;
  try {
    const capture = await Promise.race([
      renderer.capture({
        url: workingCaptureUrl(pageKey, current.draft.sourceUrl, revisionId, view),
        documentHtml: renderWorkingPage(current.draft, html.html, revisionId, {view}),
        view,
        privateResourceResolver: attachmentResolver(review),
        sectionBindings: revisionBindings,
      }),
      new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error('capture timed out'), {
          code: 'draft_capture_timed_out',
        })), timeoutMs);
      }),
    ]);
    if (!Array.isArray(capture.sectionBindingResults)
        || capture.sectionBindingResults.length !== revisionBindings.length
        || capture.sectionBindingResults.some(item => item.status !== 'mapped' || item.code !== 'ok')) {
      throw Object.assign(new Error('working binding validation failed'), {
        code: 'working_binding_validation_failed',
      });
    }
    const storedImage = await drafts.putScreenshot(pageKey, revisionId, capture.image, view);
    const ready = {
      status: 'ready', lastAttemptAt: attemptedAt, error: null,
      imageSha256: storedImage.imageSha256,
      width: capture.width,
      height: capture.height,
      blobPath: storedImage.blobPath,
    };
    const updated = await drafts.updateCapture(pageKey, revisionId, ready, now(), view);
    const saved = updated.revisions.find(item => item.id === revisionId);
    return publicCaptureResult(pageKey, revisionId, saved.views?.[view]?.capture || saved.capture, view);
  } catch (error) {
    const code = typeof error?.code === 'string' && /^[a-z0-9_]{1,80}$/.test(error.code)
      ? error.code : 'draft_capture_failed';
    const failed = {
      status: 'error', lastAttemptAt: attemptedAt,
      error: {
        code,
        message: code === 'draft_capture_timed_out'
          ? 'The working-page screenshot exceeded its time limit and will retry.'
          : 'The working-page screenshot could not be confirmed and will retry.',
      },
      imageSha256: null, width: null, height: null, blobPath: null,
    };
    try {
      const updated = await drafts.updateCapture(pageKey, revisionId, failed, now(), view);
      const saved = updated.revisions.find(item => item.id === revisionId);
      return publicCaptureResult(pageKey, revisionId, saved.views?.[view]?.capture || saved.capture, view);
    } catch {
      return publicCaptureResult(pageKey, revisionId, failed, view);
    }
  } finally {
    if (timer) clearTimeout(timer);
    await closeRendererWithin(renderer);
  }
}

async function capturePendingDrafts({
  drafts = draftStore,
  review = reviewStore,
  rendererFactory = createProductionRenderer,
  now,
  limit = MAX_CRON_CAPTURES,
  budgetMs = CRON_CAPTURE_BUDGET_MS,
  clock = Date.now,
} = {}) {
  const deadline = clock() + budgetMs;
  const current = await drafts.readManifest();
  const pending = [];
  for (const draft of current.data.drafts) {
    for (const revision of draft.revisions) {
      for (const view of revision.views ? ['desktop', 'mobile'] : ['desktop']) {
      const capture = revision.views?.[view]?.capture || revision.capture;
      if (capture.status !== 'ready') {
        pending.push({
          pageKey: draft.pageKey,
          revisionId: revision.id,
          status: capture.status,
          view,
          createdAt: revision.createdAt,
        });
      }
      }
    }
  }
  pending.sort((left, right) => {
    if (left.status !== right.status) return left.status === 'pending' ? -1 : 1;
    return Date.parse(right.createdAt) - Date.parse(left.createdAt);
  });
  const results = [];
  for (const item of pending.slice(0, limit)) {
    const remaining = deadline - clock();
    if (remaining < 1000) break;
    results.push(await captureDraftRevision(item.pageKey, item.revisionId, {
      drafts, review, rendererFactory, now,
      view: item.view,
      timeoutMs: Math.min(CAPTURE_TIMEOUT_MS, remaining),
    }));
  }
  return {
    ok: results.every(item => item.status === 'ready') && pending.length === results.length,
    attempted: results.length,
    remaining: Math.max(0, pending.length - results.length),
    ready: results.filter(item => item.status === 'ready').length,
    failed: results.filter(item => item.status === 'error').length,
    results,
  };
}

module.exports = {
  CAPTURE_TIMEOUT_MS,
  CRON_CAPTURE_BUDGET_MS,
  MAX_CRON_CAPTURES,
  attachmentResolver,
  captureDraftRevision,
  capturePendingDrafts,
  publicCaptureResult,
  workingCaptureUrl,
};
