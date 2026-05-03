/**
 * Endpoints for Telegram's OAuth 2.0 / OpenID Connect implementation.
 *
 * Defaults match the well-known Telegram URLs. Override only if you are
 * proxying the flow through your own infrastructure.
 *
 * @see https://core.telegram.org/bots/telegram-login
 * @see https://oauth.telegram.org/.well-known/openid-configuration
 */
export interface TelegramOidcEndpoints {
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  jwksUri?: string;
  issuer?: string;
}

export const DEFAULT_TELEGRAM_OIDC_ENDPOINTS: Required<TelegramOidcEndpoints> = {
  authorizationEndpoint: 'https://oauth.telegram.org/auth',
  tokenEndpoint: 'https://oauth.telegram.org/token',
  jwksUri: 'https://oauth.telegram.org/.well-known/jwks.json',
  issuer: 'https://oauth.telegram.org',
};

/**
 * Standard scopes recognized by Telegram's OIDC server.
 * `openid` is always required.
 */
export type TelegramScope =
  | 'openid'
  | 'profile'
  | 'phone'
  | 'telegram:bot_access'
  | (string & {});

/**
 * Claims found in a verified Telegram ID token.
 *
 * `sub`, `iss`, `iat`, `exp`, and `aud` are present whenever `openid` is
 * requested. The remainder are conditional on the granted scopes.
 */
export interface TelegramIdTokenClaims {
  iss: string;
  sub: string;
  aud: string | string[];
  iat: number;
  exp: number;
  /** Random value passed in the auth request, echoed back. */
  nonce?: string;

  /** Telegram user id (numeric, returned as a number in the JWT payload). */
  id?: number;
  /** Display name. Requires the `profile` scope. */
  name?: string;
  /** Telegram username without the leading "@". Requires `profile`. */
  preferred_username?: string;
  /** Profile picture URL. Requires `profile`. */
  picture?: string;
  /** E.164 phone number including a leading "+". Requires `phone`. */
  phone_number?: string;

  [extraClaim: string]: unknown;
}

/**
 * Raw response body returned by Telegram's token endpoint on a successful
 * authorization-code exchange.
 */
export interface TelegramTokenResponse {
  access_token: string;
  token_type: 'Bearer' | string;
  expires_in: number;
  id_token: string;
  refresh_token?: string;
  scope?: string;
}

export type TelegramButtonSize = 'large' | 'medium' | 'small';

export interface TelegramLoginButtonProps {
  /**
   * The bot id Telegram assigned when the bot was created.
   * Used as the `client_id` in the OAuth request.
   */
  clientId: string;

  /**
   * Absolute URL the user is sent back to after authorizing.
   * Must match a redirect URI registered with @BotFather.
   */
  redirectUri: string;

  /**
   * OIDC scopes to request. `openid` is added automatically if missing.
   * Defaults to `['openid', 'profile']`.
   */
  scope?: TelegramScope[];

  /**
   * Optional `nonce` to bind the ID token to this login attempt.
   * If omitted a cryptographically random one is generated and stored.
   */
  nonce?: string;

  /** Override OIDC endpoints (e.g. for proxying through your own backend). */
  endpoints?: TelegramOidcEndpoints;

  /**
   * Storage backend for PKCE verifier, state, and nonce. Defaults to
   * `sessionStorage`. Must implement the basic `Storage` interface.
   */
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

  /**
   * Called with any error generated *while preparing the redirect*.
   * Errors that happen on the callback page are surfaced separately by
   * `consumeTelegramCallback` / `useTelegramAuthCallback`.
   */
  onError?: (error: Error) => void;

  /** Visual size of the button. Defaults to `"large"`. */
  buttonSize?: TelegramButtonSize;

  /** Corner radius in pixels. Defaults to 8. */
  cornerRadius?: number;

  /** Override the button label. */
  label?: React.ReactNode;

  /** Disable the button. */
  disabled?: boolean;

  /** Class on the underlying `<button>`. */
  className?: string;

  /** Inline style on the underlying `<button>`. */
  style?: React.CSSProperties;

  /** Optional id on the underlying `<button>`. */
  id?: string;

  /**
   * Replace the default rendering entirely. Receives a click handler that
   * starts the OIDC flow. When provided, `buttonSize`/`cornerRadius`/`label`
   * are ignored.
   */
  children?: (args: { onClick: () => void; loading: boolean }) => React.ReactNode;
}
