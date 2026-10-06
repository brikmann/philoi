-- 0234 — A hosted campfire challenge is live at once.
--
-- ─────────────────────────────── WHY ───────────────────────────────
--
-- host_campfire_challenge (0162) inserted the challenge as status 'draft' with a null window, and
-- nothing on the hosted path ever promoted it. 0098 made every group challenge a draft until an
-- admin pressed "Start the race" (start_challenge), but the campfire screen no longer mounts the
-- tab that button lives on, and the host flow never called it.
--
-- So one row was read two ways:
--   · get_circle_active_challenges and join_campfire_challenge admit 'draft': the campfire strip
--     shows the challenge and Join works.
--   · get_my_social_challenges hides a draft from everyone but its creator (0097): the Friends
--     tab and challenge-info, which reads that list, show nothing to anyone who joined. Opening
--     the card says "That challenge isn't available any more", and the only thing a joiner can
--     see is their own mirror goal ("Visits · 0/3"), which looks like a second, bogus challenge.
--
-- ── Why going live at host time skips nothing ──
--
-- start_challenge does three things: drops still-'invited' rows, writes each racer's baseline
-- from challenge_metric_value, and opens the window. A hosted challenge invites nobody (the host
-- enrols themselves; everyone else JOINS), and it is a race_metric 'count' race whose baseline is
-- the mirror goal's progress, written per racer by campfire_challenge_attach_goal at the moment
-- they join (0162 "REUSE BEFORE MINT"). Only the window was missing, and that is what this sets.
--
-- ── What changes ──
--
--   1 · host_campfire_challenge inserts 'active' with starts_at / starts_on = now() and
--       ends_at = now() + window — the values start_challenge writes. The body is 0162's,
--       copied by script; only the column list and values of the insert differ.
--   2 · Hosted drafts already stranded are promoted the same way. That is a draft→active
--       update, so notify_challenge_status_change sends their racers "The race is on" — which
--       is accurate; they have never been told.
--
-- The base-check refuses to run if host_campfire_challenge has moved since 0162 (a sibling
-- edit would otherwise be silently reverted by this restatement).

-- ─────────────────────────── 0 · base check ───────────────────────────
do $base$
declare
  v_moved text;
begin
  select string_agg(p.proname, ', ') into v_moved
  from (values
    ('host_campfire_challenge', 'c2bcae7fb06769e75895b84946e908d7')
  ) b(name, md5)
  join pg_proc p on p.proname = b.name and p.pronamespace = 'public'::regnamespace
  where md5(p.prosrc) <> b.md5;
  if v_moved is not null then
    raise exception '0234: live body changed since this file was drafted: % — rebase onto it', v_moved;
  end if;
  if to_regprocedure('public.host_campfire_challenge(uuid,text,numeric,integer,text,text,text,integer)') is null then
    raise exception '0234 needs host_campfire_challenge/8 — see 0162';
  end if;
end;
$base$;

