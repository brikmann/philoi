-- 0116 — the reward reveal: keep what settlement PAID, and let the client read it back once.
--
-- 0112 joined the challenge loop up as far as the standings: a settled race now writes
-- final_value / final_rank / final_percentile per racer, and challenge-info renders them. What it
-- still does not do is say what you WON. grant_reward returns a jsonb describing the payout —
-- {embers, box, badge, band, significance} — and every one of its three callers throws that return
-- away with `perform`. The embers land, the box appears in the inventory, the badge is minted, and
-- the only surface that could announce any of it (ChallengeRewardScreen, built against mock 47)
-- has zero call sites because there is nothing to feed it.
--
-- So this file does three small things and grants nothing:
--   1. two columns on challenge_participants — the payout that landed, and a fire-once flag;
--   2. economy_on_social_challenge_closed captures grant_reward's return instead of discarding it;
--   3. two RPCs the client reads and stamps through.
--
-- 🔒 REWARD MATH STAYS SERVER-AUTHORITATIVE, AND THIS FILE IS A READER. get_challenge_reward
-- reports what grant_reward already paid; it cannot pay anything and it derives no figure of its
-- own. That is the point of capturing the payload at settlement rather than letting the screen
-- recompute a payout from the same inputs — a second derivation would eventually disagree with the
-- ledger, and the ledger is what actually moved.
--
-- 🔴 DEPENDS ON 0114. grant_reward has never once returned successfully (0114's header: two
-- missing enum casts, raising 42883 on every real call). Until 0114 deploys, the capture below
-- writes nothing, because the call raises before it can return — so reward_payload stays null for
-- anything settled in the meantime. The client renders that case (placement and XP, no reward
-- rows) rather than treating it as an error. Deploy order: 0112 → 0113 → 0114 → 0115 → 0116.
--
-- Forward-only. Not deployed by this pass — `db push` is Noah's to run.

-- ───────────────────── 1 · what was paid, and whether it has been shown ─────────────────────

-- The payout jsonb exactly as grant_reward returned it: {embers, box, badge, band, significance}.
-- Stored rather than reconstructed, because two of those five (box, badge) are decisions the
-- function made from a significance score that is not recoverable from the row afterwards.
alter table challenge_participants add column if not exists reward_payload jsonb;

-- The fire-once flag. Per user per challenge, because the reveal is a per-person moment: one
-- racer opening their result must not consume anybody else's.
alter table challenge_participants add column if not exists reward_seen_at timestamptz;

-- ───────────────────────── 2 · capture the payload at settlement ─────────────────────────
--
-- Body is 0112's, unchanged except that the three grant_reward calls are assigned instead of
-- performed and their return is written to the racer's row. A restatement rather than a targeted
-- patch because plpgsql has no way to replace one line.
--
-- WHERE THIS LIVES, and why it is not the UPDATE that writes final_rank.
-- finalize_social_challenges writes the standings; this TRIGGER is what calls grant_reward, fired
-- by finalize's `update social_challenges set status = 'completed'` one statement earlier. The
-- payload exists nowhere but inside this function, so this is the only place it can be captured.
-- Same transaction, different statement — the later final_* UPDATE touches different columns and
-- cannot clobber it.
--
-- The group arm becomes a loop. 0112 wrote it as
-- `perform grant_reward(u, ...) from unnest(v_field) u`, which has no way to capture a per-row
-- return. The loop grants exactly once per racer, as before.
create or replace function economy_on_social_challenge_closed()
returns trigger
language plpgsql
security definer
set search_path = public
as $econ$
declare
  v_days int;
  v_scope int;
  v_loser uuid;
  v_winner_name text;
  v_loser_name text;
  v_field uuid[];
  v_uid uuid;
  v_payload jsonb;
