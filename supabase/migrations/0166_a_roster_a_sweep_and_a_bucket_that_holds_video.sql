-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- 0166 · A ROSTER, A SWEEP, AND A BUCKET THAT CAN HOLD A CLIP.
--
-- Spec: CODE_PROMPT_honor_vouch.md §2/§3/§5, design-mocks/176-honor-vouch-flow.html (frames 0→D),
-- CHALLENGE_CINDY_SCOPING.md §Verification, DIFFICULTY_SCOPING.md §Anti-cheese.
--
-- ─────────────────────────── WHERE THIS PICKS UP ───────────────────────────
--
-- 0164 built the honour path: claim → window → resolve → ONE grant at the settled band. 0165 fixed
-- the hole in it — a clip stopped resolving to 'vouched' on its own, so media is an attachment that
-- informs a friend's yes rather than a check nobody performs. Both of those are live on prod and
-- this file changes NEITHER decision. `goal_paid_band`, the honour cap, the one-grant architecture
-- and 0165's proof rule are all left exactly as they stand.
--
-- What is left is that the flow the mock draws still cannot run end to end. Four things, and three
-- of them are load-bearing rather than cosmetic:
--
--   🔴 THE WINDOW NEVER CLOSES. settle_expired_vouches() was written in 0164, granted, and never
--      scheduled. Nothing in the database calls it. A claim that asks friends and gets fewer than
--      two vouches sits at completed_at null FOREVER: not settled, not paid, not expired.
--      finalize_social_challenges cannot catch it — that sweeps social_challenges, and a goal is a
--      row in `challenges`. This is live on prod right now and it is the reason to ship this file.
--
--   🔴 THE BUCKET REJECTS VIDEO. §2 says the proof is a live-recorded clip. campfire-photos (0158)
--      admits image/jpeg, image/png and image/webp at 8 MB, so a clip is refused by the bucket
--      before any policy is consulted. "Record a clip" cannot work at all until this moves.
--
--   · NO ROSTER. Mock frame C names the people who were asked ("Maya & Dee were asked"). Only
--     ANSWERS are recorded, so the claimant's own pending screen could show "0 of 2" and nothing
--     else — in the one view where knowing WHO is the entire point of looking.
--
--   · TIDY-UP 0165 FLAGGED ITSELF. Its header records that vouch_deadline is set unconditionally,
--     including on the nobody-asked path that settles in the same call, and asks a later migration
--     to condition it. This is that migration.
--
-- ─────────────────────────── THE ROSTER, AND WHY IT IS SAFE ───────────────────────────
--
-- `verdict` goes nullable and the ASK writes the row: one row per person asked, null verdict
-- meaning "asked, hasn't answered". The risk in that is obvious — an invitation must never be
-- mistaken for a yes — and it is closed by the shape of the existing queries rather than by new
-- ones. Every threshold count already reads `where verdict and counted`, and in SQL `null and true`
-- is null, not true, so a roster row cannot be counted. That is asserted below rather than assumed.
--
-- The one thing the roster genuinely breaks is submit_vouch's conflict arm, and it must be fixed in
-- the same file. 0164/0165 used `on conflict do nothing`, which was right when the only rows were
-- answers. With the ask writing first, `do nothing` would silently discard EVERY answer from an
-- invited friend — the exact people the whole flow exists for. It becomes an update guarded on
-- `verdict is null`, so an answered row stays immutable and nobody can re-answer past a cap.
-- ══════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────── §3 · the roster ───────────────────────────

alter table goal_vouches alter column verdict drop not null;

comment on column goal_vouches.verdict is
  '0166 — null means ASKED AND UNANSWERED, which is what mock 176 frame C renders. true/false is the answer. Every threshold count filters `verdict and counted`, and `null and true` is null, so a roster row cannot be mistaken for a yes.';

comment on column goal_vouches.created_at is
  '0166 — set when the row is written (the ask) and moved to the answer when one lands, because the anti-collusion windows measure ANSWERS, not invitations.';

