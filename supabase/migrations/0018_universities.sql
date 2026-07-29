-- Canonical universities table (PHILOI_UI_SPEC.md §21 — "a real, searchable university
-- picker, not a free-text field... so campus leaderboards and class campfires group cleanly;
-- free text would fragment them"). profiles.university stays a plain text column (an FK
-- migration would touch every existing university-scoped query) but is now always populated
-- from this table's canonical spelling when picked, with a free-text "not listed" fallback
-- for schools not yet seeded here.
create table if not exists universities (
  id uuid primary key default gen_random_uuid(),
  name text not null unique
);

alter table universities enable row level security;

drop policy if exists "universities: read all" on universities;
create policy "universities: read all" on universities for select using (true);

insert into universities (name) values
  ('Wilfrid Laurier University'),
  ('University of Waterloo'),
  ('University of Toronto'),
  ('McMaster University'),
  ('Western University'),
  ('Queen''s University'),
  ('University of Guelph'),
  ('Toronto Metropolitan University'),
  ('York University'),
  ('University of Ottawa')
on conflict (name) do nothing;
