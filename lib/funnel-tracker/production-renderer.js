'use strict';

const {createHash} = require('node:crypto');

const VIEWPORT = Object.freeze({width: 1280, height: 900});
const MAX_DOCUMENT_BYTES = 12 * 1024 * 1024;
const MAX_PAGE_HEIGHT = 50000;
const MAX_RESOURCE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_RESOURCE_BYTES = 50 * 1024 * 1024;
const MAX_COMPARISON_RESOURCES = 512;
const FINGERPRINT_ALGORITHM = 'semantic-v1';
const TRACKED_RESOURCE_TYPES = new Map([
  ['stylesheet', 'css'],
  ['font', 'font'],
  ['image', 'image'],
  ['script', 'script'],
]);
const REQUIRED_VISUAL_RESOURCE_TYPES = new Set(['stylesheet', 'font', 'image']);
const DEFAULT_ASSET_ORIGINS = Object.freeze([
  'https://zodiac.fm',
  'https://app.zodiac.fm',
  'https://zodiac-pages.vercel.app',
]);

class CaptureUnavailableError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

class CaptureFailedError extends Error {}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    return url;
  } catch {
    return null;
  }
}

function normalizedAllowedOrigins(sourceUrl, supplied = DEFAULT_ASSET_ORIGINS) {
  const source = safeUrl(sourceUrl);
  if (!source) throw new CaptureFailedError('invalid capture URL');
  const origins = new Set([source.origin]);
  for (const candidate of supplied) {
    const parsed = safeUrl(candidate);
    if (parsed && parsed.pathname === '/' && !parsed.search && !parsed.hash) origins.add(parsed.origin);
  }
  return origins;
}

function looksLikeAccessOrErrorPage({status, title, text, url}) {
  if (status !== 200) return `http_${status}`;
  const sample = `${title || ''}\n${String(text || '').slice(0, 4000)}`.toLowerCase();
  if (/\b(just a moment|checking your browser|access denied|unauthorized|forbidden)\b/.test(sample)) {
    return 'access_page';
  }
  if (/\b(sign in|log in)\b/.test(sample) && /\b(vercel|authentication|account)\b/.test(sample)) {
    return 'login_page';
  }
  if (/\b(404|not found)\b/.test(sample) && String(url).length > 0) return 'not_found_page';
  return null;
}

function publicErrorMessage(code) {
  if (code.startsWith('http_')) return `The snapshot source returned ${code.slice(5)}.`;
  if (code === 'login_page') return 'The snapshot source requires an interactive login.';
  if (code === 'access_page') return 'The snapshot source blocked the capture request.';
  if (code === 'not_found_page') return 'The snapshot source is not available yet.';
  return 'The snapshot source could not be captured.';
}

function captureRequestPolicy({
  requestUrl,
  resourceType,
  originalHeaders = {},
  sourceUrl,
  allowedOrigins,
  requestHeaders = {},
  protectedFeed = false,
}) {
  const requested = safeUrl(requestUrl);
  if (!requested) {
    return /^(data|blob):/.test(requestUrl) ? {action: 'continue', headers: {}} : {action: 'abort'};
  }
  if (!allowedOrigins.has(requested.origin)) return {action: 'abort'};
  if (resourceType === 'document' && requested.href !== sourceUrl.href) return {action: 'abort'};
  if (protectedFeed && resourceType === 'script') return {action: 'abort'};
  const headers = {};
  for (const [name, value] of Object.entries(originalHeaders)) {
    const lower = name.toLowerCase();
    if (!['cookie', 'authorization', 'x-funnel-tracker-token'].includes(lower)) headers[lower] = value;
  }
  if (resourceType === 'document' && requested.href === sourceUrl.href) {
    for (const [name, value] of Object.entries(requestHeaders)) {
      if (name.toLowerCase() === 'x-funnel-tracker-token'
          && typeof value === 'string' && value.length <= 8192) headers['x-funnel-tracker-token'] = value;
    }
  }
  return {action: 'continue', headers};
}

async function settlePageImages(settleMs) {
  const images = Array.from(document.images);
  for (const image of images) image.loading = 'eager';
  const timeout = new Promise(resolve => setTimeout(resolve, settleMs));
  const fonts = document.fonts?.ready?.catch(() => undefined) || Promise.resolve();
  const imageLoads = Promise.all(images.map(async image => {
    if (image.complete) {
      try { await image.decode(); } catch {}
      return;
    }
    await new Promise(resolve => {
      const done = () => resolve();
      image.addEventListener('load', done, {once: true});
      image.addEventListener('error', done, {once: true});
    });
  }));
  await Promise.race([Promise.all([fonts, imageLoads]), timeout]);
  return Array.from(document.images).map(image => ({
    source: image.currentSrc || image.getAttribute('src') || '',
    naturalWidth: image.naturalWidth,
    naturalHeight: image.naturalHeight,
  }));
}

