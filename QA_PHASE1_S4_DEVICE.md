# §4 — device test script (the "someone challenged YOU" moment)

Scope: **§4 only** (`CODE_PROMPT_loop_signoff_meta.md`). §1 is `philoi-app-17`'s lane and has its own
verification; §2 needed no new build (see the last section).

Every item says what was **already proven statically or against prod**, so you are only checking the
gap. Android build, per `philoi_test_device_android`.

---

## Before you start

### The build must carry the §4 commit

🔴 **The STEP 0 build cut off `5964b07` does NOT contain any of this.** That build exists to unblock
Cindy's `propose_social_challenge`, nothing else. §4 needs a build off the commit carrying:

```
src/components/incoming-challenge-sheet.tsx      (new)
src/app/challenge-info/[challengeId].tsx         (presents it)
src/lib/api/challenge-lifecycle.ts               (answerChallengeInvite — the RPC fix)
src/components/challenges-tab.tsx                (uses it)
src/components/circle-timeline.tsx               (uses it)
```

### No migration is required

`challenge_invite` has routed to `/challenge-info/[challengeId]` since **0088**, and that mapping is
already baked into every invite push in the wild. The moment presents **on top of** that existing
route, so every notification already sent deep-links into it with no server change.

The one server-side improvement that is still **open** (handed to `philoi-app-17`, not required for
these tests): `create_h2h_challenge` passes no `from_user_id`, so `notify_push` resolves
`v_actor = null` and the bell row leads with the generic flame instead of the challenger's avatar.
Verified in prod — all 4 `challenge_invite` rows have `actor_id` null and the title
"You've been challenged". **Expect a generic icon on the notification until that lands.**

### Two accounts

A = you, B = a second account. A and B must be **friends** (a duel is friend-to-friend).

---

## 1 · 🔴 THE HEADLINE — accepting a duel from the feed/tab actually starts it

This is a **live bug fix**, not new UI, and it is the most important thing to verify.

**What was wrong.** There are two respond RPCs and they are not interchangeable:

| RPC | What it does |
|---|---|
| `respond_to_challenge_invite` | updates `challenge_participants.state` and **nothing else** |
| `respond_to_h2h_challenge` | sets `status='active'`, `starts_at`, `ends_at`, **and both baselines** |

A duel has no admin and no separate start step — accepting **is** the start. But
`ChallengeAcceptRow` in both the challenges tab and the campfire feed called the **roster-only** RPC
for every shape. Accepting a duel there left it `pending` forever: no `starts_at`, no baselines,
nothing for the settle sweep to score.

It hid because `SocialChallengeCard` — rendered directly **above** that row — has always had its own
Accept wired to the correct RPC. A pending duel showed **two Accept buttons doing different things**.

Statically verified: both live RPC bodies read from prod `pg_proc`; prod shows all 9 declined and
all 5 completed duels carry challenge-level state that **only** `respond_to_h2h_challenge` writes —
i.e. every duel that has ever worked went through the card, never the row.

**The test — you must use the ROW, not the card:**

1. B challenges A to a duel (any metric, short window).
2. On A's phone open the **campfire feed** (or the campfire Challenges tab) and find the challenge
   embed. Scroll to the **Accept/Decline row underneath the card** and press **Accept** there.
3. Then run, with that challenge's id:

```sql
select status, starts_at, ends_at from social_challenges where id = '<id>';
select user_id, state, baseline from challenge_participants where challenge_id = '<id>';
```

✅ **Pass:** `status='active'`, `starts_at` and `ends_at` both non-null, and **both** participant
rows have a non-null `baseline`.

❌ **The old bug:** `status='pending'`, `starts_at` null, baselines null — while the roster row still
says `accepted`. If you see this, the build does not have the fix.

