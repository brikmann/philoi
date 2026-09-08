-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 0175 . A RACE CAN BE SCOPED AT THE MOMENT IT IS CREATED.
--
-- 0174 taught settlement to read social_challenges.difficulty_tier. This is the other half: a way
-- for the tier to actually get onto the row for a duel, a collective goal or a placement race.
--
-- ──────────────────── WHY set_challenge_scope WAS NOT ENOUGH ────────────────────
--
-- 0160 shipped set_challenge_scope for exactly this, and it works for a collective goal, which
-- create_group_challenge inserts as 'draft'. It cannot work for a placement race:
-- create_placement_challenge (0126) inserts status 'active' whenever the start is now or past --
-- the ordinary case, and the one mock 114's single "Start placement race" button describes -- and
-- set_challenge_scope refuses anything not in ('draft','pending') with "That challenge has already
-- started."
--
-- So a client doing the obvious create-then-scope would have the tier accepted for collective and
-- silently refused for placement. Silently, because the only sane thing for a client to do with a
-- failed scope is swallow it (an unscoped race pays what it always did, which is a smaller reward,
-- never a wrong one) -- so the failure would surface as nothing at all, on the one shape where the
-- reward preview had already promised a number. That is the 0174 problem again, one layer up.
--
-- ──────────────────── WHAT THIS DOES INSTEAD ────────────────────
--
-- The tier becomes an optional argument to the two create functions, applied inside the same
-- transaction as the insert. This is the shape host_campfire_challenge (0162) already uses -- it
-- takes p_tier and scopes before returning -- so this makes the other two consistent with the one
-- that was already right, rather than inventing a fourth pattern.
--
-- ──────────────────── THE FIREWALL IS UNCHANGED, AND THAT IS THE POINT ────────────────────
--
-- `verifiability` is still DERIVED, never accepted. The derivation moves into
-- challenge_verifiability_for() so there is exactly one copy of it, and set_challenge_scope is
-- rewritten to call that same helper -- behaviour identical, but the create-time door and the
-- after-the-fact door can no longer drift into disagreeing about what counts as observed.
--
-- scope_challenge_at_create() is the internal that skips the status check. It is NOT granted to
-- authenticated and must never be: the status check in set_challenge_scope is what stops a race
-- being re-priced once people are running it, and this bypass is only sound because its callers
-- are security-definer functions that created the row microseconds earlier. It still refuses to
-- overwrite a tier that is already set, so it cannot be used to re-scope even if it were reachable.
--
-- ──────────────────── NO-OP FOR EVERYTHING LIVE ────────────────────
--
-- p_tier defaults to null and every existing caller omits it, so both functions behave exactly as
-- before for every call the app makes today. The signatures change, so both are DROPPED first --
-- adding a defaulted parameter to a CREATE OR REPLACE creates a second overload and leaves the old
-- one resolvable, which is how a "replaced" function silently keeps serving the old body.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ──────────────────── the derivation, in one place ────────────────────
--
-- Same rule 0160 wrote inline: a race scored off a metric the app OBSERVES is auto; anything whose
-- score is somebody's word is honor. 'count' is honour by omission and deliberately so -- a count
-- race is people typing how many they did.
create or replace function challenge_verifiability_for(p_race_metric text)
returns text
language sql
immutable
as $verif$
  select case
    when p_race_metric in ('lockin_time', 'volume', 'distance') then 'auto'
    else 'honor'
  end;
$verif$;

comment on function challenge_verifiability_for(text) is
  '0175 -- the single copy of the social-challenge verifiability derivation. auto for observed metrics, honor for everything else. Called by set_challenge_scope and by the create-time scope path.';

-- ──────────────────── the create-time door ────────────────────
--
-- No status check, creator-scoped by construction (its callers just inserted the row), and refuses
-- to overwrite an existing tier. Intentionally NOT granted to authenticated -- see the header.
create or replace function scope_challenge_at_create(p_challenge_id uuid, p_tier text)
returns void
language plpgsql
security definer
set search_path = public
as $scope$
declare
  v_metric text;
  v_existing text;