-- ─────────────────────────── §3 · the ask writes the roster ───────────────────────────
--
-- ⚠️ RESTATED FROM 0165'S LIVE prosrc, read off prod rather than reconstructed from its file. Two
-- changes and nothing else:
--
--   1. the roster insert, which is the point of the file;
--   2. vouch_deadline becomes conditional — the tidy-up 0165's own header asked for.
--
-- 🔒 0165'S RULE SURVIVES THIS RESTATEMENT INTACT. There is still no `p_proof_path is not null`
-- branch resolving to 'vouched'; a clip with nobody to show it to still settles at honour like any
-- bare claim. That is asserted at the bottom against the live definition, in both directions,
-- because a restated body is exactly where a removed arm quietly comes back.
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

  -- Self-vouching is not a thing, and neither is asking the same person twice.
  -- MOVED ABOVE THE UPDATE (0165 had it below) so the deadline can depend on it.
  select coalesce(array_agg(distinct u), '{}') into v_asked
    from unnest(coalesce(p_voucher_ids, '{}')) as u
   where u <> auth.uid();

  update challenges
     set claimed_at = now(),
         proof_path = p_proof_path,
         -- 0166 — conditional, per 0165's own "KNOWN AND DELIBERATELY LEFT" note. No deadline when
         -- nobody was asked: that claim settles in this same call, and a window on a settled goal
         -- is a date the expiry sweep would keep finding and skipping.
         vouch_deadline = case when array_length(v_asked, 1) is null then null else now() + interval '48 hours' end
   where id = p_goal_id;

  -- ── NOBODY ASKED → SETTLE AT HONOUR, WITH OR WITHOUT A CLIP ──
  --
  -- 0165's rule, restated verbatim in effect: a clip with nobody to show it to is a private file,
  -- and paying a box tier for one is the hole 0165 closed. The proof is still STORED — it rides
  -- along to the vouchers when there are any, and it is what a report would be adjudicated against.
  if array_length(v_asked, 1) is null then
    perform resolve_goal_claim(p_goal_id, 'honor');
    return jsonb_build_object('state', 'resolved', 'level', 'honor', 'asked', 0,
                              'has_proof', p_proof_path is not null);
  end if;

  -- 0166 — THE ROSTER. Written before the notification so a friend who taps the push in the same
  -- second as it is sent finds their row already there.
  insert into goal_vouches (goal_id, voucher_id, verdict, counted)
  select p_goal_id, u, null, false from unnest(v_asked) as u
  on conflict (goal_id, voucher_id) do nothing;

  select display_name into v_name from profiles where id = auth.uid();

  perform notify_event(
    v_asked,
    'vouch_requested',
    coalesce(v_name, 'A friend') || ' wants you to vouch',
    coalesce(v_name, 'They') || ' says: ' || coalesce(nullif(btrim(v_goal.label), ''), 'they did it') || '. Did they?'
      || case when p_proof_path is not null then ' There is a clip.' else '' end,
    auth.uid(), p_goal_id,
    '/vouch/[goalId]', jsonb_build_object('goalId', p_goal_id::text),
    -- Leading art is the REQUESTER's avatar (spec §Notifications): the question is "do you believe
    -- this person", so the person is the subject.
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
  '0166 — 0165''s body plus the ask-time roster and a conditional deadline. Proof is still an ATTACHMENT shown to vouchers and never a resolution: only two counting vouches reach ''vouched''.';

revoke all on function claim_goal_complete(uuid, text, uuid[]) from public;
grant execute on function claim_goal_complete(uuid, text, uuid[]) to authenticated;

-- ─────────────────────────── §3 · the answer fills the roster row ───────────────────────────
--
-- ⚠️ RESTATED FROM 0164 (0165 did not touch it). Every counting rule is byte-identical — same pair
-- twice per 30 days, five a week per giver, two distinct friends, never your own goal — and each
-- still only decides whether a vouch COUNTS, never whether it is accepted and never whether the
-- goal can settle. A capped-out claim settles at honour, where it started.
--
-- The conflict arm is the change, and see the header for why it is not optional.
create or replace function submit_vouch(p_goal_id uuid, p_verdict boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_goal challenges;
  v_counts boolean := false;
  v_pair int;
  v_week int;
  v_total int;
  v_answered boolean;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;

  select * into v_goal from challenges where id = p_goal_id;
  if v_goal.id is null or v_goal.claimed_at is null then
    raise exception 'Nothing to vouch for.';
  end if;
  if v_goal.user_id = auth.uid() then
    raise exception 'You cannot vouch for your own goal.';
  end if;
  if v_goal.completed_at is not null then
    raise exception 'That one has already settled.';
  end if;
  if v_goal.vouch_deadline is not null and now() > v_goal.vouch_deadline then
    raise exception 'That vouch window has closed.';
  end if;

  -- 0166 — an invitation is a row now, so "have you answered" is no longer "does a row exist".
  select verdict is not null into v_answered
    from goal_vouches where goal_id = p_goal_id and voucher_id = auth.uid();
  if coalesce(v_answered, false) then
    raise exception 'You already answered this one.';
  end if;

  if p_verdict then
    -- SAME-PAIR LIMIT — this voucher has counted for this owner at most twice in 30 days.
    select count(*) into v_pair
      from goal_vouches gv join challenges c on c.id = gv.goal_id
     where gv.voucher_id = auth.uid() and c.user_id = v_goal.user_id
       and gv.counted and gv.created_at > now() - interval '30 days';

    -- GIVER RATE LIMIT — at most five counting vouches a week from one account, so one person
    -- cannot authenticate a whole ring.
    select count(*) into v_week
      from goal_vouches gv
     where gv.voucher_id = auth.uid() and gv.counted
       and gv.created_at > now() - interval '7 days';

    v_counts := v_pair < 2 and v_week < 5;
  end if;

  insert into goal_vouches (goal_id, voucher_id, verdict, counted, created_at)
  values (p_goal_id, auth.uid(), p_verdict, v_counts, now())
  on conflict (goal_id, voucher_id) do update
    set verdict = excluded.verdict,
        counted = excluded.counted,
        -- Moved to the ANSWER. The rate-limit windows above measure answers, and leaving this at
        -- the invitation would let a stale ask age a vouch out of its own 30-day window.
        created_at = excluded.created_at
    where goal_vouches.verdict is null;

  -- TWO DISTINCT FRIENDS. The primary key guarantees distinctness; this counts what landed. A null
  -- verdict is not true, so unanswered invitations cannot count.
  select count(*) into v_total
    from goal_vouches where goal_id = p_goal_id and verdict and counted;

  if v_total >= 2 then
    perform resolve_goal_claim(p_goal_id, 'vouched');

    perform notify_event(
      array[v_goal.user_id],
      'vouch_passed',
      '2 friends vouched',
      'Your reward went up — ' || coalesce(nullif(btrim(v_goal.label), ''), 'that goal') || ' is confirmed.',
      null, p_goal_id,
      '/challenge-info/[challengeId]', jsonb_build_object('challengeId', p_goal_id::text),
      null, 'rounded',
      jsonb_build_object('goal_id', p_goal_id)
    );
  end if;

  return jsonb_build_object('counted', v_counts, 'vouches', v_total, 'resolved', v_total >= 2);
end;
$$;

comment on function submit_vouch(uuid, boolean) is
  '0166 — a friend answers, filling the roster row the ask wrote. The anti-collusion rules only ever decide whether a vouch COUNTS; they never refuse the row and never block settlement.';

revoke all on function submit_vouch(uuid, boolean) from public;
grant execute on function submit_vouch(uuid, boolean) to authenticated;

-- NOTE: get_vouch_request is 0165's and is NOT restated here. It already returns proof_path, which
-- is everything frame D needs, and restating a correct function is how a sibling's change gets
-- silently reverted by a body reconstructed from an older base.

-- ─────────────────────────── §3 · what the claimant's pending screen reads (frame C) ──────────
--
-- The owner's mirror of get_vouch_request. Owner-only, because it names who was asked and how each
-- of them answered — get_vouch_request is open by design (a notification link must render for
-- whoever holds it) and this is the half that must not be.
create or replace function get_claim_status(p_goal_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_goal challenges;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;

  select * into v_goal from challenges where id = p_goal_id and user_id = auth.uid();
  if v_goal.id is null then
    raise exception 'That goal is not yours.';
  end if;

  return jsonb_build_object(
    'goal_id', v_goal.id,
    'label', v_goal.label,
    'tier', v_goal.difficulty_tier,
    'claimed_at', v_goal.claimed_at,
    'deadline', v_goal.vouch_deadline,
    'proof_path', v_goal.proof_path,
    'settled', v_goal.completed_at is not null,
    -- The level it has ACTUALLY reached. Before settlement that is always the floor: a pending
    -- claim already holds the honour band and can only go up from there.
    'level', v_goal.verifiability,
    'vouches', (select count(*) from goal_vouches where goal_id = p_goal_id and verdict and counted),
    'needed', 2,
    -- The roster, in ask order. `answered` is null while a friend has not replied, which is what
    -- frame C's "· asked" chip renders.
    'asked', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id,
               'name', coalesce(p.display_name, 'Someone'),
               'avatar', p.avatar_url,
               'answered', gv.verdict,
               'counted', gv.counted
             ) order by gv.created_at)
        from goal_vouches gv join profiles p on p.id = gv.voucher_id
       where gv.goal_id = p_goal_id
    ), '[]'::jsonb)
  );
