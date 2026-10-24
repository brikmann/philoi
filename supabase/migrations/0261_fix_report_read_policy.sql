-- FIX: "reporting a campfire comes back glitchy as hell."
--
-- moderation_reports has an INSERT policy (reporter_id = auth.uid()) but NO SELECT policy. The client
-- files a report with the usual Supabase insert().select() (to read the row back / confirm), and RLS
-- blocks the RETURNING row — so the call appears to fail or returns nothing even though the row was
-- written. That is the "glitch": success on the server, error/empty on the client. Reporting a
-- campfire also runs the snapshot_reported_content() trigger, which is fine, so this read gap is the
-- visible fault.
--
-- Fix: let a reporter read their OWN reports (they filed them; no privacy concern). Moderators still
-- read everything via service_role, which bypasses RLS. Additive, safe.
--
-- ALSO VERIFY (drift guard — schema.sql's base moderation_reports lacks these, they were added by
-- later ALTERs; confirm they exist in PROD or the snapshot trigger throws on every report):
--   reported_message_id, reported_group_id, circle_id, reported_content_snapshot.
--   select column_name from information_schema.columns
--   where table_name = 'moderation_reports' and table_schema = 'public';
-- If any are missing in prod, add them (they reference messages/groups on delete set null, + a jsonb
-- snapshot column) before relying on campfire reports.
--
-- LEDGER: this is 0252. Verify prod max applied + ledger first; sequential; no hand-edit; no db push;
-- apply in isolation then `supabase migration repair --status applied 0252`.

begin;

drop policy if exists "moderation_reports: read own" on moderation_reports;
create policy "moderation_reports: read own" on moderation_reports
  for select using (reporter_id = auth.uid());

commit;

-- CLIENT NOTE: if you'd rather not return the row at all, the alternative fix is to drop `.select()`
-- from the report insert call. The policy above is the more forgiving fix and also lets the user see
-- a "reported" state, so prefer it.
