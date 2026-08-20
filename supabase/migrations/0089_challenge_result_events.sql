-- §D/§F — emit a result event when a challenge closes, so the reward arc has something to fire on.
--
-- This is the loose end from D: mock 47's screen is built, but a challenge closes inside
-- economy_on_social_challenge_closed (a trigger on social_challenges). The client never learns it
-- happened — there is no subscription, no poll, and the payout lands silently in the wallet. The
-- screen had nothing to hang off.
--
-- Now the same trigger that pays out also emits challenge_won / challenge_lost, carrying the
-- payout in the payload and deep-linking to the challenge. The bell row IS the "collect" entry
-- point; tapping it opens the result.
--
-- Rewritten in full rather than patched because 0065's version is the live one and a trigger
-- function has to be replaced whole. The economy logic below is unchanged from 0065 — only the
-- notify_event calls are new.

create or replace function economy_on_social_challenge_closed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days int;
  v_scope int;
  v_loser uuid;
  v_winner_name text;
  v_loser_name text;
begin
  if new.status <> 'completed' or coalesce(old.status, '') = 'completed' then
    return new;
  end if;

  v_days := greatest(1, ceil(new.window_hours / 24.0)::int);

  if new.mode = 'h2h' then
    v_scope := 1;
    if new.winner_id is not null then
      perform grant_reward(new.winner_id, 'friend_h2h', 1.0, v_days, v_scope, 0.0, true, new.id);
      -- The loser still finished the thing. Completion band only — placement 1.0 is last place.
      v_loser := case when new.winner_id = new.created_by then new.opponent_id else new.created_by end;
      perform grant_reward(v_loser, 'friend_h2h', 1.0, v_days, v_scope, 1.0, true, new.id);

      select display_name into v_winner_name from profiles where id = new.winner_id;
      select display_name into v_loser_name from profiles where id = v_loser;

      -- Two events, not one broadcast: the copy differs, and more importantly the ACTOR differs.
      -- Each side's leading art is the OTHER person's face, which is what makes a duel result
      -- read as being about a specific opponent rather than about the app.
      perform notify_event(
        array[new.winner_id], 'challenge_won',
        'You won',
        case when v_loser_name is not null then 'You beat ' || v_loser_name || '.' else 'You took the challenge.' end,
        v_loser, new.id,
        '/challenge-info/[challengeId]', jsonb_build_object('challengeId', new.id::text),
        null, null,
        jsonb_build_object('mode', new.mode, 'outcome', 'won')
      );

      -- The loser is notified too, deliberately. The spec's copy for a 1v1 loss is rematch-toned
      -- rather than defeatist, and staying silent would be worse: they know the clock ran out, and
      -- an app that only speaks up when you win is one that keeps score against you.
      perform notify_event(
        array[v_loser], 'challenge_lost',
        'Challenge over',
        case when v_winner_name is not null then v_winner_name || ' edged it. Rematch?' else 'Rematch?' end,
        new.winner_id, new.id,
        '/challenge-info/[challengeId]', jsonb_build_object('challengeId', new.id::text),
        null, null,
        jsonb_build_object('mode', new.mode, 'outcome', 'lost')
      );
    end if;
  else
    -- Group mode has no participants table. Membership alone isn't participation either — being
    -- in the campfire while the challenge ran shouldn't pay. So a participant is someone who
    -- actually completed a qualifying lock-in inside the window.
    if new.circle_id is null then return new; end if;

    with participants as (
      select distinct s.user_id
      from lock_in_sessions s
      join group_members gm on gm.user_id = s.user_id and gm.group_id = new.circle_id
      where s.status = 'completed'
        and s.started_at >= new.starts_at
        and s.started_at <= coalesce(new.ends_at, now())
        and extract(epoch from (s.last_confirmed_at - s.started_at))
            >= (select value::int from economy_config where key = 'lock_in_min_seconds')
    )
    select count(*) into v_scope from participants;

    -- Real percentile placement needs the per-member standings the watch RPCs compute; until
    -- that's factored out of the read path, everyone lands on the completion band rather than
    -- being handed a guessed rank.
    perform grant_reward(pt.user_id, 'campfire_group', 1.0, v_days, greatest(v_scope, 1), 0.75, true, new.id)
    from (
      select distinct s.user_id
      from lock_in_sessions s
      join group_members gm on gm.user_id = s.user_id and gm.group_id = new.circle_id
      where s.status = 'completed'
        and s.started_at >= new.starts_at
        and s.started_at <= coalesce(new.ends_at, now())
        and extract(epoch from (s.last_confirmed_at - s.started_at))
            >= (select value::int from economy_config where key = 'lock_in_min_seconds')
    ) pt;

    -- One event to every participant. No actor: a campfire challenge settling is the campfire's
    -- doing, not any one member's, so it leads with the campfire rather than a face.
    perform notify_event(
      (select array_agg(distinct s.user_id)
       from lock_in_sessions s
       join group_members gm on gm.user_id = s.user_id and gm.group_id = new.circle_id
       where s.status = 'completed'
         and s.started_at >= new.starts_at
         and s.started_at <= coalesce(new.ends_at, now())
         and extract(epoch from (s.last_confirmed_at - s.started_at))
             >= (select value::int from economy_config where key = 'lock_in_min_seconds')),
      'campfire_settled',
      'Campfire challenge settled',
      'Your rewards are ready to collect.',
      null, new.circle_id,
      '/group/[groupId]', jsonb_build_object('groupId', new.circle_id::text),
      null, 'rounded',
      jsonb_build_object('challenge_id', new.id, 'mode', new.mode)
    );
  end if;

  return new;
