// base64url helpers built on top of `btoa` / `atob`, available everywhere
// (Node 16+, browsers, edge runtimes, Bun, Deno).

const FROM_B64URL_MAP = (s: string): string => {
  let out = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = out.length % 4;
  if (pad) out += '='.repeat(4 - pad);
  return out;
};

const TO_B64URL_MAP = (s: string): string =>
  s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export const base64urlEncodeBytes = (bytes: Uint8Array): string => {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return TO_B64URL_MAP(btoa(bin));
};

export const base64urlDecodeToBytes = (input: string): Uint8Array => {
  const bin = atob(FROM_B64URL_MAP(input));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

export const base64urlDecodeToString = (input: string): string => {
  // Use TextDecoder so non-ASCII claim values survive (display names, etc).
  return new TextDecoder().decode(base64urlDecodeToBytes(input));
};
