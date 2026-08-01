// Cloudflare R2 client for the gym video-clips pipeline (PHILOI_UI_SPEC.md §23) — R2's
// S3-compatible API means the standard AWS SDK works unmodified against it, just pointed at R2's
// own endpoint. Credentials are Supabase Edge Function secrets, never shipped in the app:
//   supabase secrets set R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... R2_BUCKET_NAME=...
// The bucket itself (+ its ~90-day retention lifecycle rule, §23) is created once in the
// Cloudflare dashboard — not something this code provisions.
import { S3Client } from 'npm:@aws-sdk/client-s3@3';

export function createR2Client(): S3Client {
  const accountId = Deno.env.get('R2_ACCOUNT_ID')!;
  const accessKeyId = Deno.env.get('R2_ACCESS_KEY_ID')!;
  const secretAccessKey = Deno.env.get('R2_SECRET_ACCESS_KEY')!;
  return new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
}

export const R2_BUCKET = Deno.env.get('R2_BUCKET_NAME') ?? 'philoi-gym-clips';