begin
  if new.status <> 'completed' or coalesce(old.status, '') = 'completed' then
    return new;
  end if;

  v_days := greatest(1, ceil(new.window_hours / 24.0)::int);

  if new.mode = 'h2h' then
    v_scope := 1;
    if new.winner_id is not null then
      v_payload := grant_reward(new.winner_id, 'friend_h2h', 1.0, v_days, v_scope, 0.0, true, new.id);
      update challenge_participants
         set reward_payload = v_payload
       where challenge_id = new.id and user_id = new.winner_id;

      -- The loser still finished the thing. Completion band only — placement 1.0 is last place.
      v_loser := case when new.winner_id = new.created_by then new.opponent_id else new.created_by end;
      v_payload := grant_reward(v_loser, 'friend_h2h', 1.0, v_days, v_scope, 1.0, true, new.id);
      update challenge_participants
         set reward_payload = v_payload
       where challenge_id = new.id and user_id = v_loser;

      select display_name into v_winner_name from profiles where id = new.winner_id;
      select display_name into v_loser_name from profiles where id = v_loser;

      -- Two events, not one broadcast: the copy differs, and more importantly the ACTOR differs.
      -- Each side's leading art is the OTHER person's face.
      perform notify_event(
        array[new.winner_id], 'challenge_won',
        'You won',
        case when v_loser_name is not null then 'You beat ' || v_loser_name || '.' else 'You took the challenge.' end,
        v_loser, new.id,
        '/challenge-info/[challengeId]', jsonb_build_object('challengeId', new.id::text),
        null, null,
        jsonb_build_object('mode', new.mode, 'outcome', 'won')
      );

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
    if new.circle_id is null then return new; end if;

    if exists (select 1 from challenge_participants p where p.challenge_id = new.id) then
      select coalesce(array_agg(f.user_id), '{}') into v_field
      from challenge_field(new.id, new.circle_id) f;
    else
      select coalesce(array_agg(distinct s.user_id), '{}') into v_field
      from lock_in_sessions s
      join group_members gm on gm.user_id = s.user_id and gm.group_id = new.circle_id
      where s.status = 'completed'
        and s.started_at >= new.starts_at
        and s.started_at <= coalesce(new.ends_at, now())
        and extract(epoch from (s.last_confirmed_at - s.started_at))
            >= (select value::int from economy_config where key = 'lock_in_min_seconds');
    end if;

    v_scope := coalesce(array_length(v_field, 1), 0);
    if v_scope = 0 then return new; end if;

    -- Real percentile placement needs the per-member standings 0111 now writes; wiring
    -- grant_reward to final_percentile is a reward-tuning change and stays out of a bugfix pass,
    -- so everyone still lands on the completion band rather than being handed a guessed rank.
    foreach v_uid in array v_field
    loop
      v_payload := grant_reward(v_uid, 'campfire_group', 1.0, v_days, greatest(v_scope, 1), 0.75, true, new.id);
      -- A no-op for a pre-0096 challenge with no roster: v_field was derived from lock-in sessions
      -- there, and the reward is still paid — there is simply no row to record it on, which is
      -- exactly the case get_challenge_reward's empty return already covers.
      update challenge_participants
         set reward_payload = v_payload
       where challenge_id = new.id and user_id = v_uid;
    end loop;

    -- One event to every participant. No actor: a campfire challenge settling is the campfire's
    -- doing, not any one member's, so it leads with the campfire rather than a face.
    perform notify_event(
      v_field,
      'campfire_settled',
      'Campfire challenge settled',
      'Your rewards are ready to collect.',
      null, new.circle_id,
      '/challenge-info/[challengeId]', jsonb_build_object('challengeId', new.id::text),
      null, 'rounded',
      jsonb_build_object('challenge_id', new.id, 'mode', new.mode)
    );
  end if;

  return new;
end;
$econ$;

-- Trigger definition unchanged from 0089/0112 — same NAME and same `of status` clause, restated so
-- re-running this file is idempotent. A second trigger under a different name would not replace
-- it, it would pay every settled challenge twice.
drop trigger if exists social_challenges_economy on social_challenges;
create trigger social_challenges_economy
  after update of status on social_challenges
  for each row execute function economy_on_social_challenge_closed();

