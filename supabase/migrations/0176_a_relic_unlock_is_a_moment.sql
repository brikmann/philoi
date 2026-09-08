-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- 0176 · A RELIC UNLOCK IS A MOMENT, NOT A SHELF ENTRY.
--
-- Spec: CODE_PROMPT_loop_signoff_meta.md §1. Mirrors 0167 (the goal-completion inbox) and 0137/0154
-- (the challenge one) exactly — a receipt the server already writes, plus a fire-once flag to
-- reveal it by. This is the fifth watcher's inbox, and it is the same shape as the fourth's because
-- the failure is the same shape: something landed while nobody was looking.
--
-- 🐛 WHAT NOAH HIT. He crossed the 10h Study threshold — Socrates' Scroll, the first rung of a
-- discipline ladder — and got NOTHING. No push, no bell, no animation.
--
-- 🔴 THE PUSH HALF WAS ALREADY CORRECT, and saying so is half this migration's value, because the
-- obvious fix (make the live grant notify) would have been a no-op on top of working code and the
-- real gap would have survived it. economy_grant_relic (0120's body, live) calls notify_event
-- unconditionally. `philoi.suppress_push` is set in exactly three places in the whole ledger —
-- 0123's backfill, 0168's re-evaluation, and 0171's reaction guard which sets it back off — and all
-- three are `set local` / `set_config(..., true)`, i.e. TRANSACTION-SCOPED. A check-in or lock-in
-- landing from a device shares no transaction with any of them, so the live path has never been
-- under the suppression. Noah's silence was 0168's BACKFILL claiming his rung first: it re-evaluated
-- every user's discipline hours with pushes off (right for a backfill — nobody wants nine rungs of
-- push at once), the grant returned true there, and by the time he next opened the app the relic was
-- already owned. The moment was not suppressed; it was SPENT. economy_grant_relic returns false for
-- a relic already owned, so nothing was ever going to fire for that one again.
--
-- WHICH IS WHY THE FIX IS AN INBOX AND NOT A NOTIFICATION. A push fires once, into a phone that may
-- be in a pocket, and is gone. What was missing is the durable half: a row saying "this user has a
-- relic they have never been shown", which survives the app being shut, a reinstall and a second
-- device — and which the backfill's own grants can be excluded from by stamping them at deploy.
--
-- 🔒 PRESENTATION ONLY. NOTHING HERE GRANTS ANYTHING. get_unseen_relic_unlocks is a pure read over
-- cosmetics_owned, and mark_relic_unlock_seen can only stamp a timestamp. A reveal that granted on
-- presentation would mint a relic for looking at one.
-- ══════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────── §1 · The fire-once budget ───────────────────────────
--
-- On cosmetics_owned rather than a new table: a relic IS a cosmetic row (economy_grant_relic calls
-- economy_grant_cosmetic), and a side table would need its own insert inside a function three
-- migrations have already replaced. The column is nullable and defaults to null = OWED, so
-- economy_grant_cosmetic keeps working untouched and a new grant queues itself simply by existing.
alter table cosmetics_owned
  add column if not exists reveal_seen_at timestamptz;

comment on column cosmetics_owned.reveal_seen_at is
  '0176 — the fire-once budget for the relic-unlock reveal. Null means owed; mark_relic_unlock_seen stamps it. Server-side rather than AsyncStorage so a celebrated relic survives a reinstall and cannot re-fire on a second device. Read only for relic rows (see get_unseen_relic_unlocks); every other cosmetic already has its own reveal at the point of acquisition.';

