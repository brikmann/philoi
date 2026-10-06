-- 0233 — Friends see you locked in.
--
-- ─────────────────────────────── WHY ───────────────────────────────
--
-- The running lock-in screen's "Locked in with you" strip could only ever show campfire-mates:
-- lock_in_sessions' SELECT policy (0007) is `user_id = auth.uid() or is_circle_mate_of(user_id)`,
-- and since 0031 friendship is a separate graph from campfire membership. Two accepted friends who
-- share no campfire could not see each other's active session at all, so a solo lock-in had nobody
-- to show. This widens the read to accepted friends.
--
-- What it exposes to a friend: the session row — goal_type/goal_detail, circle_id, mode, timing.
-- That is presence, the thing the body-double strip exists to show, and no more than a campfire-mate
-- already reads. No opt-out in v1; if one is wanted, gate the friend branch on a profiles flag.
--
-- ── is_friend_of(other), not are_friends(a, b) ──
--
-- A SECURITY DEFINER two-argument check would let any signed-in user ask "are X and Y friends?" for
-- any pair, which is exactly what friend_requests' own RLS ("read own") hides. One argument, the
-- caller taken from auth.uid() — the same shape as is_circle_mate_of, for the same reason.
--
-- ── Blocking ──
--
-- Blocking does not delete the friend_requests row, so an accepted friendship can outlive a block.
-- The friend branch therefore also requires `not is_blocked_either_way(user_id)`: a block hides the
-- session in both directions. The circle-mate branch is left exactly as it was.
--
-- ── `to authenticated` ──
--
-- 0007's policy applied to `public`. anon has no auth.uid(), so it never matched a row either way;
-- scoping to authenticated changes nothing for anyone, and means anon never evaluates the new
-- helper, which is granted to authenticated only (a revoked SECURITY DEFINER helper inside a policy
-- 42501s every read for the role that lacks it).

-- ─────────────────────────── 0 · preconditions ───────────────────────────
do $guard$
begin
  if to_regprocedure('public.is_circle_mate_of(uuid)') is null then
    raise exception '0233 needs is_circle_mate_of(uuid) — see 0002';
  end if;
  if to_regprocedure('public.is_blocked_either_way(uuid)') is null then
    raise exception '0233 needs is_blocked_either_way(uuid) — see schema.sql';
  end if;
  if not exists (select 1 from information_schema.tables
                  where table_schema = 'public' and table_name = 'friend_requests') then
    raise exception '0233 needs friend_requests — see 0031';
  end if;
end;
$guard$;

-- ─────────────────────────── 1 · the helper ───────────────────────────
create or replace function is_friend_of(p_other_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from friend_requests fr
    where fr.status = 'accepted'
      and ((fr.requester_id = auth.uid() and fr.recipient_id = p_other_user_id)
        or (fr.recipient_id = auth.uid() and fr.requester_id = p_other_user_id))
  );
$$;

revoke execute on function is_friend_of(uuid) from public, anon;
grant execute on function is_friend_of(uuid) to authenticated;

-- ─────────────────────────── 2 · the policy ───────────────────────────
drop policy if exists "lock_in_sessions: read if circle-mate" on lock_in_sessions;
drop policy if exists "lock_in_sessions: read if circle-mate or friend" on lock_in_sessions;
create policy "lock_in_sessions: read if circle-mate or friend" on lock_in_sessions
  for select to authenticated using (
    user_id = auth.uid()
    or is_circle_mate_of(user_id)
    or (is_friend_of(user_id) and not is_blocked_either_way(user_id))
  );
