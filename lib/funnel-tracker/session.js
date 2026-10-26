const {
  createHmac,
  randomBytes,
  timingSafeEqual,
} = require('node:crypto');
const {OAuth2Client} = require('google-auth-library');

const COOKIE_NAME = '__Host-funnel-tracker';
const NONCE_COOKIE_NAME = '__Host-funnel-tracker-nonce';
const SESSION_SECONDS = 12 * 60 * 60;
const NONCE_SECONDS = 10 * 60;
const COMPANY_DOMAIN = 'zodiac.fm';

class AuthConfigurationError extends Error {}
class IdentityVerificationError extends Error {}

function configuredGoogleClientId(environment = process.env) {
  const value = environment.FUNNEL_TRACKER_GOOGLE_CLIENT_ID;
  if (typeof value !== 'string') return null;
  const clientId = value.trim();
  return clientId.length <= 512
    && /^[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId)
    ? clientId
    : null;
}

function configuredSessionSecret(environment = process.env) {
  const value = environment.FUNNEL_TRACKER_SESSION_SECRET;
  if (typeof value !== 'string') return null;
  const size = Buffer.byteLength(value, 'utf8');
  return size >= 32 && size <= 1024 ? value : null;
}

function authConfigured(environment = process.env) {
  return Boolean(configuredGoogleClientId(environment) && configuredSessionSecret(environment));
}

function unixSeconds(value) {
  const time = value instanceof Date ? value.getTime() : Number(value);
  return Math.floor(time / 1000);
}

function signature(encoded, environment) {
  const secret = configuredSessionSecret(environment);
  if (!secret) throw new AuthConfigurationError('tracker session signing is not configured');
  return createHmac('sha256', secret).update(encoded, 'ascii').digest('base64url');
}

