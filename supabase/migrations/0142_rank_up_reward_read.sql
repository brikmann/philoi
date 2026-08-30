-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0142 · Let the rank-up celebration say what it paid
--
-- The rank-up is the biggest reward moment in the app and the only one that fakes its reward. The
-- celebration draws rising embers as a per-tier VISUAL SIGNATURE — they are particles, not the
-- grant — so a user crosses a tier, watches the loudest animation the product has, and is never
-- told they received 500 embers and a Furnace Box. Every other payout now shows its figures; this
-- one has always celebrated the band cross alone.
--
-- Modelled on get_my_unseen_challenge_rewards rather than inventing a fetch: a pure, read-only RPC
-- over what the grant already wrote, called by the presenter, granting nothing.
--
-- 🔒 READ ONLY. economy_track_rank_change (0121) already moved the embers and minted the box at the
-- moment the rank landed. This re-derives WHICH reward row that was, by the same three-way test the
-- trigger used, and reads the config it paid from. Nothing here writes.
--
-- No new columns and no fire-once flag, deliberately. rank_up_events already stores both tiers, and
-- the client's own de-dupe (lib/rank-watch.ts writes the last rank it actually showed) is what
-- decides whether a celebration plays — unlike challenges, where the flag has to live server-side
-- because settlement happens while the app is shut. Adding a second, redundant seen-flag here would
-- be two sources of truth for one question.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- Signature is new, so no drop-first dance is needed. If this ever gains or loses a column, DROP it
-- first: Postgres will not replace a function whose OUT-parameter shape changed, and the error it
-- raises names the wrong thing entirely.
create or replace function get_my_last_rank_up_reward()
returns table (
  kind text,
  embers int,
  box_key text,
  to_tier text,
  to_division int,
  awarded_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  -- 🔴 EVERY column is qualified with its table alias. RETURNS TABLE puts `kind`, `embers`,
  -- `box_key`, `to_tier` and `to_division` into scope as OUT parameters, and each of those SHADOWS
  -- the identically-named column on rank_up_rewards / rank_up_events. Unqualified, this silently
  -- compares a column against itself and returns nulls or the whole table — a failure this repo has
  -- already shipped once.
  select
    rur.kind,
    rur.embers,
    rur.box_key,
    rue.to_tier,
    rue.to_division,
    rue.created_at
  from rank_up_events rue
  join rank_up_rewards rur
    on rur.kind = case
         when rue.to_tier = 'primordial' then 'primordial'
         when rue.to_tier <> rue.from_tier then 'tier'
         else 'division'
       end
  where rue.user_id = auth.uid()
  order by rue.created_at desc
  limit 1;
$$;

-- Same posture as the other reward reads: the caller may only ever see their own, which auth.uid()
-- inside the body enforces regardless of who holds execute.
revoke all on function get_my_last_rank_up_reward() from public, anon;
grant execute on function get_my_last_rank_up_reward() to authenticated;
