-- The campfire member view (punchlist 17 P6, design-mocks/94-campfire-member-view.html).
--
-- Mock 94 lands you inside a campfire on a clan page: banner hero, a JOIN GATE chip ("Gold+ to
-- join"), a serious stat strip, and the leaderboard already on screen. Three of those need data the
-- schema didn't carry:
--   1. `groups.min_join_tier` — the gate itself. Null = anyone. Enforced server-side, not just
--      drawn: a chip that says "Gold+" while the RPC lets a Bronze in is a lie in the UI.
--   2. `groups.house_rule` — the owner's one-line rule at the bottom of the mock. Free text,
--      nullable; the block simply doesn't render when it's null.
--   3. `get_campfire_stats()` — avg streak · locked-in hours/day · live challenges. All three were
--      computable from existing tables but not exposed anywhere.
--
-- NOTE: no explicit begin/commit — `supabase db push` already runs each migration inside a
-- transaction AND records schema_migrations in that same transaction.

-- ───────────────────────────── the gate + the rule ─────────────────────────────

alter table groups add column if not exists min_join_tier text;
alter table groups add column if not exists house_rule text;

-- Named constraint, dropped first so a re-run doesn't collide. The tier list is the ladder from
-- rank_thresholds (0063's rework) — kept as a check rather than an FK because rank_thresholds is
-- keyed by rank_index, not by tier, so there's no unique tier column to point at.
alter table groups drop constraint if exists groups_min_join_tier_check;
alter table groups add constraint groups_min_join_tier_check check (
  min_join_tier is null or min_join_tier in (
    'bronze', 'silver', 'gold', 'platinum', 'diamond',
    'hero', 'titan', 'olympian', 'immortal', 'primordial'
  )
);

alter table groups drop constraint if exists groups_house_rule_len_check;
alter table groups add constraint groups_house_rule_len_check check (
  house_rule is null or char_length(house_rule) <= 160
);

-- The lowest rank_index a tier occupies — i.e. entering that tier at its bottom division. Comparing
-- floors is what makes "Gold+" mean Gold III and up rather than only Gold I.
create or replace function tier_rank_floor(p_tier text)
returns int
language sql
stable
set search_path = public
as $$
  select min(rt.rank_index) from rank_thresholds rt where rt.tier = p_tier;
$$;

-- Does this user clear the campfire's gate? No gate -> always true.
create or replace function meets_campfire_gate(p_group_id uuid, p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_min_tier text;
  v_user_tier text;
begin
  select g.min_join_tier into v_min_tier from groups g where g.id = p_group_id;
  if v_min_tier is null then
    return true;
  end if;

  select t.tier into v_user_tier from rank_tier_for_score(universal_score(p_user_id)) t;
  if v_user_tier is null then
    return false;
  end if;

  return coalesce(tier_rank_floor(v_user_tier) >= tier_rank_floor(v_min_tier), false);
end;
$$;

-- Owner-only, editable any time — same rule as privacy (PHILOI_UI_SPEC.md §14). An RPC rather than
-- a direct update because the "groups: owner can update" policy is broad and these two fields are
-- what the join path reads; keeping the write behind a function keeps that surface explicit.
create or replace function update_campfire_house_rules(
  p_group_id uuid,
  p_min_join_tier text,
  p_house_rule text
)
returns groups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group groups;
begin
  select * into v_group from groups where id = p_group_id;
  if v_group.id is null then
    raise exception 'Campfire not found.';
  end if;
  if v_group.owner_id <> auth.uid() then
    raise exception 'Only the owner can change the house rules.';
  end if;

  update groups
  set min_join_tier = nullif(p_min_join_tier, ''),
      house_rule = nullif(btrim(coalesce(p_house_rule, '')), '')
  where id = p_group_id
  returning * into v_group;

  return v_group;
end;
$$;

-- ───────────────────────────── enforcement ─────────────────────────────
-- The gate applies to the two DISCOVERY paths (instant join, and asking a gated fire to let you in).
-- join_group_with_code deliberately does NOT check it: a code is someone already in the fire
-- personally handing you a way in, which is the house overriding its own rule.

create or replace function join_public_group(p_group_id uuid)
returns groups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group groups;
begin
  select * into v_group from groups where id = p_group_id and privacy = 'open';

  if v_group.id is null then
    raise exception 'That circle is not open for instant joining.';
  end if;

  if not meets_campfire_gate(p_group_id, auth.uid()) then
    raise exception 'This campfire only takes % and above.', initcap(v_group.min_join_tier);
  end if;

  insert into group_members (group_id, user_id, role)
  values (v_group.id, auth.uid(), 'member')
  on conflict (group_id, user_id) do nothing;

  return v_group;
end;
$$;

create or replace function request_to_join_group(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group groups;
  v_requester_name text;
begin
  select * into v_group from groups where id = p_group_id and privacy = 'gated';
  if v_group.id is null then
    raise exception 'That campfire is not open to join requests.';
  end if;

  if is_group_member(p_group_id) then
    raise exception 'Already a member.';
  end if;

  if not meets_campfire_gate(p_group_id, auth.uid()) then
    raise exception 'This campfire only takes % and above.', initcap(v_group.min_join_tier);
  end if;

  insert into group_join_requests (group_id, user_id)
  values (p_group_id, auth.uid())
  on conflict (group_id, user_id) where status = 'pending' do nothing;

  select display_name into v_requester_name from profiles where id = auth.uid();
  perform notify_push(
    array[v_group.owner_id],
    v_group.name,
    coalesce(v_requester_name, 'Someone') || ' wants to join your campfire',
    jsonb_build_object('type', 'join_request', 'group_id', p_group_id)
  );
end;
$$;

-- ───────────────────────────── the stat strip ─────────────────────────────
-- Mock 94's three numbers. Members-only (the trailing where clause): a non-member gets zero rows,
-- and the client renders the strip empty rather than leaking a private fire's activity.
--
-- Scalar subqueries rather than a join pile, so each stat is independently readable and every
-- reference inside is table-qualified — RETURNS TABLE names shadow same-named table columns in the
-- body, which is a class of bug this schema has been bitten by before.

drop function if exists get_campfire_stats(uuid);

create function get_campfire_stats(p_group_id uuid)
returns table (
  member_count int,
  locked_in_today int,
  avg_streak numeric,
  avg_hours_per_day numeric,
  live_challenges int
)
language sql
security definer
set search_path = public
stable
as $$
  select
    (select count(*)::int from group_members gm where gm.group_id = p_group_id),
    -- Same "locked in today" definition as get_my_campfire_heat(): a member with any surviving
    -- check-in dated today. The heat gauge and this counter must never disagree on screen.
    (select count(distinct gm.user_id)::int
       from group_members gm
       join check_ins ci on ci.user_id = gm.user_id
      where gm.group_id = p_group_id
        and (ci.created_at at time zone 'utc')::date = current_date
        and ci.removed_at is null),
    (select coalesce(round(avg(p.current_streak), 0), 0)
       from group_members gm
       join profiles p on p.id = gm.user_id
      where gm.group_id = p_group_id),
    -- Hours locked in per member per day, averaged over the trailing week. Divided by the CURRENT
    -- member count, so a fire that just doubled in size honestly reads as less locked-in per head.
    (select round(
              coalesce(sum(ci.duration_seconds), 0)::numeric
              / greatest((select count(*) from group_members gm2 where gm2.group_id = p_group_id), 1)
              / 7.0 / 3600.0, 1)
       from group_members gm
       join check_ins ci on ci.user_id = gm.user_id
      where gm.group_id = p_group_id
        and ci.created_at >= now() - interval '7 days'
        and ci.removed_at is null),
    (select count(*)::int
       from social_challenges sc
      where sc.circle_id = p_group_id and sc.status = 'active')
  where is_group_member(p_group_id);
$$;
