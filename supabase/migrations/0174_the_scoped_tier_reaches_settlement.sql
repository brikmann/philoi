-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 0174 · THE SCOPED TIER REACHES SETTLEMENT. The verdict screen stops promising what nobody pays.
--
-- 0159 built the pricing. 0160 opened the write path and closed with an explicit open item --
-- "THIS STORES THE TIER; IT DOES NOT YET SPEND IT" -- and 0162 restated it verbatim: "SETTLEMENT
-- reading difficulty_tier. Still 0160's open item... what a settled campfire challenge pays is
-- unchanged by this file." This is that item.
--
-- ──────────────────── WHY IT STOPPED BEING DEFERRABLE ────────────────────
--
-- Deferring it was right while the tier was invisible. It stopped being invisible when campfire
-- hosting started routing through challenge/verdict.tsx, which renders preview_challenge_reward's
-- box and ember figure BEFORE the user commits. So the app now shows a server-computed price on a
-- path that settles by a formula which has never read the tier -- the verdict promises a Vessel of
-- Hestia and settlement pays whatever 0145's constants say. verdict.tsx's own header names this
-- exact failure: "the first retune would have the verdict promise one thing and the reveal deliver
-- another". One round trip to never be wrong is worth nothing if the round trip asks a different
-- question than the one settlement answers.
--
-- ──────────────────── WHY THIS IS A NO-OP FOR EVERYTHING LIVE ────────────────────
--
-- This changes the settlement path for every duel, collective goal and placement race on prod, so
-- the bar is not "it is better" but "nothing in flight moves". It does not move, by construction:
--
--   . SIGNIFICANCE. Was `case when v_honour then 0.8 else 1.0 end`. Now the tier's significance
--     from economy_config, times that same 0.8/1.0. An unscoped row reads `v_cfg -> '' ->>
--     'significance'` -> null -> coalesce -> 1.0, so it computes 1.0 * 0.8 or 1.0 * 1.0 -- the two
--     values 0145 hard-coded, bit for bit. (uncommon is pinned at 1.0 in tier_payout for exactly
--     this reason; 0159 chose that constant to make this substitution free.)
--
--   . CEILINGS. goal_paid_band(null, anything) returns null -- its first branch, unchanged since
--     0159 -- so v_tier_cap is null on every unscoped row and both ceilings keep 0145's values.
--
--   . SCOPED ROWS TODAY: THERE ARE NONE. set_challenge_scope has existed since 0160 and no client
--     code path calls it; the column is null on every social_challenges row on prod. So this
--     migration provably cannot change any settlement until the client starts scoping -- which is
--     what makes it safe to land ahead of that client work rather than in the same breath.
--
-- ──────────────────── THE ONE ARM THAT NEEDED FINDING ────────────────────
--
-- Five of the six grant_reward calls take `v_cap`. The placement arm does not -- it has carried its
-- own `case when v_honour then 'impressive' else 'elite' end` inline since 0127. Teaching only
-- v_cap to read the tier would have left placement as the one shape where Cindy's scope was
-- accepted, stored, previewed and then ignored at payout. It is hoisted to v_cap_place here and
-- tightened by the same rule.
--
-- ──────────────────── TIGHTEN, NEVER LOOSEN ────────────────────
--
-- The tier can only ever LOWER a ceiling the shape already had. That is the firewall property this
-- file has to preserve: the tier arrives from a client (per 0160's header, there is no server-side
-- executor for a model action, deliberately), so a scope must never be able to buy a bigger prize
-- than the shape allows. A placement race still cannot exceed elite; a grade race still cannot
-- exceed impressive; an honour-scored anything still cannot mint the un-buyable prestige badge
-- grant_reward reserves for elite and above. The worst a lying client achieves is a smaller box.
--
-- NOT CHANGED HERE: grant_reward itself, tier_payout's numbers, the trigger binding (create or
-- replace keeps it), and the h2h/collective/placement outcome logic. Only how v_intensity and the
-- two ceilings are computed.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ──────────────────── REBASED ONTO 0173, DELIBERATELY ────────────────────
--
-- 🛑 THIS FUNCTION IS RESTATED BY 0173 TOO, AND 0173 APPLIES FIRST. That migration adds a
-- team_match guard at the top of this trigger, fixing a DOUBLE PAYOUT: settle_team_match sets
-- status='completed', which fires this trigger, and a team match is mode 'group' and not
-- 'placement' — so it fell past both named arms into the COLLECTIVE arm and paid every player a
-- second time, overwriting reward_payload with the wrong band on the way.
--
-- So the body below is NOT prod's current one plus this file's change. It is 0173's body plus this
-- file's change. Restating from prod's base would have applied second and silently deleted that
-- guard, re-arming the double payout with this migration reporting success — the same clobber class
-- as two sessions replacing a function from different bases, which this repo has already been bitten
-- by more than once.
--
-- The assertions at the foot check BOTH properties survived: the guard is still there, and there are
-- still six grant_reward calls. If a future migration restates this function again, copy from
-- whichever base is latest and keep both assertions.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

