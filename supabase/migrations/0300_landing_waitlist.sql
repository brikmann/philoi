-- 0300 — philoi.app landing waitlist.
--
-- The "campus hub" landing page (site/index.html) captures emails before launch.
-- The page is static and calls this with the public anon key, so the anon role
-- gets EXACTLY one thing: execute on join_waitlist(). It has no privileges on the
-- table itself — it cannot read, update, delete, or enumerate the list.
--
-- Duplicates are a silent success (on conflict do nothing), so the endpoint
-- doesn't reveal whether an address is already on the list.
-- Additive only: one table, one index, one function.

create table if not exists public.waitlist (
  id         uuid        primary key default gen_random_uuid(),
  email      text        not null,
  created_at timestamptz not null default now(),
  constraint waitlist_email_shape check (
    char_length(email) between 3 and 254
    and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  )
);

create unique index if not exists waitlist_email_lower_key
  on public.waitlist (lower(email));

alter table public.waitlist enable row level security;
-- No policies: RLS on + no grants = unreachable from the client roles.
revoke all on table public.waitlist from public, anon, authenticated;

create or replace function public.join_waitlist(p_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := btrim(coalesce(p_email, ''));
begin
  if char_length(v_email) not between 3 and 254
     or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'invalid email' using errcode = '22023';
  end if;

  insert into public.waitlist (email)
  values (v_email)
  on conflict ((lower(email))) do nothing;
end;
$$;

revoke all on function public.join_waitlist(text) from public, anon, authenticated;
grant execute on function public.join_waitlist(text) to anon, authenticated, service_role;
