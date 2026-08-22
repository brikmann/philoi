-- Lets a reporter read back the report they just filed.
--
-- moderation_reports is insert-only to users: there is an insert policy and no select policy at
-- all, which is the right default for a moderation table (nobody browses other people's reports).
-- But it also means `insert ... returning id` fails — Postgres requires a SELECT policy for
-- RETURNING — so the client had no way to learn the id of the row it had just written.
--
-- The report-alert email (supabase/functions/report_alert) is keyed on that id: the client hands
-- over an id and nothing else, and the function reads the actual row with the service role and
-- composes the alert from what the DATABASE says rather than from anything the client claims. So
-- the client needs the id back, and this is the narrowest way to give it: your own rows, read-only.
--
-- Deliberately still no update/delete policy — a filed report cannot be edited or withdrawn.
drop policy if exists "moderation_reports: read own" on moderation_reports;
create policy "moderation_reports: read own" on moderation_reports
  for select using (reporter_id = auth.uid());
