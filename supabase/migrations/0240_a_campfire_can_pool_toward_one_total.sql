-- 0240 — a campfire can pool toward ONE total, and pay whoever carried it (punchlist: Cindy Q&A #3).
--
-- ─────────────────────────── what was missing ───────────────────────────
--
-- "Everyone contributes toward 500 km cumulatively, and once we hit it the top contributor is
-- paid." Two campfire shapes existed and neither is that:
--
--   · collective (0169) — EVERY member clears the SAME bar ("everyone runs 500 km"). Settlement
--     passes only when v_completed_count >= v_field_count. Read as a pool, a 500 km club goal was
--     a 500 km goal per person, which nobody finishes.
--   · placement — ranked on most, no target at all.
--
-- ─────────────────────────── the shape ───────────────────────────
--
-- Still shape 'collective', plus a `pooled` flag — NOT a new shape value. Installed builds switch on
-- `shape`, and a value they have never seen is the class of bug that took builds down on an unknown
-- goal_type. To an old build a pooled challenge is a collective with a target, which is the closest
-- honest rendering it can do; the new build reads the flag through get_pooled_progress.
--
--   · the bar is the SUM of the field's challenge_racer_score against target_value (raw units:
--     metres, pounds, seconds — the same units challenge_metric_value sums);
--   · it settles the moment the sum reaches the bar (the 10-minute sweep picks it up), not only at
--     ends_at — "once we hit it" is the user's own trigger;
--   · contributors (final_value > 0) are paid; with reward_top_contributor the top contributor (all
--     rank-1 ties) is paid at the top placement band, everyone else at the collective band. Nobody
--     who moved nothing is paid — enrolment is not effort (same rule as placement).
--   · created ACTIVE with the whole campfire enrolled and baselined, exactly like
--     create_placement_challenge. A collective created through create_group_challenge is a DRAFT with
--     nobody invited, which is a dead end from the Q&A's "Lock it in".
--
-- 🔒 finalize_social_challenges and economy_on_social_challenge_closed are restated from their LIVE
-- bodies (md5 checked in the block at the end), with one branch inserted in each and the sweep's
-- selection widened. Nothing else in either body changes.

alter table social_challenges add column if not exists pooled boolean not null default false;
alter table social_challenges add column if not exists reward_top_contributor boolean not null default false;

comment on column social_challenges.pooled is
  '0240 — a collective whose bar is the SUM of the field''s scores against target_value, not every member clearing it. Settles as soon as the sum reaches the bar.';
comment on column social_challenges.reward_top_contributor is
  '0240 — on a pooled collective, the top contributor (all rank-1 ties) is paid at the top placement band.';

-- ─────────────────────────── the pool ───────────────────────────

create or replace function challenge_pool_total(p_challenge_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(challenge_racer_score(sc.id, f.user_id)), 0)
  from social_challenges sc
  cross join lateral challenge_field(sc.id, sc.circle_id) f
  where sc.id = p_challenge_id;
$$;

revoke execute on function challenge_pool_total(uuid) from public, anon, authenticated;

-- ─────────────────────────── the create ───────────────────────────

create or replace function create_pooled_challenge(
  p_circle_id uuid,
  p_race_metric text,
  p_target_value numeric,
  p_window_hours integer,
  p_public_name text default null,
  p_reward_top_contributor boolean default false,
  p_tier text default null,
  p_starts_on timestamptz default null,
  p_ends_on timestamptz default null,
  p_payout_xp integer default 300
)
returns social_challenges
language plpgsql
security definer
set search_path = public
as $$
declare
  v_challenge social_challenges;
  v_starts timestamptz;
