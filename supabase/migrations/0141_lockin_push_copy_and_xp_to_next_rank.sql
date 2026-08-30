-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0141 · Notification copy: kill the check-in era wording, and tell people what the session bought
--
-- Two function bodies, both SPLICED ONTO THE LIVE prosrc rather than retyped from the migration
-- that last defined them. That distinction is the whole discipline here: a CREATE OR REPLACE
-- written from an older base silently reverts whatever a sibling branch added in between, and this
-- repo has lost work that way before. Both bodies were pulled from prod and diffed against their
-- source migrations first — 0012 for notify_group_of_check_in, 0120 for notify_session_complete —
-- and both matched byte for byte, so nothing below removes a line that was not already there.
--
-- No trigger is re-wired. `lock_in_sessions_complete_push` and the check-in trigger keep their
-- existing names and ordering (0120's note about name-order mattering against
-- lock_in_sessions_relics still holds); only the function bodies change.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- 1 · The campfire push still spoke in photo-proof language.
--
-- "just checked in 🔥" is left over from when a check-in WAS the product — you posted a photo and
-- your circle saw it. The product is lock-ins now; nothing in the app says "check in" to a user any
-- more, and a push that does reads like it came from a different app.
--
-- The fields also swap round. The old push led with the ACTIVITY as its title and buried who did it
-- in the body, which is backwards for a social notification: the whole reason it is worth a buzz is
-- that a person you know is working, so the person leads.
-- ───────────────────────────────────────────────────────────────────────────────────────────────
create or replace function notify_group_of_check_in()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_poster_name text;
  v_recipient_ids uuid[];
begin
  select display_name into v_poster_name from profiles where id = new.user_id;

  select coalesce(array_agg(distinct gm2.user_id), '{}')
  into v_recipient_ids
  from group_members gm1
  join group_members gm2 on gm1.group_id = gm2.group_id
  where gm1.user_id = new.user_id and gm2.user_id <> new.user_id;

  if array_length(v_recipient_ids, 1) > 0 then
    perform notify_push(
      v_recipient_ids,
      coalesce(v_poster_name, 'Someone') || ' locked in 🔥',
      coalesce(new.goal_detail, new.goal_label, initcap(new.goal_type)),
      jsonb_build_object('type', 'check_in', 'goal_type', new.goal_type)
    );
  end if;

  return new;
end;
$$;

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- 2 · The session-complete push now says how close the session got you.
--
-- It already said "45 min studying · +120 XP · 3-day streak. Nice work." — everything about what
-- just happened, and nothing about what it was FOR. "340 XP to Gold II" is the line that turns a
-- receipt into a reason to come back, and it is the one number the user cannot work out for
-- themselves from the notification.
--
-- Read at push time, not stored: universal_score() sums over check_ins, and this trigger fires on
-- the session row whose ended_check_in_id already exists — so the score, and therefore the gap,
-- already includes the session being announced. Telling someone they need 340 more when the 120
-- they just earned had not been counted yet would be worse than saying nothing.
--
-- The label formula is lifted from economy_track_rank_change (0121) rather than reinvented, down to
-- primordial carrying no division. Two places deriving "what is this rank called" differently is
-- how the push ends up naming a rank the app does not.
--
-- Max rank skips the clause entirely — no next threshold, no sentence. A user at the top of the
-- ladder gets exactly the push they got before.
-- ───────────────────────────────────────────────────────────────────────────────────────────────
create or replace function notify_session_complete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seconds int;
  v_minutes int;
  v_xp numeric;
  v_streak int;
  v_label text;
  v_body text;
  v_score numeric;
  v_to_next numeric;
  v_next_tier text;
  v_next_division int;
  v_next_label text;
begin
  if new.status <> 'completed' or coalesce(old.status, '') = 'completed' then
    return new;
  end if;

  select ci.duration_seconds, ci.xp_earned
    into v_seconds, v_xp
  from check_ins ci
  where ci.id = new.ended_check_in_id;

  v_minutes := coalesce(
    round(v_seconds / 60.0),
    round(extract(epoch from (new.last_confirmed_at - new.started_at)) / 60.0)
  )::int;

  -- A sub-minute session is a mis-tap, not an achievement. Still flips status, still counts
  -- everywhere else — it just does not earn a congratulatory push.
  if coalesce(v_minutes, 0) < 1 then return new; end if;

  select p.current_streak into v_streak from profiles p where p.id = new.user_id;

  v_label := case new.goal_type
    when 'gym' then 'in the gym'
    when 'study' then 'studying'
    when 'run' then 'on a run'
    when 'read' then 'reading'
    when 'job_applications' then 'on applications'
    else 'locked in'
  end;

  v_body := format('%s min %s', v_minutes, v_label);
  if coalesce(v_xp, 0) > 0 then
    v_body := v_body || format(' · +%s XP', round(v_xp));
  end if;

  -- ── how far to the next rank ──
  v_score := universal_score(new.user_id);
  select rt.cumulative_xp_required - v_score, rt.tier, rt.division
    into v_to_next, v_next_tier, v_next_division
  from rank_thresholds rt
  where rt.cumulative_xp_required > v_score
  order by rt.cumulative_xp_required asc
  limit 1;

  if coalesce(v_to_next, 0) > 0 then
    v_next_label := initcap(v_next_tier)
      || case when v_next_tier = 'primordial'
              then ''
              else ' ' || (array['', 'I', 'II', 'III'])[v_next_division + 1] end;
    -- ceil, not round: "0 XP to Gold II" on a user who has not got there yet is a lie, and a
    -- fractional score rounding down to zero is exactly how you would print one.
    v_body := v_body || format(' · %s XP to %s', ceil(v_to_next), v_next_label);
  end if;

  if coalesce(v_streak, 0) > 1 then
    v_body := v_body || format(' · %s-day streak', v_streak);
  end if;
  v_body := v_body || '. Nice work.';

  perform notify_event(
    array[new.user_id], 'session_complete',
    format('🔥 Locked in for %s min', v_minutes),
    v_body,
    null, new.id,
    '/(tabs)', '{}'::jsonb,
    null, 'flame',
    jsonb_build_object('minutes', v_minutes, 'xp', round(coalesce(v_xp, 0)),
                       'streak', coalesce(v_streak, 0), 'goal_type', new.goal_type,
                       -- Carried in the payload too, so the in-app feed row can show the same
                       -- thing without recomputing it against a score that has since moved.
                       'xp_to_next_rank', case when coalesce(v_to_next, 0) > 0 then ceil(v_to_next) end,
                       'next_rank', v_next_label)
  );

  return new;
