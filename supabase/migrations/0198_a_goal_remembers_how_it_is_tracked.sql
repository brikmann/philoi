-- 0198 — A goal remembers how it is tracked.
--
-- The create screen asks "Track it: Automatically / Log it myself", and nothing kept the answer.
-- create.tsx never sent it, createChallenge had no field for it, and `challenges` had no column to
-- hold it — only count_mode, which is a different question (manual vs lock-in TIME). So the card
-- reconstructed auto-vs-manual from the phone's live connection flag on every render: a steps goal
-- the user set to "Automatically" read "✏️ Logged by hand" whenever that flag happened to be false,
-- and a goal they set to "Log it myself" still had Health Connect stacking steps on top of their
-- hand logs, because every sync path credited every open goal of a device type.
--
-- DEFAULT TRUE, not false, deliberately. The create screen now writes the user's explicit choice
-- either way, so the default only ever applies to rows it does NOT write:
--   · goals minted server-side by a campfire challenge (0162/0183), which are that challenge's
--     counter and have always auto-synced — a false default would silently stop them the moment
--     the client starts honouring this flag;
--   · goals created by builds older than this change, which cannot send the field and have always
--     auto-synced too.
-- Both keep exactly today's behaviour. Only a goal whose owner actually picked "Log it myself" is
-- false.
--
-- Existing rows are left at the default (true) for the same reason: until now every non-custom goal
-- auto-synced regardless of what was picked, so true IS their current behaviour. `custom` has no
-- device source at all, and the card already requires a real source before it says "Auto", so the
-- value on a custom row is inert.

alter table challenges add column if not exists auto_track boolean not null default true;

comment on column challenges.auto_track is
  'The owner''s "Track it" choice. false = logged by hand only: device/Strava/Whoop/lock-in syncs skip '
  'the goal (0198). Defaults true so server-minted goals and pre-0198 builds keep auto-syncing.';

do $assert$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'challenges' and column_name = 'auto_track'
      and data_type = 'boolean' and is_nullable = 'NO' and column_default = 'true'
  ) then
    raise exception '0198: challenges.auto_track is missing or has the wrong shape';
  end if;
end;
$assert$;
