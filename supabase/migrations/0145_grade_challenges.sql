-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- 0145 · GRADE CHALLENGES — "70% in KP451", end to end
--
-- WHAT WAS ACTUALLY THERE BEFORE THIS FILE: a comment. 0096 introduced `public_name` and used
-- "BU111 grade" as its example string, and challenge-metric.ts quotes that example back. That is
-- the entire extent of the feature — `race_metric` has never accepted a grade, no column could
-- hold a target or a reported mark, and settlement had no arm that could read one. A "grade
-- challenge" was a lock-in race with the word grade in its title.
--
-- Mock 140 is the spec: "70% in Physiology · KP451", a target you either hit or you don't, honour-
-- based because there is no grade to read, and paid at a discount for exactly that reason.
--
-- ─────────────────────────── THE SHAPE OF THE THING ───────────────────────────
--
-- A grade is not like the other four metrics and the design has to admit that rather than bolt it
-- onto the cumulative machinery:
--
--   lockin_time / volume / distance / xp   accumulate. They are measured by subtracting a baseline
--                                          taken at the gun from a cumulative total at the bell,
--                                          and the app observes them without being told.
--
--   grade                                  is a single absolute number that arrives ONCE, at the
--                                          end, from the person themselves. There is nothing to
--                                          accumulate and no baseline to subtract — a 70 is a 70
--                                          whatever you walked in with.
--
-- So `challenge_metric_value(metric, user, at)` deliberately does NOT learn about grades. Its
-- signature cannot express one: a grade belongs to a user *in a particular challenge*, not to a
-- user at a moment in time, and a function that took the challenge would be a different function.
-- The per-challenge question gets its own pair below, and every settlement arm routes through
-- them so that "what is this racer's score" has one answer per shape rather than three.
--
-- ─────────────────────────── HONOUR, AND WHY IT PAYS LESS ───────────────────────────
--
-- 0093 (milestones) refused to let self-reported grades earn currency at all, and its reasoning
-- still stands: "The instant a self-reported grade earns currency, Philoi becomes a grade-
-- comparison app." A grade CHALLENGE is a different bargain — you are not posting a mark for
-- status, you are committing to a target in front of people who will see whether you claimed it —
-- but the incentive it creates is the same one, so mock 140 prices it accordingly: honour-based
-- challenges take the box down a tier and trim the currency.
--
-- That is implemented with knobs grant_reward already has (`p_difficulty` and `p_max_band`), not
-- with a second reward formula. 🔒 THE FIREWALL HOLDS: nothing in this file decides what a reward
-- is worth. grant_reward is still the only thing that computes or moves one; this hands it a lower
-- difficulty and a lower ceiling and captures what comes back.
-- ══════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────── 1 · schema ───────────────────────────

alter table social_challenges drop constraint if exists social_challenges_race_metric_check;
alter table social_challenges add constraint social_challenges_race_metric_check
  check (race_metric is null or race_metric in ('lockin_time', 'volume', 'distance', 'ai', 'xp', 'grade'));

/** The mark to hit, as a percentage. Mock 140's "Grade · 70%". */
alter table social_challenges add column if not exists grade_target numeric;

/** "KP451". The course is what makes the target mean anything — Cindy's whole first question in
 *  mock 140 is "what's the course code?", because a 70 in an intro course and a 70 in a 400-level
 *  one are not the same ask. Free text: there is no course table, and inventing one to hold a
 *  string the user types is a schema for a feature nobody asked for. */
alter table social_challenges add column if not exists course_code text;

