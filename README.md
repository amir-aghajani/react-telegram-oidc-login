# react-telegram-oidc-login

A small, **unopinionated** React + server toolkit for Telegram's [OAuth 2.0 / OpenID Connect login](https://core.telegram.org/bots/telegram-login) — the modern replacement for the iframe-based Login Widget.

This package handles **the OIDC protocol only**:

- Build the auth URL with PKCE
- Validate `state` on the callback
- Exchange the code for tokens against Telegram's token endpoint
- Verify ID tokens against Telegram's JWKS

What you do with the resulting `id_token` claims — sessions, cookies, redirects, error UI, your database — is entirely up to you. Drop it into any React or Next.js app without bringing along an opinion about how your auth should work.

- React 17/18/19, Next.js (App & Pages Router), Remix, Vite, CRA
- ESM + CJS + `.d.ts`, with `"use client"` baked into the client bundle for RSC
- Zero dependencies. Pure Web Crypto + `fetch` — Node 18+, Vercel Edge, Cloudflare Workers, Bun, Deno

## Install

```bash
npm i react-telegram-oidc-login
```

You'll need a Telegram bot configured for OAuth via [@BotFather](https://t.me/BotFather) — note your bot id (`client_id`) and client secret, and register your callback URL.

## Mental model

There are three places code runs:

1. **Sign-in page** — render `<TelegramLoginButton>` (or call `startTelegramAuth()` yourself). The browser is redirected to `oauth.telegram.org/auth`.
2. **Callback page** — Telegram redirects back here with `?code=...&state=...`. Use `consumeTelegramCallback()` (or `useTelegramAuthCallback()`) to validate `state` and pull `{ code, codeVerifier, ... }` out. **The package's job ends here.**
3. **Your backend** — receive the data the user sends from step 2, call `exchangeTelegramCode()`, then `verifyTelegramIdToken()`, then do whatever you want with the claims. The `client_secret` lives here and never anywhere else.

## 1. Sign-in page

```tsx
import { TelegramLoginButton } from 'react-telegram-oidc-login';

<TelegramLoginButton
  clientId="123456"
  redirectUri="https://example.com/auth/telegram/callback"
  scope={['openid', 'profile']}
/>
```

Or build the URL yourself:

```ts
import { startTelegramAuth } from 'react-telegram-oidc-login';

const { url } = await startTelegramAuth({
  clientId: '123456',
  redirectUri: 'https://example.com/auth/telegram/callback',
});
window.location.assign(url);
```

`startTelegramAuth` writes the PKCE verifier, `state`, and `nonce` to `sessionStorage` (override via the `storage` option). It returns the URL — **it does not navigate**, so you decide whether to redirect, open a popup, or do nothing.

### Headless: bring your own button (shadcn/ui, Radix, MUI, …)

Use `useTelegramLogin` plus the bundled `<TelegramIcon>` (single-path SVG using `currentColor`) to drop Telegram login into any design system.

```tsx
import { useTelegramLogin, TelegramIcon } from 'react-telegram-oidc-login';
import { Button } from '@/components/ui/button'; // shadcn/ui

export function ContinueWithTelegram() {
  const { login, loading, error } = useTelegramLogin({
    clientId: process.env.NEXT_PUBLIC_TELEGRAM_OIDC_CLIENT_ID!,
    redirectUri: 'https://example.com/auth/telegram/callback',
    scope: ['openid', 'profile'],
  });

  return (
    <>
      <Button variant="outline" onClick={login} disabled={loading}>
        <TelegramIcon className="mr-2 h-4 w-4" />
        {loading ? 'Redirecting…' : 'Continue with Telegram'}
      </Button>
      {error && <p className="text-sm text-destructive">{error.message}</p>}
    </>
  );
}
```

`<TelegramIcon>` accepts every standard SVG prop. It defaults to `1em` square and inherits its color, so styling with Tailwind / `className` / inline `style` all just works.

Need to override the redirect itself (e.g. open a popup or hand off to a router)? Pass `onRedirect`:

```tsx
const { login } = useTelegramLogin({
  clientId, redirectUri,
  onRedirect: (url) => window.open(url, 'tg-login', 'width=500,height=700'),
});
```

The same shape is also exposed via the `children` render-prop on `<TelegramLoginButton>` if you'd rather not pull in a hook:

