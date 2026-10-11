-- 0241 — a pooled total reads as contributions, and pays its top contributor a title.
--
-- 0240 settled pooled totals correctly, but every reader still treated them as a COUNTED collective:
--
--   · get_group_challenge_watch scored every collective as a count of check-ins, so a pooled
--     500 km board read "0/1" per member and "0 of 6 done" — and the same was true of every 0169
--     measured bar ("everyone runs 50 km");
--   · neither it nor get_my_social_challenges returned target_value / pooled /
--     reward_top_contributor, so the client could not tell the shapes apart;
--   · the finisher-title mint (0212) labelled a pool's ranks as race places ("2nd Place
--     Finisher"), and titled members who contributed nothing;
--   · the reward paid every non-top contributor the same flat band, so "biggest share pays more"
--     was true of rank 1 only.
--
-- Both RPCs gain three trailing OUT columns, which is a RETURNS TABLE change: drop + create, with
-- the existing grants restated (PUBLIC, anon, authenticated, service_role — as live). Installed
-- builds ignore columns they do not read. Every restated body is the LIVE one plus the edits
-- named above, behind an md5 guard.

do $guard$
begin
  if (select md5(prosrc) from pg_proc where oid = 'get_my_social_challenges()'::regprocedure) <> 'e09de45269c64d98bca5ad81c076de33' then
    raise exception '0241: get_my_social_challenges() changed since this migration was cut — rebase it.';
  end if;
  if (select md5(prosrc) from pg_proc where oid = 'get_group_challenge_watch(uuid)'::regprocedure) <> 'c718a4348525239d84e96be3bd9763c7' then
    raise exception '0241: get_group_challenge_watch(uuid) changed since this migration was cut — rebase it.';
  end if;
  if (select md5(prosrc) from pg_proc where oid = 'mint_campfire_finisher_titles(uuid)'::regprocedure) <> 'd8b2b1534772d8c6802cef2813564c18' then
    raise exception '0241: mint_campfire_finisher_titles(uuid) changed since this migration was cut — rebase it.';
  end if;
  if (select md5(prosrc) from pg_proc where oid = 'economy_on_social_challenge_closed()'::regprocedure) <> 'fa02a1cd6ddb406261be8a4f4faf3c0b' then
    raise exception '0241: economy_on_social_challenge_closed() changed since this migration was cut — rebase it.';
  end if;
  if (select md5(prosrc) from pg_proc where oid = 'get_pooled_progress(uuid)'::regprocedure) <> '9c84d522875fc28a7fb65487c3c3a4be' then
    raise exception '0241: get_pooled_progress(uuid) changed since this migration was cut — rebase it.';
  end if;
end $guard$;

drop function get_my_social_challenges();
drop function get_group_challenge_watch(uuid);

