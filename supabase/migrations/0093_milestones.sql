-- §8 — Milestones: the "advertise a win" layer.
--
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- 🔒 THE FIREWALL. A milestone grants ZERO XP, ZERO embers, ZERO rank movement.
--
-- Nothing in this migration calls grant_reward(), economy_award_*(), notify_push's reward paths,
-- or writes to ember_wallet / ember_ledger / user_rank_state / forge_pass_state / pass_xp_ledger.
-- create_milestone() is an INSERT into one content table and nothing else, and it must stay that
-- way. The instant a self-reported grade earns currency, Philoi becomes a grade-comparison app and
-- the "effort, not outcome" identity collapses.
--
-- The firewall also buys the honesty: because there is no reward, there is no incentive to fake
-- one, which is exactly why we can accept self-reported grades WITHOUT verifying them. Adding a
-- payout here would not just change the economy, it would force a verification system to exist.
-- ══════════════════════════════════════════════════════════════════════════════════════════════
--
-- Two layers, hard split: the REWARDED layer (effort/consistency → XP, embers, rank — ipsative,
-- already built) and this CELEBRATED layer (user-declared outcomes — purely social).

create table if not exists milestones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  kind text not null check (kind in ('grade', 'offer', 'certification', 'fitness_pr', 'project', 'custom')),
  headline text not null check (char_length(btrim(headline)) between 1 and 90),
  note text check (note is null or char_length(note) <= 280),
  -- Grades are sensitive, so the floor is friends-only and a wider audience is a per-post choice.
  visibility text not null default 'friends' check (visibility in ('friends', 'campus', 'public')),
  /** The effort receipts as computed AT POST TIME, e.g. {"hours":23,"streak":14,"lockins":18}.
   * Frozen rather than recomputed on read: the card claims what was true when it was posted, and a
   * streak that later breaks must not retroactively rewrite a milestone someone already shared. */
  effort jsonb not null default '{}'::jsonb,
  /** §8's "Pin to my Journal" toggle. Off = the composer produced a share card and posted nothing. */
  pinned boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists milestones_user_idx on milestones (user_id, created_at desc);

alter table milestones enable row level security;

-- No direct select policy: visibility is a three-way rule (friends / campus / public) that RLS
-- would have to duplicate in every policy touching this table. get_milestones() below is the one
-- place that decides, same pattern as get_journal.
--
-- Owners can delete their own posts. There is deliberately no update policy — an edited milestone
-- whose effort receipts were frozen at post time would let someone swap the headline under a set
-- of stats that was never about it.
drop policy if exists milestones_own on milestones;
create policy milestones_own on milestones
  for select to authenticated using (user_id = auth.uid());

drop policy if exists milestones_delete_own on milestones;
create policy milestones_delete_own on milestones
  for delete to authenticated using (user_id = auth.uid());

-- ───────────────────────────── effort receipts ─────────────────────────────

/**
 * The Philoi twist: the outcome shown THROUGH the work behind it (§8).
 *
 * COMPUTED SERVER-SIDE, ALWAYS. The client never sends these numbers — it sends which of them to
 * keep. A card that says "backed by 23h + a 14-day streak" is making a factual claim about session
 * data, and a claim the poster could type themselves is worth nothing. Trimming is the user's
 * choice; inflating is not available.
 *
 * Window: the trailing 30 days. "This month" in the copy, and a rolling window rather than a
 * calendar one so a milestone posted on the 2nd is not backed by two days of work.
 */
create or replace function milestone_effort(p_user uuid)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select jsonb_build_object(
    'hours', (
      select round(coalesce(sum(c.duration_seconds), 0) / 3600.0)
      from check_ins c
      where c.user_id = p_user and c.duration_seconds is not null and c.removed_at is null
        and c.created_at >= now() - interval '30 days'
    ),
    'lockins', (
      select count(*)
      from check_ins c
      where c.user_id = p_user and c.duration_seconds is not null and c.removed_at is null
        and c.created_at >= now() - interval '30 days'
    ),
    'streak', (select coalesce(p.current_streak, 0) from profiles p where p.id = p_user)
  );
$$;

-- NOT granted to authenticated: this takes an arbitrary user id, and "how many hours has this
-- person locked in over the last 30 days" is not a question a client gets to ask about a stranger.
-- create_milestone and get_my_milestone_effort are both SECURITY DEFINER and reach it anyway.
revoke all on function milestone_effort(uuid) from public, authenticated;

/** Your own receipts, for the composer's preview. Same numbers create_milestone will stamp. */
create or replace function get_my_milestone_effort()
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select milestone_effort(auth.uid());
$$;

grant execute on function get_my_milestone_effort() to authenticated;

-- ───────────────────────────── visibility ─────────────────────────────

