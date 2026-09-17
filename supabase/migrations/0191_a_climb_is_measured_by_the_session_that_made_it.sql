-- 0191 — A climb is measured by the session that made it.
--
-- The lock-in done screen's "🔥 You climbed" card (mock 204, CODE_PROMPT_done_rank_movement.md):
-- one round trip that fills three rows — Friends, University, Global — with how far THIS session
-- moved the caller in each.
--
-- ─────────────────────────────── WHY NOT ABSOLUTE RANK ───────────────────────────────
--
-- Everyone else locks in too, so "#12 now vs #11 last time" can read as a drop the user did
-- nothing to cause. The card must never show one. Every figure here is taken over the SAME
-- population at the SAME instant, differing only by this session's XP:
--
--     xp_after  = universal_score(caller)
--     xp_before = xp_after − session_xp
--     passed    = |{ u in scope : xp_before < score(u) ≤ xp_after }|     ≥ 0 by construction
--     rank_after = |{ u in scope : score(u) > xp_after }| + 1
--
-- so rank_before = rank_after + passed exactly, and the client can animate the tick-down from it
-- without a second field. Nothing here can go the wrong way.
--
-- ─────────────────────────────── REUSE, NOT NEW DISTRIBUTIONS ───────────────────────────────
--
-- The three populations are the ones the existing boards already rank over, predicate for
-- predicate, so the number on this card is the number the leaderboard screen shows:
--
--   • global  — get_global_leaderboard:     not is_demo, not is_disabled, can_see_rank (0170)
--   • campus  — get_university_leaderboard: + same university, university_email_verified (0062)
--   • friends — get_my_friends' population: accepted friend_requests, + the caller
--
-- The score is universal_score — the one every board, the Agora and get_my_ranks read. (0190's
-- live_rank_xp is the ladder layer and deliberately does not feed the leaderboards.) Ties: the
-- boards break ties by display_name via row_number; this counts strictly-greater, so a tied
-- caller gets the better seat. That is the only divergence, and it can only flatter.
--
-- universal_score is computed ONCE per profile in a single CTE and the three scopes are filtered
-- aggregates over it, not three scans.
--
-- ─────────────────────────────── GATING ───────────────────────────────
--
-- A weak scope nulls its own key and leaves the others alone:
--   • friends — null when the caller has no accepted friends (never "#1 of 1").
--   • campus  — null when the caller has no university or has not verified it.
--   • global  — always present for a signed-in caller.
-- The "big enough to show a raw #" gate is presentation and stays client-side; `total` ships so it
-- can be applied. percentile_after is a percent in (0, 100], one decimal — the client buckets it.
--
-- ─────────────────────────────── HARDENING ───────────────────────────────
--
-- Self-only: the subject is auth.uid(), there is no user-id parameter to spoof. session_xp is
-- client-supplied, so it is clamped to [0, xp_after] — an inflated value can only make the caller's
-- own card lie to the caller, but it should not be able to invent a before-score below zero.
-- EXECUTE is revoked from public AND anon explicitly (revoking public alone leaves anon's own
-- grant standing — see 0185).

create or replace function get_rank_movement(p_session_xp numeric)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_university text;
  v_verified boolean;
  v_after numeric;
  v_before numeric;
  v_friends_n int;
  v_campus_n int;
  v_global_n int;
  v_friends_above int;
  v_campus_above int;
  v_global_above int;
  v_friends_passed int;
  v_campus_passed int;
  v_global_passed int;
begin
  if v_user is null then
    raise exception 'get_rank_movement: not authenticated';
  end if;

  select p.university, coalesce(p.university_email_verified, false)
    into v_university, v_verified
  from profiles p where p.id = v_user;

  v_after := coalesce(universal_score(v_user), 0);
  v_before := v_after - least(greatest(coalesce(p_session_xp, 0), 0), v_after);

  -- Everyone but the caller, scored once. The caller is added back as the "+ 1" in each total.
  with others as (
    select
      p.id,
      universal_score(p.id) as score,
      (p.university_email_verified and v_verified and v_university is not null
        and p.university = v_university) as in_campus,
      exists (
        select 1 from friend_requests fr
        where fr.status = 'accepted'
          and ((fr.requester_id = v_user and fr.recipient_id = p.id)
            or (fr.requester_id = p.id and fr.recipient_id = v_user))
      ) as is_friend
    from profiles p
    where p.id <> v_user
      and not p.is_demo and not p.is_disabled
      and can_see_rank(v_user, p.id)
  )
  select
    count(*) filter (where o.is_friend),
    count(*) filter (where o.in_campus),
    count(*),
    count(*) filter (where o.is_friend and o.score > v_after),
    count(*) filter (where o.in_campus and o.score > v_after),
    count(*) filter (where o.score > v_after),
    count(*) filter (where o.is_friend and o.score > v_before and o.score <= v_after),
    count(*) filter (where o.in_campus and o.score > v_before and o.score <= v_after),
    count(*) filter (where o.score > v_before and o.score <= v_after)
  into
    v_friends_n, v_campus_n, v_global_n,
    v_friends_above, v_campus_above, v_global_above,
    v_friends_passed, v_campus_passed, v_global_passed
  from others o;

  return jsonb_build_object(
    'friends', case when v_friends_n = 0 then null else jsonb_build_object(
      'rank_after', v_friends_above + 1,
      'total', v_friends_n + 1,
      'passed', v_friends_passed
    ) end,
    'campus', case when not v_verified or v_university is null then null else jsonb_build_object(
      'rank_after', v_campus_above + 1,
      'total', v_campus_n + 1,
      'percentile_after', round(100.0 * (v_campus_above + 1) / (v_campus_n + 1), 1),
      'passed', v_campus_passed
    ) end,
    'global', jsonb_build_object(
      'rank_after', v_global_above + 1,
      'total', v_global_n + 1,
      'percentile_after', round(100.0 * (v_global_above + 1) / (v_global_n + 1), 1),
      'passed', v_global_passed
    )
  );
end;
$$;

comment on function get_rank_movement(numeric) is
  'Done-screen rank movement (mock 204): {friends,campus,global} each {rank_after,total,passed'
  '[,percentile_after]} for THIS session''s XP only — never a drop. Self-only via auth.uid(). 0191.';

revoke all on function public.get_rank_movement(numeric) from public, anon;
grant execute on function public.get_rank_movement(numeric) to authenticated;
