-- 0134 (#146) — a campfire flies its OWN banner, not its owner's.
--
-- ─────────────────────────── what was wrong ───────────────────────────
--
-- campfire-header resolves the banner from the owner's equipped BANNER cosmetic, and the picker
-- sets it by calling equipCosmetic. Both halves are consistent and the result is not what anyone
-- means by "set this campfire's banner":
--
--   · an owner with two campfires flies the same banner on both, and changing it for one changes
--     it for the other;
--   · setting a campfire's banner also changes the owner's personal equipped banner everywhere
--     else it shows — a campfire decoration reaching out and restyling your profile.
--
-- The picker's own header comment called this out and chose it deliberately, because a per-campfire
-- override "would need a `groups.banner_item_id` column and is flagged for a later migration —
-- this build has none". This is that migration.
--
-- ─────────────────────────── the column ───────────────────────────
--
-- Nullable, and null is the meaningful default: it means "this campfire has never chosen", which
-- renders as the base hearth. Not backfilled to the owner's current equipped banner — that would
-- freeze today's incidental value into an explicit choice nobody made, on every campfire at once.
--
-- A plain text key rather than an FK to cosmetics_owned. The banner is a CATALOG key, and the
-- catalog lives in the client; cosmetics_owned holds one row per user per owned item, so an FK
-- would tie the campfire's decoration to one particular ownership row and break the moment the
-- owner's row is replaced. Ownership is checked at write time instead, below.
alter table groups add column if not exists banner_item_id text;

comment on column groups.banner_item_id is
  'Catalog key of the BANNER this campfire flies. Null = never chosen, renders as banner-base-hearth. Set only through set_campfire_banner, which enforces owner-only and ownership of the key.';

-- ─────────────────────────── the setter ───────────────────────────

/**
 * Set (or clear) the banner a campfire flies. Owner only.
 *
 * Three things are checked here rather than trusted from the client, on the same reasoning as #144
 * and #151 — a cosmetic that can be set by anyone who can name a group id is a cosmetic anyone can
 * put on someone else's campfire:
 *
 *   · the caller owns the campfire;
 *   · the key names a banner the OWNER actually owns — cosmetics_owned carries the slot, so this is
 *     an ownership check and a slot check at once, and it is what stops a campfire flying a mythic
 *     banner nobody earned;
 *   · null clears back to the base hearth.
 *
 * banner-base-hearth is allowed unconditionally: it is granted by DEFAULT_LOADOUT rather than owned
 * as a row, so it has no cosmetics_owned entry to find, and it is the value "clear this" resolves
 * to anyway. Refusing it would leave an owner who picked it explicitly unable to do so.
 */
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
    if not exists (
      select 1 from cosmetics_owned
      where user_id = v_owner and cosmetic_key = p_item_key and slot = 'banner'
    ) then
      raise exception 'You do not own that banner.';
    end if;
  end if;

  update groups set banner_item_id = p_item_key where id = p_group_id;
end;
$scb$;

grant execute on function set_campfire_banner(uuid, text) to authenticated;
