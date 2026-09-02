-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- 0160 · THE WRITE PATH. Cindy proposes a tier; this is the only thing that can store one.
--
-- 0159 built the pricing and left it inert: the columns existed, the discount existed, and nothing
-- could set `difficulty_tier`, so every row stayed null and every payout stayed exactly what it was.
-- This is the door, and it is deliberately narrow.
--
-- ─────────────────────────── WHERE THE FIREWALL ACTUALLY IS ───────────────────────────
--
-- The brief says "never let the client pass a tier the server trusts blindly". That has to be read
-- against how Cindy is built, which is not how it might sound: per _shared/coach/tools.ts, **the
-- server never executes a model action.** The model proposes, and the CLIENT performs, through the
-- same functions the UI already calls, under the user's own JWT. There is no service-role executor
-- to put the tier behind — building one for this would hand an LLM write access to the economy,
-- which is the exact thing that file's firewall exists to prevent.
--
-- So the tier necessarily arrives from the client, and the security has to sit somewhere the client
-- cannot reach. It sits in three places:
--
--   1. THE TIER IS VALIDATED, not trusted — one of six names, enforced here and again by the CHECK
--      constraint 0159 put on the column.
--
--   2. VERIFIABILITY IS DERIVED, NEVER PASSED. This is the one that matters. `auto` is the only
--      path to the top three boxes (goal_paid_band caps every honor claim at 'notable'), and it is
--      computed here from the goal's own shape — the metric it measures and how it is counted — not
--      from anything the caller says. A client cannot claim to be Strava-tracked.
--
--   3. THE PAYOUT IS RE-DERIVED. Nothing stores an ember figure or a box key. grant_reward reads
--      the tier plus economy_config at completion time, exactly as 0159 wired it.
--
-- So the worst a lying client can do is claim `mythic` on a hand-logged goal — and because a
-- hand-logged goal is `honor` by derivation, goal_paid_band drops it to 'notable' and it collects
-- The Furnace. Which is the same thing an honest Epic collects. There is no lie that pays.
--
-- ─────────────────────────── ONE SHOT, BEFORE THE FACT ───────────────────────────
--
-- Scoping is refused once a goal carries a tier, and refused once it is complete. Both close the
-- same hole from different sides: a goal you could re-scope is a goal you can finish cheap and
-- re-price expensive on the way to the reveal.
-- ══════════════════════════════════════════════════════════════════════════════════════════════

