-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- 0179 · A RUNG IS A MOMENT TOO.
--
-- Spec: CODE_PROMPT_relic_reveal_watermark.md. The second reveal inbox on relics — 0176 gave the
-- FIRST unlock a moment and stopped there. Climbing α → β → γ → δ → Ω after that grants silently:
-- the tile's glow changes colour in the Trophy Hall, a bell row lands, and nothing else happens.
--
-- 🐛 WHAT THAT COSTS. The ladders are explicitly a "running progression milestone" (§4a-2), and the
-- rungs after the first are the ones that take real work — Socrates' Scroll rung α is 10 hours,
-- rung δ is 100. So the app celebrates the cheapest rung on every ladder and says nothing for the
-- four expensive ones. 0119 §5's own comment claims "rungs 2+ — a bell row of its own", and that is
-- true: economy_apply_relic_ladder does call notify_event on an upgrade. A bell row is not a
-- reveal. It is the same half-fix 0176's header dismantles — the push half was already correct
-- there too, and the half that was missing was the durable one.
--
-- 🔴 IT HAS ALREADY HAPPENED TO SOMEBODY, which is what moves this off the backlog. Measured
-- against prod while writing this: one user crossed Socrates' Scroll rung β — 25 hours of study —
-- at 2026-09-09 23:43Z, hours before this file existed. Their relic's `reveal_seen_at` was spent on
-- 09-08 by 0176's rung-α reveal, so nothing was owed and nothing fired. Twenty-five hours of study
-- and the app's entire response was a tile changing from green to blue. §1's carve-out below exists
-- to pay that one moment out.
--
-- ─────────────────────────────── WHY A WATERMARK, NOT A QUEUE ───────────────────────────────
--
-- 0176's inbox is a nullable timestamp on the row that was granted: a relic is granted once, so one
-- flag spends one reveal. A rung has no row of its own. relic_progress carries a single `tier` that
-- is overwritten in place, so there is nothing to hang five flags off, and a table of queued rung
-- events would have to be written by the same trigger-driven evaluator that runs during backfills.
--
-- Instead: ONE INTEGER, `revealed_tier`, holding the highest rung the user has actually been SHOWN.
-- The inbox is then a comparison — `tier > revealed_tier` — and three properties fall out of that
-- shape rather than having to be enforced:
--
--   · MULTI-RUNG JUMPS REVEAL ONLY THE TOP RUNG, for free. A user who crosses β, γ and δ in one
--     lock-in has one relic_progress row reading tier 4, so the comparison yields ONE row naming
--     rung δ. An event queue would have had to remember to collapse three rows into one; a
--     watermark cannot express the un-collapsed state in the first place.
--   · IT CANNOT DOUBLE-FIRE. Spending the reveal moves the watermark to the rung shown, and a rung
--     at or under the watermark is not in the result. Two devices reading the same inbox both stamp
--     to the same value; greatest() makes the second a no-op rather than a regression.
--   · IT SURVIVES A REINSTALL. Server-side and auth.uid()-scoped, for 0176's reasons.
--
-- ─────────────────────────── SEPARATE RPC, NOT A WIDER get_unseen_relic_unlocks ───────────────
--
-- The obvious economy is to have 0176's inbox return rung-ups too — one round trip, one function.
-- It is the wrong trade, and the reason is the shipped client.
--
-- A build carrying 0176's watcher but not this release would receive the rung rows, render them
-- under 0176's "RELIC UNLOCKED" eyebrow, and dismiss them through mark_relic_unlock_seen — which
-- stamps cosmetics_owned and, on that older build, would not advance any watermark. The rung would
-- still be owed on the next foreground, and the one after that: an unbreakable reveal loop on a
-- build that cannot be repaired by an OTA, since runtimeVersion is still pinned to sdkVersion. A
-- NEW function is invisible to every client that does not call it, which is the only version of
-- this that is safe to deploy ahead of a build. It costs one more RPC on foreground, against a
-- query whose answer is almost always zero rows.
--
-- 🔒 PRESENTATION ONLY. NOTHING HERE GRANTS ANYTHING. get_unseen_relic_rungs is a pure read over
-- relic_progress/relic_ladders, and mark_relic_rung_seen can only raise an integer toward a rung
-- the user already holds. A reveal that granted on presentation would mint a rung for looking at
-- one.
-- ══════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────── §1 · The watermark ───────────────────────────
--
-- `not null default 0` so economy_apply_relic_ladder's existing upsert keeps working untouched — it
-- names its columns, so a new one with a default is simply absent from it and lands at 0.
alter table relic_progress
  add column if not exists revealed_tier int not null default 0;

