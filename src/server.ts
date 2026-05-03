import { base64urlDecodeToBytes, base64urlDecodeToString } from './internal/base64url';
import { getCrypto } from './internal/crypto';
import {
  DEFAULT_TELEGRAM_OIDC_ENDPOINTS,
  type TelegramIdTokenClaims,
  type TelegramOidcEndpoints,
  type TelegramTokenResponse,
} from './types';

// ---------------------------------------------------------------------------
// Discovery + JWKS (with simple in-process caching)
// ---------------------------------------------------------------------------

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const discoveryCache = new Map<string, CacheEntry<OpenIdConfiguration>>();
const jwksCache = new Map<string, CacheEntry<Jwks>>();

const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const fromCache = <T>(map: Map<string, CacheEntry<T>>, key: string): T | undefined => {
  const entry = map.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt < Date.now()) {
    map.delete(key);
    return undefined;
  }
  return entry.value;
};

const intoCache = <T>(
  map: Map<string, CacheEntry<T>>,
  key: string,
  value: T,
  ttlMs: number,
): void => {
  map.set(key, { value, expiresAt: Date.now() + ttlMs });
};

export interface OpenIdConfiguration {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  userinfo_endpoint?: string;
  scopes_supported?: string[];
  response_types_supported?: string[];
  id_token_signing_alg_values_supported?: string[];
  [extra: string]: unknown;
}

export interface FetchOptions {
  /** Custom fetch implementation (defaults to globalThis.fetch). */
  fetch?: typeof fetch;
  /** Cache TTL in milliseconds. Defaults to 1 hour. */
  cacheTtlMs?: number;
  /** Bypass cache and force a network request. */
  forceRefresh?: boolean;
}

const getFetch = (custom?: typeof fetch): typeof fetch => {
  const f = custom ?? (globalThis as { fetch?: typeof fetch }).fetch;
  if (!f) {
    throw new Error(
      '[react-telegram-oidc-login] global fetch is unavailable. Provide a `fetch` option or use Node 18+.',
    );
  }
  return f;
};

/** Fetches and caches the OIDC discovery document. */
export const getTelegramOpenIdConfig = async (
  options: FetchOptions & { issuer?: string } = {},
): Promise<OpenIdConfiguration> => {
  const issuer = options.issuer ?? DEFAULT_TELEGRAM_OIDC_ENDPOINTS.issuer;
  const url = `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`;
  const ttl = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;

  if (!options.forceRefresh) {
    const cached = fromCache(discoveryCache, url);
    if (cached) return cached;
  }

  const res = await getFetch(options.fetch)(url);
  if (!res.ok) {
    throw new Error(
      `[react-telegram-oidc-login] discovery fetch failed: ${res.status} ${res.statusText}`,
    );
  }
  const json = (await res.json()) as OpenIdConfiguration;
  intoCache(discoveryCache, url, json, ttl);
  return json;
};

interface Jwk {
  kty: string;
  kid?: string;
  use?: string;
  alg?: string;
  n?: string;
  e?: string;
  crv?: string;
  x?: string;
  y?: string;
  [extra: string]: unknown;
}
interface Jwks { keys: Jwk[] }

/** Fetches and caches the JWKS for ID-token verification. */
export const getTelegramJwks = async (
  options: FetchOptions & { jwksUri?: string } = {},
): Promise<Jwks> => {
  const url = options.jwksUri ?? DEFAULT_TELEGRAM_OIDC_ENDPOINTS.jwksUri;
  const ttl = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;

  if (!options.forceRefresh) {
    const cached = fromCache(jwksCache, url);
    if (cached) return cached;
  }

  const res = await getFetch(options.fetch)(url);
  if (!res.ok) {
    throw new Error(
      `[react-telegram-oidc-login] JWKS fetch failed: ${res.status} ${res.statusText}`,
    );
  }
  const json = (await res.json()) as Jwks;
  intoCache(jwksCache, url, json, ttl);
  return json;
};

