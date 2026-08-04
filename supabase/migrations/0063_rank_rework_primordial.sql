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
