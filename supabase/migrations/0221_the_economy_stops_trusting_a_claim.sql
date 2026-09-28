-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- 0221 · THE ECONOMY STOPS TRUSTING A CLAIM — vouching ends, grades cap at Epic, idle caps at 10m.
--
-- Spec: CODE_PROMPT_economy_anticheat.md §1–§4, design-mocks/237-economy-grade-cap.html. Builds on
-- 0159/0164/0166 (the verifiability discount + vouch flow), 0167/0200/0201 (the receipt, its
-- re-arm, its announcement), 0210/0211 (grade goals, priority-course gating), 0218 (pause-aware
-- lock-in credit). Section 5 (placement cap / 0066) is NOT in this file — that decision is
-- unconfirmed and 0066 is left untouched.
--
-- Principle: the premium boxes (Legendary/Mythic) come only from things genuinely hard to fake —
-- real money, sensor-verified physical, and (v2) video. Everything self-reported is capped, and
-- friend-vouching — the one honour path that could reach the full band without a sensor — is
-- removed.
--
-- ─────────────────────────── §1 · VOUCHING ENDS ───────────────────────────
--
-- goal_paid_band stops treating 'vouched' as a full-band level: only 'auto' (app/sensor-tracked)
-- pays the scoped band. 'vouched' now prices EXACTLY like 'honor' — one band down, capped at
-- notable (Rare). So an honour goal settles directly at the Unvouched tier.
--
-- The vouch FLOW is dismantled at its source rather than left to age out:
--   · claim_goal_complete settles at 'honor' immediately, always. No proof→vouched, no roster, no
--     48h window, no vouch_requested push.
--   · submit_vouch is a no-op (kept callable so a stale client gets a graceful nothing, not an
--     error). It grants nothing and fires no vouch_passed push.
--   · settle_expired_vouches still drains any window left open by a pre-0221 client — resolving it
--     at honour — but fires no vouch_settled push.
-- goal_vouches is LEFT IN PLACE (its rows are history; nothing reads them for a reward anymore).
--
-- ─────────────────────────── §2 · GRADE GOALS CAP AT EPIC, 2 BOXES PER SEASON ───────────────────
--
-- A grade is self-reported — every grade goal is verifiability 'honor' (goal_verifiability_for) —
-- but mock 237 prices it apart from a typed feat: "Epic max", not "Rare max". With vouching gone,
-- leaving grades on the honour rate would have dropped every one of them to The Furnace, so a
-- grade gets its own PRICING level, 'grade':
--   · goal_paid_band(tier, 'grade') pays the tier's band UN-discounted, capped at impressive
--     (Epic / Vessel of Hestia). 'grade' is a pricing argument only — it is never written to
--     challenges.verifiability, so no installed build ever reads a value it does not know.
--   · grade_band's ceiling drops mythic → epic, so a 90%+ can neither scope nor EARN above Epic
--     (grade_effective_tier and create_scoped_goals both read it). The 'grade' cap is the backstop
--     for a goal scoped before this file.
--   · The trigger, report_goal_grade, preview_grade_reward and get_unseen_goal_rewards all price a
--     grade goal at 'grade', so the verdict, the preview, the payout and the reveal agree.
--
-- And the box is RATIONED: the first 2 grade goals a member completes in a season mint a box;
-- every one after that pays its embers through 0211's embers-only branch (same pricing, same
-- weekly ceiling, no box ever minted) and its receipt says box_rationed. Per-user, per-season
-- (challenges.season_id, stamped at create by 0210), reset each season. Serialized per user with
-- an advisory lock so two grades settling at once cannot both take the second slot.
--
-- This is independent of 0211's priority-course gating (still off in economy_config): with both
-- on, a grade box needs a priority course AND a free slot.
--
-- ─────────────────────────── §3 · PHYSICAL / SKILL SELF-REPORT CAPS AT RARE ─────────────────────
--
-- No new mechanism: a typed physical/skill claim is verifiability 'honor' (goal_verifiability_for,
-- 0183), and honour already caps at notable = Rare in goal_paid_band. With 'vouched' no longer an
-- upgrade (§1), that Rare cap is now the true ceiling for any self-reported feat with no sensor.
-- Sensor-tracked physical (steps/Strava/workout volume) is 'auto' and stays uncapped.
--
-- 🔧 TODO (v2 video path — DO NOT BUILD HERE): when video verification lands, a verified physical
-- feat should flip its verifiability to 'auto' (goal_verifiability_for is the hook), at which point
-- goal_paid_band pays the full scoped band and this Rare cap no longer applies to it. Until then a
-- clip is a private file that changes no band.
--
-- ─────────────────────────── §4 · LOCK-IN LIVENESS — 10-MIN CONFIRM, CREDIT TO LAST CONFIRM ─────
--
-- notify_stale_lock_ins (restated from 0218's live body): the "still here?" nudge fires 10 min
-- after the last confirmation (was 1 hour), and the idle auto-abandon fires 2 min after the nudge
-- (was 20 min). The cron that runs it moves from every 5 min to EVERY MINUTE — at */5 the "12 min"
-- close really landed anywhere in 15–20. The abandon still credits
-- lock_in_credited_seconds(session, last_confirmed_at) — the EXISTING credit cap, banking only time
-- up to the last confirmation, never now(). Pause cap (3h) unchanged.
--
-- stop_lock_in_session (restated from 0218): the normal finish path CLAMPS its credit to
-- least(now(), last_confirmed_at + 12 min) so a nap-then-finish can't bank idle time. A present
-- user (the client prompts at 8–10 min) is never within the clamp.
--
-- ─────────────────────────── REVISION NOTE ───────────────────────────
--
-- The first draft of this file (economy-anticheat @ aca25c3, never applied) restated
-- economy_on_challenge_completed from 0167. Live is 0211's body, so applying it would have
-- silently dropped 0211's priority-course gating, 0200's receipt re-arm (reward_seen_at / settled_at
-- / period — the reveal inbox) and 0201's reward_ready announcement. It also left grades on the
-- honour rate, capping them at Rare rather than Epic. This revision restates from the live bodies
-- and pins them below.
-- ══════════════════════════════════════════════════════════════════════════════════════════════

-- ── base check · every body restated below was restated from its LIVE source (pulled from prod
-- 2026-09-28, ledger at 0218). md5(prosrc) pins: any drift means a migration landed underneath this
-- one and it must be rebased — which is exactly how the first draft went wrong.
do $base$
declare
  v_pins constant jsonb := jsonb_build_object(
    'goal_paid_band',                 'a5e926a81aaa52258215dc56faf360e4',
    'claim_goal_complete',            '00560c89691a05eacff1369965efdc3e',
    'submit_vouch',                   '1b72655b96e7641d7f76b8d291fd0c64',
    'settle_expired_vouches',         '7f3bb83a3cc5b7d383190eab01db6ceb',
    'grade_band',                     '065e1941ced292901b4aa080c0b71120',
    'economy_on_challenge_completed', '62a948c56015c5581490939579360786',
    'report_goal_grade',              'daf0be9999c12c11e111d52843feeec4',
    'preview_grade_reward',           '0428b21fc1c048d72d426cf09bd9ca30',
    'get_unseen_goal_rewards',        '38cf6db55e17f22f2a4fca3407636919',
    'notify_stale_lock_ins',          '8ba281c51c9c6b53599ba82eb3b05ec0',
    'stop_lock_in_session',           '196dd3386fc04700bc2e48a489db73c7'
  );
  k text;
  v_md5 text;
begin
  for k in select jsonb_object_keys(v_pins) loop
    select md5(prosrc) into v_md5 from pg_proc where proname = k and pronamespace = 'public'::regnamespace;
    if v_md5 is distinct from v_pins ->> k then
      raise exception '0221: % is not the body this file was restated from (md5 %, expected %) — rebase.',
        k, coalesce(v_md5, 'missing'), v_pins ->> k;
    end if;
  end loop;
end
$base$;

-- ═══════════════════════════ §1/§2 · goal_paid_band: 'vouched' no longer upgrades; 'grade' ═══════
-- Restated from 0164 with two changes: the full-band arm is 'auto' only ('vouched' falls through to
-- the honour branch), and a new 'grade' arm. The honour branch is byte-identical.
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

  -- 0221 — ONLY 'auto' pays the full scoped band now. Sensor/app-tracked is the single path to the
  -- top boxes. 'vouched' is gone as an upgrade: it drops through to the honour cap below, so a
  -- friend-vouched claim pays exactly what an unvouched one does.
  if p_verifiability = 'auto' then
    return v_band;
  end if;

  -- 0221 — A GRADE. Self-reported, but a real mark against a real target: it pays its earned band
  -- un-discounted, capped at impressive (Epic / Vessel of Hestia). A PRICING level only — callers
  -- pass it for a row with grade_target set; it is never stored in challenges.verifiability.
  if p_verifiability = 'grade' then
    if reward_band_rank(v_band) > reward_band_rank('impressive') then
      return 'impressive';
    end if;
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

comment on function goal_paid_band(text, text) is
  '0221 — the verifiability discount, with vouching removed. auto pays the scoped band; grade (a pricing level, never stored) pays the band capped at impressive/Epic; honour (and vouched, which no longer upgrades) pays one band down capped at notable/Rare.';

revoke all on function goal_paid_band(text, text) from public, anon;
revoke all on function goal_paid_band(text, text) from authenticated;

-- ═══════════════════════════ §1 · claim settles at honour, immediately ═══════════════════════════
-- Restated from 0166 with the vouch flow removed. The ownership / already-done guards and the
-- proof-path prefix check are kept (proof is still STORED for a future v2 video path); everything
-- else — the roster insert, the vouch_requested push, the 48h window — is gone. A claim settles at
-- honour now, always.
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

  -- 0221 — no window. Stamp the claim (and any proof, for the v2 hook), never a deadline, and
  -- settle at honour in the same call. p_voucher_ids is accepted for signature stability and
  -- ignored: there is nobody to ask anymore.
  update challenges
     set claimed_at = now(),
         proof_path = p_proof_path,
         vouch_deadline = null
   where id = p_goal_id;

  perform resolve_goal_claim(p_goal_id, 'honor');
  return jsonb_build_object('state', 'resolved', 'level', 'honor', 'asked', 0,
                            'has_proof', p_proof_path is not null);
end;
$$;

comment on function claim_goal_complete(uuid, text, uuid[]) is
  '0221 — vouching removed. A claim settles at honour immediately: no proof→vouched, no roster, no 48h window, no push. Proof is still stored for a future video path but changes no band. Signature kept so callers (report_goal_grade) need no change.';

revoke all on function claim_goal_complete(uuid, text, uuid[]) from public;
grant execute on function claim_goal_complete(uuid, text, uuid[]) to authenticated;

-- ═══════════════════════════ §1 · submit_vouch is a no-op ═══════════════════════════
-- Kept callable (a stale client that still calls it gets a graceful nothing rather than a
-- permission error), but it records no vouch, resolves nothing, and fires no vouch_passed push.
create or replace function submit_vouch(p_goal_id uuid, p_verdict boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 0221 — vouching is disabled. This function used to record a friend's verdict and, on two
  -- counted vouches, upgrade the goal to 'vouched'. Both are gone. It does nothing and says so.
  return jsonb_build_object('counted', false, 'vouches', 0, 'resolved', false, 'disabled', true);
end;
$$;

comment on function submit_vouch(uuid, boolean) is
  '0221 — DISABLED. Vouching was removed; this is a no-op returning {disabled:true}. Left callable so a not-yet-updated client degrades gracefully instead of erroring.';

revoke all on function submit_vouch(uuid, boolean) from public;
grant execute on function submit_vouch(uuid, boolean) to authenticated;

-- ═══════════════════════════ §1 · the sweep drains open windows silently ═══════════════════════════
-- Restated from 0164 with the vouch_settled push removed. New claims never open a window, but a
-- claim made by a pre-0221 client may still be sitting open; this settles it at honour (its band
-- since it was claimed) with no notification.
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
    select id from challenges
     where claimed_at is not null
       and completed_at is null
       and vouch_deadline is not null
       and now() > vouch_deadline
     limit 500
  loop
    -- 0221 — resolve at honour, no vouch_settled push (the vouch flow is gone).
    perform resolve_goal_claim(r.id, 'honor');
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

revoke all on function settle_expired_vouches() from public;
revoke all on function settle_expired_vouches() from authenticated;

-- ═══════════════════════════ §2 · grade ladder ceiling drops to Epic ═══════════════════════════
-- Restated from 0210 with the ceiling changed from 'mythic' to 'epic'. This one function feeds both
-- the create-time scope clamp and the earned-tier ladder, so a grade goal can neither be scoped nor
-- earn above Epic. Floors and step are unchanged.
create or replace function grade_band(
  p_discipline text,
  out floor_tier text,
  out ceiling_tier text,
  out step numeric
)
language sql
immutable
set search_path = public
as $$
  select
    case p_discipline when 'stem' then 'rare' else 'uncommon' end,
    'epic',
    case p_discipline when 'arts' then 5 else 10 end::numeric;
$$;

comment on function grade_band(text) is
  '0221 — grade-goal reward band, ceiling capped at EPIC (was mythic): a passing grade can no longer reach Legendary/Mythic. stem → (rare, epic, 10); arts → (uncommon, epic, 5); untagged → (uncommon, epic, 10).';

revoke all on function grade_band(text) from public, anon;
grant execute on function grade_band(text) to authenticated;

-- ═══════════════════════════ §2 · the grade box ration — one counter ═══════════════════════════
-- How many grade goals have already MINTED a box for this member in this season. A receipt with a
-- box is the unit counted — a rationed or embers-only receipt has box null and takes no slot. A
-- goal older than 0210's season stamp counts toward the current season, the same fallback 0211
-- uses. Read by the trigger (to ration) and by preview_grade_reward (to say so before the report).
create or replace function grade_boxes_used(p_user uuid, p_season text, p_exclude uuid default null)
returns int
language sql
stable
set search_path = public
as $$
  select count(*)::int
    from challenges c
   where c.user_id = p_user
     and c.grade_target is not null
     and c.id is distinct from p_exclude
     and coalesce(c.season_id, (select season_id from current_economy_season())) is not distinct from p_season
     and c.reward_payload ->> 'box' is not null;
$$;

comment on function grade_boxes_used(uuid, text, uuid) is
  '0221 — grade goals that minted a box for p_user in p_season (excluding p_exclude). The grade box ration is 2 per season.';

revoke all on function grade_boxes_used(uuid, text, uuid) from public, anon, authenticated;

-- ═══════════════════════════ §2 · the completion grant: grades price at 'grade', and are rationed ═══
-- Restated from the LIVE body (0211, carrying 0167's receipt, 0200's re-arm and 0201's announcement)
-- with three changes, each marked 0221:
--   1. a grade goal is priced at 'grade' (Epic cap, no honour discount);
--   2. the third+ grade goal in a season is routed down 0211's embers-only branch — so its box is
--      never minted, rather than minted and deleted;
--   3. that branch prices inline instead of through preview_challenge_reward, which raises without
--      auth.uid() — a cron-settled goal (settle_expired_vouches) has none. The figure is identical:
--      preview's embers were reward_bands[goal_paid_band(tier, verifiability)], which is v_cap.
create or replace function public.economy_on_challenge_completed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_cfg jsonb := (select value from economy_config where key = 'tier_payout');
  v_sig numeric;
  v_cap text;
  v_receipt jsonb;
  v_crate text;
  v_embers int;
  v_what text;
  -- 0211
  v_embers_only boolean := false;
  v_room int;
  v_paid int;
  -- 0221
  v_bands jsonb := (select value from economy_config where key = 'reward_bands');
  v_band_embers int;
  v_season text;
  v_rationed boolean := false;
begin
  if new.completed_at is null or old.completed_at is not null then
    return new;
  end if;

  -- 0162 — a goal minted BY a campfire challenge is that challenge's counter, not a second prize.
  -- evaluate_pass_achievements still runs: pass progress is a record of what they did, and they
  -- did do it.
  if new.challenge_source_id is not null then
    perform evaluate_pass_achievements(new.user_id);
    return new;
  end if;

  -- WAS A LITERAL 1.0 — see 0159's header. That constant is what made every completed goal an
  -- Ignition Crate, and it is also the reason `uncommon` is pinned at significance 1.0 in
  -- tier_payout: an unscoped goal resolves to exactly the number that was hard-coded here, so
  -- nothing in flight changes what it pays.
  v_sig := coalesce((v_cfg -> coalesce(new.difficulty_tier, '') ->> 'significance')::numeric, 1.0);
  -- 0221 — a grade goal prices at 'grade' (its band, capped at Epic), not at its stored 'honor'.
  v_cap := goal_paid_band(new.difficulty_tier,
                          case when new.grade_target is not null then 'grade' else new.verifiability end);

  -- 0211 — BOXES ONLY FROM PRIORITY COURSES, once the switch is on. A grade goal whose course is not
  -- one of the member's two for the goal's season pays embers only. Anything that is not a grade
  -- goal never enters this test. The season is the one the goal was SET in (0210's stamp), falling
  -- back to the current one for a goal older than the stamp.
  v_embers_only :=
    new.grade_target is not null
    and coalesce((select (value ->> 'enabled')::boolean from economy_config where key = 'grade_box_gating'), false)
    and not exists (
      select 1 from priority_courses pc
       where pc.user_id = new.user_id
         and pc.course_id = new.course_id
         and pc.season_id = coalesce(new.season_id, (select season_id from current_economy_season()))
    );

  -- 0221 — THE GRADE BOX RATION. Two grade boxes a season; the third grade goal onward pays embers
  -- through the branch below. The lock serializes one member's grade settles so two landing in the
  -- same instant cannot both read "one used" and both mint.
  if new.grade_target is not null and not v_embers_only then
    v_season := coalesce(new.season_id, (select season_id from current_economy_season()));
    perform pg_advisory_xact_lock(hashtextextended('0221_grade_box_ration:' || new.user_id::text, 0));
    v_rationed := grade_boxes_used(new.user_id, v_season, new.id) >= 2;
    v_embers_only := v_rationed;
  end if;

  if v_embers_only then
    -- The earned band's embers, capped by the goal economy's weekly ceiling. 0221 — priced inline
    -- (see the header above this function); same figure preview_challenge_reward returned.
    v_band_embers := coalesce((v_bands ->> coalesce(v_cap, v_cfg -> new.difficulty_tier ->> 'band'))::int, 10);
    v_room := greatest(0,
      coalesce((select (value ->> 'weekly_cap')::int from economy_config where key = 'goal_rewards'), 300)
      - economy_goal_embers_this_week(new.user_id)
      - coalesce((
          select sum((c.reward_payload ->> 'embers')::int)
            from challenges c
           where c.user_id = new.user_id
             and c.id <> new.id
             and (c.reward_payload ->> 'embers_only')::boolean
             and (c.reward_payload ->> 'settled_at')::timestamptz >= now() - interval '7 days'
        ), 0)::int);
    v_paid := least(v_band_embers, v_room);

    if v_paid > 0 then
      perform economy_move_embers(new.user_id, v_paid, 'challenge_win', new.id);
    end if;

    v_receipt := jsonb_build_object(
      'embers', v_paid,
      'box', null,
      'box_id', null,
      'badge', null,
      'band', v_cap,
      'embers_only', true,
      -- What the band was worth before the weekly ceiling, so a capped payout can say so.
      'embers_band', v_band_embers,
      -- 0221 — WHY there is no box: the season's two grade boxes were already spent (true), or
      -- the course was not a priority (false).
      'box_rationed', v_rationed
    );
  else
    -- 0167 — THE RETURN VALUE IS KEPT. Identical call, identical arguments, `perform` → `select into`.
    select grant_reward(
      new.user_id, 'friend_h2h', v_sig,
      case when new.period = 'week' then 7 else 1 end,
      1, 0.0, true, new.id,
      v_cap
    ) into v_receipt;
  end if;

  -- 0167 — the receipt, plus the two facts the reveal needs that grant_reward has no way to know:
  -- WHICH LEVEL the goal settled at, and what tier it was scoped to. `band` inside v_receipt is
  -- already the band actually paid (grant_reward applies v_cap before returning), so the reveal
  -- reads the honest figure without re-pricing anything.
  --
  -- 0200 — and the receipt is RE-ARMED: reward_seen_at goes back to null with every new receipt, so
  -- a recurring goal's second, third, fourth completion can each be revealed. `settled_at` rides
  -- in the payload because rollover clears completed_at and the inbox still has to order this.
  update challenges
     set reward_payload = coalesce(v_receipt, '{}'::jsonb)
                          || jsonb_build_object(
                               'verifiability', new.verifiability,
                               'tier', new.difficulty_tier,
                               'max_band', v_cap,
                               'period', new.period,
                               'settled_at', now()
                             ),
         reward_seen_at = null
   where id = new.id;

  -- 0201 — announce the crate. The display names are a fourth copy of the box catalog (boxes.ts is
  -- the first); presentation only, and an unknown key falls back to a generic word rather than
  -- printing a database value.
  -- A SEARCHED case, not `case x when null`: `null = null` is null, so that arm could never match
  -- and a crate-less receipt would have announced "A crate earned".
  v_crate := case
    when v_receipt ->> 'box' is null          then null
    when v_receipt ->> 'box' = 'kindling'     then 'Kindling'
    when v_receipt ->> 'box' = 'ignition'     then 'Ignition Crate'
    when v_receipt ->> 'box' = 'furnace'      then 'The Furnace'
    when v_receipt ->> 'box' = 'hestia'       then 'Vessel of Hestia'
    when v_receipt ->> 'box' = 'hephaestus'   then 'Hephaestus'' Chest'
    when v_receipt ->> 'box' = 'promethean'   then 'Promethean Vault'
    else 'A crate'
  end;
  v_embers := coalesce((v_receipt ->> 'embers')::int, 0);
  v_what := coalesce(
    nullif(trim(new.label), ''),
    trim(to_char(new.target, 'FM999,999,990.##')) || ' ' || coalesce(new.unit, '')
  );
  if v_crate is not null or v_embers > 0 then
    perform notify_event(
      array[new.user_id], 'reward_ready',
      coalesce(v_crate || ' earned', '+' || v_embers || ' embers earned'),
      'For ' || trim(v_what) ||
        case when v_crate is not null and v_embers > 0 then ' · +' || v_embers || ' embers' else '' end ||
        case when v_crate is not null then '. Open it from your inventory.' else '.' end,
      null, new.id,
      '/inventory', '{}'::jsonb,
      null, null,
      jsonb_build_object('box', v_receipt ->> 'box', 'box_id', v_receipt ->> 'box_id', 'embers', v_embers)
    );
  end if;

  perform evaluate_pass_achievements(new.user_id);
  return new;
end;
$function$;

comment on function public.economy_on_challenge_completed() is
  '0221 — 0211''s body (0167 receipt, 0200 re-arm, 0201 announcement, priority gating) plus: grade goals price at goal_paid_band(tier, ''grade'') (Epic cap), and a grade goal past the season''s first two box-minting ones pays embers only via the embers-only branch (box_rationed).';

-- ═══════════════════════════ §2 · the grade verdict prices at 'grade' ═══════════════════════════
-- Restated from the LIVE body (0210) with the vouch-era return fields reworked: `reward` is priced
-- at 'grade', and reflects what the receipt actually paid when the box was withheld (rationed or
-- non-priority). `reward_vouched` is kept for installed builds and now EQUALS `reward` — there is
-- no upgrade to show. p_proof_path / p_voucher_ids stay in the signature (callers unchanged);
-- claim_goal_complete ignores the voucher list since this migration.
create or replace function public.report_goal_grade(p_goal_id uuid, p_grade numeric, p_proof_path text DEFAULT NULL::text, p_voucher_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user uuid := auth.uid();
  v_goal challenges;
  v_passed boolean;
  v_claim jsonb;
  v_pass_mark numeric;
  v_scoped text;
  v_earned text;
  v_reward jsonb;
begin
  if v_user is null then
    raise exception 'Not signed in.';
  end if;
  if p_grade is null or p_grade < 0 or p_grade > 100 then
    raise exception 'A grade is a percentage between 0 and 100.';
  end if;

  select * into v_goal from challenges c where c.id = p_goal_id and c.user_id = v_user;
  if v_goal.id is null then
    raise exception 'That goal is not yours.';
  end if;
  if v_goal.grade_target is null then
    raise exception 'That goal is not scored on a grade.';
  end if;
  -- 0209 — claimed_at joins the guard, so a second report cannot overwrite a reported mark.
  if v_goal.completed_at is not null or v_goal.missed_at is not null or v_goal.claimed_at is not null then
    raise exception 'You already reported that one.';
  end if;
  if v_goal.retired_at is not null then
    raise exception 'That goal was collapsed into another one.';
  end if;

  -- 0210 — the line is the COURSE's pass mark, not the target. Never above the target: hitting
  -- what you aimed for is always a pass.
  v_pass_mark := least(coalesce(v_goal.pass_mark, 50), v_goal.grade_target);
  v_passed := p_grade >= v_pass_mark;

  -- ── A COURSE FAIL — the only miss. Settles now.
  if not v_passed then
    update challenges
       set progress = p_grade,
           missed_at = now()
     where id = p_goal_id
    returning * into v_goal;

    return jsonb_build_object(
      'id', v_goal.id,
      'label', v_goal.label,
      'grade', p_grade,
      'grade_target', v_goal.grade_target,
      'pass_mark', v_pass_mark,
      'passed', false,
      'tier', v_goal.difficulty_tier,
      'scoped_tier', v_goal.difficulty_tier,
      'earned_tier', null,
      'state', 'missed',
      'reward', null,
      'reward_vouched', null
    );
  end if;

  -- ── A PASS — a win at the earned tier. difficulty_tier becomes what was EARNED so the
  -- challenges_economy trigger pays that; scoped_tier keeps what was aimed for.
  v_scoped := coalesce(v_goal.scoped_tier, v_goal.difficulty_tier, 'uncommon');
  v_earned := grade_effective_tier(v_scoped, v_goal.grade_target, p_grade, v_goal.grade_discipline);

  update challenges
     set progress = p_grade,
         scoped_tier = v_scoped,
         difficulty_tier = v_earned
   where id = p_goal_id;

  -- claim_goal_complete settles it (at honour, immediately, since 0221) and the trigger pays it.
  v_claim := claim_goal_complete(p_goal_id, p_proof_path, p_voucher_ids);

  select * into v_goal from challenges where id = p_goal_id;

  -- 0221 — the verdict prices the grade the way the trigger just paid it ('grade': Epic cap), and
  -- when the receipt withheld the box it says so: embers from the receipt, no box.
  v_reward := preview_challenge_reward(v_earned, 'grade', 1, 1);
  if coalesce((v_goal.reward_payload ->> 'embers_only')::boolean, false) then
    v_reward := v_reward || jsonb_build_object(
      'box', null,
      'embers', coalesce((v_goal.reward_payload ->> 'embers')::int, 0),
      'box_rationed', coalesce((v_goal.reward_payload ->> 'box_rationed')::boolean, false)
    );
  end if;

  return jsonb_build_object(
    'id', v_goal.id,
    'label', v_goal.label,
    'grade', p_grade,
    'grade_target', v_goal.grade_target,
    'pass_mark', v_pass_mark,
    'passed', true,
    'tier', v_earned,
    'scoped_tier', v_scoped,
    'earned_tier', v_earned,
    'state', v_claim ->> 'state',
    'level', coalesce(v_goal.verifiability, 'honor'),
    'asked', 0,
    'deadline', null,
    'has_proof', v_goal.proof_path is not null,
    'reward', v_reward,
    'reward_vouched', v_reward
  );
end;
$function$;

comment on function public.report_goal_grade(uuid, numeric, text, uuid[]) is
  '0221 — reports a grade; a pass settles at once (no vouch window) and the verdict is priced at ''grade'' (Epic cap), with the box withheld when the season''s two grade boxes are spent. reward_vouched is kept for installed builds and equals reward.';

-- ═══════════════════════════ §2 · the grade preview prices at 'grade' and counts slots ═══════════
-- Restated from the LIVE body (0210). `reward` is priced at 'grade'; when this member has already
-- minted two grade boxes this season it shows the ember-only payout the report will produce, and
-- the preview carries the counter mock 237 draws ("Grade goal 2 of 2 this semester").
create or replace function public.preview_grade_reward(p_goal_id uuid, p_grade numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_goal challenges;
  v_pass_mark numeric;
  v_earned text;
  v_used int;
  v_reward jsonb;
begin
  select * into v_goal from challenges c where c.id = p_goal_id and c.user_id = auth.uid();
  if v_goal.id is null or v_goal.grade_target is null then
    raise exception 'That goal is not yours.';
  end if;
  if p_grade is null or p_grade < 0 or p_grade > 100 then
    raise exception 'A grade is a percentage between 0 and 100.';
  end if;

  v_used := grade_boxes_used(auth.uid(),
                             coalesce(v_goal.season_id, (select season_id from current_economy_season())),
                             p_goal_id);

  v_pass_mark := least(coalesce(v_goal.pass_mark, 50), v_goal.grade_target);
  if p_grade < v_pass_mark then
    return jsonb_build_object('passed', false, 'pass_mark', v_pass_mark, 'earned_tier', null,
                              'reward', null, 'reward_vouched', null,
                              'grade_boxes_used', v_used, 'grade_boxes_per_season', 2);
  end if;

  v_earned := grade_effective_tier(coalesce(v_goal.scoped_tier, v_goal.difficulty_tier, 'uncommon'),
                                   v_goal.grade_target, p_grade, v_goal.grade_discipline);
  v_reward := preview_challenge_reward(v_earned, 'grade', 1, 1);
  if v_used >= 2 then
    v_reward := v_reward || jsonb_build_object('box', null, 'box_rationed', true);
  end if;

  return jsonb_build_object(
    'passed', true,
    'pass_mark', v_pass_mark,
    'scoped_tier', coalesce(v_goal.scoped_tier, v_goal.difficulty_tier),
    'earned_tier', v_earned,
    'reward', v_reward,
    'reward_vouched', v_reward,
    'grade_boxes_used', v_used,
    'grade_boxes_per_season', 2
  );
end;
$function$;

comment on function public.preview_grade_reward(uuid, numeric) is
  '0221 — what a mark would earn, priced at ''grade'' (Epic cap), box withheld when the season''s two grade boxes are spent; carries grade_boxes_used / grade_boxes_per_season. reward_vouched equals reward.';

-- ═══════════════════════════ §1/§2 · the reveal's "full crate" ═══════════════════════════
-- Restated from the LIVE body (0200) with ONE change: the crate a goal "would have" paid was
-- goal_paid_band(tier, 'vouched') — the full band, while vouching was the upgrade. With 'vouched'
-- now priced as honour that would equal the paid crate and the reveal's "one tier down" line could
-- never show. It asks the level that actually reaches the full band now: 'auto', or 'grade' for a
-- grade goal (whose paid and full crates are the same, so no loss is invented for it).
create or replace function public.get_unseen_goal_rewards()
 RETURNS TABLE(goal_id uuid, goal_label text, goal_type text, tier text, verified_as text, band text, full_band text, full_box text, settled_at timestamp with time zone, payload jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null then return; end if;

  return query
  select
    c.id,
    c.label,
    c.type,
    c.difficulty_tier,
    c.verifiability,
    c.reward_payload ->> 'band',
    goal_paid_band(c.difficulty_tier, case when c.grade_target is not null then 'grade' else 'auto' end),
    -- ⚠️ THE BAND→CRATE MAPPING, RESTATED. It lives inside grant_reward and nowhere addressable,
    -- and this is a THIRD copy of it, which is worth being uncomfortable about. It is here rather
    -- than in the client for the reason rewardChips already gives — "hephaestus" is a database
    -- value and a screen must never print one — and rather than through
    -- preview_challenge_reward(), which raises on an unknown tier and would turn a foreground poll
    -- into an error for any goal scoped before the config knew its tier. Presentation only: this
    -- names a crate that was NOT paid, on a row whose payment already happened.
    case goal_paid_band(c.difficulty_tier, case when c.grade_target is not null then 'grade' else 'auto' end)
      when 'apex'       then 'promethean'
      when 'elite'      then 'hephaestus'
      when 'impressive' then 'hestia'
      when 'notable'    then 'furnace'
      when 'casual'     then 'ignition'
      else null
    end,
    -- 0200 — the receipt carries its own settle time, because a recurring goal's completed_at is
    -- cleared at rollover while its receipt may still be waiting to be seen.
    coalesce((c.reward_payload ->> 'settled_at')::timestamptz, c.completed_at),
    c.reward_payload
  from challenges c
  where c.user_id = auth.uid()
    and c.reward_seen_at is null
    -- No receipt, nothing to reveal. Covers a campfire-minted goal (granted nothing here by
    -- design) and anything completed before 0167, which its backfill stamped.
    and c.reward_payload is not null
    -- 0200 — no period filter and no completed_at filter. Recurring goals' crates are revealed now
    -- (Noah: both grants surface), and a receipt outlives the rollover that clears completed_at.
  order by coalesce((c.reward_payload ->> 'settled_at')::timestamptz, c.completed_at) asc nulls last;
end;
$function$;

-- ═══════════════════════════ §4 · lock-in stale sweep → 10-minute confirm ═══════════════════════════
-- Restated from 0218 with two threshold edits (1h → 10 min nudge; 20 min → 2 min abandon-after-
-- nudge, i.e. ~12 min stale-close). The idle-abandon still credits to last_confirmed_at — the
-- EXISTING credit cap, banking no time past the last confirmation. Pause cap (3h) unchanged.
create or replace function public.notify_stale_lock_ins()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r record;
  v_s lock_in_sessions;
  v_check_in check_ins;
begin
  for r in
    select id, user_id from lock_in_sessions
    where status = 'active'
      and not paused
      and reminder_sent_at is null
      -- 0221 — 10 min (was 1 hour). Matches the client's ~10-min "still here?" prompt.
      and last_confirmed_at < now() - interval '10 minutes'
  loop
    perform notify_push(
      array[r.user_id],
      'Still locked in?',
      'Your session''s been going a while — tap to keep it going.',
      jsonb_build_object('type', 'lockin_still_here', 'session_id', r.id),
      'accountability'
    );
    update lock_in_sessions set reminder_sent_at = now() where id = r.id;
  end loop;

  for v_s in
    select * from lock_in_sessions
    where status = 'active'
      and not paused
      and reminder_sent_at is not null
      -- 0221 — 2 min after the nudge (was 20). Total stale-close ~12 min (10 + grace).
      and reminder_sent_at < now() - interval '2 minutes'
  loop
    insert into check_ins (goal_id, goal_type, goal_detail, user_id, photo_url, duration_seconds, status)
    values (
      null, v_s.goal_type, v_s.goal_detail, v_s.user_id, null,
      -- 0218/0221 — the credit CAP: to last confirmation, minus paused time. Never now().
      greatest(lock_in_credited_seconds(v_s, v_s.last_confirmed_at)::integer, 1),
      'on_time'
    )
    returning * into v_check_in;

    update lock_in_sessions
    set status = 'abandoned', ended_check_in_id = v_check_in.id
    where id = v_s.id;
  end loop;

  -- 0218 — THE PAUSE CAP, unchanged. Paused for more than 3 hours = ended as completed on pre-pause
  -- credited time.
  for v_s in
    select * from lock_in_sessions
    where status = 'active'
      and paused
      and paused_at < now() - interval '3 hours'
  loop
    insert into check_ins (goal_id, goal_type, goal_detail, user_id, photo_url, duration_seconds, status)
    values (
      null, v_s.goal_type, v_s.goal_detail, v_s.user_id, null,
      greatest(lock_in_credited_seconds(v_s, v_s.paused_at)::integer, 1),
      'on_time'
    )
    returning * into v_check_in;

    update lock_in_sessions
    set status = 'completed', ended_check_in_id = v_check_in.id,
        accumulated_paused_seconds = accumulated_paused_seconds
          + greatest(round(extract(epoch from (now() - paused_at))), 0)::int,
        paused = false,
        paused_at = null
    where id = v_s.id;
  end loop;
end;
$function$;

comment on function public.notify_stale_lock_ins() is
  '0221 — 0218''s body with the stale-close shortened to ~12 min (10-min nudge + 2-min grace, was 1h + 20m). The idle-abandon still credits only to last_confirmed_at. Pause cap unchanged.';

-- ═══════════════════════════ §4 · lock-in finish path clamp ═══════════════════════════
-- Restated from 0218 with ONE edit: the credited-time settle clamps its upper bound to
-- least(now(), last_confirmed_at + 12 min), so a nap-then-finish cannot bank idle time past the
-- grace window. A present user (confirming every ~10 min) is never inside the clamp.
create or replace function public.stop_lock_in_session(p_session_id uuid, p_photo_urls text[] DEFAULT NULL::text[], p_caption text DEFAULT NULL::text, p_workout_sets jsonb DEFAULT NULL::jsonb)
 RETURNS check_ins
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_session lock_in_sessions;
  v_check_in check_ins;
  v_workout workouts;
  v_first_photo text;
  v_has_pr boolean;
  i int;
begin
  select * into v_session from lock_in_sessions
  where id = p_session_id and user_id = auth.uid() and status = 'active'
  for update;

  if v_session.id is null then
    raise exception 'Session not found or already stopped.';
  end if;

  v_first_photo := case when p_photo_urls is not null and array_length(p_photo_urls, 1) > 0
    then p_photo_urls[1] else null end;

  insert into check_ins (goal_id, goal_type, goal_detail, user_id, photo_url, caption, duration_seconds, status)
  values (
    null, v_session.goal_type, v_session.goal_detail, auth.uid(), v_first_photo, p_caption,
    -- 0218: credited time, not wall-clock (paused time earns nothing).
    -- 0221: AND clamped to the grace window past the last confirmation, so a nap-then-finish
    -- cannot bank the idle stretch. least(now(), last_confirmed_at + 12 min) — a present user
    -- (confirming every ~10 min) is always below this bound and is never trimmed.
    greatest(lock_in_credited_seconds(v_session, least(now(), v_session.last_confirmed_at + interval '12 minutes'))::integer, 1),
    'on_time'
  )
  returning * into v_check_in;

  if p_photo_urls is not null then
    for i in 1 .. array_length(p_photo_urls, 1) loop
      insert into check_in_photos (check_in_id, photo_url, position)
      values (v_check_in.id, p_photo_urls[i], i - 1);
    end loop;
  end if;

  select * into v_workout from workouts
  where lock_in_session_id = v_session.id and user_id = auth.uid() and ended_at is null;

  if v_workout.id is not null then
    select exists (select 1 from workout_sets where workout_id = v_workout.id and is_pr)
    into v_has_pr;

    update workouts
    set check_in_id = v_check_in.id,
        ended_at = now(),
        brag_earned = (v_workout.energy = 'dialed' and v_has_pr)
    where id = v_workout.id;

    insert into check_in_workout_sets (check_in_id, exercise, sets, reps, weight, is_pr, position)
    select
      v_check_in.id,
      we.name,
      count(*)::int,
      (array_agg(ws.reps order by gym_e1rm(ws.weight, ws.reps) desc, ws.reps desc))[1],
      (array_agg(ws.weight order by gym_e1rm(ws.weight, ws.reps) desc, ws.reps desc))[1],
      bool_or(ws.is_pr),
      we.position
    from workout_exercises we
    join workout_sets ws on ws.workout_exercise_id = we.id
    where we.workout_id = v_workout.id
    group by we.id, we.name, we.position;

  elsif p_workout_sets is not null and jsonb_array_length(p_workout_sets) > 0 then
    for i in 0 .. jsonb_array_length(p_workout_sets) - 1 loop
      insert into check_in_workout_sets (check_in_id, exercise, sets, reps, weight, position)
      values (
        v_check_in.id,
        p_workout_sets -> i ->> 'exercise',
        (p_workout_sets -> i ->> 'sets')::int,
        (p_workout_sets -> i ->> 'reps')::int,
        (p_workout_sets -> i ->> 'weight')::numeric,
        i
      );
    end loop;
  end if;

  -- 0218: fold an open pause into the total and clear it.
  update lock_in_sessions
  set status = 'completed', ended_check_in_id = v_check_in.id,
      accumulated_paused_seconds = accumulated_paused_seconds
        + case when paused then greatest(round(extract(epoch from (now() - paused_at))), 0)::int else 0 end,
      paused = false,
      paused_at = null
  where id = v_session.id;

  select * into v_check_in from check_ins where id = v_check_in.id;

  return v_check_in;
end;
$function$;

comment on function public.stop_lock_in_session(uuid, text[], text, jsonb) is
  '0221 — 0218''s pause-aware body with the finish credit clamped to least(now(), last_confirmed_at + 12 min), so idle time past the grace window cannot be banked at Stop.';

-- ═══════════════════════════ §4 · the liveness sweep runs every minute ═══════════════════════════
-- 0007 scheduled it at */5. With a 10-min nudge and a 2-min grace that cadence would close an idle
-- session anywhere from 15 to 20 minutes after the last confirm; at one minute it is ~12–13. The
-- sweep's two queries hit lock_in_sessions_active_idx (status, last_confirmed_at) — cheap to run.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'philoi-lockin-liveness-check') then
    perform cron.unschedule('philoi-lockin-liveness-check');
  end if;
end $$;

select cron.schedule(
  'philoi-lockin-liveness-check',
  '* * * * *',
  $$select notify_stale_lock_ins();$$
);

-- ─────────────────────────── the anti-cheese, asserted at deploy ───────────────────────────
-- 0159's style: the worked cases, run against the functions this file just created, so it cannot
-- land with a gate open.
do $assert$
declare
  v_band record;
begin
  -- §1 · NO VOUCHED TIER. 'vouched' now prices exactly like 'honor'. (The inverse of 0164/0166's
  --      "vouched must be worth something" assertion — this migration removes that worth on purpose.)
  if goal_paid_band('epic', 'vouched') is distinct from goal_paid_band('epic', 'honor') then
    raise exception '0221: vouched must now pay the same as honour (the vouch upgrade is gone).';
  end if;
  if goal_paid_band('legendary', 'vouched') is distinct from 'notable'
     or goal_paid_band('mythic', 'vouched') is distinct from 'notable' then
    raise exception '0221: a vouched legendary/mythic must cap at notable (Rare) like honour.';
  end if;

  -- §3 · PHYSICAL / SKILL SELF-REPORT CAPS AT RARE, for every tier at or above it.
  if goal_paid_band('epic', 'honor') is distinct from 'notable'
     or goal_paid_band('legendary', 'honor') is distinct from 'notable'
     or goal_paid_band('mythic', 'honor') is distinct from 'notable' then
    raise exception '0221: honour epic/legendary/mythic must cap at notable (Rare).';
  end if;

  -- Sensor/app-tracked ('auto') is STILL uncapped — the only path to the top boxes.
  if goal_paid_band('legendary', 'auto') is distinct from 'elite'
     or goal_paid_band('mythic', 'auto') is distinct from 'apex' then
    raise exception '0221: auto legendary/mythic must still pay elite/apex (sensor path uncapped).';
  end if;

  -- §2 · GRADE PRICING. Un-discounted up to Epic, capped at Epic above it — and different from
  --      honour at epic, which is the whole point (honour epic = notable).
  if goal_paid_band('epic', 'grade') is distinct from 'impressive'
     or goal_paid_band('rare', 'grade') is distinct from 'notable'
     or goal_paid_band('legendary', 'grade') is distinct from 'impressive'
     or goal_paid_band('mythic', 'grade') is distinct from 'impressive' then
    raise exception '0221: grade must pay its band capped at impressive (Epic).';
  end if;
  if goal_paid_band('epic', 'grade') = goal_paid_band('epic', 'honor') then
    raise exception '0221: an epic grade prices like an honour claim — grades would cap at Rare.';
  end if;

  -- Unscoped goals keep their exact previous behaviour: no ceiling.
  if goal_paid_band(null, null) is not null then
    raise exception '0221: unscoped goals must pass a null ceiling.';
  end if;

  -- §2 · THE GRADE LADDER CAPS AT EPIC.
  select * into v_band from grade_band('stem');
  if v_band.ceiling_tier is distinct from 'epic' then
    raise exception '0221: the grade ceiling must be epic, got %', v_band.ceiling_tier;
  end if;
  if grade_effective_tier('legendary', 90, 95, 'stem') is distinct from 'epic'
     or grade_effective_tier('mythic', 95, 100, 'stem') is distinct from 'epic' then
    raise exception '0221: a 90%%+ grade must earn epic at most.';
  end if;
  -- The ladder clamps the scoped tier to the ceiling FIRST, then steps down — so a legacy
  -- legendary-scoped grade one step short earns rare (epic, one down), and the floor still holds.
  if grade_effective_tier('epic', 90, 90, 'stem') is distinct from 'epic'
     or grade_effective_tier('legendary', 90, 80, 'stem') is distinct from 'rare'
     or grade_effective_tier('legendary', 90, 50, 'stem') is distinct from 'rare' then
    raise exception '0221: the STEM step-down below the cap changed unexpectedly.';
  end if;

  -- §1 · submit_vouch grants nothing.
  if (submit_vouch('00000000-0000-0000-0000-000000000000'::uuid, true) ->> 'disabled') <> 'true' then
    raise exception '0221: submit_vouch is not disabled.';
  end if;

  -- The trigger kept what 0200/0201/0211 put in it (the first draft of this file lost all three).
  if (select prosrc from pg_proc where proname = 'economy_on_challenge_completed' and pronamespace = 'public'::regnamespace)
     !~ 'reward_seen_at = null'
     or (select prosrc from pg_proc where proname = 'economy_on_challenge_completed' and pronamespace = 'public'::regnamespace)
     !~ '''reward_ready'''
     or (select prosrc from pg_proc where proname = 'economy_on_challenge_completed' and pronamespace = 'public'::regnamespace)
     !~ 'grade_box_gating' then
    raise exception '0221: economy_on_challenge_completed lost the 0200 re-arm / 0201 announcement / 0211 gating.';
  end if;

  -- §4 · the lock-in edits landed and the credit cap survived.
  if (select prosrc from pg_proc where proname = 'notify_stale_lock_ins' and pronamespace = 'public'::regnamespace)
     !~ 'last_confirmed_at < now\(\) - interval ''10 minutes'''
     or (select prosrc from pg_proc where proname = 'notify_stale_lock_ins' and pronamespace = 'public'::regnamespace)
     !~ 'lock_in_credited_seconds\(v_s, v_s\.last_confirmed_at\)' then
    raise exception '0221: notify_stale_lock_ins is not at 10 minutes, or lost the last_confirmed_at credit cap.';
  end if;
  if (select schedule from cron.job where jobname = 'philoi-lockin-liveness-check') is distinct from '* * * * *' then
    raise exception '0221: the liveness sweep is not scheduled every minute.';
  end if;

  -- One definition each — no overloads created (MIGRATIONS.md's trap).
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname in
         ('goal_paid_band', 'claim_goal_complete', 'submit_vouch', 'settle_expired_vouches',
          'grade_band', 'economy_on_challenge_completed', 'notify_stale_lock_ins',
          'stop_lock_in_session', 'grade_boxes_used', 'report_goal_grade',
          'preview_grade_reward', 'get_unseen_goal_rewards')) <> 12 then
    raise exception '0221: an overload was created — count pg_proc before pushing.';
  end if;
end
$assert$;

-- ─────────────────────────── behaviour, rolled back ───────────────────────────
-- The asserts above read function bodies; these RUN them (a dry-run never executes a plpgsql
-- body). Every case is paired with a control, and each expectation is one the pre-0221 functions
-- would fail. Everything happens inside a block that raises at the end, so nothing is kept; push is
-- suppressed and pg_net only sends on commit.
do $probe$
declare
  v_uid uuid;
  v_out jsonb;
  g0 uuid; g1 uuid; g2 uuid; g3 uuid;
  v_row challenges;
  v_rep jsonb;
  v_prev jsonb;
  v_boxes int;
  v_before int;
  v_room int;
  v_expect int;
  v_sess uuid;
  v_ci check_ins;
begin
  select id into v_uid from profiles order by created_at limit 1;
  if v_uid is null then
    raise notice '0221: no profiles, skipping the behavioural assertions';
    return;
  end if;

  begin
    perform set_config('philoi.suppress_push', 'on', true);
    -- 0211's gate off for the whole probe: this tests the ration alone.
    update economy_config set value = '{"enabled": false}'::jsonb where key = 'grade_box_gating';

    perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);

    v_out := create_scoped_goals(jsonb_build_array(
      jsonb_build_object('label', '0221 g0 legendary', 'grade_target', 90, 'difficulty_tier', 'legendary', 'grade_discipline', 'stem'),
      jsonb_build_object('label', '0221 g1 epic', 'grade_target', 90, 'difficulty_tier', 'epic', 'grade_discipline', 'stem'),
      jsonb_build_object('label', '0221 g2 epic', 'grade_target', 90, 'difficulty_tier', 'epic', 'grade_discipline', 'stem'),
      jsonb_build_object('label', '0221 backflip', 'target', 1, 'unit', 'backflip', 'difficulty_tier', 'epic')));
    g0 := (v_out -> 'results' -> 0 ->> 'id')::uuid;
    g1 := (v_out -> 'results' -> 1 ->> 'id')::uuid;
    g2 := (v_out -> 'results' -> 2 ->> 'id')::uuid;
    g3 := (v_out -> 'results' -> 3 ->> 'id')::uuid;

    -- A season of their own, so the member's real grade goals cannot move the count.
    perform set_config('role', 'postgres', true);
    update challenges set season_id = 'Z0221' where id in (g0, g1, g2);
    perform set_config('role', 'authenticated', true);

    -- ═══ g0 — a legendary-scoped grade at 100% earns EPIC and pays the Vessel of Hestia ═══
    -- (pre-0221: it earned legendary and paid The Furnace at honour.)
    v_rep := report_goal_grade(g0, 100);
    select * into v_row from challenges where id = g0;
    if v_row.difficulty_tier <> 'epic' or v_row.reward_payload ->> 'box' is distinct from 'hestia'
       or v_rep -> 'reward' ->> 'box' is distinct from 'hestia' then
      raise exception '0221: a perfect grade must earn epic and pay hestia; got tier %, box %, verdict box %',
        v_row.difficulty_tier, v_row.reward_payload ->> 'box', v_rep -> 'reward' ->> 'box';
    end if;
    -- 0200 / 0201 survived the restate.
    if v_row.reward_seen_at is not null or v_row.reward_payload ->> 'settled_at' is null then
      raise exception '0221: the receipt was not re-armed (0200).';
    end if;
    if not exists (select 1 from notification_events where user_id = v_uid and type = 'reward_ready' and target_id = g0) then
      raise exception '0221: no reward_ready announcement (0201).';
    end if;

    -- ═══ g1 — the preview before the report says slot 2 of 2 is free; the report takes it ═══
    v_prev := preview_grade_reward(g1, 95);
    if (v_prev ->> 'grade_boxes_used')::int <> 1 or v_prev -> 'reward' ->> 'box' is distinct from 'hestia' then
      raise exception '0221: preview for the 2nd grade must show hestia with 1 used (%)', v_prev;
    end if;
    perform report_goal_grade(g1, 95);
    if (select reward_payload ->> 'box' from challenges where id = g1) is distinct from 'hestia' then
      raise exception '0221: the 2nd grade goal of the season must still mint its box.';
    end if;

    -- ═══ g2 — the third: the preview says embers only, and the report mints nothing ═══
    v_prev := preview_grade_reward(g2, 95);
    if (v_prev ->> 'grade_boxes_used')::int <> 2 or v_prev -> 'reward' ->> 'box' is not null
       or not (v_prev -> 'reward' ->> 'box_rationed')::boolean then
      raise exception '0221: preview for the 3rd grade must withhold the box (%)', v_prev;
    end if;

    perform set_config('role', 'postgres', true);
    v_boxes := (select count(*) from loot_boxes where user_id = v_uid);
    v_before := coalesce((select balance from ember_wallet where user_id = v_uid), 0);
    v_room := greatest(0, 300 - economy_goal_embers_this_week(v_uid));
    v_expect := least(coalesce(((select value from economy_config where key = 'reward_bands') ->> 'impressive')::int, 10), v_room);
    perform set_config('role', 'authenticated', true);

    v_rep := report_goal_grade(g2, 95);
    perform set_config('role', 'postgres', true);
    select * into v_row from challenges where id = g2;
    if v_row.reward_payload ->> 'box' is not null
       or not (v_row.reward_payload ->> 'box_rationed')::boolean
       or not (v_row.reward_payload ->> 'embers_only')::boolean then
      raise exception '0221: the 3rd grade goal must be ember-only and rationed (%)', v_row.reward_payload;
    end if;
    if (select count(*) from loot_boxes where user_id = v_uid) <> v_boxes then
      raise exception '0221: a box was minted for a rationed grade goal.';
    end if;
    if (v_row.reward_payload ->> 'embers')::int <> v_expect
       or coalesce((select balance from ember_wallet where user_id = v_uid), 0) - v_before <> v_expect then
      raise exception '0221: the rationed grade paid % (wallet moved %), expected %',
        v_row.reward_payload ->> 'embers',
        coalesce((select balance from ember_wallet where user_id = v_uid), 0) - v_before, v_expect;
    end if;
    if v_rep -> 'reward' ->> 'box' is not null then
      raise exception '0221: the verdict shows a box the receipt withheld.';
    end if;

    -- ═══ g3 — a typed feat (honour, no grade) at epic still caps at The Furnace (Rare) ═══
    -- The control for 'grade' leaking: same tier as g1/g2, a tier lower in box.
    perform set_config('role', 'authenticated', true);
    perform claim_goal_complete(g3);
    if (select reward_payload ->> 'box' from challenges where id = g3) is distinct from 'furnace' then
      raise exception '0221: an honour epic feat must pay furnace, got %',
        (select reward_payload ->> 'box' from challenges where id = g3);
    end if;
    if (select vouch_deadline from challenges where id = g3) is not null then
      raise exception '0221: a claim opened a vouch window.';
    end if;

    -- ═══ §4 · the finish clamp. Started 60 min ago, last confirmed 40 min ago → credits 32 min
    --     (to last confirm + 12), not 60. Control: confirmed 5 min ago → the full 30 min. ═══
    perform set_config('role', 'postgres', true);
    update lock_in_sessions set status = 'abandoned' where user_id = v_uid and status = 'active';
    insert into lock_in_sessions (user_id, goal_type, started_at, last_confirmed_at)
    values (v_uid, 'study', now() - interval '60 minutes', now() - interval '40 minutes')
    returning id into v_sess;
    perform set_config('role', 'authenticated', true);
    v_ci := stop_lock_in_session(v_sess);
    if abs(v_ci.duration_seconds - 32 * 60) > 5 then
      raise exception '0221: a nap-then-finish credited %s, expected ~1920s', v_ci.duration_seconds;
    end if;

    perform set_config('role', 'postgres', true);
    insert into lock_in_sessions (user_id, goal_type, started_at, last_confirmed_at)
    values (v_uid, 'study', now() - interval '30 minutes', now() - interval '5 minutes')
    returning id into v_sess;
    perform set_config('role', 'authenticated', true);
    v_ci := stop_lock_in_session(v_sess);
    if abs(v_ci.duration_seconds - 30 * 60) > 5 then
      raise exception '0221: a present user was trimmed: credited %s, expected ~1800s', v_ci.duration_seconds;
    end if;

    raise exception 'philoi_0221_rollback';
  exception
    when others then
      if sqlerrm <> 'philoi_0221_rollback' then
        raise;
      end if;
  end;

  perform set_config('role', 'postgres', true);
  raise notice '0221 ok — vouching removed, grades pay up to Epic with 2 boxes a season, self-report caps at Rare, lock-in closes ~12m and a finish credits no idle time.';
end
$probe$;
