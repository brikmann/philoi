-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- 0167 · A FINISHED GOAL SAYS WHAT IT PAID — the receipt, and a fire-once flag to reveal it by.
--
-- Spec: CODE_PROMPT_goal_reveal_surface.md §1/§1b. Mirrors 0137 (the unseen-rewards inbox) and
-- 0154 (my_reward_payload + mark_challenge_reward_seen), one table over.
--
-- ─────────────────────────── THE HOLE ───────────────────────────
--
-- A personal goal — a Cindy-scoped feat, an honour goal, a one-time target — pays a box and embers
-- through economy_on_challenge_completed the moment `completed_at` is set. That grant has been
-- landing correctly since 0159/0164 and it lands SILENTLY: no rays, no two-step reveal, no "YOUR
-- REWARDS". The user describes a goal, does it, vouches for it, and the crate turns up in the
-- inventory some time later with nothing to mark it.
--
-- None of the three mounted watchers can draw it, and the reason is structural rather than an
-- oversight in any of them:
--
--   · GoalRevealWatcher draws economy_award_goal_day — the DAILY DRIP. A one-time scoped goal does
--     not pay through it.
--   · ChallengeSettlementWatcher draws 0137, which reads `social_challenges`. A personal goal is a
--     row in `challenges`.
--   · RankUpWatcher is rank-ups.
--
-- `challenges` has never carried a grant receipt or a fire-once flag, so there was nothing for a
-- watcher to read. This file adds exactly those two things and a pair of functions to read/stamp
-- them.
--
-- ─────────────────────────── 🔒 GRANT NOTHING NEW, RE-DERIVE NOTHING ───────────────────────────
--
-- economy_on_challenge_completed already calls grant_reward, and 0164 already made that ONE grant,
-- at the final band, ever — the vouch window closes BEFORE `completed_at` is set, so verifiability
-- is settled by the time the trigger reads it. This migration changes `perform grant_reward(...)`
-- to `select grant_reward(...) into v_receipt` and writes that receipt to the row. The argument
-- list, the significance, the band cap and everything downstream are byte-identical to the live
-- prosrc this was restated from. There is no second grant, no delta, no upgrade path — because
-- 0164 deliberately left none to animate.
--
-- The read below cannot pay anybody and the writer only stamps a timestamp; both are
-- `authenticated` only, with `anon` explicitly revoked (P0 minting-RPC discipline, task #151).
-- ══════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────── §1 · the two columns ───────────────────────────

alter table challenges
  add column if not exists reward_payload jsonb,
  add column if not exists reward_seen_at timestamptz;

comment on column challenges.reward_payload is
  '0167 — grant_reward''s own return value, captured by economy_on_challenge_completed at the moment the goal completed: { embers, box, box_id, badge, band, significance } plus the goal''s settled verifiability and tier. The SAME shape challenge_participants.reward_payload carries (0118/0154), so one RewardRow builder parses both. Written by the trigger only; nothing else may set it.';
comment on column challenges.reward_seen_at is
  '0167 — the fire-once budget for the completion reveal. Null means owed; mark_goal_reward_seen stamps it. Server-side rather than an AsyncStorage set so a celebrated goal survives a reinstall and cannot re-fire on a second device.';

-- 🔴 EVERY GOAL FINISHED BEFORE THIS FILE IS ALREADY SEEN.
--
-- `reward_seen_at` arrives null on every existing row, and the inbox's whole predicate is "not
-- null completed_at, null reward_seen_at". Without this, the first foreground after deploy would
-- queue a reveal for every goal the user has ever completed — for rewards paid weeks ago, with no
-- payload to show, which is the worst possible first impression of a feature whose entire job is
-- to celebrate the thing that JUST happened. `reward_payload is not null` in the read is the
-- second belt on the same braces; this is the one that makes the intent explicit.
update challenges
   set reward_seen_at = now()
 where completed_at is not null
   and reward_seen_at is null;

-- ─────────────────────────── §2 · the trigger captures what it paid ───────────────────────────
--
-- ⚠️ RESTATED FROM PROD'S OWN prosrc, read off the live database rather than reconstructed from
-- 0159/0162's files. TWO changes and nothing else:
--
--   1. `perform grant_reward(...)` becomes `select ... into v_receipt` — same call, same nine
--      arguments, the return value kept instead of discarded;
--   2. one UPDATE writing that receipt onto the row that just completed.
--
-- 🔒 WHY THE NESTED UPDATE CANNOT LOOP. The trigger is `AFTER UPDATE OF completed_at`, and a
-- column-scoped trigger fires only when its column appears in the UPDATE's SET list. This writes
-- `reward_payload` and nothing else, so `challenges_economy` does not re-enter. Even if it did,
-- the `old.completed_at is not null` guard on the first line returns immediately. Verified against
-- the other two BEFORE UPDATE triggers on this table: `challenges_normalise_unit` is scoped to
-- (type, unit, label) and does not fire either, and `challenges_freeze_retired_goal` only clamps
-- progress/completed_at back to their old values on a retired goal — both of which this UPDATE
-- leaves untouched.
--
-- 🔴 AND WHY THIS COVERS ALL THREE COMPLETION PATHS (§1b) WITHOUT ANY OF THEM KNOWING ABOUT IT.
-- The capture hangs off `completed_at`, which is the one thing every path must set:
--
--   · claim → skip (nobody asked, no proof) → resolve_goal_claim(id,'honor')   → completed_at
--   · claim → two vouches land in-window   → resolve_goal_claim(id,'vouched')  → completed_at
--   · claim → window expires, sweep closes → settle_expired_vouches() → resolve_goal_claim(id,
--     'honor') → completed_at.  ← the one with no client present, and the one most likely to be
--     missed by a capture written into a client-facing RPC instead of into the trigger.
--   · auto goal (steps/Strava/lock-in hours) → log_challenge_progress → completed_at
--
-- All four go through an UPDATE that sets completed_at, so all four capture, and none of them
-- touches reward_seen_at — which is what makes the reveal survive the app being shut. Asserted at
-- the bottom against the live trigger definition, because a trigger narrowed to a different column
-- later would silently take three of those four paths back to nothing.
create or replace function economy_on_challenge_completed()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_cfg jsonb := (select value from economy_config where key = 'tier_payout');
  v_sig numeric;
  v_cap text;
  v_receipt jsonb;
begin
  if new.completed_at is null or old.completed_at is not null then
    return new;
  end if;

  -- 0162 — a goal minted BY a campfire challenge is that challenge's counter, not a second prize.
  -- evaluate_pass_achievements still runs: pass progress is a record of what they did, and they
  -- did do it.
  if new.challenge_source_id is not null then
    perform evaluate_pass_achievements(new.user_id);
    return new;
  end if;

  -- WAS A LITERAL 1.0 — see 0159's header. That constant is what made every completed goal an
  -- Ignition Crate, and it is also the reason `uncommon` is pinned at significance 1.0 in
  -- tier_payout: an unscoped goal resolves to exactly the number that was hard-coded here, so
  -- nothing in flight changes what it pays.
  v_sig := coalesce((v_cfg -> coalesce(new.difficulty_tier, '') ->> 'significance')::numeric, 1.0);
  v_cap := goal_paid_band(new.difficulty_tier, new.verifiability);

  -- 0167 — THE RETURN VALUE IS KEPT. Identical call, identical arguments, `perform` → `select into`.
  select grant_reward(
    new.user_id, 'friend_h2h', v_sig,
    case when new.period = 'week' then 7 else 1 end,
    1, 0.0, true, new.id,
    v_cap
  ) into v_receipt;

  -- 0167 — the receipt, plus the two facts the reveal needs that grant_reward has no way to know:
  -- WHICH LEVEL the goal settled at, and what tier it was scoped to. `band` inside v_receipt is
  -- already the band actually paid (grant_reward applies v_cap before returning), so the reveal
  -- reads the honest figure without re-pricing anything. reward_seen_at is deliberately left null —
  -- that is the whole point of the file.
  update challenges
     set reward_payload = coalesce(v_receipt, '{}'::jsonb)
                          || jsonb_build_object(
                               'verifiability', new.verifiability,
                               'tier', new.difficulty_tier,
                               'max_band', v_cap
                             )
   where id = new.id;

  perform evaluate_pass_achievements(new.user_id);
  return new;
end;
$function$;

comment on function economy_on_challenge_completed() is
  '0167 — unchanged in what it pays (one grant_reward call, same nine arguments, 0164''s settled band); it now KEEPS the receipt on challenges.reward_payload so the completion can be revealed. The capture hangs off completed_at, so the vouch sweep, the in-window resolve, the immediate skip and an auto completion all record it without any of them knowing this exists.';

-- ─────────────────────────── §3 · the fire-once inbox ───────────────────────────
--
-- security definer for 0137's reason: a goal row is not otherwise cheaply readable WITH its
-- receipt, and the client needs one round trip that answers "anything to celebrate?" rather than N
-- reads. Empty set is the common, non-error answer.
--
-- ⚠️ OUT NAMES DELIBERATELY DO NOT COLLIDE with the columns the body selects — `goal_label` not
-- `label`, `settled_at` not `completed_at`, `verified_as` not `verifiability`. A RETURNS TABLE
-- column shadows a same-named table column inside the body, which is the failure that killed
-- get_challenge_watch from 0081 to 0099 and the one 0154's header re-states. Non-colliding names
-- mean a later edit cannot reintroduce it by adding one unqualified reference.
--
-- ─────────────────────────── WHICH COMPLETIONS ARE THIS WATCHER'S ───────────────────────────
--
-- 🔴 NOT EVERY COMPLETED GOAL, and getting this wrong is a reveal on top of a reveal every single
-- day. `economy_on_challenge_completed` fires for a daily 10,000-step goal exactly as it does for
-- a scoped feat — but a DAILY goal is also the daily drip, which economy_award_goal_day pays and
-- GoalRevealWatcher already draws. Returning it here would give a user two full-screen
-- celebrations for one walk, forever.
--
-- So the split is by what KIND of completion it is, not by what paid:
--
--   · `period = 'once'`        — a one-time target. It completes once and never resets, so there is
--                                no drip to collide with. This watcher's.
--   · `claimed_at is not null` — the honour/vouch path (0164), whatever its period. It completes
--                                through resolve_goal_claim, which no client is watching and which
--                                never calls economy_award_goal_day, so the drip cannot draw it and
--                                this is the ONLY surface that can. This watcher's.
--   · everything else          — the recurring daily/weekly drip. GoalRevealWatcher's, untouched.
--
-- A campfire-minted goal (challenge_source_id) never reaches here at all: the trigger returns
-- before granting, so it has no payload, and `reward_payload is not null` excludes it.
drop function if exists get_unseen_goal_rewards();

create function get_unseen_goal_rewards()
returns table (
  goal_id uuid,
  goal_label text,
  goal_type text,
  tier text,
  verified_as text,
  band text,
  -- What the SAME tier would have paid at the full level, and the crate that band names, so the
  -- reveal can print the honest line mock 176 §4 asks for — "unverified pays one tier down; a clip
  -- or a vouch unlocks the full Vessel of Hestia" — without the client owning a tier→band→box
  -- table. `goal_paid_band` is the same stable helper the trigger used, and asking it here is a
  -- presentation question rather than a re-pricing: the grant already happened, and nothing in this
  -- function can change it.
  full_band text,
  full_box text,
  settled_at timestamptz,
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
    c.id,
    c.label,
    c.type,
    c.difficulty_tier,
    c.verifiability,
    c.reward_payload ->> 'band',
    goal_paid_band(c.difficulty_tier, 'vouched'),
    -- ⚠️ THE BAND→CRATE MAPPING, RESTATED. It lives inside grant_reward and nowhere addressable,
    -- and this is a THIRD copy of it, which is worth being uncomfortable about. It is here rather
    -- than in the client for the reason rewardChips already gives — "hephaestus" is a database
    -- value and a screen must never print one — and rather than through
    -- preview_challenge_reward(), which raises on an unknown tier and would turn a foreground poll
    -- into an error for any goal scoped before the config knew its tier. Presentation only: this
    -- names a crate that was NOT paid, on a row whose payment already happened.
    case goal_paid_band(c.difficulty_tier, 'vouched')
      when 'apex'       then 'promethean'
      when 'elite'      then 'hephaestus'
      when 'impressive' then 'hestia'
      when 'notable'    then 'furnace'
      when 'casual'     then 'ignition'
      else null
    end,
    c.completed_at,
    c.reward_payload
  from challenges c
  where c.user_id = auth.uid()
    and c.completed_at is not null
    and c.reward_seen_at is null
    -- No receipt, nothing to reveal. Covers a campfire-minted goal (granted nothing here by
    -- design) and anything completed before this migration, which the backfill above stamped.
    and c.reward_payload is not null
    and (c.period = 'once' or c.claimed_at is not null)
  order by c.completed_at asc;
end;
$unseen$;

revoke all on function get_unseen_goal_rewards() from public;
revoke all on function get_unseen_goal_rewards() from anon;
grant execute on function get_unseen_goal_rewards() to authenticated;

comment on function get_unseen_goal_rewards() is
  '0167 — personal goals this user finished and has not been shown, with the receipt the trigger captured. Read-only; it cannot pay. Scoped to one-time and claimed goals so it cannot collide with the daily drip GoalRevealWatcher already draws.';

-- ─────────────────────────── §3 · the fire-once stamp ───────────────────────────
--
-- Same shape as mark_challenge_reward_seen (0154), including the `reward_seen_at is null` guard
-- that makes it idempotent: a second call on an already-seen goal updates nothing rather than
-- moving the timestamp forward.
create or replace function mark_goal_reward_seen(p_goal_id uuid)
returns void
language sql
security definer
set search_path = public
as $function$
  update challenges
     set reward_seen_at = now()
   where id = p_goal_id
     and user_id = auth.uid()
     and reward_seen_at is null;
$function$;

revoke all on function mark_goal_reward_seen(uuid) from public;
revoke all on function mark_goal_reward_seen(uuid) from anon;
grant execute on function mark_goal_reward_seen(uuid) to authenticated;

comment on function mark_goal_reward_seen(uuid) is
  '0167 — stamps the caller''s own goal as revealed. The only thing it can write is a timestamp, and only on a row it owns. Idempotent.';

-- The watcher runs the inbox on every app foreground, so the predicate has to be cheap. Partial on
-- the unseen set for 0137's reason: it shrinks to nothing for an established user, so the index
-- stays tiny however many goals they have finished.
create index if not exists challenges_unseen_reward_idx
  on challenges (user_id)
  where reward_seen_at is null and completed_at is not null;

-- ─────────────────────────── asserted at deploy ───────────────────────────
do $assert$
declare
  v_cols int;
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'economy_on_challenge_completed';

  -- 1 · 🔴 THE CAPTURE ACTUALLY SURVIVED THE RESTATEMENT. A restated body is exactly where a
  --     changed line quietly goes missing, and this one is the whole file: without it every
  --     completion is still silent and the inbox returns an empty set forever.
  if v_def is null or v_def not like '%into v_receipt%' or v_def not like '%set reward_payload%' then
    raise exception '0167: economy_on_challenge_completed is not capturing the receipt.';
  end if;

  -- 2 · 🔒 AND IT STILL PAYS EXACTLY ONCE, at the band 0164 settled. One grant_reward call with
  --     v_cap as its ceiling; a second one appearing in this body would be the delta-grant 0164's
  --     header spent forty lines refusing.
  if (select count(*) from regexp_matches(v_def, 'grant_reward\(', 'g')) <> 1 then
    raise exception '0167: economy_on_challenge_completed no longer calls grant_reward exactly once.';
  end if;
  if v_def not like '%v_cap%' then
    raise exception '0167: the band ceiling is gone from economy_on_challenge_completed.';
  end if;

  -- 3 · 🔴 THE TRIGGER STILL FIRES ON completed_at. Every one of §1b's four paths reaches the
  --     capture through this column and nothing else — narrow the trigger and the sweep, the
  --     in-window resolve and the auto completion all go silent again with no error anywhere.
  if not exists (
    select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
     where c.relname = 'challenges' and t.tgname = 'challenges_economy'
       and pg_get_triggerdef(t.oid) like '%AFTER UPDATE OF completed_at%'
  ) then
    raise exception '0167: challenges_economy is not an AFTER UPDATE OF completed_at trigger — the capture would miss the server-side completion paths.';
  end if;

  -- 4 · the sweep still resolves through the same door, so it captures too. settle_expired_vouches
  --     is the path with no client present and the one §1b singles out as most likely to be missed.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'settle_expired_vouches'
       and pg_get_functiondef(p.oid) like '%resolve_goal_claim%'
  ) then
    raise exception '0167: settle_expired_vouches no longer resolves through resolve_goal_claim — the expiry path would never capture a payload.';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'resolve_goal_claim'
       and pg_get_functiondef(p.oid) like '%completed_at = coalesce(claimed_at, now())%'
  ) then
    raise exception '0167: resolve_goal_claim no longer sets completed_at — nothing would fire the capture.';
  end if;

  -- 5 · the read returns every column the reveal needs, and there is exactly one of each function.
  select count(*) into v_cols
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join lateral unnest(p.proargnames) as a(name)
  where n.nspname = 'public' and p.proname = 'get_unseen_goal_rewards'
    and a.name in ('goal_id', 'goal_label', 'band', 'full_band', 'full_box', 'verified_as', 'payload');
  if v_cols <> 7 then
    raise exception '0167: get_unseen_goal_rewards is missing reveal columns (found % of 7).', v_cols;
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname in ('get_unseen_goal_rewards', 'mark_goal_reward_seen')) <> 2 then
    raise exception '0167: an overload of one of the new functions is standing (MIGRATIONS.md''s overload trap).';
  end if;

  -- 6 · 🔒 anon cannot call either one. A read that returns a receipt and a writer that stamps a
  --     timestamp both look harmless; the discipline is that neither is reachable without a
  --     session, so neither can be probed for whether a given goal id exists.
  if has_function_privilege('anon', 'public.get_unseen_goal_rewards()', 'execute')
     or has_function_privilege('anon', 'public.mark_goal_reward_seen(uuid)', 'execute') then
    raise exception '0167: anon can execute one of the new goal-reward functions.';
  end if;
  if not has_function_privilege('authenticated', 'public.get_unseen_goal_rewards()', 'execute')
     or not has_function_privilege('authenticated', 'public.mark_goal_reward_seen(uuid)', 'execute') then
    raise exception '0167: authenticated cannot execute one of the new goal-reward functions.';
  end if;

  -- 7 · no goal finished before today is owed a reveal. The backfill is what stops the first
  --     foreground after deploy queueing a celebration for every goal in the user's history.
  if exists (select 1 from challenges where completed_at is not null and reward_seen_at is null) then
    raise exception '0167: a pre-existing completed goal was left unseen — the backfill did not take.';
  end if;
end;
$assert$;
