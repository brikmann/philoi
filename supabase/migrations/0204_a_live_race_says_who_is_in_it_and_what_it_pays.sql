-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 0204 · A LIVE RACE SAYS WHO IS IN IT, AND A SCOPED ONE SAYS WHAT IT PAYS.
--
-- Two reads widen. Nothing here pays, re-rates, creates or settles anything — the figures all
-- exist already and have since 0111 / 0174 / 0175, and every one of them was being written by the
-- server and read by nobody. Same rule 0154 was written under.
--
-- ──────────────────── 1 · THE HOME PILL COUNTED THE WRONG THING ────────────────────
--
-- get_active_challenge_marker has returned `target_count` since 0040, and the chip rendered it as
-- "Group · N×". target_count is null by constraint on a placement race (0126) and null on a
-- measured collective goal (0169), so for both shapes the pill on Your fire read, literally,
--
--     Group · ?×
--
-- The marker has never carried a participant count at all, so there was nothing truer to fall back
-- to. It carries one now, from challenge_field — the one definition of who is in a race, which is
-- what settlement pays across (0111) and what get_my_social_challenges already counts for
-- member_count. Three copies of "who counts" is three chances to disagree.
--
-- ──────────────────── 2 · A SCOPED RACE COULD NOT SAY SO ────────────────────
--
-- The Cindy scoping chain is complete end to end: the coach tool proposes a tier, the verdict
-- screen shows what the SERVER prices it at, create_group_challenge / create_placement_challenge
-- take p_tier (0175), scope_challenge_at_create writes it inside the create transaction, and
-- settlement spends it (0174). Every step of that is live on prod.
--
-- The tier then vanished. get_my_social_challenges is the only list the challenge screens read,
-- and it selected neither `difficulty_tier` nor `verifiability` — so the info screen had nothing
-- but the flat `payout_xp` default and told every racer on a mythic-scoped placement board that
-- "Everyone takes up to +300 XP". The one surface that already prices a scope correctly is the
-- PERSONAL-GOAL branch of the same screen, because get_my_challenges does select the tier.
--
-- 🔒 THIS IS A READ, NOT A DOOR. `verifiability` stays DERIVED server-side and is still never
-- accepted from a client (0160's firewall, restated by 0175's challenge_verifiability_for). The
-- client needs it because preview_challenge_reward prices (tier, verifiability) TOGETHER — the
-- honour discount is what keeps a self-reported race from minting the top three boxes — so a
-- client holding only the tier would guess the other half, and guess it wrong on every grade and
-- every count race.
--
-- ──────────────────── WHY BOTH ARE drop-then-create ────────────────────
--
-- Both change their RETURNS TABLE, and Postgres refuses to `create or replace` a function whose
-- OUT columns moved. Neither takes an argument set that could produce a second overload worth
-- worrying about, but the drop is explicit and typed per MIGRATIONS.md either way.
--
-- 🛑 RESTATED FROM PROD'S OWN BASE, VERIFIED. Before writing this file, md5(prosrc) of both live
-- functions was compared against the bodies in their source migrations:
--
--   get_my_social_challenges     d751185e78615ab17c1ea5828ecd99a5 == 0154's body
--   get_active_challenge_marker  be2293ff0138279eaace5dafeaa58bf0 == 0040's body
--
-- so the bodies below are those two files verbatim plus the selects named above, and this
-- restatement cannot silently revert a sibling branch's amendment. If you restate either of them
-- again, do that check first.
--
-- NOT CHANGED HERE: the flat `payout_xp` a group challenge created through the plain form still
-- carries, which is the floor. Only the Cindy path proposes a tier; a form-built race stays
-- unscoped and pays exactly what it paid yesterday. Default-scoping the form path is a product
-- decision, not a repair, and is deliberately not taken here.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────── 1 · the pulsing marker ───────────────────────────

drop function if exists get_active_challenge_marker(uuid);