```tsx
<TelegramLoginButton clientId="…" redirectUri="…">
  {({ onClick, loading }) => (
    <Button onClick={onClick} disabled={loading}>
      <TelegramIcon className="mr-2 h-4 w-4" />
      Continue with Telegram
    </Button>
  )}
</TelegramLoginButton>
```

## 2. Callback page

You decide what to do with the result. The package only validates `state` and hands you back the data Telegram sent.

```tsx
'use client';
import { useEffect } from 'react';
import { useTelegramAuthCallback } from 'react-telegram-oidc-login';

export default function CallbackPage() {
  const { status, callback, error } = useTelegramAuthCallback();

  useEffect(() => {
    if (status !== 'success' || !callback) return;
    // Do whatever you want here — POST to your backend, push to a router,
    // dispatch to a store, hand off to NextAuth/Auth.js, etc.
    fetch('/your/own/endpoint', {
      method: 'POST',
      body: JSON.stringify(callback),
    });
  }, [status, callback]);

  if (status === 'pending' || status === 'idle') return <p>Signing in…</p>;
  if (status === 'error') return <p>Login failed: {error?.message}</p>;
  return <p>Done.</p>;
}
```

Or skip the hook and call the function directly:

```ts
import {
  consumeTelegramCallback,
  TelegramAuthError,
} from 'react-telegram-oidc-login';

try {
  const { code, codeVerifier, redirectUri, nonce } = consumeTelegramCallback();
  // …send these wherever you want.
} catch (err) {
  if (err instanceof TelegramAuthError) {
    // err.code: 'no_pending_state' | 'state_mismatch' | 'missing_code'
    //         | 'oauth_error' | 'malformed_state' | 'storage_unavailable'
  }
}
```

`consumeTelegramCallback()` clears the PKCE state from storage on first read, so a stray reload of the callback URL can't replay the code.

## 3. Your backend (token exchange + ID-token verification)

Two independent functions. Call them however fits your app.

```ts
import {
  exchangeTelegramCode,
  verifyTelegramIdToken,
} from 'react-telegram-oidc-login/server';

const tokens = await exchangeTelegramCode({
  clientId: process.env.TELEGRAM_OIDC_CLIENT_ID!,
  clientSecret: process.env.TELEGRAM_OIDC_CLIENT_SECRET!,
  code,
  codeVerifier,
  redirectUri,
});

const claims = await verifyTelegramIdToken(tokens.id_token, {
  clientId: process.env.TELEGRAM_OIDC_CLIENT_ID!,
  nonce, // pass the nonce you got from the callback — recommended
});

// `claims` is now trusted. The package is done.
// You decide: set a cookie, mint a JWT, write to a DB, return JSON…
```

### Next.js App Router (Route Handler)

```ts
// app/api/telegram/route.ts
import { NextResponse } from 'next/server';
import {
  exchangeTelegramCode,
  verifyTelegramIdToken,
} from 'react-telegram-oidc-login/server';

export async function POST(req: Request) {
  const { code, codeVerifier, redirectUri, nonce } = await req.json();

  try {
    const tokens = await exchangeTelegramCode({
      clientId: process.env.TELEGRAM_OIDC_CLIENT_ID!,
      clientSecret: process.env.TELEGRAM_OIDC_CLIENT_SECRET!,
      code,
      codeVerifier,
      redirectUri,
    });
    const claims = await verifyTelegramIdToken(tokens.id_token, {
      clientId: process.env.TELEGRAM_OIDC_CLIENT_ID!,
      nonce,
    });

    // → from here it's your app's responsibility (cookies, sessions, etc).
    return NextResponse.json({ claims });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 401 });
  }
}
```

### Next.js Pages Router (API Route)

```ts
// pages/api/telegram.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import {
  exchangeTelegramCode,
  verifyTelegramIdToken,
} from 'react-telegram-oidc-login/server';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();
  const { code, codeVerifier, redirectUri, nonce } = req.body;
  try {
    const tokens = await exchangeTelegramCode({
      clientId: process.env.TELEGRAM_OIDC_CLIENT_ID!,
      clientSecret: process.env.TELEGRAM_OIDC_CLIENT_SECRET!,
      code, codeVerifier, redirectUri,
    });
    const claims = await verifyTelegramIdToken(tokens.id_token, {
      clientId: process.env.TELEGRAM_OIDC_CLIENT_ID!,
      nonce,
    });
    res.json({ claims });
  } catch (err) {
    res.status(401).json({ error: (err as Error).message });
  }
}
```

