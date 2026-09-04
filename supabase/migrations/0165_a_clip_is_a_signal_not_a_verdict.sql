-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- 0165 · A CLIP IS A SIGNAL, NOT A VERDICT. Attaching media must not, by itself, pay the full box.
--
-- Spec: design-mocks/176-honor-vouch-flow.html, which lands AFTER 0164 shipped and tightens the
-- rule 0164 implemented.
--
-- ⚠️ THIS FILE WAS DELETED ONCE AND RESTORED. It was untracked when a sibling session, resolving a
-- 0165 number collision, deleted it believing it belonged to a session that had handed it over. It
-- had ALREADY BEEN APPLIED TO PROD by then — supabase_migrations.schema_migrations carries
-- version 0165, name a_clip_is_a_signal_not_a_verdict — so deleting the file did not undo anything;
-- it created a phantom (a remote row with no local file), which is precisely the state
-- MIGRATIONS.md says to reconcile before adding to the pile. Restored verbatim from the session
-- that wrote it. The content below is what actually ran against prod; do not "fix" it to match a
-- later idea of what it should have said, because the database will not change to match.
--
-- ─────────────────────────── WHAT 0164 GOT WRONG ───────────────────────────
--
-- 0164 read CHALLENGE_CINDY_SCOPING.md §Verification literally:
--
--     Vouched | self-reported + 1–2 friends confirm (OR A PHOTO/VIDEO) | full box tier
--
-- and implemented the parenthesis: `claim_goal_complete` with a proof path resolved straight to
-- 'vouched' and paid the full band with no human in the loop. Mock 176 is explicit that this is the
-- wrong reading, and its argument is the one that decides it:
--
--     "The clip is a social signal, not proof. We can't (and don't try to) verify a video is
--      authentic or of that person... Integrity comes from the vouch + social visibility + the
--      honor discount, not from trusting the media."
--
-- 🔴 THE HOLE, PLAINLY: attach any video at all — one off the internet, one of somebody else, one
-- of a completely different feat — and 0164 paid the full Vessel of Hestia. Nothing looked at it,
-- server-side or human-side, because 0164's own comment said out loud that nothing reads the image.
-- A check nobody performs is not a check, and it was gating a whole box tier.
--
-- ─────────────────────────── WHAT CHANGES ───────────────────────────
--
-- Proof stops being a resolution and becomes an ATTACHMENT to the ask. After this:
--
--   · a claim with proof and vouchers → pending, and the vouchers get to SEE the clip;
--   · a claim with proof and nobody asked → settles at honour, exactly like a bare claim;
--   · only two counting vouches ever reach 'vouched'.
--
-- So the media's job is to make a friend's yes better informed, which is what mock 176 means by a
-- social signal. The human who knows you is the check.
--
-- The client half ships with this: capture moves to the CAMERA ONLY (no gallery), which is the
-- other half of the mock's fix — it is what makes "a random backflip off YouTube" not merely
-- worthless but unattachable in the first place.
--
-- 🔒 NOTHING HERE CHANGES A PAID BAND, AND NOTHING IS CLAWED BACK. goal_paid_band, the tier table
-- and the honour cap are all untouched — this only changes which LEVEL a claim resolves to, and
-- only for claims made from here on. Any goal already settled keeps what it was paid; there are
-- none on prod (asserted below), because 0164 shipped hours ago and the client that calls it has
-- never been in a build.
--
-- KNOWN AND DELIBERATELY LEFT: `vouch_deadline` is set unconditionally, including on the
-- nobody-asked path that settles in the same call, so a settled goal can carry a deadline that has
-- already been overtaken. Harmless — settle_expired_vouches filters on `completed_at is null` — but
-- it is untidy and a later migration should condition it.
-- ══════════════════════════════════════════════════════════════════════════════════════════════