-- ─────────────────────────── 1 · host goes live ───────────────────────────
create or replace function host_campfire_challenge(
  p_circle_id uuid,
  p_metric text,
  p_target numeric,
  p_window_hours int default 168,
  p_label text default null,
  p_shape text default 'everyone_hits_target',
  p_tier text default null,
  p_payout_xp int default 300
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group groups;
  v_challenge social_challenges;
  v_unit text := lower(btrim(coalesce(p_metric, '')));
  v_name text;
  v_host text;
  v_members uuid[];
  v_notified int;
  v_message_id uuid;
  v_preview jsonb;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;

  select * into v_group from groups g where g.id = p_circle_id;
  if v_group.id is null then
    raise exception 'Campfire not found.';
  end if;

  -- 🔒 THE GATE. Read from group_members at the moment of the write. Nothing about the caller's
  -- role arrives as an argument, so there is no role to forge — and a forged CAMPFIRE fails right
  -- here, because the caller is not an admin of it.
  if not is_group_member(p_circle_id) then
    raise exception 'You''re not in %.', v_group.name;
  end if;
  if not is_campfire_admin(p_circle_id, auth.uid()) then
    raise exception 'You''re not an admin of %, so I can''t post a challenge there.', v_group.name;
  end if;

  if v_unit = '' then
    raise exception 'A counted challenge needs something to count.';
  end if;
  if p_target is null or p_target <= 0 then
    raise exception 'A counted challenge needs a target above zero.';
  end if;
  if p_shape = 'most_by_deadline' then
    -- See the header. A ranked race carries no target_count, so it cannot be a count race under
    -- social_challenges_mode_target_check; reshaping it into a collective would silently change
    -- how it settles.
    raise exception 'A "most by the deadline" race is a placement race — set that one as a race for the campfire.';
  end if;
  if p_shape not in ('everyone_hits_target', 'first_to') then
    raise exception 'Unknown challenge shape.';
  end if;

  v_name := nullif(btrim(coalesce(p_label, '')), '');
  if v_name is null then
    v_name := trim(to_char(p_target, 'FM999999999')) || ' ' || v_unit;
  end if;

  insert into social_challenges (
    circle_id, created_by, mode, shape, race_metric, count_unit,
    target_count, window_hours, payout_xp, status, public_name,
    starts_at, starts_on, ends_at
  )
  values (
    p_circle_id, auth.uid(), 'group', 'collective', 'count', v_unit,
    -- target_count is an int column; a count target is whole things.
    ceil(p_target)::int, p_window_hours, p_payout_xp, 'active', left(v_name, 60),
    -- 0234 — LIVE AT ONCE. Was 'draft' with a null window, and nothing on a hosted challenge ever
    -- called start_challenge, so it stayed a draft that get_my_social_challenges hides from
    -- everyone but the host. Same three values start_challenge writes at the gun.
    now(), now(), now() + make_interval(hours => p_window_hours)
  )
  returning * into v_challenge;

  -- R5 — the host is in their own challenge. Same statement, same reason, as 0147's.
  insert into challenge_participants (challenge_id, user_id, state, responded_at)
  values (v_challenge.id, auth.uid(), 'accepted', now())
  on conflict (challenge_id, user_id) do nothing;

  perform campfire_challenge_attach_goal(v_challenge.id, auth.uid());

  -- The tier, through the one function that validates it and derives verifiability. Not inlined:
  -- a second copy of that derivation is a second thing that can drift from goal_paid_band.
  if p_tier is not null then
    v_preview := set_challenge_scope(v_challenge.id, p_tier);
  end if;

  -- ── §3 · the bell, and the push, to everyone in the campfire ──
  select coalesce(array_agg(gm.user_id), '{}') into v_members
    from group_members gm where gm.group_id = p_circle_id;

  select display_name into v_host from profiles where id = auth.uid();

  -- The RETURN VALUE, not array_length(v_members). Those are different numbers and the difference
  -- is not an edge case: notify_event drops the actor from its own recipients, so a three-person
  -- campfire writes two rows. Reporting the roster size would have the confirm screen tell the
  -- host they notified themselves.
  v_notified := notify_event(
    v_members,
    'challenge_hosted',
    'A challenge for ' || v_group.name,
    coalesce(v_host, 'Someone') || ' is hosting ' || v_name || ' for ' || v_group.name || '.',
    -- The actor is excluded from the recipients by notify_event itself, so the host does not get
    -- pushed about the thing they just did.
    auth.uid(), p_circle_id,
    '/challenge-info/[challengeId]', jsonb_build_object('challengeId', v_challenge.id::text),
    null, 'rounded',
    jsonb_build_object('challenge_id', v_challenge.id, 'shape', v_challenge.shape,
                       'circle_id', p_circle_id)
  );

  -- ── §3 · and the card, in the chat, where the join CTA lives ──
  --
  -- A real message row rather than a synthetic feed item, so it reuses the campfire message
  -- pipeline whole: realtime delivery, the unread counter, the timeline's own ordering.
  -- §Distribution asks for a first-class chat item and this is what makes it one.
  insert into messages (group_id, user_id, body, attach_kind, attach_ref_id)
  values (p_circle_id, auth.uid(),
          left(v_name || ' — who''s in?', 2000),
          'challenge', v_challenge.id)
  returning id into v_message_id;

  return jsonb_build_object(
    'challenge_id', v_challenge.id,
    'circle_id', p_circle_id,
    'circle_name', v_group.name,
    'name', v_name,
    'metric', v_unit,
    'target', v_challenge.target_count,
    'message_id', v_message_id,
    'notified', coalesce(v_notified, 0),
    'preview', v_preview
  );
end;
$$;

comment on function host_campfire_challenge(uuid, text, numeric, int, text, text, text, int) is
  '0162, 0234 — hosts a counted challenge in a campfire, LIVE at once (0234: was a draft nothing ever started). OWNER/ADMIN ONLY, re-checked from group_members server-side: Cindy proposes the params and this decides. Creates the race, enrols and equips the host, stores the scoped tier through set_challenge_scope, fires challenge_hosted and posts the card into campfire chat.';

revoke all on function host_campfire_challenge(uuid, text, numeric, int, text, text, text, int) from public, anon;
grant execute on function host_campfire_challenge(uuid, text, numeric, int, text, text, text, int) to authenticated;

-- ─────────────────────────── 2 · the stranded drafts ───────────────────────────
-- A hosted challenge is a group 'count' race with mirror-goal rows: only host_campfire_challenge
-- and join_campfire_challenge write campfire_challenge_goals. Drafts made through
-- create_group_challenge keep their invite → "Start the race" lifecycle.
update social_challenges c
   set status = 'active',
       starts_at = now(),
       starts_on = coalesce(c.starts_on, now()),
       ends_at = coalesce(c.ends_on, now() + make_interval(hours => c.window_hours))
 where c.status = 'draft'
   and c.mode = 'group'
   and c.race_metric = 'count'
   and exists (select 1 from campfire_challenge_goals g where g.challenge_id = c.id);

-- ─────────────────────────── 3 · post-check ───────────────────────────
do $post$
begin
  if (select prosrc from pg_proc where proname = 'host_campfire_challenge'
        and pronamespace = 'public'::regnamespace) !~ $re$p_payout_xp, 'active', left\(v_name, 60\)$re$ then
    raise exception '0234: host_campfire_challenge does not insert active';
  end if;
end;
$post$;
