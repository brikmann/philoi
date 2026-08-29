-- 0137 — "which settled challenges still owe me a reveal?"
--
-- 🐛 THE GAP. Challenge settlement is asynchronous and server-side: pg_cron runs
-- finalize_social_challenges, the status flips to 'completed', the economy trigger (0118) calls
-- grant_reward and captures what it paid. All of that happens while the app is closed. 0118 then
-- built the reveal — but hung it off a single call site, `useChallengeReward` inside
-- challenge-info/[challengeId].tsx. So the ONLY way to see what you won is to navigate to that
-- specific challenge's info screen and notice it yourself. Confirmed with Noah: the embers and the
-- box do arrive, and nothing ever celebrates.
--
-- Rank-ups already solved exactly this shape (RankUpWatcher, mounted in _layout.tsx, checks on
-- foreground and presents whatever landed while you were away). This is the read that lets a
-- challenge watcher do the same — one round trip that answers "anything to celebrate?" instead of
-- N calls to get_challenge_reward, one per settled challenge the client happens to know about.
--
-- 🔒 STRICTLY ADDITIVE, AND STRICTLY A READ. No existing function is touched or restated (wave
-- rule), nothing is granted, and every figure below was written by something else: final_rank by
-- finalize_social_challenges, reward_payload by economy_on_social_challenge_closed, xp by the
-- bonus_xp_awards insert at settlement. This function cannot pay anybody.
--
-- WHY NOT JUST FILTER get_my_social_challenges CLIENT-SIDE: that RPC does not return
-- reward_seen_at, reward_payload, final_rank or the XP — and it cannot cheaply, since
-- challenge_participants' RLS (0096) grants select through group_members, so a friend-to-friend
-- duel with no watching campfire is unreadable by its own participants. security definer is the
-- only way the client sees its own row at all, which is the same reason get_challenge_reward exists.

-- ────────────────────── the fire-once inbox ──────────────────────
--
-- Returns one row per settled challenge this user RACED IN and has not been shown yet. Empty set
-- when there is nothing owed, which is the overwhelmingly common answer and not an error.
--
-- `state = 'accepted'` is the participation test, matching get_challenge_reward and settlement
-- itself: since 0096 the roster is what gets scored, and an invitee who never answered is not owed
-- a result. `reward_seen_at is null` is the fire-once flag — the SAME column
-- mark_challenge_reward_seen stamps, so the watcher and the challenge-info screen consume one
-- shared budget. Seeing a reveal in one place means it will not re-fire in the other, and neither
-- can double-show after a reinstall or on a second device, which a locally-persisted "celebrated"
-- set could not promise.
--
-- `placement is not null` for the same reason useChallengeReward gates on it: a challenge that
-- settled before 0111 wrote standings has nothing to reveal, and an empty reward screen is worse
-- than none.
--
-- The challenge columns alongside the payout are the exact inputs challengeRewardResult() takes
-- (shape/mode/race_metric/window_hours/opponent_id and the two display names) — carried here so the
-- watcher can render a result without a second fetch per challenge, which was the whole point.
drop function if exists get_my_unseen_challenge_rewards();

create function get_my_unseen_challenge_rewards()
returns table (
  challenge_id uuid,
  public_name text,
  shape text,
  mode text,
  race_metric text,
  window_hours int,
  opponent_id uuid,
  opponent_name text,
  created_by_name text,
  settled_at timestamptz,
  placement int,
  percentile numeric,
  field_size int,
  xp int,
  payload jsonb
)
language plpgsql
security definer
set search_path = public
stable
as $unseen$
begin
  if auth.uid() is null then return; end if;

  return query
  select
    sc.id,
    sc.public_name,
    sc.shape,
    sc.mode,
    sc.race_metric,
    sc.window_hours,
    sc.opponent_id,
    opp.display_name,
    creator.display_name,
    -- When the race closed, so the client can present two settlements in the order they happened
    -- rather than in whatever order the planner returned them. ends_at is null on a challenge
    -- cancelled early, hence the fallback.
    coalesce(sc.ends_at, sc.created_at),
    cp.final_rank,
    -- Stored orientation, matching get_challenge_reward and get_challenge_results: 1.0 is the TOP
    -- of the board. The client inverts it for placementTier(), which counts the other way. Emitted
    -- unturned here so both reads agree and only one place does the flip.
    cp.final_percentile,
    (select count(*)::int
       from challenge_participants f
      where f.challenge_id = sc.id and f.state = 'accepted'),
    (select coalesce(sum(b.amount), 0)::int
       from bonus_xp_awards b
      where b.challenge_id = sc.id and b.user_id = auth.uid()),
    cp.reward_payload
  from challenge_participants cp
  join social_challenges sc on sc.id = cp.challenge_id
  left join profiles opp on opp.id = sc.opponent_id
  left join profiles creator on creator.id = sc.created_by
  where cp.user_id = auth.uid()
    and cp.state = 'accepted'
    and cp.reward_seen_at is null
    and cp.final_rank is not null
    and challenge_is_settled(sc.status)
  order by coalesce(sc.ends_at, sc.created_at) asc;
end;
$unseen$;

grant execute on function get_my_unseen_challenge_rewards() to authenticated;

comment on function get_my_unseen_challenge_rewards() is
  'Settled challenges this user raced in and has not been shown (0137). Read-only; the fire-once flag is challenge_participants.reward_seen_at, stamped by mark_challenge_reward_seen — shared with the challenge-info reveal so neither can double-show.';

-- The watcher runs this on every app foreground, so the predicate has to be cheap. Partial on
-- `reward_seen_at is null`, because that is what the query is: the unseen set shrinks to nothing
-- for an established user, and a partial index over it stays tiny however many challenges they
-- have raced.
create index if not exists challenge_participants_unseen_reward_idx
  on challenge_participants (user_id)
  where reward_seen_at is null and final_rank is not null;
