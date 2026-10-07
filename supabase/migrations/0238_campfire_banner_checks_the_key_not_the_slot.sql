-- 0238 — a campfire owner can fly any banner they own again.
--
-- ─────────────────────────── what was wrong ───────────────────────────
--
-- set_campfire_banner (0134) proved ownership with
--   cosmetics_owned.cosmetic_key = p_item_key AND cosmetics_owned.slot = 'banner'
-- but cosmetics_owned.slot stopped being authoritative in 0070, when equip state moved to
-- equipped_loadout. open_loot_box and forge_combine write it as NULL (the client derives the slot
-- from the catalog), so only rows granted by the older paths carry it. In prod 5 of 23 owned banner
-- rows had it set, and the picker answered "You do not own that banner." for the other 18.
--
-- ─────────────────────────── the fix ───────────────────────────
--
-- Ownership is the owned ROW, matched by key. "Is it a banner" is the key's namespace — every
-- BANNER item in the catalog is `banner-…`, and the catalog lives in the client, so the prefix is
-- the one fact about type the server can check without a copy of it. Same owner-only gate, same
-- unconditional base hearth, same null-clears.

create or replace function set_campfire_banner(p_group_id uuid, p_item_key text)
returns void
language plpgsql
security definer
set search_path = public
as $scb$
declare
  v_owner uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in.'; end if;

  select owner_id into v_owner from groups where id = p_group_id;
  if v_owner is null then raise exception 'No such campfire.'; end if;
  if v_owner <> auth.uid() then raise exception 'Only the campfire owner can set its banner.'; end if;

  if p_item_key is not null and p_item_key <> 'banner-base-hearth' then
    if p_item_key not like 'banner-%' then
      raise exception 'That is not a banner.';
    end if;
    if not exists (
      select 1 from cosmetics_owned
      where user_id = v_owner and cosmetic_key = p_item_key
    ) then
      raise exception 'You do not own that banner.';
    end if;
  end if;

  update groups set banner_item_id = p_item_key where id = p_group_id;
end;
$scb$;

revoke execute on function set_campfire_banner(uuid, text) from public, anon;
grant execute on function set_campfire_banner(uuid, text) to authenticated;
