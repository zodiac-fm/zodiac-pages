'use strict';

const {createHash} = require('node:crypto');

const VIEWPORT = Object.freeze({width: 1280, height: 900});
const MOBILE_VIEWPORT = Object.freeze({width: 390, height: 844});
const MAX_DOCUMENT_BYTES = 12 * 1024 * 1024;
const MAX_PAGE_HEIGHT = 50000;
const MAX_RESOURCE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_RESOURCE_BYTES = 50 * 1024 * 1024;
const MAX_COMPARISON_RESOURCES = 512;
const RESOURCE_FETCH_TIMEOUT_MS = 8000;
const FINGERPRINT_ALGORITHM = 'semantic-v2';
const CORPORATE_FINGERPRINT_ALGORITHM = 'corporate-source-v1';
const BC_FINGERPRINT_ALGORITHM = 'bc-public-v1';
const JOIN_FINGERPRINT_ALGORITHM = 'join-snapshot-v1';
const FINGERPRINT_ALGORITHMS = new Set([
  FINGERPRINT_ALGORITHM,
  CORPORATE_FINGERPRINT_ALGORITHM,
  BC_FINGERPRINT_ALGORITHM,
  JOIN_FINGERPRINT_ALGORITHM,
]);
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
  'https://purecatamphetamine.github.io',
]);

class CaptureUnavailableError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

class CaptureFailedError extends Error {}

