import { useEffect, useRef, useState } from 'react';
import {
  consumeTelegramCallback,
  TelegramAuthError,
  type ConsumeTelegramCallbackOptions,
  type TelegramCallbackResult,
} from './auth';

export type TelegramAuthCallbackStatus = 'idle' | 'pending' | 'success' | 'error';

export interface UseTelegramAuthCallbackOptions extends ConsumeTelegramCallbackOptions {
  /**
   * Run automatically on mount (default: true). Set to false to call `run()`
   * yourself — useful if you need to wait for some other state to settle.
   */
  auto?: boolean;
}

export interface UseTelegramAuthCallbackResult {
  status: TelegramAuthCallbackStatus;
  /** The validated callback data, available once `status === "success"`. */
  callback: TelegramCallbackResult | undefined;
  /** A `TelegramAuthError` (or generic `Error`) when `status === "error"`. */
  error: Error | undefined;
  /** Manually trigger the read. Idempotent — only the first call has effect. */
  run: () => void;
}

/**
 * Reads the OIDC callback off the current URL and validates `state`. Nothing
 * else — the resulting `{ code, codeVerifier, redirectUri, nonce, ... }` is
 * yours to use however you like (typically: send to your backend).
 *
 * Idempotent under React 18 StrictMode: the underlying read clears the
 * pending state from storage, so we guard against the double-invoke.
 */
export function useTelegramAuthCallback(
  options: UseTelegramAuthCallbackOptions = {},
): UseTelegramAuthCallbackResult {
  const { auto = true, ...consumeOptions } = options;

  const [status, setStatus] = useState<TelegramAuthCallbackStatus>('idle');
  const [callback, setCallback] = useState<TelegramCallbackResult | undefined>(undefined);
  const [error, setError] = useState<Error | undefined>(undefined);

  const startedRef = useRef(false);

  const run = (): void => {
    if (startedRef.current) return;
    startedRef.current = true;

    setStatus('pending');
    try {
      const result = consumeTelegramCallback(consumeOptions);
      setCallback(result);
      setStatus('success');
    } catch (err) {
      const e =
        err instanceof TelegramAuthError
          ? err
          : err instanceof Error
            ? err
            : new Error(String(err));
      setError(e);
      setStatus('error');
    }
  };

  useEffect(() => {
    if (auto) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { status, callback, error, run };
}
