-- 0117 — the column comment still promised MINUTES.
--
-- 0061 wrote `count_mode`'s comment when the credit really did accrue minutes; 0113 changed the
-- unit to hours (the create screen forces `unit = 'hours'` and states it, so the target was always
-- hours and the credit was 60x too generous), and 0116 hung the goal-day drip off the same path.
-- The comment is the first thing anyone reads off `\d challenges`, so leaving it saying "minutes"
-- points the next reader at exactly the bug that was just fixed.
--
-- Comment-only. No behaviour, no data.

comment on column challenges.count_mode is
  'manual = a number the user logs. lockin_time = HOURS accrue from lock-ins whose goal detail matches this goal''s label, credited by the AFTER INSERT trigger on check_ins (0113) which also fires the goal-day drip on completion (0116). Only meaningful for type = ''custom''; every built-in metric has its own source.';