async function waitForBirthFormReadiness(page, view) {
  const viewSelector = view === 'mobile'
    ? '#birth-information-form [data-funnel-mobile-date-ready="true"]'
    : '#birth-information-form [role="group"][aria-label="Date of birth"]';
  // The date group is present in the server response on desktop, while the
  // location control is mounted by a client-only dynamic import. Waiting for
  // both prevents a pre-hydration DOM from being recorded as a page change.
  const selectors = [viewSelector, '#birth-information-form #location'];
  try {
    await Promise.all(selectors.map(selector => (
      page.waitForSelector(selector, {state: 'attached', timeout: 15000})
    )));
  } catch {
    throw new CaptureUnavailableError(
      'birth_form_not_ready',
      'The live birth form did not finish loading its selected web view.',
    );
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function createChromiumRuntimePreparer(loadRuntime = async () => {
  const [{chromium:playwrightChromium},chromiumModule]=await Promise.all([
    import('playwright-core'),import('@sparticuz/chromium'),
  ]);
  return {playwrightChromium,chromium:chromiumModule.default};
}) {
  let runtimePromise=null;
  return async function prepareChromiumRuntime() {
    if(!runtimePromise){
      runtimePromise=Promise.resolve().then(loadRuntime).then(async runtime=>({
        playwrightChromium:runtime.playwrightChromium,
        chromium:runtime.chromium,
        executablePath:await runtime.chromium.executablePath(),
      })).catch(error=>{runtimePromise=null;throw error;});
    }
    return runtimePromise;
  };
}

// All renderer instances in one function isolate share the extraction. Sparticuz
// checks /tmp/chromium before inflating, so concurrent extraction can otherwise
// race and surface operating-system ETXTBSY failures.
const prepareChromiumRuntime=createChromiumRuntimePreparer();

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
  // The live birth form's existing country control uses these public flag images.
  // This exception permits neither scripts nor other paths on the image host.
  if (requested.origin === 'https://purecatamphetamine.github.io'
      && (resourceType !== 'image' || !/^\/country-flag-icons\/3x2\/[A-Z]{2}\.svg$/.test(requested.pathname)
        || requested.search || requested.hash)) return {action: 'abort'};
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

function collectReferencedResources({includeScripts = true} = {}) {
  const resources = new Map();

  function add(type, value, base = document.baseURI) {
    if (!['css', 'font', 'image', 'script'].includes(type) || !value) return;
    if (/^\s*#/.test(String(value))) return;
    let url;
    try {
      url = new URL(value, base);
    } catch {
      return;
    }
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return;
    url.hash = '';
    resources.set(`${type}\u0000${url.href}`, {type, url: url.href});
  }

  function urls(value) {
    const found = [];
    const pattern = /url\(\s*(?:(["'])(.*?)\1|([^)]*?))\s*\)/gi;
    for (const match of String(value || '').matchAll(pattern)) {
      const candidate = (match[2] ?? match[3] ?? '').trim();
      if (candidate && !/^(?:data|blob|about|javascript):/i.test(candidate)) found.push(candidate);
    }
    return found;
  }

  function walkRules(rules, base) {
    for (const rule of Array.from(rules || [])) {
      const name = rule?.constructor?.name || '';
      if (name === 'CSSMediaRule' && rule.media?.mediaText
          && !matchMedia(rule.media.mediaText).matches) continue;
      if (name === 'CSSSupportsRule' && rule.conditionText
          && typeof CSS?.supports === 'function' && !CSS.supports(rule.conditionText)) continue;
      if (name === 'CSSImportRule') {
        if (rule.media?.mediaText && !matchMedia(rule.media.mediaText).matches) continue;
        add('css', rule.href, base);
        try {
          walkRules(rule.styleSheet?.cssRules, rule.styleSheet?.href || rule.href || base);
        } catch {}
        continue;
      }
      if (name === 'CSSFontFaceRule') {
        for (const value of urls(rule.style?.getPropertyValue('src'))) add('font', value, base);
      }
      if (rule.cssRules) walkRules(rule.cssRules, base);
    }
  }

  for (const sheet of Array.from(document.styleSheets || [])) {
    if (sheet.disabled) continue;
    const media = sheet.media?.mediaText;
    if (media && !matchMedia(media).matches) continue;
    if (sheet.href) add('css', sheet.href);
    try {
      walkRules(sheet.cssRules, sheet.href || document.baseURI);
    } catch {}
  }

  if (includeScripts) {
    for (const script of document.querySelectorAll('script[src]')) add('script', script.src);
  }
  for (const image of document.images) add('image', image.currentSrc || image.src);
  for (const image of document.querySelectorAll('svg image[href],svg image[xlink\\:href],svg use[href],svg use[xlink\\:href]')) {
    add('image', image.getAttribute('href') || image.getAttribute('xlink:href'));
  }
  for (const element of document.querySelectorAll('video[poster]')) add('image', element.poster);

  const imageProperties = [
    'backgroundImage',
    'borderImageSource',
    'content',
    'cursor',
    'listStyleImage',
    'maskImage',
    'webkitMaskImage',
  ];
  for (const element of document.querySelectorAll('*')) {
    for (const pseudo of [null, '::before', '::after']) {
      let style;
      try {
        style = getComputedStyle(element, pseudo);
      } catch {
        continue;
      }
      for (const property of imageProperties) {
        for (const value of urls(style[property])) add('image', value);
      }
    }
  }

  return Array.from(resources.values());
}

function validateSectionBindingsInPage(bindings = []) {
  const normalize = value => String(value || '').trim().replace(/\s+/g, ' ');
  return bindings.map(binding => {
    const result = {sectionId: binding.sectionId, status: 'unmapped', code: 'binding_invalid'};
    let matches;
    try {
      matches = document.querySelectorAll(binding.selector);
    } catch {
      return {...result, code: 'selector_invalid'};
    }
    if (matches.length === 0) return {...result, code: 'selector_missing'};
    if (matches.length !== 1) return {...result, code: 'selector_not_unique'};
    const element = matches[0];
    if (element.tagName.toLowerCase() !== binding.element.tag) return {...result, code: 'tag_mismatch'};
    if ((element.id || null) !== binding.element.id) return {...result, code: 'id_mismatch'};
    const classes = Array.from(element.classList).sort((left, right) => left.localeCompare(right));
    if (classes.length !== binding.element.classes.length
        || classes.some((item, index) => item !== binding.element.classes[index])) {
      return {...result, code: 'classes_mismatch'};
    }
    const heading = element.querySelector('h1,h2,h3,h4,h5,h6');
    if (binding.firstHeading === null) {
      return heading ? {...result, code: 'heading_unexpected'} : {
        sectionId: binding.sectionId, status: 'mapped', code: 'ok',
      };
    }
    if (!heading) return {...result, code: 'heading_missing'};
    if (heading.tagName.toLowerCase() !== binding.firstHeading.tag
        || normalize(heading.textContent) !== binding.firstHeading.text) {
      return {...result, code: 'heading_mismatch'};
    }
    return {sectionId: binding.sectionId, status: 'mapped', code: 'ok'};
  });
}

function normalizeMarkup(value) {
  return String(value).replace(/\r\n?/g, '\n').replace(/>\s+</g, '><').trim();
}

function normalizedMainHtml(
  body,
  protectedFeed = false,
  fingerprintAlgorithm = FINGERPRINT_ALGORITHM,
) {
  let html = Buffer.isBuffer(body) ? body.toString('utf8') : String(body || '');
  if (protectedFeed) {
    html = html.replace(/<meta\b[^>]*>/gi, tag => (
      /\bname\s*=\s*(["'])funnel-snapshot\1/i.test(tag)
        ? tag.replace(/sourceCommit=[a-f0-9]{40}/ig, 'sourceCommit=')
        : tag
    ));
  }
  if ([BC_FINGERPRINT_ALGORITHM,JOIN_FINGERPRINT_ALGORITHM].includes(fingerprintAlgorithm)) {
    html = html.replace(/<head\b[^>]*>[\s\S]*?<\/head>/i, head => (
      head.replace(/<meta\b[^>]*>/gi, tag => (
        /\bname\s*=\s*(["'])(?:sentry-trace|baggage)\1/i.test(tag) ? '' : tag
      ))
    ));
  }
  return normalizeMarkup(html);
}

function normalizedComparisonInput(
  {normalizedDom, mainHtml, inlineCss = [], resources = []},
  fingerprintAlgorithm = FINGERPRINT_ALGORITHM,
) {
  if (!FINGERPRINT_ALGORITHMS.has(fingerprintAlgorithm)) {
    throw new CaptureFailedError('invalid fingerprint algorithm');
  }
  const normalizedResources = resources
    .filter(resource => fingerprintAlgorithm !== BC_FINGERPRINT_ALGORITHM
      || resource.type !== 'script')
    .map(resource => ({
      type: resource.type,
      url: resource.url,
      bodySha256: resource.bodySha256,
    })).sort((left, right) => (
    `${left.type}\u0000${left.url}\u0000${left.bodySha256}`
      .localeCompare(`${right.type}\u0000${right.url}\u0000${right.bodySha256}`)
  ));
  const canonicalMainHtml = normalizeMarkup(mainHtml);
  return {
    algorithm: fingerprintAlgorithm,
    // The public corporate homepage hydrates animation/runtime attributes into the
    // DOM. Its stable comparison is the server HTML plus the same fetched asset
    // bodies; the screenshot still records the fully hydrated visual result.
    normalizedDom: fingerprintAlgorithm === CORPORATE_FINGERPRINT_ALGORITHM
      ? canonicalMainHtml
      : normalizeMarkup(normalizedDom),
    mainHtml: canonicalMainHtml,
    inlineCss: inlineCss.map(normalizeMarkup),
    resources: normalizedResources,
  };
}

function comparisonDetailsFor(input, fingerprintAlgorithm = FINGERPRINT_ALGORITHM) {
  const normalized = normalizedComparisonInput(input, fingerprintAlgorithm);
  return {
    version: fingerprintAlgorithm,
    mainHtmlSha256: sha256(normalized.mainHtml),
    normalizedDomSha256: sha256(normalized.normalizedDom),
    inlineCssSha256: sha256(JSON.stringify(normalized.inlineCss)),
    resourceSetSha256: sha256(JSON.stringify(normalized.resources)),
    resources: normalized.resources,
  };
}

function semanticRenderFingerprint(input, fingerprintAlgorithm = FINGERPRINT_ALGORITHM) {
  return sha256(JSON.stringify(normalizedComparisonInput(input, fingerprintAlgorithm)));
}

async function fetchReferencedResource(url, {timeoutMs = RESOURCE_FETCH_TIMEOUT_MS} = {}) {
  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      credentials: 'omit',
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return null;
  }
  const headers = Object.fromEntries(response.headers.entries());
  const declaredLength = Number(headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESOURCE_BYTES) {
    throw new CaptureUnavailableError(
      'resource_too_large',
      'A page resource exceeded the snapshot size limit.',
    );
  }
  if (response.status < 200 || response.status >= 400 || response.url !== url || !response.body) {
    return {status: response.status, headers, body: null};
  }
  const chunks = [];
  let length = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_RESOURCE_BYTES) {
        throw new CaptureUnavailableError(
          'resource_too_large',
          'A page resource exceeded the snapshot size limit.',
        );
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return {status: response.status, headers, body: Buffer.concat(chunks, length)};
}

function createResourceCollector({allowedOrigins, fetchResource = fetchReferencedResource}) {
  const observed = new Map();

  function observe(response) {
    const requestType = response.request().resourceType();
    const type = TRACKED_RESOURCE_TYPES.get(requestType);
    const url = safeUrl(response.url());
    if (!type || !url || !allowedOrigins.has(url.origin)) return;
    url.hash = '';
    const key = `${type}\u0000${url.href}`;
    if (!observed.has(key)) observed.set(key, []);
    observed.get(key).push(async () => {
      const status = response.status();
      if (status < 200 || status >= 400) return {status, headers: {}, body: null};
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
      let resourceBody;
      try {
        resourceBody = await response.body();
      } catch {
        return {status, headers, body: null};
      }
      if (!Buffer.isBuffer(resourceBody) || resourceBody.length > MAX_RESOURCE_BYTES) {
        throw new CaptureUnavailableError(
          'resource_too_large',
          'A page resource exceeded the snapshot size limit.',
        );
      }
      return {status, headers, body: resourceBody};
    });
  }

  async function finish(references = []) {
    const inventory = new Map();
    for (const reference of references) {
      if (!reference || !TRACKED_RESOURCE_TYPES.has(
        reference.type === 'css' ? 'stylesheet' : reference.type,
      )) continue;
      const url = safeUrl(reference.url);
      if (!url || !allowedOrigins.has(url.origin)) continue;
      url.hash = '';
      inventory.set(`${reference.type}\u0000${url.href}`, {type: reference.type, url: url.href});
    }
    if (inventory.size > MAX_COMPARISON_RESOURCES) {
      throw new CaptureUnavailableError(
        'too_many_resources',
        'The page referenced too many resources for a dependable comparison.',
      );
    }

    const resources = [];
    let totalBytes = 0;
    const fetchDeadline = Date.now() + RESOURCE_FETCH_TIMEOUT_MS;
    for (const [key, reference] of inventory) {
      const candidates = [];
      for (const readObserved of observed.get(key) || []) {
        const candidate = await readObserved();
        if (Buffer.isBuffer(candidate?.body)) candidates.push(candidate);
      }
      if (candidates.length === 0) {
        const timeoutMs = fetchDeadline - Date.now();
        if (timeoutMs < 1) {
          throw new CaptureUnavailableError(
            'resource_fetch_timed_out',
            'The referenced page resources did not finish loading in time.',
          );
        }
        const fetched = await fetchResource(reference.url, {type: reference.type, timeoutMs});
        if (Buffer.isBuffer(fetched?.body)) candidates.push(fetched);
      }
      if (candidates.length === 0) {
        const requiredVisual = REQUIRED_VISUAL_RESOURCE_TYPES.has(
          reference.type === 'css' ? 'stylesheet' : reference.type,
        );
        throw new CaptureUnavailableError(
          requiredVisual ? 'visual_resource_unreadable' : 'resource_unreadable',
          requiredVisual
            ? 'A required visual resource could not be read for the snapshot.'
            : 'A referenced page resource could not be read for the snapshot.',
        );
      }
      const hashes = new Set(candidates.map(candidate => sha256(candidate.body)));
      if (hashes.size > 1) {
        throw new CaptureUnavailableError(
          'resource_content_conflict',
          'A page resource changed while the snapshot was being captured.',
        );
      }
      const body = candidates[0].body;
      if (body.length > MAX_RESOURCE_BYTES) {
        throw new CaptureUnavailableError(
          'resource_too_large',
          'A page resource exceeded the snapshot size limit.',
        );
      }
      totalBytes += body.length;
      if (totalBytes > MAX_TOTAL_RESOURCE_BYTES) {
        throw new CaptureUnavailableError(
          'resources_too_large',
          'The page resources exceeded the snapshot size limit.',
        );
      }
      resources.push({...reference, bodySha256: hashes.values().next().value});
    }
    return resources;
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
    const {playwrightChromium,chromium,executablePath}=await prepareChromiumRuntime();
    return playwrightChromium.launch({
      args: chromium.args,
      executablePath,
      headless: true,
    });
  }

  async function browser() {
    if (!browserPromise) browserPromise = Promise.resolve().then(() => (
      launchBrowser ? launchBrowser() : defaultLaunch()
    ));
    return browserPromise;
  }

  async function capture({
    url,
    requestHeaders = {},
    protectedFeed = false,
    sectionBindings = [],
    documentHtml = null,
    privateResourceResolver = null,
    fingerprintAlgorithm = FINGERPRINT_ALGORITHM,
    view = 'desktop',
    includeDocumentHtml = false,
  }) {
    const source = safeUrl(url);
    if (!source) throw new CaptureFailedError('invalid capture URL');
    if (!['desktop', 'mobile'].includes(view)) throw new CaptureFailedError('invalid capture view');
    const viewport = view === 'mobile' ? MOBILE_VIEWPORT : VIEWPORT;
    if (!(documentHtml === null || (typeof documentHtml === 'string'
      && Buffer.byteLength(documentHtml, 'utf8') <= MAX_DOCUMENT_BYTES))) {
      throw new CaptureFailedError('invalid supplied document');
    }
    if (!FINGERPRINT_ALGORITHMS.has(fingerprintAlgorithm)) {
      throw new CaptureFailedError('invalid fingerprint algorithm');
    }
    const allowedOrigins = normalizedAllowedOrigins(url, allowedAssetOrigins);
    const currentBrowser = await browser();
    const context = await currentBrowser.newContext({
      viewport,
      isMobile: view === 'mobile',
      hasTouch: view === 'mobile',
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
        if (documentHtml !== null && request.resourceType() === 'document'
            && request.url() === source.href) {
          return route.fulfill({
            status: 200,
            contentType: 'text/html; charset=utf-8',
            body: documentHtml,
            headers: {'Cache-Control': 'private, no-store'},
          });
        }
        if (typeof privateResourceResolver === 'function') {
          let resolved = null;
          try {
            resolved = await privateResourceResolver(request.url(), request.resourceType());
          } catch {
            return route.abort('failed');
          }
          if (resolved) {
            if (!Buffer.isBuffer(resolved.body)
                || !['image/png', 'image/jpeg', 'image/webp'].includes(resolved.contentType)) {
              return route.abort('failed');
            }
            return route.fulfill({status: 200, contentType: resolved.contentType, body: resolved.body});
          }
        }
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
      if (source.href === 'https://app.zodiac.fm/begin') {
        await waitForBirthFormReadiness(page, view);
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

      const evaluated = await page.evaluate((captureDocumentHtml) => {
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
        let documentHtml=null;
        if(captureDocumentHtml){
          const documentClone=document.documentElement.cloneNode(true);
          documentClone.querySelectorAll('script,noscript,iframe,[data-nextjs-toast],[data-next-badge-root],next-route-announcer')
            .forEach(node=>node.remove());
          documentClone.querySelectorAll('*').forEach(node=>{
            for(const attribute of [...node.attributes]){
              if(attribute.name==='nonce'||attribute.name.startsWith('on'))node.removeAttribute(attribute.name);
            }
          });
          documentHtml='<!doctype html>'+documentClone.outerHTML;
        }
        return {
          normalized: clone.outerHTML.replace(/\r\n?/g, '\n').replace(/>\s+</g, '><').trim(),
          inlineCss: Array.from(document.head?.querySelectorAll('style') || [])
            .map(style => style.textContent || ''),
          marker,
          snapshotRoot: Boolean(snapshotRoot),
          width: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0),
          height: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0),
          documentHtml,
        };
      },includeDocumentHtml);
      if (!evaluated || !evaluated.normalized || evaluated.width > 4096
          || evaluated.height < 1 || evaluated.height > MAX_PAGE_HEIGHT) {
        throw new CaptureUnavailableError('invalid_render_size', 'The snapshot source rendered outside the supported page size.');
      }

      let sectionBindingResults;
      try {
        sectionBindingResults = await page.evaluate(validateSectionBindingsInPage, sectionBindings);
      } catch {
        sectionBindingResults = sectionBindings.map(binding => ({
          sectionId: binding.sectionId,
          status: 'unmapped',
          code: 'binding_check_failed',
        }));
      }
      const referencedResources = await page.evaluate(collectReferencedResources, {
        includeScripts: !protectedFeed,
      });
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
      const resources = await resourceCollector.finish(referencedResources);
      const documentHtmlResult=evaluated.documentHtml;
      const imageSha256 = sha256(image);
      const domSha256 = sha256(evaluated.normalized);
      const mainHtml = normalizedMainHtml(body, protectedFeed, fingerprintAlgorithm);
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
        fingerprintAlgorithm,
        comparisonDetails: comparisonDetailsFor(comparisonInput, fingerprintAlgorithm),
        renderFingerprint: semanticRenderFingerprint(comparisonInput, fingerprintAlgorithm),
        responseBodySha256: sha256(body),
        responseHeaders: headers,
        marker: evaluated.marker,
        snapshotRoot: evaluated.snapshotRoot,
        finalUrl: response.url(),
        width: viewport.width,
        height: evaluated.height,
        responseDate: typeof headers.date === 'string' ? headers.date : null,
        sectionBindingResults,
        ...(includeDocumentHtml ? {documentHtml: documentHtmlResult} : {}),
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
  BC_FINGERPRINT_ALGORITHM,
  CORPORATE_FINGERPRINT_ALGORITHM,
  DEFAULT_ASSET_ORIGINS,
  FINGERPRINT_ALGORITHM,
  JOIN_FINGERPRINT_ALGORITHM,
  MAX_COMPARISON_RESOURCES,
  MAX_RESOURCE_BYTES,
  MAX_TOTAL_RESOURCE_BYTES,
  MAX_PAGE_HEIGHT,
  VIEWPORT,
  MOBILE_VIEWPORT,
  captureRequestPolicy,
  collectReferencedResources,
  comparisonDetailsFor,
  createChromiumRuntimePreparer,
  createProductionRenderer,
  createResourceCollector,
  fetchReferencedResource,
  looksLikeAccessOrErrorPage,
  normalizedAllowedOrigins,
  normalizedComparisonInput,
  normalizedMainHtml,
  normalizeMarkup,
  requiredImageFailures,
  settlePageImages,
  validateSectionBindingsInPage,
  waitForBirthFormReadiness,
  semanticRenderFingerprint,
  sha256,
};
