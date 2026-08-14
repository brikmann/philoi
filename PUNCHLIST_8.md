# Punchlist 8 — shop bugs (on-device pass)

Four issues from testing the live shop. Three are wiring/logic and ship OTA; #4 (crash) needs a
stack trace to close for certain. Real-money purchase screen stays deferred to RevenueCat (#71).

---

## 1 · 🔴 CRITICAL — ×10 Promethean vault crashes at the results screen
**Repro:** open 10× Promethean → deal/"spinning" animation plays → lands on the results screen → app
crashes.

**Status:** could not pin the exact line from static review — the render guards in `MultiMenu`
(`open.tsx`) and `bestOf` are in place, so I need the real error.

**First: get the stack trace.** Reproduce with Metro/logcat attached and paste the exact error +
top frames (`adb logcat *:E` on Android, or the red-box text). That decides the fix.

**Ranked hypotheses to check while grabbing it:**
1. **`open_loot_box` rarity/pool contract mismatch (most likely culprit).** Client `openBox`
   (`src/lib/api/inventory.ts:79`) sends the FULL cross-rarity pool as `p_pool`. The SQL
   (`0064`, `open_loot_box`, line ~441) does `select p from unnest(p_pool) order by random() limit 1`
   — it picks a random id from the ENTIRE pool **without filtering to the rolled `v_rarity`**, then
   grants it labeled with `v_rarity`. So `rolled_rarity` and the item's true catalog rarity can
   disagree. Over 10 draws this fires often, and any downstream code that indexes a rarity map by the
   *wrong* rarity (or a `getItem` miss) can throw. Fix the contract: either (a) pass `p_pool` as a
   rarity→ids map and have the SQL pick from the rolled rarity's bucket, or (b) filter `unnest(p_pool)`
   by joining to the catalog rarity server-side. The server must still own the roll.
2. **`UnlockShareCard` rendered off-screen** in `MultiMenu` — captures a ref + renders every haul
   item's `ItemArt`. If any `haul` item resolves to a kind not in `shapeFor`'s switch (no `default`
   case → returns `undefined`), confirm RN-SVG tolerates it; add a `default` return anyway.
3. **`shapeFor` has no default case.** Add one (return a neutral placeholder) so an unexpected
   `art.kind` can never return `undefined` into `<Svg>`.

Once the trace is in hand, fix the true cause and add a guard so a single bad pull can't take down the
whole results grid.

---

## 2 · 🟠 Buy Direct reshuffles the WHOLE row on every purchase (should be a weekly cadence)
**Root cause (confirmed):** `shop/index.tsx` builds `featured` from the **owned-filtered** pool:

```
const pool = boxPool().filter((i) => !ownedKeys.has(i.id));
const offset = WEEK_INDEX % pool.length;
featured = Array.from({length: 5}, (_, i) => pool[(offset + i*7) % pool.length]);
```

Buying an item removes it from `pool` → `pool.length` changes → `offset` changes → the entire row
re-indexes. The weekly seed is fine; the pool it indexes into is unstable.

**Fix:**
- Seed the weekly pick off the **full, stable** box pool (`boxPool()`, NOT owned-filtered). Pick the 5
  deterministically from `WEEK_INDEX` so the set is identical for the whole week regardless of what
  the user owns.
- Render an owned featured item as **"Owned"** / sold-out in place — don't drop it from the indexing.
- Add a visible **"Rotates in Xd Xh Xm"** countdown to the next weekly boundary. Next rotation =
  `(WEEK_INDEX + 1) * 7 * 24 * 60 * 60 * 1000`; tick it down live. Replace the static
  "Rotates weekly" label on the section header.

---

## 3 · 🟠 Purchase confirmation is a generic Android alert; inventory doesn't reflect the buy
**Confirmed:** `shop/item/[itemId].tsx:48` does `Alert.alert('Bought', '${item.name} is in your
inventory.')` — the generic OS dialog you saw.

**Fix:**
- Replace with the in-app reward sheet/toast (same visual language as a box reveal — item art +
  rarity + name), not an OS alert.
- **Refetch inventory after any purchase.** `buyCosmetic` doesn't invalidate the `useInventory` cache,
  so a freshly bought item won't appear until a cold reload. Invalidate/refetch on buy success (and on
  inventory-screen focus).
