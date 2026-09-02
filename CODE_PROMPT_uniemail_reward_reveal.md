# Code Prompt — two device-smoke fixes: one-email-per-account + reward reveal graphics

Two bugs found on the wave build. #1 is a real integrity hole (server + migration). #2 is client-side graphics/state. Branch off the current wave branch (`worktree-focus-nudge`).

Passive walking *counting* toward the distance relic is intended (Noah's call). The 90-day **backfill** is NOT — see §4, it instant-unlocks the whole ladder on a fresh account.

---

## 1 · 🔴 A university email can verify unlimited accounts — must be one-email-per-account

`supabase/functions/verify_uni_code/index.ts` marks the caller verified with:
```ts
await admin.from('profiles')
  .update({ university_email: email, university_email_verified: true })
  .eq('id', user.id);
```
There is **no uniqueness check and no DB constraint** — `0062` only adds the `university_email` / `university_email_verified` columns. So the same campus email verifies every account that enters it. `email` is already normalized (trim + lowercase, line 25).

**Fix — defence in depth, both layers:**

**(a) DB constraint (authoritative) — new additive migration.** A partial unique index so two *verified* profiles can never share an email, case-insensitive:
```sql
create unique index if not exists profiles_unique_verified_university_email
  on profiles (lower(university_email))
  where university_email_verified is true;
```
Before creating it, **find existing duplicates** (the bug is live, so prod may already have them) and report them — do not silently drop anyone's verification. List `lower(university_email)` having `count(*) > 1 where university_email_verified`, hand Noah the list, and only then decide whether to keep the earliest and unverify the rest. The index creation will FAIL if dups exist, so this is a required pre-step.

**(b) Pre-check + conflict handling in `verify_uni_code`.** Before the update, reject if the email is already verified on a different user:
```ts
const { data: taken } = await admin.from('profiles')
  .select('id')
  .eq('university_email_verified', true)
  .ilike('university_email', email)   // email is already lowercased; ilike keeps it case-insensitive
  .neq('id', user.id)
  .maybeSingle();
if (taken) return json({ error: 'This school email is already linked to another Philoi account.', reason: 'email_taken' }, 409);
```
And treat a unique-violation on the `update` (a race between two verifications) as the same clean 409, not the generic 500 — inspect the PostgREST error code (`23505`) and return the `email_taken` message.

**(c) Client copy.** Wherever the verify screen handles errors, surface the `email_taken` reason with the friendly line rather than a generic failure.

**Done =** the same campus email verifies exactly one account; a second attempt returns "already linked to another account"; the unique index exists and prod dups (if any) were surfaced and resolved with Noah before it was created.

---

## 2 · 🐛 Reward reveal: no/broken burst animation + balance doesn't refresh

Completing a goal (Noah's repro: a 10k-step goal) awards embers **server-side**, but on screen: the burst animation doesn't play (or renders broken) AND the ember balance doesn't update until a reload.

**Two independent defects — fix both:**

**(a) The burst doesn't fire on the goal-completion surface.** The only place `RewardBurst` fires today is the lock-in DONE recap:
```ts
// src/app/lock-in/index.tsx ~223
useEffect(() => { if (posted && !rankUpInfo) rewardBurstRef.current?.fire(); }, [posted, rankUpInfo]);
```
A step-goal completion very likely does **not** flow through this screen's `posted` state — step/goal credit lands via the check-ins trigger / goal-completion path (see #66, `check_ins` trigger), not the manual Stop → done recap that mounts `<RewardBurst>`. So no burst is mounted on the surface where the award actually surfaces → nothing plays. Trace where a goal completion is confirmed to the user and **mount + fire a reveal there** (reuse `RewardBurst` with `cue="settle"`, or a dedicated reward-reveal), gated so it fires once per award. While there, verify `assets/lottie/bloom.json` actually renders (the "broken animation" report) — if bloom is the culprit, fix or swap the asset.

**(b) The visible balance doesn't refresh after an award.** `EmberPill` (`src/components/economy/economy-bits.tsx`) is **prop-fed** — it renders whatever balance its parent fetched (home header, shop, etc.). Nothing re-fetches that balance when embers are granted, so it stays stale until the screen remounts. Add a single source of truth that the award path invalidates: after any ember-granting action resolves, invalidate/refetch the wallet/balance query (or bump a shared balance store) so every mounted `EmberPill` updates. The home header balance is the one Noah watched not move — make sure that surface subscribes to the refresh.

**Guardrails:** don't reward twice — the burst is presentation only; the grant already happened server-side, so the reveal must read the authoritative new balance, not add locally. Reduce-motion still suppresses the animation (existing behavior in reward-burst.tsx). Client-only, OTA-able.

**Done =** finishing a goal shows the burst once and the on-screen ember balance updates immediately, no reload; the animation renders correctly (not a blank/broken box).

---

## 3 · 🐛 Onboarding height-estimation step never renders (client UI missing)

The height step that estimates stride length (which feeds `stride_m_for` → the steps→distance relic) doesn't show because **the client UI was never built.** Everything else exists:
- `profiles.height_cm` column + check constraint (0119)
- `stride_m_for(user)` = `height_cm/100 × 0.42`, fallback `0.75` m (0119)
- `set_my_height_cm(p_height_cm)` RPC (0119) and the client wrapper **`setMyHeightCm(heightCm)` in `src/lib/api/relics.ts`** — which is **never called from any screen.**

So no screen ever collects height; every user gets the 0.75 m fallback stride, and Noah's "height estimation didn't render" is simply that the step doesn't exist in the flow.

**Fix (client):** add the height-estimation step to onboarding. The flow lives in `src/app/setup-handle.tsx` — one screen, local `step` state (currently 1 username · 2 school · 3 campus verify · 4 done; see the `Step` type and `const [step, setStep]`). Insert a height step that calls `setMyHeightCm`. Match whatever mock scoped it (search `design-mocks/` for the height/onboarding mock — likely the onboarding sheet, e.g. `17-onboarding.html` or a dedicated one; if none exists, flag it and build a clean estimator).

Requirements:
- **Optional / skippable** — the server already treats height as optional (0.75 m fallback), so the step must be skippable and never gate onboarding. Skipping just keeps the default.
- Unit-friendly input (cm and ft/in), validated to the column's `50 < height < 260` cm range; convert ft/in → cm before the RPC.
- Persist via `setMyHeightCm`, then advance. Pre-fill from `profile?.height_cm` if already set (so re-entering onboarding shows the saved value).
- Frame it honestly per the copy intent: it *estimates* stride for the movement/distance relic; it's not required.

**Done =** onboarding shows a skippable height step; entering a height persists to `profiles.height_cm` and changes `stride_m_for` (distance relic recalculates on the next step sync); skipping leaves the 0.75 m default.

---

## 4 · 🔴 Distance relic instant-unlocks on a fresh account (90-day step backfill)

A brand-new account **immediately unlocks Pheidippides' Sandals** on connecting Health Connect. Cause: `src/lib/step-ladder-sync.ts` uses `FIRST_RUN_DAYS = 90` — the first sync pulls **90 days of the phone's step history** (which exists independent of when the Philoi account was created) into `user_step_days`. The distance ladder sums `total steps × stride`, so 90 days of walking (≈500km for a normal person) blows past every rung including the mythic 414km — the relic is fully earned before the user has done anything in Philoi.

**Decision (Noah):** passive walking should still count going forward, but pre-Philoi history should not. So make the step ladder **forward-only**.

**Fix:**
- In `step-ladder-sync.ts`, drop the backfill: set the first-run window to **today only** (e.g. `FIRST_RUN_DAYS = 1`) so a first connect seeds only the current day, and ongoing syncs (the trailing `WINDOW_DAYS = 7`) accrue from there. Walking done *after* connecting counts; the phone's back-catalogue doesn't.
- Consider anchoring "day 0" to the connect timestamp rather than a rolling 7-day window, so a later gap can't retro-pull days from before the user connected. At minimum, never sync a day earlier than the first-connect date — persist that date (SecureStore) and clamp the window's start to it.
- **Already-inflated accounts:** `relic_progress.tier` is a high-water mark that never falls, and `user_step_days` already holds backfilled rows for anyone who connected under the old code — Noah's test accounts included. So this fix stops *new* inflation but won't un-inflate existing ones. Flag whether Noah wants a one-time cleanup: delete `user_step_days` rows dated before each user's connect date, then re-evaluate relics. Do NOT run that without his sign-off (it lowers people's ladders). For his own testing he can wipe his `user_step_days` + `relic_progress` and reconnect.

**Done =** a fresh account that connects Health Connect starts the distance relic at ~0 (today's steps only), and it accrues forward as the user walks — no instant unlock from phone history.

---

## 5 · 🔴 Challenge rewards land but never celebrate (no reveal watcher)

Confirmed with Noah: when a challenge settles, the reward **does** arrive (embers/box in inventory, feed row) — but **no reveal or animation ever plays.** Cause: challenge settlement is async server-side (`pg_cron` finalize / placement settlement, 0127), and there is **no client watcher that plays a celebration when the user next opens the app.** `challenges.tsx` only reveals goal-*streak* rewards; nothing covers a settled H2H/placement/group challenge. Rank-ups have exactly this (`RankUpWatcher`); challenges don't.

**This is reveal-only. The grant already happened — do NOT re-award.**

**Fix — a challenge-settlement reveal watcher, modeled on `src/components/rank-up-watcher.tsx`:**
- `RankUpWatcher`'s pattern: fetch current state, compare against a **locally-persisted "last seen"** marker, celebrate the delta, write the new marker. No server "seen" column needed — mirror this.
- Data source: `get_my_social_challenges()` already returns the user's challenges with outcome + payout. Confirm it exposes settled state (outcome won/lost/settled, `settled_at`, the reward). If the payout amount/box isn't in its output, extend the RPC (additive migration, wave rule — restate nothing) so the reveal can show the real reward.
- New global component (mount in `_layout.tsx` alongside `RankUpWatcher`): on mount and on app-foreground, fetch settled challenges, find any whose id is **not** in a locally-persisted "already celebrated" set (AsyncStorage, keyed by user, cleared on sign-out like `clearStepLadderSyncState`), and for each play the reveal, then add its id to the set.
- Reveal UI: reuse what exists — `RewardBurst cue="settle"` for the burst, and the payout screen (`GoalStreakRewardScreen` / mock 103) or the placement percentile result screen (mock 114) for the full reward moment. Queue multiples so two settlements while away don't clobber each other (RankUpWatcher already handles a pending/queue — follow it).
- Order it after rank-up if both are pending, so celebrations don't stack on the same frame.

**Guardrails:** idempotent — a celebrated challenge never re-fires (that's the persisted set). Never grant here. Respect reduce-motion (RewardBurst already does).

**Done =** finishing a challenge (or reopening the app after one settled while away) plays the reward reveal once, showing the actual embers/box won; it never replays on later opens.
