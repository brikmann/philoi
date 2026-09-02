-- 0150 — you may hold more than one duel with the same person at the same time.
--
-- Noah: "'You already have an active or pending challenge with this person.' No such thing: people
-- can hold multiple challenges with the same person at the same time."
--
-- The guard is real and it has been in every generation of this function since 0053 — carried
-- forward verbatim through 0098, 0112, 0124 and 0145, each of which was rewriting the RPC for some
-- other reason and reasonably left the existing rules alone. It refused a second duel whenever ANY
-- pending or active h2h existed between the two users, in either direction.
--
-- WHY IT IS WRONG, not merely inconvenient. A duel is scoped to a metric and a window. Challenging
-- the same friend to "most lock-in time this week" and "most distance this weekend" is two
-- different races between the same two people, and nothing downstream has ever needed them to be
-- unique: settlement scores each challenge by its own id, the reveal is per-challenge and stamped
-- per-challenge (`reward_seen_at`, 0118), and the tab lists them as separate rows. The uniqueness
-- was protecting nothing — it was a stand-in for "you probably meant to accept the one you already
-- have", enforced as a hard error, and it also meant a stale pending invite the opponent never
-- answered locked the pair out of challenging each other at all until it expired.
--
-- WHAT THIS IS NOT. It is not 0148's rule wearing a different hat, and the difference is worth
-- stating because the two land in the same wave. 0148 blocks two goals that read ONE SOURCE and
-- each pay — a stack of rewards for one effort. Two duels are two separate races that each have to
-- be won on their own, against an opponent who has to show up for both. The work is not shared, so
-- neither is the payout.
--
-- ─────────────────────────── how this is written ───────────────────────────
--
-- The body below is prod's OWN current source with those nine lines removed and nothing else
-- touched. It was read out of pg_proc, diffed against 0145 (identical), and edited — rather than
-- retyped from the migration file — because a `create or replace` restated from a stale base
-- silently reverts whatever a sibling branch changed in between.
--
-- The signature is byte-identical to the one live today, so this REPLACES rather than adding an
-- eleventh-parameter twin. MIGRATIONS.md's overload trap does not apply: no argument is added,
-- removed or retyped, and there is exactly one create_h2h_challenge in pg_proc before and after.
--
-- Grants are untouched for the same reason — they live per signature, and the signature is the
-- same one that already carries them.

create or replace function create_h2h_challenge(
  p_opponent_id uuid,
  p_race_metric text,
  p_window_hours int,
  p_circle_id uuid default null,
  p_payout_xp int default 200,
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
as $ch$
declare
  v_challenge social_challenges;
begin
  perform assert_challenge_span(p_starts_on, p_ends_on);

  if p_opponent_id = auth.uid() then
    raise exception 'Pick someone else to challenge.';
  end if;

  if not exists (
    select 1 from friend_requests
    where status = 'accepted'
      and ((requester_id = auth.uid() and recipient_id = p_opponent_id)
        or (requester_id = p_opponent_id and recipient_id = auth.uid()))
  ) then
    raise exception 'You can only challenge a friend.';
  end if;

  if p_circle_id is not null and not is_group_member(p_circle_id) then
    raise exception 'Not a member of that campfire.';
  end if;

  insert into social_challenges (circle_id, created_by, mode, opponent_id, race_metric, window_hours, payout_xp, status, public_name, shape, starts_on, ends_on, grade_target, course_code)
  values (p_circle_id, auth.uid(), 'h2h', p_opponent_id, p_race_metric, p_window_hours, p_payout_xp, 'pending', nullif(btrim(coalesce(p_public_name, '')), ''), 'duel', p_starts_on, p_ends_on,
          p_grade_target, nullif(btrim(coalesce(p_course_code, '')), ''))
  returning * into v_challenge;

  -- A GRADE DUEL NEEDS A ROSTER; THE OTHER FOUR METRICS DO NOT.
  --
  -- This asymmetry is deliberate and it is worth saying why rather than quietly widening it. The
  -- accumulating metrics are OBSERVED — settlement can score a duel with no challenge_participants
  -- rows at all through social_challenge_score, which is the legacy arm most live duels still take
  -- (only two challenges on prod have a roster today). A grade is REPORTED, and
  -- challenge_participants is the only place a reported mark can live: with no row there is
  -- nowhere for report_challenge_grade to write and nothing for challenge_racer_score to read, so
  -- the race would settle 0 - 0 for two people who both passed.
  --
  -- Creating rows for every duel would switch them all from the legacy arm to the roster arm. That
  -- is very likely where this should end up — 0111 and 0112 have been moving that way — but it is
  -- a behaviour change to every duel in the app and does not belong in the migration that adds
  -- grades. Left as one decision for one day.
  if p_race_metric = 'grade' then
    insert into challenge_participants (challenge_id, user_id, state, responded_at)
    values (v_challenge.id, auth.uid(), 'accepted', now()),
           (v_challenge.id, p_opponent_id, 'invited', null)
    on conflict (challenge_id, user_id) do nothing;
  end if;

  perform notify_push(
    array[p_opponent_id],
    'You''ve been challenged',
    (select display_name from profiles where id = auth.uid()) || ' challenged you to a head-to-head.',
    jsonb_build_object('type', 'challenge_invite', 'challenge_id', v_challenge.id),
    'accountability'
  );

  return v_challenge;
end;
$ch$;