create function get_active_challenge_marker(p_user_id uuid)
returns table (
  challenge_id uuid,
  mode text,
  circle_id uuid,
  opponent_id uuid,
  opponent_name text,
  race_metric text,
  target_count int,
  ends_at timestamptz,
  can_watch boolean,
  participant_count int
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_is_self boolean := p_user_id = auth.uid();
  v_shares_circle boolean;
  v_is_friend boolean;
  v_target_opted_in boolean;
begin
  select exists (
    select 1 from group_members gm1 join group_members gm2 on gm1.group_id = gm2.group_id
    where gm1.user_id = auth.uid() and gm2.user_id = p_user_id
  ) into v_shares_circle;

  select exists (
    select 1 from friend_requests
    where status = 'accepted'
      and ((requester_id = auth.uid() and recipient_id = p_user_id) or (requester_id = p_user_id and recipient_id = auth.uid()))
  ) into v_is_friend;

  if not v_is_self and not v_shares_circle and not v_is_friend then
    return; -- no visibility path at all — not self, no shared campfire, not a friend
  end if;

  select watch_opt_in into v_target_opted_in from profiles where id = p_user_id;

  return query
  select
    sc.id,
    sc.mode,
    sc.circle_id,
    sc.opponent_id,
    opp.display_name,
    sc.race_metric,
    sc.target_count,
    sc.ends_at,
    -- Campfire Watch = any co-member of that challenge's circle; profile Watch = friends AND
    -- their opt-in (§16's access gate, both paths, whichever applies to this viewer).
    (v_shares_circle and sc.circle_id is not null) or (v_is_friend and coalesce(v_target_opted_in, false)) as can_watch,
    -- NEW (0204). WHO IS ACTUALLY IN THE RACE. The chip rendered `target_count` as "Group · N×"
    -- and target_count is null on a placement race by constraint (0126) and null on a measured
    -- collective goal (0169), so the home pill read the literal "Group · ?x" for both.
    --
    -- challenge_field, not `count(*) from challenge_participants` — one definition of who counts,
    -- the same one settlement pays (0111) and the same one get_my_social_challenges counts for
    -- member_count. A pre-0096 challenge has no roster at all and challenge_field falls back to
    -- the whole campfire for it, which is exactly who that challenge will still be settled across.
    --
    -- GROUP ONLY, and gated for the same reason member_count is: challenge_field's legacy branch
    -- unions the whole circle when a challenge has no roster rows, so a watched duel with no
    -- roster would report the campfire's size as its field. A duel reads "vs <them>" and has no
    -- use for the number; null is the honest answer rather than a wrong one.
    case when sc.mode = 'group'
      then (select count(*)::int from challenge_field(sc.id, sc.circle_id)) else null end as participant_count
  from social_challenges sc
  left join profiles opp on opp.id = sc.opponent_id
  where sc.status = 'active'
    and (sc.created_by = p_user_id or sc.opponent_id = p_user_id)
  order by sc.ends_at asc nulls last
  limit 1;
end;
$$;
-- Re-issued because dropping a function takes its ACL with it. 0040 never granted this explicitly
-- and relied on Supabase's default privilege; naming the grant leaves the app's access stated
-- rather than inherited, and it is the role the RPC's own auth.uid() gate is written for.
grant execute on function get_active_challenge_marker(uuid) to authenticated;

comment on function get_active_challenge_marker(uuid) is
  '0204 -- 0040''s marker plus participant_count, the field from challenge_field (group shapes only; null on a duel). The chip printed target_count, which is null on a placement race and on a measured collective goal.';

-- ─────────────────────────── 2 · the tab's own list ───────────────────────────

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
  my_reward_payload jsonb,
  -- NEW (0204). THE SCOPE CINDY PROPOSED, so a screen can price the race the way settlement will.
  --
  -- 0174 taught settlement to read social_challenges.difficulty_tier and 0175 opened the
  -- create-time write path, so a Cindy-scoped group or placement race has carried a real tier
  -- since both landed. Nothing could READ it: this is the only list the challenge screens have,
  -- and it selected neither column — so the info screen could only print the flat `payout_xp`
  -- default and told every racer on a mythic-scoped race that "everyone takes up to +300 XP".
  --
  -- Both, not just the tier. preview_challenge_reward prices (tier, verifiability) together — the
  -- honour discount is what stops a self-reported race minting the top three boxes — so a client
  -- holding only the tier would have to guess the other half and would guess it wrong on every
  -- grade and count race. verifiability is DERIVED server-side and never accepted from a client
  -- (0160/0175); passing it back out is a read, not a door.
  difficulty_tier text,
  verifiability text
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
      where cp.challenge_id = sc.id and cp.user_id = auth.uid()) as my_reward_payload,
    sc.difficulty_tier,
    sc.verifiability
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

comment on function get_my_social_challenges() is
  '0204 -- 0154''s body plus difficulty_tier and verifiability, so the challenge screens can price a Cindy-scoped race the way settlement (0174) will actually pay it instead of printing the flat payout_xp default.';

-- ─────────────────────────── 3 · assertions ───────────────────────────
--
-- Reachable ones. 0146's push failed inside its own assertion because the pre-flight had run the
-- block against the PRE-migration state, where the first guard raises and the broken line below it
-- is never reached — so everything here runs unconditionally against the state this file leaves.
--
-- The two calls at the foot matter more than the catalog checks above them. `create function` only
-- syntax-checks a plpgsql body: nothing in either function RUNS until something calls it, so a
-- RETURNS TABLE column shadowing a table column in the body (the fault that killed
-- get_challenge_watch from 0081 to 0099) would pass every structural check here and fail on the
-- first real request. auth.uid() is null in a migration, so both return an empty set — that is
-- fine and is the point: the bodies are planned and executed either way.
do $assert$
declare
  v_marker oid;
  v_mine oid;
  v_n int;
begin
  select p.oid into v_marker from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'get_active_challenge_marker';
  select p.oid into v_mine from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'get_my_social_challenges';

  -- One name, one row in pg_proc. A defaulted-parameter overload is how a "replaced" function
  -- keeps serving its old body (MIGRATIONS.md), and the drops above are what prevent it.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('get_active_challenge_marker', 'get_my_social_challenges')
   group by p.proname order by 1 desc limit 1;
  if v_n <> 1 then
    raise exception '0204: % overloads of one of the two readers — the drop did not take.', v_n;
  end if;

  -- The columns this file exists for. Named, not counted: a count would also be green if a
  -- rebase dropped one of them and a later edit added an unrelated one back.
  if pg_get_function_result(v_marker) not like '%participant_count integer%' then
    raise exception '0204: get_active_challenge_marker has no participant_count column.';
  end if;
  if pg_get_function_result(v_mine) not like '%difficulty_tier text%'
     or pg_get_function_result(v_mine) not like '%verifiability text%' then
    raise exception '0204: get_my_social_challenges is missing difficulty_tier/verifiability.';
  end if;

  -- 🔒 THE POSITIVE CONTROL for the two checks above. If pg_get_function_result ever stopped
  -- spelling types this way, both `not like` guards would pass silently on a function that had
  -- neither column — a green check that would also be green under the bug is not a test. This
  -- asserts the same predicate against a column that has been there since 0040 / 0154.
  if pg_get_function_result(v_marker) not like '%can_watch boolean%'
     or pg_get_function_result(v_mine) not like '%my_reward_payload jsonb%' then
    raise exception '0204: the column-name assertions above cannot discriminate — pg_get_function_result does not spell types as expected.';
  end if;

  -- Dropping a function takes its ACL. Checked by oid, not by the text form: that one takes TYPES
  -- only, and building the string from pg_get_function_identity_arguments (which includes
  -- parameter NAMES) is precisely what broke 0146.
  if not has_function_privilege('authenticated', v_marker, 'EXECUTE')
     or not has_function_privilege('authenticated', v_mine, 'EXECUTE') then
    raise exception '0204: authenticated lost EXECUTE on one of the two readers.';
  end if;

  -- Both bodies, actually run. See the note above the block.
  perform * from get_active_challenge_marker(auth.uid());
  perform * from get_my_social_challenges();
end;
$assert$;