function requiredImageFailures(images) {
  if (!Array.isArray(images)) return [];
  return images.filter(image => image && typeof image.source === 'string'
    && image.source.length > 0
    && !/^(?:data|blob|about|javascript):/i.test(image.source)
    && image.naturalWidth === 0);
}

function normalizeMarkup(value) {
  return String(value).replace(/\r\n?/g, '\n').replace(/>\s+</g, '><').trim();
}

function normalizedMainHtml(body, protectedFeed = false) {
  let html = Buffer.isBuffer(body) ? body.toString('utf8') : String(body || '');
  if (protectedFeed) {
    html = html.replace(/<meta\b[^>]*>/gi, tag => (
      /\bname\s*=\s*(["'])funnel-snapshot\1/i.test(tag)
        ? tag.replace(/sourceCommit=[a-f0-9]{40}/ig, 'sourceCommit=')
        : tag
    ));
  }
  return normalizeMarkup(html);
}

function normalizedComparisonInput({normalizedDom, mainHtml, inlineCss = [], resources = []}) {
  const normalizedResources = resources.map(resource => ({
    type: resource.type,
    url: resource.url,
    bodySha256: resource.bodySha256,
  })).sort((left, right) => (
    `${left.type}\u0000${left.url}\u0000${left.bodySha256}`
      .localeCompare(`${right.type}\u0000${right.url}\u0000${right.bodySha256}`)
  ));
  return {
    algorithm: FINGERPRINT_ALGORITHM,
    normalizedDom: normalizeMarkup(normalizedDom),
    mainHtml: normalizeMarkup(mainHtml),
    inlineCss: inlineCss.map(normalizeMarkup),
    resources: normalizedResources,
  };
}

function comparisonDetailsFor(input) {
  const normalized = normalizedComparisonInput(input);
  return {
    version: FINGERPRINT_ALGORITHM,
    mainHtmlSha256: sha256(normalized.mainHtml),
    normalizedDomSha256: sha256(normalized.normalizedDom),
    inlineCssSha256: sha256(JSON.stringify(normalized.inlineCss)),
    resourceSetSha256: sha256(JSON.stringify(normalized.resources)),
    resources: normalized.resources,
  };
}

function semanticRenderFingerprint(input) {
  return sha256(JSON.stringify(normalizedComparisonInput(input)));
}

function createResourceCollector({allowedOrigins}) {
  const pending = [];
  let totalBytes = 0;

  function observe(response) {
    const requestType = response.request().resourceType();
    const type = TRACKED_RESOURCE_TYPES.get(requestType);
    const url = safeUrl(response.url());
    if (!type || !url || !allowedOrigins.has(url.origin)) return;
    pending.push(async () => {
      const requiredVisual = REQUIRED_VISUAL_RESOURCE_TYPES.has(requestType);
      const status = response.status();
      if (status < 200 || status >= 400) {
        if (requiredVisual) {
          throw new CaptureUnavailableError(
            'visual_resource_unavailable',
            'A required visual resource could not be loaded for the snapshot.',
          );
        }
        return null;
      }
      let headers;
      try {
        headers = await response.allHeaders();
      } catch {
        headers = {};
      }
      const declaredLength = Number(headers['content-length']);
      if (Number.isFinite(declaredLength) && declaredLength > MAX_RESOURCE_BYTES) {
        throw new CaptureUnavailableError(
          'resource_too_large',
          'A page resource exceeded the snapshot size limit.',
        );
      }
      if (Number.isFinite(declaredLength)
          && totalBytes + declaredLength > MAX_TOTAL_RESOURCE_BYTES) {
        throw new CaptureUnavailableError(
          'resources_too_large',
          'The page resources exceeded the snapshot size limit.',
        );
      }
      let resourceBody;
      try {
        resourceBody = await response.body();
      } catch {
        if (!requiredVisual) return null;
        throw new CaptureUnavailableError(
          'visual_resource_unreadable',
          'A required visual resource could not be read for the snapshot.',
        );
      }
      if (!Buffer.isBuffer(resourceBody) || resourceBody.length > MAX_RESOURCE_BYTES) {
        throw new CaptureUnavailableError(
          'resource_too_large',
          'A page resource exceeded the snapshot size limit.',
        );
      }
      totalBytes += resourceBody.length;
      if (totalBytes > MAX_TOTAL_RESOURCE_BYTES) {
        throw new CaptureUnavailableError(
          'resources_too_large',
          'The page resources exceeded the snapshot size limit.',
        );
      }
      return {type, url: url.href, bodySha256: sha256(resourceBody)};
    });
  }

  async function finish() {
    const resources = [];
    let cursor = 0;
    while (cursor < pending.length) {
      const batch = pending.slice(cursor);
      cursor = pending.length;
      for (const readResource of batch) {
        const resource = await readResource();
        if (resource) resources.push(resource);
      }
    }
    const unique = new Map();
    for (const resource of resources) {
      const key = `${resource.type}\u0000${resource.url}`;
      const existing = unique.get(key);
      if (existing && existing.bodySha256 !== resource.bodySha256) {
        throw new CaptureUnavailableError(
          'resource_content_conflict',
          'A page resource changed while the snapshot was being captured.',
        );
      }
      unique.set(key, resource);
    }
    if (unique.size > MAX_COMPARISON_RESOURCES) {
      throw new CaptureUnavailableError(
        'too_many_resources',
        'The page loaded too many resources for a dependable comparison.',
      );
    }
    return Array.from(unique.values());
  }

  return {observe, finish};
}

function createProductionRenderer({
  launchBrowser,
  allowedAssetOrigins = DEFAULT_ASSET_ORIGINS,
  navigationTimeoutMs = 25000,
  settleTimeoutMs = 8000,
} = {}) {
  let browserPromise = null;

  async function defaultLaunch() {
    const [{chromium: playwrightChromium}, chromiumModule] = await Promise.all([
      import('playwright-core'),
      import('@sparticuz/chromium'),
    ]);
    const chromium = chromiumModule.default;
    return playwrightChromium.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    });
  }

  async function browser() {
    if (!browserPromise) browserPromise = Promise.resolve().then(() => (
      launchBrowser ? launchBrowser() : defaultLaunch()
    ));
    return browserPromise;
  }

  async function capture({url, requestHeaders = {}, protectedFeed = false}) {
    const source = safeUrl(url);
    if (!source) throw new CaptureFailedError('invalid capture URL');
    const allowedOrigins = normalizedAllowedOrigins(url, allowedAssetOrigins);
    const currentBrowser = await browser();
    const context = await currentBrowser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 1,
      colorScheme: 'light',
      reducedMotion: 'reduce',
      locale: 'en-US',
      timezoneId: 'America/Denver',
      serviceWorkers: 'block',
      acceptDownloads: false,
    });
    let page;
    try {
      page = await context.newPage();
      const resourceCollector = createResourceCollector({allowedOrigins});
      page.on('response', resourceCollector.observe);
      await page.route('**/*', async (route) => {
        const request = route.request();
        const policy = captureRequestPolicy({
          requestUrl: request.url(),
          resourceType: request.resourceType(),
          originalHeaders: request.headers(),
          sourceUrl: source,
          allowedOrigins,
          requestHeaders,
          protectedFeed,
        });
        return policy.action === 'continue'
          ? route.continue({headers: policy.headers})
          : route.abort('blockedbyclient');
      });

      let response;
      try {
        response = await page.goto(source.href, {
          waitUntil: 'domcontentloaded',
          timeout: navigationTimeoutMs,
        });
      } catch (error) {
        throw new CaptureUnavailableError('navigation_failed', 'The snapshot source could not be reached.', {cause: error});
      }
      if (!response || response.url() !== source.href) {
        throw new CaptureUnavailableError('redirect_blocked', 'The snapshot source redirected away from its allowed URL.');
      }
      const status = response.status();
      const headers = await response.allHeaders();
      const contentType = headers['content-type'] || '';
      if (!/^text\/html(?:;|$)/i.test(contentType)) {
        throw new CaptureUnavailableError('invalid_content_type', 'The snapshot source did not return an HTML page.');
      }
      let body;
      try {
        body = await response.body();
      } catch (error) {
        throw new CaptureUnavailableError('response_unreadable', 'The snapshot source response could not be read.', {cause: error});
      }
      if (!Buffer.isBuffer(body) || body.length < 64 || body.length > MAX_DOCUMENT_BYTES) {
        throw new CaptureUnavailableError('invalid_document_size', 'The snapshot source returned an invalid page size.');
      }
      const summary = await page.evaluate(() => ({
        title: document.title,
        text: document.body?.innerText || '',
      }));
      const errorCode = looksLikeAccessOrErrorPage({status, ...summary, url: source.href});
      if (errorCode) throw new CaptureUnavailableError(errorCode, publicErrorMessage(errorCode));

      await page.addStyleTag({content: `
        *, *::before, *::after {
          animation-duration: 0s !important;
          animation-delay: 0s !important;
          transition-duration: 0s !important;
          transition-delay: 0s !important;
          caret-color: transparent !important;
          scroll-behavior: auto !important;
        }
      `});
      const imageStates = await page.evaluate(settlePageImages, settleTimeoutMs);
      if (requiredImageFailures(imageStates).length > 0) {
        throw new CaptureUnavailableError(
          'image_load_failed',
          'The snapshot source did not finish loading its required images.',
        );
      }

      const evaluated = await page.evaluate(() => {
        const snapshotRoot = document.querySelector('[data-funnel-snapshot="true"]');
        const root = snapshotRoot
          || document.querySelector('main') || document.body;
        if (!root) return null;
        const clone = root.cloneNode(true);
        clone.querySelectorAll('script,noscript,iframe,[data-nextjs-toast],[data-next-badge-root],next-route-announcer')
          .forEach(node => node.remove());
        const walker = document.createTreeWalker(clone, NodeFilter.SHOW_ELEMENT);
        let node = clone;
        while (node) {
          for (const attribute of Array.from(node.attributes || [])) {
            if (attribute.name === 'nonce' || attribute.name.startsWith('data-nextjs-')) {
              node.removeAttribute(attribute.name);
            }
          }
          node = walker.nextNode();
        }
        const marker = document.querySelector('meta[name="funnel-snapshot"]')?.getAttribute('content') || null;
        return {
          normalized: clone.outerHTML.replace(/\r\n?/g, '\n').replace(/>\s+</g, '><').trim(),
          inlineCss: Array.from(document.head?.querySelectorAll('style') || [])
            .map(style => style.textContent || ''),
          marker,
          snapshotRoot: Boolean(snapshotRoot),
          width: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0),
          height: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0),
        };
      });
      if (!evaluated || !evaluated.normalized || evaluated.width > 4096
          || evaluated.height < 1 || evaluated.height > MAX_PAGE_HEIGHT) {
        throw new CaptureUnavailableError('invalid_render_size', 'The snapshot source rendered outside the supported page size.');
      }

      const image = await page.screenshot({
        type: 'png',
        fullPage: true,
        animations: 'disabled',
        caret: 'hide',
        scale: 'css',
      });
      if (!Buffer.isBuffer(image) || image.length < 8) {
        throw new CaptureFailedError('the browser did not produce a screenshot');
      }
      const resources = await resourceCollector.finish();
      const imageSha256 = sha256(image);
      const domSha256 = sha256(evaluated.normalized);
      const mainHtml = normalizedMainHtml(body, protectedFeed);
      const comparisonInput = {
        normalizedDom: evaluated.normalized,
        mainHtml,
        inlineCss: evaluated.inlineCss,
        resources,
      };
      return {
        image,
        imageSha256,
        domSha256,
        fingerprintAlgorithm: FINGERPRINT_ALGORITHM,
        comparisonDetails: comparisonDetailsFor(comparisonInput),
        renderFingerprint: semanticRenderFingerprint(comparisonInput),
        responseBodySha256: sha256(body),
        responseHeaders: headers,
        marker: evaluated.marker,
        snapshotRoot: evaluated.snapshotRoot,
        finalUrl: response.url(),
        width: VIEWPORT.width,
        height: evaluated.height,
        responseDate: typeof headers.date === 'string' ? headers.date : null,
      };
    } finally {
      await context.close().catch(() => undefined);
    }
  }

  async function close() {
    if (browserPromise) {
      try {
        const current = await browserPromise;
        await current.close();
      } catch {}
      browserPromise = null;
    }
  }

  return {capture, close};
}

module.exports = {
  CaptureFailedError,
  CaptureUnavailableError,
  DEFAULT_ASSET_ORIGINS,
  FINGERPRINT_ALGORITHM,
  MAX_COMPARISON_RESOURCES,
  MAX_RESOURCE_BYTES,
  MAX_TOTAL_RESOURCE_BYTES,
  MAX_PAGE_HEIGHT,
  VIEWPORT,
  captureRequestPolicy,
  comparisonDetailsFor,
  createProductionRenderer,
  createResourceCollector,
  looksLikeAccessOrErrorPage,
  normalizedAllowedOrigins,
  normalizedComparisonInput,
  normalizedMainHtml,
  normalizeMarkup,
  requiredImageFailures,
  settlePageImages,
  semanticRenderFingerprint,
  sha256,
};
