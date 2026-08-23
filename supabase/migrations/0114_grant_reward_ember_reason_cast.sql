-- 0114 — grant_reward has raised on every real call it has ever received. Two missing casts.
--
-- grant_reward has never once paid out. The defect predates 0083 and survived two rewrites: 0064
-- wrote it, 0066 restated it, 0083 recalibrated it, and all three carry the same line. It folds
-- the ember reason into a CASE:
--
--   perform economy_move_embers(p_user, v_embers,
--     case when p_type = 'season' then 'season_reward' else 'challenge_win' end, p_ref);
--
-- economy_move_embers' third parameter is `ember_reason`, an ENUM (0064). A bare literal is fine
-- there — 'challenge_win' arrives as `unknown` and Postgres happily resolves it to the enum, which
-- is why the `not p_verified` early-return a dozen lines above still works. A CASE is not: with
-- both branches `unknown`, the expression resolves to TEXT, and there is no implicit text -> enum
-- cast. So the call becomes economy_move_embers(uuid, integer, text, uuid), which does not exist:
--
--   ERROR:  42883: function economy_move_embers(uuid, integer, text, uuid) does not exist
--
-- It fails at RUNTIME, not at create time, because plpgsql resolves the call the first time the
-- line is reached — so the migration deployed clean and the breakage only shows up when somebody
-- actually earns something.
--
-- HOW BIG THIS IS: every live caller passes p_verified => true, so the working early-return path
-- is dead code and the broken line is the only one that ever runs. All three of them raise:
--
--   * economy_on_challenge_completed  — the AFTER UPDATE trigger on `challenges`. Completing a
--     personal goal therefore THROWS, and because the trigger fires inside the same statement,
--     it takes log_challenge_progress down with it: the user's last log before hitting the target
--     is the one that errors. The goal never records as complete and never pays.
--   * economy_on_social_challenge_closed — the winner/loser payout on a settled challenge.
--   * close_season_scope — season placement rewards.
--
-- Nothing has EVER been paid out by any of them. The ledger says so outright — every other ember
-- reason has rows, and the two this function writes have none at all:
--
--   reason       |   n | last
--   shop_spend   | 424 | 2026-08-20
--   salvage      | 304 | 2026-08-20
--   flame_meter  |  19 | 2026-08-23
--   lock_in      |   4 | 2026-08-22
--   iap          |   2 | 2026-08-16
--   challenge_win  — none, ever
--   season_reward  — none, ever
--
-- goal_daily and goal_streak are empty for the same reason, one step removed: the client only
-- calls economy_award_goal_day when log_challenge_progress reports just_completed, and that RPC
-- is what raises here, so it never reports anything.
--
-- Verified against the linked project before and after: calling
-- `grant_reward(<user>, 'friend_h2h', 1.0, 7, 1, 0.0, true, null)` raises 42883 today, and returns
-- a reward jsonb with this migration applied.
--
-- THE SAME MISTAKE APPEARS TWICE, three lines apart. The loot-box insert immediately below the
-- ember call does the identical thing to `loot_boxes.obtained_via`, which is the enum
-- `box_obtained_via`:
--
--   insert into loot_boxes (..., obtained_via, ...)
--   values (..., case when p_type = 'season' then 'season' else 'challenge' end, ...)
--
--   ERROR:  42804: column "obtained_via" is of type box_obtained_via but expression is of type text
--
-- That one was invisible behind the first: the function raised on the ember line and never
-- reached the insert. Both are cast here — fixing only the reported error would just have moved
-- the failure down three lines.
--
-- The body below is 0083's, unchanged except for those two casts — a restatement rather than a
-- targeted patch because plpgsql has no way to replace one line. The signature is identical, so
-- `create or replace` is correct here and no overload is created.
--
-- Deliberately NOT adding an economy_move_embers(uuid, int, text, uuid) overload to absorb this
-- instead: a text overload sitting beside the enum one would make every bare-literal call site
-- (`'lock_in'`, `'box_open'`, `'salvage'`, …) ambiguous and break the paths that currently work.

create or replace function grant_reward(
  p_user uuid, p_type text, p_difficulty numeric, p_duration_days int,
  p_scope int, p_placement_pct numeric, p_verified boolean, p_ref uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sig numeric;
  v_embers int;
  v_box text;
  v_badge text;
  v_band text;
  v_bands jsonb := (select value from economy_config where key = 'reward_bands');
  v_season text := (select value ->> 'id' from economy_config where key = 'season');
begin
  if not p_verified then
    v_embers := coalesce((v_bands ->> 'unverified')::int, 10);
    perform economy_move_embers(p_user, v_embers, 'challenge_win', p_ref);
    return jsonb_build_object('embers', v_embers, 'box', null, 'badge', null, 'band', 'completion');
  end if;

  -- Significance is UNTOUCHED. The thresholds below still carve the same curve; only what each
  -- band pays has moved, so the relative ordering of "how impressive was this" is preserved.
  v_sig := p_difficulty
         * greatest(1, log(greatest(p_scope, 1)::numeric + 1))
         * greatest(1, p_duration_days::numeric / 7)
         * greatest(0.2, 1 - coalesce(p_placement_pct, 1));

  if    v_sig >= 24 then v_band := 'apex';       v_box := 'promethean';
  elsif v_sig >= 12 then v_band := 'elite';      v_box := 'hephaestus';
  elsif v_sig >= 6  then v_band := 'impressive'; v_box := 'hestia';
  elsif v_sig >= 3  then v_band := 'notable';    v_box := 'furnace';
  elsif v_sig >= 1  then v_band := 'casual';     v_box := 'ignition';
  else                   v_band := 'completion'; v_box := null;
  end if;

  -- coalesce so a malformed/missing config row degrades to the completion floor rather than
  -- writing a NULL delta into the ledger.
  v_embers := coalesce((v_bands ->> v_band)::int, 10);

  perform economy_move_embers(p_user, v_embers, case when p_type = 'season' then 'season_reward' else 'challenge_win' end::ember_reason, p_ref);

  if v_box is not null then
    insert into loot_boxes (user_id, box_key, obtained_via, provenance)
    values (p_user, v_box, case when p_type = 'season' then 'season' else 'challenge' end::box_obtained_via,
            case when p_type = 'season' then 'Season reward · ' || v_season else 'Challenge reward' end);
  end if;

  -- The prestige half (§5 / 21c): the top two bands mint an UN-BUYABLE earned badge. This is what
  -- the biggest wins are actually for — the embers above are the same currency anyone can buy, so
  -- on their own they'd make a season win feel purchasable.
  if v_band in ('elite', 'apex') then
    v_badge := case
      when p_type = 'season' then 'season-' || v_band || '-' || v_season
      else 'challenge-' || v_band
    end;
    perform economy_grant_badge(
      p_user, v_badge,
      case when p_type = 'season'
        then 'Season ' || v_season || ' · ' || initcap(v_band) || ' finish'
        else initcap(v_band) || ' challenge win'
      end
    );
  end if;

  return jsonb_build_object('embers', v_embers, 'box', v_box, 'badge', v_badge, 'band', v_band, 'significance', v_sig);
end;
$$;