- **Confirm the inventory is reachable.** The data path IS wired — `get_inventory` (`0067`) returns
  `cosmetics` from `cosmetics_owned`, `use-inventory.ts` maps them, and `inventory/index.tsx` renders
  the owned grid. But the only route into `/inventory` today is "Collect all → Inventory" after a box
  open. Add a persistent entry point (shop header + profile) so "no inventory" isn't the user's
  experience. Verify a bought item shows in the Owned grid after the refetch fix.

---

## 4 · 🔵 Deferred — real-money purchase screen
The Buy Embers / Forge Pass real-money path stays on the "coming soon" stub until the RevenueCat
native build (**task #71**). No OTA work here; just confirming it's intentionally deferred, not
missed.

---

---

## 5 · 🟠 One shared "week" helper — all weekly timers start Sunday
Right now every weekly reset is on a **different day** because each one rolls its own math:

- **Shop** (`shop/index.tsx:21`) — `floor(Date.now() / week)` is anchored to the Unix epoch, which
  was a **Thursday** → shop resets Thursday.
- **Weekly recap / challenges** (server `0002`, etc.) — `date_trunc('week', now())` is ISO week →
  **Monday**, in the DB session timezone.
- **Forge Pass weekly** (`lib/api/forge-pass.ts:61`) — `floor((now − seasonStart) / week)` → rolls on
  whatever weekday the season started. Its label even reads "resets Mon" (`forge-pass.ts:155`).

Make them all use **one shared helper, anchored to Sunday 00:00 UTC.** (UTC, not local: weekly
challenges are shared between friends who may be in different timezones — the window must close at the
same instant for everyone, or a shared challenge would end at different times per member. A countdown
like "6d 4h" is timezone-agnostic regardless.)

**Client — new `src/lib/time/week.ts`:**
```ts
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
// 259_200_000 = Sun 4 Jan 1970 00:00 UTC — the first Sunday after the epoch (a Thursday).
const SUNDAY_ANCHOR_MS = 3 * 24 * 60 * 60 * 1000;

export const weekIndex     = (now = Date.now()) => Math.floor((now - SUNDAY_ANCHOR_MS) / WEEK_MS);
export const weekStart     = (now = Date.now()) => SUNDAY_ANCHOR_MS + weekIndex(now) * WEEK_MS;
export const nextWeekReset = (now = Date.now()) => weekStart(now) + WEEK_MS;
export const msUntilReset  = (now = Date.now()) => nextWeekReset(now) - now;
```
(Verified: for any `now`, `weekStart` lands exactly on a Sunday 00:00 UTC and `nextWeekReset` is the
following Sunday 00:00 UTC.)

**Server — one SQL helper, same boundary:**
```sql
create or replace function week_start(p_ts timestamptz default now())
returns timestamptz language sql immutable as $$
  -- Sunday 00:00 UTC — matches src/lib/time/week.ts. date_trunc('week') is Monday-based,
  -- so shift +1 day before truncating and −1 day after to land on Sunday.
  select (date_trunc('week', (p_ts at time zone 'UTC') + interval '1 day')
          - interval '1 day') at time zone 'UTC';
$$;
```
Replace the bare `date_trunc('week', now())` cutoffs (weekly recap, contribution counts, etc.) with
`week_start()`, and use it for any weekly challenge `ends_at`/reset.

**Migrate the call sites:**
- Shop featured: `WEEK_INDEX` → `weekIndex()`; drive the "Rotates in Xd Xh" countdown (#2) off
  `msUntilReset()`.
- Forge Pass `periodKeyFor('weekly', …)` → key off `weekIndex()` instead of season-start weeks; change
  the "resets Mon" label to "resets Sun".
- Weekly challenge/recap windows → `week_start()`.

---

## Ship
#1–#3 and #5 are JS/SQL → OTA (the `open_loot_box` fix and the `week_start()` helper are migrations).
#1 is the highest priority — a hard crash on the flagship box; get the trace first, then fix the
contract. #5 is a small, cross-cutting cleanup that makes every weekly reset land on the same Sunday
instant.
