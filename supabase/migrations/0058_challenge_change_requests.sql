-- Challenge change/cancel consent (design-mocks/70 + 71).
--
-- A challenge is a two-party agreement, so neither side can rewrite it alone. Editing the
-- window (or a group target) and ending it early both go through a request the OTHER side has
-- to agree to; the challenge runs unchanged and progress keeps counting until they do.
--
-- Scope note: consent is a HEAD-TO-HEAD concept — it needs exactly one counterparty. A group
-- challenge has N members and no single "other participant" to ask, so group terms stay the
-- creator's to set (members are pushed a notice, not a ballot). That asymmetry is enforced in
-- request_challenge_change below rather than left to the client.

create table if not exists challenge_change_requests (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references social_challenges (id) on delete cascade,
  requested_by uuid not null references profiles (id) on delete cascade,
  kind text not null check (kind in ('edit', 'cancel')),
  -- {"window_hours": 72} or {"target_count": 3}; null for a cancel, which proposes no new terms.
  proposed jsonb,
  status text not null default 'pending' check (status in ('pending', 'agreed', 'declined', 'expired')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check ((kind = 'cancel') or (proposed is not null))
);

-- One open request per challenge at a time — otherwise two people could each have a different
-- pending rewrite of the same terms and whichever got answered last would silently win.
create unique index if not exists challenge_change_requests_one_open
  on challenge_change_requests (challenge_id) where status = 'pending';

create index if not exists challenge_change_requests_challenge_idx
  on challenge_change_requests (challenge_id);

alter table challenge_change_requests enable row level security;

-- Readable by either side of the challenge it belongs to. Writes go exclusively through the
-- security-definer RPCs below (no insert/update/delete policy at all) — the whole point is that
-- a client can't hand itself an "agreed" request.
drop policy if exists "challenge_change_requests: read if participant" on challenge_change_requests;
create policy "challenge_change_requests: read if participant" on challenge_change_requests
  for select using (
    exists (
      select 1 from social_challenges sc
      where sc.id = challenge_change_requests.challenge_id
        and auth.uid() in (sc.created_by, sc.opponent_id)
    )
  );

-- ───────────────────────────── request ─────────────────────────────

create or replace function request_challenge_change(
  p_challenge_id uuid,
  p_kind text,
  p_proposed jsonb default null
)
returns challenge_change_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_challenge social_challenges;
  v_request challenge_change_requests;
  v_other uuid;
  v_me_name text;
  v_body text;
begin
  select * into v_challenge from social_challenges where id = p_challenge_id;
  if v_challenge.id is null then
    raise exception 'Challenge not found.';
  end if;
  if v_challenge.status <> 'active' then
    raise exception 'Only an active challenge can be changed.';
  end if;
  if auth.uid() not in (v_challenge.created_by, v_challenge.opponent_id) then
    raise exception 'Not your challenge.';
  end if;
  if v_challenge.mode <> 'h2h' then
    raise exception 'Group challenge terms are set by its creator, not by consent.';
  end if;
  if p_kind not in ('edit', 'cancel') then
    raise exception 'Unknown change kind.';
  end if;
  if exists (select 1 from challenge_change_requests where challenge_id = p_challenge_id and status = 'pending') then
    raise exception 'There is already a change request waiting on an answer.';
  end if;

  -- Only the terms mock 70 marks editable. Metric and stakes are fixed for the life of the
  -- challenge: they're what each side agreed to race on, and letting them move mid-race would
  -- turn "agree to an extension" into a blank cheque.
  if p_kind = 'edit' then
    if p_proposed is null or p_proposed = '{}'::jsonb then
      raise exception 'Nothing to change.';
    end if;
    if exists (select 1 from jsonb_object_keys(p_proposed) k where k not in ('window_hours', 'target_count')) then
      raise exception 'Only the window or the target can be changed.';
    end if;
    if p_proposed ? 'window_hours' and (p_proposed->>'window_hours')::int <= 0 then
      raise exception 'The window has to be at least an hour.';
    end if;
  end if;

  v_other := case when auth.uid() = v_challenge.created_by then v_challenge.opponent_id else v_challenge.created_by end;

  insert into challenge_change_requests (challenge_id, requested_by, kind, proposed)
  values (p_challenge_id, auth.uid(), p_kind, case when p_kind = 'cancel' then null else p_proposed end)
  returning * into v_request;

  select display_name into v_me_name from profiles where id = auth.uid();
  v_body := case
    when p_kind = 'cancel' then coalesce(v_me_name, 'Someone') || ' wants to end your challenge early.'
    else coalesce(v_me_name, 'Someone') || ' wants to change your challenge.'
  end;

  perform notify_push(
    array[v_other],
    'Change request',
    v_body,
    jsonb_build_object(
      'type', 'challenge_change_request',
      'request_id', v_request.id,
      'challenge_id', p_challenge_id
    )
  );

  return v_request;
end;
$$;

-- ───────────────────────────── respond ─────────────────────────────

create or replace function respond_to_challenge_change(p_request_id uuid, p_agree boolean)
returns challenge_change_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request challenge_change_requests;
  v_challenge social_challenges;
  v_new_window int;
  v_new_target int;
  v_me_name text;
begin
  select * into v_request from challenge_change_requests where id = p_request_id;
  if v_request.id is null then
    raise exception 'Request not found.';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'This request has already been answered.';
  end if;

  select * into v_challenge from social_challenges where id = v_request.challenge_id;

  -- Only the OTHER side answers. The requester agreeing with themselves is the exact hole this
  -- whole table exists to close.
  if auth.uid() = v_request.requested_by then
    raise exception 'You can''t answer your own request.';
  end if;
  if auth.uid() not in (v_challenge.created_by, v_challenge.opponent_id) then
    raise exception 'Not your challenge.';
  end if;

  if not p_agree then
    update challenge_change_requests
    set status = 'declined', responded_at = now()
    where id = p_request_id
    returning * into v_request;
  else
    if v_request.kind = 'cancel' then
      -- Ended by mutual agreement: finished, but with no winner and no payout. finalize_social_
      -- challenges() only ever touches rows still 'active', so this is terminal.
      update social_challenges
      set status = 'completed', winner_id = null, ends_at = now()
      where id = v_challenge.id;
    else
      v_new_window := nullif(v_request.proposed->>'window_hours', '')::int;
      v_new_target := nullif(v_request.proposed->>'target_count', '')::int;

      update social_challenges
      set window_hours = coalesce(v_new_window, window_hours),
          -- Re-derived from the ORIGINAL start, not from now() — "extend to 72h" means the
          -- challenge is 72 hours long, not 72 more hours from whenever the other side happened
          -- to tap Agree.
          ends_at = case
            when v_new_window is null then ends_at
            else coalesce(starts_at, created_at) + make_interval(hours => v_new_window)
          end,
          target_count = coalesce(v_new_target, target_count)
      where id = v_challenge.id;
    end if;

    update challenge_change_requests
    set status = 'agreed', responded_at = now()
    where id = p_request_id
    returning * into v_request;
  end if;

  select display_name into v_me_name from profiles where id = auth.uid();
  perform notify_push(
    array[v_request.requested_by],
    case when p_agree then 'Change agreed' else 'Change declined' end,
    coalesce(v_me_name, 'They') ||
      case
        when not p_agree then ' kept the challenge as it is.'
        when v_request.kind = 'cancel' then ' agreed to end the challenge early.'
        else ' agreed to your change.'
      end,
    jsonb_build_object(
      'type', 'challenge_change_answered',
      'challenge_id', v_challenge.id,
      'agreed', p_agree
    )
  );

  return v_request;
end;
$$;

-- ───────────────────────────── read (consent screen) ─────────────────────────────

-- Everything mock 71 needs above the fold, in one round trip: what's proposed, who proposed it,
-- and the CURRENT value it would replace so the screen can render before → after without the
-- client having to guess which term changed.
create or replace function get_challenge_change_request(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_request challenge_change_requests;
  v_challenge social_challenges;
  v_requester text;
begin
  select * into v_request from challenge_change_requests where id = p_request_id;
  if v_request.id is null then
    return null;
  end if;

  select * into v_challenge from social_challenges where id = v_request.challenge_id;
  if auth.uid() not in (v_challenge.created_by, v_challenge.opponent_id) then
    raise exception 'Not your challenge.';
  end if;

  select display_name into v_requester from profiles where id = v_request.requested_by;

  return jsonb_build_object(
    'id', v_request.id,
    'challenge_id', v_request.challenge_id,
    'requested_by', v_request.requested_by,
    'requested_by_name', coalesce(v_requester, 'They'),
    'is_mine', v_request.requested_by = auth.uid(),
    'kind', v_request.kind,
    'status', v_request.status,
    'proposed', v_request.proposed,
    'created_at', v_request.created_at,
    'mode', v_challenge.mode,
    'race_metric', v_challenge.race_metric,
    'payout_xp', v_challenge.payout_xp,
    'challenge_status', v_challenge.status,
    'current', jsonb_build_object(
      'window_hours', v_challenge.window_hours,
      'target_count', v_challenge.target_count,
      'ends_at', v_challenge.ends_at
    )
  );
end;
$$;

-- The open request on a challenge, so the Manage sheet can show "waiting on them" instead of
-- offering a second request that would just trip the one-open-at-a-time index.
create or replace function get_open_challenge_change_request(p_challenge_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_id uuid;
begin
  select id into v_id
  from challenge_change_requests
  where challenge_id = p_challenge_id and status = 'pending'
  limit 1;

  if v_id is null then
    return null;
  end if;
  return get_challenge_change_request(v_id);
end;
$$;

-- ───────────────────────────── forfeit (the escape hatch) ─────────────────────────────

-- Consent is the clean route, but it can't be the ONLY route: an opponent who simply never
-- answers would otherwise trap someone in a challenge forever. Forfeiting is unilateral and
-- deliberately unattractive — you hand the other side the win and NOBODY is paid out, so it's
-- a way out rather than a way to dodge a loss. (cancel_social_challenge from 0053 still handles
-- the genuinely unilateral case: withdrawing an invite nobody has accepted yet.)
create or replace function forfeit_social_challenge(p_challenge_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_challenge social_challenges;
  v_other uuid;
  v_me_name text;
begin
  select * into v_challenge from social_challenges where id = p_challenge_id;
  if v_challenge.id is null then
    raise exception 'Challenge not found.';
  end if;
  if v_challenge.status <> 'active' then
    raise exception 'Only an active challenge can be forfeited.';
  end if;
  if auth.uid() not in (v_challenge.created_by, v_challenge.opponent_id) then
    raise exception 'Not your challenge.';
  end if;
  if v_challenge.mode <> 'h2h' then
    raise exception 'Use leave/cancel for a group challenge.';
  end if;

  v_other := case when auth.uid() = v_challenge.created_by then v_challenge.opponent_id else v_challenge.created_by end;

  -- winner_id records who was left standing; no XP is awarded, which is what separates this
  -- from actually winning the race.
  update social_challenges
  set status = 'completed', winner_id = v_other, ends_at = now()
  where id = p_challenge_id;

  -- Any request still waiting on an answer is moot now.
  update challenge_change_requests
  set status = 'expired', responded_at = now()
  where challenge_id = p_challenge_id and status = 'pending';

  select display_name into v_me_name from profiles where id = auth.uid();
  perform notify_push(
    array[v_other],
    'Challenge forfeited',
    coalesce(v_me_name, 'They') || ' bowed out — no XP for either side.',
    jsonb_build_object('type', 'challenge_forfeited', 'challenge_id', p_challenge_id)
  );
end;
$$;