function signedToken(payload, environment) {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${encoded}.${signature(encoded, environment)}`;
}

function cookieValues(req, name) {
  const header = req.headers.cookie;
  const source = Array.isArray(header) ? header.join(';') : header;
  if (typeof source !== 'string') return [];
  const values = [];
  for (const part of source.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    values.push(part.slice(separator + 1).trim());
  }
  return values;
}

function verifiedToken(token, environment) {
  if (!configuredSessionSecret(environment) || typeof token !== 'string' || token.length > 8192) return null;
  const pieces = token.split('.');
  if (pieces.length !== 2 || !pieces[0] || !pieces[1]) return null;
  let actual;
  let expected;
  try {
    actual = Buffer.from(pieces[1], 'base64url');
    expected = Buffer.from(signature(pieces[0], environment), 'base64url');
  } catch {
    return null;
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    return JSON.parse(Buffer.from(pieces[0], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function normalizedUser(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const sub = typeof value.sub === 'string' ? value.sub.trim() : '';
  const email = typeof value.email === 'string' ? value.email.trim().toLowerCase() : '';
  const name = typeof value.name === 'string' ? value.name.trim().replace(/\s+/g, ' ') : '';
  if (!/^[A-Za-z0-9_-]{6,255}$/.test(sub)
      || email.length > 254 || !/^[^@\s]+@zodiac\.fm$/.test(email)
      || name.length < 1 || name.length > 120
      || /[\u0000-\u001f\u007f]/.test(name)) return null;
  return {sub, email, name};
}

function issueLoginChallenge({
  environment = process.env,
  now = new Date(),
  nonceFactory = () => randomBytes(32).toString('base64url'),
} = {}) {
  if (!authConfigured(environment)) throw new AuthConfigurationError('tracker authentication is not configured');
  const nonce = nonceFactory();
  if (typeof nonce !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(nonce)) {
    throw new Error('invalid nonce');
  }
  const issuedAt = unixSeconds(now);
  const token = signedToken({v: 1, kind: 'nonce', nonce, iat: issuedAt, exp: issuedAt + NONCE_SECONDS}, environment);
  return {nonce, token};
}

function readLoginChallenge(req, {
  environment = process.env,
  now = () => new Date(),
} = {}) {
  const values = cookieValues(req, NONCE_COOKIE_NAME);
  if (values.length !== 1) return null;
  const payload = verifiedToken(values[0], environment);
  if (!payload || Object.keys(payload).length !== 5 || payload.v !== 1 || payload.kind !== 'nonce'
      || typeof payload.nonce !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(payload.nonce)
      || !Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp)
      || payload.exp !== payload.iat + NONCE_SECONDS) return null;
  const current = unixSeconds(now());
  return payload.iat <= current + 60 && payload.exp > current ? payload : null;
}

async function verifyGoogleCredential(credential, expectedNonce, {
  environment = process.env,
  client = null,
} = {}) {
  const clientId = configuredGoogleClientId(environment);
  if (!clientId || !configuredSessionSecret(environment)) {
    throw new AuthConfigurationError('tracker authentication is not configured');
  }
  if (typeof credential !== 'string' || credential.length < 64 || credential.length > 16384
      || typeof expectedNonce !== 'string') {
    throw new IdentityVerificationError('invalid Google credential');
  }
  let payload;
  try {
    const verifier = client || new OAuth2Client(clientId);
    const ticket = await verifier.verifyIdToken({idToken: credential, audience: clientId});
    payload = ticket.getPayload();
  } catch (error) {
    throw new IdentityVerificationError('Google credential verification failed', {cause: error});
  }
  const issuer = payload?.iss;
  const user = normalizedUser(payload);
  if (!user || payload.email_verified !== true || payload.hd !== COMPANY_DOMAIN
      || user.email.slice(user.email.lastIndexOf('@') + 1) !== COMPANY_DOMAIN
      || !['accounts.google.com', 'https://accounts.google.com'].includes(issuer)
      || payload.nonce !== expectedNonce) {
    throw new IdentityVerificationError('company Google identity required');
  }
  return user;
}

function createSession(userValue, {
  environment = process.env,
  now = new Date(),
} = {}) {
  const user = normalizedUser(userValue);
  if (!user) throw new Error('invalid verified user');
  const issuedAt = unixSeconds(now);
  return signedToken({v: 2, user, iat: issuedAt, exp: issuedAt + SESSION_SECONDS}, environment);
}

function readSession(req, {
  environment = process.env,
  now = () => new Date(),
} = {}) {
  if (!authConfigured(environment)) return null;
  const values = cookieValues(req, COOKIE_NAME);
  if (values.length !== 1) return null;
  const payload = verifiedToken(values[0], environment);
  const user = normalizedUser(payload?.user);
  if (!payload || Object.keys(payload).length !== 4 || payload.v !== 2 || !user
      || !Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp)
      || payload.exp !== payload.iat + SESSION_SECONDS) return null;
  const current = unixSeconds(now());
  return payload.iat <= current + 60 && payload.exp > current ? {...payload, user} : null;
}

function secureCookie(name, value, maxAge, expires) {
  return `${name}=${value}; Path=/; Max-Age=${maxAge}; Expires=${expires.toUTCString()}; HttpOnly; Secure; SameSite=Strict`;
}

function sessionCookie(token, now = new Date()) {
  return secureCookie(COOKIE_NAME, token, SESSION_SECONDS, new Date((unixSeconds(now) + SESSION_SECONDS) * 1000));
}

function nonceCookie(token, now = new Date()) {
  return secureCookie(NONCE_COOKIE_NAME, token, NONCE_SECONDS, new Date((unixSeconds(now) + NONCE_SECONDS) * 1000));
}

function clearCookie(name) {
  return secureCookie(name, '', 0, new Date(0));
}

function clearSessionCookie() {
  return clearCookie(COOKIE_NAME);
}

function clearNonceCookie() {
  return clearCookie(NONCE_COOKIE_NAME);
}

module.exports = {
  AuthConfigurationError,
  COOKIE_NAME,
  COMPANY_DOMAIN,
  IdentityVerificationError,
  NONCE_COOKIE_NAME,
  authConfigured,
  clearNonceCookie,
  clearSessionCookie,
  configuredGoogleClientId,
  configuredSessionSecret,
  createSession,
  issueLoginChallenge,
  nonceCookie,
  normalizedUser,
  readLoginChallenge,
  readSession,
  sessionCookie,
  verifyGoogleCredential,
};
