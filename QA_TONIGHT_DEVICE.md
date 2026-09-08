# Device verification — tonight's three (§1 · unboxing · tutorial)

Everything below is the half I **could not prove from here**. Each item says what is already
verified statically or against prod, so you are only checking the gap. Android build, per
`philoi_test_device_android`.

> 🔴 **The honest headline: nothing in here is device-verified.** The server halves are proven
> against prod with controls; every UI claim is `tsc` + `eslint` clean and unexercised. That gap is
> the whole reason this file exists — it is the same gap that let a relic unlock ship silently.

---

## Which build shows what

| Build | Carries | Verifies |
|---|---|---|
| **`f134e915`** (finished, off `5964b07`) | Cindy's `propose_social_challenge` handler | **§3 only** — Cindy create paths |
| ~~`9920bcf7`~~ **SUPERSEDED — do not install** | §1 · B · C, but with the tutorial/relic collision below | nothing; it burns §1's test |
| 🔴 **`b767cf1f`** — **INSTALL THIS ONE** (finished, off `4d6e58a`) | all of the above **+ §4 arena + duel-accept fix + Focus Nudge shield** | everything below |

**`b767cf1f` APK:** https://expo.dev/artifacts/eas/40okdqVa8pBtjot4fgvMkerBig4EcMhFWLgSrVzxAUQ.apk

🔴 **`9920bcf7` must not be installed, and the reason is worth knowing because it nearly cost the
§1 verification.** It shipped the new `tutorial_done` key alongside `RelicUnlockWatcher` with
nothing arbitrating between them. On its first launch the tutorial gate does a
`router.replace('/tutorial')` on the *same foreground* where the watcher raises a full-screen modal
for the one relic 0176 deliberately left unseen — and `useRevealFloor` cannot help, because it
orders reveals against other reveals and a route replace is not a reveal. Since dismissing stamps
`mark_relic_unlock_seen` and there is no second Pheidippides, tapping through that clash would have
spent §1's only non-repeatable test case. Caught before install; fixed by the seed described in §3.

`f134e915` APK: https://expo.dev/artifacts/eas/rYKkTK_uhuRK15BZaU09W9EK69BxNF4YcuQBHIzml7s.apk

⚠️ `f134e915` was cut off `5964b07` and therefore ships the **old** `FocusNudgeOverlay.kt` — the
committed one has zero references to `FocusNudgeShieldView`. That is correct for STEP 0, whose only
job was unblocking Cindy, but the shield work needs its own build later.

---

## 1 · The relic unlock (§1) — the one with a guaranteed test case

**Already proven against prod, in a rolled-back transaction with a control run confirming the
assertions actually execute:** the inbox returns exactly the owed relic and nothing else, a
non-relic cosmetic left owed does not leak in, one dismiss spends one budget and leaves the rest
queued, neither the read nor the dismiss crosses accounts, and a fresh live grant writes its bell
row, deep-links to `/trophy-hall` and leaves its own reveal owed.

**Also settled, and worth knowing because the obvious fix would have been a no-op:** the push half
was never broken. `economy_grant_relic` has notified unconditionally since 0120, and
`philoi.suppress_push` is transaction-scoped in all three places it appears and pinned nowhere at
the cluster level. Your 10h Study relic was claimed first by 0168's *backfill*, with pushes off —
so that moment was not suppressed, it was **spent**, and `economy_grant_relic` returns false for a
relic already owned.

🔴 **You have exactly one live test case and it is already loaded.** `relic-pheidippides-sandals`,
granted 2026-09-08 02:21:20Z, live, bell row unread, never celebrated. 0176's backfill stamped all
history as seen **except** earned relics from the last 24h — measured first: exactly one row across
all users falls in that window, and it is that one.

1. Install the next build, sign in, **foreground the app**.
2. → The **relic unlock reveal** should play: relic art in a gold/rarity aura, "RELIC UNLOCKED ·
   Pheidippides' Sandals", the line "50 km of Movement · rung α", a rarity sting, Share + Done.
3. **Dismiss it. Background and foreground the app again.** It must **not** re-fire.
4. Tap **Share** → the story card should read the same sentence in its pill ("50 km of Movement"),
   **not** "a 0.0% pull".
5. Check the **bell**: the row for it should deep-link to the **Trophy Hall**, not the inventory.