comment on column relic_progress.revealed_tier is
  '0179 — the highest rung of this ladder the user has been SHOWN a reveal for. 0 = none. The fire-once budget for rung reveals: get_unseen_relic_rungs returns rows where tier > revealed_tier, and mark_relic_rung_seen (or 0176''s mark_relic_unlock_seen, for the first rung) raises it. Server-side rather than AsyncStorage so a celebrated rung survives a reinstall and cannot re-fire on a second device.';

-- WHEN THE RUNG WAS CROSSED, which nothing has recorded until now.
--
-- `updated_at` is written on EVERY evaluation — the whole point of 0119's design is that `value`
-- moves without a rung falling — so it answers "when did this ladder last move", not "when did this
-- rung fall". Measured: all four rows holding a rung on prod show an updated_at from today, and
-- only one of them crossed anything today. Using it as the reveal's earned-at would therefore
-- report every rung as seconds old, which is precisely wrong for the case an inbox exists for: a
-- rung crossed by a Strava webhook three days into a phone being face-down.
--
-- Nullable, because for every rung already held it is genuinely unknown, and inventing a timestamp
-- would be worse than admitting that. The read coalesces to updated_at for those, and says so.
alter table relic_progress
  add column if not exists tier_reached_at timestamptz;

comment on column relic_progress.tier_reached_at is
  '0179 — when `tier` last ROSE, as opposed to updated_at, which moves on every re-evaluation. Null for rungs crossed before 0179 deployed; get_unseen_relic_rungs coalesces to updated_at for those.';

-- 🔴 THE BACKFILL IS THE LOAD-BEARING STATEMENT, exactly as it was in 0176 §1.
--
-- The column arrives at 0 on every existing row, so without this the first foreground after deploy
-- offers a rank-up reveal for every rung every user already holds — including all of 0168's
-- backfilled rungs, which is the push-blast judgement 0168 made and 0176 §1 already had to defend
-- once. `revealed_tier = tier` says everything already climbed is already spent, which is true by
-- the only definition that matters: nobody is owed a celebration for a rung they crossed in June.
--
-- 🔴 EXCEPT ONE FRESHLY-CROSSED RUNG, and as in 0176 the exception is the point rather than a
-- hedge. A rung crossed in the window between the climb and this reveal existing has never been
-- shown anything at all — not shown and forgotten, never shown — and stamping it would silence the
-- exact case this migration is for.
--
-- `tier - 1`, NOT 1, and that is the whole design restated in the backfill: it leaves only the TOP
-- newly-crossed rung owed. A hypothetical row sitting at δ would reveal δ alone rather than
-- replaying β and γ on the way up.
--
-- MEASURED BEFORE CHOOSING THE RULE, because `updated_at > now() - 24h` is true of every rung-
-- holding row on prod and would be a blunt instrument if `tier >= 2` did not carry it:
--   · rows at tier >= 2, all time ........ 1
--   · of those, updated within 24h ....... 1   ← the Socrates' Scroll β in the header
--   · rows at tier >= 1 .................. 4   ← the other three are rung α, whose reveal is
--                                               0176's and whose budget is already spent; §3's
--                                               `revealed_tier >= 1` guard excludes them anyway.
-- So the carve-out costs exactly one reveal to one user, and it is the one reveal this migration
-- exists to produce. It also makes the feature verifiable on a device without waiting to cross a
-- fresh threshold: the first foreground after this deploys plays that rung-β rank-up. That is the
-- acceptance test.
update relic_progress rp
   set revealed_tier = case
     when rp.tier >= 2 and rp.updated_at > now() - interval '24 hours' then rp.tier - 1
     else rp.tier
   end;

