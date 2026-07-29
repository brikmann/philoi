-- "Who can see my photos" (PHILOI_UI_SPEC.md §6/§16 settings, design-mocks/16) — gates
-- whether a member's lock-in photos are visible beyond their own campfires (e.g. in a public/
-- discoverable campfire's feed, per §6's "opt-in only... respect the profile photo-privacy
-- toggle" note).

alter table profiles add column if not exists photo_visibility text not null default 'campfires'
  check (photo_visibility in ('everyone', 'campfires'));

-- RPC-gated (not a direct "update own row" policy) for the same reason set_chat_muted() is.
create or replace function set_my_photo_visibility(p_visibility text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_visibility not in ('everyone', 'campfires') then
    raise exception 'Invalid photo visibility.';
  end if;

  update profiles
  set photo_visibility = p_visibility
  where id = auth.uid();
end;
$$;
