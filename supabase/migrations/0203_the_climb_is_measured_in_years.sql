-- 0203 · WS7 — the climb is measured in years
--
-- Two sets of numbers move, both LOCKED by Noah (CODE_PROMPT_ws7_rank_economy_rebalance.md):
--
--   1. `rank_thresholds` — a ~5x lift, steepening toward the apex. Primordial was 124,200 XP,
--      which at the 250 XP/locked-in-hour earn rate is ~497 h. It is now 625,000 XP ~ 2,500 h.
--   2. `relic_ladders` — Socrates' Scroll (study) and Daedalus' Blueprint (deep_work) gain a
--      FIFTH rung at 600 h / mythic. The four rungs below it are repeated verbatim, so nobody
--      who already holds a rung loses it.
--
-- 🔴 THE EARN RATE IS NOT TOUCHED. 250 XP per locked-in hour and the `5 x streak` per check-in
-- both stay exactly where they are. The grind lengthens HERE and only here, so if 2,500 h turns
-- out to be the wrong answer there is one table to re-cut and no XP ledger to re-derive.
--
-- 🔴 NO BACKFILL EXISTS AND NONE IS NEEDED. Rank is DERIVED from score by `rank_tier_for_score`
-- and is never stored on a profile row, so everyone re-maps on their next read. Users WILL
-- visibly drop rank the next time they open the app — a pilot member sitting at Immortal I on
-- 113,200 XP lands in Olympian/Divine. That is the intended effect of a 5x lift, not damage to
-- be papered over with a grandfather clause.
--
-- 🔴 THE `division` COLUMN IS DELIBERATELY UNTOUCHED HERE. WS9 has already flipped the roman
-- numerals so III reads as the top of each tier, and it did that at the DISPLAY layer only: this
-- table still stores division 3 for the CHEAPEST rung in a tier and 1 for the dearest, because
-- `rank_tier_for_score`, `rankOrdinal`, `nextRank` and every last-seen-rank baseline already
-- written to a device depend on that direction. One map in `src/lib/rank-tiers.ts` inverts it.
--
-- So the brief's "make sure the top of each tier is labelled III" is satisfied by leaving these
-- alone, not by renumbering them — re-cutting the XP AND the labels in one pass would quietly
-- tell everyone they are a tier off. That is precisely what `scripts/check-rank-divisions.js`
-- guards, and the guard reads the highest-numbered migration that re-inserts this table, which
-- is now THIS file: "28 rungs across 10 tiers, climbs I -> II -> III with XP rising at every
-- step." It runs as part of `npm run typecheck`.

-- ── 1 · the rank curve ───────────────────────────────────────────────────────────────────────
--
-- Built as one rule rather than 28 hand-picked numbers: each division costs ~9.25% more than the
-- division below it (a constant-ratio climb), rounded to the nearest 100 and then nudged so the
-- three LOCKED anchors land exactly. A constant ratio is the only shape that never decelerates —
-- the absolute cost of a division rises at every single step, and the cost of a whole tier climbs
-- from Bronze's 5,900 to Immortal's 71,500.
--
-- The apex is deliberately NOT on that curve. Immortal's top -> Primordial is a single 350,000 XP
-- step — 1,400 h, more than the entire climb beneath it. Per the locked anchors, Primordial is
-- meant to read as a mountain and not as "one more division".
--
--   hours = cumulative_xp_required / 250, streak bonus ignored (it is ~35 XP on a 7-day streak).

insert into rank_thresholds (rank_index, tier, division, cumulative_xp_required) values
  -- ── the mortal climb ──                        hours     step
  (0,  'bronze',    3, 0),                      --     0        –
  (1,  'bronze',    2, 2800),                   --  11.2    2,800
  (2,  'bronze',    1, 5900),                   --  23.6    3,100
  (3,  'silver',    3, 9300),                   --  37.2    3,400
  (4,  'silver',    2, 13000),                  --  52.0    3,700
  (5,  'silver',    1, 17000),                  --  68.0    4,000
  (6,  'gold',      3, 21400),                  --  85.6    4,400
  (7,  'gold',      2, 26200),                  -- 104.8    4,800
  (8,  'gold',      1, 31500),                  -- 126.0    5,300
  (9,  'platinum',  3, 37300),                  -- 149.2    5,800
  (10, 'platinum',  2, 43500),                  -- 174.0    6,200
  (11, 'platinum',  1, 50400),                  -- 201.6    6,900
  (12, 'diamond',   3, 57900),                  -- 231.6    7,500
  (13, 'diamond',   2, 66000),                  -- 264.0    8,100
  -- 🔴 LOCKED ANCHOR · top of Diamond = 300 h.
  (14, 'diamond',   1, 75000),                  -- 300.0    9,000
  -- ── the realm of legend ──
  (15, 'hero',      3, 84800),                  -- 339.2    9,800
  (16, 'hero',      2, 95400),                  -- 381.6   10,600
  (17, 'hero',      1, 107100),                 -- 428.4   11,700
  (18, 'titan',     3, 119800),                 -- 479.2   12,700
  (19, 'titan',     2, 133800),                 -- 535.2   14,000
  (20, 'titan',     1, 149000),                 -- 596.0   15,200
  -- 'olympian' is the enum key; WS9 renames the DISPLAY label to Divine and leaves this alone.
  -- The curve passes through it unbroken: 662 h -> 735 h -> 814 h, between Titan and Immortal.
  (21, 'olympian',  3, 165600),                 -- 662.4   16,600
  (22, 'olympian',  2, 183700),                 -- 734.8   18,100
  (23, 'olympian',  1, 203500),                 -- 814.0   19,800
  (24, 'immortal',  3, 225200),                 -- 900.8   21,700
  (25, 'immortal',  2, 248900),                 -- 995.6   23,700
  -- 🔴 LOCKED ANCHOR · top of Immortal = 1,100 h.
  (26, 'immortal',  1, 275000),                 --1100.0   26,100
  -- 🔴 LOCKED ANCHOR · the apex = 2,500 h. Singular, no divisions; `division` stays 1 purely so
  -- ordinal arithmetic keeps it above Immortal's top (the convention 0063 established).
  (27, 'primordial', 1, 625000)                 --2500.0  350,000
