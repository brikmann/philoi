-- 0147 · The campfire challenge loop: its creator is in it, and it tells people things.
--
-- Two reports from Noah's on-device pass, one root cause each (R5 and R6).
--
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- 1 · THE CREATOR OF A GROUP CHALLENGE WAS NOT IN IT (R5, 🔴)
--
-- Reported as: make a "Group · all or nothing" challenge in a campfire, press Accept on your own
-- challenge, get **"No open invite for you on that challenge."**
--
-- That error is respond_to_challenge_invite (0096) doing exactly what it says. It updates
-- `challenge_participants where challenge_id = $1 and user_id = auth.uid() and state = 'invited'`
-- and raises when nothing matched. Nothing matched because the creator had NO ROW AT ALL —
-- create_group_challenge inserted the social_challenges row and returned.
--
-- IT DID NOT ALWAYS. 0112 added exactly this, and said why:
--
--     insert into challenge_participants (challenge_id, user_id, state, responded_at)
--     values (v_challenge.id, auth.uid(), 'accepted', now())
--
--     "...the creator IS a participant — they proposed the race, there is nothing for them to
--      accept. This is also what makes start_challenge reachable at all: its 'Nobody has accepted
--      yet' guard exists to stop a race starting with an empty field, and a field of one admin is
--      not empty, it is a campfire that has not invited anyone yet."
--
-- 0124 (custom spans) then restated create_group_challenge to add p_starts_on/p_ends_on, and wrote
-- the new body from a PRE-0112 base. The insert was not removed by a decision; it was dropped by a
-- copy. 0145 (grades) restated it again from 0124's body and carried the hole forward. Verified on
-- prod before writing this: the live prosrc contains no reference to challenge_participants.
--
-- This is the failure mode MIGRATIONS.md and the parallel-agent note both describe — a
-- `create or replace` restated from an older base silently reverting a sibling branch's work. The
-- body below is the CURRENT PROD BODY, read out of pg_proc.prosrc, with the insert put back and
-- nothing else touched.
--
-- SIGNATURE IS UNCHANGED — all nine arguments, same types, same order, same defaults — so this is
-- a true replacement and creates no second overload. That is the trap 0146 had to clean up after
-- 0145; there is nothing to drop here precisely because nothing about the signature moves.
--
-- WHY 'accepted' AND NOT 'invited': the creator proposed the race. An 'invited' row would put an
-- Accept button in front of the person who wrote the challenge, and — worse — start_challenge
-- deletes every still-'invited' row at the gun, so a creator who forgot to answer their own invite
-- would be dropped from their own race.
--
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- 2 · CAMPFIRE CHALLENGES NEVER NOTIFIED ANYONE (R6, 🔴)
--
-- Reported as: no push and no bell row for any campfire-challenge event. Confirmed against prod by
-- asking which functions so much as mention notify_event/notify_push:
--
--     invite_challenge_members     false      ← "you're invited" never sent
--     respond_to_challenge_invite  false      ← "someone accepted" never sent
--     start_challenge              false      ← "the race started" never sent
--     start_due_challenges         false      ← same, for scheduled starts
--     finalize_social_challenges   false      ← "it settled, here's where you placed" never sent
--     create_placement_challenge   TRUE       ← the ONE that worked, which is why a placement
--                                               race announced itself and nothing else did
--
-- THESE ARE TRIGGERS, NOT EDITS TO THOSE FIVE FUNCTIONS, and that is deliberate. Adding a
-- `perform notify_event(...)` to each would mean restating five function bodies — one of them
-- (finalize_social_challenges) 10.5KB of settlement logic that has already been reverted once by a
-- restatement (0127's own comment records restoring 0122's tie rule after nearly clobbering it).
-- Every one of those restatements is a chance to silently revert a sibling branch. A trigger adds
-- behaviour without retyping a single line of what is already there.
--
-- It also catches paths a function edit would miss: `start_challenge` and `start_due_challenges`
-- are two different doors to the same "the race started" moment, and a trigger on the status
-- transition covers both plus any third door added later.
--
-- SCOPED TO mode = 'group' THROUGHOUT. Duels already have their own notifications
-- (create_h2h_challenge sends "You've been challenged"), and firing these as well would
-- double-notify every duel in the app. R6 is about campfire challenges.
--
-- FIRING ORDER: the settle trigger is named `..._notify` and the existing economy trigger is
-- `social_challenges_economy`. Postgres fires same-event triggers in alphabetical order and
-- 'e' < 'n', so grant_reward has already run and written the payout by the time the notification
-- goes out. Do not rename either one without re-checking that.

-- ─────────────────────────── 1 · the creator is a participant again ───────────────────────────

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
as $cg$
declare
  v_challenge social_challenges;
