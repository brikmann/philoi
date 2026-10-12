-- 0242 · App Store Guideline 1.2 — a server-enforced filter on every user-generated-content write.
--
-- Report (moderation_reports), block (blocked_users) and contact (support@philoi.app) already exist.
-- The missing pillar was a FILTER: chat, DMs, Agora posts/comments and profile names accepted anything.
-- A client-side check is bypassable, so the filter lives here, as BEFORE triggers on the tables, which
-- every write path ends in — the direct `messages` insert, the dm_send / create_agora_post /
-- add_agora_comment SECURITY DEFINER RPCs, and direct `profiles` / `groups` writes. A patched client
-- has no route around a table trigger.
--
-- ONE source of truth:
--   blocked_terms         — the list. Editable in SQL with no build or deploy (see MODERATION.md).
--   ugc_normalize()       — lowercase, strip zero-width/soft-hyphen, map leetspeak (4@→a 3→e 1!→i
--                           0→o $5→s 7+→t).
--   ugc_term_pattern()    — compiles a term into a regex that also catches repeats (fuuuck), masking
--                           (f*ck, f#ck), punctuation (f.u.c.k) and spacing (f u c k). Stored on the row
--                           as a generated column, so it is built once per term, not per message.
--   ugc_violation()       — the category a text trips, or null.
--   ugc_assert_clean()    — raises the friendly rejection. HINT 'ugc_blocked' is the stable code the
--                           client maps (src/lib/api/moderation.ts).
--
-- Scunthorpe: every term is anchored on a word boundary (except mode 'anywhere', reserved for strings
-- that never occur inside an innocent word), so class / assignment / Essex / Scunthorpe / grape /
-- cocktail / shiitake pass. Asserted at the bottom.
--
-- Rate limits: messages (8 / 10 s) and groups (10 / day) already had them. DMs, Agora posts and Agora
-- comments get theirs here, in the same trigger as the filter.

-- ─────────────────────────── the list ───────────────────────────

create table if not exists public.blocked_terms (
  term       text primary key check (term = lower(term) and term ~ '^[a-z]+( [a-z]+)*$'),
  category   text not null check (category in ('hate', 'sexual', 'violence', 'profanity')),
  -- 'stem': whole word plus a common suffix (shit, shits, shitty, shithead)
  -- 'anywhere': matches inside other words too — only for strings no innocent word contains
  mode       text not null default 'stem' check (mode in ('stem', 'anywhere')),
  created_at timestamptz not null default now()
);

comment on table public.blocked_terms is
  'UGC filter list (Guideline 1.2). Insert/delete rows to change what is blocked — no app build or deploy needed. Lowercase letters and single spaces only; the matcher handles leetspeak, repeats, masking and spacing. See MODERATION.md.';

-- Nobody reads the list from a client: no policies, RLS on.
alter table public.blocked_terms enable row level security;
revoke all on public.blocked_terms from anon, authenticated;

-- ─────────────────────────── normalize + compile ───────────────────────────

create or replace function public.ugc_normalize(p_text text)
returns text
language sql
immutable
parallel safe
as $$
  select translate(
    regexp_replace(lower(coalesce(p_text, '')), '[​-‍⁠﻿­]', '', 'g'),
    '4@31!0$57+',
    'aaeiiosstt'
  );
$$;

create or replace function public.ugc_term_pattern(p_term text, p_mode text)
returns text
language plpgsql
immutable
parallel safe
as $$
declare
  v_tight   text := '';
  v_spaced  text := '';
  v_letters text := replace(p_term, ' ', '');
  v_prev    text := null;
  c         text;
  v_cls     text;
  v_suffix  constant text := '(?:s|es|ed|er|ers|ing|in|ie|ies|ty|head|heads|face)?';
  v_l       constant text := '(?:^|[^a-z])';
  v_r       constant text := '(?:$|[^a-z])';
  v_out     text;
begin
  for i in 1 .. length(p_term) loop
    c := substr(p_term, i, 1);
    if c = ' ' then
      -- a word gap inside a phrase: any run of non-letters, including none ("killyourself")
      v_tight := v_tight || '[^a-z]*';
      v_prev := ' ';
      continue;
    end if;
    -- a vowel may be masked with * or #
    v_cls := case when c in ('a', 'e', 'i', 'o', 'u') then '[' || c || '*#]' else c end;
    -- one optional punctuation mark between letters of a word (f.u.c.k, f-ck), never a space
    if v_prev is not null and v_prev <> ' ' then
      v_tight := v_tight || '[^a-z\s]?';
    end if;
    v_tight := v_tight || v_cls || '+';
    v_prev := c;
  end loop;

  -- the spaced-out form, every letter on its own: f u c k
  for i in 1 .. length(v_letters) loop
    c := substr(v_letters, i, 1);
    v_cls := case when c in ('a', 'e', 'i', 'o', 'u') then '[' || c || '*#]' else c end;
    v_spaced := v_spaced || case when i > 1 then '\s+' else '' end || v_cls;
  end loop;

  v_out := case p_mode
    when 'anywhere' then v_tight
    else v_l || v_tight || v_suffix || v_r
  end;
  if length(v_letters) >= 3 then
    v_out := v_out || '|' || v_l || v_spaced || v_r;
  end if;
  return v_out;
end;
$$;

alter table public.blocked_terms
  add column if not exists pattern text generated always as (public.ugc_term_pattern(term, mode)) stored;

-- ─────────────────────────── check + reject ───────────────────────────

create or replace function public.ugc_violation(p_text text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select b.category
  from blocked_terms b
  where p_text is not null
    and btrim(p_text) <> ''
    and ugc_normalize(p_text) ~ b.pattern
  limit 1;
$$;

create or replace function public.ugc_assert_clean(p_text text)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if ugc_violation(p_text) is not null then
    raise exception 'That may break our community rules — edit it and try again.'
      using errcode = 'P0001', hint = 'ugc_blocked';
  end if;
end;
$$;

-- A per-author, per-window count. Same shape as enforce_message_rate_limit.
create or replace function public.ugc_assert_rate(p_recent integer, p_cap integer)
returns void
language plpgsql
immutable
as $$
begin
  if p_recent >= p_cap then
    raise exception 'You''re posting too fast — slow down for a moment.'
      using errcode = 'P0001', hint = 'ugc_rate_limited';
  end if;
end;
$$;

-- ─────────────────────────── the triggers ───────────────────────────

-- Campfire chat. System rows (joins, challenge events) are server-written; only people's words are
-- filtered. The existing on_message_insert_rate_limit already caps sends, and fires first.
create or replace function public.ugc_filter_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.system_event is null then
    perform ugc_assert_clean(new.body);
  end if;
  return new;
end;
$$;

drop trigger if exists on_message_insert_ugc_filter on public.messages;
create trigger on_message_insert_ugc_filter
  before insert or update of body on public.messages
  for each row execute function public.ugc_filter_message();

-- DMs — reached through dm_send, filtered here so dm_send needs no change.
create or replace function public.ugc_filter_dm()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recent integer;
begin
  perform ugc_assert_clean(new.body);
  if tg_op = 'INSERT' then
    select count(*) into v_recent
    from dm_messages
    where sender_id = new.sender_id and created_at > now() - interval '10 seconds';
    perform ugc_assert_rate(v_recent, 8);
  end if;
  return new;
end;
$$;

drop trigger if exists on_dm_insert_ugc_filter on public.dm_messages;
create trigger on_dm_insert_ugc_filter
  before insert or update of body on public.dm_messages
  for each row execute function public.ugc_filter_dm();

-- Agora posts.
create or replace function public.ugc_filter_agora_post()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recent integer;
begin
  perform ugc_assert_clean(new.body);
  if tg_op = 'INSERT' then
    select count(*) into v_recent
    from agora_posts
    where user_id = new.user_id and created_at > now() - interval '1 minute';
    perform ugc_assert_rate(v_recent, 5);
  end if;
  return new;
end;
$$;

drop trigger if exists on_agora_post_ugc_filter on public.agora_posts;
create trigger on_agora_post_ugc_filter
  before insert or update of body on public.agora_posts
  for each row execute function public.ugc_filter_agora_post();

-- Agora comments.
create index if not exists agora_comments_user_idx on public.agora_comments (user_id, created_at desc);

create or replace function public.ugc_filter_agora_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recent integer;
begin
  perform ugc_assert_clean(new.body);
  if tg_op = 'INSERT' then
    select count(*) into v_recent
    from agora_comments
    where user_id = new.user_id and created_at > now() - interval '1 minute';
    perform ugc_assert_rate(v_recent, 10);
  end if;
  return new;
end;
$$;

drop trigger if exists on_agora_comment_ugc_filter on public.agora_comments;
create trigger on_agora_comment_ugc_filter
  before insert or update of body on public.agora_comments
  for each row execute function public.ugc_filter_agora_comment();

-- Profile names: handle (setup-handle.tsx), display name, bio (edit-profile.tsx). Only a value that is
-- being CHANGED is checked, so a pre-filter name never blocks an unrelated profile edit.
create or replace function public.ugc_filter_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' or new.handle is distinct from old.handle then
    -- handles are a_b_c: underscores read as word gaps, which ugc_normalize leaves as separators
    perform ugc_assert_clean(new.handle);
  end if;
  if tg_op = 'INSERT' or new.display_name is distinct from old.display_name then
    perform ugc_assert_clean(new.display_name);
  end if;
  if tg_op = 'INSERT' or new.bio is distinct from old.bio then
    perform ugc_assert_clean(new.bio);
  end if;
  return new;
end;
$$;

drop trigger if exists on_profile_ugc_filter on public.profiles;
create trigger on_profile_ugc_filter
  before insert or update of handle, display_name, bio on public.profiles
  for each row execute function public.ugc_filter_profile();

-- Campfire names are shown to everyone invited, so they get the same check.
create or replace function public.ugc_filter_group()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' or new.name is distinct from old.name then
    perform ugc_assert_clean(new.name);
  end if;
  return new;
end;
$$;

drop trigger if exists on_group_ugc_filter on public.groups;
create trigger on_group_ugc_filter
  before insert or update of name on public.groups
  for each row execute function public.ugc_filter_group();

-- Internal helpers: nothing calls these from a client. Triggers fire as their (definer) owner, and a
-- trigger function's EXECUTE grant is only checked at CREATE TRIGGER, so revoking is safe.
-- (Revoke from anon explicitly — revoking from public alone leaves Supabase's default anon grant.)
revoke all on function public.ugc_violation(text) from public, anon, authenticated;
revoke all on function public.ugc_assert_clean(text) from public, anon, authenticated;
revoke all on function public.ugc_filter_message() from public, anon, authenticated;
revoke all on function public.ugc_filter_dm() from public, anon, authenticated;
revoke all on function public.ugc_filter_agora_post() from public, anon, authenticated;
revoke all on function public.ugc_filter_agora_comment() from public, anon, authenticated;
revoke all on function public.ugc_filter_profile() from public, anon, authenticated;
revoke all on function public.ugc_filter_group() from public, anon, authenticated;

-- ─────────────────────────── Agora reports were being refused ───────────────────────────
-- agora/index.tsx and agora/[id].tsx (and now the comments sheet) file reports with the reason
-- 'Reported from the Agora', which moderation_reports_reason_check never allowed — every Agora report
-- has failed with 23514 since 0128 (prod held zero). Installed builds send that exact string and OTA is
-- off, so the fix has to be here: allow it.
alter table public.moderation_reports drop constraint if exists moderation_reports_reason_check;
alter table public.moderation_reports add constraint moderation_reports_reason_check check (reason in (
  'Spam or misleading', 'Harassment or bullying', 'Inappropriate or offensive content',
  'Child safety / CSAE', 'Other', 'Reported from the Agora'
));

-- ─────────────────────────── the seed ───────────────────────────
-- Baseline for the categories Guideline 1.2 names. Mild words with innocent uses (ass, damn, hell,
-- crap, dick, cock, cum — "summa cum laude" on a campus app — and surnames like Dyke) are
-- deliberately absent. A bare -y suffix is not matched either, or 'spic' would take 'spicy' with it.

insert into public.blocked_terms (term, category, mode) values
  -- hate
  ('nigger', 'hate', 'stem'), ('nigga', 'hate', 'stem'), ('faggot', 'hate', 'anywhere'),
  ('fag', 'hate', 'stem'), ('tranny', 'hate', 'stem'),
  ('retard', 'hate', 'stem'), ('spic', 'hate', 'stem'), ('chink', 'hate', 'stem'),
  ('kike', 'hate', 'stem'), ('wetback', 'hate', 'stem'), ('gook', 'hate', 'stem'),
  ('raghead', 'hate', 'stem'), ('towelhead', 'hate', 'stem'), ('coon', 'hate', 'stem'),
  ('beaner', 'hate', 'stem'), ('paki', 'hate', 'stem'), ('heil hitler', 'hate', 'stem'),
  ('sieg heil', 'hate', 'stem'), ('white power', 'hate', 'stem'), ('gas the jews', 'hate', 'stem'),
  -- sexual
  ('porn', 'sexual', 'stem'), ('porno', 'sexual', 'stem'), ('pornography', 'sexual', 'stem'), ('blowjob', 'sexual', 'stem'),
  ('handjob', 'sexual', 'stem'), ('dildo', 'sexual', 'stem'), ('jizz', 'sexual', 'stem'),
  ('rape', 'sexual', 'stem'), ('rapist', 'sexual', 'stem'), ('molest', 'sexual', 'stem'),
  ('pedo', 'sexual', 'stem'), ('pedophile', 'sexual', 'stem'), ('paedo', 'sexual', 'stem'),
  ('incest', 'sexual', 'stem'), ('send nudes', 'sexual', 'stem'), ('cocksucker', 'sexual', 'anywhere'),
  ('whore', 'sexual', 'stem'), ('slut', 'sexual', 'stem'),
  -- violence / threats
  ('kill yourself', 'violence', 'stem'), ('kill urself', 'violence', 'stem'),
  ('kill ur self', 'violence', 'stem'), ('kys', 'violence', 'stem'),
  ('hope you die', 'violence', 'stem'), ('i will kill you', 'violence', 'stem'),
  ('im going to kill you', 'violence', 'stem'), ('shoot up the school', 'violence', 'stem'),
  ('rape you', 'violence', 'stem'),
  -- hard profanity
  ('fuck', 'profanity', 'anywhere'), ('shit', 'profanity', 'stem'), ('bullshit', 'profanity', 'stem'),
  ('dipshit', 'profanity', 'stem'), ('cunt', 'profanity', 'stem'), ('bitch', 'profanity', 'stem'),
  ('asshole', 'profanity', 'stem'), ('dickhead', 'profanity', 'stem'), ('pussy', 'profanity', 'stem'),
  ('twat', 'profanity', 'stem'), ('wanker', 'profanity', 'stem')
on conflict (term) do nothing;

-- ─────────────────────────── assertions ───────────────────────────
-- Each "blocked" case is paired with a clean near-miss, so a matcher that blocks everything (or
-- nothing) fails here instead of in review.

do $$
declare
  v_bad  text[] := array[
    'fuck', 'FUCK this', 'f*ck', 'f#ck', 'fuuuuck', 'f u c k', 'f.u.c.k', 'motherfucker', 'what the fck?? no — f*cking hell',
    'sh1t', 'this is shitty', 'bullsh!t', 'kys', 'just kill yourself', 'killyourself', 'n1gger', 'you are a c*nt',
    'big sl#t energy', 'send nudes pls', 'b1tch'
  ];
  v_good text[] := array[
    'class', 'assignment', 'Essex', 'Scunthorpe', 'grape juice', 'cocktail', 'shiitake mushrooms',
    'pass the ass-ignment', 'I killed my exam today', 'skill yourself up', 'cum laude', 'peacock',
    'this pic', 'it''s pic day', 'therapist', 'drape the flag', 'Dick Van Dyke', 'snigger', 'spicy food',
    'hitchhiker', 'cockpit', 'shitake', 'the coonhound', 'pakistan', 'documents', 'Analysis', 'go die-hard fans'
  ];
  t text;
begin
  foreach t in array v_bad loop
    if public.ugc_violation(t) is null then
      raise exception 'ugc filter missed: %', t;
    end if;
  end loop;
  foreach t in array v_good loop
    if public.ugc_violation(t) is not null then
      raise exception 'ugc filter false positive: % (%)', t, public.ugc_violation(t);
    end if;
  end loop;
end;
$$;