create or replace function claim_goal_complete(
  p_goal_id uuid,
  p_proof_path text default null,
  p_voucher_ids uuid[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_goal challenges;
  v_asked uuid[];
  v_name text;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;

  select * into v_goal from challenges c where c.id = p_goal_id and c.user_id = auth.uid();
  if v_goal.id is null then
    raise exception 'That goal is not yours.';
  end if;
  if v_goal.completed_at is not null then
    raise exception 'That goal is already finished.';
  end if;
  if v_goal.claimed_at is not null then
    raise exception 'You have already marked that one done.';
  end if;

  if p_proof_path is not null and p_proof_path not like (auth.uid()::text || '/%') then
    raise exception 'That proof does not belong to you.';
  end if;

  update challenges
     set claimed_at = now(),
         proof_path = p_proof_path,
         vouch_deadline = now() + interval '48 hours'
   where id = p_goal_id;

  -- Self-vouching is not a thing, and neither is asking the same person twice.
  select coalesce(array_agg(distinct u), '{}') into v_asked
    from unnest(coalesce(p_voucher_ids, '{}')) as u
   where u <> auth.uid();

  -- ── NOBODY ASKED → SETTLE AT HONOUR, WITH OR WITHOUT A CLIP ──
  --
  -- 0164 had a `p_proof_path is not null` branch above this that resolved to 'vouched' and returned.
  -- It is gone. A clip with nobody to show it to is a private file, and paying a box tier for one
  -- is the hole this migration exists to close. The proof is still STORED — it rides along to the
  -- vouchers when there are any, and it is what a report would be adjudicated against later.
  if array_length(v_asked, 1) is null then
    perform resolve_goal_claim(p_goal_id, 'honor');
    return jsonb_build_object('state', 'resolved', 'level', 'honor', 'asked', 0,
                              'has_proof', p_proof_path is not null);
  end if;

  select display_name into v_name from profiles where id = auth.uid();

  perform notify_event(
    v_asked,
    'vouch_requested',
    coalesce(v_name, 'A friend') || ' wants you to vouch',
    coalesce(v_name, 'They') || ' says: ' || coalesce(nullif(btrim(v_goal.label), ''), 'they did it') || '. Did they?',
    auth.uid(), p_goal_id,
    '/vouch/[goalId]', jsonb_build_object('goalId', p_goal_id::text),
    null, 'circle',
    jsonb_build_object('goal_id', p_goal_id)
  );

  return jsonb_build_object(
    'state', 'pending_vouch',
    'level', 'honor',
    'asked', coalesce(array_length(v_asked, 1), 0),
    'has_proof', p_proof_path is not null,
    'deadline', (now() + interval '48 hours')
  );
end;
$$;

comment on function claim_goal_complete(uuid, text, uuid[]) is
  '0165 — the honour path''s "I did it". Proof is an ATTACHMENT shown to vouchers, never a resolution: only two counting vouches reach ''vouched''. A claim with nobody asked settles at honour whether or not a clip came with it.';

-- ─────────────────────────── the vouch screen can see the clip ───────────────────────────
--
-- Mock 176 frame D shows the claimant's clip above the Vouch/Nah buttons — "you decide if it
-- counts". A voucher asked to judge a claim they cannot see is being asked to rubber-stamp it, so
-- the path goes out with the request.
create or replace function get_vouch_request(p_goal_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_goal challenges;
  v_name text;
  v_avatar text;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;

  select * into v_goal from challenges where id = p_goal_id;
  if v_goal.id is null or v_goal.claimed_at is null then
    raise exception 'Nothing to vouch for.';
  end if;

  select display_name, avatar_url into v_name, v_avatar from profiles where id = v_goal.user_id;

  return jsonb_build_object(
    'goal_id', v_goal.id,
    'label', v_goal.label,
    'tier', v_goal.difficulty_tier,
    'claimant', coalesce(v_name, 'Someone'),
    'claimant_avatar', v_avatar,
    'claimed_at', v_goal.claimed_at,
    'deadline', v_goal.vouch_deadline,
    -- 0165 · what they are being asked to judge.
    'proof_path', v_goal.proof_path,
    'settled', v_goal.completed_at is not null,
    'expired', v_goal.vouch_deadline is not null and now() > v_goal.vouch_deadline,
    'is_mine', v_goal.user_id = auth.uid(),
    'my_verdict', (select verdict from goal_vouches where goal_id = p_goal_id and voucher_id = auth.uid()),
    'vouches', (select count(*) from goal_vouches where goal_id = p_goal_id and verdict and counted)
  );
end;
$$;

revoke all on function get_vouch_request(uuid) from public;
grant execute on function get_vouch_request(uuid) to authenticated;

-- ─────────────────────────── asserted at deploy ───────────────────────────
do $assert$
declare
  v_leaked int;
begin
  -- 1 · NOBODY WAS PAID UNDER THE OLD RULE. 0164 shipped hours ago and no build has ever carried
  --     the client that calls it, so this should be zero — but "should be" is not a check, and if
  --     it is ever non-zero the right response is to look at those rows, not to push past them.
  select count(*) into v_leaked
    from challenges
   where verifiability = 'vouched'
     and proof_path is not null
     and not exists (select 1 from goal_vouches gv where gv.goal_id = challenges.id and gv.verdict and gv.counted);
  if v_leaked > 0 then
    raise exception '0165: % goal(s) reached vouched on proof alone under 0164''s rule. Review them before pushing — this migration changes the rule but does not claw anything back.', v_leaked;
  end if;

  -- 2 · the bands are untouched. This migration moves no money.
  if goal_paid_band('epic', 'honor') is distinct from 'notable'
     or goal_paid_band('epic', 'vouched') is distinct from 'impressive'
     or goal_paid_band('legendary', 'auto') is distinct from 'elite' then
    raise exception '0165: a paid band moved — this migration must not touch the ladder.';
  end if;

  -- 3 · the resolution branch is really gone.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'claim_goal_complete'
       and pg_get_functiondef(p.oid) like '%resolve_goal_claim(p_goal_id, ''vouched'')%'
  ) then
    raise exception '0165: claim_goal_complete can still resolve to vouched on its own.';
  end if;

  -- 4 · no overloads.
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname in ('claim_goal_complete', 'get_vouch_request')) <> 2 then
    raise exception '0165: an overload was created.';
  end if;

  raise notice '0165 ok — a clip no longer buys a box; two friends still do.';
end
$assert$;