-- 🔴 BACKFILL THE HISTORY AS SEEN, and this is the load-bearing statement in the file.
--
-- The column arrives null on ~every cosmetic anyone has ever owned. Without a backfill, the first
-- foreground after deploy queues an unlock reveal for every relic every user has ever earned —
-- including all of 0168's backfilled rungs, which is precisely the "don't spam someone who gained
-- several rungs at once" judgement 0168 made, and which this must not undo one migration later.
-- Noah's 10h Socrates' Scroll (2026-09-06 21:10) is inside the sweep on purpose: that moment is
-- spent, and re-firing it now would be the app celebrating an event from two days ago.
--
-- 🔴 EXCEPT THE LAST 24 HOURS, and the exception is the point rather than a hedge.
--
-- A relic earned in the window between the grant landing and this reveal existing has genuinely
-- never been celebrated — not "celebrated and forgotten", never shown at all — and stamping it
-- would silence the one case this migration is for. Measured against prod before choosing the
-- window: exactly ONE earned relic across all users falls inside 24h — Noah's Pheidippides'
-- Sandals, granted 2026-09-08 02:21:20Z, about an hour before this was written, live (not by any
-- backfill: 0168 ran days earlier) and with its bell row on file, unread. So the carve-out costs
-- one reveal to one user, and it is the exact reveal §1 exists to produce.
--
-- It also makes §1 verifiable on a device without waiting to cross a fresh threshold: the first
-- foreground after this deploys plays Noah's Sandals unlock. That is the acceptance test.
update cosmetics_owned co
   set reveal_seen_at = now()
 where co.reveal_seen_at is null
   and not (
        co.cosmetic_key like 'relic-%'
    and co.source = 'earned'
    and co.acquired_at > now() - interval '24 hours'
   );

-- ─────────────────────────── §2 · The inbox ───────────────────────────
--
-- ⚠️ RETURNS TABLE COLUMN SHADOWING. Every output column here is prefixed so it CANNOT collide with
-- a real column on cosmetics_owned, relic_progress or relic_ladders — `relic_key`, `family`, `tier`,
-- `provenance` and `unit` are all real columns on those tables — and every reference in the body is
-- alias-qualified regardless. A RETURNS TABLE name shadows the table column of the same name inside
-- the body, and the failure mode is a silently empty result rather than an error.
drop function if exists get_unseen_relic_unlocks();

create function get_unseen_relic_unlocks()
returns table (
  out_relic_key text,
  out_name text,
  out_provenance text,
  out_earned_at timestamptz,
  out_family text,
  out_rung int,
  out_rung_threshold numeric,
  out_unit text,
  out_is_capstone boolean
)
language sql
stable
security definer
set search_path = public
as $unseen$
  select
    co.cosmetic_key,
    relic_display_name(co.cosmetic_key),
    co.provenance,
    co.acquired_at,
    rl.family,
    -- The rung the ladder currently stands at, not the one it stood at on grant. If the app was
    -- shut across two rungs the reveal should show where the user actually IS; the threshold below
    -- is read at the same index, so the number and the letter can never disagree.
    rp.tier,
    case
      when rp.tier is not null and rp.tier >= 1 and rp.tier <= array_length(rl.thresholds, 1)
        then rl.thresholds[rp.tier]
    end,
    rl.unit,
    co.cosmetic_key = 'relic-crown-of-olympus'
  from cosmetics_owned co
  -- LEFT, twice: the seven §4a ancient relics (Zeus' Bolt, Atlas' Burden, …) ride no ladder at all
  -- and have no relic_progress row. They reveal on `provenance` alone, which is the sentence
  -- economy_evaluate_relics passed as p_why — "500 hours. The weight of the sky." — and that is
  -- better copy than any threshold line this could synthesise for them.
  left join relic_ladders  rl on rl.relic_key = co.cosmetic_key
  left join relic_progress rp on rp.user_id = co.user_id and rp.relic_key = co.cosmetic_key
  where co.user_id = auth.uid()
    and co.reveal_seen_at is null
    -- RELICS ONLY. Every other cosmetic in this table already had its moment at the point of
    -- acquisition — a box open has the crack screen, a shop buy has the purchase sheet, a forge
    -- output has the strike. Queueing those here would put a second reveal on top of a first.
    and co.cosmetic_key like 'relic-%'
    -- And only ones whose source is `earned`, which excludes a relic that arrived by PURCHASE or
    -- through the Flame Pass — those have their own reveal at the point of sale and must not also
    -- arrive through this.
    --
    -- ⚠️ IT DOES NOT EXCLUDE relic-emberfall, and the tempting comment saying it does would be
    -- false: checked against prod, that row carries source 'earned' with provenance 'Full catalog
    -- grant' (a dev grant), not a pass source. Nothing today writes a relic with any other source,
    -- so this clause is a guard against a future grant path rather than a filter that fires now.
    and co.source = 'earned'
  -- Oldest first, so two relics crossed in one lock-in play in the order they were earned and the
  -- capstone — which can only ever be last — lands last.
  order by co.acquired_at asc
