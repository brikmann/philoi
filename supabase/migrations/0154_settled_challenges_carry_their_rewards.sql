-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- 0154 · A SETTLED CHALLENGE CARRIES WHAT IT PAID, not just what it decided.
--
-- Noah: "After you win, the reward reveal is the ONLY place the rewards appear." Once the reveal
-- is dismissed there is no durable record anywhere — the History row says "You won +200 XP" and
-- the standings screen prints an XP column, and neither has ever been able to say that the win
-- also paid embers and a box, because neither read is selecting the payload that names them.
--
-- The figures already exist and have since 0118: `challenge_participants.reward_payload` is the
-- jsonb grant_reward returned at settlement — embers, box, box_id, badge, band. Exactly one read
-- has ever selected it (get_challenge_reward, which serves the one-shot reveal), so the receipt
-- was written, shown once, and then unreachable.
--
-- 🔒 NOTHING HERE PAYS, RE-RATES OR RECOMPUTES ANYTHING. Two reads widen. The client renders what
-- the ledger already moved rather than deriving a second opinion about it — the same rule
-- get_challenge_results was written under (0111): "figures come from the server as they were
-- decided."
--
-- DEPENDS ON 0153. Until every duel has a roster there is no reward_payload row for a duel to
-- select, and these two columns would come back null on exactly the challenges Noah is looking at.
-- ══════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────── 1 · the tab's own list ───────────────────────────
--
-- ⚠️ RETURNS TABLE CHANGES, so this is drop-then-create, not `create or replace` — Postgres
-- refuses to replace a function whose OUT columns moved, and a create-with-more-columns under a
-- different shape would be a second overload of a zero-argument function (which is not even
-- expressible). Same pattern 0145 used on this function for the same reason. The grant is
-- re-issued because dropping the function takes its ACL with it.
--
-- The body below is 0145's, verbatim, plus two selects at the end. Diff prosrc before and after.

drop function if exists get_my_social_challenges();

