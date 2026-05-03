# react-telegram-oidc-login

> A small, headless, **unopinionated** React + server toolkit around Telegram's [official Login SDK](https://core.telegram.org/bots/telegram-login).

[![npm version](https://img.shields.io/npm/v/react-telegram-oidc-login.svg)](https://www.npmjs.com/package/react-telegram-oidc-login)
[![license](https://img.shields.io/npm/l/react-telegram-oidc-login.svg)](./LICENSE)
[![types](https://img.shields.io/npm/types/react-telegram-oidc-login.svg)](./dist/index.d.ts)

This package does two things:

1. **In the browser** — loads Telegram's official `telegram-login.js` SDK on demand and wraps it in a React-idiomatic component + hook. The SDK opens a **popup** to `oauth.telegram.org`, the user authorizes, and the popup posts an **OIDC ID token** back to the parent window via `postMessage`.
2. **On the server** — verifies that ID token's signature against Telegram's JWKS plus the standard `iss` / `aud` / `exp` / `iat` / `nonce` claims, so you can trust the user identity it carries.

Everything else — sessions, cookies, redirects, error UI, persistence — is your application's job. Drop it into any React or Next.js codebase without inheriting a session model.

---

## Table of contents

- [Why this package](#why-this-package)
- [Features](#features)
- [Install](#install)
- [BotFather setup](#botfather-setup)
- [How the flow works](#how-the-flow-works)
- [Quick start](#quick-start)
- [Headless usage (shadcn/ui, Radix, MUI, …)](#headless-usage-shadcnui-radix-mui-)
- [Server-side ID-token verification](#server-side-id-token-verification)
- [Framework recipes](#framework-recipes)
  - [Next.js App Router](#nextjs-app-router)
  - [Next.js Pages Router](#nextjs-pages-router)
  - [Vite / CRA SPA + any backend](#vite--cra-spa--any-backend)
- [API reference](#api-reference)
- [Configuration](#configuration)
- [Security notes](#security-notes)
- [Troubleshooting](#troubleshooting)
- [Author & license](#author--license)

---

## Why this package

Telegram ships an official SDK at `https://telegram.org/js/telegram-login.js` that handles the popup + `postMessage` dance for you. It exposes a global `window.Telegram.Login` with `init` / `open` / `auth` methods.

That's great, but it's a script-tag global, not a React-shaped API. It also needs:

- to be loaded exactly once, idempotently
- to be loaded *before* you interact with it (so you have to deal with `<script async>` lifecycle)
- a callback adapter to React idioms (`Promise`, `useState`, etc.)
- server-side ID-token verification, which the SDK doesn't do (it just decodes the JWT payload, **without verifying the signature**)

This package wraps all of that:

- a typed `loadTelegramLoginScript()` that resolves once `window.Telegram.Login` is ready
- a `<TelegramLoginButton>` component and a headless `useTelegramLogin()` hook, both Promise-based
- a server-only `verifyTelegramIdToken()` that does the JWKS-backed JWT verification properly

It is **not** an auth library — there is no session manager, no cookie helper, no React context, no NextAuth adapter. You bring those.

## Features

- Wraps Telegram's official **`telegram-login.js`** SDK
- **Three rendering tiers** — pre-styled `<TelegramLoginButton>`, render-prop, or fully headless via `useTelegramLogin` + `<TelegramIcon>`
- Promise-based `login()` API instead of the SDK's callback style
- **ID-token verification** with JWKS — `RS256`, `RS384`, `RS512`, `PS256`, `ES256`, `ES384`
- **JWKS caching** (1 h default) with automatic refresh on a `kid` miss
- Idempotent script loading — concurrent calls share the in-flight promise; an existing `<script>` tag in your HTML is reused
- **Zero dependencies** — pure Web Crypto + `fetch`
- **Universal runtime** — Node 18+, Vercel Edge, Cloudflare Workers, Bun, Deno, modern browsers
- **TypeScript-first**, declaration maps, source maps
- **`"use client"`** baked into the client bundle for React Server Components
- ESM + CJS, side-effect-free, tree-shakeable
- React **17, 18, 19**

## Install

```bash
npm i react-telegram-oidc-login
# pnpm add react-telegram-oidc-login
# yarn add react-telegram-oidc-login
# bun add react-telegram-oidc-login
```

## BotFather setup

1. Open [@BotFather](https://t.me/BotFather), create or pick a bot.
2. Note the bot's **client id** (numeric) per the [Telegram Login docs](https://core.telegram.org/bots/telegram-login).
3. Register the **origin/page URL** that will host the button — the SDK uses your page URL as the OIDC `redirect_uri` automatically.
4. Set environment variables:

```bash
# Public — used to build the popup auth URL.
NEXT_PUBLIC_TELEGRAM_CLIENT_ID=123456

# Server-only — used to verify ID tokens.
TELEGRAM_CLIENT_ID=123456
```

> Unlike the legacy iframe widget there's no shared bot token to expose; verification uses Telegram's public JWKS.

## How the flow works

```
┌─ your page ────────────────┐                           ┌─ oauth.telegram.org ─┐
│ <TelegramLoginButton>      │   (1) telegram-login.js   │                      │
│   or                       │ ◄──────────────────────── │ /js/telegram-login.js│
│ useTelegramLogin           │                           │                      │
│                            │   (2) opens popup         │                      │
│                            │ ────────────────────────► │ /auth?response_type= │
│                            │                           │ post_message …       │
│                            │   (3) postMessage         │                      │
│                            │ ◄──────────────────────── │ { id_token, … }      │
└────────────────────────────┘                           └──────────────────────┘
              │
              │ (4) you POST id_token to your backend
              ▼
┌─ your backend ─────────────┐
│ verifyTelegramIdToken      │
│ → trusted claims           │
└────────────────────────────┘
```

1. The SDK script loads the first time you mount the component or call `useTelegramLogin`.
2. On click, the SDK opens a 550×650 popup at `https://oauth.telegram.org/auth?response_type=post_message&…`.
3. After the user authorizes, the popup posts the result back to the opener via `window.postMessage`. The SDK invokes your callback with `{ id_token, user }` (or `{ error }`).
4. Your backend verifies the `id_token` and decides what the user identity means in your app.

Because the response delivery is `postMessage` (no auth code, no token endpoint), there's no PKCE and no client secret. The whole thing is one round-trip.

## Quick start

```tsx
import { TelegramLoginButton, type TelegramAuthResult } from 'react-telegram-oidc-login';

export function SignIn() {
  return (
    <TelegramLoginButton
      client_id={Number(process.env.NEXT_PUBLIC_TELEGRAM_CLIENT_ID)}
      request_access={['phone', 'write']}
      nonce={crypto.randomUUID()}
      onAuth={async (result: TelegramAuthResult) => {
        if (result.error) {
          // 'popup_closed' is the most common; surface or retry
          console.warn(result.error);
          return;
        }
        // Send the id_token to your backend for verification.
        await fetch('/api/telegram', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id_token: result.id_token }),
        });
      }}
    />
  );
}
```

That's it for the client. **The package handles loading the script, opening the popup, listening for the postMessage, and decoding the JWT for the `user` UI hint.** Your `onAuth` runs once Telegram has handed back a result.

## Headless usage (shadcn/ui, Radix, MUI, …)

Use `useTelegramLogin` plus `<TelegramIcon>` (single-path SVG, `currentColor`, `1em` square) to drop Telegram login into any design system without inheriting the SDK's CSS.

```tsx
'use client';
import { useState } from 'react';
import { useTelegramLogin, TelegramIcon } from 'react-telegram-oidc-login';
import { Button } from '@/components/ui/button'; // shadcn/ui

export function ContinueWithTelegram() {
  const { login, loading, ready, error } = useTelegramLogin({
    client_id: 123456,
    request_access: 'phone',
    nonce: crypto.randomUUID(),
  });
  const [authError, setAuthError] = useState<string>();

  const onClick = async () => {
    const result = await login();
    if (result.error) return setAuthError(result.error);
    await fetch('/api/telegram', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id_token: result.id_token }),
    });
  };

  return (
    <>
      <Button variant="outline" onClick={onClick} disabled={!ready || loading}>
        <TelegramIcon className="mr-2 h-4 w-4" />
        {loading ? 'Opening Telegram…' : 'Continue with Telegram'}
      </Button>
      {(error || authError) && (
        <p className="text-sm text-destructive">{error?.message ?? authError}</p>
      )}
    </>
  );
}
```

`<TelegramIcon>` accepts every standard `SVGProps<SVGSVGElement>`. It defaults to `1em` square and inherits its color, so Tailwind classes / inline styles / CSS variables all just work.

The same shape is exposed via the `children` render-prop on `<TelegramLoginButton>` if you'd rather not pull in a hook:

```tsx
<TelegramLoginButton client_id={123456} onAuth={handle}>
  {({ onClick, loading }) => (
    <Button onClick={onClick} disabled={loading}>
      <TelegramIcon className="mr-2 h-4 w-4" />
      Continue with Telegram
    </Button>
  )}
</TelegramLoginButton>
```

## Server-side ID-token verification

> The SDK gives you a `user` field decoded from the ID token **without verifying the signature**. Treat it as a UI hint only. Always verify on the server before persisting anything or issuing a session.

```ts
import { verifyTelegramIdToken } from 'react-telegram-oidc-login/server';

const claims = await verifyTelegramIdToken(idToken, {
  clientId: 123456,
  nonce, // pass the nonce you sent in `useTelegramLogin` / `<TelegramLoginButton>`
});

// `claims` is now trusted. The package is done.
// You decide: set a cookie, mint a JWT, write to a DB, return JSON…
```

`verifyTelegramIdToken` checks:

- Signature against Telegram's JWKS (`RS256`, `RS384`, `RS512`, `PS256`, `ES256`, `ES384`)
- `iss === "https://oauth.telegram.org"` (override via `issuer`)
- `aud === clientId` (string or number — coerced to string)
- `exp` and `iat` within the configured clock skew (default ±60s)
- `nonce` if you pass one

JWKS is cached in process for 1 h. On a `kid` miss it's refreshed once before failing, so key rotation is transparent.

## Framework recipes

### Next.js App Router

```tsx
// app/sign-in/page.tsx
'use client';
import { TelegramLoginButton } from 'react-telegram-oidc-login';

export default function SignInPage() {
  return (
    <TelegramLoginButton
      client_id={Number(process.env.NEXT_PUBLIC_TELEGRAM_CLIENT_ID)}
      onAuth={async (result) => {
        if (result.error) return alert(result.error);
        await fetch('/api/telegram', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id_token: result.id_token }),
        });
      }}
    />
  );
}
```

```ts
// app/api/telegram/route.ts
import { NextResponse } from 'next/server';
import { verifyTelegramIdToken } from 'react-telegram-oidc-login/server';

export async function POST(req: Request) {
  const { id_token } = await req.json();
  try {
    const claims = await verifyTelegramIdToken(id_token, {
      clientId: process.env.TELEGRAM_CLIENT_ID!,
    });
    // → from here it's your app's responsibility (cookies, sessions, etc.)
    return NextResponse.json({ claims });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 401 });
  }
}
```

The route works on the **edge runtime** too — add `export const runtime = 'edge';`. The package only uses `fetch` and Web Crypto.

### Next.js Pages Router

```ts
// pages/api/telegram.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { verifyTelegramIdToken } from 'react-telegram-oidc-login/server';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const claims = await verifyTelegramIdToken(req.body.id_token, {
      clientId: process.env.TELEGRAM_CLIENT_ID!,
    });
    res.json({ claims });
  } catch (err) {
    res.status(401).json({ error: (err as Error).message });
  }
}
```

### Vite / CRA SPA + any backend

In a pure SPA, the client just calls `useTelegramLogin` (or renders `<TelegramLoginButton>`) and POSTs the `id_token` to *your* backend (Express, Fastify, NestJS, FastAPI calling the verifier through Node, anything). The verifier code is identical to the Next.js examples — there's nothing Next-specific about it.

```ts
// Express
import express from 'express';
import { verifyTelegramIdToken } from 'react-telegram-oidc-login/server';

const app = express();
app.use(express.json());

app.post('/api/telegram', async (req, res) => {
  try {
    const claims = await verifyTelegramIdToken(req.body.id_token, {
      clientId: process.env.TELEGRAM_CLIENT_ID!,
    });
    res.json({ claims });
  } catch (err) {
    res.status(401).json({ error: (err as Error).message });
  }
});
```

## API reference

### Client (`react-telegram-oidc-login`)

| Export | Signature | Notes |
| --- | --- | --- |
| `<TelegramLoginButton>` | `(props: TelegramLoginButtonProps) => JSX.Element` | Pre-styled button. Pass `children` as a render-prop for full control. |
| `useTelegramLogin(options)` | `=> { login: () => Promise<TelegramAuthResult>; loading; ready; error? }` | Headless hook. `login()` always resolves; the popup-closed case lands in the result as `{ error: 'popup_closed' }`. |
| `<TelegramIcon>` | `(props: SVGProps<SVGSVGElement>) => JSX.Element` | Single-path SVG, `currentColor`, `1em`. |
| `loadTelegramLoginScript(options?)` | `=> Promise<TelegramLoginGlobal>` | Idempotently injects `telegram-login.js`. Concurrent calls share the in-flight promise. |
| `TELEGRAM_LOGIN_SCRIPT_URL` | `string` | The default script URL, in case you want to embed it manually in HTML. |

### Server (`react-telegram-oidc-login/server`)

| Export | Signature | Notes |
| --- | --- | --- |
| `verifyTelegramIdToken(jwt, options)` | `=> Promise<TelegramIdTokenClaims>` | JWKS-backed signature verification + claim checks. Refreshes JWKS once on `kid` miss. |
| `getTelegramOpenIdConfig(options?)` | `=> Promise<OpenIdConfiguration>` | Discovery doc fetch + cache (1 h default). |
| `getTelegramJwks(options?)` | `=> Promise<{ keys: Jwk[] }>` | JWKS fetch + cache. |
| `TelegramIdTokenError` | `class extends Error` | `.code`: `malformed` \| `bad_signature` \| `bad_issuer` \| `bad_audience` \| `bad_nonce` \| `expired` \| `not_yet_valid` \| `no_matching_jwk`. |
| `TELEGRAM_OIDC_ISSUER` / `TELEGRAM_OIDC_JWKS_URI` | `string` | Default endpoint constants. |

Supported JWT algorithms: `RS256`, `RS384`, `RS512`, `PS256`, `ES256`, `ES384`.

### `<TelegramLoginButton>` props

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `client_id` | `string \| number` | — | **Required.** Bot id from BotFather. |
| `request_access` | `'phone' \| 'write' \| Array<…>` | — | Adds the `phone` and/or `telegram:bot_access` scope. |
| `nonce` | `string` | — | Recommended — bind the resulting ID token to this attempt. |
| `lang` | `string` | — | ISO 639-1 language code for the popup UI. |
| `onAuth` | `(result: TelegramAuthResult) => void` | — | Called with `{ id_token, user }` or `{ error }`. |
| `onError` | `(err: Error) => void` | — | Called only if the SDK script fails to load. |
| `scriptSrc` | `string` | `https://telegram.org/js/telegram-login.js` | Override the SDK URL (self-hosted mirror). |
| `variant` | `TelegramButtonStyle \| Array<…>` | — | One or more of: `'square'`, `'outlined'`, `'icon'`, `'shine'` (mapped to the SDK's `data-style` attribute). |
| `label` | `React.ReactNode` | `"Log in with Telegram"` | Button text override. Ignored if `children` is provided. |
| `disabled` | `boolean` | `false` | Disable the button. |
| `className` / `style` / `id` | `string` / `CSSProperties` / `string` | — | Standard pass-throughs. |
| `children` | `(args: { onClick, loading }) => ReactNode` | — | Render-prop. When provided, all SDK styling is bypassed. |

### `TelegramAuthResult`

```ts
type TelegramAuthResult =
  | { id_token: string; user: TelegramIdTokenClaims; error?: undefined }
  | { error: string; id_token?: undefined; user?: undefined };
```

`error` is whatever string the SDK reports — common values: `"popup_closed"` (user dismissed the popup), `"missing id_token"`, `"malformed id_token"`, plus any error returned by the OAuth server.

### `TelegramIdTokenClaims`

```ts
interface TelegramIdTokenClaims {
  iss: string;                 // 'https://oauth.telegram.org'
  sub: string;                 // OIDC subject identifier
  aud: string | string[];      // your client_id
  iat: number;                 // issued-at, unix seconds
  exp: number;                 // expires-at, unix seconds
  nonce?: string;              // echoed back from the auth request

  id?: number;                 // Telegram user id
  name?: string;               // display name (with `profile`, which is always requested)
  preferred_username?: string; // Telegram username, no leading "@"
  picture?: string;            // profile photo URL
  phone_number?: string;       // E.164. Requires `request_access: 'phone'`.

  [key: string]: unknown;      // forward-compatible
}
```

## Configuration

### Preloading

By default the hook calls `loadTelegramLoginScript()` on mount so the popup opens instantly when the user clicks. Disable if you'd rather defer the network request:

```ts
const { login } = useTelegramLogin({ client_id: 123456, preload: false });
// `login()` will lazy-load the script the first time it's invoked.
```

### Self-hosted SDK

Override the script URL globally via `scriptSrc`:

```tsx
<TelegramLoginButton client_id={123456} scriptSrc="/static/telegram-login.js" onAuth={handle} />
```

```ts
useTelegramLogin({ client_id: 123456, scriptSrc: '/static/telegram-login.js' });
```

### Inline JWKS

Skip the network fetch in the verifier if you already have the JWKS:

```ts
await verifyTelegramIdToken(idToken, { clientId: 123456, jwks: cachedJwks });
```

### Clock skew

Default tolerance is ±60 seconds. Tighten via `clockToleranceSeconds`:

```ts
await verifyTelegramIdToken(idToken, { clientId: 123456, clockToleranceSeconds: 30 });
```

### Custom `fetch`

Useful for proxying, mocking in tests, or pinning to a specific HTTP client:

```ts
await verifyTelegramIdToken(idToken, { clientId: 123456, fetch: customFetch });
```

## Security notes

- **Always verify the `id_token` server-side** — the `user` field on `TelegramAuthResult` is the JWT payload decoded by the SDK *without* signature verification. Treat it as a UI hint, not authentication.
- **Pass `nonce`** to both the auth request and the verifier. It binds the ID token to this specific login attempt and prevents replay.
- The SDK uses **`window.postMessage`** to deliver the result. The verifier in your backend is the trust boundary, not the popup.
- The verifier checks `iss`, `aud`, `exp`, `iat` (with configurable clock skew) on every call. If you pass `nonce`, that's checked too.
- `<TelegramLoginButton>` does not render any user-controlled HTML, so there's no XSS surface from the package itself. Be mindful of where you display claim values like `name` or `preferred_username` — render as text, not HTML.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Click does nothing | Pop-up blocker, or your bot isn't registered for this domain | Allow popups for this site; check that the page URL is registered with BotFather. |
| `error: "popup_closed"` | User closed the popup before authorizing | Surface a "try again" UI or call `login()` again. |
| Popup opens but never returns a result | Browser is enforcing `Cross-Origin-Opener-Policy: same-origin`, breaking `window.opener.postMessage` | Set `Cross-Origin-Opener-Policy: same-origin-allow-popups` (or omit COOP) on the page that hosts the button. |
| `TelegramIdTokenError(bad_audience)` | `clientId` passed to the verifier doesn't match `client_id` from sign-in | Use the same numeric bot id everywhere. The verifier coerces both sides to strings, so `123456` and `"123456"` compare equal. |
| `TelegramIdTokenError(bad_signature)` | Token tampered with, or JWKS rotated and your inline JWKS is stale | If you passed `jwks: …` inline, refresh it. Otherwise the package retries with a fresh JWKS automatically; a persistent failure means the token is genuinely invalid. |
| `TelegramIdTokenError(expired)` | The `exp` claim is in the past | Telegram tokens are short-lived. Verify your server clock; bump `clockToleranceSeconds` if drift is the cause. |
| `TelegramIdTokenError(bad_nonce)` | The nonce passed to the verifier doesn't match the one in the token | Forward the nonce you sent to `useTelegramLogin` / `<TelegramLoginButton>` through to your verifier call. |
| Script fails to load | Network blocking `telegram.org`, or your CSP forbids it | Whitelist `telegram.org` in your CSP, or self-host the script and pass `scriptSrc`. |

## Author & license

Maintained by **Amir Aghajani**.

[MIT](./LICENSE) © 2026 Amir Aghajani.