⚠️ **If nothing plays, the useful question is not "is the reveal broken".** Check first whether the
row is still owed:

```sql
select cosmetic_key, acquired_at, reveal_seen_at from cosmetics_owned
 where user_id = '0dafcd2b-8766-4052-83be-59de4a87fd92' and reveal_seen_at is null;
```

One row = the client never drew it. Zero rows = something already consumed it (you dismissed it, or
a second device did) and this test case is spent — you will need to cross a fresh threshold.

**Not built, deliberately, so nobody thinks it was missed:** rungs 2+ do not reveal. Only the first
unlock creates a `cosmetics_owned` row, so an upgrade keeps its "upgraded" bell notification and
nothing more. Giving rungs their own beat needs a `revealed_tier` watermark on `relic_progress` —
worth doing, not tonight.

---

## 2 · The unboxing (Workstream B)

Every box entry point already routes through `/shop/open`, so all six surfaces — shop, inventory
stack, rank-up reward row, settled challenge, completed goal, campfire crate — should behave
identically. **Check at least two different ones**, because "it works from the shop" is what a
per-surface fork would also look like.

**×1:**
1. Buildup rattles, a seam of the **box's** colour grows, then flash → lid tips and launches → ray
   field in the **item's** rarity colour → sparks → the item.
2. 🔴 **The rule to actually test:** open a **Kindling** (common crate) and get a **rare item**. The
   buildup must look identical to any other Kindling — no long wait, no rarity colour — and the
   burst must be the item's colour. If the wait telegraphs the pull, the split is wrong.
3. **Promethean waits longest** (~1.6s) regardless of what is inside; Kindling is a quick pop.
4. **Epic+ kicks the screen.** Common does not.
5. The sting fires **on the lid-off frame**, and **once** — not twice. (Two `useRevealSting` calls
   were removed; a doubled Mythic is two overlapping 5-second tails and very obvious.)

**×5 / ×10:**
6. **One** burst, then N face-down shards. Never N crate sequences back to back.
7. Every shard back is **identical** — no rarity hint before the flip.
8. Tap-through works, "Reveal all →" staggers the rest, and the **best pull spotlights at the end
   even if you flipped it first**.
9. One sting only, on the burst, at the **best pull's** rarity. Flips are a tick plus a haptic.
10. "Add all to inventory" lands on the haul grid, and the **inventory actually updates**.

**Reduce motion** (Android: Settings → Accessibility → Remove animations): crate cross-fades, no
shake, no wait; shards reveal instantly on tap but are **still tap-paced**; the sting still fires.

**Audio note:** §6 asked for new rarity stings to be sourced and uploaded. They were already in the
tree — `assets/sounds/reveal/reveal-common…reveal-mythic.mp3`, six real files with distinct
character. **Nothing to upload.** If a tier sounds wrong, it is an asset swap, not a build.

---

## 3 · The tutorial (Workstream C) — the launch gate

1. 🔴 **Fresh install / new account.** Finish username → university → consent → first campfire. The
   tour must open **immediately**, with no Home screen in between.
2. Rail shows **all 20 sections at once** under CORE / SOCIAL / COSMETIC / SETUP. Current amber,
   past muted, upcoming grey. **Tap a rail item** — it should jump.
3. Playable cards: your flame (3 steps), campfire chat, challenges, personal goals (3), Ask Cindy,
   leaderboard (3 tabs), share, cosmetics (**9 steps**), shop, crates, inventory, forge, settings.
   The 👆 hint should appear **only** where there is a next step.
4. **Ask Cindy** card, step 2: the question types itself, a typing indicator, then Cindy's reply
   types out and drops an Epic reward card.
5. **Skip** → asks once, naming what you'd miss → "Skip anyway" leaves and **does not come back on
   the next launch**.
6. **Settings → Replay tutorial** → the tour opens again.
7. Reduce-motion: the Cindy chat is already complete rather than typing; nothing else breaks.

🔴 **CHANGED SINCE THE FIRST DRAFT OF THIS FILE — existing installs no longer auto-open the tour.**
`tutorial_done` is a new key, so every existing install would have read "not done" and been replaced
into the tour on the first launch — on the *same frame* as §1's one-shot relic reveal. Two
non-repeatable acceptance tests racing for one foreground loses at least one of them.