create or replace function set_goal_scope(p_goal_id uuid, p_tier text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_goal challenges;
  v_verif text;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;

  if p_tier is null or p_tier not in ('common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic') then
    raise exception 'Unknown difficulty tier.';
  end if;

  -- security definer bypasses RLS, so ownership is checked here or not at all.
  select * into v_goal from challenges c where c.id = p_goal_id and c.user_id = auth.uid();
  if v_goal.id is null then
    raise exception 'That goal is not yours.';
  end if;

  if v_goal.completed_at is not null then
    raise exception 'That goal is already finished.';
  end if;

  if v_goal.difficulty_tier is not null then
    raise exception 'That goal has already been scoped.';
  end if;

  -- ── the derivation the client cannot influence ──
  --
  -- `auto` means the app OBSERVES the achievement rather than being told about it:
  --   · every built-in metric — steps, distance, workout minutes, strain, sleep from a connected
  --     source; study hours and gym visits from the user's own lock-ins. All measured.
  --   · a custom goal counted in lock-in TIME, which is a clock the app runs, not a number typed
  --     into a box.
  --
  -- Everything else is `honor`: a custom goal whose progress is a count the user enters. That is
  -- the whole population of "type a hard thing and tick it done", and it is exactly the population
  -- goal_paid_band caps at The Furnace.
  --
  -- Note what this does NOT do: it never reads a claim, a photo, or a vouch. Upgrading an honor
  -- goal to auto on proof is the vouch flow, and it belongs to whatever writes that proof — not to
  -- the function that scopes a goal before it has been attempted.
  v_verif := case
    when v_goal.type <> 'custom' then 'auto'
    when v_goal.count_mode = 'lockin_time' then 'auto'
    else 'honor'
  end;

  update challenges
     set difficulty_tier = p_tier,
         verifiability = v_verif
   where id = p_goal_id;

  -- Hands back the same preview the create screen would have asked for, so scoping and showing the
  -- reward are one round trip rather than two — and so the number on screen is unambiguously the
  -- one the server just committed to, not a second computation of it.
  return preview_challenge_reward(
    p_tier,
    v_verif,
    case when v_goal.period = 'week' then 7 else 1 end,
    1
  );
end;
$$;

comment on function set_goal_scope(uuid, text) is
  '0160 — stores Cindy''s scoped tier on a goal and DERIVES its verifiability server-side. One shot, owner only, before completion. Returns preview_challenge_reward for the tier it just wrote.';

revoke all on function set_goal_scope(uuid, text) from public;
grant execute on function set_goal_scope(uuid, text) to authenticated;

-- ─────────────────────────── §4 · the same door for a duel or a campfire race ───────────────────────────
--
-- Creator only, and only while the race has not started — once anyone is racing, the prize is part
-- of the deal they accepted.
--
-- ⚠️ THIS STORES THE TIER; IT DOES NOT YET SPEND IT. economy_on_social_challenge_closed is what
-- settles a social challenge, and it already carries its own honour knobs from 0145 (p_difficulty
-- scaling plus a p_max_band ceiling for grade races). Teaching it to read this column is a change
-- to the settlement path for every live duel on prod, and it belongs in its own migration with its
-- own before/after on real settled rows — not bolted onto the one that opens the column. Until
-- then a scoped duel settles exactly as it does today, and the column is a record of intent.
create or replace function set_challenge_scope(p_challenge_id uuid, p_tier text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ch social_challenges;
  v_verif text;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;

  if p_tier is null or p_tier not in ('common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic') then
    raise exception 'Unknown difficulty tier.';
  end if;

  select * into v_ch from social_challenges c where c.id = p_challenge_id;
  if v_ch.id is null then
    raise exception 'Challenge not found.';
  end if;
  if v_ch.created_by <> auth.uid() then
    raise exception 'Only the person who set it can scope it.';
  end if;
  if v_ch.status not in ('draft', 'pending') then
    raise exception 'That challenge has already started.';
  end if;
  if v_ch.difficulty_tier is not null then
    raise exception 'That challenge has already been scoped.';
  end if;

  -- Same derivation, same reason: a race scored off an observed metric is auto; a free-text one is
  -- honor. race_metric is null on a plain count-target collective goal, which is the honour case.
  v_verif := case
    when v_ch.race_metric in ('lockin_time', 'volume', 'distance') then 'auto'
    else 'honor'
  end;

  update social_challenges
     set difficulty_tier = p_tier,
         verifiability = v_verif
   where id = p_challenge_id;

  return preview_challenge_reward(
    p_tier,
    v_verif,
    greatest(1, coalesce(v_ch.window_hours, 24) / 24),
    1
  );
end;
$$;

comment on function set_challenge_scope(uuid, text) is
  '0160 — stores a scoped tier on a duel/campfire challenge, verifiability derived from its race metric. Creator only, before start. NOT yet read by settlement — see the header.';

revoke all on function set_challenge_scope(uuid, text) from public;
grant execute on function set_challenge_scope(uuid, text) to authenticated;

-- ─────────────────────────── the derivation, asserted ───────────────────────────
do $assert$
begin
  -- A hand-counted custom goal is the honour population, and no tier it claims reaches a top box.
  if goal_paid_band('mythic', 'honor') is distinct from 'notable' then
    raise exception 'a hand-logged mythic claim must still cap at notable';
  end if;
  -- A Strava-tracked one is the only path that does.
  if goal_paid_band('legendary', 'auto') is distinct from 'elite' then
    raise exception 'an observed legendary must pay elite';
  end if;
end
$assert$;
