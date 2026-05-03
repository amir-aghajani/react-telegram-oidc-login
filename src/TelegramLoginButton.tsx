import { useCallback, useEffect, useRef } from 'react';
import { useTelegramLogin } from './useTelegramLogin';
import type {
  TelegramAuthResult,
  TelegramButtonStyle,
  TelegramLoginButtonProps,
} from './types';

const buildClassName = (extra: string | undefined): string =>
  extra ? `tg-auth-button ${extra}` : 'tg-auth-button';

const buildDataStyle = (
  variant: TelegramLoginButtonProps['variant'],
): string | undefined => {
  if (!variant) return undefined;
  const list: TelegramButtonStyle[] = Array.isArray(variant) ? variant : [variant];
  const filtered = list.filter((v) => v !== 'default');
  return filtered.length > 0 ? filtered.join(' ') : undefined;
};

/**
 * Renders Telegram's official login button. On click, opens Telegram's
 * popup via `window.Telegram.Login.auth()` and reports the result through
 * `onAuth`.
 *
 * For full styling control, pass a `children` render-prop or use
 * `useTelegramLogin` directly.
 */
export function TelegramLoginButton(props: TelegramLoginButtonProps): JSX.Element {
  const {
    client_id,
    request_access,
    lang,
    nonce,
    onAuth,
    onError,
    scriptSrc,
    variant,
    label,
    disabled,
    className,
    style,
    id,
    children,
  } = props;

  const { login, loading, error } = useTelegramLogin({
    client_id,
    request_access,
    lang,
    nonce,
    scriptSrc,
  });

  const onAuthRef = useRef(onAuth);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onAuthRef.current = onAuth;
    onErrorRef.current = onError;
  });

  // Surface SDK load failures through `onError`. Popup-closed lands in the
  // auth result, not here.
  useEffect(() => {
    if (error && onErrorRef.current) onErrorRef.current(error);
  }, [error]);

  const onClick = useCallback(async () => {
    const result: TelegramAuthResult = await login();
    if (onAuthRef.current) onAuthRef.current(result);
  }, [login]);

  if (children) {
    return <>{children({ onClick, loading })}</>;
  }

  return (
    <button
      type="button"
      id={id}
      className={buildClassName(className)}
      data-style={buildDataStyle(variant)}
      style={style}
      disabled={disabled || loading}
      onClick={onClick}
    >
      {label ?? (loading ? 'Opening Telegram…' : 'Log in with Telegram')}
    </button>
  );
}
