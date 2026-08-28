-- 0121 — a division or tier rank-up now PAYS: embers, a box, and a bell row carrying the reveal
-- payload (mock 131).
--
-- LOGIC_AUDIT §"rank-up reward grant": 0066 already detects the crossing, records it in
-- rank_up_events and credits 500 pass-XP. It has never granted anything. There is a full
-- celebration on the client (RankUpWatcher -> RankUpCelebration) with no reward behind it.
--
-- Full redefinition of 0066's economy_track_rank_change(). The detection half — score, index,
-- high-water mark, "a dip never pays", "first sighting is a baseline" — is 0066's, unchanged, so
-- the rule that made rank-ups honest is not re-derived by hand.

-- ─────────────────────── the trigger fires late enough to see the XP ───────────────────────
--
-- 0066 named this trigger `check_ins_rank_tracking`, and Postgres fires same-timing row triggers
-- in NAME order. `on_check_in_insert` is the AFTER INSERT that writes check_ins.xp_earned, and
-- universal_score() sums exactly that column — so 'check_ins_rank_tracking' < 'on_check_in_insert'
-- meant the rank was always evaluated with the CURRENT check-in worth zero.
--
-- Harmless while the only consequence was a bookkeeping row a check-in late. It is not harmless
-- now: the check-in that actually crosses into Gold would pay its box on the NEXT check-in, and
-- the celebration the client fires (RankUpWatcher polls get_my_ranks, which reads the live score)
-- would play a rank-up whose reward had not been granted yet.
--
-- Renaming is the fix Postgres actually offers for ordering. Same function, same timing, same
-- table — only the name changes, and 'on_check_in_insert' < 'on_check_in_rank_tracking'.
drop trigger if exists check_ins_rank_tracking on check_ins;
drop trigger if exists on_check_in_rank_tracking on check_ins;
create trigger on_check_in_rank_tracking
  after insert on check_ins
  for each row execute function economy_track_rank_change();

-- ─────────────────────── what a rank-up is worth ───────────────────────
--
-- Tunable, so it is a table read rather than three literals buried in a function body — the same
-- reasoning as relic_ladders in 0119. `kind` is the rank-up's shape, not its rank, so the whole
-- ladder is covered by three rows.
--
--   division  — Silver III -> Silver II. Frequent, so the smallest payout.
--   tier      — Silver I -> Gold III. The nameable moment.
--   primordial— the apex. Once per account, ever.
create table if not exists rank_up_rewards (
  kind text primary key check (kind in ('division', 'tier', 'primordial')),
  embers int not null check (embers >= 0),
  box_key text not null
);

alter table rank_up_rewards enable row level security;
drop policy if exists rank_up_rewards_read on rank_up_rewards;
-- Readable: "what do I get for ranking up" is a question the client should be able to answer
-- before the fact, not only from a payout it already received.
create policy rank_up_rewards_read on rank_up_rewards for select to authenticated using (true);

insert into rank_up_rewards (kind, embers, box_key) values
  ('division',   100, 'ignition'),
  ('tier',       300, 'furnace'),
  ('primordial', 1200, 'promethean')
on conflict (kind) do update set
  embers = excluded.embers,
  box_key = excluded.box_key;

-- ─────────────────────── the paying version ───────────────────────
--
-- ENUMS, AND WHY THERE IS NO `ALTER TYPE` HERE. `ember_reason` has no 'rank_up' value and
-- `box_obtained_via` has no 'rank_up' either. Adding one would mean a new enum value that cannot
-- be used in the transaction that creates it, plus a matching widen of the literal unions in
-- src/types/database.ts and src/lib/api/inventory.ts — a client change on a shared file for a
-- ledger label. A rank IS season progression, so the existing 'season_reward' / 'season' say the
-- true thing, and the provenance string carries the detail a human would actually want.
--
-- THE CAST IS NOT DECORATION. 0114 exists because `case ... end` over two bare literals resolves
-- to TEXT, and there is no implicit text -> enum cast, so economy_move_embers(uuid,int,text,uuid)
-- was looked up, did not exist, and grant_reward raised on every call it ever received. v_embers
-- here comes from a variable, so the reason is written as an explicit ::ember_reason to make the
-- resolution unambiguous rather than relying on the bare-literal path that happens to work.
--
-- PAYS ONCE PER CROSSING, NOT PER RANK. A single check-in can jump several ranks; the reward is
-- decided by where the user LANDED, so a Silver III -> Gold III jump pays the tier reward once
-- rather than three division rewards plus a tier one. Primordial takes precedence over both.
create or replace function economy_track_rank_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_score numeric;
  v_index int;
  v_prev int;
  v_from record;
  v_to record;
  v_season text := (select value ->> 'id' from economy_config where key = 'season');
  v_kind text;
  v_reward rank_up_rewards;
  v_div text;
  v_label text;
