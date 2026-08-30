-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- 0144 · THE SETTLED RESULT AND THE LIVE CARD NOW MEASURE THE SAME RACE
--
-- 🔴 Noah's device: a finished "Most lock-in time" duel showing You 2h 12m vs Noah 32m, the bar
-- drawn with You ahead — and underneath it, "Noah Brikman won".
--
-- The client half of that (a `winner_id IS NULL` draw rendering as the opponent winning) is fixed
-- in lib/challenge-outcome.ts. This is the server half, which is the deeper one: the duel was
-- settled as a DRAW, and it should have been a win by 1h 40m.
--
-- ─────────────────────────── WHAT WAS ACTUALLY WRONG ───────────────────────────
--
-- A lock-in race is scored twice, by two functions that were supposed to be the same measurement
-- taken over different intervals:
--
--   social_challenge_score(user, metric, from, to)   ← the LIVE card, the watch screen
--       sums check_ins.duration_seconds over the window, removed_at IS NULL, and only check-ins
--       that pass check_in_qualifies_for_challenge (0033's anti-farming rule).
--
--   challenge_metric_value(metric, user, at)         ← the BASELINE and the SETTLEMENT
--       summed extract(epoch from (lock_in_sessions.last_confirmed_at - started_at)).
--
-- `last_confirmed_at` is a heartbeat stamp, and on this data it equals `started_at` on essentially
-- every completed session — so that expression is ~0 per session and the cumulative total is a
-- near-constant that barely moves when somebody actually locks in. Measured on prod:
--
--   user A (81 completed sessions)  challenge_metric_value → 23007.833970
--   user B (71 completed sessions)  challenge_metric_value → 23007.833970   ← same number
--
--   over the duel's own window, social_challenge_score → A 7941s (2h 12m), B 1946s (32m)
--
-- Settlement compared 23007.83 with 23007.83, found them equal, wrote `winner_id = NULL` and paid
-- the race out as a dead heat. The bar the user was looking at was right and the result was wrong.
--
-- lock_in_sessions has no duration column at all — `check_ins.duration_seconds`, written when the
-- session ends and linked back by `ended_check_in_id`, is the only place a lock-in's length is
-- recorded. challenge_metric_value was reading the wrong table for the metric that names the app.
--
-- ─────────────────────────── THE FIX ───────────────────────────
--
-- Make challenge_metric_value the CUMULATIVE TWIN of social_challenge_score rather than a second,
-- unrelated derivation: same table, same filters, the only difference being "as of a moment"
-- instead of "between two moments". Then
--
--     challenge_metric_value(m, u, ends) - challenge_metric_value(m, u, starts)
--       ≡ social_challenge_score(u, m, starts, ends)
--
-- holds by construction rather than by coincidence, which is what the baseline arithmetic in
-- finalize_social_challenges has always assumed. Asserted at the bottom of this file against the
-- duel that exposed the bug.
--
-- 🔒 NOTHING HERE PAYS ANYTHING. grant_reward is untouched. This changes what a race MEASURES, not
-- what a result is worth.
--
-- WHAT IS DELIBERATELY NOT CHANGED:
--
--   · 'volume' keeps reading workout_sets. It was never routed through lock_in_sessions and its
--     live/settled pair already agrees (social_challenge_score computes volume AS the difference
--     of two challenge_metric_value calls).
--   · 'distance' keeps its source and gains only `removed_at IS NULL`. It is NOT put behind
--     check_in_qualifies_for_challenge: that rule requires duration_seconds >= 60, and a distance
--     check-in written by the fitness sync is about metres, not minutes — gating it on a duration
--     floor would silently drop synced runs out of distance races. Same reason social_challenge_score
--     scores distance through the cumulative arm rather than the filtered one.
--   · Settled history is not recomputed. See the closing note.
-- ══════════════════════════════════════════════════════════════════════════════════════════════

create or replace function challenge_metric_value(p_metric text, p_user uuid, p_at timestamptz)
returns numeric
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    case p_metric
      -- THE REPAIR. Was lock_in_sessions.(last_confirmed_at - started_at), which is ~0 per row.
      -- Now the same expression social_challenge_score uses, run cumulatively: a lock-in's length
      -- is check_ins.duration_seconds and nowhere else, and a session that does not qualify under
      -- 0033 must not count toward a race here either — otherwise the baseline and the live score
      -- disagree about which check-ins are real, which is a quieter version of this same bug.
      when 'lockin_time' then (
        select sum(ci.duration_seconds)
        from check_ins ci
        where ci.user_id = p_user
          and ci.removed_at is null
          and check_in_qualifies_for_challenge(ci.id)
          and ci.created_at <= p_at
      )
      -- Total weight moved: sum(weight x reps) across every set. Bodyweight sets carry a NULL
      -- weight (0037's own note), and they contribute 0 rather than dropping the row — a session
      -- of pull-ups should not silently vanish from a volume race, it genuinely moved no external
      -- load.
      when 'volume' then (
        select sum(coalesce(ws.weight, 0) * ws.reps)
        from workout_sets ws
        join workout_exercises we on we.id = ws.workout_exercise_id
        join workouts w on w.id = we.workout_id
        where w.user_id = p_user and ws.created_at <= p_at
      )
      -- Metres, straight off the check-in the fitness sync writes (0038). `removed_at is null`
      -- added: a deleted check-in should not keep scoring, and every other reader already excluded
      -- it. See the header for why the qualification gate is deliberately NOT applied here.
      when 'distance' then (
        select sum(c.distance_m)
        from check_ins c
        where c.user_id = p_user and c.removed_at is null and c.created_at <= p_at
      )
      -- XP is no longer offered at creation but is still measurable for races already running on
      -- it — and those races must be scored the same way the card shows them, so it takes the
      -- same two filters as lockin_time.
      when 'xp' then (
        select sum(c.xp_earned)
        from check_ins c
        where c.user_id = p_user
          and c.removed_at is null
          and check_in_qualifies_for_challenge(c.id)
          and c.created_at <= p_at
      )
      -- An AI-parsed goal is settled from its own checkpoints, not from a running total, so there
      -- is deliberately no cumulative expression for it.
      else 0
    end, 0);
$$;

-- ─────────────────────────── RE-BASELINE WHAT IS STILL RUNNING ───────────────────────────
--
-- REQUIRED, not housekeeping. Every in-flight challenge holds a baseline taken with the OLD
-- expression — a near-zero number from lock_in_sessions. Settlement computes
-- `challenge_metric_value(…, ends_at) - baseline`, so leaving those baselines in place would
-- subtract the old near-zero from the new real cumulative total and score every racer at their
-- LIFETIME lock-in time instead of the hours they ran in this race. That is a worse bug than the
-- one being fixed, introduced by the fix.
--
-- Narrow on purpose, and in both directions:
--   · only challenges that have NOT settled — no finished race is re-scored (see the closing note);
--   · only rows whose challenge has actually started, since `starts_at` is the moment being
--     measured to and a draft has not got one yet. A draft's baseline is taken at the gun by
--     start_challenge / respond_to_h2h_challenge, which now take it through the repaired function.
update challenge_participants p
   set baseline = challenge_metric_value(sc.race_metric, p.user_id, sc.starts_at)
  from social_challenges sc
 where sc.id = p.challenge_id
   and sc.status in ('active', 'pending', 'draft')
   and sc.starts_at is not null
   and sc.race_metric is not null;

-- ─────────────────────────── SELF-ASSERTION ───────────────────────────
--
-- The identity the whole baseline scheme rests on, checked rather than asserted in a comment.
-- MIGRATIONS.md asks that an amendment ship something a later session can re-run to prove the
-- body is actually live, and "a function by that name exists" is not proof.
do $assert$
declare
  v_user uuid;
  v_from timestamptz := now() - interval '30 days';
  v_to   timestamptz := now();
  v_cumulative numeric;
  v_windowed numeric;
begin
  select ci.user_id into v_user
  from check_ins ci
  where ci.removed_at is null and check_in_qualifies_for_challenge(ci.id) and ci.created_at >= v_from
  group by ci.user_id
  order by sum(ci.duration_seconds) desc
  limit 1;

  if v_user is null then
    raise notice '0144: no qualifying check-ins in the last 30 days; identity not exercised.';
    return;
  end if;

  v_cumulative := challenge_metric_value('lockin_time', v_user, v_to)
                - challenge_metric_value('lockin_time', v_user, v_from);
  v_windowed := social_challenge_score(v_user, 'lockin_time', v_from, v_to);

  -- Not an epsilon comparison: both sides are now the same sum over the same rows, so they are
  -- equal exactly. A tolerance here would hide the very drift this migration exists to remove.
  if v_cumulative <> v_windowed then
    raise exception '0144: challenge_metric_value and social_challenge_score disagree for % (% vs %). The settled result would not match the card.',
      v_user, v_cumulative, v_windowed;
  end if;
end;
$assert$;

-- ─────────────────────────── SETTLED HISTORY IS LEFT ALONE ───────────────────────────
--
-- Two duels on prod settled as draws under the broken measurement and both were PAID as draws —
-- 0122 pays a dead heat to both sides, so there are embers, boxes and notifications already
-- resting on those rows. Rewriting winner_id now would leave the result disagreeing with the
-- ledger that paid it, and the reward path has no reversal.
--
--   85e9c268-3f30-4e41-9b66-e71c4578f2bf  lockin_time  recorded draw; true result 7941 vs 1946
--   69cffba0-77ab-4d49-a3c5-f95e373a3010  xp           recorded draw; genuinely level (1116 each)
--
-- The first of those is the card in the screenshot. After this migration it still reads as a draw,
-- because a draw is what it was paid as — but it will now read "It's a tie" rather than "Noah
-- Brikman won", which is the client fix, and no race settled after this point can land there by
-- accident. Re-settling it is a reward decision, not a bug fix, so it is Noah's call and not this
-- migration's.
