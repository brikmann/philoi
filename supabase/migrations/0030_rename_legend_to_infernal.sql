-- Renames the apex rank tier from "Legend" to "Infernal" (PHILOI_UI_SPEC.md §11 — fire theme).
-- Pre-launch, so a clean value rename is safe: rank_thresholds.tier is a plain `text` column
-- (no enum/check constraint), and no other table stores a per-user tier value — every read
-- derives tier live from score via rank_tier_for_score(), so this one-row update is the entire
-- surface area. NOTIFY afterward so PostgREST's schema cache (unrelated to this specific row,
-- but cheap insurance given this session's earlier stale-cache incident) picks up the change.
update rank_thresholds set tier = 'infernal' where tier = 'legend';