end;
$$;

comment on function get_claim_status(uuid) is
  '0166 — mock 176 frame C. The claimant''s own view of a pending claim: who was asked, who answered, how long is left. Owner-only.';

revoke all on function get_claim_status(uuid) from public;
grant execute on function get_claim_status(uuid) to authenticated;

-- ─────────────────────────── §3 · 🔴 the window finally closes ───────────────────────────
--
-- THE BUG THIS FILE EXISTS FOR. settle_expired_vouches has existed since 0164 and nothing has ever
-- called it, so every claim that asks friends and falls short of two sits unsettled and UNPAID.
--
-- Appended to the existing tick rather than given its own schedule — one sweep schedule to reason
-- about — and placed LAST: a vouch landing in the same ten-minute window has already resolved the
-- goal, and resolve_goal_claim is idempotent on completed_at, so neither order can pay twice.
select cron.unschedule('philoi-finalize-social-challenges')
where exists (select 1 from cron.job where jobname = 'philoi-finalize-social-challenges');

select cron.schedule(
  'philoi-finalize-social-challenges',
  '*/10 * * * *',
  $$select start_due_challenges(); select finalize_social_challenges(); select settle_expired_vouches();$$
);

-- ─────────────────────────── §2 · the bucket can hold a clip ───────────────────────────
--
-- Live-recorded video only ever reaches here through the in-app camera — there is no gallery entry
-- point, which is the anti-cheese §2 actually asks for. quicktime is admitted because that is what
-- an iOS capture hands back before compression; the client compresses to mp4, so accepting the
-- source type means a failed compression degrades to a larger upload rather than a rejected claim.
--
-- Widened rather than given its own bucket: a second bucket is a second storage policy to keep in
-- step with the first, and the own-id prefix rule that claim_goal_complete and
-- messages_attachment_shape both enforce is the SAME rule, so one bucket keeps it one rule.
do $$
begin
  if not exists (select 1 from information_schema.tables
                  where table_schema = 'storage' and table_name = 'buckets') then
    raise notice 'storage schema absent — skipping campfire-photos bucket widening';
    return;
  end if;

  update storage.buckets
     set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime'],
         -- 25 MB. A 15s compressed 720p clip is 2-4 MB; the headroom is for a capture whose
         -- compression failed, not a budget to fill.
         file_size_limit = 26214400
   where id = 'campfire-photos';