begin
  v_score := universal_score(new.user_id);
  v_index := rank_index_for_score(v_score);
  if v_index is null then return new; end if;

  select rank_index into v_prev from user_rank_state where user_id = new.user_id;

  insert into user_rank_state (user_id, rank_index) values (new.user_id, v_index)
  on conflict (user_id) do update
    set rank_index = greatest(user_rank_state.rank_index, excluded.rank_index),
        updated_at = now();

  -- First sighting establishes the baseline without claiming a rank-up for the whole history.
  if v_prev is null or v_index <= v_prev then return new; end if;

  select tier, division into v_to   from rank_thresholds where rank_index = v_index;
  select tier, division into v_from from rank_thresholds where rank_index = v_prev;

  insert into rank_up_events (user_id, from_rank_index, to_rank_index,
                              from_tier, from_division, to_tier, to_division, season_id)
  values (new.user_id, v_prev, v_index, v_from.tier, v_from.division,
          v_to.tier, v_to.division, v_season);

  -- Unchanged from 0066. Deduped on (user, achievement, period) inside
  -- economy_credit_pass_xp_for, so this is once per season however many ranks are crossed.
  perform economy_credit_pass_xp_for(new.user_id, 'season_new_rank', 500, v_season);

  -- ───────────────── the reward ─────────────────
  v_kind := case
    when v_to.tier = 'primordial' then 'primordial'
    when v_to.tier <> v_from.tier then 'tier'
    else 'division'
  end;

  select * into v_reward from rank_up_rewards where kind = v_kind;
  -- A missing config row must not take the check-in down with it: the rank-up is still recorded
  -- and the XP still credited above, there is simply nothing to pay.
  if v_reward.kind is null then return new; end if;

  -- Primordial carries no division (0063 stores it as 1 purely so the ordinal still sorts above
  -- Immortal I); every other tier is III/II/I, lowest to highest.
  v_div := case when v_to.tier = 'primordial'
                then ''
                else ' ' || (array['', 'I', 'II', 'III'])[v_to.division + 1] end;
  v_label := initcap(v_to.tier) || v_div;

  if v_reward.embers > 0 then
    perform economy_move_embers(new.user_id, v_reward.embers, 'season_reward'::ember_reason, null);
  end if;

  insert into loot_boxes (user_id, box_key, obtained_via, provenance)
  values (new.user_id, v_reward.box_key, 'season'::box_obtained_via,
          'Rank-up reward · ' || v_label);

  -- ───────────────── the bell row + reveal payload ─────────────────
  -- actor_id null for the same reason as 0120's recap: notify_event drops any recipient equal to
  -- the actor, so a self-notification with the user as actor writes nothing at all.
  -- Routed to /inventory because that is where the unopened box now sits — the reveal screen
  -- reads `payload` for what to animate before sending them there.
  perform notify_event(
    array[new.user_id], 'ranked_up',
    '⚔️ You ranked up — ' || v_label,
    case v_kind
      when 'primordial' then 'You reached Primordial. The king himself bows toward your greatness.'
      when 'tier'       then 'A new tier. +' || v_reward.embers || ' embers and a box are waiting.'
      else                   'Up a division. +' || v_reward.embers || ' embers and a box are waiting.'
    end,
    null, null,
    '/inventory', '{}'::jsonb,
    null, 'hexagon',
    jsonb_build_object('embers', v_reward.embers, 'box', v_reward.box_key,
                       'rank', v_label, 'kind', v_kind,
                       'from_rank_index', v_prev, 'to_rank_index', v_index)
  );

  return new;
end;
$$;
