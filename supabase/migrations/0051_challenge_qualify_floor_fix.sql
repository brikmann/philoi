-- Fix: "challenge progress isn't counting" (both H2H and group).
--
-- Root cause: check_in_qualifies_for_challenge() required duration_seconds >= 1200 (20 MINUTES)
-- for a lock-in to count toward ANY social challenge. Both the H2H score (social_challenge_score)
-- and the group "N of M done" tally run through this gate, so every lock-in under 20 min was
-- invisible to challenges — a member could lock in five times and still show 0 progress. That's
-- wildly out of step with the effort economy's own floor (a lock-in earns XP well below 20 min),
-- so the intuitive contract "if it earned XP, it counts toward the challenge" was silently broken.
--
-- Fix: lower the floor to 60s, matching the anti-farming XP floor (migration 0033) so challenge
-- qualification and XP-earning agree. The gym-specific proof requirement (a gym lock-in needs a
-- photo or logged sets) is unchanged — that's real anti-cheese, not an arbitrary duration wall.
--
-- TUNABLE: 60 is the "counts for XP = counts for a challenge" value. If you want challenge lock-ins
-- to require a more substantial session than a bare XP-earning one, raise this single number
-- (e.g. 300 for a 5-min floor). Do NOT put it back near 1200.

create or replace function check_in_qualifies_for_challenge(p_check_in_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    ci.duration_seconds is not null
    and ci.duration_seconds >= 60
    and (
      ci.goal_type != 'gym'
      or exists (select 1 from check_in_photos where check_in_id = ci.id)
      or exists (select 1 from check_in_workout_sets where check_in_id = ci.id)
    )
  from check_ins ci
  where ci.id = p_check_in_id;
$$;
