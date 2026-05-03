import { useCallback, useEffect, useRef, useState } from 'react';
import {
  loadTelegramLoginScript,
  type LoadTelegramLoginScriptOptions,
} from './loader';
import type {
  TelegramAuthResult,
  TelegramLoginInitOptions,
} from './types';

export interface UseTelegramLoginOptions extends TelegramLoginInitOptions {
  /**
   * Preload the SDK script as soon as the hook mounts (default: true).
   * Set to false if you'd rather defer the network request until the user
   * actually clicks the button.
   */
  preload?: boolean;

  /**
   * Override the script URL (proxying, self-hosting).
   */
  scriptSrc?: string;
}

export interface UseTelegramLoginResult {
  /**
   * Open Telegram's login popup. Resolves with the auth result — either
   * `{ id_token, user }` or `{ error }`. Always resolves; never rejects.
   */
  login: () => Promise<TelegramAuthResult>;

  /** True from when `login()` is called until the popup resolves. */
  loading: boolean;

  /** True once the SDK script has loaded successfully. */
  ready: boolean;

  /**
   * Most recent error from loading the SDK or invoking the popup. Cleared
   * on the next `login()` call. Note: a popup that the user closes is
   * surfaced through the `login()` result as `{ error: 'popup_closed' }`,
   * not via this state.
   */
  error: Error | undefined;
}

/**
 * Headless wrapper around `Telegram.Login.auth()`. Handles loading the
 * official SDK script, calling into it on demand, and adapting the
 * callback-based API to a Promise.
 *
 * @example
 * const { login, loading } = useTelegramLogin({ client_id: 123456 });
 * <Button onClick={async () => {
 *   const result = await login();
 *   if ('id_token' in result) postToBackend(result.id_token);
 * }} disabled={loading}>Continue with Telegram</Button>
 */
export function useTelegramLogin(
  options: UseTelegramLoginOptions,
): UseTelegramLoginResult {
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<Error | undefined>(undefined);

  // Latest options live in a ref so `login`'s identity stays stable across
  // renders, even when consumers don't memoize their options object.
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  // Preload the SDK so the popup opens instantly on click. Failing here
  // surfaces via `error`; `login()` will retry the load on first call.
  useEffect(() => {
    if (options.preload === false) return;
    let cancelled = false;
    const loaderOpts: LoadTelegramLoginScriptOptions = {};
    if (options.scriptSrc) loaderOpts.src = options.scriptSrc;
    loadTelegramLoginScript(loaderOpts)
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.preload, options.scriptSrc]);

  const login = useCallback((): Promise<TelegramAuthResult> => {
    const opts = optionsRef.current;
    setError(undefined);
    setLoading(true);
    const loaderOpts: LoadTelegramLoginScriptOptions = {};
    if (opts.scriptSrc) loaderOpts.src = opts.scriptSrc;
    return loadTelegramLoginScript(loaderOpts)
      .then(
        (login) =>
          new Promise<TelegramAuthResult>((resolve) => {
            try {
              login.auth(
                {
                  client_id: opts.client_id,
                  request_access: opts.request_access,
                  lang: opts.lang,
                  nonce: opts.nonce,
                },
                (result) => {
                  setLoading(false);
                  resolve(result);
                },
              );
            } catch (err) {
              setLoading(false);
              const e = err instanceof Error ? err : new Error(String(err));
              setError(e);
              resolve({ error: e.message });
            }
          }),
      )
      .catch((err: unknown): TelegramAuthResult => {
        setLoading(false);
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        return { error: e.message };
      });
  }, []);

  return { login, loading, ready, error };
}
