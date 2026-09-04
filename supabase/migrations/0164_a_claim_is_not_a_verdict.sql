-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- 0164 · A CLAIM IS NOT A VERDICT — the honor path gets proof, a vouch, and a window.
--
-- Spec: CHALLENGE_CINDY_SCOPING.md §Verification (the vouch flow, the anti-collusion caps),
-- DIFFICULTY_SCOPING.md §Anti-cheese, CODE_PROMPT_cindy_campfire_goals.md §B.
--
-- ─────────────────────────── WHAT EXISTS, AND WHAT THE GAP ACTUALLY IS ───────────────────────────
--
-- 0159 built the discount and 0160 built the write path, so an honour goal ALREADY pays one band
-- down, capped at 'notable'. That is the Unvouched tier, and it has been live and correct since.
--
-- What has never existed is the way OUT of it. The spec's gradient is Auto > Vouched > Unvouched,
-- and only two of those three were reachable: `goal_paid_band` knows 'auto' and 'honor' and nothing
-- else, so a backflip with a clip of it and a backflip claimed in silence paid exactly the same.
-- The whole point of the gradient — that proving it is worth doing — was unreachable.
--
-- Read from prod before writing this: no `goal_vouches`, no vouch RPC, no claim column, and
-- `challenges_verifiability_valid` admits exactly ('auto','honor').
--
-- ─────────────────────────── 🔴 ONE GRANT, AT THE RIGHT BAND, EVER ───────────────────────────
--
-- The spec describes storing the reward at Unvouched immediately and UPGRADING it when vouches
-- land. That is right for a challenge whose `reward_payload` is a stored jsonb the settle path can
-- rewrite. It is wrong for a GOAL, and this is the most important decision in the file.
--
-- A goal pays through economy_on_challenge_completed, which fires on `completed_at` and calls
-- grant_reward — which MOVES EMBERS AND MINTS A BOX. There is no stored payload to rewrite. So
-- "upgrade the reward" would mean granting a delta: a second grant_reward for the difference
-- between two bands, with its own rounding, its own weekly-cap interaction, and a clawback path if
-- a vouch is later invalidated. That is a second way to mint embers, built to correct the first.
--
-- So the window comes BEFORE the completion instead of after it:
--
--     claim  →  (proof? settle now)  ·  (vouchers? wait)  →  resolve  →  completed_at  →  ONE grant
--
-- `completed_at` is set by the resolve step, by which time verifiability is already final. The
-- existing trigger then pays once, at the band the goal actually earned. No delta, no clawback, and
-- economy_on_challenge_completed is BYTE-UNTOUCHED — as is log_challenge_progress.
--
-- WHY NOT TOUCHING log_challenge_progress IS SAFE, and not an oversight: it auto-completes a goal
-- when progress crosses target, and that path belongs to goals the app can MEASURE — steps, hours,
-- a lock-in-time custom goal, a count fed by the gym tracker. Those are verifiability 'auto' by
-- 0160's derivation and have nothing to vouch for. The claim flow below only ever acts on a goal
-- with `completed_at is null`, which is precisely the population nothing can auto-complete: the
-- described feat. The two paths cannot collide because they cover disjoint goals.
--
-- ─────────────────────────── THE THIRD LEVEL ───────────────────────────
--
-- 'vouched' is a new verifiability value, and it is the one that makes the gradient real:
--
--     auto     → the scoped band, in full. The app watched you do it.
--     vouched  → the scoped band, in full. A clip, or two friends who were there.
--     honor    → one band down, never above 'notable'. You said so.
--
-- Vouched pays the same BAND as auto and that is deliberate per the spec — "full box tier". What
-- separates them in the spec is a −10% vs −20% CURRENCY trim, which 0159's header explains is
-- deferred: it needs a p_currency_mult parameter on grant_reward, a signature change to a function
-- with three callers, and that is the overload trap MIGRATIONS.md says has reached prod three
-- times. It still wants its own migration. Until then the gradient is expressed in BOXES, which is
-- the part that actually gates minting, and 'vouched' vs 'auto' pay alike.
--
-- 🔒 WHY THAT IS NOT A HOLE. Reaching 'vouched' costs something a lying client cannot fake alone:
-- either an uploaded artifact, or TWO DISTINCT OTHER ACCOUNTS whose vouches survive the counting
-- rules below. A ring can still buy it — the spec says so plainly and accepts it, because the
-- ceiling collusion buys is the middle tier and never more than genuine app-tracked effort.
-- ══════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────── §1 · the claim lives on the goal ───────────────────────────

