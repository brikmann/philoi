-- 0282 · CHALLENGE FROM THE REEL (mock 319, design-mocks/CODE_PROMPT_challenge_from_reel.md).
--
-- A PR clip IS its own verification, and one tap turns it into a head-to-head.
--
-- WHAT "VERIFIED" MEANS HERE is exactly what it means on the fitness board (0265): a workout_set
-- with a clip on file (video_key) whose owner consented to review (clip_consent_at), not pulled by
-- a failed review (0266). Nothing new is invented — this file only lets that verdict travel onto
-- a post, and lets a friend race it.
--
-- DECISIONS (Noah, 2026-10-26):
--   * A PR clip plays on a post only if its owner ALLOWS it (workout_sets.clip_shown_at, a
--     separate opt-in from 0265's review consent). Once allowed, anyone who can open the post can
--     watch it — get_agora_item decides who that is (dial, forest, campfire, blocks). Before this
--     the clip stays where 0266 put it: owner, friends, circle-mates.
--   * The target is the EXACT set on the clip, frozen at send ("405 × 1"). If the owner outgrows
--     it later, that's on them; a viewer challenges the clip, not the owner's current best.
--   * Friends only. create_h2h_challenge already refuses anyone who isn't an accepted friend, and
--     this rides it, so a minor can only ever be challenged by their own friends.
--
-- THE CLIP. The reel plays the SET's clip (R2, gym-clip-playback-url), never a copy. A post that
-- carries its own Agora video (0279) never gets the badge: the clip on screen would not be the
-- clip that verifies the number.
--
-- THE POST ↔ SET LINK (agora_post_lifts). A post names its sets two ways: a gym lock-in freezes
-- its clips' workout_set_ids into the snapshot (0192), and a 'pr' attachment points at a
-- personal_records row — which is overwritten by the next PR, so its workout_set_id is frozen
-- here at post time. Rows cascade off both sides.
--
-- THE RACE is one more race_metric on the existing duel path, not a new challenge type:
-- race_metric 'verified_lift' + the frozen target on social_challenges. Invite, decline, forfeit,
-- settlement (finalize_social_challenges), rewards and the won/lost notifications
-- (economy_on_social_challenge_closed) are all the existing ones. The only scoring change is a
-- branch in challenge_racer_score:
--   * the owner's score is the frozen target;
--   * the challenger's is their best set that BEATS it — same exercise (slug), logged inside the
--     window, verified, ranked, and strictly better (heavier at ≥ the reps, or the same weight
--     for more reps) — else 0.
-- So a clip that beats it wins, a tie or no clip and the owner holds. Encoded as
-- weight + reps/1000 so "405 × 3" beats "405 × 1" in one numeric comparison.
--
-- EARLY RESOLUTION. When a beating set becomes verified, a trigger pulls the race's ends_at to
-- now(); the existing 10-minute finalize cron settles it and notifies both sides.
--
-- NOT COVERED (and why it's safe): get_my_social_challenges / get_challenge_watch read live scores
-- through social_challenge_score(user, metric, …), which has no challenge row and so returns 0 for
-- this metric. Installed builds therefore draw "0 vs 0" on the live card (titled by public_name,
-- which says the target). Settlement and rewards never read those — they read
-- challenge_racer_score — and the new build reads get_lift_challenge below instead.
--
-- Additive: two tables' new columns, one new table, one widened CHECK, two restated functions
-- (challenge_racer_score, challenge_verifiability_for — live bodies of 2026-10-26, only the new
-- branch added), four new functions, two triggers.
--
-- LEDGER: apply this file alone (after 0281), then `supabase migration repair --status applied 0282`.
-- Deploy supabase/functions/gym-clip-playback-url (from a clean tree) with it, or an allowed clip
-- still plays only for friends and circle-mates (safe, just narrower than the owner chose).

begin;

-- ───────────────────────────── 1. the owner allows the clip on their posts ─────────────────────────────
alter table workout_sets add column if not exists clip_shown_at timestamptz;
comment on column workout_sets.clip_shown_at is
  '0282 -- owner allowed this set''s clip to play on their Agora posts, to anyone who can open the post. Null = 0266''s audience only.';

create or replace function set_workout_set_clip_shown(p_workout_set_id uuid, p_shown boolean)
returns workout_sets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_set workout_sets;
begin
  update workout_sets ws
     set clip_shown_at = case when p_shown then coalesce(ws.clip_shown_at, now()) else null end
    from workouts w
   where ws.id = p_workout_set_id and ws.workout_id = w.id and w.user_id = auth.uid()
  returning ws.* into v_set;
  if v_set.id is null then
    raise exception 'Not your set.';
  end if;
  return v_set;
end;
$$;

revoke all on function set_workout_set_clip_shown(uuid, boolean) from public, anon;
grant execute on function set_workout_set_clip_shown(uuid, boolean) to authenticated;

-- ───────────────────────────── 2. which sets a post carries ─────────────────────────────
create table if not exists agora_post_lifts (
  post_id        uuid not null references agora_posts (id) on delete cascade,
  workout_set_id uuid not null references workout_sets (id) on delete cascade,
  primary key (post_id, workout_set_id)
);
create index if not exists agora_post_lifts_set_idx on agora_post_lifts (workout_set_id);
alter table agora_post_lifts enable row level security;
-- No policies: read only through the security definer functions below.

comment on table agora_post_lifts is
  '0282 -- the workout_sets an Agora post carries (a lock-in''s clips, a PR''s set), frozen at post time. Only the author''s own sets.';

create or replace function agora_post_link_lifts()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  insert into agora_post_lifts (post_id, workout_set_id)
  select distinct new.id, ws.id
    from (
      select (clip.value->>'workout_set_id')::uuid as set_id
        from jsonb_array_elements(coalesce(new.attachments, '[]'::jsonb)) el,
             jsonb_array_elements(coalesce(el.value->'snapshot'->'clips', '[]'::jsonb)) clip
       where el.value->>'kind' = 'lockin'
         and clip.value->>'workout_set_id' ~ '^[0-9a-f-]{36}$'
      union all
      select pr.workout_set_id
        from jsonb_array_elements(coalesce(new.attachments, '[]'::jsonb)) el
        join personal_records pr
          on el.value->>'ref_id' ~ '^[0-9a-f-]{36}$'
         and pr.id = (el.value->>'ref_id')::uuid
         and pr.user_id = new.user_id
       where el.value->>'kind' = 'pr'
    ) s
    join workout_sets ws on ws.id = s.set_id
    join workouts w on w.id = ws.workout_id and w.user_id = new.user_id
  on conflict do nothing;
  return null;
end;
$fn$;

drop trigger if exists agora_posts_link_lifts on agora_posts;
create trigger agora_posts_link_lifts
  after insert on agora_posts
  for each row execute function agora_post_link_lifts();

revoke all on function agora_post_link_lifts() from public, anon, authenticated;

-- Backfill the posts that already exist. A 'pr' post links its PR's CURRENT set — the best
-- available for a post written before the link was frozen, and only if the numbers still match
-- the card (so an old "255 × 2" card never wears a later 275's clip).
insert into agora_post_lifts (post_id, workout_set_id)
select distinct p.id, ws.id
  from agora_posts p,
       jsonb_array_elements(coalesce(p.attachments, '[]'::jsonb)) el,
       jsonb_array_elements(coalesce(el.value->'snapshot'->'clips', '[]'::jsonb)) clip
  join workout_sets ws on clip.value->>'workout_set_id' ~ '^[0-9a-f-]{36}$' and ws.id = (clip.value->>'workout_set_id')::uuid
  join workouts w on w.id = ws.workout_id
 where el.value->>'kind' = 'lockin' and w.user_id = p.user_id
on conflict do nothing;

insert into agora_post_lifts (post_id, workout_set_id)
select distinct p.id, ws.id
  from agora_posts p,
       jsonb_array_elements(coalesce(p.attachments, '[]'::jsonb)) el
  join personal_records pr on el.value->>'ref_id' ~ '^[0-9a-f-]{36}$' and pr.id = (el.value->>'ref_id')::uuid
  join workout_sets ws on ws.id = pr.workout_set_id
 where el.value->>'kind' = 'pr'
   and pr.user_id = p.user_id
   and ws.weight is not distinct from (el.value->'snapshot'->>'weight')::numeric
   and ws.reps = (el.value->'snapshot'->>'reps')::int
on conflict do nothing;

-- The race's frozen target (section 4). Added here because section 3's SQL bodies read them.
alter table social_challenges add column if not exists lift_set_id   uuid references workout_sets (id) on delete set null;
alter table social_challenges add column if not exists lift_post_id  uuid references agora_posts (id) on delete set null;
alter table social_challenges add column if not exists lift_exercise text;
alter table social_challenges add column if not exists lift_slug     text;
alter table social_challenges add column if not exists lift_weight   numeric;
alter table social_challenges add column if not exists lift_reps     int;

-- ───────────────────────────── 3. the verified lift a post shows ─────────────────────────────
/**
 * One row per given post that shows a verified lift the CALLER may see: the set behind the badge,
 * the structured target, and whether the caller may ⚔ it.
 *
 * Visibility defers to get_agora_item (as 0279's agora_video_sources does) — it is the one place
 * the dial, forest/campfire gates and blocks live. A post with its own video is skipped: its clip
 * is not the clip that verifies the number.
 *
 * Badge-worthy = verified (clip + consent, not pulled, not under dispute), ranked (not private),
 * shown by its owner, and a weighted lift — the one shape a head-to-head can compare today. When a
 * post carries several, the heaviest by e1RM is the headline.
 *
 * my_challenge_id: the caller's own live (pending/active) challenge on this clip, so the sheet
 * says "already sent" instead of sending a second.
 */
create or replace function agora_verified_lifts(p_post_ids uuid[])
returns table (
  post_id uuid, workout_set_id uuid, owner_id uuid, exercise text, slug text,
  weight numeric, reps int, duration_s numeric, resolution text,
  can_challenge boolean, my_challenge_id uuid
)
language sql
stable
security definer
set search_path = public
as $fn$
  select distinct on (l.post_id)
         l.post_id, ws.id, w.user_id, we.name, e.slug,
         ws.weight, ws.reps, ws.duration_s, ws.resolution,
         (w.user_id <> auth.uid()
           and are_friends(auth.uid(), w.user_id)
           and not is_blocked_either_way(w.user_id)) as can_challenge,
         (select sc.id from social_challenges sc
           where sc.race_metric = 'verified_lift' and sc.lift_set_id = ws.id
             and sc.created_by = auth.uid() and sc.status in ('pending', 'active')
           limit 1)
    from agora_post_lifts l
    join agora_posts p on p.id = l.post_id
    join workout_sets ws on ws.id = l.workout_set_id
    join workouts w on w.id = ws.workout_id
    join workout_exercises we on we.id = ws.workout_exercise_id
    join exercises e on e.id = we.exercise_id
   where l.post_id = any (p_post_ids[1:30])
     and auth.uid() is not null
     and not coalesce(p.attachments, '[]'::jsonb) @> '[{"kind": "video"}]'
     and ws.video_key is not null
     and ws.clip_consent_at is not null
     and ws.clip_shown_at is not null
     and ws.pr_status = 'ok'
     and not ws.pr_private
     and e.unit = 'weight'
     and coalesce(ws.weight, 0) > 0
     and get_agora_item(l.post_id, 'post') is not null
   order by l.post_id, gym_e1rm(ws.weight, ws.reps) desc, ws.created_at;
$fn$;

revoke all on function agora_verified_lifts(uuid[]) from public, anon;
grant execute on function agora_verified_lifts(uuid[]) to authenticated;

/**
 * May the caller play this set's clip because its owner showed it on a post they can open?
 * gym-clip-playback-url asks this AFTER its own owner / circle-mate / friend checks fail. Same
 * badge-worthy predicate as above, so a clip plays to a post's audience exactly when the badge does.
 */
create or replace function can_play_shown_lift_clip(p_workout_set_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select auth.uid() is not null and exists (
    select 1
      from agora_post_lifts l
      join workout_sets ws on ws.id = l.workout_set_id
     where l.workout_set_id = p_workout_set_id
       and ws.video_key is not null
       and ws.clip_consent_at is not null
       and ws.clip_shown_at is not null
       and ws.pr_status = 'ok'
       and not ws.pr_private
       and get_agora_item(l.post_id, 'post') is not null
  );
$fn$;

revoke all on function can_play_shown_lift_clip(uuid) from public, anon;
grant execute on function can_play_shown_lift_clip(uuid) to authenticated;

-- ───────────────────────────── 4. the race: one more metric on the duel path ─────────────────────────────
alter table social_challenges drop constraint if exists social_challenges_race_metric_check;
alter table social_challenges add constraint social_challenges_race_metric_check
  check (race_metric is null or race_metric = any (array[
    'lockin_time', 'volume', 'distance', 'ai', 'xp', 'grade', 'count', 'verified_lift'
  ]));

-- (The lift_* columns are added above section 3, whose SQL bodies read them.)

-- The frozen target is all-or-nothing, and only a verified_lift race has one. The set and post
-- references may later go null (deleted); the numbers they froze never do.
alter table social_challenges drop constraint if exists social_challenges_lift_shape;
alter table social_challenges add constraint social_challenges_lift_shape check (
  (coalesce(race_metric, '') = 'verified_lift')
  = (lift_slug is not null and lift_exercise is not null and lift_weight > 0 and lift_reps > 0)
);

comment on column social_challenges.lift_weight is
  '0282 -- verified_lift: the frozen target set (lift_weight × lift_reps on lift_slug), copied from the clip at send.';

create index if not exists social_challenges_live_lift_idx
  on social_challenges (created_by, lift_slug)
  where race_metric = 'verified_lift' and status in ('pending', 'active');

-- A verified_lift row can only be written through create_reel_challenge: create_h2h_challenge does
-- the insert (so friendship, roster and the invite stay the one path), and this trigger fills the
-- target from the transaction-local value the wrapper set. A bare create_h2h_challenge(...,
-- 'verified_lift', ...) has no target and is refused here, rather than creating a race nobody can
-- score.
create or replace function social_challenges_fill_lift_target()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v jsonb := nullif(current_setting('philoi.reel_challenge', true), '')::jsonb;
begin
  if new.race_metric is distinct from 'verified_lift' then
    return new;
  end if;
  if v is null then
    raise exception 'Challenge a lift from its clip.';
  end if;
  new.lift_set_id   := (v->>'set_id')::uuid;
  new.lift_post_id  := (v->>'post_id')::uuid;
  new.lift_exercise := v->>'exercise';
  new.lift_slug     := v->>'slug';
  new.lift_weight   := (v->>'weight')::numeric;
  new.lift_reps     := (v->>'reps')::int;
  return new;
end;
$fn$;

drop trigger if exists social_challenges_fill_lift_target on social_challenges;
create trigger social_challenges_fill_lift_target
  before insert on social_challenges
  for each row execute function social_challenges_fill_lift_target();

revoke all on function social_challenges_fill_lift_target() from public, anon, authenticated;

-- Observed from logged, clip-verified sets — 'auto', like volume and distance. Live body
-- (2026-10-26) plus 'verified_lift'.
create or replace function public.challenge_verifiability_for(p_race_metric text)
 returns text
 language sql
 immutable
as $function$
  select case
    when p_race_metric in ('lockin_time', 'volume', 'distance', 'verified_lift') then 'auto'
    else 'honor'
  end;
$function$;

-- ───────────────────────────── 5. scoring ─────────────────────────────
-- The challenger's best set that beats the frozen target, as weight + reps/1000; 0 if none.
create or replace function verified_lift_beat_score(p_challenge_id uuid, p_user uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $fn$
  select coalesce(max(ws.weight + least(ws.reps, 999) / 1000.0), 0)
    from social_challenges c
    join workouts w on w.user_id = p_user
    join workout_sets ws on ws.workout_id = w.id
    join workout_exercises we on we.id = ws.workout_exercise_id
    join exercises e on e.id = we.exercise_id
   where c.id = p_challenge_id
     and c.race_metric = 'verified_lift'
     and c.starts_at is not null
     and e.slug = c.lift_slug
     and ws.created_at >= c.starts_at
     and ws.created_at <= coalesce(c.ends_at, now())
     and ws.video_key is not null
     and ws.clip_consent_at is not null
     and ws.pr_status <> 'pulled'
     and not ws.pr_private
     and ((ws.weight > c.lift_weight and ws.reps >= c.lift_reps)
       or (ws.weight >= c.lift_weight and ws.reps > c.lift_reps));
$fn$;

revoke all on function verified_lift_beat_score(uuid, uuid) from public, anon, authenticated;

-- Live body (2026-10-26), unchanged except the first branch.
create or replace function public.challenge_racer_score(p_challenge_id uuid, p_user uuid)
 returns numeric
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select case
    when c.race_metric = 'verified_lift' then
      -- 0282 · the clip's owner holds the frozen target; the challenger scores only a verified set
      -- that beats it. Not net of a baseline: a lift is the number you hit, not how far you moved.
      case
        when p_user = c.opponent_id then c.lift_weight + least(c.lift_reps, 999) / 1000.0
        when p_user = c.created_by then verified_lift_beat_score(c.id, p_user)
        else 0
      end
    when c.race_metric = 'grade' then
      -- Absolute, and NOT net of the baseline. A grade is the number you got, not the number you
      -- improved by; subtracting a baseline here would score a 70 as 0.
      coalesce((select p.reported_value from challenge_participants p
                 where p.challenge_id = c.id and p.user_id = p_user), 0)
    when c.race_metric = 'count' then
      -- 0162 — the racer's own mirror goal is the counter. The baseline matters here because
      -- campfire_challenge_goals may point at a goal the racer already had.
      greatest(
        coalesce((select g.progress
                    from campfire_challenge_goals m
                    join challenges g on g.id = m.goal_id
                   where m.challenge_id = c.id and m.user_id = p_user), 0)
          - coalesce((select p.baseline from challenge_participants p
                       where p.challenge_id = c.id and p.user_id = p_user), 0),
        0)
    when c.race_metric is null then
      -- A collective goal has no metric race (0098 leaves it null). What it measures is how many
      -- qualifying lock-ins the racer put in during the window — the same count the completion
      -- test below uses, exposed as a score so the standings can be ranked by it.
      (select count(*) from check_ins ci
        where ci.user_id = p_user and ci.removed_at is null
          and ci.created_at >= c.starts_at and ci.created_at <= coalesce(c.ends_at, now())
          and check_in_qualifies_for_challenge(ci.id))
    else
      -- Progress since the gun, floored at zero: every accumulating source can shrink when
      -- something is deleted, and a negative score would sort a racer below somebody who did
      -- nothing at all.
      greatest(
        challenge_metric_value(c.race_metric, p_user, coalesce(c.ends_at, now()), c.lockin_goal_type)
          - coalesce((select p.baseline from challenge_participants p
                       where p.challenge_id = c.id and p.user_id = p_user), 0),
        0)
  end
  from social_challenges c
  where c.id = p_challenge_id;
$function$;

-- ───────────────────────────── 6. a beating clip settles the race early ─────────────────────────────
-- Fires on whatever makes a set count: logging it, its clip landing, consent, a dispute clearing.
-- Pulls ends_at to now(); finalize_social_challenges (cron, every 10 min) settles it through the
-- normal path — winner, rewards, and both sides' notifications.
create or replace function workout_sets_settle_lift_races()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_user uuid;
  v_slug text;
begin
  if new.video_key is null or new.clip_consent_at is null or new.pr_status = 'pulled' or new.pr_private then
    return null;
  end if;

  select w.user_id, e.slug into v_user, v_slug
    from workouts w
    join workout_exercises we on we.id = new.workout_exercise_id
    join exercises e on e.id = we.exercise_id
   where w.id = new.workout_id;

  update social_challenges c
     set ends_at = now()
   where c.race_metric = 'verified_lift'
     and c.status = 'active'
     and c.created_by = v_user
     and c.lift_slug = v_slug
     and c.ends_at > now()
     and verified_lift_beat_score(c.id, v_user) > c.lift_weight + least(c.lift_reps, 999) / 1000.0;
  return null;
end;
$fn$;

drop trigger if exists workout_sets_settle_lift_races on workout_sets;
create trigger workout_sets_settle_lift_races
  after insert or update of video_key, clip_consent_at, pr_status, pr_private, weight, reps on workout_sets
  for each row execute function workout_sets_settle_lift_races();

revoke all on function workout_sets_settle_lift_races() from public, anon, authenticated;

-- ───────────────────────────── 7. ⚔ — send it ─────────────────────────────
/**
 * Challenge the verified lift on a post. Everything comes from the server's own reading of the
 * post (agora_verified_lifts, as the caller): the exercise, the exact weight × reps, the owner.
 * The client sends only which post and which window.
 *
 * p_window: '7d' · '14d' · 'season' (to the current season's end, at least a day).
 */
create or replace function create_reel_challenge(p_post_id uuid, p_window text default '7d')
returns social_challenges
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_lift record;
  v_hours int;
  v_season_end timestamptz;
  v_name text;
  v_challenge social_challenges;
begin
  select * into v_lift from agora_verified_lifts(array[p_post_id]);
  if v_lift.post_id is null then
    raise exception 'That lift isn''t verified on this post.';
  end if;
  if v_lift.owner_id = auth.uid() then
    raise exception 'That''s your own lift. Beat it on your next set.';
  end if;
  if not v_lift.can_challenge then
    raise exception 'You can only challenge a friend.';
  end if;
  if v_lift.my_challenge_id is not null then
    raise exception 'You''ve already challenged this clip.';
  end if;

  v_hours := case p_window
    when '7d' then 168
    when '14d' then 336
    when 'season' then null
  end;
  if p_window = 'season' then
    select s.ends_at into v_season_end from current_season() s;
    if v_season_end is null then
      raise exception 'There''s no season running right now.';
    end if;
    v_hours := greatest(24, ceil(extract(epoch from (v_season_end - now())) / 3600)::int);
  elsif v_hours is null then
    raise exception 'Pick 7 days, 14 days or the season.';
  end if;

  -- "Beat 405 lb × 1 · Deadlift" — what the owner reads on the invite and every card titles with.
  v_name := left('Beat ' || rtrim(to_char(v_lift.weight, 'FM999999.##'), '.') || ' lb × ' || v_lift.reps
                 || ' · ' || v_lift.exercise, 60);  -- social_challenges_public_name_len caps it at 60

  perform set_config('philoi.reel_challenge', jsonb_build_object(
    'set_id', v_lift.workout_set_id, 'post_id', v_lift.post_id,
    'exercise', v_lift.exercise, 'slug', v_lift.slug,
    'weight', v_lift.weight, 'reps', v_lift.reps
  )::text, true);

  v_challenge := create_h2h_challenge(
    p_opponent_id := v_lift.owner_id,
    p_race_metric := 'verified_lift',
    p_window_hours := v_hours,
    p_public_name := v_name
  );

  perform set_config('philoi.reel_challenge', '', true);
  return v_challenge;
end;
$fn$;

revoke all on function create_reel_challenge(uuid, text) from public, anon;
grant execute on function create_reel_challenge(uuid, text) to authenticated;

-- ───────────────────────────── 8. the race, as its two racers see it ─────────────────────────────
/**
 * The target and where the challenger stands — what challenge-info draws for a verified_lift race
 * in place of the generic live score (which can't see the target, see the header).
 * Participants only.
 */
create or replace function get_lift_challenge(p_challenge_id uuid)
returns table (
  challenge_id uuid, owner_id uuid, challenger_id uuid, exercise text,
  target_weight numeric, target_reps int, source_post_id uuid, source_set_id uuid,
  best_weight numeric, best_reps int, beaten boolean, status text, starts_at timestamptz, ends_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $fn$
  select c.id, c.opponent_id, c.created_by, c.lift_exercise,
         c.lift_weight, c.lift_reps, c.lift_post_id, c.lift_set_id,
         b.weight, b.reps, b.weight is not null, c.status, c.starts_at, c.ends_at
    from social_challenges c
    left join lateral (
      select ws.weight, ws.reps
        from workouts w
        join workout_sets ws on ws.workout_id = w.id
        join workout_exercises we on we.id = ws.workout_exercise_id
        join exercises e on e.id = we.exercise_id
       where w.user_id = c.created_by
         and c.starts_at is not null
         and e.slug = c.lift_slug
         and ws.created_at >= c.starts_at
         and ws.created_at <= coalesce(c.ends_at, now())
         and ws.video_key is not null
         and ws.clip_consent_at is not null
         and ws.pr_status <> 'pulled'
         and not ws.pr_private
         and ((ws.weight > c.lift_weight and ws.reps >= c.lift_reps)
           or (ws.weight >= c.lift_weight and ws.reps > c.lift_reps))
       order by ws.weight + least(ws.reps, 999) / 1000.0 desc
       limit 1
    ) b on true
   where c.id = p_challenge_id
     and c.race_metric = 'verified_lift'
     and auth.uid() in (c.created_by, c.opponent_id);
$fn$;

revoke all on function get_lift_challenge(uuid) from public, anon;
grant execute on function get_lift_challenge(uuid) to authenticated;

-- ───────────────────────────── verify ─────────────────────────────
-- Runs the real path as two real friends, then undoes it by raising. Every "expect refused" is
-- paired with an "expect accepted" on the same setup, so a check that passes under the bug can't.
do $verify$
declare
  v_owner uuid;
  v_chal uuid;
  v_ex uuid;
  v_wo uuid;
  v_we uuid;
  v_set uuid;
  v_post uuid;
  v_c social_challenges;
  v_n int;
  v_ok boolean;
begin
  perform set_config('philoi.suppress_push', 'on', true);

  select fr.requester_id, fr.recipient_id into v_owner, v_chal
    from friend_requests fr
    join profiles a on a.id = fr.requester_id and not a.is_demo and not a.is_disabled
    join profiles b on b.id = fr.recipient_id and not b.is_demo and not b.is_disabled
   where fr.status = 'accepted'
   order by fr.created_at
   limit 1;
  select id into v_ex from exercises where created_by is null and unit = 'weight' and slug <> '' order by created_at limit 1;
  if v_owner is null or v_ex is null then return; end if;

  begin
    -- The owner's 405 × 1 with a clip and review consent, posted friends-only as a PR card.
    insert into workouts (user_id) values (v_owner) returning id into v_wo;
    insert into workout_exercises (workout_id, exercise_id, name) values (v_wo, v_ex, 'Probe lift') returning id into v_we;
    insert into workout_sets (workout_id, workout_exercise_id, set_index, weight, reps, video_key, thumb_key, uploaded_at, clip_consent_at)
    values (v_wo, v_we, 1, 405, 1, 'probe/' || gen_random_uuid() || '.mp4', null, now(), now())
    returning id into v_set;
    insert into agora_posts (user_id, body, visibility, attachments)
    values (v_owner, 'new 1RM', 'friends', jsonb_build_array(jsonb_build_object('kind', 'lockin', 'snapshot',
            jsonb_build_object('clips', jsonb_build_array(jsonb_build_object('workout_set_id', v_set))))))
    returning id into v_post;

    if not exists (select 1 from agora_post_lifts where post_id = v_post and workout_set_id = v_set) then
      raise exception '0282 verify: the post did not link its clip''s set';
    end if;

    -- Not shown yet → no badge for the friend. Shown → badge, challengeable.
    perform set_config('request.jwt.claims', json_build_object('sub', v_chal, 'role', 'authenticated')::text, true);
    select count(*) into v_n from agora_verified_lifts(array[v_post]);
    if v_n <> 0 then raise exception '0282 verify: a clip its owner never showed got a badge'; end if;
    if can_play_shown_lift_clip(v_set) then raise exception '0282 verify: an unshown clip was playable through a post'; end if;

    update workout_sets set clip_shown_at = now() where id = v_set;
    select count(*) filter (where can_challenge and weight = 405 and reps = 1) into v_n from agora_verified_lifts(array[v_post]);
    if v_n <> 1 then raise exception '0282 verify: a shown verified clip got no challengeable badge'; end if;
    if not can_play_shown_lift_clip(v_set) then raise exception '0282 verify: a shown clip was not playable through its post'; end if;

    -- A disputed clip loses its badge while the review is open.
    update workout_sets set pr_status = 'disputed' where id = v_set;
    select count(*) into v_n from agora_verified_lifts(array[v_post]);
    if v_n <> 0 then raise exception '0282 verify: a disputed clip kept its badge'; end if;
    update workout_sets set pr_status = 'ok' where id = v_set;

    -- A bare create_h2h_challenge on the new metric is refused; the wrapper is accepted.
    begin
      perform create_h2h_challenge(p_opponent_id := v_owner, p_race_metric := 'verified_lift', p_window_hours := 168);
      raise exception '0282 verify: a verified_lift race was created with no target';
    exception when others then
      if sqlerrm like '0282 verify:%' then raise; end if;
    end;
    v_c := create_reel_challenge(v_post, '7d');
    if v_c.lift_weight <> 405 or v_c.lift_reps <> 1 or v_c.opponent_id <> v_owner or v_c.created_by <> v_chal
       or v_c.status <> 'pending' or v_c.race_metric <> 'verified_lift' or v_c.window_hours <> 168 then
      raise exception '0282 verify: the challenge was not pre-filled from the clip';
    end if;
    begin
      perform create_reel_challenge(v_post, '7d');
      raise exception '0282 verify: one clip was challenged twice';
    exception when others then
      if sqlerrm like '0282 verify:%' then raise; end if;
    end;

    -- The owner accepts. With no qualifying clip the owner leads.
    perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
    perform respond_to_h2h_challenge(v_c.id, true);
    if challenge_racer_score(v_c.id, v_owner) <= challenge_racer_score(v_c.id, v_chal) then
      raise exception '0282 verify: the owner did not hold with no clip in';
    end if;

    -- The challenger logs a TIE (405 × 1, verified) — not a beat. Then 405 × 2 unverified — not a
    -- beat. Then consent on it — a beat, and the race's clock is pulled in.
    insert into workouts (user_id) values (v_chal) returning id into v_wo;
    insert into workout_exercises (workout_id, exercise_id, name) values (v_wo, v_ex, 'Probe lift') returning id into v_we;
    insert into workout_sets (workout_id, workout_exercise_id, set_index, weight, reps, video_key, uploaded_at, clip_consent_at)
    values (v_wo, v_we, 1, 405, 1, 'probe/' || gen_random_uuid() || '.mp4', now(), now());
    if challenge_racer_score(v_c.id, v_chal) <> 0 then raise exception '0282 verify: a tie counted as a beat'; end if;

    insert into workout_sets (workout_id, workout_exercise_id, set_index, weight, reps, video_key, uploaded_at)
    values (v_wo, v_we, 2, 405, 2, 'probe/' || gen_random_uuid() || '.mp4', now())
    returning id into v_set;
    if challenge_racer_score(v_c.id, v_chal) <> 0 then raise exception '0282 verify: an unverified set counted'; end if;
    select (ends_at > now()) into v_ok from social_challenges where id = v_c.id;
    if not v_ok then raise exception '0282 verify: the clock moved before a verified beat'; end if;

    update workout_sets set clip_consent_at = now() where id = v_set;
    if challenge_racer_score(v_c.id, v_chal) <= challenge_racer_score(v_c.id, v_owner) then
      raise exception '0282 verify: a verified 405 × 2 did not beat 405 × 1';
    end if;
    select (ends_at <= now()) into v_ok from social_challenges where id = v_c.id;
    if not v_ok then raise exception '0282 verify: a verified beat did not pull the race''s end in'; end if;

    -- Settlement is the existing sweep: the challenger wins.
    perform finalize_social_challenges();
    select * into v_c from social_challenges where id = v_c.id;
    if v_c.status <> 'completed' or v_c.winner_id is distinct from v_chal then
      raise exception '0282 verify: settled as % / winner %, expected completed / challenger', v_c.status, v_c.winner_id;
    end if;

    raise exception using errcode = 'P0282', message = 'rollback';
  exception
    when sqlstate 'P0282' then null;
  end;
end
$verify$;

commit;
