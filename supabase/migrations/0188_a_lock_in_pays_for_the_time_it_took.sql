-- 0188 — A lock-in pays embers for the time it actually took.
--
-- ─────────────────────────────── WHY ───────────────────────────────
--
-- Same root cause 0187 Fix A cured for Pass XP. economy_on_lock_in_completed handed
-- economy_award_lock_in_embers `last_confirmed_at − started_at`. last_confirmed_at only moves when
-- the user taps "still here", so on nearly every real session the two are equal, the length reads
-- 0, and the award returns at its 300-second floor. On prod: 127 completed sessions cleared the
-- floor, 6 were ever paid (the ones someone confirmed mid-session). The currency faucet was dry.
--
-- The length now comes from check_ins.duration_seconds through ended_check_in_id — the source rank
-- XP and (since 0187) Pass XP read, so all three ladders agree on how long someone worked. The
-- trigger fires AFTER UPDATE OF status, on the same UPDATE in which stop_lock_in_session stamps
-- ended_check_in_id, after the check-in row exists, so the lookup always has its row. Nothing
-- here joins goals: a null-goal category lock-in pays its base embers like any other.
--
-- economy_locked_in_with_friend had the identical defect in the same trigger: "overlap" compared
-- started_at against the other session's last_confirmed_at, which is its own start, so two friends
-- locked in side by side almost never overlapped and 'daily_with_a_friend' Pass XP never paid. A
-- session now ends at started_at + its check-in's duration; an unfinished one is still running
-- (now()); last_confirmed_at is only the fallback for a session with neither.
--
-- Not changed: the award formula, the caps, and the ledger. Forward-only — no retro-pay (the two
-- accounts affected hold test balances).

-- ── base check · restated from the LIVE bodies ──
do $base$
declare
  v_moved text;
begin
  select string_agg(b.name, ', ') into v_moved
  from (values
    ('economy_on_lock_in_completed',  'f630adeb02b1aa2517d1115b4018e983'),
    ('economy_locked_in_with_friend', '0a7ffb52f75172681f59747a9e9840ac')
  ) b(name, md5)
  join pg_proc p on p.proname = b.name and p.pronamespace = 'public'::regnamespace
  where md5(p.prosrc) <> b.md5;
  if v_moved is not null then
    raise exception '0188: live body changed since this file was drafted: % — rebase onto it', v_moved;
  end if;
end;
$base$;

create or replace function economy_on_lock_in_completed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seconds int;
  v_season text := (select value ->> 'id' from economy_config where key = 'season');
begin
  if new.status <> 'completed' or coalesce(old.status, '') = 'completed' then
    return new;
  end if;

  -- 0188: was `last_confirmed_at − started_at`, which is 0 on almost every real session.
  select c.duration_seconds into v_seconds
  from check_ins c
  where c.id = new.ended_check_in_id and c.removed_at is null;
  v_seconds := greatest(0, coalesce(v_seconds, 0));

  perform economy_award_lock_in_embers(new.user_id, v_seconds, new.id);
  perform evaluate_pass_achievements(new.user_id);

  if economy_locked_in_with_friend(new.user_id) then
    perform economy_credit_pass_xp_for(
      new.user_id, 'daily_with_a_friend', 50, to_char(now(), 'YYYY-MM-DD')
    );
  end if;

  return new;
end;
$$;

create or replace function economy_locked_in_with_friend(p_user uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
    from lock_in_sessions me
    left join check_ins mc on mc.id = me.ended_check_in_id
    join friend_requests fr
      on fr.status = 'accepted'
     and (fr.requester_id = me.user_id or fr.recipient_id = me.user_id)
    join lock_in_sessions them
      on them.user_id = case when fr.requester_id = me.user_id then fr.recipient_id else fr.requester_id end
    left join check_ins tc on tc.id = them.ended_check_in_id
    -- 0188: when each session really ended. See the header.
    cross join lateral (
      select
        coalesce(me.started_at + make_interval(secs => mc.duration_seconds),
                 case when me.status = 'active' then now() end,
                 me.last_confirmed_at) as me_end,
        coalesce(them.started_at + make_interval(secs => tc.duration_seconds),
                 case when them.status = 'active' then now() end,
                 them.last_confirmed_at) as them_end
    ) e
    where me.user_id = p_user
      and me.started_at >= date_trunc('day', now())
      and them.started_at >= date_trunc('day', now()) - interval '1 day'
      -- Real overlap: each started before the other finished.
      and me.started_at <= e.them_end
      and them.started_at <= e.me_end
  );
$$;

do $assert$
begin
  -- The body resolves (sql functions bind at call time too). A null user matches nothing.
  if economy_locked_in_with_friend(null) then
    raise exception '0188: friend overlap matched a null user';
  end if;

  -- The trigger is still wired to the replaced function.
  if not exists (
    select 1 from pg_trigger
    where tgname = 'lock_in_sessions_economy'
      and tgfoid = 'economy_on_lock_in_completed()'::regprocedure
  ) then
    raise exception '0188: lock_in_sessions_economy no longer calls economy_on_lock_in_completed';
  end if;
end;
$assert$;
