# Philoi Admin

Moderation queue + beta metrics + read-only content browser, for `is_admin` accounts
only. Separate Next.js app so admin tooling never ships inside the mobile bundle. Every
read/write runs under the signed-in admin's own Supabase session — RLS (gated by the
`is_admin()` helper in `supabase/schema.sql`) is the only authorization boundary. No
service-role key is used anywhere in this app.

## Local setup

```
cd admin
npm install
cp .env.local.example .env.local   # fill in NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY
npm run dev
```

Apply `supabase/schema.sql` (repo root) to your Supabase project first — it seeds
`profiles.is_admin = true` for `spikeythedoge1@gmail.com` if that account exists. To make
another account an admin, run in the Supabase SQL editor:

```sql
update profiles set is_admin = true where id = (select id from auth.users where email = 'someone@example.com');
```

Sign in at `/login` with that email — Supabase sends a magic link.

## Deploy (Vercel)

This isn't a monorepo, so Vercel needs to be told where the app root is:

1. New Vercel project, pointed at this repo.
2. Project Settings → General → **Root Directory** → `admin`.
3. Project Settings → Environment Variables: `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
4. Deploy. Point an admin subdomain (e.g. `admin.getphiloi.com`) at the project.

No `vercel` CLI commands have been run as part of building this — deploying is a
separate, explicit step for whoever owns the Vercel account.

## How the pieces fit

- `middleware.ts` — refreshes the Supabase session on every request, redirects signed-out
  users to `/login` and non-admins to `/not-authorized`.
- `src/lib/require-admin.ts` — the same check, run server-side inside every dashboard
  route as defense in depth.
- `src/lib/supabase/server.ts` — the only Supabase client this app uses for data access;
  it's the signed-in admin's own session, so every query is subject to the `is_admin()`
  RLS policies added alongside `profiles.is_disabled`/`moderation_reports.category` in
  `supabase/schema.sql`'s chat-safety and admin-dashboard sections.
- `src/lib/audit.ts` — `logAdminEvent()`, called after every content view and every
  mutation, writing to `admin_audit`.
- Moderation actions call the `admin_resolve_report` RPC (Postgres function, `SECURITY
  DEFINER`, re-checks `is_admin()` itself) rather than mutating tables directly, so a
  report resolution — content removal, account disable, status flip, and the audit
  insert — can't half-apply.