begin
  if p_tier is null then
    return;
  end if;
  if p_tier not in ('common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic') then
    raise exception 'Unknown difficulty tier.';
  end if;

  select race_metric, difficulty_tier into v_metric, v_existing
    from social_challenges where id = p_challenge_id;

  -- One shot, same as set_challenge_scope. A challenge you could re-scope is a challenge you can
  -- finish cheap and re-price expensive on the way to the reveal.
  if v_existing is not null then
    return;
  end if;

  update social_challenges
     set difficulty_tier = p_tier,
         verifiability = challenge_verifiability_for(v_metric)
   where id = p_challenge_id;
end;
$scope$;

comment on function scope_challenge_at_create(uuid, text) is
  '0175 -- INTERNAL. Writes a scoped tier onto a just-created social challenge, skipping set_challenge_scope''s started-status check. Never granted to authenticated; only called by the security-definer create functions that made the row.';

-- Both, and the second is the one that matters. Supabase grants EXECUTE on new public-schema
-- functions to `authenticated` by default privilege, so revoking from PUBLIC alone leaves the
-- door wide open -- this migration's own assertion caught exactly that on the first run.
revoke all on function scope_challenge_at_create(uuid, text) from public;
revoke all on function scope_challenge_at_create(uuid, text) from authenticated, anon;

-- ──────────────────── set_challenge_scope, now sharing the derivation ────────────────────