create or replace function economy_on_social_challenge_closed()
returns trigger
language plpgsql
security definer
set search_path = public
as $econ$
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
$econ$;
comment on function economy_on_social_challenge_closed() is
  '0174 -- settles a social challenge, now reading social_challenges.difficulty_tier + verifiability through tier_payout and goal_paid_band, exactly as the personal-goal trigger does. Unscoped rows price identically to 0145. The tier can only tighten a ceiling, never raise one.';

-- ──────────────────── the no-op property, asserted ────────────────────
--
-- These are the facts the "nothing in flight moves" argument above rests on. Asserting them here
-- means a future retune of tier_payout that breaks the argument fails THIS migration's own proof
-- rather than silently repricing every live duel.
do $assert$
declare
  v_cfg jsonb := (select value from economy_config where key = 'tier_payout');
begin
  -- 1. An unscoped row resolves to 1.0 -- the constant 0145 hard-coded.
  if coalesce((v_cfg -> coalesce(null::text, '') ->> 'significance')::numeric, 1.0) is distinct from 1.0 then
    raise exception 'an unscoped challenge must price at significance 1.0';
  end if;

  -- 2. ...and so does `uncommon`, which is why substituting the lookup for the constant is free.
  if (v_cfg -> 'uncommon' ->> 'significance')::numeric is distinct from 1.0 then
    raise exception 'uncommon must stay pinned at 1.0 or the unscoped baseline shifts';
  end if;

  -- 3. An unscoped row gets no ceiling from the tier, so 0145's own ceilings survive untouched.
  if goal_paid_band(null, 'auto') is not null or goal_paid_band(null, 'honor') is not null then
    raise exception 'an unscoped challenge must take no tier ceiling';
  end if;

  -- 4. The tighten-never-loosen rule, on the case that would hurt: a mythic HONOUR scope caps at
  --    notable, well below placement's own elite ceiling, so the scope lowers it and never lifts it.
  if reward_band_rank(goal_paid_band('mythic', 'honor')) >= reward_band_rank('elite') then
    raise exception 'an honour scope must never reach placement elite ceiling';
  end if;

  -- 5. 🛑 0173'S GUARD SURVIVED THIS RESTATEMENT. This file and 0173 both replace the same
  --    trigger, and 0173 applies FIRST — so a body rebuilt from prod's older base would drop the
  --    team_match early-return, and settle_team_match would pay every player twice while this
  --    migration reported success. A grant_reward count sits beside it, because the other way to
  --    lose an arm while still looking correct is to drop one of the six payout branches while
  --    restating several hundred lines.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'economy_on_social_challenge_closed'
       and p.prosrc like '%new.shape = ''team_match''%'
  ) then
    raise exception '0174: 0173''s team_match guard was lost restating the settlement trigger — team matches would pay twice.';
  end if;
  if (select (length(p.prosrc) - length(replace(p.prosrc, 'grant_reward(', '')))
                / length('grant_reward(')
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'economy_on_social_challenge_closed') <> 6 then
    raise exception '0174: the settlement trigger no longer has its six grant_reward calls — an arm was lost restating it.';
  end if;

  -- 6. And the auto path still tops out where 0159 put it -- this file grants no new reach.
  if reward_band_rank(goal_paid_band('mythic', 'auto')) > reward_band_rank('apex') then
    raise exception 'no scope may exceed apex';
  end if;
end
$assert$;
