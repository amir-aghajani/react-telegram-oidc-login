import { generateNonce, generatePkcePair, generateState } from './pkce';
import {
  DEFAULT_TELEGRAM_OIDC_ENDPOINTS,
  type TelegramOidcEndpoints,
  type TelegramScope,
} from './types';

const STORAGE_KEY = 'tg_oidc_pending';

interface PendingAuthState {
  codeVerifier: string;
  state: string;
  nonce: string;
  redirectUri: string;
  clientId: string;
  scope: string;
  /** ISO timestamp the pending state was created (for staleness detection). */
  createdAt: string;
}

type SimpleStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const getDefaultStorage = (): SimpleStorage => {
  if (typeof window === 'undefined' || !window.sessionStorage) {
    throw new Error(
      '[react-telegram-oidc-login] sessionStorage is unavailable. ' +
        'Pass a custom `storage` option, or call this from a browser context.',
    );
  }
  return window.sessionStorage;
};

const normalizeScope = (scope: TelegramScope[] | undefined): string => {
  const list = scope && scope.length > 0 ? [...scope] : ['openid', 'profile'];
  if (!list.includes('openid')) list.unshift('openid');
  return Array.from(new Set(list)).join(' ');
};

export interface StartTelegramAuthOptions {
  clientId: string;
  redirectUri: string;
  scope?: TelegramScope[];
  /** Optional pre-supplied nonce. A random one is generated if omitted. */
  nonce?: string;
  /** Optional pre-supplied state. A random one is generated if omitted. */
  state?: string;
  endpoints?: TelegramOidcEndpoints;
  storage?: SimpleStorage;
  /**
   * Extra parameters to append to the authorization URL (e.g. `prompt`,
   * `login_hint`). Values are URL-encoded automatically.
   */
  extraParams?: Record<string, string>;
}

export interface StartTelegramAuthResult {
  /** Fully-formed authorization URL the user should be navigated to. */
  url: string;
  /** State persisted in storage. Useful for tests / SSR. */
  state: string;
  nonce: string;
  codeVerifier: string;
}

/**
 * Build the authorization URL and persist the PKCE verifier, state, and
 * nonce in storage. Does NOT navigate — call `window.location.assign(result.url)`
 * (or use `<TelegramLoginButton>`, which does that for you).
 */
export const startTelegramAuth = async (
  options: StartTelegramAuthOptions,
): Promise<StartTelegramAuthResult> => {
  const {
    clientId,
    redirectUri,
    scope,
    endpoints,
    storage = getDefaultStorage(),
    extraParams,
  } = options;

  if (!clientId) throw new Error('[react-telegram-oidc-login] `clientId` is required');
  if (!redirectUri) throw new Error('[react-telegram-oidc-login] `redirectUri` is required');

  const pkce = await generatePkcePair();
  const state = options.state ?? generateState();
  const nonce = options.nonce ?? generateNonce();
  const scopeString = normalizeScope(scope);

  const pending: PendingAuthState = {
    codeVerifier: pkce.codeVerifier,
    state,
    nonce,
    redirectUri,
    clientId,
    scope: scopeString,
    createdAt: new Date().toISOString(),
  };
  storage.setItem(STORAGE_KEY, JSON.stringify(pending));

  const authEndpoint =
    endpoints?.authorizationEndpoint ?? DEFAULT_TELEGRAM_OIDC_ENDPOINTS.authorizationEndpoint;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopeString,
    state,
    nonce,
    code_challenge: pkce.codeChallenge,
    code_challenge_method: pkce.codeChallengeMethod,
  });
  if (extraParams) {
    for (const [k, v] of Object.entries(extraParams)) {
      if (v != null) params.set(k, String(v));
    }
  }

  return {
    url: `${authEndpoint}?${params.toString()}`,
    state,
    nonce,
    codeVerifier: pkce.codeVerifier,
  };
};

export interface ConsumeTelegramCallbackOptions {
  /**
   * The URL to read `code`, `state`, `error` from. Defaults to
   * `window.location.href`.
   */
  url?: string;
  storage?: SimpleStorage;
  /**
   * If true (default) the pending state is deleted from storage after a
   * successful read. Set to false to inspect it without consuming.
   */
  clear?: boolean;
}