alter table challenges
  add column if not exists claimed_at timestamptz,
  add column if not exists proof_path text,
  add column if not exists vouch_deadline timestamptz;

comment on column challenges.claimed_at is
  '0164 — when the owner said they did it. NOT completion: completed_at is set by the resolve step once the verification level is final, so the payout fires exactly once at the right band.';
comment on column challenges.proof_path is
  '0164 — storage key of a photo/clip in the campfire-photos bucket. Its presence resolves a claim to ''vouched'' immediately; nobody reads the image server-side and nothing tries to.';
comment on column challenges.vouch_deadline is
  '0164 — when the 48h vouch window closes. The expiry sweep settles anything still open at ''honor''.';

-- The third level. Restated in full because a CHECK cannot be appended to.
do $$
begin
  alter table challenges drop constraint if exists challenges_verifiability_valid;
  alter table challenges add constraint challenges_verifiability_valid
    check (verifiability is null or verifiability in ('auto', 'honor', 'vouched'));
end $$;

create table if not exists goal_vouches (
  goal_id    uuid not null references challenges(id) on delete cascade,
  voucher_id uuid not null references profiles(id) on delete cascade,
  -- true = "yes he did", false = "nah". A 'nah' is RECORDED and never punishes: the spec is
  -- explicit that the reward can only fail to go up, never down.
  verdict    boolean not null,
  -- Whether this vouch counted toward the threshold. False when an anti-collusion rule capped it,
  -- and stored rather than recomputed so the history explains itself later.
  counted    boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (goal_id, voucher_id)
);

comment on table goal_vouches is
  '0164 — one row per friend asked to confirm a self-reported goal. PK is (goal, voucher) so a person cannot stack vouches on one goal; `counted` records whether the anti-collusion rules let it count.';

create index if not exists goal_vouches_voucher_idx on goal_vouches (voucher_id, created_at desc);

alter table goal_vouches enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'goal_vouches' and policyname = 'vouches i can see') then
    -- The goal's owner and the voucher. Every write goes through submit_vouch.
    create policy "vouches i can see" on goal_vouches
      for select using (
        voucher_id = auth.uid()
        or exists (select 1 from challenges c where c.id = goal_id and c.user_id = auth.uid())
      );
  end if;
end $$;

-- ─────────────────────────── §2 · the gradient gains its middle rung ───────────────────────────
--
-- ⚠️ RESTATED FROM 0159'S BODY with one arm added and nothing else changed. The honor arm — the
-- −1 and the 'notable' cap that IS the anti-cheese — is byte-identical to what 0159 shipped.
create or replace function goal_paid_band(p_tier text, p_verifiability text)
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  v_cfg jsonb := (select value from economy_config where key = 'tier_payout');
  v_band text;
  v_down text;
begin
  if p_tier is null then
    return null;
  end if;

  v_band := v_cfg -> p_tier ->> 'band';
  if v_band is null then
    return null;
  end if;

  -- 0164 — 'vouched' joins 'auto' here. Same band, and see the header for why the currency trim
  -- that should separate them is still deferred rather than quietly forgotten.
  if p_verifiability in ('auto', 'vouched') then
    return v_band;
  end if;

  v_down := case v_band
    when 'apex'       then 'elite'
    when 'elite'      then 'impressive'
    when 'impressive' then 'notable'
    when 'notable'    then 'casual'
    when 'casual'     then 'completion'
    else 'completion'
  end;

  if reward_band_rank(v_down) > reward_band_rank('notable') then
    return 'notable';
  end if;
  return v_down;