So there is now a **one-time seed**: on the first ever boot of this build, if onboarding is already
complete, the tour is marked as already offered. Note that it is a one-time seed and **not** a rule
of the form "onboarding done ⇒ tutorial done" — that version would also suppress the tour for a
brand-new user, because `markOnboardingDone` fires the moment they create their first campfire, and
the launch gate would silently cease to exist while looking exactly like it worked. The signal that
separates the two is *when the build first ran*, not what the flags say.

**What this means for you, practically:** step 1 above (fresh install / new account) is the only way
to test the automatic gate, and it is the one that matters for the App Store. On your existing
install, use **Settings → Replay tutorial** — which is the better test anyway, because you can run
it more than once.

**Known gap:** contextual coach-marks on first visit to each real surface are **not** built. The
prompt allows this ("if coach-marks are too much for v1, ship the card tour and add coach-marks in
an OTA — but the card tour is the gate"). The card tour is the gate and it is here.

**Also not built:** the onboarding **weight** step (mock 188). `setup-handle.tsx` already collects
**height**; weight is not collected anywhere, so "scored against your own bodyweight" is currently
copy the app cannot compute. The tutorial states the policy correctly, but the input is missing —
this needs closing before the fitness flex ships for real.

---

## 4 · §3 / §3b / §4 — what I did not build

§2 and §4's client halves and the §3 sweep belong to the sibling session. Two things from it that
change what you should test:

**§2 needed no new code** — D1–D6 are wired and `groups.banner_item_id` already animates
(`campfire-banner-art.tsx`). Dead code worth a later cleanup: `campfire-header.tsx` exports
`CampfireHeader`, imported nowhere.

🔴 **A live bug it found, which changes the §3 sweep:** accepting a duel from the **row under the
feed embed** called the roster-only RPC (`respond_to_challenge_invite`) instead of
`respond_to_h2h_challenge`, so the duel never started — no `starts_at`, no `ends_at`, no baselines.
It hid because the card **above** that row has always used the correct RPC, so a pending duel showed
two Accept buttons doing different things.

**So when you sweep §3, accept at least one duel from the ROW, and assert on the SERVER, not the UI:**

```sql
select status, starts_at, ends_at from social_challenges where id = '<id>';
select user_id, state, baseline from challenge_participants where challenge_id = '<id>';
```

- Broken: `status='pending'`, both timestamps null, baselines null, roster row `accepted`.
- Fixed: `status='active'`, both timestamps set, both baselines non-null.
- **Positive control:** a collective/placement race must **not** flip to active on accept — it
  correctly waits for `start_challenge`. If it does flip, the dispatch is too broad.

**§4's server half is live** (0177): the invite payload now carries `from_user_id`, so the bell row
leads with the **challenger's avatar** instead of the generic flame, and the title names them.
Verified in prod with the control in the same transaction — the identical call one statement earlier
produced `actor_id` null. Route deliberately unchanged, so invites already sitting in a tray still
deep-link into the new arena.

---

## ⚠️ Two risks in the next build specifically

**1 · ~~First Gradle compile of the Focus Nudge shield~~ — RESOLVED, it compiled.**
`FocusNudgeShieldView.kt` and `FocusNudgeFlame.kt` (e34a840) had never been through a build; neither
Claude session wrote that Kotlin. `b767cf1f` finished successfully, so it **compiles and links**.

⚠️ Compiling is not working. Nothing about the shield's *behaviour* is verified — that it renders,
that the overlay swaps to it, that it dismisses. It is in the build and it does not break the build;
that is the entire claim. Shield behaviour is `CODE_PROMPT_focus_nudge_shield.md`'s own test pass,
not part of tonight's three.

**2 · §4 has a trap that makes a broken build look fixed.** Accepting a duel from
`SocialChallengeCard` passes whether or not the fix is present, because that path always used the
correct RPC. **The row UNDER the feed embed is the one that was broken** — accept from there, and
assert on the server, not the UI (SQL in §4 above and in `QA_PHASE1_S4_DEVICE.md`).

---

## Ledger state

169 migration files, 169 `schema_migrations` rows, head **0177**, branch pushed. `0176` and `0177`
are both live and both were applied per-file with `db query -f` + `migration repair`, never
`db push`.
