# Philoi — Launch Countdown to Cansbridge (Sept 5, 2026)

**Goal:** feature-complete by **~Aug 15**, then a **two-week hardening window** (QA + store review running concurrently), public/downloadable **~Sept 1**, with a 4–5 day buffer into the **Sept 5** conference.

**Guiding principle:** the deadline is a catalyst, not a guillotine. Ship the core loop *rock-solid*. A buggy demo to student founders costs more than a late one.

---

## The single critical path: Google Play

Your Play Console is a **post-Nov-2023 individual account**, so Google requires **12 testers opted in for 14 continuous days** before you can apply for production access — and production review takes a few more days on top. The 14-day clock does **not** require the final build; it just needs continuous opted-in testers on *any* installable build.

**→ Start the Play closed test THIS WEEK (by ~Aug 8), not at freeze.**
- Aug 8 start → 14 days → **~Aug 22** eligible to apply for production → review a few days → **live ~Aug 25–27**. Comfortable.
- Aug 15 start → clears ~Aug 29 → review → ~Sept 1–3. Tight, no buffer.

Everything else (iOS, the feature build) is flexible. This one has a hard floor. Treat it as item #1.

---

## Phase 1 — This week (Aug 4–8): unblock the clocks

- **[YOU] Recruit ≥12 Play testers** (friends, existing campfire testers). They must install and *stay opted in* 14 days. Line up ~15 for safety against drop-off.
- **[CODE] Cut an installable build** with the two hard blockers fixed — **#42 (gym lock-in freeze)** and **#43 (Strava flag)** — good enough to sit in the closed track. Doesn't need to be feature-complete.
- **[YOU/CODE] Open the Google Play closed testing track**, upload that build, send the opt-in link. Clock starts.
- **[YOU] Set up Resend** for uni verification: create the account and add a **verified sender domain** (DNS records — can take a day or two to propagate, so do it now, not at freeze).
- **[ME] Write the rank-rework build spec** (server `rank_tier_for_score` thresholds + client `rank-tiers.ts`: the 10-tier Primordial ladder, colors, labels, flash kinds).

## Phase 2 — Build to freeze (Aug 8–15): everything in

Hand to Code in this order (blockers already done in Phase 1):

1. **Uni verification** (#67) — Edge Functions (`send_uni_code`/`verify_uni_code`), migration, onboarding + settings screens. Depends on Resend from Phase 1.
2. **Rank rework** — apply the spec (migration + `rank-tiers.ts` + badge colors). All JS + server, no native change.
3. **PUNCHLIST_5** — home hero enlarge, challenges empty state, metric-chip swipe, header/pill offset, Strava rank-up animation.
4. **Polish pass** — spacing, empty states, copy, the loop end-to-end.

Keep pushing these builds into the Play closed track as they land — the 14-day timer keeps running underneath.

**Explicitly cut from launch scope:** **Whoop (#39)** — externally blocked on your friend's credentials. Ship everything else; don't let one blocked integration hold the date.

## Phase 3 — Freeze + submit (Aug 15–17)

- **Feature freeze Aug 15.** No new features after this — only bug fixes.
- **[iOS] Submit to App Store review** (~2–7 days). Use TestFlight *internal* testing (instant, no review) for your own QA in parallel.
- **[Android] Confirm the closed test has hit its 14 days**, apply for production access, submit the production build.
- **[BOTH] Store listing assets** — icon, screenshots, description, privacy policy URL, age rating, Play **Data safety** form + Apple **privacy nutrition labels**. These are the classic last-minute stallers — prep them now.

## Phase 4 — Harden (Aug 17–29)

- Full-loop QA across a device matrix: lock-in (manual + Strava + Health Connect), campfires, challenges, rank-up celebration, shop/inventory, uni verification, onboarding.
- Watch crash/error reporting. Fix-forward via **EAS OTA update** where possible (JS-only fixes need no re-review — a big advantage of this window).
- Daily smoke test of the exact demo path you'll show at the booth.

## Phase 5 — Go-live + buffer (Aug 29 – Sept 4)

- Public listings live on both stores (~Sept 1 target).
- **QR codes** for the booth → store listings (and a TestFlight fallback link in case a store review slips).
- Freeze the OTA channel 48h before the conference; do a final on-device install-from-store dry run.
- One-line install instructions + the pitch's "download now" moment rehearsed.

## Sept 5 — Cansbridge

Working, validated, downloadable app in hand. The seed for the multi-campus flywheel.

---

## Open dependencies / risks

| Risk | Mitigation |
|---|---|
| Play 14-day clock started late | **Start this week** with a rough build; #1 priority |
| Testers drop opt-in mid-test | Recruit ~15, not 12; remind them to keep it installed |
| Resend domain verification lag | Set up in Phase 1 (DNS propagation) |
| "Everything" scope slips past Aug 15 | Blockers + uni + rank are the must-haves; PUNCHLIST_5 polish can OTA post-launch if needed |
| App Store rejection | Submit Aug 15–17 for reject-and-resubmit room; TestFlight is the fallback demo channel |
| Play account is actually individual (confirmed post-2023) | Confirmed — no path around the 14-day test; hence Phase 1 urgency |