-- ─────────────────────────── §2 · The first rung is still 0176's ───────────────────────────
--
-- 🔴 THE HANDOFF BETWEEN THE TWO INBOXES, and getting it wrong breaks one or the other.
--
-- 0176's unlock reveal already names the rung the ladder stands at NOW, not the rung it stood at on
-- grant — that is its §2 comment, and it is what makes a 0 → γ jump reveal γ rather than α. So when
-- that reveal is spent, the rung it displayed is spent with it, and the watermark has to move to
-- match or the rung inbox will offer the very same rung again on the next foreground.
--
-- This is the only reason mark_relic_unlock_seen is touched. The signature is unchanged
-- (text → void), so no client, type or grant moves, and a shipped 0176 build gets the watermark
-- advanced for free by calling the function it already calls — which is the other half of what
-- makes deploying this ahead of a build safe.
drop function if exists mark_relic_unlock_seen(text);

create function mark_relic_unlock_seen(p_relic_key text)
returns void
language sql
security definer
set search_path = public
as $seen$
  -- 0176's statement, unchanged, including the `is null` guard that makes a double-dismiss free.
  update cosmetics_owned co
     set reveal_seen_at = now()
   where co.user_id = auth.uid()
     and co.cosmetic_key = p_relic_key
     and co.reveal_seen_at is null;

  -- 0179's addition. greatest(), not assignment: this must never LOWER a watermark, and it can be
  -- reached with a stale tier — the unlock reveal is dismissed off a payload the client fetched at
  -- foreground, while a check-in landing in between may have raised the ladder further. Taking the
  -- larger leaves that newer rung owed rather than silently swallowing it.
  update relic_progress rp
     set revealed_tier = greatest(rp.revealed_tier, rp.tier)
   where rp.user_id = auth.uid()
     and rp.relic_key = p_relic_key;
$seen$;

revoke all on function mark_relic_unlock_seen(text) from public;
revoke all on function mark_relic_unlock_seen(text) from anon;
grant execute on function mark_relic_unlock_seen(text) to authenticated;

comment on function mark_relic_unlock_seen(text) is
  '0179 — 0176''s stamp, plus the rung watermark. The unlock reveal names the CURRENT rung, so spending it spends that rung too; without this second statement the rung inbox would immediately re-offer the rung the unlock reveal had just shown.';

-- ─────────────────────────── §3 · The rung inbox ───────────────────────────
--
-- ⚠️ RETURNS TABLE COLUMN SHADOWING (0176 §2, and the standing note). `relic_key`, `family`,
-- `unit`, `tier` and `value` are all real columns on relic_progress or relic_ladders, and a RETURNS
-- TABLE name shadows the table column of the same name inside the body — silently, yielding an
-- empty result rather than an error. Every output column is `out_`-prefixed so it cannot collide,
-- and every reference in the body is alias-qualified regardless.
--
-- THE SHAPE IS 0176'S, DELIBERATELY, plus `out_prev_rung`. The client feeds both inboxes into one
-- queue and one screen, and a payload that differed in shape would fork that screen's props for no
-- reason — the two events differ in what they MEAN, not in what has to be drawn.
--
--   · out_provenance is always null here. It is the `p_why` sentence economy_grant_relic was passed,
--     and a rung 2+ never goes through that function. Returned rather than dropped so the payloads
--     stay structurally identical; the client already prefers the ladder data over provenance for
--     any relic that rides a ladder, and every row here rides one.
--   · out_is_capstone is always false. The Crown of Olympus rides no ladder and has no
--     relic_progress row at all, so it can only ever arrive through 0176's inbox.
drop function if exists get_unseen_relic_rungs();

