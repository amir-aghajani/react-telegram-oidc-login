import { base64urlEncodeBytes } from './internal/base64url';
import { getCrypto, randomBytes } from './internal/crypto';

/**
 * RFC 7636 PKCE pair. The verifier stays in the browser; the challenge is
 * sent on the authorization request and re-verified by the authorization
 * server when the code is exchanged.
 */
export interface PkcePair {
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
}

const VERIFIER_BYTES = 32; // 256 bits, base64url-encoded -> 43 chars

/**
 * Generate a fresh PKCE verifier + S256 challenge.
 *
 * The verifier is 256 bits of random data, base64url-encoded — well within
 * the 43–128 character range allowed by RFC 7636 §4.1.
 */
export const generatePkcePair = async (): Promise<PkcePair> => {
  const codeVerifier = base64urlEncodeBytes(randomBytes(VERIFIER_BYTES));
  const digest = await getCrypto().subtle.digest(
    'SHA-256',
    new TextEncoder().encode(codeVerifier),
  );
  return {
    codeVerifier,
    codeChallenge: base64urlEncodeBytes(new Uint8Array(digest)),
    codeChallengeMethod: 'S256',
  };
};

/** Generate a random URL-safe string suitable for the OAuth `state` param. */
export const generateState = (bytes = 16): string =>
  base64urlEncodeBytes(randomBytes(bytes));

/** Generate a random nonce for OIDC ID-token replay protection. */
export const generateNonce = (bytes = 16): string =>
  base64urlEncodeBytes(randomBytes(bytes));