// ---------------------------------------------------------------------------
// Token exchange
// ---------------------------------------------------------------------------

export interface ExchangeTelegramCodeOptions {
  clientId: string;
  /**
   * Bot's OAuth client secret. Required by Telegram's token endpoint
   * (Basic-auth). Never expose this to the browser.
   */
  clientSecret: string;
  /** Authorization code received on the callback. */
  code: string;
  /** PKCE verifier the browser generated (not the challenge). */
  codeVerifier: string;
  /** Same redirect URI used for the authorization request. */
  redirectUri: string;
  /** Override the token endpoint (e.g. for tests). */
  endpoints?: TelegramOidcEndpoints;
  /** Custom fetch implementation. */
  fetch?: typeof fetch;
}

const toBase64Ascii = (input: string): string => {
  // `btoa` is a global in Node 18+, browsers, edge runtimes, Bun, and Deno.
  if (typeof btoa !== 'function') {
    throw new Error(
      '[react-telegram-oidc-login] Global `btoa` is unavailable. Run on Node 18+, edge, Bun, Deno, or a browser.',
    );
  }
  return btoa(input);
};

/**
 * Exchanges an authorization code for tokens against Telegram's token endpoint.
 *
 * Per the docs the endpoint expects:
 *   - HTTP Basic auth: base64(client_id:client_secret)
 *   - application/x-www-form-urlencoded body with grant_type, code,
 *     redirect_uri, client_id, code_verifier
 */