create function get_unseen_relic_rungs()
returns table (
  out_relic_key text,
  out_name text,
  out_provenance text,
  out_earned_at timestamptz,
  out_family text,
  out_rung int,
  out_prev_rung int,
  out_rung_threshold numeric,
  out_unit text,
  out_is_capstone boolean
)
language sql
stable
security definer
set search_path = public
as $rungs$
  select
    rp.relic_key,
    relic_display_name(rp.relic_key),
    null::text,
    -- Null only for a rung crossed before 0179 existed, and §1's backfill spent every one of those
    -- but the carve-out — whose updated_at genuinely IS its crossing. See the column comment.
    coalesce(rp.tier_reached_at, rp.updated_at),
    rl.family,
    rp.tier,
    rp.revealed_tier,
    rl.thresholds[rp.tier],
    rl.unit,
    false
  from relic_progress rp
  join relic_ladders rl on rl.relic_key = rp.relic_key
  where rp.user_id = auth.uid()
    -- THE WATERMARK. Everything this migration is about is this one line.
    and rp.tier > rp.revealed_tier
    -- 🔴 RUNGS 2+ ONLY. At revealed_tier 0 the relic's FIRST reveal has not been spent yet and it
    -- belongs to 0176's inbox, which would name the same rung this does. Without this clause a
    -- fresh grant queues in both inboxes and the user watches the identical relic land twice.
    and rp.revealed_tier >= 1
    -- Belt and braces: tier >= 1 implies economy_grant_relic ran, but a rank-up reveal for a relic
    -- the user does not hold would be the app celebrating something absent from the Trophy Hall the
    -- reveal points at. Cheap — cosmetics_owned is keyed on exactly this pair.
    and exists (
      select 1 from cosmetics_owned co
      where co.user_id = rp.user_id and co.cosmetic_key = rp.relic_key
    )
    -- A tier past the end of the ladder cannot be indexed into. Unreachable today, since tier is
    -- written from a loop over these same thresholds — but a retune that SHORTENS a ladder would
    -- strand held rungs above its new length, and thresholds[6] returns NULL rather than raising,
    -- which would reveal a rank-up to nothing at all. Excluded instead of trusted.
    and rp.tier <= array_length(rl.thresholds, 1)
  -- Oldest first, for 0176's reason: two ladders ranked up in one lock-in play in the order they
  -- were actually crossed.
  order by coalesce(rp.tier_reached_at, rp.updated_at) asc
$rungs$;

revoke all on function get_unseen_relic_rungs() from public;
revoke all on function get_unseen_relic_rungs() from anon;
grant execute on function get_unseen_relic_rungs() to authenticated;

comment on function get_unseen_relic_rungs() is
  '0179 — ladder rungs (2+) this user has climbed and never been shown. Pure read, auth.uid()-scoped. One row per relic naming the CURRENT rung, so a multi-rung jump reveals only the top rung. Rung 1 is get_unseen_relic_unlocks'' job (0176).';

-- ─────────────────────────── §4 · Spending the budget ───────────────────────────
--
-- Takes the rung it is spending rather than reading `tier` itself, and that is the important half:
-- the client stamps the rung it actually PLAYED. If a check-in raised the ladder again while the
-- reveal was on screen, `set revealed_tier = tier` would mark the newer rung seen without ever
-- having shown it. greatest() then keeps the column monotonic against a double-dismiss or a second
-- device reading the same inbox.
drop function if exists mark_relic_rung_seen(text, int);

create function mark_relic_rung_seen(p_relic_key text, p_rung int)
returns void
language sql
security definer
set search_path = public
as $seen$
  update relic_progress rp
     set revealed_tier = greatest(rp.revealed_tier, p_rung)
   where rp.user_id = auth.uid()
     and rp.relic_key = p_relic_key
     -- 🔒 CANNOT SKIP AHEAD. Without this clause a malformed or replayed call could stamp
     -- revealed_tier = 5 and silently forfeit every remaining reveal on that ladder. The function
     -- can only ever say "I have seen as far as here", never "consider the rest seen".
     and p_rung <= rp.tier;
$seen$;

