-- University email verification (UNI_VERIFICATION_SPEC.md, design-mocks/75 + 76).
--
-- The uni email is a verified ATTRIBUTE on the existing OAuth user — never a login. Supabase
-- Auth's own OTP (signInWithOtp/verifyOtp) is a full sign-in: it would return a session for the
-- uni-email identity, switching the user to a different auth user and orphaning the profile
-- their Google/Apple session owns. So this is a custom code store that Auth never touches, read
-- and written only by the two Edge Functions running as service role.

alter table profiles
  add column if not exists university_email text,
  add column if not exists university_email_verified boolean not null default false,
  add column if not exists university_domain text;

comment on column profiles.university_domain is
  'Email domain for the chosen school (e.g. mylaurier.ca), from the shipped top-20 cache or the Hipolabs API. Null = school has no known domain, so it can never be verified — which must never block onboarding.';

-- One active code per user: a second send REPLACES the first (upsert on the pk), so an old code
-- can't stay valid alongside a new one.
create table if not exists uni_verification_codes (
  user_id uuid primary key references profiles (id) on delete cascade,
  email text not null,
  -- Never the plaintext code. A leaked table read must not hand out working codes.
  code_hash text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  last_sent_at timestamptz not null default now()
);

alter table uni_verification_codes enable row level security;

-- Deliberately NO policy of any kind. RLS with zero policies denies every client read and write,
-- which is exactly right here: the anon/authenticated roles must never see a code_hash, an
-- attempt count, or another user's pending email. The Edge Functions use the service role, which
-- bypasses RLS entirely.

-- ───────────────────────── verified-only campus boards ─────────────────────────
-- The selling point is that campus rankings are REAL, so the filter lives here and not only in
-- the client: an unverified account must not be able to appear on a campus board even through a
-- hand-rolled RPC call.
--
-- Dropped and recreated rather than replaced, matching how 0040 defines these — the bodies
-- change but the signatures don't, so this is belt-and-braces against the create-or-replace
-- return-type trap this project has hit before.

drop function if exists get_university_leaderboard(text, int);
create function get_university_leaderboard(p_university text, p_limit int default 50)
returns table (
  user_id uuid,
  handle text,
  display_name text,
  avatar_url text,
  is_pro boolean,
  score numeric,
  tier text,
  division int,
  check_ins_this_week bigint,
  rank int,
  is_me boolean
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  return query
  with ranked as (
    select
      p.id as user_id, p.handle, p.display_name, p.avatar_url, p.is_pro,
      s.score, t.tier, t.division,
      coalesce((
        select count(*) from check_ins ci
        where ci.user_id = p.id and ci.created_at >= date_trunc('week', now())
      ), 0) as check_ins_this_week,
      row_number() over (order by s.score desc, p.display_name asc)::int as rank
    from profiles p
    cross join lateral (select universal_score(p.id) as score) s
    cross join lateral rank_tier_for_score(s.score) t
    where p.university = p_university
      and p.university_email_verified          -- new in 0062
      and not p.is_demo and not p.is_disabled
  )
  select r.*, (r.user_id = auth.uid()) as is_me
  from ranked r
  where r.rank <= p_limit or r.user_id = auth.uid()
  order by r.rank;
end;
$$;

-- Vs. unis — the collective school ranking. Same rule: an unverified account contributes nothing
-- to its school's total, so a school can't be inflated by people who never proved they go there.
drop function if exists get_university_totals(int);
create function get_university_totals(p_limit int default 20)
returns table (university text, total_xp numeric, member_count bigint)
language sql
security definer
set search_path = public
stable
as $$
  select
    p.university,
    sum(universal_score(p.id)) as total_xp,
    count(*) as member_count
  from profiles p
  where p.university is not null
    and p.university_email_verified            -- new in 0062
    and p.is_demo = false
    and p.is_disabled = false                  -- was missing; a disabled account shouldn't score
  group by p.university
  order by total_xp desc
  limit p_limit;
$$;

-- ───────────────────────── changing school re-locks ─────────────────────────
-- Settings can change `university` directly (it's an ordinary profile update). A verified email
-- only proves the school it belongs to, so moving schools must drop the badge — otherwise
-- someone verifies at one campus and then re-points that verification at another. Enforced by
-- trigger rather than trusting every future caller to remember.
create or replace function reset_uni_verification_on_school_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.university is distinct from old.university then
    -- Only when the email no longer matches the new school's domain. Re-picking the SAME school
    -- from a different spelling shouldn't punish someone who is genuinely verified.
    if new.university_email is null
       or new.university_domain is null
       or lower(split_part(new.university_email, '@', 2)) <> lower(new.university_domain) then
      new.university_email_verified := false;
      new.university_email := null;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_reset_uni_verification on profiles;
create trigger profiles_reset_uni_verification
  before update of university on profiles
  for each row execute function reset_uni_verification_on_school_change();