create function get_my_social_challenges()
returns table (
  id uuid,
  circle_id uuid,
  circle_name text,
  circle_emoji text,
  created_by uuid,
  created_by_name text,
  mode text,
  opponent_id uuid,
  opponent_name text,
  race_metric text,
  my_score numeric,
  opponent_score numeric,
  target_count int,
  member_count int,
  completed_count int,
  window_hours int,
  starts_at timestamptz,
  ends_at timestamptz,
  status text,
  winner_id uuid,
  payout_xp int,
  created_at timestamptz,
  public_name text,
  shape text,
  invited_count int,
  accepted_count int,
  my_state text,
  grade_target numeric,
  course_code text,
  my_reported_value numeric,
  my_final_rank int,
  my_final_percentile numeric,
  -- NEW (0154). What this viewer was actually paid for this challenge.
  --
  -- my_awarded_xp is the LEDGER's figure, not `payout_xp`. Those are different numbers and the
  -- difference matters: payout_xp is the pot advertised at creation, while a placement or
  -- collective finish is paid `round(payout_xp * placement_multiplier(...))`, so a card that
  -- printed the pot would tell a 4th-place finisher they earned the winner's XP. Summed from
  -- bonus_xp_awards, the same source get_challenge_results reads.
  my_awarded_xp int,
  -- grant_reward's own return value, stored at settlement (0118/0125): { embers, box, box_id,
  -- badge, band }. Passed through as jsonb rather than unpacked into three more columns because
  -- the client already has a renderer for this exact shape (the reveal's reward rows), and
  -- flattening it here would mean two shapes of the same receipt in the codebase.
  my_reward_payload jsonb
)
language plpgsql
security definer
set search_path = public
stable
as $mine$
begin
  return query
  select
    sc.id,
    sc.circle_id,
    g.name as circle_name,
    g.emoji as circle_emoji,
    sc.created_by,
    creator.display_name as created_by_name,
    sc.mode,
    sc.opponent_id,
    opp.display_name as opponent_name,
    sc.race_metric,
    -- VIEWER-RELATIVE, and that is the whole contract of the pair: "my" is whoever is asking, so
    -- the opponent of a duel sees the same race from their own side without the client swapping
    -- anything. A grade race reads from the roster instead of the clock — there is nothing
    -- accumulating to window.
    case
      when sc.mode <> 'h2h' or challenge_is_awaiting(sc.status) then null
      when sc.race_metric = 'grade' then (
        select p.reported_value from challenge_participants p
        where p.challenge_id = sc.id
          and p.user_id = case when auth.uid() = sc.opponent_id then sc.opponent_id else sc.created_by end)
      else social_challenge_score(
        case when auth.uid() = sc.opponent_id then sc.opponent_id else sc.created_by end,
        sc.race_metric, sc.starts_at, sc.ends_at)
    end as my_score,
    case
      when sc.mode <> 'h2h' or challenge_is_awaiting(sc.status) then null
      when sc.race_metric = 'grade' then (
        select p.reported_value from challenge_participants p
        where p.challenge_id = sc.id
          and p.user_id = case when auth.uid() = sc.opponent_id then sc.created_by else sc.opponent_id end)
      else social_challenge_score(
        case when auth.uid() = sc.opponent_id then sc.created_by else sc.opponent_id end,
        sc.race_metric, sc.starts_at, sc.ends_at)
    end as opponent_score,
    sc.target_count,
    -- THE FIELD, not the campfire (0112). Was `count(*) from group_members` — the same denominator
    -- 0111 removed from settlement, and the reason a subset race read "2 / 30 done" on its card.
    case when sc.mode = 'group'
      then (select count(*)::int from challenge_field(sc.id, sc.circle_id)) else null end as member_count,
    -- Routed through challenge_racer_completed so the card's "N / M done" and the sweep's
    -- all-or-nothing gate ask the same question. They were two spellings of one rule, which is how
    -- a card can say everyone finished while the sweep expires the challenge.
    case when sc.mode = 'group' then (
      select count(*)::int from challenge_field(sc.id, sc.circle_id) f
      where challenge_racer_completed(sc.id, f.user_id)
    ) else null end as completed_count,
    sc.window_hours,
    sc.starts_at,
    sc.ends_at,
    sc.status,
    sc.winner_id,
    sc.payout_xp,
    sc.created_at,
    sc.public_name,
    sc.shape,
    (select count(*)::int from challenge_participants cp where cp.challenge_id = sc.id and cp.state = 'invited') as invited_count,
    (select count(*)::int from challenge_participants cp where cp.challenge_id = sc.id and cp.state = 'accepted') as accepted_count,
    (select cp.state from challenge_participants cp where cp.challenge_id = sc.id and cp.user_id = auth.uid()) as my_state,
    sc.grade_target,
    sc.course_code,
    (select cp.reported_value from challenge_participants cp where cp.challenge_id = sc.id and cp.user_id = auth.uid()) as my_reported_value,
    (select cp.final_rank from challenge_participants cp where cp.challenge_id = sc.id and cp.user_id = auth.uid()) as my_final_rank,
    (select cp.final_percentile from challenge_participants cp where cp.challenge_id = sc.id and cp.user_id = auth.uid()) as my_final_percentile,
    -- Unfiltered by status on purpose: bonus_xp_awards only ever holds settled awards, so gating
    -- this on challenge_is_settled would add a condition that can never change the answer while
    -- giving a future reader the impression that it can.
    (select coalesce(sum(b.amount), 0)::int from bonus_xp_awards b
      where b.challenge_id = sc.id and b.user_id = auth.uid()) as my_awarded_xp,
    (select cp.reward_payload from challenge_participants cp
      where cp.challenge_id = sc.id and cp.user_id = auth.uid()) as my_reward_payload
  from social_challenges sc
  -- left join: an h2h challenge with nobody watching has a null circle_id — an inner join here
  -- would silently drop it out of the result set entirely (migration 0032).
  left join groups g on g.id = sc.circle_id
  join profiles creator on creator.id = sc.created_by
  left join profiles opp on opp.id = sc.opponent_id
  where (
    (sc.mode = 'group' and is_group_member(sc.circle_id))
    or sc.created_by = auth.uid()
    or sc.opponent_id = auth.uid()
  )
    and sc.status != 'declined'
    -- A DRAFT IS PRIVATE UNTIL SOMEONE IS INVITED (0097).
    and (not challenge_is_draft(sc.status) or sc.created_by = auth.uid())
  order by
    (challenge_is_awaiting(sc.status) and sc.opponent_id = auth.uid()) desc,
    sc.created_at desc;
end;
$mine$;

grant execute on function get_my_social_challenges() to authenticated;