begin
  perform assert_challenge_span(p_starts_on, p_ends_on);

  if not is_campfire_admin(p_circle_id, auth.uid()) then
    raise exception 'Only campfire admins can set a campfire goal.';
  end if;
  -- The three metrics that accumulate on their own. A count is people typing numbers, and a pool
  -- of typed numbers is a target anyone can clear for everyone with one entry.
  if p_race_metric is null or p_race_metric not in ('distance', 'volume', 'lockin_time') then
    raise exception 'A shared total has to be distance, volume or lock-in time.';
  end if;
  if p_target_value is null or p_target_value <= 0 then
    raise exception 'A shared total has to be more than zero.';
  end if;

  v_starts := coalesce(p_starts_on, now());

  insert into social_challenges (
    circle_id, created_by, mode, shape, race_metric, target_count, target_value, window_hours, payout_xp,
    status, starts_at, ends_at, public_name, starts_on, ends_on, pooled, reward_top_contributor
  )
  values (
    p_circle_id, auth.uid(), 'group', 'collective', p_race_metric, null, p_target_value, p_window_hours, p_payout_xp,
    case when v_starts <= now() then 'active' else 'draft' end,
    case when v_starts <= now() then now() else null end,
    case when v_starts <= now() then coalesce(p_ends_on, now() + make_interval(hours => p_window_hours)) else null end,
    nullif(btrim(coalesce(p_public_name, '')), ''),
    p_starts_on, p_ends_on, true, coalesce(p_reward_top_contributor, false)
  )
  returning * into v_challenge;

  insert into challenge_participants (challenge_id, user_id, state, responded_at, baseline)
  select v_challenge.id, gm.user_id, 'accepted', now(),
         case when v_challenge.status = 'active'
           then challenge_metric_value(p_race_metric, gm.user_id, now())
           else 0 end
  from group_members gm
  where gm.group_id = p_circle_id
  on conflict (challenge_id, user_id) do nothing;

  perform notify_event(
    (select coalesce(array_agg(gm.user_id), '{}') from group_members gm
      where gm.group_id = p_circle_id and gm.user_id <> auth.uid()),
    'campfire_challenge_started',
    'Your campfire has a shared goal',
    coalesce(v_challenge.public_name, 'A shared goal') || ' — everything you log counts toward it.',
    null, p_circle_id,
    '/challenge-info/[challengeId]', jsonb_build_object('challengeId', v_challenge.id::text),
    null, 'rounded',
    jsonb_build_object('challenge_id', v_challenge.id, 'shape', 'collective', 'pooled', true)
  );

  if p_tier is not null then
    perform scope_challenge_at_create(v_challenge.id, p_tier);
    select * into v_challenge from social_challenges where id = v_challenge.id;
  end if;

  return v_challenge;
end;
$$;

revoke execute on function create_pooled_challenge(uuid, text, numeric, integer, text, boolean, text, timestamptz, timestamptz, integer) from public, anon;
grant execute on function create_pooled_challenge(uuid, text, numeric, integer, text, boolean, text, timestamptz, timestamptz, integer) to authenticated;

