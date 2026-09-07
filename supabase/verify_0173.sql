-- Verification for 0173 (team mode — two teams, a scorekeeper, one flat reward per side).
--
-- SAFE TO RUN AGAINST PRODUCTION: everything happens inside a transaction that ends in ROLLBACK,
-- and `philoi.suppress_push` is set for the duration so notify_event cannot banner real users.
--
--   npx supabase db query --linked -f supabase/verify_0173.sql
--
-- 🔴 WHY THIS EXISTS, AND WHY THE ORDINARY DRY-RUN IS NOT ENOUGH.
--
-- MIGRATIONS.md's dry-run — begin; <migration>; rollback; — proves the DDL applies against real
-- prod state. It proves NOTHING about a function body. `create function` only syntax-checks
-- plpgsql; the SQL inside is not planned until the function first runs, so a wrong column, a bad
-- cast or a mis-aliased UPDATE sails through a clean dry-run and fails the first time a user taps
-- the button. 0173 ships twelve new bodies.
--
-- It has already earned its keep twice:
--
--   1. THE DOUBLE PAYOUT. settle_team_match ends with `status = 'completed'`, which fires the
--      AFTER UPDATE OF status trigger economy_on_social_challenge_closed. A team match is mode
--      'group' and not 'placement', so it fell into that trigger's COLLECTIVE arm, was paid a
--      SECOND reward at the collective band, and had its reward_payload overwritten with it.
--      Caught here as "expected 2 ember rows, got 4". 0173 §9 is the fix.
--
--   2. THE ARM THE FIX LEFT ALONE. §9 restates a ~250-line trigger to insert one guard, and
--      PROBES 1-9 only prove the thing that CHANGED. They say nothing about whether the
--      restatement broke the collective arm — the very arm team matches had been falling into.
--      A guard that excluded too much (`mode = 'group'` rather than `shape = 'team_match'`) would
--      stop paying every campfire goal in the app while the deploy assertion's six-call count
--      still read six. PROBE 10 settles a collective goal in both spellings — a lock-in count and
--      0169's measured target_value bar — and demands each pays, exactly once per person, with a
--      reward_payload for the reveal. Credit to philoi-app-6a for spotting that gap.
--
--   3. THE DEFERRED CARD. post_campfire_challenge_card is a DEFERRABLE INITIALLY DEFERRED
--      constraint trigger, so it fires at COMMIT — and a probe that never commits would never see
--      the card, and would report success on a feature whose first user-visible step did nothing.
--      `set constraints all immediate` drains the deferred queue inside the transaction instead.
--
-- Every check RAISES on failure, so a clean run with no error is the pass. Expected notices:
--
--   PROBE 1  ok — created <uuid> in campfire <name>
--   PROBE 1b ok — card posted: ⚽ Red Team vs Blue Team — pick a side.
--   PROBE 2  ok — non-admin refused by the admin gate: <message>
--   PROBE 3  ok — two players on two sides
--   PROBE 4  ok — non-scorekeeper refused by the scorekeeper gate: <message>
--   PROBE 5  ok — 2-1, undo and the zero floor all behave
--   PROBE 6  ok — get_team_match agrees with the row
--   PROBE 7  ok — 2 paid, ranks 1/2, tiers uncommon/common, N boxes minted
--   PROBE 7b ok — full-time line posted
--   PROBE 8  ok — settling twice pays once
--   PROBE 9  ok — report + opposite-side confirm settles and pays; own side refused
--   PROBE 10 ok — count collective goal still pays, N ledger rows, nobody twice
--   PROBE 10 ok — measured collective goal still pays, N ledger rows, nobody twice
--   ════ ALL PROBES PASSED ════
--
-- ⚠️ RUN IT AGAINST A DATABASE THAT ALREADY HAS 0173 APPLIED. Before 0173 is applied, prepend the
-- migration inside the same transaction:
--
--   { echo "begin;"; cat supabase/migrations/0173_*.sql; cat supabase/verify_0173.sql; --     echo "rollback;"; } > /tmp/f.sql && npx supabase db query --linked -f /tmp/f.sql
--
-- (verify_0173.sql carries no begin/rollback of its own for exactly that reason — the caller wraps
-- it, the way MIGRATIONS.md wraps a dry-run from the shell.)
--
-- EVERY REFUSAL CHECK ASSERTS THE MESSAGE, NOT JUST THAT SOMETHING RAISED. `exception when
-- others then v_refused := true` records a pass for ANY error — a mistyped argument, a campfire
-- that does not exist, or a gate earlier in the function answering before the one under test ever
-- runs. A green refusal is not evidence that the guard you meant to test is the guard that fired,
-- so each one demands the message name its own rule ('not an admin', 'scorekeeper', 'other team').
-- Credit to philoi-app-e8, who hit the same thing from the other side: a bare `when others` also
-- swallows the probe's OWN assertion failure and turns a red probe green.
--
-- IT NEEDS A CAMPFIRE WITH 3+ MEMBERS, one of them role='member'. It raises rather than skipping
-- if there isn't one: the first version of this probe picked "the first non-owner member" as its
-- non-admin and the largest campfire on prod turned out to have TWO admins, so the admin-gate test
-- was handing an admin to a gate and calling the refusal a failure. Select by role, not by
-- assumption about the data.

