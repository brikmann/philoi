-- 0256 — Meme Monday opens on a flare: +1000 Aura takes week one, Locked In takes Aura's week.
--
-- Noah's call (2026-10-24): the first weekly drop should be a flare. +1000 Aura is the only one, so
-- it swaps windows with Locked In. Both are Legendary at 4,500, so no price moves. Schedule after:
--
--   Mon 26 Oct  flare-meme-aura-1000       (was Locked In)
--   Mon  2 Nov  halo-meme-rizz
--   Mon  9 Nov  flame-meme-main-character
--   Mon 16 Nov  banner-meme-touch-grass
--   Mon 23 Nov  flame-meme-locked-in       (was +1000 Aura)
--   Mon 30 Nov  halo-meme-goated
--   Mon  7 Dec  banner-meme-caught-in-4k
--
-- Still no slot twice in a row. Applied 24 Oct, before the first window opens, so no one can own
-- either item yet. Data only.

update public.meme_drop_schedule
   set unlocks_at = timestamptz '2026-10-26 06:00 America/Toronto',
       ends_at    = timestamptz '2026-11-02 06:00 America/Toronto'
 where item_key = 'flare-meme-aura-1000';

update public.meme_drop_schedule
   set unlocks_at = timestamptz '2026-11-23 06:00 America/Toronto',
       ends_at    = timestamptz '2026-11-30 06:00 America/Toronto'
 where item_key = 'flame-meme-locked-in';

-- ─────────────────────────── self-check ───────────────────────────

do $assert$
declare
  v_bad int;
begin
  if (select item_key from meme_drop_schedule order by unlocks_at limit 1) <> 'flare-meme-aura-1000' then
    raise exception '0256: the first drop is not +1000 Aura';
  end if;
  if (select unlocks_at from meme_drop_schedule where item_key = 'flare-meme-aura-1000')
       <> timestamptz '2026-10-26 10:00+00' then
    raise exception '0256: +1000 Aura does not open 10:00 UTC (06:00 EDT) on 26 Oct';
  end if;
  if (select unlocks_at from meme_drop_schedule where item_key = 'flame-meme-locked-in')
       <> timestamptz '2026-11-23 11:00+00' then
    raise exception '0256: Locked In does not open 11:00 UTC (06:00 EST) on 23 Nov';
  end if;

  -- 0255's invariants still hold: seven drops, back to back, each opening Monday 06:00 Toronto.
  if (select count(*) from meme_drop_schedule) <> 7 then
    raise exception '0256: expected seven drops';
  end if;
  select count(*) into v_bad from (
    select unlocks_at, ends_at, lead(unlocks_at) over (order by unlocks_at) as next_open,
           (unlocks_at at time zone 'America/Toronto' + interval '7 days') at time zone 'America/Toronto' as week_later
      from meme_drop_schedule
  ) s
   where ends_at <> coalesce(next_open, week_later)
      or extract(isodow from unlocks_at at time zone 'America/Toronto') <> 1
      or (unlocks_at at time zone 'America/Toronto')::time <> time '06:00';
  if v_bad <> 0 then raise exception '0256: % drop window(s) off the weekly grid', v_bad; end if;

  -- No slot two weeks running.
  select count(*) into v_bad from (
    select split_part(item_key, '-', 1) as slot,
           lag(split_part(item_key, '-', 1)) over (order by unlocks_at) as prev_slot
      from meme_drop_schedule
  ) s
   where slot = prev_slot;
  if v_bad <> 0 then raise exception '0256: the same slot drops two weeks in a row'; end if;
end;
$assert$;
