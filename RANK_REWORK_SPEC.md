# Rank rework — the 10-tier Primordial ladder (build spec for Code)

**What & why.** The current curve makes Gold trivial (~2.6k XP / ~10h) and tops out at Diamond→Infernal in ~33k XP. We're steepening it and extending the top into a mythic ascension. Design source of truth: `design-mocks/77-rank-ladder.html`.

**New ladder (10 tiers):**
`Bronze → Silver → Gold → Platinum → Diamond` (the mortal climb) → `Hero → Titan → Olympian → Immortal` (the realm of legend) → **`Primordial`** (apex, no divisions).

Three changes bundled here:
1. **New XP curve** — tripled at the low end, escalating hard up top. Primordial lands ~124k XP ≈ **~497h** at the ~250 XP/hr lock-in rate.
2. **Four new tiers** — `hero`, `titan`, `olympian`, `immortal` (all with I/II/III divisions).
3. **Rename** `infernal` → `primordial` everywhere (the apex is now "the first flame, older than the gods"). Plus **`platinum` recolored** from teal to a cool silver so it doesn't blur into Diamond/the gems.

This is **100% JS + a data migration. No native change → ships over OTA + `supabase db push`.**

---

## 1 · Server — `supabase/schema.sql` + new migration

The good news: `rank_tier_for_score()`, `get_my_ranks()`, `get_user_rank()` etc. are **table-driven** — they read `rank_thresholds` and need **NO changes**. The rank curve *is* the data in that table. So the server change is just replacing the rows.

The **only** `'infernal'` string literal server-side is the one threshold row (`schema.sql:4062`) — replaced below. Rank is *derived* from score, never stored on a user row, so there is **no per-user data migration** and no enum to alter (`tier` is a plain `text` column).

### New migration `supabase/migrations/0063_rank_rework_primordial.sql`

```sql
-- Rank rework: 10-tier Primordial ladder (RANK_REWORK_SPEC.md, design-mocks/77).
-- Steeper curve + four new legend tiers (hero/titan/olympian/immortal) + apex rename
-- infernal -> primordial. Table-driven: rank_tier_for_score/get_my_ranks are unchanged;
-- only the threshold DATA changes. Rank is derived from score, so no per-user migration.
-- Existing testers re-map downward on next read (expected, pre-launch).

-- Defensive: clear any rows beyond the new max index (old table maxed at 15).
delete from rank_thresholds where rank_index > 27;

insert into rank_thresholds (rank_index, tier, division, cumulative_xp_required) values
  (0,  'bronze',    3, 0),
  (1,  'bronze',    2, 900),
  (2,  'bronze',    1, 1800),
  (3,  'silver',    3, 2700),
  (4,  'silver',    2, 4200),
  (5,  'silver',    1, 5700),
  (6,  'gold',      3, 7200),
  (7,  'gold',      2, 9400),
  (8,  'gold',      1, 11600),
  (9,  'platinum',  3, 13800),
  (10, 'platinum',  2, 16700),
  (11, 'platinum',  1, 19600),
  (12, 'diamond',   3, 22500),
  (13, 'diamond',   2, 26200),
  (14, 'diamond',   1, 29900),
  (15, 'hero',      3, 33600),
  (16, 'hero',      2, 38400),
  (17, 'hero',      1, 43200),
  (18, 'titan',     3, 48000),
  (19, 'titan',     2, 54200),
  (20, 'titan',     1, 60400),
  (21, 'olympian',  3, 66600),
  (22, 'olympian',  2, 74800),
  (23, 'olympian',  1, 83000),
  (24, 'immortal',  3, 91200),
  (25, 'immortal',  2, 102200),
  (26, 'immortal',  1, 113200),
  -- Primordial: apex, singular/no divisions. division stored as 1 so ordinal arithmetic
  -- still orders it above Immortal I (same convention the old 'infernal' row used).
  (27, 'primordial', 1, 124200)
on conflict (rank_index) do update set
  tier = excluded.tier,
  division = excluded.division,
  cumulative_xp_required = excluded.cumulative_xp_required;
```

**Also update `schema.sql`** (lines ~4042–4064): replace the inline `insert into rank_thresholds (...)` block with the same 28 rows above, and update the surrounding comment (drop the `step(i)=round(200*1.3^i)` / "Diamond I is max" note; the apex is now Primordial at rank_index 27). Keep schema.sql and the migration in sync — schema.sql is the consolidated source of truth.

### Per-tier cost (for reference / future retuning)
Per-division cost escalates: Bronze 900 · Silver 1,500 · Gold 2,200 · Platinum 2,900 · Diamond 3,700 · Hero 4,800 · Titan 6,200 · Olympian 8,200 · Immortal 11,000. `cumulative_xp_required` = start of each tier's **III** (lowest) division.

### Cumulative reach / hours (sanity)
Silver ~11h · Gold ~29h · Platinum ~55h · Diamond ~90h · Hero ~134h · Titan ~192h · Olympian ~266h · Immortal ~365h · **Primordial ~497h**.

---

## 2 · Client — `src/lib/rank-tiers.ts` (the core)

