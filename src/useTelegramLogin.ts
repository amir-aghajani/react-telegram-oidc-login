import { useCallback, useEffect, useRef, useState } from 'react';
import { startTelegramAuth, type StartTelegramAuthOptions } from './auth';

export interface UseTelegramLoginOptions extends StartTelegramAuthOptions {
  /**
   * What to do once the authorization URL is ready. Defaults to navigating
   * the current window to it. Override to open a popup, push to a router,
   * write to a state machine, etc.
   */
  onRedirect?: (url: string) => void;
  /**
   * Called if preparing the redirect throws (e.g. storage unavailable).
   * Without this, the error is rethrown from `login()`.
   */
  onError?: (error: Error) => void;
}

export interface UseTelegramLoginResult {
  /**
   * Kick off the OIDC redirect. Returns when the redirect has been initiated
   * (or when an error has been handled).
   */
  login: () => Promise<void>;
  /** True from when `login()` is called until the navigation begins. */
  loading: boolean;
  /** Most recent error from `login()`. Cleared on the next call. */
  error: Error | undefined;
}

/**
 * Headless equivalent of `<TelegramLoginButton>`: gives you a `login`
 * function and React state for `loading` / `error`, so you can wire it up
 * to any button — shadcn/ui, Radix, MUI, your own — without inheriting the
 * default styling.
 *
 * @example
 * const { login, loading } = useTelegramLogin({
 *   clientId: process.env.NEXT_PUBLIC_TELEGRAM_OIDC_CLIENT_ID!,
 *   redirectUri: 'https://example.com/auth/telegram/callback',
 * });
 *
 * <Button onClick={login} disabled={loading}>
 *   <TelegramIcon className="mr-2 h-4 w-4" />
 *   Continue with Telegram
 * </Button>
 */
export function useTelegramLogin(
  options: UseTelegramLoginOptions,
): UseTelegramLoginResult {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | undefined>(undefined);

  // Latest options live in a ref so `login`'s identity stays stable across
  // renders — important when consumers don't memoize their option object.
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  const login = useCallback(async () => {
    const opts = optionsRef.current;
    setError(undefined);
    setLoading(true);
    try {
      const { url } = await startTelegramAuth({
        clientId: opts.clientId,
        redirectUri: opts.redirectUri,
        scope: opts.scope,
        nonce: opts.nonce,
        state: opts.state,
        endpoints: opts.endpoints,
        storage: opts.storage,
        extraParams: opts.extraParams,
      });
      if (opts.onRedirect) {
        opts.onRedirect(url);
      } else if (typeof window !== 'undefined') {
        window.location.assign(url);
      }
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      setError(e);
      setLoading(false);
      if (opts.onError) opts.onError(e);
      else throw e;
    }
  }, []);

  return { login, loading, error };
}
