// Tests for the per-integration key parameterization in token-crypto.ts — run with:
//
//   deno test --allow-env supabase/functions/_shared/token-crypto.test.ts
//
// What is pinned: gcal's default-argument path still uses GCAL_TOKEN_ENC_KEY (every gcal call site
// passes no keyEnv), and the two integrations' keys never bleed into each other — including through
// the in-isolate key cache, which was a single slot before Spotify existed.
import { assertEquals, assertNotEquals, assertRejects } from 'jsr:@std/assert@1';

import { decryptSecret, encryptSecret } from './token-crypto.ts';

const GCAL_KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const SPOTIFY_KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));
Deno.env.set('GCAL_TOKEN_ENC_KEY', GCAL_KEY);
Deno.env.set('SPOTIFY_TOKEN_ENC_KEY', SPOTIFY_KEY);

Deno.test('token-crypto keys are per integration', async (t) => {
  await t.step('the default path round-trips and IS the gcal key', async () => {
    const byDefault = await encryptSecret('gcal-refresh');
    assertEquals(await decryptSecret(byDefault), 'gcal-refresh');
    assertEquals(await decryptSecret(byDefault, 'GCAL_TOKEN_ENC_KEY'), 'gcal-refresh');

    const explicit = await encryptSecret('gcal-refresh', 'GCAL_TOKEN_ENC_KEY');
    assertEquals(await decryptSecret(explicit), 'gcal-refresh');
  });

  await t.step('spotify round-trips under its own key', async () => {
    const sealed = await encryptSecret('spotify-refresh', 'SPOTIFY_TOKEN_ENC_KEY');
    assertEquals(await decryptSecret(sealed, 'SPOTIFY_TOKEN_ENC_KEY'), 'spotify-refresh');
  });

  // Positive control above, negative here: if both paths shared a cached key these would decrypt.
  // Run AFTER the gcal key has been cached, which is exactly the warm-isolate order that a
  // single-slot cache got wrong.
  await t.step('neither key opens the other integration\'s ciphertext', async () => {
    const spotifySealed = await encryptSecret('spotify-refresh', 'SPOTIFY_TOKEN_ENC_KEY');
    await assertRejects(() => decryptSecret(spotifySealed));
    const gcalSealed = await encryptSecret('gcal-refresh');
    await assertRejects(() => decryptSecret(gcalSealed, 'SPOTIFY_TOKEN_ENC_KEY'));
  });

  await t.step('a fresh IV per call — same plaintext never yields the same ciphertext', async () => {
    assertNotEquals(await encryptSecret('x', 'SPOTIFY_TOKEN_ENC_KEY'), await encryptSecret('x', 'SPOTIFY_TOKEN_ENC_KEY'));
  });

  await t.step('the ciphertext format is unchanged: v1.<iv>.<body>', async () => {
    const parts = (await encryptSecret('gcal-refresh')).split('.');
    assertEquals(parts.length, 3);
    assertEquals(parts[0], 'v1');
    assertEquals(parts[1].length, 16); // 12-byte IV as unpadded base64url
  });
});