revoke all on function mark_relic_rung_seen(text, int) from public;
revoke all on function mark_relic_rung_seen(text, int) from anon;
grant execute on function mark_relic_rung_seen(text, int) to authenticated;

comment on function mark_relic_rung_seen(text, int) is
  '0179 — spends the fire-once budget for one relic rung. auth.uid()-scoped, monotonic, and clamped to the rung actually held, so it cannot skip a reveal forward. Cannot grant.';

-- ─────────────────────────── §5 · The evaluator's half ───────────────────────────
--
-- ⚠️ REBASED ON THE LIVE BODY, per the standing "parallel agents clobber replaced functions" rule.
-- Verified before writing rather than assumed: pg_proc.prosrc for economy_apply_relic_ladder
-- (md5 fe86a4308ab6b8d8e7cad0fb7030d9dc, 2879 chars) diffs clean against 0119 lines 306-373 modulo
-- trailing whitespace, so 0119 IS the live base and nothing has replaced it in the sixty migrations
-- since. Restating this from a later draft would have reverted it.
--
-- THREE CHANGES, and only the first is what this migration is for:
--
--   1. `tier_reached_at` is stamped when — and only when — a rung actually falls. It sits after the
--      `v_tier <= v_prev` early return, which is what makes it mean "the rung rose" rather than
--      "the evaluator ran", and is the entire difference between it and updated_at.
--
--   2. 🔴 THE BACKFILL GUARD. `philoi.suppress_push` is set by 0123's and 0168's re-evaluations and
--      is transaction-scoped, so it is on for exactly the retro sweeps and never for a live
--      check-in — 0176's header establishes this at length: a device write shares no transaction
--      with a migration. Reading it here promotes the flag from "do not send a push" to "this is
--      retro, celebrate nothing", which is what it has always actually meant. 0168 set it precisely
--      BECAUSE those rungs were not moments.
--
--      Both reveal budgets are then spent in the same transaction as the grant, so a re-evaluation
--      cannot leave an owed reveal behind. This is the fix for the bug 0176 §1 had to clean up
--      after the fact — 0168's sweep left rungs that a later inbox would have retro-celebrated, and
--      0176 needed a one-off UPDATE to smother them. The NEXT sweep needs no such cleanup, and gets
--      that by default rather than by its author remembering.
--
--   3. The rung-2+ notify_event deep link moves '/inventory' → '/trophy-hall'. 0176 made exactly
--      this change to economy_grant_relic and could not reach this branch of this function, so the
--      first rung's push has been landing in the Trophy Hall and every rung after it in a grid of
--      flame skins — the same notification pointing at the wrong room, left on the louder half.
--
-- Everything else is 0119's body verbatim, restated because it is one function.
create or replace function economy_apply_relic_ladder(p_user uuid, p_family text, p_value numeric)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ladder relic_ladders;
  v_tier int := 0;
  v_prev int := 0;
  v_i int;
  v_rarity text;
  -- §4a-2's rung glyphs, paired with the Roman numeral the catalog tables use. Colour is rarity,
  -- letter is rung, and they are independent — so a maxed Movement relic reads red + δ while a
  -- maxed Gym relic reads red + Ω, and copy that said only "Mythic" would lose that distinction.
  v_greek text[] := array['α', 'β', 'γ', 'δ', 'Ω'];
  v_roman text[] := array['I', 'II', 'III', 'IV', 'V'];
  v_name text;
  v_threshold text;
  v_rung text;
  -- 0179. See §5 note 2 — on for a retro sweep, off for anything a device did.
  v_retro boolean := coalesce(current_setting('philoi.suppress_push', true), 'off') = 'on';
