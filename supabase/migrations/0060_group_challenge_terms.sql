-- Group challenge terms, editable by whoever started it (design-mocks/70's "for group, the
-- target count").
--
-- The consent flow in 0058 is deliberately head-to-head only: it needs exactly one counterparty
-- to ask, and a group race has N members. Rather than invent a quorum nobody asked for, a group
-- challenge stays the creator's to set — members get told what changed, which is the same deal
-- they accepted when they joined a challenge someone else configured.

create or replace function update_group_challenge_terms(
  p_challenge_id uuid,
  p_target_count int default null,
  p_window_hours int default null
)
returns social_challenges
language plpgsql
security definer
set search_path = public
as $$
declare
  v_challenge social_challenges;
  v_members uuid[];
  v_me_name text;
begin
  select * into v_challenge from social_challenges where id = p_challenge_id;
  if v_challenge.id is null then
    raise exception 'Challenge not found.';
  end if;
  if v_challenge.mode <> 'group' then
    raise exception 'Head-to-head terms change by consent, not directly.';
  end if;
  if v_challenge.status <> 'active' then
    raise exception 'Only an active challenge can be changed.';
  end if;
  if v_challenge.created_by <> auth.uid() then
    raise exception 'Only whoever started this challenge can change it.';
  end if;
  if p_target_count is null and p_window_hours is null then
    raise exception 'Nothing to change.';
  end if;
  if p_target_count is not null and p_target_count <= 0 then
    raise exception 'The target has to be at least one lock-in.';
  end if;
  if p_window_hours is not null and p_window_hours <= 0 then
    raise exception 'The window has to be at least an hour.';
  end if;

  update social_challenges
  set target_count = coalesce(p_target_count, target_count),
      window_hours = coalesce(p_window_hours, window_hours),
      -- Measured from the original start, so "make it 72h" means a 72-hour challenge rather
      -- than 72 more hours from whenever this edit happened (same rule as the h2h path).
      ends_at = case
        when p_window_hours is null then ends_at
        else coalesce(starts_at, created_at) + make_interval(hours => p_window_hours)
      end
  where id = p_challenge_id
  returning * into v_challenge;

  select coalesce(array_agg(gm.user_id), '{}')
  into v_members
  from group_members gm
  where gm.group_id = v_challenge.circle_id and gm.user_id <> auth.uid();

  select display_name into v_me_name from profiles where id = auth.uid();

  if array_length(v_members, 1) > 0 then
    perform notify_push(
      v_members,
      'Challenge updated',
      coalesce(v_me_name, 'Someone') || ' changed the group challenge — now ' ||
        v_challenge.target_count || ' lock-ins each.',
      jsonb_build_object('type', 'challenge_terms_updated', 'challenge_id', p_challenge_id)
    );
  end if;

  return v_challenge;
end;
$$;