end;
$$;

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- 3 · The legacy push vocabulary was never in the category map, so all of it filed as "friends".
--
-- Found while auditing that every notification type actually fires. There are two emitters —
-- notify_event (bell row + push) and the older notify_push (push only) — and they use DIFFERENT
-- type strings. Every one of notify_push's sixteen types ('streak_risk', 'challenge_invite',
-- 'mention', 'join_request', 'lockin_still_here', …) is absent from the CASE below, so all sixteen
-- hit the `else` and are categorised as friends_social.
--
-- Both paths consult this function for the per-type gate (0135), so that mis-filing is not
-- cosmetic. Today, muting "Friends & social" also silently kills streak-risk reminders, the
-- still-here nudge, challenge invites, chat mentions and campfire join requests — and muting
-- "Challenges" does not stop a challenge invite.
--
-- 🔴 CONSEQUENCE, because this changes behaviour for existing users rather than only fixing code:
-- anyone who muted Friends & social to silence one of these will start receiving it again, gated
-- from now on by the toggle whose name actually describes it. That is the intended behaviour of
-- the per-type gate; it has simply never been what happened.
--
-- The entire existing CASE is preserved verbatim — it was read out of prod, not retyped from a
-- migration. The comment inside it records this exact function losing a branch to a half-copy one
-- migration after the warning was written, which is the reason for the care.
-- ───────────────────────────────────────────────────────────────────────────────────────────────
create or replace function notification_category(p_type text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_type in ('friend_request', 'friend_accepted', 'friend_ranked_up', 'friend_passed_you',
                    'friend_joined', 'friend_locked_in',
                    -- §8 (NOTIFICATIONS_SPEC "Friends & social").
                    'milestone_cheered', 'milestone_posted',
                    -- The Agora (AGORA_SPEC) — reactions to you, on your own posts.
                    'agora_cheered', 'agora_commented',
                    -- notify_push's own names for the same two things.
                    'check_in', 'reaction') then 'friends_social'
    when p_type in ('challenged', 'challenge_accepted', 'challenge_declined', 'challenge_passed',
                    'challenge_ending_soon', 'challenge_won', 'challenge_lost', 'goal_at_risk',
                    'goal_streak_milestone', 'challenge_cheered',
                    -- notify_push's challenge vocabulary.
                    'challenge_invite', 'challenge_forfeited', 'challenge_change_request',
                    'challenge_change_answered', 'challenge_terms_updated') then 'challenges'
    when p_type in ('campfire_joined', 'campfire_join_request', 'campfire_challenge_started',
                    'campfire_cold', 'campfire_added', 'campfire_settled', 'campfire_message',
                    -- notify_push's campfire vocabulary: joining, chat and admin.
                    'join_request', 'join_request_approved', 'campfire_admin_granted',
                    'chat_batch', 'mention') then 'campfires'
    when p_type in ('streak_at_risk', 'daily_fire_reminder', 'streak_milestone',
                    -- INTEGRATION: 0120 (a parallel branch when this file was written) added the
                    -- session recap and mapped it here — "nudges about my own consistency" is the
                    -- toggle a user already reads as covering it. This function restates its whole
                    -- CASE on every redefinition, and this one was built from 0112 + 0093 without
                    -- sight of 0120, so restating it dropped the mapping onto the else-branch and
                    -- filed every recap under Friends & social. Exactly the half-copy failure the
                    -- comment above 0120's own version warns about, one migration later.
                    'session_complete',
                    -- All three are nudges about your own consistency, which is what this toggle
                    -- says on the tin.
                    'streak_risk', 'lock_in_nudge', 'lockin_still_here') then 'streak_reminders'
    when p_type in ('season_ending', 'season_settled', 'ranked_up', 'rank_dropped', 'reward_ready')
      then 'season_rank'
    else 'friends_social'
  end;
$$;
