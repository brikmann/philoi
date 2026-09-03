-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- 0162 · CINDY HOSTS A CHALLENGE IN A CAMPFIRE — and a counted feat finally has something to
--        count. "set a 1000 pushup challenge for Goat".
--
-- Spec: CHALLENGE_CINDY_SCOPING.md (§Roles, §Distribution, §Metrics, §Custom lock-in types),
-- DIFFICULTY_SCOPING.md §4, CODE_PROMPT_cindy_campfire_goals.md.
--
-- ─────────────────────────── WHAT WAS ACTUALLY BROKEN, READ FROM PROD ───────────────────────────
--
-- Three separate things, and only one of them is the permission gate the brief leads with.
--
-- 1 · A COUNT CAMPFIRE CHALLENGE MEASURED THE WRONG NUMBER. This is the real §4 bug, and it is
--     worse than "has no race_metric". A collective challenge leaves race_metric NULL, and
--     challenge_racer_score's null arm is explicit about what that means:
--
--         when c.race_metric is null then
--           (select count(*) from check_ins ci ... check_in_qualifies_for_challenge(ci.id))
--
--     It counts QUALIFYING LOCK-IN SESSIONS. So "1000 pushups for Goat", created today through
--     create_group_challenge with target_count = 1000, is a race to log **one thousand lock-in
--     sessions** — and every pushup anybody actually does is invisible to it. The challenge does
--     not under-score; it scores a different quantity. That is why the scoping agent found nothing
--     to scope: there was no pushup number anywhere in social_challenges to scope against.
--
-- 2 · THE PERMISSION GATE WAS HALF THERE. create_placement_challenge (0126) already refuses a
--     non-admin — "Only campfire admins can start a placement race", is_campfire_admin(), owner or
--     admin. create_group_challenge checks only is_group_member. The campfire tab's own UI has
--     been assuming the stricter rule for a while (challenges-tab.tsx renders "Set a race for the
--     campfire" behind `isAdmin` and its comment says "creation is admin-gated server-side either
--     way") — which was true of the placement shape and not of the collective one.
--
--     Both doors are gated here. Gating only the new Cindy-facing RPC would have made the gate
--     decorative: a client that can call one RPC can call the other, and the brief's requirement
--     is that a forged campfire/role FAILS AT THE RPC.
--
-- 3 · NOTHING ANNOUNCED A HOSTED CHALLENGE. 0147 added campfire-challenge notifications for the
--     invite, the acceptance, the gun and the settlement. There is no event for "X is hosting a
--     challenge for <campfire>" (§Distribution's `challenge_hosted`), and nothing has ever posted
--     a challenge card into campfire chat — `messages.attach_kind` admits 'photo' and 'lockin'
--     and nothing else.
--
-- ─────────────────────────── HOW A COUNT IS COUNTED: THE MIRROR GOAL ───────────────────────────
--
-- §Custom lock-in types says joining a challenge whose metric is a custom type "adds that type to
-- your lock-in menu automatically, marked with a challenge aura". That sentence is also the answer
-- to §4, and it is why this migration does not invent a second progress ledger.
--
-- A participant's count lives in a PERSONAL GOAL — a `challenges` row, type 'custom', label
-- 'Pushups', target 1000. That row already:
--
--   · appears on their goals/lock-in surface, which IS "on your lock-in menu";
--   · is fed by the gym-set feeder (0149) — reps logged in a gym lock-in credit it automatically,
--     which is what makes "logged pushups count" literally true;
--   · is fed by hand-logging through the same path any goal is;
--   · carries `unit`, normalised by 0157, so it renders "0 / 1000 pushups".
--
-- The race then scores off that goal. Nothing new counts anything; the challenge reads a number
-- the app was already keeping.
--
-- REUSE BEFORE MINT. If the joiner already has an active "Pushups" goal, that goal is adopted
-- rather than duplicated — 0148's trigger would refuse the second one anyway ("You already have
-- this goal running"), and refusing to let somebody join a pushup challenge because they already
-- track pushups would be absurd. The adopted goal's progress at the moment of joining is written
-- to challenge_participants.baseline, so the race credits work done DURING it and not the
-- fortnight of reps that came before — the same (current − baseline) rule every other metric obeys.
--
-- TWO OBJECTS, TWO DIFFERENT FACTS, and neither is redundant:
--   · campfire_challenge_goals — WHICH goal feeds WHICH race. Authoritative for scoring, and a
--     mapping because one "Pushups" goal can legitimately feed two campfires' challenges at once.
--   · challenges.challenge_source_id — this goal was MINTED BY a challenge (the ⚡ aura). Null on
--     an adopted goal, which is correct: a goal you already had was not created for anything.
--     A column rather than a join because fetchMyChallenges is `select('*')`, so the aura reaches
--     the client with no read-path change at all.
--
-- 🔴 ONE FEAT, ONE COMPLETION REWARD. A minted mirror goal completing would otherwise fire
-- economy_on_challenge_completed AND have the race settle on the same 1000 pushups — two boxes for
-- one set of reps. The trigger now returns early for a goal carrying challenge_source_id: the
-- CHALLENGE is what pays. The daily drip is deliberately left alone (it is the "you showed up
-- today" trickle, capped at ~300/wk across all goals by economy_award_goal_day_for, so it cannot
-- be farmed through this). An ADOPTED goal keeps its own completion reward, because it is a goal
-- the user already had and would have been paid for with or without the challenge.
--
-- ─────────────────────────── THE FIREWALL IS UNMOVED ───────────────────────────
--
-- Cindy proposes; the client performs under the user's own JWT; the server decides. Same shape as
-- 0160, and the three security properties are the same three:
--
--   1. THE ROLE IS RE-CHECKED SERVER-SIDE, from group_members, at the moment of the write. Nothing
--      in Cindy's structured output is consulted. A forged `campfire` fails because the caller is
--      not an admin OF THAT CAMPFIRE; a forged role fails because no role is ever read from input.
--   2. THE TIER IS VALIDATED, NEVER TRUSTED — one of six names, and `verifiability` is DERIVED
--      here, never passed. A count race is 'honor' by derivation, so goal_paid_band caps it at
--      'notable' (The Furnace) however high a lying client scopes it.
--   3. THE PAYOUT IS RE-DERIVED at settlement from the stored tier + economy_config. Nothing here
--      stores an ember figure or a box key, and nothing here grants anything.
--
-- ─────────────────────────── WHAT THIS DELIBERATELY DOES NOT BUILD ───────────────────────────
--
-- · The TIMED OPT-IN WINDOW (§Opt-in group challenges: status 'opt_in', opt_in_deadline, a sweep
--   that locks the roster at the deadline). social_challenges_status_check has no 'opt_in' value
--   and the sweep does not exist. Members opt in by tapping Join on the chat card, which is the
--   same roster outcome without the deadline machinery. Its own migration.
-- · 'most_by_deadline' AS A COUNT RACE. That is the placement shape, and
--   social_challenges_mode_target_check requires target_count IS NULL on a placement — so a count
--   race with a target cannot be one. Teaching create_placement_challenge the count metric is a
--   change to a settled ranking path and belongs with its own before/after. Refused here with a
--   sentence rather than silently reshaped into a collective, which would change how it settles.
-- · SETTLEMENT reading difficulty_tier. Still 0160's open item, restated there: it is a change to
--   the settlement path for every live duel on prod. The tier is stored and previewed; what a
--   settled campfire challenge pays is unchanged by this file.
-- ══════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────── §1 · a race may be measured in things counted ───────────────────────────

alter table social_challenges
  add column if not exists count_unit text;

comment on column social_challenges.count_unit is
  '0162 — the plural noun a count race counts ("pushups"), which is also the mirror goal''s label and unit. Non-null exactly when race_metric = ''count''.';

do $$
begin
  -- The metric vocabulary gains one name. Restated in full because a CHECK cannot be appended to.
  alter table social_challenges drop constraint if exists social_challenges_race_metric_check;
  alter table social_challenges add constraint social_challenges_race_metric_check
    check (race_metric is null or race_metric in
           ('lockin_time', 'volume', 'distance', 'ai', 'xp', 'grade', 'count'));

  if not exists (select 1 from pg_constraint where conname = 'social_challenges_count_shape') then
    -- Both directions. A count race without a unit renders "0 / 1000" and its mirror goal has
    -- nothing to be called; a unit on any other metric is a claim nothing reads.
    alter table social_challenges add constraint social_challenges_count_shape
      check ((coalesce(race_metric, '') = 'count') = (count_unit is not null));
  end if;
end $$;

-- ─────────────────────────── §1 · the aura, and the mapping under it ───────────────────────────

alter table challenges
  add column if not exists challenge_source_id uuid references social_challenges(id) on delete set null;

comment on column challenges.challenge_source_id is
  '0162 — set when this goal was MINTED for a campfire challenge (the ⚡ "created for a challenge" aura). Null on a goal the user already had and the challenge adopted. Also suppresses the goal''s own completion box, so one set of reps pays once — see economy_on_challenge_completed.';

create table if not exists campfire_challenge_goals (
  challenge_id uuid not null references social_challenges(id) on delete cascade,
  user_id      uuid not null references profiles(id) on delete cascade,
  goal_id      uuid not null references challenges(id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (challenge_id, user_id)
);

comment on table campfire_challenge_goals is
  '0162 — which personal goal carries a racer''s count for a count race. A mapping and not a column on either side, because one "Pushups" goal can feed two campfires'' challenges at once.';

create index if not exists campfire_challenge_goals_goal_idx on campfire_challenge_goals (goal_id);

alter table campfire_challenge_goals enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies
                  where tablename = 'campfire_challenge_goals' and policyname = 'own mapping rows') then
    -- Read-only to clients, and only your own row. Every write goes through the two security
    -- definer functions below, which is where the roster rules live.
    create policy "own mapping rows" on campfire_challenge_goals
      for select using (user_id = auth.uid());
  end if;
end $$;

-- ─────────────────────────── §1 · the chat card is a first-class attachment ───────────────────────────
--
-- Restated in full with one arm added. attach_ref_id carries the social_challenges id, matching
-- the 'lockin' arm's use of it for a check_ins id; attach_path stays null because there is no file.
alter table messages drop constraint if exists messages_attachment_shape;
alter table messages add constraint messages_attachment_shape
  check (
    (attach_kind is null and attach_path is null and attach_ref_id is null)
    or (attach_kind = 'photo'  and attach_path is not null and attach_ref_id is null
        and attach_path like (user_id::text || '/%'))
    or (attach_kind = 'lockin' and attach_ref_id is not null and attach_path is null)
    or (attach_kind = 'challenge' and attach_ref_id is not null and attach_path is null)
  );

-- ─────────────────────────── §3 · challenge_hosted is a campfire event ───────────────────────────
--
-- ⚠️ RESTATED FROM PROD'S OWN prosrc, read out of pg_proc, with ONE NAME ADDED and nothing else
-- touched. This function's history is the cautionary tale in its own body: the 0135 restatement
-- was built without sight of 0120 and silently dropped 'session_complete' onto the else-branch,
-- filing every session recap under Friends & social. Do not rebuild this CASE from a spec.
--
-- It lands in 'campfires' and not 'challenges' on purpose: this fires at every member of a
-- campfire, including people with no relationship to the challenge, so the toggle that should
-- silence it is the campfire one — the same reasoning that put 'campfire_challenge_started' there.
create or replace function notification_category(p_type text)
returns text
language sql
immutable
set search_path = public
as $function$
  select case
    when p_type in ('friend_request', 'friend_accepted', 'friend_ranked_up', 'friend_passed_you',
                    'friend_joined', 'friend_locked_in',
                    -- §8 (NOTIFICATIONS_SPEC "Friends & social").
                    'milestone_cheered', 'milestone_posted',
                    -- The Agora (AGORA_SPEC) — reactions to you, on your own posts.
                    'agora_cheered', 'agora_commented',
                    -- notify_push's own names for the same two things.
                    'check_in', 'reaction') then 'friends_social'
    when p_type in ('challenged', 'challenge_accepted', 'challenge_declined', 'challenge_passed',
                    'challenge_ending_soon', 'challenge_won', 'challenge_lost', 'goal_at_risk',
                    'goal_streak_milestone', 'challenge_cheered',
                    -- notify_push's challenge vocabulary.
                    'challenge_invite', 'challenge_forfeited', 'challenge_change_request',
                    'challenge_change_answered', 'challenge_terms_updated') then 'challenges'
    when p_type in ('campfire_joined', 'campfire_join_request', 'campfire_challenge_started',
                    'campfire_cold', 'campfire_added', 'campfire_settled', 'campfire_message',
                    -- notify_push's campfire vocabulary: joining, chat and admin.
                    'join_request', 'join_request_approved', 'campfire_admin_granted',
                    'chat_batch', 'mention',
                    -- 0152: the + menu's silent nudge. A campfire thing, so the campfire toggle
                    -- governs it.
                    'campfire_ping',
                    -- 0162 · §Distribution's "X is hosting a challenge for <campfire>". Fires at
                    -- EVERY member of the campfire, so the campfire toggle is the one that should
                    -- silence it — same rule as campfire_challenge_started above.
                    'challenge_hosted') then 'campfires'
    when p_type in ('streak_at_risk', 'daily_fire_reminder', 'streak_milestone',
                    -- INTEGRATION: 0120 (a parallel branch when this file was written) added the
                    -- session recap and mapped it here — "nudges about my own consistency" is the
                    -- toggle a user already reads as covering it. This function restates its whole
                    -- CASE on every redefinition, and this one was built from 0112 + 0093 without
                    -- sight of 0120, so restating it dropped the mapping onto the else-branch and
                    -- filed every recap under Friends & social. Exactly the half-copy failure the
                    -- comment above 0120's own version warns about, one migration later.
                    'session_complete',
                    -- All three are nudges about your own consistency, which is what this toggle
                    -- says on the tin.
                    'streak_risk', 'lock_in_nudge', 'lockin_still_here') then 'streak_reminders'
    when p_type in ('season_ending', 'season_settled', 'ranked_up', 'rank_dropped', 'reward_ready')
      then 'season_rank'
    else 'friends_social'
  end;
$function$;

-- ─────────────────────────── §2 · the gate, on BOTH campfire doors ───────────────────────────
--
-- ⚠️ RESTATED FROM PROD'S OWN prosrc with the membership check swapped for the admin check and
-- NOTHING ELSE CHANGED — including 0147's restored participant insert, which a body rebuilt from
-- 0145 would silently drop for the third time. Signature is byte-identical (all nine arguments,
-- same types, same order, same defaults), so this REPLACES rather than adding an overload, and the
-- grant to `authenticated` lives on that unchanged signature and carries over.
--
-- WHY THE MEMBER CHECK WAS NOT ENOUGH: a collective challenge names the whole campfire, posts into
-- its chat and pushes to every member. That is the campfire's own voice, so the authority to use
-- it is the campfire's own — the identical argument 0126 makes for the placement shape.
--
-- The refusal NAMES THE CAMPFIRE because Cindy relays this sentence to the user verbatim, and
-- "You're not an admin of that campfire" is a worse thing to be told than "of Goat".
create or replace function create_group_challenge(
  p_circle_id uuid,
  p_target_count int,
  p_window_hours int,
  p_payout_xp int default 300,
  p_public_name text default null,
  p_starts_on timestamptz default null,
  p_ends_on timestamptz default null,
  p_grade_target numeric default null,
  p_course_code text default null
)
returns social_challenges
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_challenge social_challenges;
begin
  perform assert_challenge_span(p_starts_on, p_ends_on);

  if not is_group_member(p_circle_id) then
    raise exception 'Not a member of that campfire.';
  end if;

  -- 0162 — hosting for the whole campfire is an admin act. Checked after membership so a
  -- non-member still gets the more accurate of the two sentences.
  if not is_campfire_admin(p_circle_id, auth.uid()) then
    raise exception 'You''re not an admin of %, so a challenge can''t be posted there.',
      coalesce((select g.name from groups g where g.id = p_circle_id), 'that campfire');
  end if;

  -- Exactly one bar, matching social_challenges_mode_target_check. Caught here as well as by the
  -- constraint so the caller gets a sentence rather than a constraint name.
  if (p_target_count is not null) = (p_grade_target is not null) then
    raise exception 'A collective goal needs either a lock-in target or a grade target, not both.';
  end if;

  insert into social_challenges (circle_id, created_by, mode, target_count, window_hours, payout_xp, status, starts_at, ends_at, public_name, shape, starts_on, ends_on, race_metric, grade_target, course_code)
  values (p_circle_id, auth.uid(), 'group', p_target_count, p_window_hours, p_payout_xp, 'draft', null, null, nullif(btrim(coalesce(p_public_name, '')), ''), 'collective', p_starts_on, p_ends_on,
          case when p_grade_target is not null then 'grade' else null end,
          p_grade_target, nullif(btrim(coalesce(p_course_code, '')), ''))
  returning * into v_challenge;

  -- ← RESTORED FROM 0112 by 0147. See that file's header; carried forward verbatim.
  insert into challenge_participants (challenge_id, user_id, state, responded_at)
  values (v_challenge.id, auth.uid(), 'accepted', now())
  on conflict (challenge_id, user_id) do nothing;

  return v_challenge;
end;
$function$;

-- ─────────────────────────── §4 · a count race scores the count ───────────────────────────
--
-- ⚠️ RESTATED FROM PROD'S OWN prosrc with ONE ARM ADDED above the null arm. The null arm below it
-- is untouched and stays: every collective challenge already live is scored by it, and reaching
-- into those races to re-score them would change what an in-flight campfire challenge is measuring
-- halfway through.
--
-- The new arm follows the same (current − baseline) rule as the accumulating metrics, for the same
-- reason: an ADOPTED goal arrives with history on it, and crediting a fortnight of pre-existing
-- reps to a race that started this morning is the exact thing baselines exist to stop.
create or replace function challenge_racer_score(p_challenge_id uuid, p_user uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $function$
  select case
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
        challenge_metric_value(c.race_metric, p_user, coalesce(c.ends_at, now()))
          - coalesce((select p.baseline from challenge_participants p
                       where p.challenge_id = c.id and p.user_id = p_user), 0),
        0)
  end
  from social_challenges c
  where c.id = p_challenge_id;
$function$;

-- ─────────────────────────── §1 · joining adds the type to your lock-in menu ───────────────────────────
--
-- INTERNAL. Not an RPC (0132's rule): it writes a goal on a named user's behalf, so exposing it
-- would let anyone mint goals in anyone's list. The two callers below are its only doors.
create or replace function campfire_challenge_attach_goal(p_challenge_id uuid, p_user uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c social_challenges;
  v_goal challenges;
  v_label text;
  v_minted boolean := false;
begin
  select * into v_c from social_challenges where id = p_challenge_id;
  if v_c.id is null or coalesce(v_c.race_metric, '') <> 'count' then
    -- Every other metric is read from a source the app already keeps. Nothing to attach.
    return null;
  end if;

  v_label := initcap(btrim(v_c.count_unit));

  -- Already attached — joining twice is not two goals.
  select g.* into v_goal
    from campfire_challenge_goals m join challenges g on g.id = m.goal_id
   where m.challenge_id = p_challenge_id and m.user_id = p_user;
  if v_goal.id is not null then
    return v_goal.id;
  end if;

  -- ── ADOPT BEFORE MINT ──
  -- 0148's trigger keys a custom goal on lower(trim(label)) + period, and would refuse a second
  -- one anyway. Matching its key exactly here means the adopt path fires in precisely the cases
  -- the mint path would have failed in, rather than in a slightly different set of them.
  select g.* into v_goal
    from challenges g
   where g.user_id = p_user
     and g.type = 'custom'
     and g.period = 'once'
     and g.completed_at is null
     and g.retired_at is null
     and lower(btrim(coalesce(g.label, ''))) = lower(v_label)
   order by g.created_at
   limit 1;

  if v_goal.id is null then
    insert into challenges (user_id, type, label, target, unit, period, count_mode,
                            visibility, challenge_source_id)
    values (p_user, 'custom', v_label, v_c.target_count, lower(btrim(v_c.count_unit)), 'once',
            -- 'manual', which is what makes the 0149 gym-set feeder credit it: that feeder matches
            -- a custom goal by LABEL, and 'lockin_time' would instead accrue hours and make a
            -- pushup target fill from sitting still.
            'manual', 'circle', p_challenge_id)
    returning * into v_goal;
    v_minted := true;
  end if;

  insert into campfire_challenge_goals (challenge_id, user_id, goal_id)
  values (p_challenge_id, p_user, v_goal.id)
  on conflict (challenge_id, user_id) do nothing;

  -- The baseline is the adopted goal's history. Zero on a freshly minted one, which is the same
  -- statement said cheaply. Written onto the roster row the rest of the challenge machinery
  -- already reads, rather than into a second place that could disagree with it.
  update challenge_participants
     set baseline = case when v_minted then 0 else coalesce(v_goal.progress, 0) end
   where challenge_id = p_challenge_id and user_id = p_user;

  return v_goal.id;
end;
$$;

comment on function campfire_challenge_attach_goal(uuid, uuid) is
  '0162 — puts a count race''s metric on a racer''s lock-in menu as a personal goal, adopting one they already have rather than minting a duplicate 0148 would refuse. Internal: writes on a named user''s behalf.';

revoke all on function campfire_challenge_attach_goal(uuid, uuid) from public;
revoke all on function campfire_challenge_attach_goal(uuid, uuid) from authenticated;

-- ─────────────────────────── §3 · one feat, one completion reward ───────────────────────────
--
-- ⚠️ RESTATED FROM 0159's body with one guard added at the top and nothing else changed.
--
-- Without it a minted mirror goal pays its own completion box the moment the racer's 1000th pushup
-- lands, and then the race settles and pays again for the same reps. The CHALLENGE is the payout
-- for a challenge's goal; the goal is a counter the user can see.
--
-- Only a MINTED goal is silenced. An adopted one keeps its reward, because the user had it before
-- the challenge existed and would have been paid for finishing it either way.
create or replace function economy_on_challenge_completed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cfg jsonb := (select value from economy_config where key = 'tier_payout');
  v_sig numeric;
  v_cap text;
begin
  if new.completed_at is null or old.completed_at is not null then
    return new;
  end if;

  -- 0162 — a goal minted BY a campfire challenge is that challenge's counter, not a second prize.
  -- evaluate_pass_achievements still runs: pass progress is a record of what they did, and they
  -- did do it.
  if new.challenge_source_id is not null then
    perform evaluate_pass_achievements(new.user_id);
    return new;
  end if;

  -- WAS A LITERAL 1.0 — see 0159's header. That constant is what made every completed goal an
  -- Ignition Crate, and it is also the reason `uncommon` is pinned at significance 1.0 in
  -- tier_payout: an unscoped goal resolves to exactly the number that was hard-coded here, so
  -- nothing in flight changes what it pays.
  v_sig := coalesce((v_cfg -> coalesce(new.difficulty_tier, '') ->> 'significance')::numeric, 1.0);
  v_cap := goal_paid_band(new.difficulty_tier, new.verifiability);

  perform grant_reward(
    new.user_id, 'friend_h2h', v_sig,
    case when new.period = 'week' then 7 else 1 end,
    1, 0.0, true, new.id,
    v_cap
  );
  perform evaluate_pass_achievements(new.user_id);
  return new;
end;
$$;

-- ─────────────────────────── §4 · a count race is scopable ───────────────────────────
--
-- ⚠️ RESTATED FROM 0160's body with the field-size fix and nothing else changed.
--
-- 'count' resolves to HONOR through the existing else-arm, and that is the anti-cheese working
-- rather than an oversight. A mirror goal is count_mode 'manual': the gym-set feeder can fill it,
-- and so can a person typing a number. Where the app cannot tell those apart it must assume the
-- cheaper one — so a 1000-pushup campfire challenge scoped Epic is capped by goal_paid_band at
-- 'notable' (The Furnace). That is four bands above the Ignition Crate floor every custom goal
-- used to collect, which is what "difficulty scopes, not the floor" asks for; it is not a route to
-- a top box, and must not become one without a vouch or a clip behind it.
create or replace function set_challenge_scope(p_challenge_id uuid, p_tier text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ch social_challenges;
  v_verif text;
  v_scope int;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;

  if p_tier is null or p_tier not in ('common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic') then
    raise exception 'Unknown difficulty tier.';
  end if;

  select * into v_ch from social_challenges c where c.id = p_challenge_id;
  if v_ch.id is null then
    raise exception 'Challenge not found.';
  end if;
  if v_ch.created_by <> auth.uid() then
    raise exception 'Only the person who set it can scope it.';
  end if;
  if v_ch.status not in ('draft', 'pending') then
    raise exception 'That challenge has already started.';
  end if;
  if v_ch.difficulty_tier is not null then
    raise exception 'That challenge has already been scoped.';
  end if;

  -- Same derivation, same reason: a race scored off an observed metric is auto; a free-text one is
  -- honor. race_metric is null on a plain count-target collective goal, which is the honour case,
  -- and 0162's 'count' is the honour case too — see the header above.
  v_verif := case
    when v_ch.race_metric in ('lockin_time', 'volume', 'distance') then 'auto'
    else 'honor'
  end;

  update social_challenges
     set difficulty_tier = p_tier,
         verifiability = v_verif
   where id = p_challenge_id;

  -- 0162 — the FIELD is the scope term the significance formula wants (§4: target magnitude ×
  -- field size × duration). This passed a literal 1, which is a duel. The roster is the honest
  -- number and it is the one the preview should price.
  select greatest(count(*), 1) into v_scope
    from challenge_participants p where p.challenge_id = p_challenge_id;

  return preview_challenge_reward(
    p_tier,
    v_verif,
    greatest(1, coalesce(v_ch.window_hours, 24) / 24),
    v_scope
  );
end;
$$;

-- ─────────────────────────── §1-§3 · the door Cindy's params come through ───────────────────────────
--
-- Everything above is machinery; this is the act. Admin-gated, creates, enrols, scopes, announces
-- and posts the card — one round trip, because a half-hosted challenge (created but unannounced,
-- or announced but unscoped) is a worse outcome than a refused one, and only a single transaction
-- can promise that.
create or replace function host_campfire_challenge(
  p_circle_id uuid,
  p_metric text,
  p_target numeric,
  p_window_hours int default 168,
  p_label text default null,
  p_shape text default 'everyone_hits_target',
  p_tier text default null,
  p_payout_xp int default 300
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group groups;
  v_challenge social_challenges;
  v_unit text := lower(btrim(coalesce(p_metric, '')));
  v_name text;
  v_host text;
  v_members uuid[];
  v_notified int;
  v_message_id uuid;
  v_preview jsonb;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;

  select * into v_group from groups g where g.id = p_circle_id;
  if v_group.id is null then
    raise exception 'Campfire not found.';
  end if;

  -- 🔒 THE GATE. Read from group_members at the moment of the write. Nothing about the caller's
  -- role arrives as an argument, so there is no role to forge — and a forged CAMPFIRE fails right
  -- here, because the caller is not an admin of it.
  if not is_group_member(p_circle_id) then
    raise exception 'You''re not in %.', v_group.name;
  end if;
  if not is_campfire_admin(p_circle_id, auth.uid()) then
    raise exception 'You''re not an admin of %, so I can''t post a challenge there.', v_group.name;
  end if;

  if v_unit = '' then
    raise exception 'A counted challenge needs something to count.';
  end if;
  if p_target is null or p_target <= 0 then
    raise exception 'A counted challenge needs a target above zero.';
  end if;
  if p_shape = 'most_by_deadline' then
    -- See the header. A ranked race carries no target_count, so it cannot be a count race under
    -- social_challenges_mode_target_check; reshaping it into a collective would silently change
    -- how it settles.
    raise exception 'A "most by the deadline" race is a placement race — set that one as a race for the campfire.';
  end if;
  if p_shape not in ('everyone_hits_target', 'first_to') then
    raise exception 'Unknown challenge shape.';
  end if;

  v_name := nullif(btrim(coalesce(p_label, '')), '');
  if v_name is null then
    v_name := trim(to_char(p_target, 'FM999999999')) || ' ' || v_unit;
  end if;

  insert into social_challenges (
    circle_id, created_by, mode, shape, race_metric, count_unit,
    target_count, window_hours, payout_xp, status, public_name
  )
  values (
    p_circle_id, auth.uid(), 'group', 'collective', 'count', v_unit,
    -- target_count is an int column; a count target is whole things.
    ceil(p_target)::int, p_window_hours, p_payout_xp, 'draft', left(v_name, 60)
  )
  returning * into v_challenge;

  -- R5 — the host is in their own challenge. Same statement, same reason, as 0147's.
  insert into challenge_participants (challenge_id, user_id, state, responded_at)
  values (v_challenge.id, auth.uid(), 'accepted', now())
  on conflict (challenge_id, user_id) do nothing;

  perform campfire_challenge_attach_goal(v_challenge.id, auth.uid());

  -- The tier, through the one function that validates it and derives verifiability. Not inlined:
  -- a second copy of that derivation is a second thing that can drift from goal_paid_band.
  if p_tier is not null then
    v_preview := set_challenge_scope(v_challenge.id, p_tier);
  end if;

  -- ── §3 · the bell, and the push, to everyone in the campfire ──
  select coalesce(array_agg(gm.user_id), '{}') into v_members
    from group_members gm where gm.group_id = p_circle_id;

  select display_name into v_host from profiles where id = auth.uid();

  -- The RETURN VALUE, not array_length(v_members). Those are different numbers and the difference
  -- is not an edge case: notify_event drops the actor from its own recipients, so a three-person
  -- campfire writes two rows. Reporting the roster size would have the confirm screen tell the
  -- host they notified themselves.
  v_notified := notify_event(
    v_members,
    'challenge_hosted',
    'A challenge for ' || v_group.name,
    coalesce(v_host, 'Someone') || ' is hosting ' || v_name || ' for ' || v_group.name || '.',
    -- The actor is excluded from the recipients by notify_event itself, so the host does not get
    -- pushed about the thing they just did.
    auth.uid(), p_circle_id,
    '/challenge-info/[challengeId]', jsonb_build_object('challengeId', v_challenge.id::text),
    null, 'rounded',
    jsonb_build_object('challenge_id', v_challenge.id, 'shape', v_challenge.shape,
                       'circle_id', p_circle_id)
  );

  -- ── §3 · and the card, in the chat, where the join CTA lives ──
  --
  -- A real message row rather than a synthetic feed item, so it reuses the campfire message
  -- pipeline whole: realtime delivery, the unread counter, the timeline's own ordering.
  -- §Distribution asks for a first-class chat item and this is what makes it one.
  insert into messages (group_id, user_id, body, attach_kind, attach_ref_id)
  values (p_circle_id, auth.uid(),
          left(v_name || ' — who''s in?', 2000),
          'challenge', v_challenge.id)
  returning id into v_message_id;

  return jsonb_build_object(
    'challenge_id', v_challenge.id,
    'circle_id', p_circle_id,
    'circle_name', v_group.name,
    'name', v_name,
    'metric', v_unit,
    'target', v_challenge.target_count,
    'message_id', v_message_id,
    'notified', coalesce(v_notified, 0),
    'preview', v_preview
  );
end;
$$;

comment on function host_campfire_challenge(uuid, text, numeric, int, text, text, text, int) is
  '0162 — hosts a counted challenge in a campfire. OWNER/ADMIN ONLY, re-checked from group_members server-side: Cindy proposes the params and this decides. Creates the race, enrols and equips the host, stores the scoped tier through set_challenge_scope, fires challenge_hosted and posts the card into campfire chat.';

revoke all on function host_campfire_challenge(uuid, text, numeric, int, text, text, text, int) from public;
grant execute on function host_campfire_challenge(uuid, text, numeric, int, text, text, text, int) to authenticated;

-- ─────────────────────────── §3 · the join CTA on that card ───────────────────────────
--
-- Open to any member of the campfire, and deliberately so: the whole point of hosting in a
-- campfire rather than inviting friends is that people opt IN. Hosting is the admin act; joining
-- is not.
create or replace function join_campfire_challenge(p_challenge_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c social_challenges;
  v_goal uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;

  select * into v_c from social_challenges c where c.id = p_challenge_id;
  if v_c.id is null or v_c.circle_id is null then
    raise exception 'Challenge not found.';
  end if;
  if not is_group_member(v_c.circle_id) then
    raise exception 'That challenge belongs to a campfire you''re not in.';
  end if;
  if v_c.status not in ('draft', 'pending', 'active') then
    raise exception 'That challenge is over.';
  end if;

  insert into challenge_participants (challenge_id, user_id, state, responded_at)
  values (p_challenge_id, auth.uid(), 'accepted', now())
  on conflict (challenge_id, user_id)
    -- Already invited, now saying yes. 0147's notify_challenge_accepted watches exactly this
    -- transition, so the host still hears about it.
    do update set state = 'accepted', responded_at = now()
    where challenge_participants.state = 'invited';

  -- §Custom lock-in types: joining is what puts the metric on your lock-in menu.
  v_goal := campfire_challenge_attach_goal(p_challenge_id, auth.uid());

  return jsonb_build_object(
    'challenge_id', p_challenge_id,
    'goal_id', v_goal,
    'metric', v_c.count_unit,
    'target', v_c.target_count
  );
end;
$$;

comment on function join_campfire_challenge(uuid) is
  '0162 — opt into a campfire-hosted challenge from its chat card. Any member may join; only an admin may host. Attaches the count metric to the joiner''s lock-in menu, adopting a goal they already have.';

revoke all on function join_campfire_challenge(uuid) from public;
grant execute on function join_campfire_challenge(uuid) to authenticated;

-- ─────────────────────────── asserted at deploy ───────────────────────────
--
-- The claims worth failing the push over: the gate is on both doors, the anti-cheese cap survives
-- the new metric, a count race scores a count, and a minted mirror goal cannot pay twice. The
-- impersonated section runs inside a sub-block that always unwinds, per 0161 — a SET LOCAL role
-- left standing breaks this file's own later statements.
do $assert$
declare
  v_user uuid;
  v_ok boolean;
begin
  -- 1 · the discount is unchanged by the new metric name.
  if goal_paid_band('epic', 'honor') is distinct from 'notable' then
    raise exception '0162: the honor cap moved — epic/honor must still pay notable.';
  end if;
  if goal_paid_band('legendary', 'auto') is distinct from 'elite' then
    raise exception '0162: auto legendary must still pay elite.';
  end if;

  -- 2 · the count arm is wired: a count race reads its mirror goal, not a lock-in count.
  select exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'challenge_racer_score'
      and pg_get_functiondef(p.oid) like '%campfire_challenge_goals%'
  ) into v_ok;
  if not v_ok then
    raise exception '0162: challenge_racer_score has no count arm — a count race would still be scored in lock-ins.';
  end if;

  -- 3 · both campfire doors are gated.
  select exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_group_challenge'
      and pg_get_functiondef(p.oid) like '%is_campfire_admin%'
  ) into v_ok;
  if not v_ok then
    raise exception '0162: create_group_challenge is still member-open; the gate would be decorative.';
  end if;

  -- 4 · the mint-hole guard on the mirror goal.
  select exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'economy_on_challenge_completed'
      and pg_get_functiondef(p.oid) like '%challenge_source_id%'
  ) into v_ok;
  if not v_ok then
    raise exception '0162: a minted mirror goal would pay its own box AND the race''s.';
  end if;

  -- 5 · exactly one of each function we replaced or created. The overload trap MIGRATIONS.md names.
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in ('create_group_challenge', 'challenge_racer_score',
                           'set_challenge_scope', 'economy_on_challenge_completed',
                           'notification_category', 'host_campfire_challenge',
                           'join_campfire_challenge', 'campfire_challenge_attach_goal')) <> 8 then
    raise exception '0162: an overload was created — count pg_proc before pushing.';
  end if;

  -- 6 · 'count' derives HONOR, so no count race reaches a top box however it is scoped. Asserted
  --    against preview_challenge_reward, which is what the create screen actually reads.
  select id into v_user from profiles order by created_at limit 1;
  if v_user is null then
    raise notice '0162: no profiles; the preview round trip was not exercised.';
    return;
  end if;

  begin
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
                       json_build_object('sub', v_user, 'role', 'authenticated')::text, true);

    if (preview_challenge_reward('mythic', 'honor', 7, 12) ->> 'box') <> 'furnace' then
      raise exception '0162: an honor-scoped mythic must still land on The Furnace.';
    end if;
    -- ...and it must be well clear of the floor every custom goal used to collect.
    if (preview_challenge_reward('epic', 'honor', 7, 12) ->> 'box') = 'ignition' then
      raise exception '0162: a scoped epic is still paying the Ignition Crate floor.';
    end if;

    raise exception 'ok';
  exception
    when others then
      if sqlerrm <> 'ok' then raise; end if;
  end;

  raise notice '0162 ok — gate on both doors, count races score their count, honor cap intact.';
end
$assert$;
