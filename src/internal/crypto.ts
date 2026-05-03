export const getCrypto = (): Crypto => {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c?.subtle) {
    throw new Error(
      '[react-telegram-oidc-login] Web Crypto (globalThis.crypto.subtle) is unavailable. ' +
        'This package requires Node 18+, an edge runtime, Bun, Deno, or a modern browser.',
    );
  }
  return c;
};

export const randomBytes = (length: number): Uint8Array => {
  const out = new Uint8Array(length);
  getCrypto().getRandomValues(out);
  return out;
};