alter table social_challenges drop constraint if exists social_challenges_grade_shape;
alter table social_challenges add constraint social_challenges_grade_shape check (
  -- A target only means anything on a grade race.
  (grade_target is null or race_metric = 'grade')
  -- Percentages. A GPA-scale entry is converted client-side rather than stored in a second unit,
  -- for the same reason distance is stored in metres and formatted per-locale: two units in one
  -- column is how "12000" came to render as twelve thousand XP for twelve thousand pounds (0096).
  and (grade_target is null or (grade_target > 0 and grade_target <= 100))
  -- A DUEL OR A COLLECTIVE GOAL NEEDS A BAR; A PLACEMENT BOARD DOES NOT.
  --
  -- The two shapes ask different questions and only one of them needs a number set in advance.
  -- "Did we hit 70?" is unanswerable without the 70 — and "highest mark wins" between two people
  -- taking different courses is not a race, it is a comparison of two unrelated numbers, which is
  -- why a grade duel is a shared bar rather than a raw comparison. A placement race in a course
  -- campfire is the opposite case: everyone sat the same exam, so the ranking IS the result and a
  -- target would be a second, redundant verdict on top of it (mock 114's board has none).
  and (coalesce(race_metric, '') <> 'grade' or shape = 'placement' or grade_target is not null)
);

-- A group challenge's target is a COUNT of lock-ins — unless it is a grade goal, whose target is a
-- mark. Exactly one of the two, never both: they are two spellings of "the bar", and a row
-- carrying both would leave challenge_racer_completed with two answers.
alter table social_challenges drop constraint if exists social_challenges_mode_target_check;
alter table social_challenges add constraint social_challenges_mode_target_check check (
  case
    when shape = 'placement' then target_count is null
    when mode = 'group' then (target_count is not null) <> (grade_target is not null)
    else target_count is null
  end
);

alter table social_challenges drop constraint if exists social_challenges_course_code_len;
alter table social_challenges add constraint social_challenges_course_code_len
  check (course_code is null or char_length(course_code) <= 24);

/** What the racer says they got. NULL means "has not reported yet", which is distinct from a
 *  reported zero and is why this is nullable rather than defaulted — settlement scores an
 *  unreported grade as 0, but the card must be able to say "not in yet" rather than "you got 0". */
alter table challenge_participants add column if not exists reported_value numeric;
alter table challenge_participants add column if not exists reported_at timestamptz;

alter table challenge_participants drop constraint if exists challenge_participants_reported_range;
alter table challenge_participants add constraint challenge_participants_reported_range
  check (reported_value is null or (reported_value >= 0 and reported_value <= 100));

-- ─────────────────────────── 2 · one answer to "what did this racer score" ───────────────────────────

/**
 * THE PER-CHALLENGE SCORE.
 *
 * challenge_metric_value answers "what is this user's cumulative total for metric M as of time T",
 * which is the right question for the four accumulating metrics and an unanswerable one for a
 * grade. This answers the question settlement actually asks — "what did this racer score in THIS
 * challenge" — and dispatches on the metric.
 *
 * Every settlement arm now goes through here. Before, the duel arm, the placement arm and the
 * collective arm each spelled the score out inline, three times, in two different ways (the
 * collective one hardcodes 'xp'); adding a fifth metric to three inline expressions is how the
 * fourth metric came to render as "Most XP" on three screens in 0096.
 */
create or replace function challenge_racer_score(p_challenge_id uuid, p_user uuid)
returns numeric
language sql
security definer
set search_path = public
stable
as $$
  select case
    when c.race_metric = 'grade' then
      -- Absolute, and NOT net of the baseline. A grade is the number you got, not the number you
      -- improved by; subtracting a baseline here would score a 70 as 0.
      coalesce((select p.reported_value from challenge_participants p
                 where p.challenge_id = c.id and p.user_id = p_user), 0)
    when c.race_metric is null then
      -- A collective goal has no metric race (0098 leaves it null). What it measures is how many
      -- qualifying lock-ins the racer put in during the window — the same count the completion
      -- test below uses, exposed as a score so the standings can be ranked by it.
      (select count(*) from check_ins ci
        where ci.user_id = p_user and ci.removed_at is null
          and ci.created_at >= c.starts_at and ci.created_at <= coalesce(c.ends_at, now())
          and check_in_qualifies_for_challenge(ci.id))
    else
      -- Progress since the gun, floored at zero: every accumulating source can shrink when
      -- something is deleted, and a negative score would sort a racer below somebody who did
      -- nothing at all.
      greatest(
        challenge_metric_value(c.race_metric, p_user, coalesce(c.ends_at, now()))
          - coalesce((select p.baseline from challenge_participants p
                       where p.challenge_id = c.id and p.user_id = p_user), 0),
        0)
  end
  from social_challenges c
  where c.id = p_challenge_id;
$$;

grant execute on function challenge_racer_score(uuid, uuid) to authenticated;

/**
 * DID THIS RACER CLEAR THE BAR? Only a collective goal asks it — its premise is the whole house
 * passing together — but what "the bar" is depends on the metric, which is why it is here rather
 * than inline in the sweep.
 */
create or replace function challenge_racer_completed(p_challenge_id uuid, p_user uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select case
    when c.race_metric = 'grade' then challenge_racer_score(c.id, p_user) >= c.grade_target
    else challenge_racer_score(c.id, p_user) >= coalesce(c.target_count, 1)
  end
  from social_challenges c
  where c.id = p_challenge_id;
$$;

grant execute on function challenge_racer_completed(uuid, uuid) to authenticated;

-- ─────────────────────────── 3 · reporting your mark ───────────────────────────

/**
 * SELF-REPORT, and re-report. Honour-based by construction: there is no transcript to read and
 * this migration does not pretend otherwise.
 *
 * Editable while the race is live for the same reason a lock-in total keeps moving — the mark is
 * the racer's current standing, not a one-shot submission, and a typo'd 7 for a 70 must be
 * fixable. It hardens at settlement simply because the sweep stops reading it.
 */
create or replace function report_challenge_grade(p_challenge_id uuid, p_grade numeric)
returns numeric
language plpgsql
security definer
set search_path = public
as $rg$
declare
  v_metric text;
  v_status text;
begin
  if p_grade is null or p_grade < 0 or p_grade > 100 then
    raise exception 'A grade is a percentage between 0 and 100.';
  end if;

  select sc.race_metric, sc.status into v_metric, v_status
  from social_challenges sc where sc.id = p_challenge_id;

  if v_metric is null or v_metric <> 'grade' then
    raise exception 'This challenge is not scored on a grade.';
  end if;

  -- Live band, not `= 'active'`. 0096 widened the vocabulary and a literal keeps its old meaning
  -- silently when the vocabulary grows — the same trap 0111's header calls out.
  if not challenge_is_live(v_status) then
    raise exception 'This challenge has already settled.';
  end if;

  update challenge_participants
     set reported_value = round(p_grade, 2),
         reported_at = now()
   where challenge_id = p_challenge_id
     and user_id = auth.uid()
     and state = 'accepted';

  if not found then
    raise exception 'You are not racing in this challenge.';
  end if;

  return round(p_grade, 2);
end;
$rg$;

grant execute on function report_challenge_grade(uuid, numeric) to authenticated;

-- ─────────────────────────── 4 · settlement ───────────────────────────
--
-- ⚠️ RESTATED IN FULL, AND RESTATED FROM THE LIVE BODY — not from 0127's file. The last definition
-- of a function is the only one that runs, so a restatement written from an older base silently
-- reverts every amendment made since. 0127's own header records this happening once already (it
-- had to restore 0122's draw branch by hand). This body was taken from `pg_proc.prosrc` on prod
-- immediately before writing, and the ONLY changes are:
--
--   · the three score expressions now go through challenge_racer_score / challenge_racer_completed;
--   · the duel arm zeroes a racer who missed a grade target, before the existing comparison runs;
--   · the collective arm's ranking uses the challenge's own metric instead of hardcoded 'xp'.
--
-- 0122's draw branch, 0127's placement arm and its statement ordering, and the 'elite' cap are all
-- carried through unchanged. Diff this against prosrc before and after if you are amending it.

create or replace function finalize_social_challenges()
returns void
language plpgsql
security definer
set search_path = public
as $fin$
declare
  r record;
  v_my numeric;
  v_opp numeric;
  v_field_count int;
  v_completed_count int;
  v_has_roster boolean;
  v_winner uuid;
begin
  -- Band, not `status = 'active'` (0111). 0096 widened the vocabulary with 'draft', and a sweep
  -- that tests a literal keeps its old meaning silently when the vocabulary grows.
  for r in
    select * from social_challenges sc
    where challenge_is_live(sc.status) and sc.ends_at <= now()
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
$fin$;

-- ─────────────────────────── 5 · the honour discount ───────────────────────────
--
-- ⚠️ RESTATED IN FULL FROM THE LIVE BODY, same rule as the sweep above. The only change is the
-- pair of honour knobs threaded into the four grant_reward calls; 0122's draw branch and 0127's
-- placement arm are carried through unchanged.

create or replace function economy_on_social_challenge_closed()
returns trigger
language plpgsql
security definer
set search_path = public
as $eco$
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
begin
  if new.status <> 'completed' or coalesce(old.status, '') = 'completed' then
    return new;
  end if;

  v_days := greatest(1, ceil(new.window_hours / 24.0)::int);

  -- coalesce, not a bare comparison: race_metric is NULL on a collective lock-in goal, and a
  -- NULL here would flow into every `case when v_honour` below as "not true" by accident rather
  -- than by decision.
  v_honour := coalesce(new.race_metric, '') = 'grade';
  v_intensity := case when v_honour then 0.8 else 1.0 end;
  v_cap := case when v_honour then 'impressive' else null end;

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
        true, new.id, case when v_honour then 'impressive' else 'elite' end);
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
$eco$;

-- ─────────────────────────── 6 · creating one ───────────────────────────
--
-- ⚠️ ALL THREE RESTATED FROM THE LIVE BODIES, for the reason the sweep above gives at length. Each
-- gains the same two defaulted parameters and nothing else changes: the friend check, the
-- duplicate-duel guard, the campfire-membership and admin gates, assert_challenge_span, the invite
-- push and mock 114's auto-entry are all carried through verbatim. Defaulted, so every existing
-- caller keeps working untouched.

create or replace function create_h2h_challenge(
  p_opponent_id uuid,
  p_race_metric text,
  p_window_hours int,
  p_circle_id uuid default null,
  p_payout_xp int default 200,
  p_public_name text default null,
  p_starts_on timestamptz default null,
  p_ends_on timestamptz default null,
  p_grade_target numeric default null,
  p_course_code text default null
)
returns social_challenges
language plpgsql
security definer
set search_path = public
as $ch$
declare
  v_challenge social_challenges;
begin
  perform assert_challenge_span(p_starts_on, p_ends_on);

  if p_opponent_id = auth.uid() then
    raise exception 'Pick someone else to challenge.';
  end if;

  if not exists (
    select 1 from friend_requests
    where status = 'accepted'
      and ((requester_id = auth.uid() and recipient_id = p_opponent_id)
        or (requester_id = p_opponent_id and recipient_id = auth.uid()))
  ) then
    raise exception 'You can only challenge a friend.';
  end if;

  if p_circle_id is not null and not is_group_member(p_circle_id) then
    raise exception 'Not a member of that campfire.';
  end if;

  if exists (
    select 1 from social_challenges
    where mode = 'h2h' and status in ('pending', 'active')
      and ((created_by = auth.uid() and opponent_id = p_opponent_id)
        or (created_by = p_opponent_id and opponent_id = auth.uid()))
  ) then
    raise exception 'You already have an active or pending challenge with this person.';
  end if;

  insert into social_challenges (circle_id, created_by, mode, opponent_id, race_metric, window_hours, payout_xp, status, public_name, shape, starts_on, ends_on, grade_target, course_code)
  values (p_circle_id, auth.uid(), 'h2h', p_opponent_id, p_race_metric, p_window_hours, p_payout_xp, 'pending', nullif(btrim(coalesce(p_public_name, '')), ''), 'duel', p_starts_on, p_ends_on,
          p_grade_target, nullif(btrim(coalesce(p_course_code, '')), ''))
  returning * into v_challenge;

  -- A GRADE DUEL NEEDS A ROSTER; THE OTHER FOUR METRICS DO NOT.
  --
  -- This asymmetry is deliberate and it is worth saying why rather than quietly widening it. The
  -- accumulating metrics are OBSERVED — settlement can score a duel with no challenge_participants
  -- rows at all through social_challenge_score, which is the legacy arm most live duels still take
  -- (only two challenges on prod have a roster today). A grade is REPORTED, and
  -- challenge_participants is the only place a reported mark can live: with no row there is
  -- nowhere for report_challenge_grade to write and nothing for challenge_racer_score to read, so
  -- the race would settle 0 - 0 for two people who both passed.
  --
  -- Creating rows for every duel would switch them all from the legacy arm to the roster arm. That
  -- is very likely where this should end up — 0111 and 0112 have been moving that way — but it is
  -- a behaviour change to every duel in the app and does not belong in the migration that adds
  -- grades. Left as one decision for one day.
  if p_race_metric = 'grade' then
    insert into challenge_participants (challenge_id, user_id, state, responded_at)
    values (v_challenge.id, auth.uid(), 'accepted', now()),
           (v_challenge.id, p_opponent_id, 'invited', null)
    on conflict (challenge_id, user_id) do nothing;
  end if;

  perform notify_push(
    array[p_opponent_id],
    'You''ve been challenged',
    (select display_name from profiles where id = auth.uid()) || ' challenged you to a head-to-head.',
    jsonb_build_object('type', 'challenge_invite', 'challenge_id', v_challenge.id),
    'accountability'
  );

  return v_challenge;
end;
$ch$;

grant execute on function create_h2h_challenge(uuid, text, int, uuid, int, text, timestamptz, timestamptz, numeric, text) to authenticated;

create or replace function create_group_challenge(
  p_circle_id uuid,
  p_target_count int,
  p_window_hours int,
  p_payout_xp int default 300,
  p_public_name text default null,
  p_starts_on timestamptz default null,
  p_ends_on timestamptz default null,
  p_grade_target numeric default null,
  p_course_code text default null
)
returns social_challenges
language plpgsql
security definer
set search_path = public
as $cg$
declare
  v_challenge social_challenges;
begin
  perform assert_challenge_span(p_starts_on, p_ends_on);

  if not is_group_member(p_circle_id) then
    raise exception 'Not a member of that campfire.';
  end if;

  -- Exactly one bar, matching social_challenges_mode_target_check. Caught here as well as by the
  -- constraint so the caller gets a sentence rather than a constraint name.
  if (p_target_count is not null) = (p_grade_target is not null) then
    raise exception 'A collective goal needs either a lock-in target or a grade target, not both.';
  end if;

  insert into social_challenges (circle_id, created_by, mode, target_count, window_hours, payout_xp, status, starts_at, ends_at, public_name, shape, starts_on, ends_on, race_metric, grade_target, course_code)
  values (p_circle_id, auth.uid(), 'group', p_target_count, p_window_hours, p_payout_xp, 'draft', null, null, nullif(btrim(coalesce(p_public_name, '')), ''), 'collective', p_starts_on, p_ends_on,
          case when p_grade_target is not null then 'grade' else null end,
          p_grade_target, nullif(btrim(coalesce(p_course_code, '')), ''))
  returning * into v_challenge;

  return v_challenge;
end;
$cg$;

grant execute on function create_group_challenge(uuid, int, int, int, text, timestamptz, timestamptz, numeric, text) to authenticated;

create or replace function create_placement_challenge(
  p_circle_id uuid,
  p_race_metric text,
  p_window_hours int,
  p_payout_xp int default 300,
  p_public_name text default null,
  p_starts_on timestamptz default null,
  p_ends_on timestamptz default null,
  p_grade_target numeric default null,
  p_course_code text default null
)
returns social_challenges
language plpgsql
security definer
set search_path = public
as $cp$
declare
  v_challenge social_challenges;
  v_starts timestamptz;
begin
  perform assert_challenge_span(p_starts_on, p_ends_on);

  -- ADMIN-GATED, matching start_challenge (0096). This is the one shape that conscripts an entire
  -- campfire without asking anyone, so the authority to call it has to be the campfire's own.
  if not is_campfire_admin(p_circle_id, auth.uid()) then
    raise exception 'Only campfire admins can start a placement race.';
  end if;

  if p_race_metric is null then
    raise exception 'A placement race needs a metric to rank people on.';
  end if;

  -- SCHEDULED OR IMMEDIATE, and the difference is the whole reason this is not one branch.
  --
  -- A semester race is set in August to run from September (mock 114: "Sep 8 -> Dec 12"). Starting
  -- it on creation would take every baseline in August and then credit a month of work nobody did
  -- inside the race — the exact unfairness no-auto-start (0098) and gun-time baselines (0096) were
  -- built to prevent, arriving through a different door.
  --
  -- So a future start stays a DRAFT with its roster already in place, and start_due_challenges()
  -- fires it at the gun. A start that is null or already past goes live now, which is the ordinary
  -- case and the one mock 114's single "Start placement race" button describes.
  v_starts := coalesce(p_starts_on, now());

  insert into social_challenges (
    circle_id, created_by, mode, shape, race_metric, target_count, window_hours, payout_xp,
    status, starts_at, ends_at, public_name, starts_on, ends_on, grade_target, course_code
  )
  values (
    p_circle_id, auth.uid(), 'group', 'placement', p_race_metric, null, p_window_hours, p_payout_xp,
    case when v_starts <= now() then 'active' else 'draft' end,
    case when v_starts <= now() then now() else null end,
    case when v_starts <= now() then coalesce(p_ends_on, now() + make_interval(hours => p_window_hours)) else null end,
    nullif(btrim(coalesce(p_public_name, '')), ''),
    p_starts_on, p_ends_on,
    p_grade_target, nullif(btrim(coalesce(p_course_code, '')), '')
  )
  returning * into v_challenge;

  -- AUTO-ENTRY: the whole campfire, already accepted. There is no invite step to skip here — being
  -- in the course campfire IS the entry (mock 114), and an 'invited' row that nobody answers would
  -- be deleted by start_challenge and quietly shrink the field a student thought they were in.
  --
  -- This is also what makes a GRADE placement race work without any new plumbing: the roster it
  -- writes here is the same roster report_challenge_grade writes a mark onto. "Being in the course
  -- campfire is the entry" is one sentence that happens to answer both questions.
  --
  -- baseline is set in the same statement when the race is already live, and left at the column
  -- default 0 for a scheduled one — start_due_challenges / start_challenge overwrite it at the gun,
  -- which is the only moment a baseline means anything. challenge_metric_value returns 0 for
  -- 'grade', which is exactly right: a grade is absolute and has no baseline to subtract.
  insert into challenge_participants (challenge_id, user_id, state, responded_at, baseline)
  select v_challenge.id, gm.user_id, 'accepted', now(),
         case when v_challenge.status = 'active'
           then challenge_metric_value(p_race_metric, gm.user_id, now())
           else 0 end
  from group_members gm
  where gm.group_id = p_circle_id
  on conflict (challenge_id, user_id) do nothing;

  -- Told, not asked. Everyone is in it either way, so this is an announcement — and without it a
  -- student's first news of a semester-long race would be its result.
  perform notify_event(
    (select coalesce(array_agg(gm.user_id), '{}') from group_members gm
      where gm.group_id = p_circle_id and gm.user_id <> auth.uid()),
    'campfire_challenge_started',
    'You''re in a placement race',
    coalesce(v_challenge.public_name, 'A ranked race') || ' just started in your campfire.',
    null, p_circle_id,
    '/challenge-info/[challengeId]', jsonb_build_object('challengeId', v_challenge.id::text),
    null, 'rounded',
    jsonb_build_object('challenge_id', v_challenge.id, 'shape', 'placement')
  );

  return v_challenge;
end;
$cp$;

grant execute on function create_placement_challenge(uuid, text, int, int, text, timestamptz, timestamptz, numeric, text) to authenticated;

-- ─────────────────────────── 7 · reads ───────────────────────────
--
-- get_my_social_challenges gains five columns, and they are the reason two separate bugs could not
-- be fixed on the client alone:
--
--   grade_target / course_code / my_reported_value
--       the grade race is unrenderable without them — a card cannot say "70% in KP451 · you
--       reported 74" from a row that carries none of the three.
--
--   my_final_rank / my_final_percentile
--       the viewer's own settled standing. A finished COLLECTIVE or PLACEMENT card had no result
--       to show at all — only the duel branch had anything to say once the clock stopped, which is
--       half of why finished challenges rendered inconsistently. 0111 has been writing these into
--       challenge_participants since it existed; nothing ever selected them here.

drop function if exists get_my_social_challenges();

create function get_my_social_challenges()
returns table (
  id uuid,
  circle_id uuid,
  circle_name text,
  circle_emoji text,
  created_by uuid,
  created_by_name text,
  mode text,
  opponent_id uuid,
  opponent_name text,
  race_metric text,
  my_score numeric,
  opponent_score numeric,
  target_count int,
  member_count int,
  completed_count int,
  window_hours int,
  starts_at timestamptz,
  ends_at timestamptz,
  status text,
  winner_id uuid,
  payout_xp int,
  created_at timestamptz,
  public_name text,
  shape text,
  invited_count int,
  accepted_count int,
  my_state text,
  grade_target numeric,
  course_code text,
  my_reported_value numeric,
  my_final_rank int,
  my_final_percentile numeric
)
language plpgsql
security definer
set search_path = public
stable
as $mine$
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
    (select cp.final_percentile from challenge_participants cp where cp.challenge_id = sc.id and cp.user_id = auth.uid()) as my_final_percentile
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
$mine$;

grant execute on function get_my_social_challenges() to authenticated;

-- ─────────────────────────── 8 · self-assertion ───────────────────────────
--
-- Proves the metric is genuinely accepted end to end rather than merely named in a constraint —
-- and rolls the whole probe back, so this migration writes no challenge of its own.
do $assert$
declare
  v_a uuid;
  v_b uuid;
  v_id uuid;
  v_score numeric;
begin
  -- TWO profiles, not one. `social_challenges_check` requires an h2h row to carry an opponent —
  -- an anonymous table CHECK that is easy to miss when reading the named ones — and a duel is the
  -- shape worth exercising here, since it is the one where the target acts as a floor.
  select id into v_a from profiles order by created_at limit 1;
  select id into v_b from profiles where id <> v_a order by created_at limit 1;

  if v_a is null or v_b is null then
    raise notice '0145: fewer than two profiles; grade path not exercised.';
    return;
  end if;

  insert into social_challenges (created_by, opponent_id, mode, shape, race_metric, window_hours,
                                 status, payout_xp, grade_target, course_code, starts_at, ends_at)
  values (v_a, v_b, 'h2h', 'duel', 'grade', 24, 'draft', 200, 70, 'KP451', now(), now() + interval '1 day')
  returning id into v_id;

  insert into challenge_participants (challenge_id, user_id, state, responded_at, reported_value)
  values (v_id, v_a, 'accepted', now(), 74);

  v_score := challenge_racer_score(v_id, v_a);
  if v_score <> 74 then
    raise exception '0145: challenge_racer_score returned % for a reported 74 — a grade is absolute, not net of a baseline.', v_score;
  end if;

  if not challenge_racer_completed(v_id, v_a) then
    raise exception '0145: 74 should clear a 70 target.';
  end if;

  update challenge_participants set reported_value = 61 where challenge_id = v_id and user_id = v_a;
  if challenge_racer_completed(v_id, v_a) then
    raise exception '0145: 61 should NOT clear a 70 target.';
  end if;

  -- An unreported racer scores 0, not NULL — the whole reason settlement can compare them.
  if challenge_racer_score(v_id, v_b) <> 0 then
    raise exception '0145: an unreported racer must score 0, got %.', challenge_racer_score(v_id, v_b);
  end if;

  -- 'draft', and the status is never flipped, so the economy trigger cannot fire and nothing is
  -- ever paid for this probe. Removed either way.
  delete from challenge_participants where challenge_id = v_id;
  delete from social_challenges where id = v_id;
end;
$assert$;
