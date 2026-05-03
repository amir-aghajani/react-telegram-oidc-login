import type { TelegramLoginGlobal } from './types';

declare global {
  interface Window {
    Telegram?: { Login?: TelegramLoginGlobal };
  }
}

export const TELEGRAM_LOGIN_SCRIPT_URL = 'https://telegram.org/js/telegram-login.js';

export interface LoadTelegramLoginScriptOptions {
  /** Override the script URL (e.g. when self-hosting or proxying). */
  src?: string;
  /** Override the document used to attach the script (e.g. an iframe doc). */
  document?: Document;
}

let inflight: Promise<TelegramLoginGlobal> | null = null;

/**
 * Inject Telegram's official `telegram-login.js` once and resolve with the
 * `window.Telegram.Login` global once it's ready. Concurrent calls share the
 * same in-flight promise. Subsequent calls after a successful load resolve
 * immediately.
 */
export const loadTelegramLoginScript = (
  options: LoadTelegramLoginScriptOptions = {},
): Promise<TelegramLoginGlobal> => {
  if (typeof window === 'undefined') {
    return Promise.reject(
      new Error(
        '[react-telegram-oidc-login] loadTelegramLoginScript must be called in the browser.',
      ),
    );
  }

  if (window.Telegram?.Login) {
    return Promise.resolve(window.Telegram.Login);
  }
  if (inflight) return inflight;

  const doc = options.document ?? document;
  const src = options.src ?? TELEGRAM_LOGIN_SCRIPT_URL;

  inflight = new Promise<TelegramLoginGlobal>((resolve, reject) => {
    // If a script tag with the same src is already on the page (e.g. the user
    // dropped one in their HTML), wait for it instead of duplicating it.
    // `script.src` always resolves to an absolute URL, so resolve `src` the
    // same way before comparing — and avoid embedding user input in a CSS
    // selector altogether.
    let resolvedSrc = src;
    try {
      resolvedSrc = new URL(src, doc.baseURI).href;
    } catch {
      // Fall back to the raw string; relative URLs without a baseURI just
      // won't match an existing absolute script tag, which is fine.
    }
    const existing = Array.from(doc.getElementsByTagName('script')).find(
      (s) => s.src === resolvedSrc,
    );
    const onReady = (): void => {
      const login = window.Telegram?.Login;
      if (login) resolve(login);
      else reject(new Error('[react-telegram-oidc-login] Script loaded but window.Telegram.Login is missing.'));
    };
    const onFail = (): void => {
      inflight = null;
      reject(new Error(`[react-telegram-oidc-login] Failed to load ${src}.`));
    };

    if (existing) {
      if (window.Telegram?.Login) {
        onReady();
      } else {
        existing.addEventListener('load', onReady, { once: true });
        existing.addEventListener('error', onFail, { once: true });
      }
      return;
    }

    const script = doc.createElement('script');
    script.src = src;
    script.async = true;
    script.defer = true;
    script.addEventListener('load', onReady, { once: true });
    script.addEventListener('error', onFail, { once: true });
    (doc.head ?? doc.body ?? doc.documentElement).appendChild(script);
  });

  return inflight;
};