$unseen$;

revoke all on function get_unseen_relic_unlocks() from public;
revoke all on function get_unseen_relic_unlocks() from anon;
grant execute on function get_unseen_relic_unlocks() to authenticated;

comment on function get_unseen_relic_unlocks() is
  '0176 — relics this user owns and has never been shown. Pure read, scoped to auth.uid(). Filtered to earned relic-* rows so no other cosmetic acquires a second reveal.';

-- ─────────────────────────── §3 · Spending the budget ───────────────────────────
--
-- Same shape as mark_goal_reward_seen (0167) and mark_challenge_reward_seen (0154), including the
-- `is null` guard: stamping is idempotent, and a second call from a double-dismiss cannot move a
-- timestamp that is already set.
drop function if exists mark_relic_unlock_seen(text);

create function mark_relic_unlock_seen(p_relic_key text)
returns void
language sql
security definer
set search_path = public
as $seen$
  update cosmetics_owned co
     set reveal_seen_at = now()
   where co.user_id = auth.uid()
     and co.cosmetic_key = p_relic_key
     and co.reveal_seen_at is null;
$seen$;

revoke all on function mark_relic_unlock_seen(text) from public;
revoke all on function mark_relic_unlock_seen(text) from anon;
grant execute on function mark_relic_unlock_seen(text) to authenticated;

comment on function mark_relic_unlock_seen(text) is
  '0176 — spends the fire-once budget for one relic''s unlock reveal. auth.uid()-scoped; cannot un-stamp, cannot grant.';

-- ─────────────────────────── §4 · The push lands on the relic ───────────────────────────
--
-- Rebased on 0120's body (the LIVE one — md5 eb215e6df2194e5b01204d6f72df123e, 582 chars) with one
-- line changed, per the "parallel agents clobber replaced functions" rule: restating this from
-- 0090's older base would silently revert 0120's display-name title back to a flat 'Relic earned'.
--
-- The change: the deep link was '/inventory'. Relics do not live in the inventory grid — they live
-- in the Trophy Hall, on the discipline shelf, which is the screen that can actually show the rung
-- and the ladder the push is talking about. Tapping "Socrates' Scroll — unlocked" and landing in a
-- grid of flame skins is the notification pointing at the wrong room.
create or replace function economy_grant_relic(
  p_user uuid, p_key text, p_rarity text, p_why text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owned boolean;
begin
  select exists (
    select 1 from cosmetics_owned co
    where co.user_id = p_user and co.cosmetic_key = p_key
  ) into v_owned;
  if v_owned then return false; end if;

  perform economy_grant_cosmetic(p_user, p_key, null, p_rarity, 'earned', p_why);

  perform notify_event(
    array[p_user], 'reward_ready',
    relic_display_name(p_key) || ' — unlocked',
    p_why,
    null, null,
    '/trophy-hall', '{}'::jsonb,
    null, 'rounded',
    jsonb_build_object('relic', p_key, 'rarity', p_rarity)
  );
  return true;
end;
$$;

comment on function economy_grant_relic(uuid, text, text, text) is
  '0176 — 0120''s body with the deep link moved from /inventory to /trophy-hall, where relics actually are. Still returns false for a relic already owned, which is what makes economy_evaluate_relics re-runnable and what made Noah''s backfilled 10h rung unrepeatable.';
