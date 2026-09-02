-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- 0153 · EVERY DUEL HAS A ROSTER — the missing row that swallowed the standings, the payload and
--        the whole reward reveal.
--
-- 🔴 Noah's device, a finished "Most lock-in time" duel: the bell feed says "You won · You beat
-- Noah Brikman", the challenge-info screen says "No standings were recorded for this one," no
-- reward reveal fires, and it is not clear anything was paid.
--
-- ─────────────────────────── WHAT WAS ACTUALLY MISSING ───────────────────────────
--
-- Not settlement, and not grant_reward. Both ran. The layer that failed is one row earlier than
-- either: **a non-grade duel has never had `challenge_participants` rows at all.**
--
--   create_h2h_challenge (0150, and every generation back to 0053) inserts the two roster rows
--   ONLY when `p_race_metric = 'grade'`. 0150's own comment says so out loud and files the rest
--   as a decision for later:
--
--       "Creating rows for every duel would switch them all from the legacy arm to the roster
--        arm. That is very likely where this should end up ... Left as one decision for one day."
--
--   respond_to_h2h_challenge (0124) only ever UPDATEs challenge_participants. With no row to
--   update it is a no-op that reports success.
--
-- So a lock-in-time duel runs its whole life with an empty roster, and every consumer downstream
-- is keyed on that roster:
--
--   finalize_social_challenges   v_has_roster = false, so it scores through the legacy
--                                social_challenge_score arm — CORRECTLY — writes winner_id, and
--                                inserts the +200 XP into bonus_xp_awards. Then the standings
--                                block, which is guarded `if v_has_roster then`, is SKIPPED.
--                                → final_value / final_rank / final_percentile never written.
--
--   get_challenge_results        selects from challenge_participants where state = 'accepted'.
--                                Zero rows → the client's "No standings were recorded for this
--                                one." That string is the symptom, not a stale-data edge case.
--
--   economy_on_social_challenge_closed
--                                DOES fire (it triggers on the status flip, not on the roster)
--                                and DOES call grant_reward for winner and loser. The embers and
--                                the box are genuinely in the ledger. But the very next statement,
--                                `update challenge_participants set reward_payload = v_payload`,
--                                matches NOTHING. The receipt is thrown away as it is written.
--
--   get_challenge_reward         reads reward_payload off the roster → not found → '{}'.
--   get_my_unseen_challenge_rewards
--                                requires `cp.final_rank is not null` → no row → nothing to show.
--                                → ChallengeSettlementWatcher has nothing to reveal. No rays, no
--                                  embers, no box. The dopamine loop's last three steps are all
--                                  reading one table that was never written.
--
-- PIN, for the record, since the prompt asks which layer: settlement did not write standings,
-- because there was no roster to write them onto. grant_reward DID fire and DID pay. The watcher
-- saw nothing because the payload had nowhere to land. One cause, three symptoms.
--
-- ─────────────────────────── THE FIX ───────────────────────────
--
-- Make the roster unconditional, at both ends of a duel's life:
--
--   1. create_h2h_challenge writes both rows for EVERY metric, not just 'grade'.
--   2. respond_to_h2h_challenge upserts instead of updating, so the duels already sitting in
--      'pending' today — created before this migration, with no rows — still get a roster at the
--      gun rather than starting the race with the same hole.
--   3. Backfill the duels already in flight.
--   4. Repair the duels already settled: write the standings that were computed and thrown away,
--      and reconstruct the reward receipt from the ledger that actually moved.
--
-- ⚠️ THIS SWITCHES EVERY DUEL FROM THE LEGACY ARM TO THE ROSTER ARM, which is exactly the change
-- 0150 declined to make in passing. It is safe because 0144 made the two arms the same
-- measurement: with a baseline taken at starts_at,
--
--     challenge_racer_score(id, u)  ==  challenge_metric_value(m, u, ends) - baseline
--                                   ==  social_challenge_score(u, m, starts, ends)
--
-- holds by construction. The assertion at the bottom of this file checks it on real in-flight
-- rows rather than asserting it in a comment. The baselines written below are all taken at
-- starts_at — never at now() — because a baseline taken late credits the racer with nothing for
-- the hours already run, which is the mirror image of the bug 0144 fixed.
--
-- 🔒 NOTHING HERE PAYS ANYTHING NEW. grant_reward is not called, not restated, and not touched.
-- Step 4 copies figures that were already decided and already paid out of ember_ledger and
-- loot_boxes. A repaired row whose receipt came back EMPTY is stamped `reward_seen_at = now()`, so
-- this migration cannot fire a victory screen with no reward on it; a row with a real recovered
-- receipt is left unseen, because that is the reveal the bug swallowed.
-- ══════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────── 1 · a duel is created with its roster ───────────────────────────
--
-- ⚠️ RESTATED FROM PROD'S OWN BODY. This is 0150's source — which 0150 in turn took out of
-- pg_proc and diffed against 0145 — with exactly one change: the `if p_race_metric = 'grade'`
-- wrapper around the roster insert is removed and its comment rewritten. Every other line,
-- including 0150's own removal of the one-duel-per-person guard, is carried through byte for
-- byte. Diff prosrc before and after if you amend this.
--
-- The signature is byte-identical to the live one, so this REPLACES rather than adding an
-- eleventh-parameter twin (MIGRATIONS.md's overload trap). No argument is added, removed or
-- retyped; there is exactly one create_h2h_challenge in pg_proc before and after. Grants live per
-- signature and the signature has not moved, so nothing is re-granted.

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

  -- EVERY DUEL, NOT JUST A GRADE DUEL (0153). This was `if p_race_metric = 'grade'`, and that one
  -- condition is the whole of the "no standings were recorded" bug — see this file's header.
  --
  -- The asymmetry 0150 described was real: the accumulating metrics are OBSERVED, so settlement
  -- CAN score them with no roster at all, while a grade is REPORTED and has nowhere to live but
  -- this table. What that reasoning missed is that the roster is not only settlement's input. It
  -- is also where the standings, the reward receipt and the reveal's fire-once flag are kept, and
  -- all three of those are needed by every duel regardless of how its score is measured.
  --
  -- No baseline here: 'pending' has not started, and starts_at is null until the opponent accepts.
  -- respond_to_h2h_challenge takes both baselines at the gun, which is the only moment a baseline
  -- means anything.
  insert into challenge_participants (challenge_id, user_id, state, responded_at)
  values (v_challenge.id, auth.uid(), 'accepted', now()),
         (v_challenge.id, p_opponent_id, 'invited', null)
  on conflict (challenge_id, user_id) do nothing;

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

-- ─────────────────────────── 2 · accepting one creates the roster if it is missing ───────────────────────────
--
-- ⚠️ RESTATED FROM 0124'S BODY, which is prod's current source for this function (nothing since
-- has touched it). One change: the bare UPDATE becomes an upsert of BOTH sides.
--
-- Why both sides and not just the responder. There are duels sitting in 'pending' on prod right
-- now that were created before section 1 shipped, so they have no rows at all. Updating only the
-- opponent's row would leave the creator off their own roster — settlement would then see
-- v_has_roster = true with a one-person field, score the creator through the roster arm with a
-- missing baseline of 0 (i.e. their LIFETIME total), and hand them a landslide they did not run.
-- That is a worse outcome than the bug being fixed, so the accept seats both chairs or neither.
--
-- `on conflict do update` rather than `do nothing`: for a duel created after section 1 the rows
-- already exist, and the responder's state genuinely has to move invited -> accepted/declined.
-- The creator's row is inserted `do nothing` because if it is already there it is already
-- 'accepted', and re-stamping responded_at would move a timestamp that means "when they entered".

create or replace function respond_to_h2h_challenge(p_challenge_id uuid, p_accept boolean)
returns social_challenges
language plpgsql
security definer
set search_path = public
as $rh$
declare
  v_challenge social_challenges;
begin
  select * into v_challenge from social_challenges
  where id = p_challenge_id and opponent_id = auth.uid() and status = 'pending';

  if v_challenge.id is null then
    raise exception 'Challenge not found or already answered.';
  end if;

  -- The creator. Always accepted — creating a duel is entering it (R5), and their row is what
  -- carries their own standings, their reward receipt and their reveal flag.
  insert into challenge_participants (challenge_id, user_id, state, responded_at)
  values (p_challenge_id, v_challenge.created_by, 'accepted', now())
  on conflict (challenge_id, user_id) do nothing;

  -- The responder. This is the row the old UPDATE was aiming at; it now exists either way.
  insert into challenge_participants (challenge_id, user_id, state, responded_at)
  values (p_challenge_id, auth.uid(), case when p_accept then 'accepted' else 'declined' end, now())
  on conflict (challenge_id, user_id) do update
    set state = excluded.state,
        responded_at = excluded.responded_at;

  if p_accept then
    update social_challenges
    set status = 'active',
        starts_at = now(),
        starts_on = coalesce(starts_on, now()),
        ends_at = coalesce(ends_on, now() + make_interval(hours => window_hours))
    where id = p_challenge_id
    returning * into v_challenge;

    update challenge_participants p
       set baseline = challenge_metric_value(v_challenge.race_metric, p.user_id, v_challenge.starts_at)
     where p.challenge_id = p_challenge_id;
  else
    update social_challenges set status = 'declined' where id = p_challenge_id returning * into v_challenge;
  end if;

  return v_challenge;
end;
$rh$;

-- ─────────────────────────── 3 · the duels already in flight ───────────────────────────
--
-- REQUIRED, not housekeeping — for the same reason 0144's re-baseline was. A duel that is racing
-- right now will be settled by the sweep AFTER this migration lands, and the sweep asks
-- `v_has_roster` per challenge. Leaving these empty would mean today's live duels settle through
-- the legacy arm and land in exactly the state this file exists to stop.
--
-- BASELINE AT starts_at, NOT now(). A duel three hours into a 72-hour window has three hours of
-- real progress on the board; a baseline taken now would erase it and restart the race silently
-- under the racers. `coalesce(starts_at, now())` covers a 'pending' duel, which has no starts_at
-- yet and whose baseline is overwritten at the gun by section 2 anyway.
--
-- STATE. The creator is 'accepted' (creating is entering). The opponent is 'accepted' on a race
-- that is actually running — it is running BECAUSE they accepted — and 'invited' while it is
-- still pending an answer.
-- `challenge_is_live or challenge_is_awaiting`, NOT challenge_is_live alone. 0096 defines
-- challenge_is_live as exactly `status = 'active'` — the band that has already started — and a
-- duel sitting in 'pending' is precisely the case section 2's upsert exists to cover. Seating it
-- here as well means an invite answered on an OLD client (which calls the same server RPC, so this
-- is belt-and-braces rather than a second path) still has both chairs.
insert into challenge_participants (challenge_id, user_id, state, responded_at, baseline)
select sc.id, sc.created_by, 'accepted', coalesce(sc.starts_at, sc.created_at),
       challenge_metric_value(sc.race_metric, sc.created_by, coalesce(sc.starts_at, now()))
from social_challenges sc
where sc.mode = 'h2h'
  and (challenge_is_live(sc.status) or challenge_is_awaiting(sc.status))
on conflict (challenge_id, user_id) do nothing;

insert into challenge_participants (challenge_id, user_id, state, responded_at, baseline)
select sc.id, sc.opponent_id,
       case when sc.status = 'active' then 'accepted' else 'invited' end,
       case when sc.status = 'active' then coalesce(sc.starts_at, sc.created_at) else null end,
       challenge_metric_value(sc.race_metric, sc.opponent_id, coalesce(sc.starts_at, now()))
from social_challenges sc
where sc.mode = 'h2h'
  and (challenge_is_live(sc.status) or challenge_is_awaiting(sc.status))
  and sc.opponent_id is not null
on conflict (challenge_id, user_id) do nothing;

-- ─────────────────────────── 4 · the duels already settled ───────────────────────────
--
-- These are the races Noah is looking at. They were scored correctly, their winner_id is right,
-- their XP is in bonus_xp_awards and their embers and boxes are in the ledger — the ONLY thing
-- that never happened is the write to a table with no rows in it. So this is a transcription of
-- decisions already made, not a re-settlement.
--
-- 🔒 WHAT THIS DELIBERATELY DOES NOT DO:
--   · it does not recompute or change winner_id. Whatever the sweep decided stands.
--   · it does not call grant_reward. Not once, not in any branch.
--   · it does not touch a settled duel that ALREADY has a roster — those settled through the
--     roster arm and have real standings.
--
-- Only 'completed' duels are repaired. An 'expired' h2h never reached the h2h arm's standings
-- block on any code path, has no winner and paid nothing; inventing a rank for it would be this
-- migration making up a result rather than recovering one.

-- 4a · seat both racers on the settled duel.
insert into challenge_participants (challenge_id, user_id, state, responded_at, baseline)
select sc.id, u.user_id, 'accepted', coalesce(sc.starts_at, sc.created_at),
       -- The baseline that WOULD have been taken at the gun. It has to be present and correct
       -- because any later reader (challenge_racer_score, the watch board) subtracts it.
       challenge_metric_value(sc.race_metric, u.user_id, coalesce(sc.starts_at, sc.created_at))
from social_challenges sc
cross join lateral (values (sc.created_by), (sc.opponent_id)) as u(user_id)
where sc.mode = 'h2h'
  and sc.status = 'completed'
  and u.user_id is not null
  and not exists (select 1 from challenge_participants p where p.challenge_id = sc.id)
on conflict (challenge_id, user_id) do nothing;

-- 4b · the standings the h2h arm would have written.
--
-- Scored by social_challenge_score over [starts_at, ends_at] — the LEGACY arm, which is the arm
-- that actually settled these races. Using the roster arm here would score them by an expression
-- that was not in play when the winner was chosen, and could disagree with the winner_id sitting
-- beside it. The rank and percentile expressions are copied verbatim from 0145's h2h arm.
--
-- EXCEPT FOR 'grade', which must not go through social_challenge_score at all: that function has
-- no grade arm and would fall through to its `else`, summing check_ins.xp_earned and recording a
-- student's XP as their mark. In practice this branch cannot be reached — a grade duel has had a
-- roster since 0150 and settles through the roster arm with standings written — but a silent
-- wrong number is not an acceptable shape for an unreachable branch to have.
update challenge_participants p
   set final_value = case
         when sc.race_metric = 'grade' then coalesce(challenge_racer_score(sc.id, p.user_id), 0)
         else coalesce(social_challenge_score(p.user_id, sc.race_metric, sc.starts_at, sc.ends_at), 0)
       end,
       final_rank = case
         when sc.winner_id is null then 1
         when p.user_id = sc.winner_id then 1
         else 2 end,
       final_percentile = case
         when sc.winner_id is null then 1.0
         when p.user_id = sc.winner_id then 1.0
         else 0.0 end
  from social_challenges sc
 where sc.id = p.challenge_id
   and sc.mode = 'h2h'
   and sc.status = 'completed'
   and p.final_rank is null;

-- 4c · the reward receipt, recovered from the ledger that moved.
--
-- reward_payload is what the reveal and the History row render. The real payload was built by
-- grant_reward and dropped on the floor — but every figure in it is recoverable, because
-- grant_reward writes BOTH halves of a payout inside ONE transaction:
--
--     perform economy_move_embers(p_user, v_embers, 'challenge_win', p_ref);  -- ember_ledger.ref_id = the challenge
--     insert into loot_boxes (...) returning id into v_box_id;                -- no challenge reference at all
--
--   · THE EMBERS are exact and unambiguous: `ref_id` IS the challenge id.
--
--   · THE BOX carries no reference to the challenge that minted it — `provenance` is the constant
--     string 'Challenge reward' — so it looks unrecoverable. It is not. Both statements run in one
--     transaction and `now()` is fixed for a transaction's whole life, so the box's `created_at` is
--     BYTE-IDENTICAL to the ledger row's. That is TRANSACTION IDENTITY, not proximity: this is not
--     "the nearest box in time", it is "the row written by the same now()".
--
--     Checked against prod before relying on it — across the whole loot_boxes table there is not
--     one (user_id, created_at) pair carrying two challenge boxes, so the join cannot be ambiguous:
--
--         select count(*) from (select user_id, created_at from loot_boxes
--                where obtained_via = 'challenge' group by 1, 2 having count(*) > 1) s;   -- 0
--
--     The `having count(*) = 1` guard below keeps that a fact rather than an assumption: if a
--     future double-mint ever does make it ambiguous, the box drops out of the payload instead of a
--     wrong id being handed to the reveal's Open button.
--
--     A LOSER correctly recovers no box. The completion band mints none — grant_reward leaves
--     v_box null below 'casual' — so zero matches there is the right answer, not a miss.
--
--   · `band` is read back by inverting economy_config's own reward_bands table, so it is the
--     config's own number rather than a guess. `significance` is genuinely gone: it is a computed
--     float that was never stored anywhere else, and it is presentational only.
--
-- `recovered: true` marks the payload as reconstructed, so a later reader can tell it from one
-- written live. Nothing is written where nothing was paid: the ember total must be positive, so a
-- duel that predates the economy trigger keeps a null payload rather than gaining a fabricated one.
--
-- Written as correlated scalar subqueries rather than a LATERAL, deliberately: an UPDATE's target
-- relation is NOT a FROM item, so a LATERAL in the FROM list cannot reference `p` — it would fail
-- with "invalid reference to FROM-clause entry". A correlated subquery in SET/WHERE can, and this
-- runs once over a handful of rows, so the repeated aggregate costs nothing worth optimising.
update challenge_participants p
   set reward_payload = jsonb_build_object(
         'embers', (
           select coalesce(sum(b.delta), 0)::int
           from ember_ledger b
           where b.ref_id = p.challenge_id and b.user_id = p.user_id and b.delta > 0),
         -- (array_agg(...))[1] rather than max(): there is no max(uuid) in Postgres, and using
         -- max() on the key while the id needed something else would leave the two halves of one
         -- box picked by two different rules. `having count(*) = 1` is what makes taking element 1
         -- safe — the aggregate returns no row at all unless the match is unique, and the whole
         -- scalar subquery is then null.
         'box', (
           select (array_agg(lb.box_key))[1] from loot_boxes lb
           where lb.user_id = p.user_id and lb.obtained_via = 'challenge'
             and lb.created_at in (
               select b.created_at from ember_ledger b
               where b.ref_id = p.challenge_id and b.user_id = p.user_id and b.delta > 0)
           having count(*) = 1),
         'box_id', (
           select (array_agg(lb.id))[1] from loot_boxes lb
           where lb.user_id = p.user_id and lb.obtained_via = 'challenge'
             and lb.created_at in (
               select b.created_at from ember_ledger b
               where b.ref_id = p.challenge_id and b.user_id = p.user_id and b.delta > 0)
           having count(*) = 1),
         'badge', null,
         'band', (
           select e.k
           from jsonb_each_text((select value from economy_config where key = 'reward_bands')) as e(k, v)
           where e.k <> 'unverified'
             and e.v::int = (
               select coalesce(sum(b.delta), 0)::int from ember_ledger b
               where b.ref_id = p.challenge_id and b.user_id = p.user_id and b.delta > 0)
           limit 1),
         'recovered', true)
  from social_challenges sc
 where sc.id = p.challenge_id
   and sc.mode = 'h2h'
   and sc.status = 'completed'
   and p.reward_payload is null
   and (
     select coalesce(sum(b.delta), 0)
     from ember_ledger b
     where b.ref_id = p.challenge_id and b.user_id = p.user_id and b.delta > 0) > 0;

-- 4d · an EMPTY reveal is stamped seen; a real one is left to fire.
--
-- get_my_unseen_challenge_rewards returns every settled race where `reward_seen_at is null and
-- final_rank is not null`, and the watcher runs it on every foreground. 4b just gave a final_rank
-- to every duel these accounts ever finished, so without a rule here the next app open would queue
-- a reveal for each of them at once.
--
-- THE RULE IS THE PAYLOAD, NOT THE DATE. A cutoff like "older than three days" would be a number
-- picked to fit today's data. What actually decides whether a reveal is worth firing is whether
-- there is anything in it:
--
--   · NO recovered payload → nothing was paid (69cffba0 is exactly this: a draw that settled
--     before 0122's draw branch existed, 0 embers, 0 XP). A reveal there is a victory screen with
--     no reward on it, which is worse than no reveal. Stamped seen.
--
--   · A REAL recovered payload → embers, and for a winner an actual box that is STILL UNOPENED.
--     This is the reveal Noah never got — the one §1 is about. It is a day old, not a month, the
--     crate is sitting unopened in the inventory, and the whole point of the fix is that winning
--     a duel pays and says so. Left unseen, so it fires on the next foreground.
--
-- On prod today that lands as: bc495f93 ("Test") and bb8c80f2 ("Yo") fire for @brikmnn — 20 embers
-- and an unopened Ignition Crate each — and 69cffba0 is stamped. 85e9c268 is untouched either way;
-- it already carries reward_seen_at from August.
--
-- The queue presents one at a time and holds the reveal floor between them (0137's watcher), so
-- two is a sequence, not a stack.
update challenge_participants p
   set reward_seen_at = now()
  from social_challenges sc
 where sc.id = p.challenge_id
   and sc.mode = 'h2h'
   and sc.status = 'completed'
   and p.reward_seen_at is null
   and p.reward_payload is null;

-- ─────────────────────────── 5 · self-assertion ───────────────────────────
--
-- MIGRATIONS.md asks that a migration ship something a later session can re-run to prove the
-- bodies are actually live. Two claims are worth proving, and neither is "a function by that name
-- exists".

do $assert$
declare
  v_bad int;
  v_challenge uuid;
  v_user uuid;
  v_roster numeric;
  v_legacy numeric;
begin
  -- CLAIM 1 — no settled duel is left without standings. This is the exact predicate behind
  -- "No standings were recorded for this one": get_challenge_results filters state = 'accepted'.
  select count(*) into v_bad
  from social_challenges sc
  where sc.mode = 'h2h'
    and sc.status = 'completed'
    and not exists (
      select 1 from challenge_participants p
      where p.challenge_id = sc.id and p.state = 'accepted' and p.final_rank is not null);

  if v_bad > 0 then
    raise exception '0153: % settled duel(s) still have no accepted roster row with a rank. The results screen would still say "No standings were recorded for this one."', v_bad;
  end if;

  -- CLAIM 2 — the arm swap is measurement-neutral. Section 3 moves every live duel from the legacy
  -- scorer to the roster scorer, and that is only safe while 0144's identity holds with a baseline
  -- taken at starts_at. Checked on a real in-flight duel rather than asserted in a comment.
  --
  -- 'grade' is excluded because it is deliberately NOT net of a baseline (0145) and the identity
  -- does not apply to it; a null race_metric is a collective goal and never reaches the h2h arm.
  select p.challenge_id, p.user_id into v_challenge, v_user
  from challenge_participants p
  join social_challenges sc on sc.id = p.challenge_id
  where sc.mode = 'h2h' and sc.status = 'active'
    and sc.race_metric is not null and sc.race_metric <> 'grade'
    and sc.starts_at is not null
  limit 1;

  if v_challenge is null then
    raise notice '0153: no live non-grade duel on this database; the arm-equivalence identity was not exercised.';
    return;
  end if;

  select challenge_racer_score(v_challenge, v_user) into v_roster;
  select social_challenge_score(v_user, sc.race_metric, sc.starts_at, coalesce(sc.ends_at, now()))
    into v_legacy
  from social_challenges sc where sc.id = v_challenge;

  -- Exact, not an epsilon. Both sides are now the same sum over the same rows (0144); a tolerance
  -- here would hide the drift the check exists to catch.
  if v_roster is distinct from v_legacy then
    raise exception '0153: roster and legacy scoring disagree on duel % for % (% vs %). Switching the sweep to the roster arm would change who wins.',
      v_challenge, v_user, v_roster, v_legacy;
  end if;
end;
$assert$;

comment on function create_h2h_challenge(uuid, text, int, uuid, int, text, timestamptz, timestamptz, numeric, text) is
  '0153 — creates a duel AND its two-row roster, for every metric. The roster is not only settlement''s input: it is where the standings, the reward receipt (reward_payload) and the reveal''s fire-once flag live, and a duel without one settles into "No standings were recorded for this one" with its reveal silently discarded.';
