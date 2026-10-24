-- 0255 — Meme Monday goes weekly: a new drop every Monday at 06:00 Toronto time, back to back.
--
-- 0243 scheduled one drop a month (first Monday, midnight, one week) and left five of the seven
-- items unscheduled. Noah's call (2026-10-24): one drop EVERY week, live in the shop at exactly
-- 6am Eastern on Monday. So this replaces the whole schedule with seven consecutive weeks:
--
--   Mon 26 Oct  flame-meme-locked-in       Legendary 4,500   (06:00 EDT — DST ends 1 Nov)
--   Mon  2 Nov  halo-meme-rizz             Epic      2,000   (06:00 EST from here on)
--   Mon  9 Nov  flame-meme-main-character  Legendary 4,500
--   Mon 16 Nov  banner-meme-touch-grass    Epic      2,000
--   Mon 23 Nov  flare-meme-aura-1000       Legendary 4,500
--   Mon 30 Nov  halo-meme-goated           Legendary 4,500
--   Mon  7 Dec  banner-meme-caught-in-4k   Legendary 4,500   → ends Mon 14 Dec 06:00
--
-- Each window is [this Monday 06:00, next Monday 06:00), so the moment one drop ends the next is
-- live and the shop is never without one until 14 Dec. Mixed rarity, never the same slot twice in a
-- row. Each item still drops ONCE (MEME_MONDAY_model.md: exclusivity, no vault). After week seven
-- the section disappears until new items and rows are added — deliberately not a loop.
--
-- Times are written as local wall-clock in America/Toronto, so Postgres applies the EDT→EST switch;
-- the self-check pins the resulting UTC instants on both sides of it.
--
-- DATA ONLY. No function, grant or policy changes: buy_meme_drop already reads the window per row,
-- and the client (featuredDrop) already shows the live drop plus the next date. Nothing is live
-- yet at apply time (the first window opens 26 Oct), so no one can own a re-timed item.

insert into public.meme_drop_schedule (item_key, price_embers, unlocks_at, ends_at) values
  ('flame-meme-locked-in',      4500, timestamptz '2026-10-26 06:00 America/Toronto', timestamptz '2026-11-02 06:00 America/Toronto'),
  ('halo-meme-rizz',            2000, timestamptz '2026-11-02 06:00 America/Toronto', timestamptz '2026-11-09 06:00 America/Toronto'),
  ('flame-meme-main-character', 4500, timestamptz '2026-11-09 06:00 America/Toronto', timestamptz '2026-11-16 06:00 America/Toronto'),
  ('banner-meme-touch-grass',   2000, timestamptz '2026-11-16 06:00 America/Toronto', timestamptz '2026-11-23 06:00 America/Toronto'),
  ('flare-meme-aura-1000',      4500, timestamptz '2026-11-23 06:00 America/Toronto', timestamptz '2026-11-30 06:00 America/Toronto'),
  ('halo-meme-goated',          4500, timestamptz '2026-11-30 06:00 America/Toronto', timestamptz '2026-12-07 06:00 America/Toronto'),
  ('banner-meme-caught-in-4k',  4500, timestamptz '2026-12-07 06:00 America/Toronto', timestamptz '2026-12-14 06:00 America/Toronto')
on conflict (item_key) do update
  set price_embers = excluded.price_embers,
      unlocks_at   = excluded.unlocks_at,
      ends_at      = excluded.ends_at;

comment on table public.meme_drop_schedule is
  'Meme Monday drops (0243, weekly since 0255). An item is ember-buyable via buy_meme_drop only inside [unlocks_at, ends_at).';

-- ─────────────────────────── self-check ───────────────────────────

do $assert$
declare
  v_bad int;
begin
  if (select count(*) from meme_drop_schedule) <> 7 then
    raise exception '0255: expected all seven meme drops scheduled';
  end if;

  -- Every drop opens on a Monday at exactly 06:00 Toronto wall-clock time.
  select count(*) into v_bad from meme_drop_schedule
   where extract(isodow from unlocks_at at time zone 'America/Toronto') <> 1
      or (unlocks_at at time zone 'America/Toronto')::time <> time '06:00';
  if v_bad <> 0 then raise exception '0255: % drop(s) do not open Monday 06:00 Toronto', v_bad; end if;

  -- Back to back: each drop ends exactly when the next opens, and the last runs one week.
  select count(*) into v_bad from (
    select ends_at, lead(unlocks_at) over (order by unlocks_at) as next_open,
           (unlocks_at at time zone 'America/Toronto' + interval '7 days') at time zone 'America/Toronto' as week_later
      from meme_drop_schedule
  ) s
   where ends_at <> coalesce(next_open, week_later);
  if v_bad <> 0 then raise exception '0255: % drop window(s) leave a gap or overlap', v_bad; end if;

  -- The UTC instants, pinned on both sides of the 1 Nov EDT→EST switch. Discriminates a wrong zone:
  -- a UTC-4 (or UTC-5) constant would get exactly one of these two right, never both.
  if (select unlocks_at from meme_drop_schedule where item_key = 'flame-meme-locked-in')
       <> timestamptz '2026-10-26 10:00+00' then
    raise exception '0255: Locked In does not open 10:00 UTC (06:00 EDT) on 26 Oct';
  end if;
  if (select unlocks_at from meme_drop_schedule where item_key = 'halo-meme-rizz')
       <> timestamptz '2026-11-02 11:00+00' then
    raise exception '0255: Rizz does not open 11:00 UTC (06:00 EST) on 2 Nov';
  end if;

  -- Price follows rarity: Epic 2,000, Legendary 4,500.
  select count(*) into v_bad from meme_drop_schedule s join cosmetic_rarity r on r.cosmetic_key = s.item_key
   where s.price_embers <> case r.rarity when 'epic' then 2000 when 'legendary' then 4500 end
      or r.rarity not in ('epic', 'legendary');
  if v_bad <> 0 then raise exception '0255: % drop(s) priced off their rarity', v_bad; end if;
end;
$assert$;