end;
$$;

-- ─────────────────────────── §3 · resolve — the ONLY thing that completes a claimed goal ──────────
--
-- INTERNAL (0132's rule). Sets the final verifiability and THEN completed_at, in that order, so the
-- grant trigger reads a settled level. Idempotent on completed_at so a vouch landing in the same
-- second as the sweep cannot pay twice.
create or replace function resolve_goal_claim(p_goal_id uuid, p_level text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_goal challenges;
begin
  select * into v_goal from challenges where id = p_goal_id;
  if v_goal.id is null or v_goal.completed_at is not null then
    return;
  end if;

  update challenges
     set verifiability = p_level,
         -- Backdated to the CLAIM, not to now. The feat happened when they said it did; a goal that
         -- sat in a 48h window should not read as finished two days later than it was.
         completed_at = coalesce(claimed_at, now())
   where id = p_goal_id
     and completed_at is null;
end;
$$;

revoke all on function resolve_goal_claim(uuid, text) from public;
revoke all on function resolve_goal_claim(uuid, text) from authenticated;

-- ─────────────────────────── §B · "I did it" ───────────────────────────

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

  -- A proof path must live under the claimer's own prefix, the same rule the campfire-photos
  -- bucket policy and messages_attachment_shape both enforce. Checked here because this is a
  -- security definer function and the bucket policy does not see this row.
  if p_proof_path is not null and p_proof_path not like (auth.uid()::text || '/%') then
    raise exception 'That proof does not belong to you.';
  end if;

  update challenges
     set claimed_at = now(),
         proof_path = p_proof_path,
         vouch_deadline = now() + interval '48 hours'
   where id = p_goal_id;

  -- ── PROOF SETTLES IT NOW ──
  -- Nothing server-side looks at the image, and that is deliberate: reading proof is a judgement
  -- the spec explicitly refuses to automate. What an artifact buys is that the claim is now
  -- ATTACHED to something a human can look at and report — which is the same standard a vouch
  -- meets, so it resolves to the same level without a 48h wait.
  if p_proof_path is not null then
    perform resolve_goal_claim(p_goal_id, 'vouched');
    return jsonb_build_object('state', 'resolved', 'level', 'vouched', 'asked', 0);
  end if;

  -- ── OTHERWISE, ASK ──
  -- Self-vouching is not a thing, and neither is asking the same person twice.
  select coalesce(array_agg(distinct u), '{}') into v_asked
    from unnest(coalesce(p_voucher_ids, '{}')) as u
   where u <> auth.uid();

  if array_length(v_asked, 1) is null then
    -- Claimed with neither proof nor anybody to ask. That is a complete and legitimate choice —
    -- it settles right now at the honour band rather than sitting in a window nothing can close.
    perform resolve_goal_claim(p_goal_id, 'honor');
    return jsonb_build_object('state', 'resolved', 'level', 'honor', 'asked', 0);
  end if;

  select display_name into v_name from profiles where id = auth.uid();

  perform notify_event(
    v_asked,
    'vouch_requested',
    coalesce(v_name, 'A friend') || ' wants you to vouch',
    coalesce(v_name, 'They') || ' says: ' || coalesce(nullif(btrim(v_goal.label), ''), 'they did it') || '. Did they?',
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
    'deadline', (now() + interval '48 hours')
  );
end;
$$;

comment on function claim_goal_complete(uuid, text, uuid[]) is
  '0164 — the honour path''s "I did it". Proof resolves to vouched immediately; friends asked opens a 48h window; neither settles at honour now. Never grants — it sets the level and lets economy_on_challenge_completed pay once.';

revoke all on function claim_goal_complete(uuid, text, uuid[]) from public;
grant execute on function claim_goal_complete(uuid, text, uuid[]) to authenticated;

-- ─────────────────────────── §B · the friend's answer, and the counting rules ───────────────────
--
-- THE CAPS ARE COUNTING RULES, NEVER GATES. Every one of them can only stop a vouch COUNTING
-- toward the threshold; none of them refuses the row, and none can stop a goal settling. A
-- capped-out goal simply settles at honour, which is where it started. That is the spec's own
-- framing and it is what keeps honest occasional vouching between real study partners working.
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
  v_owner_name text;
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

  insert into goal_vouches (goal_id, voucher_id, verdict, counted)
  values (p_goal_id, auth.uid(), p_verdict, v_counts)
  on conflict (goal_id, voucher_id) do nothing;

  -- TWO DISTINCT FRIENDS. The primary key already guarantees distinctness; this counts what
  -- actually landed.
  select count(*) into v_total
    from goal_vouches where goal_id = p_goal_id and verdict and counted;

  if v_total >= 2 then
    perform resolve_goal_claim(p_goal_id, 'vouched');

    select display_name into v_owner_name from profiles where id = v_goal.user_id;
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
  '0164 — a friend answers. The anti-collusion rules only ever decide whether a vouch COUNTS; they never refuse the row and never block settlement, so a capped goal settles at honour rather than hanging.';

revoke all on function submit_vouch(uuid, boolean) from public;
grant execute on function submit_vouch(uuid, boolean) to authenticated;

-- ─────────────────────────── §B · what the vouch screen reads ───────────────────────────

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

  -- Deliberately NOT gated on having been asked. A notification can be missed, forwarded or
  -- arrive late, and refusing to render the screen to somebody holding the link would break the
  -- one route the notification exists to open. submit_vouch is where authority actually lives, and
  -- it refuses the owner and enforces every counting rule regardless of who opened this.
  return jsonb_build_object(
    'goal_id', v_goal.id,
    'label', v_goal.label,
    'tier', v_goal.difficulty_tier,
    'claimant', coalesce(v_name, 'Someone'),
    'claimant_avatar', v_avatar,
    'claimed_at', v_goal.claimed_at,
    'deadline', v_goal.vouch_deadline,
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

-- ─────────────────────────── §B · the window closes ───────────────────────────
--
-- For the existing finalize sweep to call. Settles at honour — which is not a penalty: it is the
-- band the goal has had since it was claimed, and the spec's rule is that a reward never drops.
create or replace function settle_expired_vouches()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_n int := 0;
begin
  for r in
    select id, user_id, label from challenges
     where claimed_at is not null
       and completed_at is null
       and vouch_deadline is not null
       and now() > vouch_deadline
     limit 500
  loop
    perform resolve_goal_claim(r.id, 'honor');
    perform notify_event(
      array[r.user_id],
      'vouch_settled',
      'Vouch window closed',
      'You kept your reward for ' || coalesce(nullif(btrim(r.label), ''), 'that goal') || '.',
      null, r.id,
      '/challenge-info/[challengeId]', jsonb_build_object('challengeId', r.id::text),
      null, 'rounded',
      jsonb_build_object('goal_id', r.id)
    );
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

revoke all on function settle_expired_vouches() from public;
revoke all on function settle_expired_vouches() from authenticated;

-- ─────────────────────────── the three events are challenge events ───────────────────────────
--
-- ⚠️ RESTATED FROM PROD'S OWN prosrc with THREE NAMES ADDED. This function's own body carries the
-- warning: the 0135 restatement was written without sight of 0120 and dropped 'session_complete'
-- onto the else-branch, filing every session recap under the wrong toggle. 'challenge_hosted' below
-- is 0162's and must survive this edit — it is asserted at the bottom.
create or replace function notification_category(p_type text)
returns text
language sql
immutable
set search_path = public
as $function$
  select case
    when p_type in ('friend_request', 'friend_accepted', 'friend_ranked_up', 'friend_passed_you',
                    'friend_joined', 'friend_locked_in',
                    'milestone_cheered', 'milestone_posted',
                    'agora_cheered', 'agora_commented',
                    'check_in', 'reaction') then 'friends_social'
    when p_type in ('challenged', 'challenge_accepted', 'challenge_declined', 'challenge_passed',
                    'challenge_ending_soon', 'challenge_won', 'challenge_lost', 'goal_at_risk',
                    'goal_streak_milestone', 'challenge_cheered',
                    'challenge_invite', 'challenge_forfeited', 'challenge_change_request',
                    'challenge_change_answered', 'challenge_terms_updated',
                    -- 0164 · the vouch flow. Filed with challenges rather than friends_social even
                    -- though a vouch request comes FROM a friend: what it is about is a goal and
                    -- its reward, and somebody muting friend chatter still wants to be asked.
                    'vouch_requested', 'vouch_passed', 'vouch_settled') then 'challenges'
    when p_type in ('campfire_joined', 'campfire_join_request', 'campfire_challenge_started',
                    'campfire_cold', 'campfire_added', 'campfire_settled', 'campfire_message',
                    'join_request', 'join_request_approved', 'campfire_admin_granted',
                    'chat_batch', 'mention',
                    'campfire_ping',
                    -- 0162 · fires at every member of a campfire, so the campfire toggle governs it.
                    'challenge_hosted') then 'campfires'
    when p_type in ('streak_at_risk', 'daily_fire_reminder', 'streak_milestone',
                    'session_complete',
                    'streak_risk', 'lock_in_nudge', 'lockin_still_here') then 'streak_reminders'
    when p_type in ('season_ending', 'season_settled', 'ranked_up', 'rank_dropped', 'reward_ready')
      then 'season_rank'
    else 'friends_social'
  end;
$function$;

-- ─────────────────────────── asserted at deploy ───────────────────────────
do $assert$
begin
  -- 1 · the gradient, all three rungs. The honour cap is the anti-cheese and must not have moved.
  if goal_paid_band('epic', 'honor') is distinct from 'notable' then
    raise exception '0164: honour epic must still pay notable — the anti-cheese cap moved.';
  end if;
  if goal_paid_band('mythic', 'honor') is distinct from 'notable' then
    raise exception '0164: honour mythic must still cap at notable.';
  end if;
  if goal_paid_band('epic', 'vouched') is distinct from 'impressive' then
    raise exception '0164: a vouched epic must pay its full band.';
  end if;
  if goal_paid_band('legendary', 'auto') is distinct from 'elite' then
    raise exception '0164: auto legendary must still pay elite.';
  end if;
  -- Vouching must be WORTH something, or the whole screen is theatre.
  if goal_paid_band('epic', 'vouched') = goal_paid_band('epic', 'honor') then
    raise exception '0164: vouched and unvouched pay the same — the gradient is flat.';
  end if;
  if goal_paid_band(null, null) is not null then
    raise exception '0164: unscoped goals must still pass a null ceiling.';
  end if;

  -- 2 · the notification map survived its restatement, in both directions.
  if notification_category('vouch_requested') <> 'challenges' then
    raise exception '0164: vouch_requested is filed under the wrong toggle.';
  end if;
  if notification_category('challenge_hosted') <> 'campfires' then
    raise exception '0164: 0162''s challenge_hosted mapping was lost in the restatement.';
  end if;
  if notification_category('session_complete') <> 'streak_reminders' then
    raise exception '0164: 0120''s session_complete mapping was lost in the restatement.';
  end if;

  -- 3 · the payout path is untouched. If either of these ever gains a second definition, the
  --     "one grant, at the right band" guarantee in the header is no longer true.
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname in
         ('economy_on_challenge_completed', 'log_challenge_progress', 'goal_paid_band',
          'claim_goal_complete', 'submit_vouch', 'resolve_goal_claim',
          'get_vouch_request', 'settle_expired_vouches', 'notification_category')) <> 9 then
    raise exception '0164: an overload was created — count pg_proc before pushing.';
  end if;

  raise notice '0164 ok — auto/vouched pay full, honour still capped at notable, mappings intact.';
end
$assert$;