create or replace function set_challenge_scope(p_challenge_id uuid, p_tier text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $sscope$
declare
  v_ch social_challenges;
  v_verif text;
  v_scope int;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;

  if p_tier is null or p_tier not in ('common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic') then
    raise exception 'Unknown difficulty tier.';
  end if;

  select * into v_ch from social_challenges c where c.id = p_challenge_id;
  if v_ch.id is null then
    raise exception 'Challenge not found.';
  end if;
  if v_ch.created_by <> auth.uid() then
    raise exception 'Only the person who set it can scope it.';
  end if;
  if v_ch.status not in ('draft', 'pending') then
    raise exception 'That challenge has already started.';
  end if;
  if v_ch.difficulty_tier is not null then
    raise exception 'That challenge has already been scoped.';
  end if;

  -- Same derivation, same reason: a race scored off an observed metric is auto; a free-text one is
  -- honor. race_metric is null on a plain count-target collective goal, which is the honour case,
  -- and 0162's 'count' is the honour case too — see the header above.
  -- 0175 -- was this `case` inline. One copy now, shared with the create-time path, so the
  -- two doors onto scoping cannot drift into disagreeing about what counts as observed.
  v_verif := challenge_verifiability_for(v_ch.race_metric);

  update social_challenges
     set difficulty_tier = p_tier,
         verifiability = v_verif
   where id = p_challenge_id;

  -- 0162 — the FIELD is the scope term the significance formula wants (§4: target magnitude ×
  -- field size × duration). This passed a literal 1, which is a duel. The roster is the honest
  -- number and it is the one the preview should price.
  select greatest(count(*), 1) into v_scope
    from challenge_participants p where p.challenge_id = p_challenge_id;

  return preview_challenge_reward(
    p_tier,
    v_verif,
    greatest(1, coalesce(v_ch.window_hours, 24) / 24),
    v_scope
  );
end;
$sscope$;

revoke all on function set_challenge_scope(uuid, text) from public;
grant execute on function set_challenge_scope(uuid, text) to authenticated;

-- ──────────────────── the two create functions gain an optional tier ────────────────────
--
-- Dropped first, by exact identity args, because the signature changes. See the header.

drop function if exists create_group_challenge(uuid, integer, integer, integer, text, timestamptz, timestamptz, numeric, text, text, numeric);

create or replace function create_group_challenge(
  p_circle_id uuid,
  p_target_count integer,
  p_window_hours integer,
  p_payout_xp integer default 300,
  p_public_name text default null,
  p_starts_on timestamptz default null,
  p_ends_on timestamptz default null,
  p_grade_target numeric default null,
  p_course_code text default null,
  p_race_metric text default null,
  p_target_value numeric default null,
  p_tier text default null
)
returns social_challenges
language plpgsql
security definer
set search_path = public
as $grp$
declare
  v_challenge social_challenges;
  v_metric text;
begin
  perform assert_challenge_span(p_starts_on, p_ends_on);

  if not is_group_member(p_circle_id) then
    raise exception 'Not a member of that campfire.';
  end if;

  -- 0162 — hosting for the whole campfire is an admin act. Checked after membership so a
  -- non-member still gets the more accurate of the two sentences. Carried forward verbatim.
  if not is_campfire_admin(p_circle_id, auth.uid()) then
    raise exception 'You''re not an admin of %, so a challenge can''t be posted there.',
      coalesce((select g.name from groups g where g.id = p_circle_id), 'that campfire');
  end if;

  -- Exactly one bar, matching social_challenges_mode_target_check. Caught here as well as by the
  -- constraint so the caller gets a sentence rather than a constraint name.
  if (p_target_count is not null)::int
   + (p_grade_target is not null)::int
   + (p_target_value is not null)::int <> 1 then
    raise exception 'A collective goal needs exactly one bar: a lock-in count, a grade, or a target value.';
  end if;

  -- 🔒 THE METRIC IS VALIDATED, NOT TRUSTED. p_race_metric is written straight into the column
  -- whose value decides which arm of challenge_racer_score runs, so an unrecognised name would
  -- fall through to the accumulating `else` arm and be scored by challenge_metric_value against a
  -- metric it does not know — silently zero, for everyone, forever.
  --
  -- Only the two AUTO-TRACKED accumulating metrics are legal here. 'grade' has its own column and
  -- its own arm; 'count' is host_campfire_challenge's shape and carries count_unit; 'lockin_time'
  -- as a measured target would be a second, subtly different spelling of the lock-in-count goal
  -- this file is careful not to disturb; 'ai' and 'xp' are not creatable.
  if p_target_value is not null then
    if coalesce(p_race_metric, '') not in ('volume', 'distance') then
      raise exception 'A measured collective target must be on volume or distance.';
    end if;
    if p_target_value <= 0 then
      raise exception 'A collective target has to be more than zero.';
    end if;
  end if;

  v_metric := case
    when p_grade_target is not null then 'grade'
    when p_target_value is not null then p_race_metric
    -- ← THE UNTOUCHED PATH. A lock-in-count collective goal still stores race_metric NULL, which
    --   is what routes it to challenge_racer_score's null arm and its count of qualifying
    --   check-ins. Nothing about that shape changes.
    else null
  end;

  insert into social_challenges (circle_id, created_by, mode, target_count, window_hours, payout_xp, status, starts_at, ends_at, public_name, shape, starts_on, ends_on, race_metric, grade_target, course_code, target_value)
  values (p_circle_id, auth.uid(), 'group', p_target_count, p_window_hours, p_payout_xp, 'draft', null, null, nullif(btrim(coalesce(p_public_name, '')), ''), 'collective', p_starts_on, p_ends_on,
          v_metric,
          p_grade_target, nullif(btrim(coalesce(p_course_code, '')), ''), p_target_value)
  returning * into v_challenge;

  -- ← RESTORED FROM 0112 by 0147. See that file's header; carried forward verbatim.
  insert into challenge_participants (challenge_id, user_id, state, responded_at)
  values (v_challenge.id, auth.uid(), 'accepted', now())
  on conflict (challenge_id, user_id) do nothing;

  -- 0175 -- THE SCOPE, IN THE SAME TRANSACTION AS THE CREATE.
  --
  -- Not a second round trip from the client, and deliberately not set_challenge_scope: that
  -- function refuses anything past 'draft'/'pending', and a placement race with an immediate start
  -- is inserted 'active'. A client that created then scoped would have the tier silently refused on
  -- exactly the shape Cindy is most likely to scope. Same transaction, so a challenge is never
  -- briefly visible unscoped and then repriced.
  if p_tier is not null then
    perform scope_challenge_at_create(v_challenge.id, p_tier);
    select * into v_challenge from social_challenges where id = v_challenge.id;
  end if;

  return v_challenge;
end;
$grp$;

revoke all on function create_group_challenge(uuid, integer, integer, integer, text, timestamptz, timestamptz, numeric, text, text, numeric, text) from public;
grant execute on function create_group_challenge(uuid, integer, integer, integer, text, timestamptz, timestamptz, numeric, text, text, numeric, text) to authenticated;

drop function if exists create_placement_challenge(uuid, text, integer, integer, text, timestamptz, timestamptz, numeric, text);

create or replace function create_placement_challenge(
  p_circle_id uuid,
  p_race_metric text,
  p_window_hours integer,
  p_payout_xp integer default 300,
  p_public_name text default null,
  p_starts_on timestamptz default null,
  p_ends_on timestamptz default null,
  p_grade_target numeric default null,
  p_course_code text default null,
  p_tier text default null
)
returns social_challenges
language plpgsql
security definer
set search_path = public
as $plc$
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

  -- 0175 -- THE SCOPE, IN THE SAME TRANSACTION AS THE CREATE.
  --
  -- Not a second round trip from the client, and deliberately not set_challenge_scope: that
  -- function refuses anything past 'draft'/'pending', and a placement race with an immediate start
  -- is inserted 'active'. A client that created then scoped would have the tier silently refused on
  -- exactly the shape Cindy is most likely to scope. Same transaction, so a challenge is never
  -- briefly visible unscoped and then repriced.
  if p_tier is not null then
    perform scope_challenge_at_create(v_challenge.id, p_tier);
    select * into v_challenge from social_challenges where id = v_challenge.id;
  end if;

  return v_challenge;
end;
$plc$;

revoke all on function create_placement_challenge(uuid, text, integer, integer, text, timestamptz, timestamptz, numeric, text, text) from public;
grant execute on function create_placement_challenge(uuid, text, integer, integer, text, timestamptz, timestamptz, numeric, text, text) to authenticated;

-- ──────────────────── asserted ────────────────────
do $assert$
begin
  -- The derivation still says what 0160 said, for every metric that matters.
  if challenge_verifiability_for('lockin_time') <> 'auto'
     or challenge_verifiability_for('volume') <> 'auto'
     or challenge_verifiability_for('distance') <> 'auto' then
    raise exception 'an observed race metric must derive auto';
  end if;
  if challenge_verifiability_for('grade') <> 'honor'
     or challenge_verifiability_for('count') <> 'honor'
     or challenge_verifiability_for(null) <> 'honor' then
    raise exception 'a self-reported race metric must derive honor';
  end if;

  -- Exactly one overload of each create function survives the drop. Two would mean the old body is
  -- still resolvable and half the callers keep hitting it.
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'create_group_challenge') <> 1 then
    raise exception 'create_group_challenge must have exactly one overload';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'create_placement_challenge') <> 1 then
    raise exception 'create_placement_challenge must have exactly one overload';
  end if;

  -- A POSITIVE CONTROL BESIDE THE COUNT. "Exactly one overload" passes for the wrong reason if the
  -- drop matched nothing and the create then matched the OLD signature: still one row, still green,
  -- and p_tier silently unreachable. So assert the survivor is the new one, not merely that it is
  -- alone. (Credit to the team-mode lane, which nearly shipped the negative-only version of this.)
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'create_group_challenge'
       and pg_get_function_identity_arguments(p.oid) like '%p_tier text%'
  ) then
    raise exception 'create_group_challenge must survive the drop WITH its p_tier argument';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'create_placement_challenge'
       and pg_get_function_identity_arguments(p.oid) like '%p_tier text%'
  ) then
    raise exception 'create_placement_challenge must survive the drop WITH its p_tier argument';
  end if;

  -- The internal door stays shut to ordinary callers.
  if has_function_privilege('authenticated', 'scope_challenge_at_create(uuid, text)', 'execute') then
    raise exception 'scope_challenge_at_create must not be callable by authenticated';
  end if;
end
$assert$;