begin
  select * into v_ladder from relic_ladders where family = p_family;
  if v_ladder.family is null then return 0; end if;

  for v_i in 1 .. array_length(v_ladder.thresholds, 1) loop
    if p_value >= v_ladder.thresholds[v_i] then v_tier := v_i; end if;
  end loop;

  select coalesce(rp.tier, 0) into v_prev
  from relic_progress rp
  where rp.user_id = p_user and rp.relic_key = v_ladder.relic_key;
  v_prev := coalesce(v_prev, 0);

  insert into relic_progress (user_id, relic_key, family, value, tier, updated_at)
  values (p_user, v_ladder.relic_key, p_family, p_value, v_tier, now())
  on conflict (user_id, relic_key) do update
    set value = excluded.value,
        -- greatest(): a rung already reached is never revoked, even if the underlying total
        -- somehow falls (a removed check-in, a deleted workout).
        tier = greatest(relic_progress.tier, excluded.tier),
        updated_at = now();

  if v_tier <= v_prev then return greatest(v_prev, v_tier); end if;

  -- ── 0179 · A RUNG HAS FALLEN. Everything below this line runs only on a genuinely new rung. ──

  -- When it fell. Distinct from the updated_at the upsert above just moved for the third time this
  -- week without a rung being involved.
  update relic_progress rp
     set tier_reached_at = now()
   where rp.user_id = p_user and rp.relic_key = v_ladder.relic_key;

  v_rarity := v_ladder.rarities[v_tier];
  v_name := relic_display_name(v_ladder.relic_key);
  -- Every threshold in the ladder table is a whole number (10,000 lb · 414 km · 100 h), so this
  -- is the integer mask deliberately: 'D99' would render "10,000.00 lb" in a push notification.
  v_threshold := trim(to_char(v_ladder.thresholds[v_tier], 'FM999G999G999'));
  v_rung := format('%s %s', v_roman[v_tier], v_greek[v_tier]);

  if v_prev = 0 then
    perform economy_grant_relic(p_user, v_ladder.relic_key, v_rarity,
      format('Tier %s — %s %s. The ladder has begun.', v_rung, v_threshold, v_ladder.unit));
  else
    perform notify_event(
      array[p_user], 'reward_ready',
      format('%s upgraded', v_name),
      format('Tier %s — %s %s. The relic burns hotter.', v_rung, v_threshold, v_ladder.unit),
      null, null,
      -- 0179: was '/inventory'. Relics live in the Trophy Hall, on the discipline shelf — the only
      -- screen that can show the rung this push is talking about. 0176 fixed the grant path; this
      -- is the same fix on the upgrade path, which is the one that fires more often.
      '/trophy-hall', '{}'::jsonb,
      null, 'rounded',
      jsonb_build_object('relic', v_ladder.relic_key, 'rarity', v_rarity,
                         'tier', v_tier, 'family', p_family)
    );
  end if;

  -- The tile's colour. Applied AFTER the grant so the first rung sets it too.
  update cosmetics_owned
     set rarity_override = v_rarity
   where user_id = p_user and cosmetic_key = v_ladder.relic_key;

  -- 🔴 0179 · A RETRO SWEEP CELEBRATES NOTHING. See §5 note 2. Both budgets are spent here, in the
  -- same transaction as the grant, so no re-evaluation can leave a reveal owed for a rung the user
  -- crossed months ago. A live check-in never has this flag set, so it never reaches this branch.
  if v_retro then
    update relic_progress rp
       set revealed_tier = greatest(rp.revealed_tier, v_tier)
     where rp.user_id = p_user and rp.relic_key = v_ladder.relic_key;

    -- 0176's budget too: a sweep that crosses rung 1 GRANTS the relic, and that grant would
    -- otherwise queue an unlock reveal on the user's next foreground. coalesce() so a stamp that is
    -- already set is not moved forward.
    update cosmetics_owned co
       set reveal_seen_at = coalesce(co.reveal_seen_at, now())
     where co.user_id = p_user and co.cosmetic_key = v_ladder.relic_key;
  end if;

  return v_tier;
end;
$$;

comment on function economy_apply_relic_ladder(uuid, text, numeric) is
  '0179 — 0119''s body plus: tier_reached_at stamped when a rung actually falls, the upgrade push deep-linked to /trophy-hall (0176 did the grant path), and a suppress_push guard that spends both reveal budgets so a retro re-evaluation can never queue a celebration.';
