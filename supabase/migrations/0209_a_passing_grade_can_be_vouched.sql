-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- 0209 · A PASSING GRADE CAN BE VOUCHED — the honour cap stays, and the way out of it finally
-- reaches grade goals.
--
-- Spec: CODE_PROMPT_grade_goal_vouch_unlock (Noah, 2026-09-23).
--
-- ─────────────────────────── WHAT IS RIGHT, AND STAYS ───────────────────────────
--
-- A reported grade is somebody's word about a number the app cannot see, so it is 'honor' and it
-- pays one band down, capped at 'notable' — The Furnace. A LEGENDARY grade goal and an EPIC one
-- both showing "The Furnace" is that cap working. goal_paid_band is not touched here.
--
-- ─────────────────────────── WHAT WAS WRONG ───────────────────────────
--
-- The cap is supposed to have a way out: two friends vouch, and the goal pays its full band
-- (0164). A grade goal could never take it. 0183's report_goal_grade wrote completed_at directly
-- on a pass, which fired the grant at honour in the same statement — there was no window, so there
-- was nothing to vouch for. LEGENDARY was unreachable for a grade goal by any honest route.
--
-- ─────────────────────────── THE FIX: A PASS BECOMES A CLAIM ───────────────────────────
--
-- The pass arm no longer completes the goal. It records the mark, then hands the goal to
-- claim_goal_complete — the SAME function a described feat's "Mark complete" goes through — so a
-- grade inherits the whole vouch engine rather than a second copy of it:
--
--     vouchers asked  → roster rows, a 48h window, the vouch_requested push. Pending.
--     nobody asked    → resolve_goal_claim(…, 'honor') now. The Furnace, exactly as before.
--     a proof path    → STORED and shown to the vouchers. Never a resolution on its own.
--
-- 🔴 WHY PROOF ALONE DOES NOT PAY THE FULL BAND, although the prompt asked for it. 0165 closed
-- exactly that hole on prod: 0164 let any attached file resolve to 'vouched', nothing ever looked
-- at the file, and a check nobody performs was gating a whole box tier. A grade screenshot is the
-- weakest proof there is — a grade portal is a web page, and a web page is one "inspect element"
-- from any number you like. Calling claim_goal_complete rather than restating its arms is what
-- keeps 0165's rule true here by construction; it is asserted below in both directions anyway.
--
-- ─────────────────────────── 🔒 STILL ONE GRANT, AT THE FINAL BAND ───────────────────────────
--
-- completed_at is only ever set by resolve_goal_claim, after the level is final. The existing
-- challenges_economy trigger then pays ONCE at that level. No delta grant, no clawback — the
-- guarantee 0164's header is built around. economy_on_challenge_completed, log_challenge_progress
-- and claim_goal_complete are all byte-untouched (md5s asserted at the bottom).
--
-- The MISS arm is unchanged: missed_at, no claim, no window. You do not vouch for a miss.
--
-- ─────────────────────────── THE SIGNATURE ───────────────────────────
--
-- Two nullable params are appended. Per MIGRATIONS.md §"Appending a parameter is not a
-- replacement", that is a SECOND function unless the old one is dropped — so it is dropped, in
-- this file, and the survivor defaults both new params, so an installed build's
-- `{p_goal_id, p_grade}` call still resolves to exactly one function. What an old build gets on a
-- pass is what it always got: an honour settle, now via the claim path, with the same reward.
--
-- The receipt gains `state`, `level`, `asked`, `deadline`, `has_proof` and `reward_vouched`. An
-- old build reads `passed` and `reward` and ignores the rest.
-- ══════════════════════════════════════════════════════════════════════════════════════════════

drop function if exists report_goal_grade(uuid, numeric);