export interface TelegramCallbackResult {
  code: string;
  /** PKCE verifier — send to your backend with `code`. */
  codeVerifier: string;
  /** The state value, already validated against storage. */
  state: string;
  /** The nonce that was sent on the auth request. */
  nonce: string;
  /** The redirect URI used for the original request. */
  redirectUri: string;
  /** The client id used for the original request. */
  clientId: string;
  /** The scope that was actually requested. */
  scope: string;
}

export class TelegramAuthError extends Error {
  readonly code:
    | 'no_pending_state'
    | 'state_mismatch'
    | 'missing_code'
    | 'oauth_error'
    | 'malformed_state'
    | 'storage_unavailable';
  readonly oauthError?: string;
  readonly oauthErrorDescription?: string;

  constructor(
    code: TelegramAuthError['code'],
    message: string,
    extras?: { oauthError?: string; oauthErrorDescription?: string },
  ) {
    super(message);
    this.name = 'TelegramAuthError';
    this.code = code;
    this.oauthError = extras?.oauthError;
    this.oauthErrorDescription = extras?.oauthErrorDescription;
  }
}

/**
 * Read the auth-server response from the current URL, validate `state` against
 * the pending values stashed by `startTelegramAuth`, and return everything
 * needed to do the server-side code exchange.
 *
 * Throws `TelegramAuthError` on any validation failure. By default, deletes
 * the pending state so a stray reload can't replay the callback.
 */
export const consumeTelegramCallback = (
  options: ConsumeTelegramCallbackOptions = {},
): TelegramCallbackResult => {
  const storage = options.storage ?? getDefaultStorage();
  const href =
    options.url ?? (typeof window !== 'undefined' ? window.location.href : undefined);
  if (!href) {
    throw new TelegramAuthError(
      'storage_unavailable',
      '`url` was not provided and `window.location` is unavailable.',
    );
  }

  const params = new URL(href).searchParams;
  const oauthError = params.get('error');
  if (oauthError) {
    if (options.clear !== false) storage.removeItem(STORAGE_KEY);
    throw new TelegramAuthError(
      'oauth_error',
      `Telegram returned error "${oauthError}"` +
        (params.get('error_description')
          ? `: ${params.get('error_description')}`
          : ''),
      {
        oauthError,
        oauthErrorDescription: params.get('error_description') ?? undefined,
      },
    );
  }

  const code = params.get('code');
  const state = params.get('state');
  if (!code) {
    throw new TelegramAuthError('missing_code', 'No `code` parameter on the callback URL.');
  }

  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) {
    throw new TelegramAuthError(
      'no_pending_state',
      'No pending Telegram auth state in storage. Did the user start the flow in a different tab?',
    );
  }

  let pending: PendingAuthState;
  try {
    pending = JSON.parse(raw) as PendingAuthState;
  } catch {
    if (options.clear !== false) storage.removeItem(STORAGE_KEY);
    throw new TelegramAuthError(
      'malformed_state',
      'Pending Telegram auth state was corrupt and could not be parsed.',
    );
  }

  if (!state || state !== pending.state) {
    if (options.clear !== false) storage.removeItem(STORAGE_KEY);
    throw new TelegramAuthError(
      'state_mismatch',
      'OAuth `state` parameter did not match the stored value.',
    );
  }

  if (options.clear !== false) storage.removeItem(STORAGE_KEY);

  return {
    code,
    codeVerifier: pending.codeVerifier,
    state: pending.state,
    nonce: pending.nonce,
    redirectUri: pending.redirectUri,
    clientId: pending.clientId,
    scope: pending.scope,
  };
};

/**
 * Clears any pending PKCE state from storage. Useful if the user backs out of
 * the flow before reaching the callback page.
 */
export const clearPendingTelegramAuth = (storage?: SimpleStorage): void => {
  (storage ?? getDefaultStorage()).removeItem(STORAGE_KEY);
};