-- ─────────────────────────── the read ───────────────────────────
--
-- A separate read rather than columns on get_my_social_challenges: that function is a long column
-- list, and restating it to add three fields is the operation that has reverted sibling work here.
-- Null for anything that is not a pooled collective, and for a caller who could not see the
-- challenge anyway.
create or replace function get_pooled_progress(p_challenge_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_c social_challenges;
begin
  select * into v_c from social_challenges where id = p_challenge_id;
  if v_c.id is null or not v_c.pooled then return null; end if;
  if not (is_group_member(v_c.circle_id) or v_c.created_by = auth.uid()) then return null; end if;

  return jsonb_build_object(
    'pooled', true,
    'reward_top_contributor', v_c.reward_top_contributor,
    'race_metric', v_c.race_metric,
    'target_value', v_c.target_value,
    -- Settled rows read their frozen standings; a live one is scored now.
    'total', case when challenge_is_live(v_c.status)
                  then challenge_pool_total(v_c.id)
                  else (select coalesce(sum(p.final_value), 0) from challenge_participants p
                         where p.challenge_id = v_c.id and p.state = 'accepted') end,
    'contributors', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', x.user_id, 'display_name', x.display_name, 'value', x.score)
                       order by x.score desc, x.display_name)
      from (
        select f.user_id, pr.display_name,
               case when challenge_is_live(v_c.status) then challenge_racer_score(v_c.id, f.user_id)
                    else coalesce(p.final_value, 0) end as score
        from challenge_field(v_c.id, v_c.circle_id) f
        join profiles pr on pr.id = f.user_id
        left join challenge_participants p on p.challenge_id = v_c.id and p.user_id = f.user_id
      ) x
      where x.score > 0
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function get_pooled_progress(uuid) from public, anon;
grant execute on function get_pooled_progress(uuid) to authenticated;

-- ─────────────────────────── restated: settlement + reward ───────────────────────────
-- Both bodies below are the LIVE ones as of 2026-10-10 plus the pooled branch. Refuse to run if
-- either has moved since, rather than revert whatever moved it.
do $guard$
begin
  if (select md5(prosrc) from pg_proc where oid = 'finalize_social_challenges()'::regprocedure) <> '89e67233f63d97a2cbbb42e50d89e28f' then
    raise exception '0240: finalize_social_challenges changed since this migration was cut — rebase it.';
  end if;
  if (select md5(prosrc) from pg_proc where oid = 'economy_on_social_challenge_closed()'::regprocedure) <> 'c682075daaa383021de221b03cd52038' then
    raise exception '0240: economy_on_social_challenge_closed changed since this migration was cut — rebase it.';
  end if;
end $guard$;

CREATE OR REPLACE FUNCTION public.finalize_social_challenges()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r record;
  v_my numeric;
  v_opp numeric;
  v_field_count int;
  v_completed_count int;
  v_has_roster boolean;
  v_winner uuid;
  v_pool numeric;
begin
  -- Band, not `status = 'active'` (0111). 0096 widened the vocabulary with 'draft', and a sweep
  -- that tests a literal keeps its old meaning silently when the vocabulary grows.
  for r in
    select * from social_challenges sc
    where challenge_is_live(sc.status)
      and (sc.ends_at <= now()
           -- 0240: a pooled goal settles the moment the campfire's total reaches the bar.
           or (sc.pooled and sc.status = 'active' and challenge_pool_total(sc.id) >= sc.target_value))
    for update
  loop

    select exists (select 1 from challenge_participants p where p.challenge_id = r.id)
      into v_has_roster;

    if r.mode = 'h2h' then
      if v_has_roster then
        -- Progress since the gun, not lifetime totals. Evaluated as of ends_at rather than now()
        -- so a sweep that runs late settles the race that was run, not the hours after it.
        -- challenge_racer_score owns both of those rules now, and the grade case besides.
        v_my := challenge_racer_score(r.id, r.created_by);
        v_opp := coalesce(challenge_racer_score(r.id, r.opponent_id), 0);
      else
        -- 0034's path, unchanged, for duels that predate the roster.
        v_my := social_challenge_score(r.created_by, r.race_metric, r.starts_at, r.ends_at);
        v_opp := social_challenge_score(r.opponent_id, r.race_metric, r.starts_at, r.ends_at);
      end if;

      -- THE TARGET IS A FLOOR, NOT A TIEBREAK. On a grade duel both racers committed to the same
      -- mark; missing it means you did not do the thing, so it scores as nothing and the ordinary
      -- comparison below handles every case correctly without a second winner rule:
      --   both clear   → the higher mark wins, level marks draw (0122 pays both)
      --   one clears   → they win outright
      --   neither      → 0 vs 0 → no winner, and 0122's `v_my > 0` guard refuses to pay the draw
      if r.race_metric = 'grade' and r.grade_target is not null then
        if v_my < r.grade_target then v_my := 0; end if;
        if v_opp < r.grade_target then v_opp := 0; end if;
      end if;

      v_winner := case when v_my > v_opp then r.created_by
                       when v_opp > v_my then r.opponent_id
                       else null end;

      update social_challenges set status = 'completed', winner_id = v_winner where id = r.id;

      -- 0122's rule, unchanged: a draw pays BOTH, but only a draw with a real number on it.
      -- `v_my = v_opp and v_my > 0` is the whole guard — a 0 - 0 no-show is still worth nothing,
      -- so "agree to both do nothing" is not a payout strategy, while "we both did 40 km" is a
      -- good fight and is paid like one.
      --
      -- winner_id stays NULL on a tie. It is the record of who won, and nobody did; the payout
      -- reads the scores, not that column.
      if v_winner is not null then
        insert into bonus_xp_awards (user_id, amount, reason, challenge_id)
        values (v_winner, r.payout_xp, 'challenge_h2h_winner', r.id);
      elsif v_my = v_opp and v_my > 0 and r.opponent_id is not null then
        insert into bonus_xp_awards (user_id, amount, reason, challenge_id)
        values (r.created_by,  r.payout_xp, 'challenge_h2h_winner', r.id),
               (r.opponent_id, r.payout_xp, 'challenge_h2h_winner', r.id);
      end if;

      if v_has_roster then
        update challenge_participants p
           set final_value = case when p.user_id = r.created_by then v_my else v_opp end,
               final_rank = case
                 when v_winner is null then 1
                 when p.user_id = v_winner then 1
                 else 2 end,
               final_percentile = case
                 when v_winner is null then 1.0
                 when p.user_id = v_winner then 1.0
                 else 0.0 end
         where p.challenge_id = r.id;
      end if;

    elsif r.shape = 'placement' then
      -- ─────────────────── PLACEMENT: everyone is ranked, everyone who raced is paid ───────────────────
      --
      -- NOTE THE STATEMENT ORDER, WHICH IS DELIBERATELY NOT THE COLLECTIVE ARM'S (0127).
      -- The collective arm flips status first and writes final_rank afterwards, so the reward
      -- trigger (which fires ON that status flip) cannot see the standings and pays everybody the
      -- same flat 0.75 placement figure. A placement race is ENTIRELY about where you finished, so
      -- writing the standings BEFORE the flip is what lets economy_on_social_challenge_closed read
      -- a real percentile out of challenge_participants. Same transaction, ordered on purpose.
      select count(*) into v_field_count from challenge_field(r.id, r.circle_id);

      if v_field_count = 0 then
        -- No field, nothing to rank. 'expired' rather than 'completed' so it is not counted as a
        -- race that happened.
        update social_challenges set status = 'expired' where id = r.id;
      else
        update challenge_participants p
           set final_value = ranked.score,
               final_rank = ranked.placement,
               -- Stored top-is-1.0, matching every other standings writer (0111). The reward path
               -- and the client each invert it for their own convention rather than a second
               -- orientation being stored.
               final_percentile = 1.0 - (ranked.placement - 1)::numeric / greatest(v_field_count - 1, 1)
          from (
            select f.user_id,
                   challenge_racer_score(r.id, f.user_id) as score,
                   rank() over (order by challenge_racer_score(r.id, f.user_id) desc) as placement
            from challenge_field(r.id, r.circle_id) f
          ) ranked
         where p.challenge_id = r.id and p.user_id = ranked.user_id;

        select p.user_id into v_winner
        from challenge_participants p
        where p.challenge_id = r.id and p.state = 'accepted' and p.final_rank = 1 and p.final_value > 0;

        -- Fires the reward trigger, which now has real standings to read.
        update social_challenges set status = 'completed', winner_id = v_winner where id = r.id;

        -- NOT all-or-nothing. That gate belongs to the collective goal, whose whole premise is the
        -- house passing together; a placement race has no shared target to miss, so it pays out on
        -- the band each racer earned.
        --
        -- final_value > 0 IS the entry test, though. placement_multiplier floors at 1.0, so paying
        -- every row would hand full payout_xp to everyone in a 48-person campfire who never opened
        -- the app — which would make being enrolled, rather than racing, the thing that pays.
        insert into bonus_xp_awards (user_id, amount, reason, challenge_id)
        select p.user_id,
               round(r.payout_xp * placement_multiplier(p.final_rank, v_field_count)),
               'challenge_placement',
               r.id
        from challenge_participants p
        where p.challenge_id = r.id and p.state = 'accepted'
          and p.final_rank is not null and p.final_value > 0;
      end if;

    elsif r.pooled then
      -- ─────────────────── 0240 · POOLED: one shared total, paid by contribution ───────────────────
      -- Standings first, as the placement arm does, so the reward trigger fired by the status flip
      -- reads real ranks. The bar is the SUM of the field, not every member clearing it.
      select count(*) into v_field_count from challenge_field(r.id, r.circle_id);

      update challenge_participants p
         set final_value = ranked.score,
             final_rank = ranked.placement,
             final_percentile = 1.0 - (ranked.placement - 1)::numeric / greatest(v_field_count - 1, 1)
        from (
          select f.user_id,
                 challenge_racer_score(r.id, f.user_id) as score,
                 rank() over (order by challenge_racer_score(r.id, f.user_id) desc) as placement
          from challenge_field(r.id, r.circle_id) f
        ) ranked
       where p.challenge_id = r.id and p.user_id = ranked.user_id;

      select coalesce(sum(p.final_value), 0) into v_pool
      from challenge_participants p
      where p.challenge_id = r.id and p.state = 'accepted';

      if v_field_count > 0 and v_pool >= r.target_value then
        v_winner := null;
        if r.reward_top_contributor then
          select p.user_id into v_winner
          from challenge_participants p
          where p.challenge_id = r.id and p.state = 'accepted' and p.final_rank = 1 and p.final_value > 0
          order by p.user_id
          limit 1;
        end if;

        update social_challenges set status = 'completed', winner_id = v_winner where id = r.id;

        -- Contributors only: being enrolled is not effort (same rule as the placement arm).
        insert into bonus_xp_awards (user_id, amount, reason, challenge_id)
        select p.user_id,
               round(r.payout_xp * placement_multiplier(p.final_rank, v_field_count)),
               'challenge_group_completion',
               r.id
        from challenge_participants p
        where p.challenge_id = r.id and p.state = 'accepted'
          and p.final_rank is not null and p.final_value > 0;
      else
        update social_challenges set status = 'expired' where id = r.id;
      end if;

    else
      select count(*) into v_field_count from challenge_field(r.id, r.circle_id);

      -- The completion test is the metric's to define now: a collective lock-in goal counts
      -- qualifying check-ins against target_count, a collective GRADE goal asks whether the racer
      -- cleared grade_target. Same "did the whole house pass" premise either way.
      select count(*) into v_completed_count
      from challenge_field(r.id, r.circle_id) f
      where challenge_racer_completed(r.id, f.user_id);

      if v_completed_count >= v_field_count and v_field_count > 0 then
        update social_challenges set status = 'completed' where id = r.id;

        -- Ordered by the challenge's OWN metric. This used to hardcode 'xp' with a comment
        -- explaining that a collective goal leaves race_metric null so XP is what orders the
        -- field once everyone has met the same target — true then, and still true for a
        -- null-metric goal, which is exactly the case challenge_racer_score's null arm handles.
        -- It stops being true the moment a collective goal HAS a metric, which a grade goal does:
        -- ranking a house that all passed KP451 by their XP would order them by something the
        -- race was not about.
        insert into bonus_xp_awards (user_id, amount, reason, challenge_id)
        select
          ranked.user_id,
          round(r.payout_xp * placement_multiplier(ranked.placement, v_field_count)),
          'challenge_group_completion',
          r.id
        from (
          select f.user_id,
                 rank() over (order by challenge_racer_score(r.id, f.user_id) desc) as placement
          from challenge_field(r.id, r.circle_id) f
        ) ranked;

        if v_has_roster then
          update challenge_participants p
             set final_value = ranked.score,
                 final_rank = ranked.placement,
                 final_percentile = 1.0 - (ranked.placement - 1)::numeric / greatest(v_field_count - 1, 1)
            from (
              select f.user_id,
                     challenge_racer_score(r.id, f.user_id) as score,
                     rank() over (order by challenge_racer_score(r.id, f.user_id) desc) as placement
              from challenge_field(r.id, r.circle_id) f
            ) ranked
           where p.challenge_id = r.id and p.user_id = ranked.user_id;
        end if;
      else
        -- Nobody is paid when the field did not all finish, as in 0034. The standings are still
        -- written so an expired challenge can show what happened instead of just vanishing.
        update social_challenges set status = 'expired' where id = r.id;

        if v_has_roster then
          update challenge_participants p
             set final_value = ranked.score,
                 final_rank = ranked.placement,
                 final_percentile = 1.0 - (ranked.placement - 1)::numeric / greatest(v_field_count - 1, 1)
            from (
              select f.user_id,
                     challenge_racer_score(r.id, f.user_id) as score,
                     rank() over (order by challenge_racer_score(r.id, f.user_id) desc) as placement
              from challenge_field(r.id, r.circle_id) f
            ) ranked
           where p.challenge_id = r.id and p.user_id = ranked.user_id;
        end if;
      end if;
    end if;
  end loop;
end;
$function$;

CREATE OR REPLACE FUNCTION public.economy_on_social_challenge_closed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_days int;
  v_scope int;
  v_loser uuid;
  v_winner_name text;
  v_loser_name text;
  v_field uuid[];
  v_uid uuid;
  v_payload jsonb;
  -- The per-racer standings row the placement arm reads back (0127).
  v_row record;
  -- The two sides' scores in the draw branch, restored from 0122.
  v_a numeric;
  v_b numeric;
  v_a_name text;
  v_b_name text;
  -- ── the honour knobs (0145) ──
  --
  -- Mock 140: "It's honor-based, so I drop the box a tier and trim the rest — no grade-reading,
  -- just your word." Both are existing grant_reward parameters, not a second reward formula:
  -- `p_difficulty` scales the significance that picks the band, and `p_max_band` ceilings it. An
  -- auto-tracked race is unchanged at 1.0 and whatever ceiling its shape already carried.
  --
  -- WHY IT IS PRICED DOWN AT ALL: 0093 refused self-reported grades any currency whatsoever,
  -- because the moment a claimed mark pays, claiming becomes the game. A challenge is a softer
  -- case — the target is declared in advance, in front of people — but the discount is what keeps
  -- lying about it from being the efficient play.
  --
  -- 'impressive' IS THE HONOUR CEILING, and the band it stops short of is the point rather than an
  -- arbitrary notch. grant_reward mints an un-buyable prestige badge at 'elite' and above ("the
  -- biggest wins are actually for" exactly that, per its own comment). A badge nobody can buy must
  -- not be obtainable by typing a number into a text field, so honour-scored races stop one band
  -- below the badge line. They still pay embers and a box; they cannot mint prestige.
  --
  -- The band vocabulary is grant_reward's: apex > elite > impressive > notable > casual >
  -- completion. reward_band_rank ignores anything outside it, so a name invented here would
  -- silently apply no ceiling at all.
  v_honour boolean;
  v_intensity numeric;
  v_cap text;
  -- ── 0174 · the scoped tier ──
  -- The same economy_config row the personal-goal trigger reads, so a scoped duel and a scoped
  -- solo goal cannot disagree about what a tier is worth.
  v_cfg jsonb := (select value from economy_config where key = 'tier_payout');
  v_tier_cap text;
  -- The placement arm carries its OWN ceiling rather than v_cap (see below), so it needs its own
  -- tightened copy. One variable, not a second rule.
  v_cap_place text;
begin
  if new.status <> 'completed' or coalesce(old.status, '') = 'completed' then
    return new;
  end if;

  -- ─────────────────────────── 0173 · A TEAM MATCH PAYS ITSELF ───────────────────────────
  --
  -- 🔴 THE ONE LINE THIS RESTATEMENT EXISTS FOR. Everything else in this function is byte-for-byte
  -- what was live on prod when 0173 was written.
  --
  -- WHAT WENT WRONG WITHOUT IT. settle_team_match pays each side its flat tier and writes the
  -- payload, and its very last act is `status = 'completed'` — which fires this trigger. A team
  -- match is mode 'group' and shape 'team_match', so it fell past the h2h arm and past the
  -- placement arm into the COLLECTIVE arm, which paid every member of challenge_field a SECOND
  -- reward at the collective band and overwrote reward_payload with it. Two payouts per player,
  -- and the reveal then showed the wrong one — the flat tier the match actually decided was
  -- replaced by a flat 0.75-placement collective payout on its way out the door.
  --
  -- Found by playing a whole match inside a rolled-back transaction against real prod data. A DDL
  -- dry-run could not have found it: `create function` only syntax-checks a plpgsql body, so
  -- nothing here runs until somebody calls it, and the double payout only exists at the moment
  -- the two functions meet.
  --
  -- THE GUARD IS AT THE TOP, not inside the else-arm, deliberately. A team match must never reach
  -- ANY arm of this function — not the collective one it falls into today, and not a future arm
  -- that a later migration adds ahead of it. settle_team_match is the only thing that may pay a
  -- match, which is what makes "how a team match settles" have exactly one definition.
  if new.shape = 'team_match' then
    return new;
  end if;

  v_days := greatest(1, ceil(new.window_hours / 24.0)::int);

  -- coalesce, not a bare comparison: race_metric is NULL on a collective lock-in goal, and a
  -- NULL here would flow into every `case when v_honour` below as "not true" by accident rather
  -- than by decision.
  v_honour := coalesce(new.race_metric, '') = 'grade';

  -- ───────── 0174 · the scoped tier, at last, on the social path ─────────
  --
  -- WAS `case when v_honour then 0.8 else 1.0 end`, and that constant is the whole reason this is a
  -- no-op for everything on prod: `uncommon` is pinned at significance 1.0 in tier_payout precisely
  -- so an UNSCOPED challenge resolves — through the coalesce below — to the exact number 0145
  -- hard-coded. Nothing in flight changes what it pays.
  --
  -- The grade haircut is KEPT and applied multiplicatively rather than replaced. The two discounts
  -- answer different questions: the tier says how hard the feat was, 0.8 says the score is somebody's
  -- word about a mark. 1.0 * 0.8 is still exactly 0.8 for an unscoped grade race.
  v_intensity := coalesce((v_cfg -> coalesce(new.difficulty_tier, '') ->> 'significance')::numeric, 1.0)
                 * case when v_honour then 0.8 else 1.0 end;

  -- The tier's own ceiling — null when unscoped, which is what every caller passed before 0159.
  v_tier_cap := goal_paid_band(new.difficulty_tier, new.verifiability);

  -- 0145's two ceilings, verbatim. `v_cap` is the h2h/collective one; the placement arm has always
  -- carried its own 'elite' cap inline instead, and hoisting it here is what lets the tier tighten
  -- it too — without that, a scoped placement race would keep paying up to elite however modestly
  -- Cindy scoped it, which is the one arm where the tier would have been silently ignored.
  v_cap       := case when v_honour then 'impressive' else null end;
  v_cap_place := case when v_honour then 'impressive' else 'elite' end;

  -- 🔒 TIGHTENED, NEVER LOOSENED. A scope can only ever lower the ceiling a shape already had,
  -- so no tier Cindy proposes can lift a race above the band its own shape allows — and the null
  -- case (unscoped) leaves both exactly as 0145 set them.
  if v_tier_cap is not null then
    if v_cap is null or reward_band_rank(v_tier_cap) < reward_band_rank(v_cap) then
      v_cap := v_tier_cap;
    end if;
    if reward_band_rank(v_tier_cap) < reward_band_rank(v_cap_place) then
      v_cap_place := v_tier_cap;
    end if;
  end if;

  if new.mode = 'h2h' then
    v_scope := 1;
    if new.winner_id is not null then
      v_payload := grant_reward(new.winner_id, 'friend_h2h', v_intensity, v_days, v_scope, 0.0, true, new.id, v_cap);
      update challenge_participants
         set reward_payload = v_payload
       where challenge_id = new.id and user_id = new.winner_id;

      -- The loser still finished the thing. Completion band only — placement 1.0 is last place.
      v_loser := case when new.winner_id = new.created_by then new.opponent_id else new.created_by end;
      v_payload := grant_reward(v_loser, 'friend_h2h', v_intensity, v_days, v_scope, 1.0, true, new.id, v_cap);
      update challenge_participants
         set reward_payload = v_payload
       where challenge_id = new.id and user_id = v_loser;

      select display_name into v_winner_name from profiles where id = new.winner_id;
      select display_name into v_loser_name from profiles where id = v_loser;

      -- Two events, not one broadcast: the copy differs, and more importantly the ACTOR differs.
      -- Each side's leading art is the OTHER person's face.
      perform notify_event(
        array[new.winner_id], 'challenge_won',
        'You won',
        case when v_loser_name is not null then 'You beat ' || v_loser_name || '.' else 'You took the challenge.' end,
        v_loser, new.id,
        '/challenge-info/[challengeId]', jsonb_build_object('challengeId', new.id::text),
        null, null,
        jsonb_build_object('mode', new.mode, 'outcome', 'won')
      );

      perform notify_event(
        array[v_loser], 'challenge_lost',
        'Challenge over',
        case when v_winner_name is not null then v_winner_name || ' edged it. Rematch?' else 'Rematch?' end,
        new.winner_id, new.id,
        '/challenge-info/[challengeId]', jsonb_build_object('challengeId', new.id::text),
        null, null,
        jsonb_build_object('mode', new.mode, 'outcome', 'lost')
      );

    elsif new.opponent_id is not null then
      -- 0122's draw branch. Without it the sweep pays a tie its XP and this trigger pays it
      -- nothing: no box, no embers, no notification, and no reward_payload for the reveal screen.
      select
        max(case when p.user_id = new.created_by  then p.final_value end),
        max(case when p.user_id = new.opponent_id then p.final_value end)
        into v_a, v_b
      from challenge_participants p
      where p.challenge_id = new.id;

      if v_a is null or v_b is null then
        v_a := social_challenge_score(new.created_by,  new.race_metric, new.starts_at, new.ends_at);
        v_b := social_challenge_score(new.opponent_id, new.race_metric, new.starts_at, new.ends_at);
      end if;

      if v_a = v_b and v_a > 0 then
        -- Both get the WINNER's placement (0.0 = first), not the loser's completion band. That is
        -- the whole point: a dead heat is two firsts, not two consolation prizes.
        v_payload := grant_reward(new.created_by, 'friend_h2h', v_intensity, v_days, v_scope, 0.0, true, new.id, v_cap);
        update challenge_participants
           set reward_payload = v_payload
         where challenge_id = new.id and user_id = new.created_by;

        v_payload := grant_reward(new.opponent_id, 'friend_h2h', v_intensity, v_days, v_scope, 0.0, true, new.id, v_cap);
        update challenge_participants
           set reward_payload = v_payload
         where challenge_id = new.id and user_id = new.opponent_id;

        select display_name into v_a_name from profiles where id = new.created_by;
        select display_name into v_b_name from profiles where id = new.opponent_id;

        -- Same event TYPE as a win so it files under Challenges and renders with the win's art;
        -- the payload says `draw`, which is what the reveal screen branches on.
        perform notify_event(
          array[new.created_by], 'challenge_won',
          'Dead even',
          case when v_b_name is not null
               then 'You and ' || v_b_name || ' finished level. You both get the win.'
               else 'You finished level. You both get the win.' end,
          new.opponent_id, new.id,
          '/challenge-info/[challengeId]', jsonb_build_object('challengeId', new.id::text),
          null, null,
          jsonb_build_object('mode', new.mode, 'outcome', 'draw')
        );

        perform notify_event(
          array[new.opponent_id], 'challenge_won',
          'Dead even',
          case when v_a_name is not null
               then 'You and ' || v_a_name || ' finished level. You both get the win.'
               else 'You finished level. You both get the win.' end,
          new.created_by, new.id,
          '/challenge-info/[challengeId]', jsonb_build_object('challengeId', new.id::text),
          null, null,
          jsonb_build_object('mode', new.mode, 'outcome', 'draw')
        );
      end if;
    end if;
  elsif new.shape = 'placement' then
    -- ─────────────── PLACEMENT: paid by the band actually finished in (0127) ───────────────
    --
    -- 🔒 THE FIREWALL IS INTACT. grant_reward is still the only thing that decides or moves a
    -- reward; this passes it a truer input than the collective arm's flat 0.75 and captures what
    -- it returns.
    --
    -- INVERTED: final_percentile is stored top-is-1.0 (0111), grant_reward's p_placement_pct is
    -- top-is-0.0. Passing it through unturned would pay the champion the last-place band.
    if new.circle_id is null then return new; end if;

    select coalesce(array_agg(p.user_id), '{}') into v_field
    from challenge_participants p
    where p.challenge_id = new.id and p.state = 'accepted';

    v_scope := coalesce(array_length(v_field, 1), 0);
    if v_scope = 0 then return new; end if;

    for v_row in
      select p.user_id, p.final_percentile, p.final_value
      from challenge_participants p
      where p.challenge_id = new.id and p.state = 'accepted'
        and p.final_rank is not null and p.final_value > 0
    loop
      -- Scope is the WHOLE field, not just the movers: placing 5th out of 48 is a bigger result
      -- than placing 5th out of 6, and that is exactly what grant_reward's log(scope) term is for.
      --
      -- CAPPED AT 'elite' (#148): that same log(scope) term, multiplied by a duration measured in
      -- weeks, is what makes the ceiling necessary — a semester-long race across a large campfire
      -- clears the apex threshold on scale alone, and would pay a Promethean Vault for winning
      -- among people who mostly did not compete. An honour-scored board stops a band lower still,
      -- for the badge reason above.
      v_payload := grant_reward(
        v_row.user_id, 'campfire_group', v_intensity, v_days, greatest(v_scope, 1),
        greatest(0, least(1, 1 - coalesce(v_row.final_percentile, 0))),
        -- 0174 — was this expression inline; now the hoisted, tier-tightened copy. Same value
        -- whenever difficulty_tier is null, which is every placement race live today.
        true, new.id, v_cap_place);
      update challenge_participants p
         set reward_payload = v_payload
       where p.challenge_id = new.id and p.user_id = v_row.user_id;
    end loop;

    -- Every racer is told, including the ones who did not move — their result is a rank, and a
    -- ranked board that only notifies its top half is a leaderboard people stop believing.
    perform notify_event(
      v_field,
      'campfire_settled',
      'Placement race settled',
      'The board is final — see where you landed.',
      null, new.circle_id,
      '/challenge-info/[challengeId]', jsonb_build_object('challengeId', new.id::text),
      null, 'rounded',
      jsonb_build_object('challenge_id', new.id, 'mode', new.mode, 'shape', 'placement')
    );

  elsif new.pooled then
    -- ─────────────── 0240 · POOLED: contributors paid, the top one at the top band ───────────────
    -- finalize wrote the standings BEFORE the flip. Contributors only (final_value > 0). With
    -- reward_top_contributor, every rank-1 contributor is paid as a first place (0.0); everyone else
    -- who moved lands on the collective completion band (0.75), the same figure the arm below pays.
    if new.circle_id is null then return new; end if;

    select coalesce(array_agg(p.user_id), '{}') into v_field
    from challenge_participants p
    where p.challenge_id = new.id and p.state = 'accepted';

    v_scope := coalesce(array_length(v_field, 1), 0);
    if v_scope = 0 then return new; end if;

    for v_row in
      select p.user_id, p.final_rank
      from challenge_participants p
      where p.challenge_id = new.id and p.state = 'accepted'
        and p.final_rank is not null and p.final_value > 0
    loop
      v_payload := grant_reward(
        v_row.user_id, 'campfire_group', v_intensity, v_days, greatest(v_scope, 1),
        case when new.reward_top_contributor and v_row.final_rank = 1 then 0.0 else 0.75 end,
        true, new.id, v_cap);
      update challenge_participants p
         set reward_payload = v_payload
       where p.challenge_id = new.id and p.user_id = v_row.user_id;
    end loop;

    perform notify_event(
      v_field,
      'campfire_settled',
      'You hit the total together',
      case when new.reward_top_contributor
           then 'The goal is done — see who carried it and collect your reward.'
           else 'The goal is done — your rewards are ready to collect.' end,
      null, new.circle_id,
      '/challenge-info/[challengeId]', jsonb_build_object('challengeId', new.id::text),
      null, 'rounded',
      jsonb_build_object('challenge_id', new.id, 'mode', new.mode, 'shape', 'collective', 'pooled', true)
    );

  else
    if new.circle_id is null then return new; end if;

    if exists (select 1 from challenge_participants p where p.challenge_id = new.id) then
      select coalesce(array_agg(f.user_id), '{}') into v_field
      from challenge_field(new.id, new.circle_id) f;
    else
      select coalesce(array_agg(distinct s.user_id), '{}') into v_field
      from lock_in_sessions s
      join group_members gm on gm.user_id = s.user_id and gm.group_id = new.circle_id
      where s.status = 'completed'
        and s.started_at >= new.starts_at
        and s.started_at <= coalesce(new.ends_at, now())
        and extract(epoch from (s.last_confirmed_at - s.started_at))
            >= (select value::int from economy_config where key = 'lock_in_min_seconds');
    end if;

    v_scope := coalesce(array_length(v_field, 1), 0);
    if v_scope = 0 then return new; end if;

    -- Real percentile placement needs the per-member standings 0111 now writes; wiring
    -- grant_reward to final_percentile is a reward-tuning change and stays out of a bugfix pass,
    -- so everyone still lands on the completion band rather than being handed a guessed rank.
    foreach v_uid in array v_field
    loop
      v_payload := grant_reward(v_uid, 'campfire_group', v_intensity, v_days, greatest(v_scope, 1), 0.75, true, new.id, v_cap);
      -- A no-op for a pre-0096 challenge with no roster: v_field was derived from lock-in sessions
      -- there, and the reward is still paid — there is simply no row to record it on, which is
      -- exactly the case get_challenge_reward's empty return already covers.
      update challenge_participants
         set reward_payload = v_payload
       where challenge_id = new.id and user_id = v_uid;
    end loop;

    -- One event to every participant. No actor: a campfire challenge settling is the campfire's
    -- doing, not any one member's, so it leads with the campfire rather than a face.
    perform notify_event(
      v_field,
      'campfire_settled',
      'Campfire challenge settled',
      'Your rewards are ready to collect.',
      null, new.circle_id,
      '/challenge-info/[challengeId]', jsonb_build_object('challengeId', new.id::text),
      null, 'rounded',
      jsonb_build_object('challenge_id', new.id, 'mode', new.mode)
    );
  end if;

  return new;
end;
$function$;