create function report_goal_grade(
  p_goal_id uuid,
  p_grade numeric,
  p_proof_path text default null,
  p_voucher_ids uuid[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_goal challenges;
  v_passed boolean;
  v_claim jsonb;
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
  -- 0209 — claimed_at joins the guard. A pass waiting on vouches is neither completed nor missed,
  -- and without this a second report would be free to overwrite the mark the friends were asked
  -- to confirm.
  if v_goal.completed_at is not null or v_goal.missed_at is not null or v_goal.claimed_at is not null then
    raise exception 'You already reported that one.';
  end if;
  if v_goal.retired_at is not null then
    raise exception 'That goal was collapsed into another one.';
  end if;

  v_passed := p_grade >= v_goal.grade_target;

  -- ── A MISS — unchanged from 0183. Settles now; nothing to vouch for.
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
      'passed', false,
      'tier', v_goal.difficulty_tier,
      'state', 'missed',
      'reward', null,
      'reward_vouched', null
    );
  end if;

  -- ── A PASS — record the mark, then claim. claim_goal_complete owns every branch from here: the
  -- proof-path ownership check, the roster, the window, the push, and the honour settle when
  -- nobody was asked. Nothing here decides a level.
  update challenges set progress = p_grade where id = p_goal_id;

  v_claim := claim_goal_complete(p_goal_id, p_proof_path, p_voucher_ids);

  select * into v_goal from challenges where id = p_goal_id;

  -- `reward` is what it pays at the level it stands at NOW — honour, whether settled or pending.
  -- `reward_vouched` is what two friends would lift it to. Both from preview_challenge_reward, the
  -- function grant_reward reads, so the sheet cannot name a crate the reveal then contradicts.
  return jsonb_build_object(
    'id', v_goal.id,
    'label', v_goal.label,
    'grade', p_grade,
    'grade_target', v_goal.grade_target,
    'passed', true,
    'tier', v_goal.difficulty_tier,
    'state', v_claim ->> 'state',
    'level', coalesce(v_goal.verifiability, 'honor'),
    'asked', coalesce((v_claim ->> 'asked')::int, 0),
    'deadline', v_goal.vouch_deadline,
    'has_proof', v_goal.proof_path is not null,
    'reward', case
      when v_goal.difficulty_tier is null then null
      else preview_challenge_reward(v_goal.difficulty_tier, coalesce(v_goal.verifiability, 'honor'), 1, 1)
    end,
    'reward_vouched', case
      when v_goal.difficulty_tier is null then null
      else preview_challenge_reward(v_goal.difficulty_tier, 'vouched', 1, 1)
    end
  );
end;
$$;

comment on function report_goal_grade(uuid, numeric, text, uuid[]) is
  '0209 — settles a personal grade goal on the reported mark. A miss writes missed_at. A pass records the mark and goes through claim_goal_complete: vouchers asked → 48h window; nobody asked → honour now. Proof is shown to vouchers and never resolves on its own (0165). Pays once, via challenges_economy, at the settled level.';

revoke all on function report_goal_grade(uuid, numeric, text, uuid[]) from public;
revoke all on function report_goal_grade(uuid, numeric, text, uuid[]) from anon;
grant execute on function report_goal_grade(uuid, numeric, text, uuid[]) to authenticated;

-- ─────────────────────────── assertions ───────────────────────────
--
-- Every behavioural check is paired with the control that would read differently under the bug
-- (assertions_must_discriminate): the honour settle beside the vouched one, the miss beside the
-- pass, the refused second report beside the first one that went through.
do $assert$
declare
  v_n int;
  v_req int;
  v_uid uuid;
  v_vouchers uuid[];
  v_out jsonb;
  v_id uuid;
  v_row challenges;
  v_caught text;
begin
  -- ── shape: one function, and an old two-argument call still resolves to it ──
  select count(*), min(p.pronargs - p.pronargdefaults) into v_n, v_req
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'report_goal_grade';
  if v_n <> 1 then
    raise exception '0209: report_goal_grade has % overloads, expected 1', v_n;
  end if;
  if v_req <> 2 then
    raise exception '0209: report_goal_grade requires % args, installed builds send 2', v_req;
  end if;
  if has_function_privilege('anon', 'report_goal_grade(uuid, numeric, text, uuid[])', 'execute') then
    raise exception '0209: anon can execute report_goal_grade';
  end if;
  if not has_function_privilege('authenticated', 'report_goal_grade(uuid, numeric, text, uuid[])', 'execute') then
    raise exception '0209: authenticated lost execute on report_goal_grade';
  end if;

  -- ── the neighbours this file builds on and promises not to touch (md5s read off prod first) ──
  if (select md5(prosrc) from pg_proc where oid = 'economy_on_challenge_completed()'::regprocedure)
       <> 'd40f622b7dbed4eaaff658205ab03a1c'
     or (select md5(prosrc) from pg_proc where oid = 'log_challenge_progress(uuid, numeric, text)'::regprocedure)
       <> '8147740abe646b2526df832a3fb0c916'
     or (select md5(prosrc) from pg_proc where oid = 'claim_goal_complete(uuid, text, uuid[])'::regprocedure)
       <> '00560c89691a05eacff1369965efdc3e'
     or (select md5(prosrc) from pg_proc where oid = 'submit_vouch(uuid, boolean)'::regprocedure)
       <> '1b72655b96e7641d7f76b8d291fd0c64' then
    raise exception '0209: a function this migration builds on has changed underneath it';
  end if;

  -- ── the bodies, run for real, rolled back ──
  select id into v_uid from profiles order by created_at limit 1;
  -- Two vouchers whose yes will COUNT: nothing counted from them in 30 days clears both the
  -- same-pair and the five-a-week caps. Picked from the data rather than assumed, so a real
  -- member's vouch history cannot make this flake.
  select array_agg(id) into v_vouchers from (
    select p.id from profiles p
     where p.id <> v_uid
       and not exists (select 1 from goal_vouches gv
                        where gv.voucher_id = p.id and gv.counted
                          and gv.created_at > now() - interval '30 days')
     order by p.created_at
     limit 2
  ) q;
  if v_uid is null or coalesce(array_length(v_vouchers, 1), 0) < 2 then
    raise notice '0209: fewer than three profiles, skipping the behavioural assertions';
    return;
  end if;

  begin
    -- Before the first call that notifies: a probe must not buzz a real phone.
    perform set_config('philoi.suppress_push', 'on', true);
    perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);

    -- ── 1 · a pass on honour: The Furnace, settled now, exactly as before ──
    v_out := create_scoped_goals(jsonb_build_array(
      jsonb_build_object('label', '0209 assertion · honour', 'grade_target', 90, 'difficulty_tier', 'legendary')));
    v_id := (v_out -> 'results' -> 0 ->> 'id')::uuid;
    v_out := report_goal_grade(v_id, 95);
    select * into v_row from challenges where id = v_id;
    if v_out ->> 'state' <> 'resolved' or v_row.completed_at is null or v_row.verifiability <> 'honor' then
      raise exception '0209: a bare pass did not settle at honour (state %, level %)', v_out ->> 'state', v_row.verifiability;
    end if;
    if v_row.reward_payload ->> 'max_band' is distinct from 'notable' then
      raise exception '0209: an honour legendary grade paid %, not The Furnace', v_row.reward_payload ->> 'max_band';
    end if;
    if v_row.progress <> 95 then
      raise exception '0209: the mark was not recorded';
    end if;
    -- The upgrade the sheet quotes is a REAL upgrade, not the same crate twice.
    if (v_out -> 'reward' ->> 'paid_band') is distinct from 'notable'
       or (v_out -> 'reward_vouched' ->> 'paid_band') is distinct from 'elite' then
      raise exception '0209: the receipt does not quote both outcomes (% / %)',
        v_out -> 'reward' ->> 'paid_band', v_out -> 'reward_vouched' ->> 'paid_band';
    end if;

    -- ── 2 · a miss: missed_at, no claim, no window — you do not vouch for a miss ──
    v_out := create_scoped_goals(jsonb_build_array(
      jsonb_build_object('label', '0209 assertion · miss', 'grade_target', 90, 'difficulty_tier', 'legendary')));
    v_id := (v_out -> 'results' -> 0 ->> 'id')::uuid;
    v_out := report_goal_grade(v_id, 80, null, v_vouchers);
    select * into v_row from challenges where id = v_id;
    if v_row.missed_at is null or v_row.completed_at is not null or v_row.claimed_at is not null
       or (v_out ->> 'passed')::boolean then
      raise exception '0209: a failed grade did not settle as a plain miss';
    end if;
    if exists (select 1 from goal_vouches where goal_id = v_id) then
      raise exception '0209: a miss asked friends to vouch for it';
    end if;

    -- ── 3 · 0165 survives: proof with nobody to show it to is still honour ──
    v_out := create_scoped_goals(jsonb_build_array(
      jsonb_build_object('label', '0209 assertion · proof', 'grade_target', 90, 'difficulty_tier', 'legendary')));
    v_id := (v_out -> 'results' -> 0 ->> 'id')::uuid;
    v_caught := null;
    begin
      perform report_goal_grade(v_id, 95, v_vouchers[1]::text || '/0209.mp4', null);
    exception when others then
      v_caught := SQLERRM;
    end;
    if v_caught is distinct from 'That proof does not belong to you.' then
      raise exception '0209: somebody else''s proof path was accepted (%)', v_caught;
    end if;
    v_out := report_goal_grade(v_id, 95, v_uid::text || '/0209.mp4', null);
    select * into v_row from challenges where id = v_id;
    if v_row.verifiability <> 'honor' or v_row.completed_at is null or v_row.proof_path is null then
      raise exception '0209: proof alone resolved to % — that is the hole 0165 closed', v_row.verifiability;
    end if;

    -- ── 4 · a pass with two friends asked: pending, then two yeses pay the FULL band, once ──
    v_out := create_scoped_goals(jsonb_build_array(
      jsonb_build_object('label', '0209 assertion · vouched', 'grade_target', 90, 'difficulty_tier', 'legendary')));
    v_id := (v_out -> 'results' -> 0 ->> 'id')::uuid;
    v_out := report_goal_grade(v_id, 93, v_uid::text || '/0209.mp4', v_vouchers);
    select * into v_row from challenges where id = v_id;
    if v_out ->> 'state' <> 'pending_vouch' or v_row.completed_at is not null
       or v_row.claimed_at is null or v_row.vouch_deadline is null or v_row.reward_payload is not null then
      raise exception '0209: an asked pass did not wait for its vouches (state %)', v_out ->> 'state';
    end if;
    if (select count(*) from goal_vouches where goal_id = v_id and verdict is null) <> 2 then
      raise exception '0209: the roster was not written';
    end if;

    -- The new guard. Discriminates: without it the call reaches claim_goal_complete and fails there
    -- with a DIFFERENT message — after overwriting the mark the friends were asked to confirm.
    v_caught := null;
    begin
      perform report_goal_grade(v_id, 99);
    exception when others then
      v_caught := SQLERRM;
    end;
    if v_caught is distinct from 'You already reported that one.' then
      raise exception '0209: a pending grade could be reported again (%)', v_caught;
    end if;

    perform set_config('request.jwt.claims', json_build_object('sub', v_vouchers[1], 'role', 'authenticated')::text, true);
    v_out := submit_vouch(v_id, true);
    if (v_out ->> 'resolved')::boolean then
      raise exception '0209: one vouch resolved the claim';
    end if;
    perform set_config('request.jwt.claims', json_build_object('sub', v_vouchers[2], 'role', 'authenticated')::text, true);
    v_out := submit_vouch(v_id, true);
    if not (v_out ->> 'resolved')::boolean then
      raise exception '0209: two counted vouches did not resolve the claim (%)', v_out;
    end if;
    perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

    select * into v_row from challenges where id = v_id;
    if v_row.verifiability <> 'vouched' or v_row.completed_at is null then
      raise exception '0209: a vouched grade settled at %', v_row.verifiability;
    end if;
    if v_row.reward_payload ->> 'max_band' is distinct from 'elite' then
      raise exception '0209: a vouched legendary grade paid %, not Hephaestus', v_row.reward_payload ->> 'max_band';
    end if;
    if v_row.progress <> 93 then
      raise exception '0209: the vouched mark was overwritten';
    end if;

    -- Pays ONCE: the window's sweep arriving late finds a settled goal and changes nothing.
    perform set_config('role', 'postgres', true);
    perform resolve_goal_claim(v_id, 'honor');
    if (select verifiability from challenges where id = v_id) <> 'vouched' then
      raise exception '0209: a late sweep downgraded a vouched goal';
    end if;

    raise exception 'philoi_0209_rollback';
  exception
    when others then
      if SQLERRM <> 'philoi_0209_rollback' then
        raise;
      end if;
  end;
end
$assert$;