- **`RankTierName` type:** remove `'infernal'`, add `'hero' | 'titan' | 'olympian' | 'immortal' | 'primordial'`. Keep bronze/silver/gold/platinum/diamond.
- **`TIER_ORDER`:** `['bronze','silver','gold','platinum','diamond','hero','titan','olympian','immortal','primordial']`. (`rankOrdinal` math is unchanged — it keys off this array.)
- **`RANK_TIER_METAL`** — colors (from mock 77; outer = border, inner = fill, text = label):

  | tier | outer | inner | text |
  |---|---|---|---|
  | bronze | `#6E4423` | `#B87333` | (existing) |
  | silver | `#6B7280` | `#C4CBD6` | (existing) |
  | gold | `#9A6A12` | `#F5C542` | (existing) |
  | **platinum** ⟳ recolor | `#6E8B98` | `#A7C7D4` | `#C4DAE3` |
  | diamond | `#2C6E76` | `#7FE0E8` | `#7FE0E8` |
  | **hero** ✦ new | `#8F2E28` | `#E0574C` | `#F0897E` |
  | **titan** ✦ new | `#1E5E4A` | `#4FA88C` | `#7FD4B8` |
  | **olympian** ✦ new | `#C0A24E` | `#F7E9C0` | `#FBF1D4` |
  | **immortal** ✦ new | `#8E6BC8` | `#EAE2FA` | `#E4D6FF` |
  | **primordial** (was infernal) | `#B0431E` | `#F2A33C` | `#F7B85A` |

  (Primordial inherits the old infernal molten palette incl. the `#F7B85A` shimmer.)
- **`RANK_TIER_LABEL`:** add `hero:'Hero'`, `titan:'Titan'`, `olympian:'Olympian'`, `immortal:'Immortal'`, `primordial:'Primordial'`; drop `infernal`.
- **`TIER_FLASH_KIND`:** `silver:'sweep'`, `gold:'sparkle'`, `platinum:'sweep'`, `diamond:'prism'`, `hero:'sweep'`, `titan:'prism'`, `olympian:'sparkle'`, `immortal:'prism'`, `primordial:'flame'`. (Immortal gets the iridescent `prism`; Primordial keeps the `flame`.)
- **`formatRankTier`:** move the "singular, no divisions" special-case from `infernal` → `primordial` (Primordial renders as just "Primordial", no numeral).

---

## 3 · Client — rename + new-tier blast radius

Every file below references `infernal` and/or holds a per-tier map. For each: **rename the `infernal` key → `primordial`**, and where there's a per-tier lookup, **add entries for hero/titan/olympian/immortal**.

- `src/types/database.ts` — the `tier` union type: swap `infernal`→`primordial`, add the four new tiers.
- `src/components/hexagon-badge.tsx` — badge gradient/colors per tier: add the 4 new + recolor platinum + rename primordial. Confirm it reads from `RANK_TIER_METAL` (ideal) rather than a local copy; if local, update it.
- `src/components/rank-up-celebration.tsx` — the flame flash is keyed to the apex; repoint `infernal`→`primordial` and make sure the four new tiers get their `TIER_FLASH_KIND` treatment.
- `src/components/reward-burst.tsx` — per-tier burst colors: add new + rename.
- `src/components/parthenon-podium.tsx` — uses tier colors (Parthenon leaderboard); add new + recolor/rename.
- `src/components/dev-tools.tsx` — the dev rank picker: add the 4 new tiers + primordial so you can force-preview them on-device.
- `src/lib/rank-up-copy.ts` — needs a rank-up line per **new** tier (see §4) + rename the infernal entry to primordial.
- `src/lib/reward-feedback.ts` and `src/lib/sound.ts` — per-tier haptic/sfx maps: add new + rename. (Reuse the old infernal rank-up SFX for primordial; pick sensible existing cues for hero→immortal, or reuse the tier-up cue.)

> Grep guard: after the change, `grep -rn "infernal" src` should return **zero** hits, and every `Record<RankTierName, …>` map should have all 10 keys (TS will flag missing ones if the maps are typed — lean on that).

---

## 4 · New rank-up copy (`src/lib/rank-up-copy.ts`)

Match the existing tone; suggested lines (tune to taste):
- **hero** — "You've climbed past mortal limits. You're the story now — Hero."
- **titan** — "Primordial strength. You move like a Titan."
- **olympian** — "You sit among the gods. Olympian."
- **immortal** — "Deathless. Untouchable. Immortal."
- **primordial** — "The first flame, older than the gods. You are Primordial." (replaces the infernal line)

---

## 5 · Ship & verify

- **Server:** `supabase db push` (migration 0063). Functions unchanged.
- **Client:** OTA (`eas update`) — no rebuild.
- **Existing testers re-map downward** on next `get_my_ranks()` read (score is unchanged; the curve moved). Expected and fine pre-launch — e.g. a 2.6k-XP account goes Gold → ~Silver III. Worth a heads-up in the tester group so it doesn't read as a bug. If PUNCHLIST_5 #6's rank-watcher is live, guard against it firing a spurious "rank up" on the remap (it's a *down*-map, so an increase check is safe — just confirm).
- **Verify:** dev-tools force each of the 10 tiers → badge color + label + flash render correctly; Primordial shows no division numeral; `get_my_ranks` returns correct tier/division/xp_into_tier/xp_for_next_tier at a few sample scores (e.g. 7,200 → Gold III with xp_into_tier 0; 124,200 → Primordial with xp_for_next_tier 0).
