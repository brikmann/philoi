// AES-256-GCM for secrets that have to sit in Postgres but must not be usable from a database
// dump alone — currently the Google Calendar refresh token (GCAL_INTEGRATION_SPEC.md: "Store the
// refresh token encrypted, server-side only").
//
// The key lives in an Edge Function secret, NOT in the database:
//   supabase secrets set GCAL_TOKEN_ENC_KEY="$(openssl rand -base64 32)"
// That separation is the entire security property. Encrypting inside Postgres with pgcrypto and a
// key stored in the same Postgres would protect against nothing that matters here.
//
// Ciphertext format: "v1.<base64url iv>.<base64url ciphertext+tag>". The version prefix is what
// makes a future key rotation possible without guessing at what a bare blob was encrypted with.

const KEY_ENV = 'GCAL_TOKEN_ENC_KEY';
const VERSION = 'v1';
const IV_BYTES = 12; // 96-bit nonce — the size AES-GCM is actually specified for.

let cachedKey: CryptoKey | null = null;

async function getKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  const raw = Deno.env.get(KEY_ENV);
  if (!raw) {
    throw new Error(`${KEY_ENV} is not set — run: supabase secrets set ${KEY_ENV}="$(openssl rand -base64 32)"`);
  }
  const bytes = decodeBase64(raw.trim());
  if (bytes.length !== 32) {
    throw new Error(`${KEY_ENV} must be 32 bytes of base64 (openssl rand -base64 32); got ${bytes.length}.`);
  }
  cachedKey = await crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  return cachedKey;
}

export async function encryptSecret(plaintext: string): Promise<string> {
  const key = await getKey();
  // A fresh random IV per encryption — reusing one under the same key breaks GCM outright.
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext))
  );
  return `${VERSION}.${encodeBase64Url(iv)}.${encodeBase64Url(ciphertext)}`;
}

export async function decryptSecret(payload: string): Promise<string> {
  const parts = payload.split('.');
  if (parts.length !== 3 || parts[0] !== VERSION) {
    throw new Error('Unrecognized ciphertext format.');
  }
  const key = await getKey();
  const iv = decodeBase64(parts[1]);
  const ciphertext = decodeBase64(parts[2]);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}

// base64url in, standard base64 tolerated — the key secret is pasted by a human from
// `openssl rand -base64 32`, which emits standard base64 with padding.
// Return type deliberately inferred rather than annotated `: Uint8Array` — since TS 5.7 the bare
// name means Uint8Array<ArrayBufferLike>, which WebCrypto's BufferSource won't accept, while the
// inferred type from `new Uint8Array(n)` is the Uint8Array<ArrayBuffer> it wants. Annotating it
// breaks the crypto.subtle calls above on both Deno and tsc.
function decodeBase64(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
