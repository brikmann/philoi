-- FIX: "cannot delete a campfire" (prod).
--
-- delete_group() itself is correct (owner check, then `delete from groups`). The delete is being
-- blocked by a foreign key pointing at groups whose ON DELETE action is NO ACTION or RESTRICT, so
-- Postgres refuses to remove the group while a child row still references it. Every groups FK in
-- schema.sql is already ON DELETE CASCADE / SET NULL, which means the offending constraint is on a
-- table that drifted into prod outside the tracked schema (same class of drift as the undocumented
-- `exercises` table found in 0249). So rather than name a table we can't see, this finds EVERY
-- restrict/no-action FK pointing at groups and converts it to ON DELETE CASCADE — which is the
-- correct semantics anyway: a campfire's dependent rows should die with the campfire.
--
-- Additive + safe: only changes delete behavior of FKs that currently block the delete; touches no
-- data. Idempotent (re-running finds nothing left to convert).
--
-- BEFORE APPLYING, eyeball what it will change (diagnostic — run this select first):
--   select con.conname, rel.relname as child_table, att.attname as column_name,
--          con.confdeltype  -- 'a'=no action, 'r'=restrict  (these are what block the delete)
--   from pg_constraint con
--   join pg_class rel on rel.oid = con.conrelid
--   join pg_class ref on ref.oid = con.confrelid
--   join lateral unnest(con.conkey) as k(attnum) on true
--   join pg_attribute att on att.attrelid = con.conrelid and att.attnum = k.attnum
--   where ref.relname = 'groups' and con.contype = 'f' and con.confdeltype in ('a','r');
-- If any row in that list is something that should NOT cascade-delete with a campfire, stop and
-- handle it by hand (SET NULL) instead of running the loop below.
--
-- LEDGER: this is 0250. Verify prod max applied + ledger first; sequential; no hand-edit; no db push;
-- apply in isolation then `supabase migration repair --status applied 0250`.

begin;

do $$
declare
  r record;
begin
  for r in
    select con.conname, rel.relname as child_table, att.attname as col
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_class ref on ref.oid = con.confrelid
    join lateral unnest(con.conkey) as k(attnum) on true
    join pg_attribute att on att.attrelid = con.conrelid and att.attnum = k.attnum
    where ref.relname = 'groups'
      and con.contype = 'f'
      and con.confdeltype in ('a', 'r')          -- no action / restrict = the blockers
      and array_length(con.conkey, 1) = 1        -- single-column FKs only (all groups FKs are)
  loop
    execute format('alter table public.%I drop constraint %I', r.child_table, r.conname);
    execute format(
      'alter table public.%I add constraint %I foreign key (%I) references public.groups (id) on delete cascade',
      r.child_table, r.conname, r.col
    );
    raise notice 'campfire-delete fix: % on %.% -> ON DELETE CASCADE', r.conname, r.child_table, r.col;
  end loop;
end $$;

commit;

-- NOTE: delete_group() does not clean up the campfire's Storage objects (banner/photos). That is a
-- separate, non-blocking improvement (call delete_storage_prefixes for the group's photo prefixes),
-- not the cause of this bug. Tracked for a later pass.