begin
  perform assert_challenge_span(p_starts_on, p_ends_on);

  if not is_group_member(p_circle_id) then
    raise exception 'Not a member of that campfire.';
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

  -- ← RESTORED FROM 0112. See the header. Everything above this line is the live prod body
  --   verbatim; this insert is the entire change.
  insert into challenge_participants (challenge_id, user_id, state, responded_at)
  values (v_challenge.id, auth.uid(), 'accepted', now())
  on conflict (challenge_id, user_id) do nothing;

  return v_challenge;
end;
$cg$;

-- ─────────────────────────── 2 · notifications, as triggers ───────────────────────────

/**
 * "You've been invited to a campfire challenge."
 *
 * Row-level so a bulk `insert ... select` out of invite_challenge_members sends one notification
 * per invitee rather than one for the batch. Only 'invited' rows: the creator's own 'accepted' row
 * above and create_placement_challenge's whole-campfire enrolment both insert 'accepted', and
 * neither is an invitation anybody needs telling about.
 */
create or replace function notify_challenge_invited()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c social_challenges;
begin
  if new.state <> 'invited' then return new; end if;

  select * into v_c from social_challenges where id = new.challenge_id;
  if v_c.id is null or v_c.mode <> 'group' then return new; end if;

  perform notify_event(
    array[new.user_id],
    'challenge_invite',
    'You''re invited to a challenge',
    coalesce(v_c.public_name, 'A challenge') || ' is waiting on your answer.',
    v_c.created_by, v_c.circle_id,
    '/challenge-info/[challengeId]', jsonb_build_object('challengeId', v_c.id::text),
    null, 'rounded',
    jsonb_build_object('challenge_id', v_c.id, 'shape', v_c.shape)
  );
  return new;
end;
$$;

drop trigger if exists challenge_participants_notify_invited on challenge_participants;
create trigger challenge_participants_notify_invited
  after insert on challenge_participants
  for each row execute function notify_challenge_invited();

/**
 * "Someone accepted your challenge." — to the creator, who is the person waiting on the answer.
 *
 * Guarded on the TRANSITION, not on the new value: without `old.state = 'invited'` any later write
 * that touched an already-accepted row (a baseline update at the gun, a final_rank at settlement)
 * would re-announce an acceptance from days ago.
 */
create or replace function notify_challenge_accepted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c social_challenges;
  v_who text;
begin
  if old.state <> 'invited' or new.state <> 'accepted' then return new; end if;

  select * into v_c from social_challenges where id = new.challenge_id;
  if v_c.id is null or v_c.mode <> 'group' then return new; end if;
  -- Nobody needs telling that they answered their own invite.
  if v_c.created_by = new.user_id then return new; end if;

  select display_name into v_who from profiles where id = new.user_id;

  perform notify_event(
    array[v_c.created_by],
    'challenge_accepted',
    'Someone''s in',
    coalesce(v_who, 'Someone') || ' accepted ' || coalesce(v_c.public_name, 'your challenge') || '.',
    new.user_id, v_c.circle_id,
    '/challenge-info/[challengeId]', jsonb_build_object('challengeId', v_c.id::text),
    null, 'rounded',
    jsonb_build_object('challenge_id', v_c.id)
  );
  return new;
end;
$$;

drop trigger if exists challenge_participants_notify_accepted on challenge_participants;
create trigger challenge_participants_notify_accepted
  after update of state on challenge_participants
  for each row execute function notify_challenge_accepted();

/** "1st", "2nd", "3rd", "11th" — the -teens are the whole reason this is not `n || 'th'`. */
create or replace function ordinal_suffix(n int)
returns text
language sql
immutable
set search_path = public
as $$
  select n::text || case
    when n % 100 between 11 and 13 then 'th'
    when n % 10 = 1 then 'st'
    when n % 10 = 2 then 'nd'
    when n % 10 = 3 then 'rd'
    else 'th'
  end;
$$;