end;
$$;

-- Trigger definition unchanged; restated so re-running this file is idempotent.
drop trigger if exists social_challenges_economy on social_challenges;
create trigger social_challenges_economy
  after update of status on social_challenges
  for each row execute function economy_on_social_challenge_closed();

-- ───────────────────────────── goal streak milestone ─────────────────────────────

-- The spec routes a streak milestone to mock 103's screen. That screen already fires inline when
-- the user completes the goal in-app, so this event exists for the BELL — a record they can come
-- back to — and for the push when the milestone lands via a background sync rather than a tap.
--
-- A TRIGGER ON goal_day_awards, deliberately, rather than a call added inside
-- economy_award_goal_day. That function is 150 lines of payout logic and CREATE OR REPLACE
-- rewrites it whole — so wiring a notification into it would mean re-pasting the code that moves
-- real embers, where a single mis-transcribed line is a mispayment. This is additive: the paying
-- function is not touched at all, and it still cannot fire on a milestone that did not pay,
-- because the row is only stamped with its embers AFTER economy_move_embers has run.
create or replace function economy_on_goal_day_awarded()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_milestones jsonb := (select value -> 'milestones' from economy_config where key = 'goal_rewards');
  v_bonus int;
begin
  -- Only a listed streak length, and only once it has actually been paid. economy_award_goal_day
  -- inserts the row with embers 0 and updates it after paying, so gating on a positive amount is
  -- what makes this fire exactly once per milestone.
  if new.embers <= 0 or coalesce(old.embers, 0) > 0 then
    return new;
  end if;

  v_bonus := coalesce((v_milestones ->> new.streak_len::text)::int, 0);
  if v_bonus <= 0 then
    return new;
  end if;

  perform notify_event(
    array[new.user_id], 'goal_streak_milestone',
    new.streak_len || '-day streak',
    '+' || new.embers || ' embers banked.',
    null, new.goal_id,
    -- No deep route: mock 103 already fired inline when they completed the goal. This row is the
    -- RECORD of it, and the tab is where the goal itself lives.
    null, '{}'::jsonb,
    null, 'flame',
    jsonb_build_object('streak', new.streak_len, 'embers', new.embers)
  );
  return new;
end;
$$;

drop trigger if exists goal_day_awards_notify on goal_day_awards;
create trigger goal_day_awards_notify
  after update of embers on goal_day_awards
  for each row execute function economy_on_goal_day_awarded();
