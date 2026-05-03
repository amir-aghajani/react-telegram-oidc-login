import { TelegramIcon } from './TelegramIcon';
import { useTelegramLogin } from './useTelegramLogin';
import type { TelegramLoginButtonProps } from './types';

const SIZE_TO_HEIGHT: Record<NonNullable<TelegramLoginButtonProps['buttonSize']>, number> = {
  large: 40,
  medium: 32,
  small: 24,
};

const SIZE_TO_FONT: Record<NonNullable<TelegramLoginButtonProps['buttonSize']>, number> = {
  large: 15,
  medium: 13,
  small: 12,
};

/**
 * Pre-styled button that initiates Telegram's OIDC authorization-code + PKCE
 * flow. For full styling control, use the `children` render-prop or reach for
 * `useTelegramLogin` directly.
 */
export function TelegramLoginButton(props: TelegramLoginButtonProps): JSX.Element {
  const {
    clientId,
    redirectUri,
    scope,
    nonce,
    endpoints,
    storage,
    onError,
    buttonSize = 'large',
    cornerRadius = 8,
    label,
    disabled,
    className,
    style,
    id,
    children,
  } = props;

  const { login, loading } = useTelegramLogin({
    clientId,
    redirectUri,
    scope,
    nonce,
    endpoints,
    storage,
    onError,
  });

  if (children) {
    return <>{children({ onClick: login, loading })}</>;
  }

  const height = SIZE_TO_HEIGHT[buttonSize];
  const fontSize = SIZE_TO_FONT[buttonSize];

  const defaultStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    height,
    padding: `0 ${Math.round(height * 0.4)}px`,
    fontSize,
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    fontWeight: 500,
    lineHeight: 1,
    color: '#fff',
    background: '#54a9eb',
    border: 'none',
    borderRadius: cornerRadius,
    cursor: disabled || loading ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
    ...style,
  };

  return (
    <button
      type="button"
      id={id}
      className={className}
      style={defaultStyle}
      disabled={disabled || loading}
      onClick={login}
    >
      <TelegramIcon style={{ width: '1.2em', height: '1.2em' }} />
      {label ?? (loading ? 'Redirecting…' : 'Log in with Telegram')}
    </button>
  );
}