-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- FUNCTIONAL PROBE for 0173 — runs INSIDE the same rolled-back transaction as the migration.
--
-- WHY THIS EXISTS AND WHY THE PLAIN DRY-RUN IS NOT ENOUGH. `create function` only SYNTAX-checks a
-- plpgsql body; the SQL statements inside it are not planned until the function first RUNS. So a
-- clean dry-run of 0173 proves the DDL applies and proves nothing at all about twelve function
-- bodies — a wrong column name, a bad cast or a mis-aliased UPDATE would sail straight through it
-- and fail the first time a real user tapped the button.
--
-- So: run the migration, then actually PLAY A MATCH against real prod data, then roll it all back.
--
-- 🔒 Nothing escapes. Everything is inside the outer transaction, and philoi.suppress_push is set
-- the way 0123 and 0168 set it, so notify_event cannot banner real users even if pg_net's queue
-- behaved differently than expected.
-- ══════════════════════════════════════════════════════════════════════════════════════════════
set local philoi.suppress_push = 'on';

do $probe$
declare
  v_g uuid;
  v_owner uuid;
  v_p1 uuid;
  v_p2 uuid;
  v_match uuid;
  v_res jsonb;
  v_row social_challenges;
  v_rank_a int;
  v_rank_b int;
  v_paid_a int;
  v_paid_b int;
  v_embers int;
  v_boxes int;
  v_xp int;
  v_card int;
  v_refused boolean;
  v_msg text;
  v_match2 uuid;
  v_coll uuid;
  v_shape text;
