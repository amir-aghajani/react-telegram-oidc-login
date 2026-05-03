/**
 * Claims found in a verified Telegram ID token.
 *
 * `sub`, `iss`, `iat`, `exp`, and `aud` are present whenever `openid` is
 * requested (the SDK always requests it). The remainder are conditional on
 * the granted `request_access` value.
 */
export interface TelegramIdTokenClaims {
  iss: string;
  sub: string;
  aud: string | string[];
  iat: number;
  exp: number;
  /** Random value passed in the auth request, echoed back. */
  nonce?: string;

  /** Telegram user id (numeric). */
  id?: number;
  /** Display name. Always present when the SDK is used (it requests `profile`). */
  name?: string;
  /** Telegram username without the leading "@". */
  preferred_username?: string;
  /** Profile picture URL. */
  picture?: string;
  /** E.164 phone number. Requires `request_access: 'phone'`. */
  phone_number?: string;

  [extraClaim: string]: unknown;
}

/**
 * Permissions to request from the user. `'phone'` adds the OIDC `phone`
 * scope, `'write'` adds `telegram:bot_access` (lets the bot DM the user).
 */
export type TelegramRequestAccess = 'phone' | 'write';

/**
 * Options accepted by `Telegram.Login.init` / `Telegram.Login.auth`.
 *
 * @see https://core.telegram.org/bots/telegram-login
 */
export interface TelegramLoginInitOptions {
  /** Numeric bot id assigned by @BotFather. */
  client_id: string | number;
  /** Permissions to request beyond the default `openid profile`. */
  request_access?: TelegramRequestAccess | TelegramRequestAccess[];
  /** ISO 639-1 language code for the popup UI. */
  lang?: string;
  /** Random nonce to bind the resulting ID token to this attempt. */
  nonce?: string;
}

/**
 * The shape Telegram's SDK calls your callback with.
 *
 * On success: `{ id_token, user }`. The `user` field is the JWT payload
 * decoded *without* signature verification — treat it as untrusted UI hints
 * and verify `id_token` on the server before persisting anything.
 *
 * On failure: `{ error }`. Common values include `"popup_closed"` (user
 * dismissed the popup), `"missing id_token"`, `"malformed id_token"`, and
 * any error returned by the OAuth server.
 */
export type TelegramAuthResult =
  | { id_token: string; user: TelegramIdTokenClaims; error?: undefined }
  | { id_token?: undefined; user?: undefined; error: string };

export type TelegramAuthCallback = (result: TelegramAuthResult) => void;

/**
 * Subset of `window.Telegram.Login` that this package depends on.
 */
export interface TelegramLoginGlobal {
  init(options: TelegramLoginInitOptions, callback?: TelegramAuthCallback): void;
  open(callback?: TelegramAuthCallback): void;
  auth(options: TelegramLoginInitOptions, callback?: TelegramAuthCallback): void;
  close?(): void;
}

export type TelegramButtonStyle = 'default' | 'square' | 'outlined' | 'icon' | 'shine';

export interface TelegramLoginButtonProps extends TelegramLoginInitOptions {
  /**
   * Called with the auth result. If omitted, the result is still returned
   * by `useTelegramLogin().login()` for consumers using the headless path.
   */
  onAuth?: TelegramAuthCallback;

  /**
   * Called if the SDK script fails to load (offline, blocked, etc.).
   */
  onError?: (error: Error) => void;

  /** Override the script URL (e.g. self-hosted mirror). */
  scriptSrc?: string;

  /**
   * One or more visual variants supported by Telegram's bundled CSS.
   * Pass an array to combine them, e.g. `['outlined', 'shine']`.
   * Ignored if `children` is provided.
   */
  variant?: TelegramButtonStyle | TelegramButtonStyle[];

  /** Override the button label. Ignored if `children` is provided. */
  label?: React.ReactNode;

  /** Disable the button. */
  disabled?: boolean;

  /** Class merged onto the underlying `<button>`. */
  className?: string;

  /** Inline style on the underlying `<button>`. */
  style?: React.CSSProperties;

  /** id on the underlying `<button>`. */
  id?: string;

  /**
   * Render-prop for full control over markup. Receives `onClick` and
   * `loading`. When provided, all built-in styling is skipped.
   */
  children?: (args: { onClick: () => void; loading: boolean }) => React.ReactNode;
}