/**
 * Can p_viewer see p_owner's milestone at this visibility?
 *
 * Parameterised on the VIEWER rather than reading auth.uid(), because create_milestone needs to
 * answer this question about each of the poster's friends while the poster is the caller. The
 * auth.uid() convenience wrapper is below.
 */
create or replace function can_see_milestone_for(p_owner uuid, p_visibility text, p_viewer uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select case
    when p_viewer is null then false
    when p_owner = p_viewer then true
    when p_visibility = 'public' then true
    when p_visibility = 'campus' then exists (
      select 1 from profiles me, profiles them
      where me.id = p_viewer and them.id = p_owner
        and me.university is not null and me.university = them.university
    )
    else exists (
      select 1 from friend_requests f
      where f.status = 'accepted'
        and ((f.requester_id = p_viewer and f.recipient_id = p_owner)
          or (f.recipient_id = p_viewer and f.requester_id = p_owner))
    )
  end;
$$;

grant execute on function can_see_milestone_for(uuid, text, uuid) to authenticated;

/** The same question about the caller — what every read path uses. */
create or replace function can_see_milestone(p_owner uuid, p_visibility text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select can_see_milestone_for(p_owner, p_visibility, auth.uid());
$$;

grant execute on function can_see_milestone(uuid, text) to authenticated;

-- ───────────────────────────── create ─────────────────────────────

/**
 * Post a milestone. A CONTENT INSERT — see the firewall note at the top of this file.
 *
 * p_effort_keys is which receipts to KEEP ('hours' | 'streak' | 'lockins'), not their values. The
 * function looks the values up itself, so trimming works and inflating does not. An empty array
 * means the user turned the auto-attach off entirely.
 */
create or replace function create_milestone(
  p_kind text,
  p_headline text,
  p_note text default null,
  p_visibility text default 'friends',
  p_effort_keys text[] default array['hours', 'streak', 'lockins'],
  p_pinned boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_all jsonb;
  v_effort jsonb := '{}'::jsonb;
  v_key text;
  v_id uuid;
  v_name text;
  v_audience uuid[];
begin
  if v_user is null then raise exception 'Not signed in.'; end if;
  if coalesce(btrim(p_headline), '') = '' then raise exception 'A milestone needs a headline.'; end if;

  v_all := milestone_effort(v_user);
  foreach v_key in array coalesce(p_effort_keys, array[]::text[]) loop
    -- Unknown keys are skipped rather than raising: a newer client offering a fourth receipt should
    -- degrade to the three this build knows, not fail to post.
    if v_all ? v_key then
      v_effort := v_effort || jsonb_build_object(v_key, v_all -> v_key);
    end if;
  end loop;

  insert into milestones (user_id, kind, headline, note, visibility, effort, pinned)
  values (
    v_user,
    p_kind,
    btrim(p_headline),
    nullif(btrim(coalesce(p_note, '')), ''),
    coalesce(p_visibility, 'friends'),
    v_effort,
    coalesce(p_pinned, true)
  )
  returning id into v_id;

  -- Tell the friends who can see it. NOT decoration: a milestone is friends-only by default, there
  -- is no milestone shelf and no feed, so without this the post is invisible unless somebody
  -- happens to open your profile. Bell-only by default (notification_push_default below), per the
  -- spec's "bell (push opt.)".
  --
  -- Still not a reward: this notifies OTHER people that something happened. It moves no currency.
  if coalesce(p_pinned, true) then
    select p.display_name into v_name from profiles p where p.id = v_user;
    select array_agg(f.uid) into v_audience
    from (
      select case when fr.requester_id = v_user then fr.recipient_id else fr.requester_id end as uid
      from friend_requests fr
      where fr.status = 'accepted' and (fr.requester_id = v_user or fr.recipient_id = v_user)
    ) f
    -- Re-checked per recipient rather than assumed: 'campus' and 'public' widen the audience
    -- elsewhere, but the delivery list is the friend graph either way, and a friend who somehow
    -- fails the visibility test should not be told about a post they cannot open.
    where can_see_milestone_for(v_user, coalesce(p_visibility, 'friends'), f.uid);

    if v_audience is not null and array_length(v_audience, 1) > 0 then
      perform notify_event(
        v_audience,
        'milestone_posted',
        coalesce(v_name, 'A friend') || ' hit a milestone: ' || btrim(p_headline),
        nullif(btrim(coalesce(p_note, '')), ''),
        v_user,
        v_id,
        '/milestone/[id]',
        jsonb_build_object('id', v_id::text),
        -- No leading art: the poster's avatar is the actor and the feed row renders it from
        -- actor_id. Cast so the positional NULL resolves to notify_event's text parameter.
        null::text,
        'rounded'
      );
    end if;
  end if;

  -- Nothing else follows. No grant_reward, no ember_ledger row, no rank recompute. If a future
  -- change wants a payout here, it is not a change to this function — it is a change to the
  -- product's premise, and belongs in a conversation before it belongs in SQL.
  return v_id;
end;
$$;

grant execute on function create_milestone(text, text, text, text, text[], boolean) to authenticated;

/** Delete your own milestone. Cascades its cheers. */
create or replace function delete_milestone(p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from milestones where id = p_id and user_id = auth.uid();
$$;

grant execute on function delete_milestone(uuid) to authenticated;

-- ───────────────────────────── visibility + read ─────────────────────────────

create table if not exists milestone_cheers (
  milestone_id uuid not null references milestones (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  -- One cheer per person per milestone. Same cap 0081 put on challenge cheers, for the same
  -- reason: a cheer is a reaction, not a counter someone can spam upward.
  primary key (milestone_id, user_id)
);

alter table milestone_cheers enable row level security;

drop policy if exists milestone_cheers_own on milestone_cheers;
create policy milestone_cheers_own on milestone_cheers
  for select to authenticated using (user_id = auth.uid());

/**
 * Cheer someone's milestone. Fires the notification (§8 social / NOTIFICATIONS_SPEC Friends &
 * social) and — firewall — pays out nothing to either side.
 *
 * Returns the new cheer count so the client can update without a refetch.
 */
create or replace function cheer_milestone(p_milestone_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_visibility text;
  v_headline text;
  v_name text;
  v_avatar text;
  v_count int;
begin
  if auth.uid() is null then raise exception 'Not signed in.'; end if;

  select m.user_id, m.visibility, m.headline into v_owner, v_visibility, v_headline
  from milestones m where m.id = p_milestone_id;
  if v_owner is null then raise exception 'That milestone is gone.'; end if;
  if not can_see_milestone(v_owner, v_visibility) then raise exception 'Not visible to you.'; end if;

  insert into milestone_cheers (milestone_id, user_id)
  values (p_milestone_id, auth.uid())
  on conflict (milestone_id, user_id) do nothing;

  -- Only notify on the FIRST cheer from this person. A repeat tap is a no-op insert and must not
  -- re-ping the owner.
  if found and v_owner <> auth.uid() then
    select p.display_name, p.avatar_url into v_name, v_avatar from profiles p where p.id = auth.uid();
    perform notify_event(
      array[v_owner],
      'milestone_cheered',
      '🎉 ' || coalesce(v_name, 'Someone') || ' cheered your milestone.',
      v_headline,
      auth.uid(),
      p_milestone_id,
      '/milestone/[id]',
      jsonb_build_object('id', p_milestone_id::text),
      v_avatar,
      'circle'
    );
  end if;

  select count(*) into v_count from milestone_cheers where milestone_id = p_milestone_id;
  return v_count;
end;
$$;

grant execute on function cheer_milestone(uuid) to authenticated;

/** One person's milestones, filtered to what the caller may see. */
create or replace function get_milestones(p_user uuid, p_limit int default 50)
returns table (
  id uuid,
  kind text,
  headline text,
  note text,
  visibility text,
  effort jsonb,
  pinned boolean,
  cheers bigint,
  cheered boolean,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    m.id,
    m.kind,
    m.headline,
    m.note,
    m.visibility,
    m.effort,
    m.pinned,
    (select count(*) from milestone_cheers mc where mc.milestone_id = m.id),
    exists (select 1 from milestone_cheers mc where mc.milestone_id = m.id and mc.user_id = auth.uid()),
    m.created_at
  from milestones m
  where m.user_id = p_user
    and can_see_milestone(m.user_id, m.visibility)
    -- Unpinned means §8's "share card only, nothing posted": the row exists so the card has a
    -- permalink to cheer and return to, but it is not ON the profile for anyone but its author.
    -- Without this clause "nothing posted" would be true of the Journal and false of everywhere
    -- else that lists milestones.
    and (m.pinned or m.user_id = auth.uid())
  order by m.created_at desc
  limit least(greatest(p_limit, 1), 200);
$$;

grant execute on function get_milestones(uuid, int) to authenticated;

/** One milestone, for the share/permalink screen a cheer notification taps into. */
create or replace function get_milestone(p_id uuid)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select jsonb_build_object(
    'id', m.id,
    'user_id', m.user_id,
    'display_name', p.display_name,
    'handle', p.handle,
    'kind', m.kind,
    'headline', m.headline,
    'note', m.note,
    'visibility', m.visibility,
    'effort', m.effort,
    'pinned', m.pinned,
    'cheers', (select count(*) from milestone_cheers mc where mc.milestone_id = m.id),
    'cheered', exists (select 1 from milestone_cheers mc where mc.milestone_id = m.id and mc.user_id = auth.uid()),
    'created_at', m.created_at
  )
  from milestones m
  join profiles p on p.id = m.user_id
  where m.id = p_id and can_see_milestone(m.user_id, m.visibility);
$$;

grant execute on function get_milestone(uuid) to authenticated;

-- ───────────────────────────── notification wiring ─────────────────────────────
--
-- 0086 falls unknown types back to 'friends_social', which is where these two belong anyway — but
-- relying on the fallback would mean the mapping silently disagreed with the spec's table, and the
-- next person reading notification_category() would not find them. Listed explicitly instead.

create or replace function notification_category(p_type text)
returns text
language sql
immutable
as $$
  select case
    when p_type in ('friend_request', 'friend_accepted', 'friend_ranked_up', 'friend_passed_you',
                    'friend_joined', 'friend_locked_in',
                    -- §8 (NOTIFICATIONS_SPEC "Friends & social").
                    'milestone_cheered', 'milestone_posted') then 'friends_social'
    when p_type in ('challenged', 'challenge_accepted', 'challenge_declined', 'challenge_passed',
                    'challenge_ending_soon', 'challenge_won', 'challenge_lost', 'goal_at_risk',
                    'goal_streak_milestone') then 'challenges'
    when p_type in ('campfire_joined', 'campfire_join_request', 'campfire_challenge_started',
                    'campfire_cold', 'campfire_added', 'campfire_settled', 'campfire_message')
      then 'campfires'
    when p_type in ('streak_at_risk', 'daily_fire_reminder', 'streak_milestone') then 'streak_reminders'
    when p_type in ('season_ending', 'season_settled', 'ranked_up', 'rank_dropped', 'reward_ready')
      then 'season_rank'
    else 'friends_social'
  end;
$$;

/**
 * A cheer pushes (spec: "push · bell") — it is someone reacting to you personally, and those are
 * the ones worth interrupting for. A friend POSTING pushes bell-only (spec: "bell (push opt.)"):
 * in a cohort where everyone posts milestones, pushing each one is how a channel gets muted.
 */
create or replace function notification_push_default(p_type text)
returns boolean
language sql
immutable
as $$
  select p_type not in (
    'friend_locked_in',   -- spec: "off (spammy)"
    'campfire_message',   -- spec: "off by default"
    'rank_dropped',       -- spec: "don't demoralize"
    'friend_ranked_up',   -- spec: bell, push only when batched
    'campfire_joined',    -- spec: bell + badge, no push
    'milestone_posted'    -- spec: "bell (push opt.)" — the cheer is the one that pushes
  );
$$;

-- ───────────────────────────── the journal union ─────────────────────────────
--
-- §8: a pinned milestone IS a journal entry — "user-authored rather than system-generated". 0091
-- built the journal as a read over notification_events; this widens it to that table UNION the
-- pinned milestones, which is why 0091 deliberately left journal_notes.entry_key without a foreign
-- key ("§8's milestones will key into the same table with their own ids").
--
-- DROPPED, not CREATE OR REPLACE: the return shape gains a `kind` column, and Postgres refuses to
-- replace a function whose OUT parameters changed. Replacing in place is what silently failed in
-- 0081, so the drop is explicit.

drop function if exists get_journal(uuid, int);

create or replace function get_journal(p_user uuid, p_limit int default 50)
returns table (
  entry_key uuid,
  /** 'achievement' — the system recorded it; 'milestone' — the user posted it. */
  kind text,
  type text,
  title text,
  body text,
  image_url text,
  image_shape text,
  note text,
  hidden boolean,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select * from (
    select
      e.id as entry_key,
      'achievement'::text as kind,
      e.type,
      e.title,
      e.body,
      e.image_url,
      e.image_shape,
      n.note,
      coalesce(n.hidden, false) as hidden,
      e.created_at
    from notification_events e
    left join journal_notes n on n.user_id = e.user_id and n.entry_key = e.id
    where e.user_id = p_user
      and e.type = any(journal_achievement_types())
      and (p_user = auth.uid() or not coalesce(n.hidden, false))

    union all

    -- A milestone carries its own note in `headline`/`note`, so it does not join journal_notes: the
    -- composer already asked for the comment, and "＋ add a note" on a post you just wrote would be
    -- a second, competing note on the same entry.
    select
      m.id as entry_key,
      'milestone'::text as kind,
      'milestone_' || m.kind as type,
      m.headline,
      m.note,
      null::text as image_url,
      'rounded'::text as image_shape,
      m.note,
      false as hidden,
      m.created_at
    from milestones m
    where m.user_id = p_user
      and m.pinned
      and can_see_milestone(m.user_id, m.visibility)
  ) rows
  order by rows.created_at desc
  limit least(greatest(p_limit, 1), 200);
$$;

grant execute on function get_journal(uuid, int) to authenticated;