begin
  -- A campfire with at least three distinct people in it: the host/scorekeeper plus one player on
  -- each side. Owner included via campfire_has_member's own owner-or-member rule.
  select g.id, g.owner_id into v_g, v_owner
    from groups g
   where (select count(distinct gm.user_id) from group_members gm where gm.group_id = g.id) >= 3
   order by g.created_at
   limit 1;

  if v_g is null then
    raise exception 'PROBE: no campfire with 3+ members to test against.';
  end if;

  -- 🔴 THE NON-ADMIN HAS TO BE PICKED BY ROLE, NOT BY "not the owner".
  --
  -- The first run of this probe failed with "a non-admin created a team match". It had picked the
  -- first non-owner member and assumed that meant ordinary — and the largest campfire on prod has
  -- an owner, a second ADMIN, and one plain member. The gate was working perfectly; the probe was
  -- handing it an admin and calling the pass a failure. Selecting by role is the difference
  -- between testing the rule and testing an assumption about the data.
  select gm.user_id into v_p2 from group_members gm
   where gm.group_id = v_g and gm.role = 'member' and gm.user_id <> v_owner
   order by gm.user_id limit 1;
  if v_p2 is null then
    raise exception 'PROBE: no plain member in that campfire — the admin-gate test would be vacuous.';
  end if;
  select gm.user_id into v_p1 from group_members gm
   where gm.group_id = v_g and gm.user_id not in (v_owner, v_p2) order by gm.user_id limit 1;

  -- ── 1 · CREATE, as the owner (admin gate) ──
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  v_res := create_team_match(v_g, 'soccer', 'Red Team', 'Blue Team',
                             '#FF6B5C', '#6BB8FF', v_owner, 'live', 'uncommon', 'common', null);
  v_match := (v_res ->> 'challenge_id')::uuid;
  raise notice 'PROBE 1 ok — created % in campfire %', v_match, v_res ->> 'circle_name';

  -- ── 1b · THE CHAT CARD, which is otherwise unverifiable inside a rolled-back transaction ──
  --
  -- post_campfire_challenge_card is a DEFERRABLE INITIALLY DEFERRED constraint trigger: it fires
  -- at COMMIT, and this probe never commits, so the card would simply never be written and the
  -- probe would report success on a feature whose first user-visible step silently did nothing.
  -- `set constraints all immediate` forces the deferred queue to drain NOW, inside the
  -- transaction, which is what makes the card observable without ever committing one.
  set constraints all immediate;
  select count(*) into v_card from messages
   where attach_kind = 'challenge' and attach_ref_id = v_match;
  if v_card <> 1 then
    raise exception 'PROBE: expected exactly one chat card for the new match, found %.', v_card;
  end if;
  if (select body from messages where attach_kind = 'challenge' and attach_ref_id = v_match)
     not like '%pick a side%' then
    raise exception 'PROBE: the match card used the wrong CTA: %',
      (select body from messages where attach_kind = 'challenge' and attach_ref_id = v_match);
  end if;
  raise notice 'PROBE 1b ok — card posted: %',
    (select body from messages where attach_kind = 'challenge' and attach_ref_id = v_match);

  -- ── 2 · a NON-ADMIN must be refused. v_p2 is role='member', checked above. ──
  perform set_config('request.jwt.claim.sub', v_p2::text, true);
  --
  -- 🔴 THE MESSAGE IS CHECKED, NOT JUST THE REFUSAL. `exception when others then v_refused := true`
  -- records a pass for ANY error — a mistyped argument, a campfire that does not exist, a gate
  -- earlier in the function answering before the one under test ever runs. A green refusal is not
  -- evidence that the guard you meant to test is the guard that fired. So each refusal below
  -- demands the message name its own rule.
  v_refused := false;
  begin
    perform create_team_match(v_g, 'soccer', 'X', 'Y', '#FF6B5C', '#6BB8FF', null, 'live', 'uncommon', 'common', null);
  exception when others then
    v_refused := true;
    v_msg := sqlerrm;
  end;
  if not v_refused then
    raise exception 'PROBE: a non-admin created a team match — the admin gate is not holding.';
  end if;
  if position('not an admin' in v_msg) = 0 then
    raise exception 'PROBE: the non-admin create was refused for the WRONG reason — got: %', v_msg;
  end if;
  raise notice 'PROBE 2 ok — non-admin refused by the admin gate: %', v_msg;

  -- ── 3 · JOIN a side each ──
  perform set_config('request.jwt.claim.sub', v_p1::text, true);
  perform join_team_match(v_match, 'a');
  perform set_config('request.jwt.claim.sub', v_p2::text, true);
  perform join_team_match(v_match, 'b');
  raise notice 'PROBE 3 ok — two players on two sides';

  -- ── 4 · a NON-REF must not move the score ──
  v_refused := false;
  begin
    perform ref_set_score(v_match, 'a', 1);
  exception when others then
    v_refused := true;
    v_msg := sqlerrm;
  end;
  if not v_refused then
    raise exception 'PROBE: a non-scorekeeper moved the score — ref_set_score is not gated.';
  end if;
  if position('scorekeeper' in v_msg) = 0 then
    raise exception 'PROBE: the non-scorekeeper edit was refused for the WRONG reason — got: %', v_msg;
  end if;
  raise notice 'PROBE 4 ok — non-scorekeeper refused by the scorekeeper gate: %', v_msg;

  -- ── 5 · the scorekeeper makes it Red 2 - 1 Blue ──
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform ref_set_score(v_match, 'a', 1);
  perform ref_set_score(v_match, 'a', 1);
  perform ref_set_score(v_match, 'b', 1);
  select * into v_row from social_challenges where id = v_match;
  if v_row.score_a <> 2 or v_row.score_b <> 1 then
    raise exception 'PROBE: expected 2-1, got %-%', v_row.score_a, v_row.score_b;
  end if;
  if v_row.match_state <> 'live' then
    raise exception 'PROBE: first score should have started the match, state is %', v_row.match_state;
  end if;
  -- Undo, and the floor at zero.
  perform ref_set_score(v_match, 'b', -1);
  perform ref_set_score(v_match, 'b', -5);
  select * into v_row from social_challenges where id = v_match;
  if v_row.score_b <> 0 then
    raise exception 'PROBE: undo/clamp broken, score_b is %', v_row.score_b;
  end if;
  perform ref_set_score(v_match, 'b', 1);
  raise notice 'PROBE 5 ok — 2-1, undo and the zero floor all behave';

  -- ── 6 · the read every surface uses ──
  v_res := get_team_match(v_match);
  if (v_res ->> 'score_a')::int <> 2 or (v_res ->> 'am_i_ref')::boolean is not true then
    raise exception 'PROBE: get_team_match disagrees with the row: %', v_res;
  end if;
  if jsonb_array_length(v_res -> 'roster') <> 2 then
    raise exception 'PROBE: roster should have 2 players, has %', jsonb_array_length(v_res -> 'roster');
  end if;
  if (v_res ->> 'score_step_label') <> '+1 goal' then
    raise exception 'PROBE: soccer should step by "+1 goal", got %', v_res ->> 'score_step_label';
  end if;
  raise notice 'PROBE 6 ok — get_team_match agrees with the row';

  -- ── 7 · FULL TIME, and the flat reward ──
  v_res := ref_end_match(v_match);
  raise notice 'PROBE 7 settlement: %', v_res;

  select * into v_row from social_challenges where id = v_match;
  if v_row.match_state <> 'final' or v_row.status <> 'completed' or v_row.ends_at is null then
    raise exception 'PROBE: bad final state — % / % / %', v_row.match_state, v_row.status, v_row.ends_at;
  end if;

  select final_rank into v_rank_a from challenge_participants where challenge_id = v_match and user_id = v_p1;
  select final_rank into v_rank_b from challenge_participants where challenge_id = v_match and user_id = v_p2;
  if v_rank_a <> 1 or v_rank_b <> 2 then
    raise exception 'PROBE: winners should rank 1 and losers 2, got % and %', v_rank_a, v_rank_b;
  end if;

  -- The tier each side was actually paid, read off the stored payload rather than re-derived.
  select (reward_payload ->> 'tier' = 'uncommon')::int into v_paid_a
    from challenge_participants where challenge_id = v_match and user_id = v_p1;
  select (reward_payload ->> 'tier' = 'common')::int into v_paid_b
    from challenge_participants where challenge_id = v_match and user_id = v_p2;
  if coalesce(v_paid_a, 0) <> 1 or coalesce(v_paid_b, 0) <> 1 then
    raise exception 'PROBE: flat tiers wrong — winner paid %, loser paid %',
      (select reward_payload ->> 'tier' from challenge_participants where challenge_id = v_match and user_id = v_p1),
      (select reward_payload ->> 'tier' from challenge_participants where challenge_id = v_match and user_id = v_p2);
  end if;

  -- 🔴 NO PER-PLAYER NUMBER ANYWHERE. final_value must stay null: the whole shape rests on there
  -- being no honest per-player figure, and a column holding one is how a screen starts showing it.
  if exists (select 1 from challenge_participants where challenge_id = v_match and final_value is not null) then
    raise exception 'PROBE: a team match wrote a per-player final_value.';
  end if;

  select count(*) into v_embers from ember_ledger where ref_id = v_match;
  select count(*) into v_boxes from loot_boxes where user_id in (v_p1, v_p2)
    and obtained_via = 'challenge' and created_at >= now() - interval '1 minute';
  select count(*) into v_xp from bonus_xp_awards where challenge_id = v_match;
  if v_embers <> 2 or v_xp <> 2 then
    raise exception 'PROBE: expected 2 ember rows and 2 xp rows, got % and %', v_embers, v_xp;
  end if;
  raise notice 'PROBE 7 ok — 2 paid, ranks 1/2, tiers uncommon/common, % boxes minted', v_boxes;

  -- The full-time line landed in the campfire.
  select count(*) into v_card from messages
   where group_id = v_g and body like 'Full time%' and created_at >= now() - interval '1 minute';
  if v_card < 1 then
    raise exception 'PROBE: no full-time line posted to the campfire.';
  end if;
  raise notice 'PROBE 7b ok — full-time line posted';

  -- Settling twice must be a no-op, not a second payout.
  v_res := settle_team_match(v_match, 5, 5);
  if (v_res ->> 'already_final')::boolean is not true then
    raise exception 'PROBE: a settled match settled again.';
  end if;
  select count(*) into v_embers from ember_ledger where ref_id = v_match;
  if v_embers <> 2 then
    raise exception 'PROBE: double settle paid again — % ember rows.', v_embers;
  end if;
  raise notice 'PROBE 8 ok — settling twice pays once';

  -- ── 9 · the DEFAULT route: report, then the other side confirms ──
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  v_res := create_team_match(v_g, 'basketball', 'Reds', 'Blues',
                             '#FF6B5C', '#6BB8FF', v_owner, 'confirm', 'rare', 'uncommon', null);
  v_match2 := (v_res ->> 'challenge_id')::uuid;
  perform set_config('request.jwt.claim.sub', v_p1::text, true);
  perform join_team_match(v_match2, 'a');
  perform set_config('request.jwt.claim.sub', v_p2::text, true);
  perform join_team_match(v_match2, 'b');

  -- The reporter's OWN side must not be able to confirm it. This is the whole anti-cheese.
  perform set_config('request.jwt.claim.sub', v_p1::text, true);
  perform report_team_match_score(v_match2, 3, 4);
  v_refused := false;
  begin
    perform confirm_team_match_score(v_match2, true);
  exception when others then
    v_refused := true;
    v_msg := sqlerrm;
  end;
  if not v_refused then
    raise exception 'PROBE: the reporting side confirmed its own score — dual confirmation is not enforced.';
  end if;
  -- Must be refused by the SIDE rule, not by "only someone who played can confirm" — v_p1 played.
  if position('other team' in v_msg) = 0 then
    raise exception 'PROBE: the own-side confirm was refused for the WRONG reason — got: %', v_msg;
  end if;

  -- The other side confirms, and that settles it.
  perform set_config('request.jwt.claim.sub', v_p2::text, true);
  v_res := confirm_team_match_score(v_match2, true);
  select * into v_row from social_challenges where id = v_match2;
  if v_row.match_state <> 'final' or v_row.score_a <> 3 or v_row.score_b <> 4 then
    raise exception 'PROBE: confirm did not settle at the reported score — % %-%',
      v_row.match_state, v_row.score_a, v_row.score_b;
  end if;
  -- Blue won 4-3, so p2 takes the winner tier and p1 the loser tier — the sides swap versus match 1.
  select (reward_payload ->> 'tier' = 'rare')::int into v_paid_b
    from challenge_participants where challenge_id = v_match2 and user_id = v_p2;
  if coalesce(v_paid_b, 0) <> 1 then
    raise exception 'PROBE: the confirm-mode winner was not paid the winner tier.';
  end if;
  raise notice 'PROBE 9 ok — report + opposite-side confirm settles and pays; own side refused';

  -- ── 10 · 🔴 THE RESTATEMENT DID NOT BREAK THE ARM IT LEFT ALONE ──
  --
  -- §9 restates economy_on_social_challenge_closed, ~250 lines with six grant_reward calls across
  -- four arms, to insert ONE guard. Everything above proves a team match now pays once. NONE of it
  -- proves a COLLECTIVE goal still pays at all — and that is the same hole as a negative probe
  -- with no positive control, just one level up: I verified the thing I changed and not the thing
  -- I might have broken while changing it.
  --
  -- It is the collective arm specifically because that is the one a team match was falling into.
  -- A guard that excluded too much — `mode = 'group'`, say, instead of `shape = 'team_match'` —
  -- would silently stop paying every campfire goal in the app, and the six-call count in the
  -- deploy assertion would still be six. Migration 0169 made MEASURED collective bars real
  -- (target_value), and they settle through this same arm, so both spellings are checked.
  --
  -- The trigger is driven DIRECTLY by an UPDATE of status rather than through a create RPC: the
  -- object under test is the trigger, and going through create_group_challenge would couple this
  -- probe to that function's signature, which a sibling lane is actively changing.
  for v_shape in select unnest(array['count', 'measured']) loop
    insert into social_challenges (
      circle_id, created_by, mode, shape, race_metric,
      target_count, target_value, window_hours, payout_xp,
      status, starts_at, ends_at, public_name
    )
    values (
      v_g, v_owner, 'group', 'collective',
      case when v_shape = 'measured' then 'volume' else null end,
      case when v_shape = 'measured' then null else 1 end,
      case when v_shape = 'measured' then 10000 else null end,
      24, 300, 'active', now() - interval '1 hour', now(), 'probe ' || v_shape
    )
    returning id into v_coll;

    insert into challenge_participants (challenge_id, user_id, state, responded_at, baseline)
    values (v_coll, v_p1, 'accepted', now(), 0), (v_coll, v_p2, 'accepted', now(), 0);

    update social_challenges set status = 'completed' where id = v_coll;

    select count(*) into v_embers from ember_ledger where ref_id = v_coll;
    if v_embers = 0 then
      raise exception 'PROBE: a % collective goal was paid NOTHING — the restatement broke the collective arm.', v_shape;
    end if;
    -- "Exactly once" per person, not a total: challenge_field's membership is its own business, so
    -- the assertion that means something is that nobody appears twice.
    if exists (select 1 from ember_ledger where ref_id = v_coll group by user_id having count(*) > 1) then
      raise exception 'PROBE: a % collective goal paid somebody twice.', v_shape;
    end if;
    if not exists (select 1 from challenge_participants
                    where challenge_id = v_coll and reward_payload is not null) then
      raise exception 'PROBE: a % collective goal wrote no reward_payload — the reveal would be blank.', v_shape;
    end if;
    raise notice 'PROBE 10 ok — % collective goal still pays, % ledger rows, nobody twice', v_shape, v_embers;
  end loop;

  raise notice '════ ALL PROBES PASSED — every 0173 body executed against real prod data ════';
end
$probe$;