export const exchangeTelegramCode = async (
  options: ExchangeTelegramCodeOptions,
): Promise<TelegramTokenResponse> => {
  const {
    clientId,
    clientSecret,
    code,
    codeVerifier,
    redirectUri,
    endpoints,
    fetch: customFetch,
  } = options;

  if (!clientId || !clientSecret) {
    throw new Error(
      '[react-telegram-oidc-login] `clientId` and `clientSecret` are both required for token exchange.',
    );
  }

  const url = endpoints?.tokenEndpoint ?? DEFAULT_TELEGRAM_OIDC_ENDPOINTS.tokenEndpoint;
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: codeVerifier,
  });

  const res = await getFetch(customFetch)(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${toBase64Ascii(`${clientId}:${clientSecret}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `[react-telegram-oidc-login] token exchange failed: ${res.status} ${res.statusText} — ${text}`,
    );
  }

  let parsed: TelegramTokenResponse;
  try {
    parsed = JSON.parse(text) as TelegramTokenResponse;
  } catch {
    throw new Error(
      `[react-telegram-oidc-login] token endpoint returned non-JSON response: ${text}`,
    );
  }
  if (!parsed.access_token || !parsed.id_token) {
    throw new Error(
      `[react-telegram-oidc-login] token response missing access_token or id_token: ${text}`,
    );
  }
  return parsed;
};

// ---------------------------------------------------------------------------
// ID token verification
// ---------------------------------------------------------------------------

interface JwtHeader {
  alg: string;
  kid?: string;
  typ?: string;
}

const ALG_TO_IMPORT: Record<
  string,
  { import: AlgorithmIdentifier | RsaHashedImportParams | EcKeyImportParams; verify: AlgorithmIdentifier | RsaPssParams | EcdsaParams }
> = {
  RS256: {
    import: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    verify: { name: 'RSASSA-PKCS1-v1_5' },
  },
  RS384: {
    import: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-384' },
    verify: { name: 'RSASSA-PKCS1-v1_5' },
  },
  RS512: {
    import: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-512' },
    verify: { name: 'RSASSA-PKCS1-v1_5' },
  },
  PS256: {
    import: { name: 'RSA-PSS', hash: 'SHA-256' },
    verify: { name: 'RSA-PSS', saltLength: 32 },
  },
  PS384: {
    import: { name: 'RSA-PSS', hash: 'SHA-384' },
    verify: { name: 'RSA-PSS', saltLength: 48 },
  },
  PS512: {
    import: { name: 'RSA-PSS', hash: 'SHA-512' },
    verify: { name: 'RSA-PSS', saltLength: 64 },
  },
  ES256: {
    import: { name: 'ECDSA', namedCurve: 'P-256' },
    verify: { name: 'ECDSA', hash: 'SHA-256' },
  },
  ES384: {
    import: { name: 'ECDSA', namedCurve: 'P-384' },
    verify: { name: 'ECDSA', hash: 'SHA-384' },
  },
};

const importJwk = async (jwk: Jwk, alg: string): Promise<CryptoKey> => {
  const algSpec = ALG_TO_IMPORT[alg];
  if (!algSpec) {
    throw new Error(`[react-telegram-oidc-login] unsupported JWT alg: ${alg}`);
  }
  return getCrypto().subtle.importKey(
    'jwk',
    jwk as JsonWebKey,
    algSpec.import,
    false,
    ['verify'],
  );
};

const findJwk = (jwks: Jwks, kid?: string): Jwk[] => {
  if (kid) {
    const exact = jwks.keys.find((k) => k.kid === kid);
    if (exact) return [exact];
  }
  // No kid provided, or no exact match — fall back to any signing key.
  return jwks.keys.filter((k) => !k.use || k.use === 'sig');
};

export interface VerifyTelegramIdTokenOptions {
  /** Expected `aud` claim. Should equal your bot's client_id. */
  clientId: string;
  /** Expected `iss` claim. Defaults to https://oauth.telegram.org. */
  issuer?: string;
  /** Expected nonce — should match the one generated when starting auth. */
  nonce?: string;
  /** Allowed clock skew in seconds (default: 60). */
  clockToleranceSeconds?: number;
  /** Override JWKS URL. */
  jwksUri?: string;
  /** Provide JWKS inline (skips network fetch). */
  jwks?: Jwks;
  /** Custom fetch implementation (used when no inline JWKS is provided). */
  fetch?: typeof fetch;
  /** JWKS cache TTL in ms (default: 1 hour). */
  cacheTtlMs?: number;
  /**
   * If verification fails because no JWK matched, force a one-shot JWKS
   * refresh and try again. Defaults to true.
   */
  retryOnJwksMiss?: boolean;
}

export class TelegramIdTokenError extends Error {
  readonly code:
    | 'malformed'
    | 'no_matching_jwk'
    | 'bad_signature'
    | 'bad_issuer'
    | 'bad_audience'
    | 'bad_nonce'
    | 'expired'
    | 'not_yet_valid';
  constructor(code: TelegramIdTokenError['code'], message: string) {
    super(message);
    this.name = 'TelegramIdTokenError';
    this.code = code;
  }
}

const decodeJwtParts = (
  jwt: string,
): { header: JwtHeader; payload: TelegramIdTokenClaims; signingInput: string; signature: Uint8Array } => {
  const parts = jwt.split('.');
  if (parts.length !== 3) {
    throw new TelegramIdTokenError('malformed', 'JWT must have exactly three segments.');
  }
  const [headerB64, payloadB64, signatureB64] = parts;
  let header: JwtHeader;
  let payload: TelegramIdTokenClaims;
  try {
    header = JSON.parse(base64urlDecodeToString(headerB64)) as JwtHeader;
    payload = JSON.parse(base64urlDecodeToString(payloadB64)) as TelegramIdTokenClaims;
  } catch (err) {
    throw new TelegramIdTokenError(
      'malformed',
      `Could not decode JWT header/payload: ${(err as Error).message}`,
    );
  }
  return {
    header,
    payload,
    signingInput: `${headerB64}.${payloadB64}`,
    signature: base64urlDecodeToBytes(signatureB64),
  };
};

const verifyClaims = (
  payload: TelegramIdTokenClaims,
  options: VerifyTelegramIdTokenOptions,
): void => {
  const tolerance = options.clockToleranceSeconds ?? 60;
  const now = Math.floor(Date.now() / 1000);

  const expectedIssuer = options.issuer ?? DEFAULT_TELEGRAM_OIDC_ENDPOINTS.issuer;
  if (payload.iss !== expectedIssuer) {
    throw new TelegramIdTokenError(
      'bad_issuer',
      `Expected iss "${expectedIssuer}", got "${payload.iss}".`,
    );
  }

  const audMatches = Array.isArray(payload.aud)
    ? payload.aud.includes(options.clientId)
    : payload.aud === options.clientId;
  if (!audMatches) {
    throw new TelegramIdTokenError(
      'bad_audience',
      `Expected aud "${options.clientId}", got ${JSON.stringify(payload.aud)}.`,
    );
  }

  if (typeof payload.exp !== 'number' || now - tolerance > payload.exp) {
    throw new TelegramIdTokenError('expired', 'ID token has expired.');
  }
  if (typeof payload.iat === 'number' && payload.iat - tolerance > now) {
    throw new TelegramIdTokenError(
      'not_yet_valid',
      'ID token `iat` is in the future beyond the allowed clock skew.',
    );
  }

  if (options.nonce !== undefined) {
    if (payload.nonce !== options.nonce) {
      throw new TelegramIdTokenError('bad_nonce', 'ID token `nonce` did not match.');
    }
  }
};

/**
 * Verifies a Telegram-issued ID token: signature against JWKS, then
 * `iss`/`aud`/`exp`/`iat`/`nonce` claims. Returns the parsed claims on success.
 *
 * Caches JWKS in process for one hour by default. If no JWK matches the
 * token's `kid`, the JWKS is fetched once more before giving up — this
 * handles key rotation transparently.
 */
export const verifyTelegramIdToken = async (
  jwt: string,
  options: VerifyTelegramIdTokenOptions,
): Promise<TelegramIdTokenClaims> => {
  if (!options.clientId) {
    throw new Error('[react-telegram-oidc-login] `clientId` is required for verification.');
  }

  const { header, payload, signingInput, signature } = decodeJwtParts(jwt);

  if (!ALG_TO_IMPORT[header.alg]) {
    throw new TelegramIdTokenError(
      'malformed',
      `Unsupported JWT alg: ${header.alg}`,
    );
  }

  const verifySignature = async (jwks: Jwks): Promise<boolean> => {
    const candidates = findJwk(jwks, header.kid);
    if (candidates.length === 0) return false;
    const algSpec = ALG_TO_IMPORT[header.alg];
    const data = new TextEncoder().encode(signingInput);
    for (const jwk of candidates) {
      try {
        const key = await importJwk(jwk, header.alg);
        const ok = await getCrypto().subtle.verify(
          algSpec.verify,
          key,
          signature as BufferSource,
          data as BufferSource,
        );
        if (ok) return true;
      } catch {
        // Try the next candidate — a JWK may be unusable for this alg.
      }
    }
    return false;
  };

  let jwks =
    options.jwks ??
    (await getTelegramJwks({
      jwksUri: options.jwksUri,
      fetch: options.fetch,
      cacheTtlMs: options.cacheTtlMs,
    }));

  let valid = await verifySignature(jwks);

  if (!valid && !options.jwks && options.retryOnJwksMiss !== false) {
    // Maybe the signing key rotated. Force a refresh once.
    jwks = await getTelegramJwks({
      jwksUri: options.jwksUri,
      fetch: options.fetch,
      cacheTtlMs: options.cacheTtlMs,
      forceRefresh: true,
    });
    valid = await verifySignature(jwks);
  }

  if (!valid) {
    throw new TelegramIdTokenError(
      'bad_signature',
      'No JWK in the JWKS produced a valid signature for this ID token.',
    );
  }

  verifyClaims(payload, options);
  return payload;
};

export type {
  TelegramIdTokenClaims,
  TelegramOidcEndpoints,
  TelegramTokenResponse,
} from './types';