CREATE OR REPLACE FUNCTION public.get_my_social_challenges()
 RETURNS TABLE(id uuid, circle_id uuid, circle_name text, circle_emoji text, created_by uuid, created_by_name text, mode text, opponent_id uuid, opponent_name text, race_metric text, my_score numeric, opponent_score numeric, target_count integer, member_count integer, completed_count integer, window_hours integer, starts_at timestamp with time zone, ends_at timestamp with time zone, status text, winner_id uuid, payout_xp integer, created_at timestamp with time zone, public_name text, shape text, invited_count integer, accepted_count integer, my_state text, grade_target numeric, course_code text, my_reported_value numeric, my_final_rank integer, my_final_percentile numeric, my_awarded_xp integer, my_reward_payload jsonb, difficulty_tier text, verifiability text, target_value numeric, pooled boolean, reward_top_contributor boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  return query
  select
    sc.id,
    sc.circle_id,
    g.name as circle_name,
    g.emoji as circle_emoji,
    sc.created_by,
    creator.display_name as created_by_name,
    sc.mode,
    sc.opponent_id,
    opp.display_name as opponent_name,
    sc.race_metric,
    -- VIEWER-RELATIVE, and that is the whole contract of the pair: "my" is whoever is asking, so
    -- the opponent of a duel sees the same race from their own side without the client swapping
    -- anything. A grade race reads from the roster instead of the clock — there is nothing
    -- accumulating to window.
    case
      when sc.mode <> 'h2h' or challenge_is_awaiting(sc.status) then null
      when sc.race_metric = 'grade' then (
        select p.reported_value from challenge_participants p
        where p.challenge_id = sc.id
          and p.user_id = case when auth.uid() = sc.opponent_id then sc.opponent_id else sc.created_by end)
      else social_challenge_score(
        case when auth.uid() = sc.opponent_id then sc.opponent_id else sc.created_by end,
        sc.race_metric, sc.starts_at, sc.ends_at)
    end as my_score,
    case
      when sc.mode <> 'h2h' or challenge_is_awaiting(sc.status) then null
      when sc.race_metric = 'grade' then (
        select p.reported_value from challenge_participants p
        where p.challenge_id = sc.id
          and p.user_id = case when auth.uid() = sc.opponent_id then sc.created_by else sc.opponent_id end)
      else social_challenge_score(
        case when auth.uid() = sc.opponent_id then sc.created_by else sc.opponent_id end,
        sc.race_metric, sc.starts_at, sc.ends_at)
    end as opponent_score,
    sc.target_count,
    -- THE FIELD, not the campfire (0112). Was `count(*) from group_members` — the same denominator
    -- 0111 removed from settlement, and the reason a subset race read "2 / 30 done" on its card.
    case when sc.mode = 'group'
      then (select count(*)::int from challenge_field(sc.id, sc.circle_id)) else null end as member_count,
    -- Routed through challenge_racer_completed so the card's "N / M done" and the sweep's
    -- all-or-nothing gate ask the same question. They were two spellings of one rule, which is how
    -- a card can say everyone finished while the sweep expires the challenge.
    case when sc.mode = 'group' then (
      select count(*)::int from challenge_field(sc.id, sc.circle_id) f
      where challenge_racer_completed(sc.id, f.user_id)
    ) else null end as completed_count,
    sc.window_hours,
    sc.starts_at,
    sc.ends_at,
    sc.status,
    sc.winner_id,
    sc.payout_xp,
    sc.created_at,
    sc.public_name,
    sc.shape,
    (select count(*)::int from challenge_participants cp where cp.challenge_id = sc.id and cp.state = 'invited') as invited_count,
    (select count(*)::int from challenge_participants cp where cp.challenge_id = sc.id and cp.state = 'accepted') as accepted_count,
    (select cp.state from challenge_participants cp where cp.challenge_id = sc.id and cp.user_id = auth.uid()) as my_state,
    sc.grade_target,
    sc.course_code,
    (select cp.reported_value from challenge_participants cp where cp.challenge_id = sc.id and cp.user_id = auth.uid()) as my_reported_value,
    (select cp.final_rank from challenge_participants cp where cp.challenge_id = sc.id and cp.user_id = auth.uid()) as my_final_rank,
    (select cp.final_percentile from challenge_participants cp where cp.challenge_id = sc.id and cp.user_id = auth.uid()) as my_final_percentile,
    -- Unfiltered by status on purpose: bonus_xp_awards only ever holds settled awards, so gating
    -- this on challenge_is_settled would add a condition that can never change the answer while
    -- giving a future reader the impression that it can.
    (select coalesce(sum(b.amount), 0)::int from bonus_xp_awards b
      where b.challenge_id = sc.id and b.user_id = auth.uid()) as my_awarded_xp,
    (select cp.reward_payload from challenge_participants cp
      where cp.challenge_id = sc.id and cp.user_id = auth.uid()) as my_reward_payload,
    sc.difficulty_tier,
    sc.verifiability,
    -- 0241 · the client could not tell a pooled total (or any measured bar) from a counted one
    -- without these, and rendered "0/1".
    sc.target_value,
    sc.pooled,
    sc.reward_top_contributor
  from social_challenges sc
  -- left join: an h2h challenge with nobody watching has a null circle_id — an inner join here
  -- would silently drop it out of the result set entirely (migration 0032).
  left join groups g on g.id = sc.circle_id
  join profiles creator on creator.id = sc.created_by
  left join profiles opp on opp.id = sc.opponent_id
  where (
    (sc.mode = 'group' and is_group_member(sc.circle_id))
    or sc.created_by = auth.uid()
    or sc.opponent_id = auth.uid()
  )
    and sc.status != 'declined'
    -- A DRAFT IS PRIVATE UNTIL SOMEONE IS INVITED (0097).
    and (not challenge_is_draft(sc.status) or sc.created_by = auth.uid())
  order by
    (challenge_is_awaiting(sc.status) and sc.opponent_id = auth.uid()) desc,
    sc.created_at desc;
end;
$function$;
grant execute on function get_my_social_challenges() to public, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_group_challenge_watch(p_challenge_id uuid)
 RETURNS TABLE(challenge_id uuid, target_count integer, window_hours integer, starts_at timestamp with time zone, ends_at timestamp with time zone, status text, circle_id uuid, circle_name text, public_name text, shape text, race_metric text, member_id uuid, member_name text, member_progress numeric, member_live_status text, member_cheers integer, cheered_by_me boolean, is_anonymous boolean, target_value numeric, pooled boolean, reward_top_contributor boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_challenge social_challenges;
begin
  -- sc.status, not status: `status` is an OUT column of this function. Same trap as 0099.
  select * into v_challenge from social_challenges sc
  where sc.id = p_challenge_id
    and sc.mode = 'group'
    and (challenge_is_live(sc.status) or challenge_is_settled(sc.status));
  if v_challenge.id is null then
    raise exception 'Group challenge not found or not active.';
  end if;
  if not is_group_member(v_challenge.circle_id) then
    raise exception 'Not a member of that campfire.';
  end if;

  return query
  select
    v_challenge.id,
    v_challenge.target_count,
    v_challenge.window_hours,
    v_challenge.starts_at,
    v_challenge.ends_at,
    v_challenge.status,
    v_challenge.circle_id,
    g.name,
    v_challenge.public_name,
    v_challenge.shape,
    v_challenge.race_metric,
    f.user_id,
    -- 0170 · name, progress and live status are the three things anonymity hides. Everything else
    -- on the row is about the CHALLENGE, not about who is running it.
    case when vis.ok then p.display_name else 'Anonymous' end,
    case when vis.ok then
      case
        when v_challenge.shape = 'placement' then
          -- Net of the baseline, evaluated at the end of the window once it has passed — the same
          -- expression settlement uses (0127), so the live board and the final board cannot disagree.
          greatest(
            challenge_metric_value(v_challenge.race_metric, f.user_id,
              least(now(), coalesce(v_challenge.ends_at, now()))) - f.baseline,
            0)
        -- 0241 · a measured collective (0169 bar or 0240 pool) is metered, not counted: the
        -- same challenge_racer_score settlement reads, so the live board and the final standings
        -- cannot disagree. Was a count of check-ins, which is why a pooled 500 km read "0/1".
        when v_challenge.shape = 'collective' and v_challenge.target_value is not null then
          greatest(challenge_racer_score(v_challenge.id, f.user_id), 0)
        else (
          select count(*) from check_ins ci
          where ci.user_id = f.user_id and ci.removed_at is null
            and ci.created_at >= v_challenge.starts_at and ci.created_at <= coalesce(v_challenge.ends_at, now())
            and check_in_qualifies_for_challenge(ci.id)
        )::numeric
      end
    else null end,
    case when vis.ok then live_status(f.user_id) else null end,
    (select count(*)::int from challenge_cheers cc
      where cc.challenge_id = p_challenge_id and cc.for_user_id = f.user_id),
    exists (select 1 from challenge_cheers cc
      where cc.challenge_id = p_challenge_id and cc.spectator_id = auth.uid() and cc.for_user_id = f.user_id),
    not vis.ok,
    v_challenge.target_value,
    v_challenge.pooled,
    v_challenge.reward_top_contributor
  from challenge_field(p_challenge_id, v_challenge.circle_id) f
  join profiles p on p.id = f.user_id
  join groups g on g.id = v_challenge.circle_id
  cross join lateral (select can_see_rank(auth.uid(), f.user_id) as ok) vis;
end;
$function$;
grant execute on function get_group_challenge_watch(uuid) to public, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.mint_campfire_finisher_titles(p_challenge_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_c social_challenges;
  v_campfire text;
  v_key text := campfire_finisher_title_key(p_challenge_id);
  v_race text;
  v_field int;
  v_before int;
  v_after int;
  r record;
  s record;
begin
  select * into v_c from social_challenges where id = p_challenge_id;
  if v_c.id is null or v_c.status <> 'completed' or v_c.circle_id is null or v_c.mode = 'h2h' then
    return 0;
  end if;

  select coalesce(nullif(trim(g.name), ''), 'Campfire') into v_campfire from groups g where g.id = v_c.circle_id;
  v_campfire := coalesce(v_campfire, 'Campfire');
  v_race := coalesce(nullif(trim(v_c.public_name), ''), 'Campfire challenge');

  select count(*) into v_field
  from challenge_participants p
  where p.challenge_id = p_challenge_id and p.state = 'accepted' and p.final_rank is not null;

  select count(*) into v_before from cosmetics_owned where cosmetic_key = v_key;

  -- 0241 · A POOLED TOTAL titles its CONTRIBUTORS, not a finishing order. Nobody who moved
  -- nothing is minted anything (enrolment is not effort, same rule as its reward); the rank-1
  -- contributor(s) of a "top contributor wins" pool take the exclusive "<Campfire> Top Contributor"
  -- at epic — the pool's equivalent of a placement champion — and everyone else who added to it
  -- "<Campfire> Contributor". Same per-challenge key, so it stays one row per person per challenge.
  if v_c.pooled then
    for r in
      select p.user_id, p.final_rank
      from challenge_participants p
      where p.challenge_id = p_challenge_id and p.state = 'accepted'
        and p.final_rank is not null and p.final_value > 0
    loop
      if v_c.reward_top_contributor and r.final_rank = 1 then
        perform economy_grant_title(r.user_id, v_key, v_race || ' · ' || v_campfire || ' · top contributor',
                                    v_campfire || ' Top Contributor', 'epic');
      else
        perform economy_grant_title(r.user_id, v_key, v_race || ' · ' || v_campfire || ' · contributor',
                                    v_campfire || ' Contributor', null);
      end if;
    end loop;
    select count(*) into v_after from cosmetics_owned where cosmetic_key = v_key;
    return v_after - v_before;
  end if;

  for r in
    select p.user_id, p.final_rank, p.final_value
    from challenge_participants p
    where p.challenge_id = p_challenge_id and p.state = 'accepted' and p.final_rank is not null
  loop
    -- 0215 · the stamp decides label and rarity; Champion needs a score > 0.
    select * into s from campfire_finisher_stamp(v_campfire, r.final_rank, r.final_value, v_field);
    perform economy_grant_title(
      r.user_id,
      v_key,
      v_race || ' · ' || v_campfire || ' · ' || s.place_text,
      s.label,
      s.rarity
    );
  end loop;

  select count(*) into v_after from cosmetics_owned where cosmetic_key = v_key;
  return v_after - v_before;
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
      select p.user_id, p.final_rank, p.final_percentile
      from challenge_participants p
      where p.challenge_id = new.id and p.state = 'accepted'
        and p.final_rank is not null and p.final_value > 0
    loop
      -- 0241 · on a "top contributor wins" pool the bigger shares pay more: rank 1 at first place
      -- (0.0), everyone else by their standing, never below the collective band (0.75) every
      -- contributor is owed. A plain pool pays every contributor the collective band.
      v_payload := grant_reward(
        v_row.user_id, 'campfire_group', v_intensity, v_days, greatest(v_scope, 1),
        case
          when not new.reward_top_contributor then 0.75
          when v_row.final_rank = 1 then 0.0
          else least(0.75, greatest(0, 1 - coalesce(v_row.final_percentile, 0)))
        end,
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

CREATE OR REPLACE FUNCTION public.get_pooled_progress(p_challenge_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
        select f.user_id, pr.display_name, can_see_rank(auth.uid(), f.user_id) as visible,
               case when challenge_is_live(v_c.status) then challenge_racer_score(v_c.id, f.user_id)
                    else coalesce(p.final_value, 0) end as score
        from challenge_field(v_c.id, v_c.circle_id) f
        join profiles pr on pr.id = f.user_id
        left join challenge_participants p on p.challenge_id = v_c.id and p.user_id = f.user_id
      ) x
      -- 0241 · 0170 anonymity: a private racer's share still counts toward 'total' above, but
      -- their name and figure are not listed.
      where x.score > 0 and x.visible
    ), '[]'::jsonb)
  );
end;
$function$;
