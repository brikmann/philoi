-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- 0177 · A CHALLENGE FROM SOMEBODY YOU KNOW SHOULD ARRIVE WITH THEIR FACE ON IT.
--
-- Spec: CODE_PROMPT_loop_signoff_meta.md §4 — "make it a MOMENT, not a row". The client half (the
-- arena sheet presented over /challenge-info) is being built in a sibling session; this is the one
-- piece of it that lives in the database, and without it the moment opens with a generic flame.
--
-- 🔴 WHAT IS ACTUALLY WRONG, measured rather than reasoned about. create_h2h_challenge's live
-- body (0153's — confirmed by diffing pg_proc.prosrc against the file, which matters because 0164
-- and 0165 both touch challenge functions and either could have re-replaced it) sends its invite
-- through the legacy notify_push with:
--
--     jsonb_build_object('type', 'challenge_invite', 'challenge_id', v_challenge.id)
--
-- notify_push derives its actor from that payload and nothing else:
--
--     v_actor := nullif(coalesce(p_data->>'from_user_id', p_data->>'actor_id'), '')::uuid;
--
-- so v_actor has been null for every duel invite ever sent. Confirmed against prod: all four
-- challenge_invite rows in notification_events carry actor_id null. A null actor makes
-- notification_leading_art skip its first branch — the one returning the actor's avatar_url at
-- shape 'circle' — and fall through to the generic flame.
--
-- So the bell row for "someone challenged you" has never known who. That is a strange thing for a
-- duel invite not to know, and it is the highest-value line in §4: the challenger's face is what
-- makes an invite read as a person rather than as a system message.
--
-- ⚠️ NO ROUTE CHANGE, DELIBERATELY. challenge_invite has routed to '/challenge-info/[challengeId]'
-- since 0088, and that mapping is baked into every invite already sitting in a phone's tray. The
-- client presents the new arena over that existing route, so every push in the wild deep-links
-- into the new moment with no migration of live rows.
--
-- 🔒 THE GROUP/CAMPFIRE PATH NEEDS NOTHING, and checking that is why this touches one function
-- rather than two. notify_challenge_invited already passes v_c.created_by to notify_event as
-- p_actor_id, so it has always had its avatar — and since a team match inserts mode 'group' with
-- shape 'team_match', that same trigger covers team invites. "Fix the whole class" would have
-- meant rewriting a second function that was never broken.
--
-- REBASED ON 0153'S EXACT BODY, mechanically rather than by retyping: the definition below was
-- extracted from the 0153 file and patched at one call site, per the "parallel agents clobber
-- replaced functions" rule. Everything else — the span assertion, the self-challenge guard, the
-- friendship check, the grade branch, the roster insert — is 0153's, byte for byte.
-- ══════════════════════════════════════════════════════════════════════════════════════════════

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

  insert into social_challenges (circle_id, created_by, mode, opponent_id, race_metric, window_hours, payout_xp, status, public_name, shape, starts_on, ends_on, grade_target, course_code)
  values (p_circle_id, auth.uid(), 'h2h', p_opponent_id, p_race_metric, p_window_hours, p_payout_xp, 'pending', nullif(btrim(coalesce(p_public_name, '')), ''), 'duel', p_starts_on, p_ends_on,
          p_grade_target, nullif(btrim(coalesce(p_course_code, '')), ''))
  returning * into v_challenge;

  -- EVERY DUEL, NOT JUST A GRADE DUEL (0153). This was `if p_race_metric = 'grade'`, and that one
  -- condition is the whole of the "no standings were recorded" bug — see this file's header.
  --
  -- The asymmetry 0150 described was real: the accumulating metrics are OBSERVED, so settlement
  -- CAN score them with no roster at all, while a grade is REPORTED and has nowhere to live but
  -- this table. What that reasoning missed is that the roster is not only settlement's input. It
  -- is also where the standings, the reward receipt and the reveal's fire-once flag are kept, and
  -- all three of those are needed by every duel regardless of how its score is measured.
  --
  -- No baseline here: 'pending' has not started, and starts_at is null until the opponent accepts.
  -- respond_to_h2h_challenge takes both baselines at the gun, which is the only moment a baseline
  -- means anything.
  insert into challenge_participants (challenge_id, user_id, state, responded_at)
  values (v_challenge.id, auth.uid(), 'accepted', now()),
         (v_challenge.id, p_opponent_id, 'invited', null)
  on conflict (challenge_id, user_id) do nothing;

  -- 🔴 THE CHALLENGER'S FACE IS THE NOTIFICATION (§4). Two changes, and only these two.
  --
  -- 1. `from_user_id`. notify_push derives its actor as
  --      nullif(coalesce(p_data->>'from_user_id', p_data->>'actor_id'), '')::uuid
  --    and 0153's payload carried neither, so v_actor came out NULL on every duel invite ever
  --    sent — verified, not inferred: all four challenge_invite rows in prod carry actor_id null.
  --    A null actor sends notification_leading_art down its fallback and the bell row leads with
  --    the generic flame. With the actor set it takes the first branch and leads with the
  --    challenger's AVATAR at shape 'circle', which is the entire point of the moment: you should
  --    see WHO challenged you before you read a word.
  --
  --    Safe against notify_push's `where v_actor is null or u <> v_actor` recipient filter: the
  --    only recipient is p_opponent_id, and this function has already refused p_opponent_id =
  --    auth.uid() forty lines above, so the bell row cannot be filtered out by naming the actor.
  --
  -- 2. The title. 'You''ve been challenged' does not say by whom, and the name was sitting in the
  --    body being used for the less important half of the sentence. Matches the copy pattern
  --    0112 already established for 'challenge_cheered'.
  --
  --    coalesce'd, unlike 0153's body line: a null display_name would make the whole concatenation
  --    null, and a null TITLE is a push with no text at all rather than a slightly worse one.
  perform notify_push(
    array[p_opponent_id],
    '🔥 ' || coalesce((select display_name from profiles where id = auth.uid()), 'Someone')
          || ' challenged you',
    coalesce((select display_name from profiles where id = auth.uid()), 'Someone')
      || ' challenged you to a head-to-head.',
    jsonb_build_object(
      'type', 'challenge_invite',
      'challenge_id', v_challenge.id,
      'from_user_id', auth.uid()
    ),
    'accountability'
  );

  return v_challenge;
end;
$ch$;

comment on function create_h2h_challenge(uuid, text, int, uuid, int, text, timestamptz, timestamptz, numeric, text) is
  '0177 — 0153''s body with one call site changed: the invite payload now carries from_user_id, so notify_push resolves an actor and the bell row leads with the challenger''s avatar instead of the generic flame, and the title names them. Route unchanged (/challenge-info/[challengeId] since 0088) so invites already in the wild still deep-link correctly.';
