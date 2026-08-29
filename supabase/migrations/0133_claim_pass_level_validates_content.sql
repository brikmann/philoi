-- 0133 (#144) — the Pass grants what the SEASON says a level pays, not what the client asked for.
--
-- ─────────────────────────── the hole ───────────────────────────
--
-- claim_pass_level(p_level, p_lane, p_rewards) re-derived everything a caller could lie about
-- except the one thing that decides the payout. Its own docstring said so out loud: "The rewards
-- array is the only thing taken on trust, and it is validated shape-wise below." Shape-wise is the
-- problem. `{"kind":"embers","embers":999999}` is a perfectly well-shaped reward.
--
-- So a user who had legitimately reached level 5 could claim level 5 and hand themselves a million
-- embers, a Promethean Vault, and any mythic in the catalog. Every other gate held — level reached,
-- lane ownership, season window, the unique claim row that makes it idempotent — and none of them
-- looks at WHAT is being granted. One claim, once, legitimately unlocked, arbitrary contents.
--
-- Same family as #151 (economy internals exposed as RPCs) and the same fix 0090 made for boxes:
-- the server stops asking the client what it won.
--
-- ─────────────────────────── why the fix needs a table ───────────────────────────
--
-- The server could not validate the reward because the server had no idea what a level pays. The
-- entire Flame Pass track lived in src/lib/economy/forge-pass.ts and nowhere else — 20 named levels
-- on the multiples of 5, plus a per-phase ember drip on the other 80. There was nothing to compare
-- a claim against, which is why it was taken on trust in the first place.
--
-- pass_track_rewards is that missing definition: 215 rows, levels 1-100 x {free, premium},
-- transcribed from forge-pass.ts by parsing it rather than by hand, so the two cannot disagree
-- through a typo. Levels are the ONLY claimable range — the client offers no prestige claim
-- (isPrestigeLevel and PRESTIGE_FREE are dead constants), so a claim outside 1-100 now finds no
-- definition and is refused rather than falling through to whatever was sent.
--
-- Level 0 is deliberately absent. grant_forge_pass (0074) already grants the purchase unlock
-- server-side from hardcoded keys, so it was never client-trusted and needs nothing here.
--
-- ─────────────────────────── what happens to p_rewards ───────────────────────────
--
-- KEPT IN THE SIGNATURE, AND IGNORED. Dropping the parameter would break every installed client
-- the moment this deploys, and this fix has to reach production before the season opens without
-- waiting on an app release.
--
-- IGNORED RATHER THAN REJECTED, which is a deliberate choice and the one thing here worth arguing
-- about. Raising on a mismatch would be louder, but it makes any client-server drift in the track
-- — an older app, a tuning change to a single level — a total claim outage for everyone on that
-- version. Ignoring it means a claim always pays exactly what the season owes and can never pay
-- anything else, which is the actual security property; the mismatch is recorded instead, so a
-- spoof attempt is evidence rather than an error message.

-- ─────────────────────────── 1 · the authoritative track ───────────────────────────

create table if not exists pass_track_rewards (
  season_id text not null,
  level int not null check (level between 1 and 100),
  lane text not null check (lane in ('free', 'premium')),
  /** Position within the level's bundle. A level can pay more than one thing (L50 premium is a
   *  Mythic halo AND the Emberfall Strike sting), and the order is the order they are granted. */
  ord int not null,
  kind text not null check (kind in ('embers', 'box', 'item', 'badge')),
  embers int,
  box_key text,
  item_key text,
  /** Slot and rarity travel WITH the row: economy_grant_cosmetic needs both, and the server has no
   *  item catalog of its own to look them up in. Null slot is correct for the showcase-only types
   *  (SFX, RELIC, MEDAL), which are owned but never equipped to a slot. */
  item_slot text,
  item_rarity text,
  primary key (season_id, level, lane, ord),
  -- Each kind carries exactly the columns it means. Without this a row could name a box and an
  -- item at once and the granting loop would silently honour whichever branch it tested first.
  constraint pass_track_rewards_shape check (
    case kind
      when 'embers' then embers is not null and box_key is null and item_key is null
      when 'box'    then box_key is not null and embers is null and item_key is null
      when 'item'   then item_key is not null and item_rarity is not null and embers is null and box_key is null
      when 'badge'  then item_key is not null and embers is null and box_key is null
    end
  )
);

alter table pass_track_rewards enable row level security;

-- Readable by anyone signed in: this is the season's advertised reward track, already fully
-- visible in the app. Read-only — there is no write policy, so the only way in is a migration.
drop policy if exists pass_track_rewards_read on pass_track_rewards;
create policy pass_track_rewards_read on pass_track_rewards
  for select to authenticated using (true);

-- Idempotent: re-running the migration re-seeds the same track rather than doubling it.
delete from pass_track_rewards where season_id = 'S1';

insert into pass_track_rewards (season_id, level, lane, ord, kind, embers, box_key, item_key, item_slot, item_rarity)
select 'S1', * from (values
  (1, 'free', 0, 'embers', 20, null, null, null, null),
  (1, 'premium', 0, 'embers', 40, null, null, null, null),
  (2, 'free', 0, 'embers', 20, null, null, null, null),
  (2, 'premium', 0, 'embers', 40, null, null, null, null),
  (3, 'free', 0, 'embers', 20, null, null, null, null),
  (3, 'premium', 0, 'embers', 40, null, null, null, null),
  (4, 'free', 0, 'embers', 20, null, null, null, null),
  (4, 'premium', 0, 'embers', 40, null, null, null, null),
  (5, 'free', 0, 'box', null, 'kindling', null, null, null),
  (5, 'premium', 0, 'box', null, 'ignition', null, null, null),
  (5, 'premium', 1, 'item', null, null, 'flame-molten-copper', 'flame', 'rare'),
  (6, 'free', 0, 'embers', 20, null, null, null, null),
  (6, 'premium', 0, 'embers', 40, null, null, null, null),
  (7, 'free', 0, 'embers', 20, null, null, null, null),
  (7, 'premium', 0, 'embers', 40, null, null, null, null),
  (8, 'free', 0, 'embers', 20, null, null, null, null),
  (8, 'premium', 0, 'embers', 40, null, null, null, null),
  (9, 'free', 0, 'embers', 20, null, null, null, null),
  (9, 'premium', 0, 'embers', 40, null, null, null, null),
  (10, 'free', 0, 'box', null, 'ignition', null, null, null),
  (10, 'premium', 0, 'box', null, 'furnace', null, null, null),
  (10, 'premium', 1, 'item', null, null, 'title-kindled', 'title', 'common'),
  (11, 'free', 0, 'embers', 20, null, null, null, null),
  (11, 'premium', 0, 'embers', 40, null, null, null, null),
  (12, 'free', 0, 'embers', 20, null, null, null, null),
  (12, 'premium', 0, 'embers', 40, null, null, null, null),
  (13, 'free', 0, 'embers', 20, null, null, null, null),
  (13, 'premium', 0, 'embers', 40, null, null, null, null),
  (14, 'free', 0, 'embers', 20, null, null, null, null),
  (14, 'premium', 0, 'embers', 40, null, null, null, null),
  (15, 'free', 0, 'embers', 50, null, null, null, null),
  (15, 'premium', 0, 'embers', 250, null, null, null, null),
  (15, 'premium', 1, 'item', null, null, 'audio-monastery-drone', 'audio', 'epic'),
  (16, 'free', 0, 'embers', 20, null, null, null, null),
  (16, 'premium', 0, 'embers', 40, null, null, null, null),
  (17, 'free', 0, 'embers', 20, null, null, null, null),
  (17, 'premium', 0, 'embers', 40, null, null, null, null),
  (18, 'free', 0, 'embers', 20, null, null, null, null),
  (18, 'premium', 0, 'embers', 40, null, null, null, null),
  (19, 'free', 0, 'embers', 20, null, null, null, null),
  (19, 'premium', 0, 'embers', 40, null, null, null, null),
  (20, 'free', 0, 'box', null, 'ignition', null, null, null),
  (20, 'premium', 0, 'box', null, 'furnace', null, null, null),
  (20, 'premium', 1, 'item', null, null, 'banner-emberfall', 'banner', 'legendary'),
  (21, 'free', 0, 'embers', 20, null, null, null, null),
  (21, 'premium', 0, 'embers', 40, null, null, null, null),
  (22, 'free', 0, 'embers', 20, null, null, null, null),
  (22, 'premium', 0, 'embers', 40, null, null, null, null),
  (23, 'free', 0, 'embers', 20, null, null, null, null),
  (23, 'premium', 0, 'embers', 40, null, null, null, null),
  (24, 'free', 0, 'embers', 20, null, null, null, null),
  (24, 'premium', 0, 'embers', 40, null, null, null, null),
  (25, 'free', 0, 'box', null, 'furnace', null, null, null),
  (25, 'premium', 0, 'item', null, null, 'banner-emberfall-mythic', 'banner', 'mythic'),
  (26, 'free', 0, 'embers', 30, null, null, null, null),
  (26, 'premium', 0, 'embers', 60, null, null, null, null),
  (27, 'free', 0, 'embers', 30, null, null, null, null),
  (27, 'premium', 0, 'embers', 60, null, null, null, null),
  (28, 'free', 0, 'embers', 30, null, null, null, null),
  (28, 'premium', 0, 'embers', 60, null, null, null, null),
  (29, 'free', 0, 'embers', 30, null, null, null, null),
  (29, 'premium', 0, 'embers', 60, null, null, null, null),
  (30, 'free', 0, 'box', null, 'ignition', null, null, null),
  (30, 'premium', 0, 'box', null, 'furnace', null, null, null),
  (30, 'premium', 1, 'embers', 500, null, null, null, null),
  (31, 'free', 0, 'embers', 30, null, null, null, null),
  (31, 'premium', 0, 'embers', 60, null, null, null, null),
  (32, 'free', 0, 'embers', 30, null, null, null, null),
  (32, 'premium', 0, 'embers', 60, null, null, null, null),
  (33, 'free', 0, 'embers', 30, null, null, null, null),
  (33, 'premium', 0, 'embers', 60, null, null, null, null),
  (34, 'free', 0, 'embers', 30, null, null, null, null),
  (34, 'premium', 0, 'embers', 60, null, null, null, null),
  (35, 'free', 0, 'embers', 75, null, null, null, null),
  (35, 'premium', 0, 'item', null, null, 'card-emberfall', 'card', 'epic'),
  (35, 'premium', 1, 'embers', 250, null, null, null, null),
  (36, 'free', 0, 'embers', 30, null, null, null, null),
  (36, 'premium', 0, 'embers', 60, null, null, null, null),
  (37, 'free', 0, 'embers', 30, null, null, null, null),
  (37, 'premium', 0, 'embers', 60, null, null, null, null),
  (38, 'free', 0, 'embers', 30, null, null, null, null),
  (38, 'premium', 0, 'embers', 60, null, null, null, null),
  (39, 'free', 0, 'embers', 30, null, null, null, null),
  (39, 'premium', 0, 'embers', 60, null, null, null, null),
  (40, 'free', 0, 'box', null, 'furnace', null, null, null),
  (40, 'premium', 0, 'box', null, 'hestia', null, null, null),
  (40, 'premium', 1, 'item', null, null, 'particle-void-smoke', 'particle', 'mythic'),
  (41, 'free', 0, 'embers', 30, null, null, null, null),
  (41, 'premium', 0, 'embers', 60, null, null, null, null),
  (42, 'free', 0, 'embers', 30, null, null, null, null),
  (42, 'premium', 0, 'embers', 60, null, null, null, null),
  (43, 'free', 0, 'embers', 30, null, null, null, null),
  (43, 'premium', 0, 'embers', 60, null, null, null, null),
  (44, 'free', 0, 'embers', 30, null, null, null, null),
  (44, 'premium', 0, 'embers', 60, null, null, null, null),
  (45, 'free', 0, 'box', null, 'furnace', null, null, null),
  (45, 'premium', 0, 'item', null, null, 'halo-emberfall', 'halo', 'epic'),
  (45, 'premium', 1, 'embers', 500, null, null, null, null),
  (46, 'free', 0, 'embers', 30, null, null, null, null),
  (46, 'premium', 0, 'embers', 60, null, null, null, null),
  (47, 'free', 0, 'embers', 30, null, null, null, null),
  (47, 'premium', 0, 'embers', 60, null, null, null, null),
  (48, 'free', 0, 'embers', 30, null, null, null, null),
  (48, 'premium', 0, 'embers', 60, null, null, null, null),
  (49, 'free', 0, 'embers', 30, null, null, null, null),
  (49, 'premium', 0, 'embers', 60, null, null, null, null),
  (50, 'free', 0, 'box', null, 'hestia', null, null, null),
  (50, 'premium', 0, 'item', null, null, 'halo-emberfall-mythic', 'halo', 'mythic'),
  (50, 'premium', 1, 'item', null, null, 'sfx-emberfall-strike', null, 'mythic'),
  (51, 'free', 0, 'embers', 40, null, null, null, null),
  (51, 'premium', 0, 'embers', 80, null, null, null, null),
  (52, 'free', 0, 'embers', 40, null, null, null, null),
  (52, 'premium', 0, 'embers', 80, null, null, null, null),
  (53, 'free', 0, 'embers', 40, null, null, null, null),
  (53, 'premium', 0, 'embers', 80, null, null, null, null),
  (54, 'free', 0, 'embers', 40, null, null, null, null),
  (54, 'premium', 0, 'embers', 80, null, null, null, null),
  (55, 'free', 0, 'box', null, 'hestia', null, null, null),
  (55, 'premium', 0, 'box', null, 'hephaestus', null, null, null),
  (55, 'premium', 1, 'embers', 750, null, null, null, null),
  (56, 'free', 0, 'embers', 40, null, null, null, null),
  (56, 'premium', 0, 'embers', 80, null, null, null, null),
  (57, 'free', 0, 'embers', 40, null, null, null, null),
  (57, 'premium', 0, 'embers', 80, null, null, null, null),
  (58, 'free', 0, 'embers', 40, null, null, null, null),
  (58, 'premium', 0, 'embers', 80, null, null, null, null),
  (59, 'free', 0, 'embers', 40, null, null, null, null),
  (59, 'premium', 0, 'embers', 80, null, null, null, null),
  (60, 'free', 0, 'box', null, 'furnace', null, null, null),
  (60, 'premium', 0, 'item', null, null, 'title-dialed-in', 'title', 'legendary'),
  (61, 'free', 0, 'embers', 40, null, null, null, null),
  (61, 'premium', 0, 'embers', 80, null, null, null, null),
  (62, 'free', 0, 'embers', 40, null, null, null, null),
  (62, 'premium', 0, 'embers', 80, null, null, null, null),
  (63, 'free', 0, 'embers', 40, null, null, null, null),
  (63, 'premium', 0, 'embers', 80, null, null, null, null),
  (64, 'free', 0, 'embers', 40, null, null, null, null),
  (64, 'premium', 0, 'embers', 80, null, null, null, null),
  (65, 'free', 0, 'embers', 125, null, null, null, null),
  (65, 'premium', 0, 'item', null, null, 'audio-deep-space-sub-bass', 'audio', 'legendary'),
  (66, 'free', 0, 'embers', 40, null, null, null, null),
  (66, 'premium', 0, 'embers', 80, null, null, null, null),
  (67, 'free', 0, 'embers', 40, null, null, null, null),
  (67, 'premium', 0, 'embers', 80, null, null, null, null),
  (68, 'free', 0, 'embers', 40, null, null, null, null),
  (68, 'premium', 0, 'embers', 80, null, null, null, null),
  (69, 'free', 0, 'embers', 40, null, null, null, null),
  (69, 'premium', 0, 'embers', 80, null, null, null, null),
  (70, 'free', 0, 'box', null, 'hestia', null, null, null),
  (70, 'premium', 0, 'item', null, null, 'banner-ashfall', 'banner', 'legendary'),
  (70, 'premium', 1, 'embers', 1000, null, null, null, null),
  (71, 'free', 0, 'embers', 40, null, null, null, null),
  (71, 'premium', 0, 'embers', 80, null, null, null, null),
  (72, 'free', 0, 'embers', 40, null, null, null, null),
  (72, 'premium', 0, 'embers', 80, null, null, null, null),
  (73, 'free', 0, 'embers', 40, null, null, null, null),
  (73, 'premium', 0, 'embers', 80, null, null, null, null),
  (74, 'free', 0, 'embers', 40, null, null, null, null),
  (74, 'premium', 0, 'embers', 80, null, null, null, null),
  (75, 'free', 0, 'box', null, 'hestia', null, null, null),
  (75, 'premium', 0, 'item', null, null, 'card-emberfall-mythic', 'card', 'mythic'),
  (76, 'free', 0, 'embers', 50, null, null, null, null),
  (76, 'premium', 0, 'embers', 100, null, null, null, null),
  (77, 'free', 0, 'embers', 50, null, null, null, null),
  (77, 'premium', 0, 'embers', 100, null, null, null, null),
  (78, 'free', 0, 'embers', 50, null, null, null, null),
  (78, 'premium', 0, 'embers', 100, null, null, null, null),
  (79, 'free', 0, 'embers', 50, null, null, null, null),
  (79, 'premium', 0, 'embers', 100, null, null, null, null),
  (80, 'free', 0, 'box', null, 'hephaestus', null, null, null),
  (80, 'premium', 0, 'box', null, 'promethean', null, null, null),
  (80, 'premium', 1, 'embers', 1500, null, null, null, null),
  (81, 'free', 0, 'embers', 50, null, null, null, null),
  (81, 'premium', 0, 'embers', 100, null, null, null, null),
  (82, 'free', 0, 'embers', 50, null, null, null, null),
  (82, 'premium', 0, 'embers', 100, null, null, null, null),
  (83, 'free', 0, 'embers', 50, null, null, null, null),
  (83, 'premium', 0, 'embers', 100, null, null, null, null),
  (84, 'free', 0, 'embers', 50, null, null, null, null),
  (84, 'premium', 0, 'embers', 100, null, null, null, null),
  (85, 'free', 0, 'box', null, 'hestia', null, null, null),
  (85, 'premium', 0, 'item', null, null, 'particle-falling-ash', 'particle', 'epic'),
  (86, 'free', 0, 'embers', 50, null, null, null, null),
  (86, 'premium', 0, 'embers', 100, null, null, null, null),
  (87, 'free', 0, 'embers', 50, null, null, null, null),
  (87, 'premium', 0, 'embers', 100, null, null, null, null),
  (88, 'free', 0, 'embers', 50, null, null, null, null),
  (88, 'premium', 0, 'embers', 100, null, null, null, null),
  (89, 'free', 0, 'embers', 50, null, null, null, null),
  (89, 'premium', 0, 'embers', 100, null, null, null, null),
  (90, 'free', 0, 'embers', 200, null, null, null, null),
  (90, 'premium', 0, 'item', null, null, 'relic-emberfall', null, 'legendary'),
  (91, 'free', 0, 'embers', 50, null, null, null, null),
  (91, 'premium', 0, 'embers', 100, null, null, null, null),
  (92, 'free', 0, 'embers', 50, null, null, null, null),
  (92, 'premium', 0, 'embers', 100, null, null, null, null),
  (93, 'free', 0, 'embers', 50, null, null, null, null),
  (93, 'premium', 0, 'embers', 100, null, null, null, null),
  (94, 'free', 0, 'embers', 50, null, null, null, null),
  (94, 'premium', 0, 'embers', 100, null, null, null, null),
  (95, 'free', 0, 'box', null, 'hephaestus', null, null, null),
  (95, 'premium', 0, 'box', null, 'promethean', null, null, null),
  (95, 'premium', 1, 'embers', 2000, null, null, null, null),
  (96, 'free', 0, 'embers', 50, null, null, null, null),
  (96, 'premium', 0, 'embers', 100, null, null, null, null),
  (97, 'free', 0, 'embers', 50, null, null, null, null),
  (97, 'premium', 0, 'embers', 100, null, null, null, null),
  (98, 'free', 0, 'embers', 50, null, null, null, null),
  (98, 'premium', 0, 'embers', 100, null, null, null, null),
  (99, 'free', 0, 'embers', 50, null, null, null, null),
  (99, 'premium', 0, 'embers', 100, null, null, null, null),
  (100, 'free', 0, 'box', null, 'hephaestus', null, null, null),
  (100, 'free', 1, 'item', null, null, 'title-s1-the-relentless', 'title', 'legendary'),
  (100, 'premium', 0, 'item', null, null, 'medal-emberfall-crown', null, 'mythic'),
  (100, 'premium', 1, 'item', null, null, 'title-forged-in-ember', 'title', 'mythic')
) as v(level, lane, ord, kind, embers, box_key, item_key, item_slot, item_rarity);

-- ─────────────────────────── 2 · what a level owes ───────────────────────────

/**
 * The authoritative bundle for one level and lane, in grant order. Empty array = no such level,
 * which the claim path treats as a refusal rather than as "grant nothing".
 */
create or replace function pass_level_rewards(p_season text, p_level int, p_lane text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $plr$
  select coalesce(jsonb_agg(
    jsonb_strip_nulls(jsonb_build_object(
      'kind', kind, 'embers', embers, 'box_key', box_key,
      'item_key', item_key, 'item_slot', item_slot, 'item_rarity', item_rarity
    )) order by ord
  ), '[]'::jsonb)
  from pass_track_rewards
  where season_id = p_season and level = p_level and lane = p_lane;
$plr$;

-- Not granted to anon/authenticated: same reasoning as #151. The client already ships the track;
-- it has no need to ask the server for it, and this is called from claim_pass_level, which runs as
-- its definer.
revoke all on function pass_level_rewards(text, int, text) from public, anon, authenticated;

-- ─────────────────────────── 3 · evidence ───────────────────────────

/**
 * Every claim whose client-sent array disagreed with the season's own track.
 *
 * Before this migration a mismatch was a successful theft and left no trace, so there is no way to
 * know from the existing tables whether anyone exploited it. From here a mismatch is inert — the
 * claim pays the real bundle regardless — and this is the only place it shows up.
 *
 * Expect a trickle of benign rows from clients running an older track after any future retune.
 * A row whose `claimed` is wildly richer than `granted` is the other thing.
 */
create table if not exists pass_claim_mismatches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  season_id text not null,
  level int not null,
  lane text not null,
  claimed jsonb not null,
  granted jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists pass_claim_mismatches_recent_idx
  on pass_claim_mismatches (created_at desc);

alter table pass_claim_mismatches enable row level security;
-- No policy at all: service-role/admin reads only. A user has no business reading the log of
-- who tried what.

-- ─────────────────────────── 4 · the claim ───────────────────────────

/**
 * Body is the live 0074 definition, unchanged except where noted:
 *
 *   · v_expected / v_claimed_norm declared, for the bundle and the mismatch record;
 *   · the granting loop reads pass_level_rewards(...) instead of jsonb_array_elements(p_rewards);
 *   · an empty bundle raises, so an unknown level cannot claim silently;
 *   · a disagreeing p_rewards is recorded.
 *
 * Every gate 0074 established is still here and still first: signed in, known lane, season phase,
 * pass state exists, premium owned, level actually reached, and the pass_claims row going in ahead
 * of any grant so a double-tap raises before it pays twice. Verified by diffing prosrc before and
 * after — the only removed lines are the ones listed above.
 *
 * The p_rewards shape check is deliberately KEPT even though the value is ignored, so a
 * malformed call still fails the same way it used to instead of quietly changing behaviour.
 */
create or replace function claim_pass_level(p_level int, p_lane text, p_rewards jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $cpl$
declare
  v_user uuid := auth.uid();
  v_season text := season_config() ->> 'id';
  v_state forge_pass_state;
  v_phase text := season_phase();
  v_reward jsonb;
  v_kind text;
  v_granted int := 0;
  v_expected jsonb;
begin
  if v_user is null then raise exception 'Not signed in'; end if;

  if p_lane not in ('free', 'premium') then
    raise exception 'Unknown lane %', p_lane;
  end if;

  if jsonb_typeof(p_rewards) <> 'array' or jsonb_array_length(p_rewards) = 0 then
    raise exception 'No rewards to claim';
  end if;

  -- Claims survive the freeze for the grace window, then stop. 'upcoming' can't happen in practice
  -- (there'd be no XP) but is refused explicitly rather than left to fall through.
  if v_phase = 'closed' then
    raise exception 'The % season has closed and its rewards have expired.', v_season;
  elsif v_phase = 'upcoming' then
    raise exception 'The % season has not started yet.', v_season;
  end if;

  select * into v_state from forge_pass_state where user_id = v_user and season_id = v_season;
  if v_state.user_id is null then raise exception 'No Pass progress this season yet'; end if;

  if p_lane = 'premium' and not v_state.owns_premium then
    raise exception 'The Premium track needs this season''s Forge Pass';
  end if;

  if p_level > economy_level_from_xp(v_state.pass_xp) then
    raise exception 'You have not reached level % yet', p_level;
  end if;

  -- ── #144 · the season decides, not the caller ──
  v_expected := pass_level_rewards(v_season, p_level, p_lane);
  if jsonb_array_length(v_expected) = 0 then
    raise exception 'Level % has no % reward in season %', p_level, p_lane, v_season;
  end if;

  -- The claim row goes in FIRST and its unique index is what makes this idempotent: a double-tapped
  -- Claim button raises here, before a single reward is granted, rather than paying out twice.
  insert into pass_claims (user_id, season_id, tier, lane) values (v_user, v_season, p_level, p_lane);

  for v_reward in select * from jsonb_array_elements(v_expected) loop
    v_kind := v_reward ->> 'kind';
    if v_kind = 'embers' then
      perform economy_move_embers(v_user, (v_reward ->> 'embers')::int, 'forge_pass', null);
    elsif v_kind = 'box' then
      insert into loot_boxes (user_id, box_key, obtained_via, provenance)
      values (v_user, v_reward ->> 'box_key', 'forge_pass', 'Forge Pass · level ' || p_level);
    elsif v_kind = 'item' then
      perform economy_grant_cosmetic(
        v_user, v_reward ->> 'item_key', v_reward ->> 'item_slot', v_reward ->> 'item_rarity',
        'forge_pass', 'Forge Pass · level ' || p_level
      );
    elsif v_kind = 'badge' then
      insert into owned_badges (user_id, badge_key, source, provenance)
      values (v_user, v_reward ->> 'item_key', 'forge_pass', 'Forge Pass · level ' || p_level)
      on conflict do nothing;
    else
      raise exception 'Unknown reward kind %', v_kind;
    end if;
    v_granted := v_granted + 1;
  end loop;

  -- Recorded, never enforced. See the header for why this does not raise.
  if p_rewards is distinct from v_expected then
    insert into pass_claim_mismatches (user_id, season_id, level, lane, claimed, granted)
    values (v_user, v_season, p_level, p_lane, p_rewards, v_expected);
  end if;

  return jsonb_build_object('level', p_level, 'lane', p_lane, 'granted', v_granted);
end;
$cpl$;