## API surface

### `react-telegram-oidc-login` (client)

| Export | What it does |
| --- | --- |
| `<TelegramLoginButton>` | Pre-styled button that calls `startTelegramAuth()` then `window.location.assign(url)`. Pass `children` as a render-prop to use your own button. |
| `useTelegramLogin(options)` | **Headless** alternative — returns `{ login, loading, error }` so you can wire any button (shadcn/ui, Radix, MUI, anything). |
| `<TelegramIcon>` | Single-path SVG of the Telegram paper-plane glyph, `currentColor`, `1em`. Accepts all standard `SVGProps`. |
| `startTelegramAuth(options)` | Generates PKCE + state + nonce, stashes them in storage, returns `{ url, state, nonce, codeVerifier }`. Does not navigate. |
| `consumeTelegramCallback(options?)` | Reads the current URL, validates `state`, returns `{ code, codeVerifier, redirectUri, nonce, clientId, scope, state }`. Throws `TelegramAuthError` on failure. |
| `useTelegramAuthCallback(options?)` | Thin React state wrapper around `consumeTelegramCallback`. Returns `{ status, callback, error, run }`. No fetching. |
| `clearPendingTelegramAuth()` | Discard any pending PKCE state from storage (e.g. if the user backs out). |
| `generatePkcePair()` / `generateState()` / `generateNonce()` | Web Crypto primitives, exposed in case you need them. |
| `TelegramAuthError` | Thrown by callback validation; `.code` tells you why. |
| `DEFAULT_TELEGRAM_OIDC_ENDPOINTS` | The default `oauth.telegram.org` URLs, in case you want to inspect or override them. |

### `react-telegram-oidc-login/server`

| Export | What it does |
| --- | --- |
| `exchangeTelegramCode(options)` | POSTs to the token endpoint with HTTP Basic auth and PKCE verifier. Returns the raw `TelegramTokenResponse` (`access_token`, `id_token`, `expires_in`, …). |
| `verifyTelegramIdToken(jwt, options)` | Verifies signature against JWKS, then `iss`/`aud`/`exp`/`iat`/`nonce` claims. Returns parsed `TelegramIdTokenClaims`. |
| `getTelegramOpenIdConfig(options?)` | Fetch + cache the discovery document. Optional. |
| `getTelegramJwks(options?)` | Fetch + cache the JWKS. Optional — `verifyTelegramIdToken` calls this for you. |
| `TelegramIdTokenError` | Thrown by the verifier; `.code` is one of `malformed`, `bad_signature`, `bad_issuer`, `bad_audience`, `bad_nonce`, `expired`, `not_yet_valid`, `no_matching_jwk`. |

`verifyTelegramIdToken` supports `RS256`, `RS384`, `RS512`, `PS256`, `ES256`, `ES384`. JWKS is cached in process for 1 hour by default; on a `kid` miss it refreshes once before failing, so key rotation is transparent.

## `<TelegramLoginButton>` props

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `clientId` | `string` | — | **Required.** |
| `redirectUri` | `string` | — | **Required.** |
| `scope` | `TelegramScope[]` | `['openid', 'profile']` | `openid` is added if missing. |
| `nonce` | `string` | random | Pre-supplied nonce. |
| `endpoints` | `TelegramOidcEndpoints` | Telegram defaults | Override auth/token/JWKS endpoints. |
| `storage` | `Pick<Storage, 'getItem'\|'setItem'\|'removeItem'>` | `sessionStorage` | Where the PKCE verifier / state / nonce are kept across the redirect. |
| `onError` | `(err: Error) => void` | — | Fires only if generating the redirect throws (e.g. storage unavailable). |
| `buttonSize` / `cornerRadius` / `label` / `disabled` / `className` / `style` / `id` | — | — | Standard styling options for the default button. |
| `children` | `(args: { onClick, loading }) => ReactNode` | — | Render-prop. When provided, all built-in styling is skipped — bring your own button. |

## License

MIT