on conflict (rank_index) do update set
  tier = excluded.tier,
  division = excluded.division,
  cumulative_xp_required = excluded.cumulative_xp_required;

-- ── 2 · a fifth rung for the hours ladders ───────────────────────────────────────────────────
--
-- 0119 gave study and deep_work `10/25/50/100 h`, capping at Legendary with no mythic rung at all
-- (0186 restated deep_work's identically). 600 h is the new cap. The four rungs below are repeated
-- verbatim: `economy_apply_relic_ladder` keeps `greatest(tier)`, so an existing δ/Legendary holder
-- keeps δ and simply has somewhere further to go.
--
-- The Crown of Olympus capstone counts `rp.tier >= array_length(rl.thresholds, 1)` against
-- `relic_ladders` rather than against a literal, so "maxed" for these two families becomes 600 h
-- by arithmetic and needs no edit — asserted below. The crown is granted through
-- `economy_grant_relic` into `cosmetics_owned` and is never revoked, so anyone who already earned
-- it under the 100 h cap keeps it; this only raises the bar for the next claimant.
--
-- The rung glyphs already go to five (`v_roman`/`v_greek` = I..V / α..Ω in 0179), so rung 5
-- renders "V Ω" with no code change.

insert into relic_ladders (family, relic_key, unit, thresholds, rarities) values
  ('study',     'relic-socrates-scroll',    'h', array[10,25,50,100,600],
                                                 array['uncommon','rare','epic','legendary','mythic']),
  ('deep_work', 'relic-daedalus-blueprint', 'h', array[10,25,50,100,600],
                                                 array['uncommon','rare','epic','legendary','mythic'])
on conflict (family) do update set
  relic_key  = excluded.relic_key,
  unit       = excluded.unit,
  thresholds = excluded.thresholds,
  rarities   = excluded.rarities;

-- ── 3 · assertions ───────────────────────────────────────────────────────────────────────────
--
-- Several checks below are paired with a control that would be GREEN under the old numbers, so a
-- no-op migration cannot pass this block.

do $assert$
declare
  v int;
  v_family text;
  v_hours_families text[] := array['study', 'deep_work'];
  v_tier text;
  v_div int;
begin
  -- ── the curve ──

  -- 28 rows, no more and no fewer. A stray row would break `nextRank`'s walk on the client.
  select count(*) into v from rank_thresholds;
  if v <> 28 then raise exception '0203: expected 28 rank rows, found %', v; end if;

  -- Strictly increasing by rank_index. Two rows sharing a value would make `rank_tier_for_score`'s
  -- `order by cumulative_xp_required desc limit 1` pick arbitrarily between them.
  select count(*) into v
  from rank_thresholds a
  join rank_thresholds b on b.rank_index = a.rank_index + 1
  where b.cumulative_xp_required <= a.cumulative_xp_required;
  if v <> 0 then raise exception '0203: % rank rows are not strictly above the row below', v; end if;

  -- Steepening: every division costs at least as much as the one below it. This is the check that
  -- catches a hand-edit flattening the middle of the ladder while leaving the anchors intact.
  select count(*) into v
  from rank_thresholds a
  join rank_thresholds b on b.rank_index = a.rank_index + 1
  join rank_thresholds c on c.rank_index = a.rank_index + 2
  where (c.cumulative_xp_required - b.cumulative_xp_required)
      < (b.cumulative_xp_required - a.cumulative_xp_required);
  if v <> 0 then raise exception '0203: % divisions cost less than the division below', v; end if;

  -- The three LOCKED anchors, exactly.
  select cumulative_xp_required into v from rank_thresholds where rank_index = 14;
  if v <> 75000 then raise exception '0203: Diamond top is % XP, want 75000 (300 h)', v; end if;
  select cumulative_xp_required into v from rank_thresholds where rank_index = 26;
  if v <> 275000 then raise exception '0203: Immortal top is % XP, want 275000 (1,100 h)', v; end if;
  select cumulative_xp_required into v from rank_thresholds where rank_index = 27;
  if v <> 625000 then raise exception '0203: Primordial is % XP, want 625000 (2,500 h)', v; end if;

  -- `rank_tier_for_score` actually resolves against the new numbers — positive AND negative
  -- control on the Diamond-top boundary, because an assertion on the table alone would stay green
  -- even if the function were reading somewhere else entirely.
  select tier, division into v_tier, v_div from rank_tier_for_score(74999);
  if v_tier is distinct from 'diamond' or v_div is distinct from 2 then
    raise exception '0203: 74,999 XP resolves to % %, want diamond 2', v_tier, v_div;
  end if;
  select tier, division into v_tier, v_div from rank_tier_for_score(75000);
  if v_tier is distinct from 'diamond' or v_div is distinct from 1 then
    raise exception '0203: 75,000 XP resolves to % %, want diamond 1', v_tier, v_div;
  end if;
  -- The old apex, 124,200, must now be nowhere near Primordial. Under the pre-0203 table this
  -- returned primordial; it is the single clearest proof the lift actually landed.
  select tier into v_tier from rank_tier_for_score(124200);
  if v_tier <> 'titan' then
    raise exception '0203: the old apex score 124,200 still resolves to %, want titan', v_tier;
  end if;
  select tier into v_tier from rank_tier_for_score(625000);
  if v_tier <> 'primordial' then
    raise exception '0203: 625,000 XP resolves to %, want primordial', v_tier;
  end if;

  -- ── the ladders ──

  foreach v_family in array v_hours_families loop
    select array_length(thresholds, 1) into v from relic_ladders where family = v_family;
    if v is distinct from 5 then
      raise exception '0203: % ladder has % rungs, want 5', v_family, v;
    end if;

    select count(*) into v from relic_ladders
    where family = v_family
      and thresholds = array[10,25,50,100,600]::numeric[]
      and rarities = array['uncommon','rare','epic','legendary','mythic'];
    if v <> 1 then
      raise exception '0203: % ladder is not 10/25/50/100/600 -> ..mythic', v_family;
    end if;

    -- The rung the function would award, computed the way `economy_apply_relic_ladder` computes it
    -- (highest subscript whose threshold the value clears). 599 h must still be rung 4 and 600 h
    -- must be rung 5 — the 599 arm is the negative control proving the rung is not awarded early.
    select coalesce(max(i), 0) into v
    from relic_ladders rl, generate_subscripts(rl.thresholds, 1) i
    where rl.family = v_family and 599 >= rl.thresholds[i];
    if v <> 4 then raise exception '0203: % at 599 h awards rung %, want 4', v_family, v; end if;

    select coalesce(max(i), 0) into v
    from relic_ladders rl, generate_subscripts(rl.thresholds, 1) i
    where rl.family = v_family and 600 >= rl.thresholds[i];
    if v <> 5 then raise exception '0203: % at 600 h awards rung %, want 5', v_family, v; end if;
  end loop;

  -- ── the Crown of Olympus capstone ──
  --
  -- It counts `rp.tier >= array_length(rl.thresholds, 1)`, so raising the cap raises the bar by
  -- arithmetic and needs no edit. Both arms below exercise that exact predicate against the live
  -- table, with synthetic rungs rather than whatever `relic_progress` happens to hold — a check
  -- driven by prod rows would pass vacuously on a day when nobody is near the cap.

  -- Negative: rung 4, the old cap, must no longer satisfy it for either hours ladder.
  select count(*) into v from relic_ladders rl
  where rl.family = any (v_hours_families) and 4 >= array_length(rl.thresholds, 1);
  if v <> 0 then
    raise exception '0203: rung 4 still counts as maxed for % hours ladder(s)', v;
  end if;

  -- Positive: rung 5 must satisfy it for both. Without this arm the check above would also be
  -- green if `array_length` had somehow become null and the predicate stopped matching anything.
  select count(*) into v from relic_ladders rl
  where rl.family = any (v_hours_families) and 5 >= array_length(rl.thresholds, 1);
  if v <> 2 then
    raise exception '0203: rung 5 satisfies the capstone for only % of 2 hours ladders', v;
  end if;

  -- And the untouched ladders stay untouched — volume keeps 5 rungs, distance keeps 4. The
  -- capstone counts every row in `relic_ladders`, so a stray edit here would silently move the
  -- crown for everyone.
  select count(*) into v from relic_ladders rl
  where (rl.family = 'volume' and array_length(rl.thresholds, 1) = 5)
     or (rl.family = 'distance' and array_length(rl.thresholds, 1) = 4);
  if v <> 2 then
    raise exception '0203: the fitness ladders changed shape (matched % of 2)', v;
  end if;
end;
$assert$;

comment on table rank_thresholds is
  '0203 — the ~5x curve. 250 XP/locked-in-hour is unchanged; Diamond top 75,000 (300 h), Immortal top 275,000 (1,100 h), Primordial 625,000 (2,500 h). Rank is derived and never stored, so re-cutting this table needs no backfill and users visibly re-rank on their next read. The `division` numbering is WS9''s to flip.';