end $$;

-- ─────────────────────────── asserted at deploy ───────────────────────────
do $assert$
declare
  v_ok boolean;
begin
  -- 1 · 🔒 0165'S RULE SURVIVED THE RESTATEMENT, in both directions. Asserted against the live
  --     definition because a restated body is exactly where a removed arm comes back. Note the
  --     string 'vouched' still appears in claim_goal_complete's COMMENTS describing the arm that
  --     was removed, so this matches the CALL specifically and not the word.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'claim_goal_complete'
       and pg_get_functiondef(p.oid) like '%perform resolve_goal_claim(p_goal_id, ''vouched'')%'
  ) then
    raise exception '0166: claim_goal_complete can resolve to vouched on its own again — 0165 undone.';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'submit_vouch'
       and pg_get_functiondef(p.oid) like '%perform resolve_goal_claim(p_goal_id, ''vouched'')%'
  ) then
    raise exception '0166: submit_vouch lost its resolve — two friends would no longer pay out.';
  end if;
  -- 0165 owns get_vouch_request; this file must not have disturbed it.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'get_vouch_request' and p.prosrc like '%proof_path%'
  ) then
    raise exception '0166: get_vouch_request no longer returns proof_path — 0165 was clobbered.';
  end if;

  -- 2 · the gradient did not move. Neither this file nor 0165 touches the ladder.
  if goal_paid_band('epic', 'honor') is distinct from 'notable' then
    raise exception '0166: honour epic must still pay notable — the anti-cheese cap moved.';
  end if;
  if goal_paid_band('epic', 'vouched') is distinct from 'impressive' then
    raise exception '0166: a vouched epic must still pay its full band.';
  end if;

  -- 3 · an unanswered invitation is not a yes. The roster rows are new and every threshold count
  --     depends on this, so it is asserted rather than assumed.
  select (null::boolean and true) is not true into v_ok;
  if not v_ok then
    raise exception '0166: an unanswered invitation would count toward the threshold.';
  end if;
  if (select is_nullable from information_schema.columns
       where table_schema = 'public' and table_name = 'goal_vouches' and column_name = 'verdict') <> 'YES' then
    raise exception '0166: verdict must be nullable or the ask cannot write a roster row.';
  end if;

  -- 4 · 🔴 the window is actually swept now. The one change here with no visible symptom until 48
  --     hours after a claim, which is exactly why it went unnoticed in 0164.
  if not exists (
    select 1 from cron.job
     where jobname = 'philoi-finalize-social-challenges'
       and command like '%settle_expired_vouches%'
  ) then
    raise exception '0166: the vouch expiry sweep is still unscheduled — claims will hang unpaid.';
  end if;
  if not exists (
    select 1 from cron.job
     where jobname = 'philoi-finalize-social-challenges'
       and command like '%finalize_social_challenges%'
       and command like '%start_due_challenges%'
  ) then
    raise exception '0166: the restated cron command dropped one of 0126''s two sweeps.';
  end if;

  -- 5 · the clip can reach the bucket. Without this the record path fails at upload and §2 is dead
  --     on arrival — and the photo types must have SURVIVED, or campfire chat stops sending.
  if exists (select 1 from information_schema.tables
              where table_schema = 'storage' and table_name = 'buckets') then
    if not exists (select 1 from storage.buckets
                    where id = 'campfire-photos' and 'video/mp4' = any(allowed_mime_types)) then
      raise exception '0166: campfire-photos still rejects video — proof clips cannot upload.';
    end if;
    if not exists (select 1 from storage.buckets
                    where id = 'campfire-photos' and 'image/jpeg' = any(allowed_mime_types)) then
      raise exception '0166: the widening dropped image/jpeg — campfire photos would stop sending.';
    end if;
  end if;

  -- 6 · one definition each. get_claim_status is new, so this set is ten; anything else means an
  --     overload was created (MIGRATIONS.md's three-time trap).
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname in
         ('economy_on_challenge_completed', 'log_challenge_progress', 'goal_paid_band',
          'claim_goal_complete', 'submit_vouch', 'resolve_goal_claim',
          'get_vouch_request', 'get_claim_status', 'settle_expired_vouches',
          'notification_category')) <> 10 then
    raise exception '0166: an overload was created — count pg_proc before pushing.';
  end if;

  raise notice '0166 ok — the roster is writable, the window is swept, and the bucket holds a clip.';
end
$assert$;