> **Positive control** (so a green tick can't be green for the wrong reason): repeat with a
> **collective/placement** challenge. It must still go the roster-only path — `status` stays
> `draft`/`pending` until an admin presses **Start the race**, and that is *correct*, not a
> regression. If the group race also flips to `active` on accept, the dispatch is wrong in the other
> direction.

---

## 2 · The arena — being challenged reads as a moment

Statically verified: `tsc --noEmit` and `eslint` clean; the duel gate is `my_state === 'invited' &&
isDuel(c)`.

1. B challenges A. On A's phone, open the challenge from the **notification** (see §3) or by tapping
   through to challenge info.
2. Expect a **full-screen** arena, not a row:
   - "YOU'VE BEEN CHALLENGED" over "**[B] has challenged you**" — B named, not "New challenge".
   - **B's avatar at 84px** on the left, yours on the right with a coral ring, **VS** between them.
   - The two faces **slide in from their own edges and meet** on present.
   - The goal in the challenge's own words, and the stakes ("+N XP to the winner").
3. Press **Accept the challenge** → the two faces **strike together** once, then the sheet resolves
   and drops you on the rules screen with the race now live.

### The clock is deliberately conditional — check the right one

`create_h2h_challenge` leaves `starts_at`/`ends_at` **null** while pending, so most invites have no
instant to count to. Rendering `formatTimeLeft(null)` would print **"Ended"** under a live clock,
telling the receiver they'd already missed it.

- **Ordinary duel invite** (`ends_at` null) → expect a **static** "24-hour race" with an hourglass.
  🔴 If you ever see the word **"Ended"** on an invite you were just sent, that is the failure this
  branch exists to prevent.
- **Fixed-span duel** (a custom `starts_on`/`ends_on`, `ends_at` set) → expect a **live** "…left"
  ticking down once per second with a clock glyph.

---

## 3 · The notification opens the moment

1. Fully background (or kill) A's app.
2. B challenges A.
3. A gets a push — currently **"You've been challenged"** with a **generic flame** icon (see
   "Before you start"; the avatar/🔥 copy is the open server-side item).
4. Tap it → lands on challenge info **with the arena presented over it**.
5. Dismiss the arena with the ✕ → the full rules stay underneath. The notification's promise is kept
   either way.

---

## 4 · Decline is graceful

1. B challenges A. A opens the arena and presses **"Not this time"**.
2. Expect: **no confirmation alert**, no red destructive styling — it is an ordinary answer. The
   sheet closes and A is returned back out.
3. Verify: `select status from social_challenges where id='<id>';` → **`declined`** (challenge-level,
   which only the h2h RPC writes — this is the decline half of §1's fix).

---

## 5 · A failed accept says why

Hard to force naturally; the honest way is to make the invite stale.

1. B challenges A. A opens the arena but does **not** answer.
2. B **cancels** the challenge.
3. A presses **Accept**.
4. ✅ Expect a visible red line in the sheet — "Challenge not found or already answered." The button
   must not silently do nothing. (This is the exact R5 fault the old row was built around; a
   full-screen moment that swallows it is worse than the row it replaced.)

---

## 6 · Reduce motion

Turn on **Settings → Accessibility → Reduce motion**, then open an invite.

- The faces and VS appear **already in place** — no slide, no strike on accept.
- Everything else (copy, stakes, both buttons) is identical and fully functional.

---

## 7 · Nothing else regressed

- **Group / collective / placement invite** → still the inline **ChallengeAcceptRow**, no arena.
  Mock 175's card is a two-fighter composition and has nothing to draw for a 12-person race.
- The **card's own** Accept (directly above the row) still works and now does the **same** thing as
  the row for a duel. Two buttons is a cosmetic redundancy, deliberately **not** removed in this
  pass — worth a follow-up decision, but with the RPC fixed they no longer diverge.

---

## §2 (campfire UI + animated banners) — verified as already shipped, no new code

Checked rather than assumed, statically:

| Item | State |
|---|---|
| D1 banner full-bleed | `group/[groupId]/index.tsx:184` renders `<CampfireBannerArt variant="screen" animated />` |
| **Animated banner** (#146) | `campfire-banner-art.tsx` is 1367 lines of phased reanimated loops keyed off `groups.banner_item_id` — already motion, not a static image |
| D2 + FAB | `circle-timeline.tsx:774` `<CampfireFab …/>`, bottom-right |
| D3 multi-photo | `MAX_PHOTOS_PER_POST = 10`, `PhotoViewer` wired |
| D4 shared lock-in | `circle-timeline.tsx:501` real `<LockInEventCard/>` |
| D5 ping delivery | `PingMemberSheet` wired; migration **0172** live |
| D6 reactions | `set_message_reaction` + live `subscribeToReactions`; migration **0171** live |

**One piece of dead code found, not removed:** `src/components/campfire-header.tsx` exports
`CampfireHeader`, which is **imported nowhere** — the campfire screen draws its own chrome. Harmless,
but it is a second banner implementation that will drift from the real one. Worth deleting in a
cleanup pass; left alone here because deleting a component is outside a device-verification lane.