-- ─────────────────────────── 2 · the standings screen ───────────────────────────
--
-- Same widening, one row per racer. The result screen already prints each racer's XP; it can now
-- print what else landed beside it, which is what makes the standings a RECORD of the settlement
-- rather than a partial one.
--
-- The OUT names stay deliberately non-colliding with the columns the body selects (0111's own
-- note): `reward` rather than `reward_payload`, for the same reason `score_value` is not
-- `final_value`. Shadowing a selected column is the failure that killed get_challenge_watch from
-- 0081 until 0099, and picking non-colliding names means a later edit cannot reintroduce it by
-- adding one unqualified reference.
--
-- 🔒 A RACER'S RECEIPT IS VISIBLE TO THE WHOLE FIELD, and that is a deliberate widening rather
-- than an oversight. This function is already gated by can_watch_challenge, so the audience is
-- the people who could watch the race; within that audience the reward band is the point of a
-- ranked board — mock 114's "hotter rewards as the pool grows" is unreadable if you can only see
-- your own. What is NOT exposed is anything outside this challenge: no balance, no inventory, no
-- other race.

drop function if exists get_challenge_results(uuid);

create function get_challenge_results(p_challenge_id uuid)
returns table (
  member_id uuid,
  member_name text,
  score_value numeric,
  place int,
  percentile numeric,
  awarded_xp int,
  is_winner boolean,
  reward jsonb
)
language plpgsql
security definer
set search_path = public
stable
as $res$
declare
  v_challenge social_challenges;
begin
  select * into v_challenge from social_challenges sc where sc.id = p_challenge_id;
  if v_challenge.id is null then
    raise exception 'Challenge not found.';
  end if;
  if not challenge_is_settled(v_challenge.status) then
    -- Not an access error. A live challenge has no result yet, and returning an empty set here
    -- would let a results screen render "nobody placed" over a race still being run.
    raise exception 'That challenge has not finished yet.';
  end if;
  if not can_watch_challenge(p_challenge_id) then
    raise exception 'You don''t have access to watch this challenge.';
  end if;

  return query
  select
    p.user_id,
    pr.display_name,
    p.final_value,
    p.final_rank,
    p.final_percentile,
    coalesce((
      select sum(b.amount)::int from bonus_xp_awards b
      where b.challenge_id = p_challenge_id and b.user_id = p.user_id
    ), 0),
    v_challenge.winner_id is not null and p.user_id = v_challenge.winner_id,
    p.reward_payload
  from challenge_participants p
  join profiles pr on pr.id = p.user_id
  where p.challenge_id = p_challenge_id and p.state = 'accepted'
  -- nulls last so a challenge settled before 0111 (no final_rank written) still lists its field
  -- rather than ordering on nothing.
  order by p.final_rank asc nulls last, pr.display_name asc;
end;
$res$;

grant execute on function get_challenge_results(uuid) to authenticated;

-- ─────────────────────────── 3 · self-assertion ───────────────────────────
--
-- Proves the two new columns are actually reachable rather than merely declared — a RETURNS TABLE
-- that names a column the body forgot to select is a compile-time error, but a column selected
-- from the wrong place is not, and "it deployed" is not evidence it carries the right figure.
do $assert$
declare
  v_cols int;
begin
  select count(*) into v_cols
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join lateral unnest(p.proargnames) as a(name)
  where n.nspname = 'public'
    and p.proname = 'get_my_social_challenges'
    and a.name in ('my_awarded_xp', 'my_reward_payload');

  if v_cols <> 2 then
    raise exception '0154: get_my_social_challenges is missing the reward columns (found % of 2). The History row would have nothing to show.', v_cols;
  end if;

  -- Exactly one of each, or an old overload is still standing and callers may bind to it
  -- (MIGRATIONS.md's overload trap). Both functions here were dropped by name with their full
  -- argument list, so this should be 1 — it is checked because "the migration succeeded" has not
  -- meant that before.
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'get_my_social_challenges') <> 1 then
    raise exception '0154: more than one get_my_social_challenges in pg_proc.';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'get_challenge_results') <> 1 then
    raise exception '0154: more than one get_challenge_results in pg_proc.';
  end if;
end;
$assert$;

comment on function get_my_social_challenges() is
  '0154 — adds my_awarded_xp (the ledger''s figure, not the advertised pot) and my_reward_payload (grant_reward''s stored receipt) so a settled challenge is a durable record of what it paid, not only a one-shot reveal.';