/**
 * "The race started" and "the race settled", both off the status column.
 *
 * ONE function for two transitions because they are the same shape — read the field, say a thing —
 * and because a single trigger keeps the alphabetical ordering against social_challenges_economy
 * easy to reason about.
 *
 * The START arm deliberately excludes the person who fired the gun: an admin pressing "Start the
 * race" does not need a push telling them the race they just started has started.
 *
 * The SETTLE arm is PER PARTICIPANT, and it is the one place a loop is worth it. "Your race
 * settled" is a strictly worse notification than "You placed 7th of 48" — field size is the whole
 * point of a campfire race (§7: "winning a race with lots of people should FEEL bigger"), and the
 * numbers are already sitting in challenge_participants where settlement wrote them. A 48-row loop
 * once per settled challenge, inside a cron sweep, is not a cost worth optimising away.
 *
 * It does NOT try to describe the payout. The embers/box reveal belongs to the in-app reveal floor
 * (get_my_unseen_challenge_rewards → ChallengeRewardScreen), which is the surface with the rays on
 * it; this notification's job is to get the person to open the app so that can fire. Saying the
 * reward twice, once flatly in a push, is how you spend the surprise before the screen gets it.
 *
 * 'completed' only, not challenge_is_settled(). That band also contains 'expired', which is a race
 * that ran out with nothing to report — and 0111 leaves final_rank null on those, so there is no
 * placement to announce.
 *
 * ⚠ final_rank IS ONLY POPULATED FOR PLACEMENT RACES AT THE MOMENT THIS FIRES, and that is a
 * property of finalize_social_challenges, not an oversight here. Its two arms order their
 * statements differently, and 0127's own comment is explicit about why:
 *
 *   · PLACEMENT writes the standings and THEN flips status, precisely so the reward trigger firing
 *     on that flip can read a real percentile. So this trigger sees real ranks — which is what
 *     makes "You placed 7th of 48" possible, and placement is the shape that needs it.
 *   · COLLECTIVE flips status FIRST and writes final_rank afterwards. So this trigger sees nulls
 *     there and falls to the generic "has settled. Open it to collect." branch below.
 *
 * That is the right outcome rather than a degraded one: an all-or-nothing goal has no placement to
 * report — the whole house cleared the same bar or it did not — so a rank would be noise. The
 * `case` handles null explicitly for exactly this reason. Do NOT "fix" it by reordering the
 * collective arm; that arm's ordering is load-bearing for 0118's flat-band reward and reordering it
 * would change what every collective challenge pays.
 */
create or replace function notify_challenge_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_field int;
begin
  if new.mode <> 'group' or old.status = new.status then return new; end if;

  -- ── the gun ──
  if new.status = 'active' then
    perform notify_event(
      (select coalesce(array_agg(p.user_id), '{}')
         from challenge_participants p
        where p.challenge_id = new.id
          and p.state = 'accepted'
          and p.user_id is distinct from auth.uid()),
      'campfire_challenge_started',
      'The race is on',
      coalesce(new.public_name, 'Your campfire challenge') || ' just started.',
      null, new.circle_id,
      '/challenge-info/[challengeId]', jsonb_build_object('challengeId', new.id::text),
      null, 'rounded',
      jsonb_build_object('challenge_id', new.id, 'shape', new.shape)
    );
    return new;
  end if;

  -- ── the finish ──
  if new.status = 'completed' then
    select count(*)::int into v_field
      from challenge_participants p
     where p.challenge_id = new.id and p.state = 'accepted';

    for r in
      select p.user_id, p.final_rank
        from challenge_participants p
       where p.challenge_id = new.id and p.state = 'accepted'
    loop
      perform notify_event(
        array[r.user_id],
        case when r.final_rank = 1 then 'challenge_won' else 'challenge_completed' end,
        case when r.final_rank = 1 then 'You won' else 'Your race is settled' end,
        case
          when r.final_rank = 1 and v_field > 1
            then 'You took 1st of ' || v_field || ' in ' || coalesce(new.public_name, 'your campfire race') || '.'
          when r.final_rank is not null and v_field > 1
            then 'You placed ' || ordinal_suffix(r.final_rank) || ' of ' || v_field || '. Open it to collect.'
          else coalesce(new.public_name, 'Your campfire challenge') || ' has settled. Open it to collect.'
        end,
        null, new.circle_id,
        '/challenge-info/[challengeId]', jsonb_build_object('challengeId', new.id::text),
        null, 'rounded',
        jsonb_build_object('challenge_id', new.id, 'placement', r.final_rank, 'field_size', v_field)
      );
    end loop;
  end if;

  return new;
end;
$$;

-- `..._notify` sorts after `social_challenges_economy`, so grant_reward has already paid by the
-- time the settle arm reads final_rank. See the header.
drop trigger if exists social_challenges_notify on social_challenges;
create trigger social_challenges_notify
  after update of status on social_challenges
  for each row execute function notify_challenge_status_change();

-- ─────────────────────────── 3 · the checks MIGRATIONS.md asks for ───────────────────────────
--
-- Not assertions that would abort the push — a failed DO block here would roll the whole migration
-- back for a reporting problem. These raise a NOTICE, which is what you read in the push output.
do $$
declare
  v_dupes text;
  v_enrols boolean;
begin
  select string_agg(proname || ' x' || cnt, ', ')
    into v_dupes
  from (
    select p.proname, count(*) as cnt
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('create_group_challenge', 'create_h2h_challenge', 'create_placement_challenge')
     group by p.proname having count(*) > 1
  ) d;

  if v_dupes is not null then
    raise notice '0147 WARNING — challenge-create overloads present: %. 0146 dropped these; something has re-added one.', v_dupes;
  else
    raise notice '0147 ok — one signature each for the three challenge-create RPCs.';
  end if;

  select position('challenge_participants' in prosrc) > 0 into v_enrols
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_group_challenge';

  if coalesce(v_enrols, false) then
    raise notice '0147 ok — create_group_challenge enrols its creator.';
  else
    raise notice '0147 WARNING — create_group_challenge still does not touch challenge_participants.';
  end if;
end;
$$;