-- ───────────────────────────────── 3 · the reveal read ─────────────────────────────────
--
-- ONE jsonb rather than a RETURNS TABLE, because the interesting half of it already IS jsonb and a
-- table would have to either flatten grant_reward's payload into columns — a second schema for the
-- same fact, kept in step by hand — or carry a jsonb column anyway.
--
-- 🔒 READS ONLY. Every figure here was written by something else: final_rank by
-- finalize_social_challenges, reward_payload by the trigger above, xp by the bonus_xp_awards
-- insert at settlement.
--
-- WHAT IT RETURNS BEYOND placement/xp/payload, and why each is load-bearing rather than nice:
--   · percentile + field_size — placementTier() on the client resolves "2nd of 5" and "top 10% of
--     42" from these. Without them the screen can only draw the three podium tiers, and every
--     mid-pack finish on a big board collapses onto the same copy pool.
--   · seen_at — the fire-once check itself. challenge_participants' RLS (0096) grants select
--     through group_members, so a duel with no watching campfire — circle_id null, the normal case
--     for friend-to-friend — is unreadable by its own participants. There is no other way for the
--     client to see this column.
--
-- Empty object for a non-participant and for a challenge that has not settled. NOT an exception,
-- unlike get_challenge_results: this is called speculatively on every open of a settled challenge
-- to ask "is a reveal owed here?", and "no" is a normal answer rather than a failure.
drop function if exists get_challenge_reward(uuid);

create function get_challenge_reward(p_challenge_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $rev$
declare
  v_status text;
  v_rank int;
  v_percentile numeric;
  v_seen timestamptz;
  v_payload jsonb;
  v_xp int;
  v_field int;
begin
  select sc.status into v_status from social_challenges sc where sc.id = p_challenge_id;
  if v_status is null or not challenge_is_settled(v_status) then
    return '{}'::jsonb;
  end if;

  -- auth.uid()-scoped and roster-gated: the caller's own result or nothing. Scalar locals rather
  -- than a record, so nothing declared here can shadow a column name — the failure that killed
  -- get_challenge_watch from 0081 until 0099.
  select p.final_rank, p.final_percentile, p.reward_seen_at, p.reward_payload
    into v_rank, v_percentile, v_seen, v_payload
  from challenge_participants p
  where p.challenge_id = p_challenge_id and p.user_id = auth.uid() and p.state = 'accepted';

  if not found then
    return '{}'::jsonb;
  end if;

  select coalesce(sum(b.amount), 0)::int into v_xp
  from bonus_xp_awards b
  where b.challenge_id = p_challenge_id and b.user_id = auth.uid();

  -- The FIELD — the same denominator settlement scored against (0111/0112), not the campfire.
  select count(*)::int into v_field
  from challenge_participants p
  where p.challenge_id = p_challenge_id and p.state = 'accepted';

  return jsonb_build_object(
    'placement', v_rank,
    -- Stored orientation, matching get_challenge_results: 1.0 is the TOP of the board. The client
    -- inverts it for placementTier(), which counts the other way.
    'percentile', v_percentile,
    'field_size', v_field,
    'xp', v_xp,
    'seen_at', v_seen,
    'payload', v_payload
  );
end;
$rev$;

grant execute on function get_challenge_reward(uuid) to authenticated;

-- ───────────────────────────────── 4 · stamp it shown ─────────────────────────────────
--
-- `reward_seen_at is null` in the predicate, not only in the client's check: dismiss can fire
-- twice (a double tap, a retry after a dropped request) and the first stamp is the true one.
-- Without it the second call would move the timestamp — harmless today, and wrong the moment
-- anything reads "when did they see this".
drop function if exists mark_challenge_reward_seen(uuid);

create function mark_challenge_reward_seen(p_challenge_id uuid)
returns void
language sql
security definer
set search_path = public
as $seen$
  update challenge_participants
     set reward_seen_at = now()
   where challenge_id = p_challenge_id
     and user_id = auth.uid()
     and reward_seen_at is null;
$seen$;

grant execute on function mark_challenge_reward_seen(uuid) to authenticated;
