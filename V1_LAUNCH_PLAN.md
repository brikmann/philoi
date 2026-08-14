# Philoi — V1 Launch Plan (fastest path to iOS) + GTM

## The core GTM insight (from the Laurier IT research)
Laurier's "formal vetting" is a **third-party privacy & security risk assessment**, triggered when an
app becomes an **official Laurier tool** — embedded in a course, or run by a department. As a public
Ontario university, Laurier is bound by **FIPPA** (privacy law) + its Information Security Policy (9.4)
and Use of IT policy (9.1), so anything official that touches student data gets a privacy impact
assessment, a security review, an intake questionnaire (what data, where hosted, safeguards), likely a
data-processing agreement, and then it's added to the Approved Software Catalog. **Timeline: weeks to
months**, and yours stores student personal info (uni-email verification, usage), so it lands on the
higher-scrutiny end.

**BUT:** this only triggers for *official* channels. A student **voluntarily downloading a consumer app
on their own phone is NOT subject to any of it** — it's just an app they chose to use. That reframes the
entire GTM ranking: the grassroots routes have zero vetting; only the "official Laurier endorses/
integrates this" routes do.

## GTM ranking — effectiveness × feasibility (what to do first)
Ranked by ratio of impact to effort *right now*:

1. **Gym table, founder-led (DO FIRST).** Sit at the athletic-complex desk with a big poster + a QR
   code, "built by me → " arrow pointing at you, answer questions live. Effectiveness: HIGH — it hits
   your exact ICP (gym-goers = activity-trackers), the founder story converts, and people pass it
   twice a day (in + out). Feasibility: HIGH — needs only a facilities/tabling permission, **no IT
   vetting**. Best ratio on the board.
2. **Residences — grassroots version.** Work through res life / dons / floor reps and pitch
   inter-residence competition (perfect product fit for a social-accountability app). Effectiveness:
   MED-HIGH — dense, social, competitive. Feasibility: MEDIUM — a *light* community version avoids
   vetting; a full official Dept-of-Residence program would trigger it. Do the light version now,
   pursue the official one as a slow parallel.
3. **Lecture pitch — light version.** A 2-minute "I built this, here's the QR, download it" *guest
   announcement* is very different from *integrating the app into the course*. The announcement may
   avoid full vetting (students download voluntarily); the integration definitely triggers it (your
   prof's response). Effectiveness: HIGH reach. Feasibility: LOW-MED — still needs the prof to grant
   class time + dept comfort. Push for the announcement framing, not integration.
4. **Posters alone.** Effectiveness: LOW (posters convert terribly), Feasibility: HIGH. Use as *support*
   — QR posters that reinforce the gym table — not a standalone channel.

**Play:** run grassroots (1, 2-light, posters) to build real users + proof *now*, while the slow
official channels (course/residence integration → IT vetting) grind in the background. Never block
launch or spreading on the vetting timeline.

---

## Fastest path to iOS — two tracks
**Track A — TestFlight (days, NO real revenue).** The fastest way to get Philoi into people's hands on
iOS. Internal testers are instant; up to 10k external testers pass a light Beta App Review. Perfect for
the summer-end push, the gym table, and Cansbridge. Caveat: **IAP only runs in sandbox on TestFlight —
no real money changes hands.**

**Track B — App Store release (weeks, real revenue).** Full App Store review + approved IAP. This is the
only way to actually **sell the Forge Pass**. Needs RevenueCat wired and the polish below.

**Recommendation:** ship to **TestFlight now** to start spreading + collecting feedback (free), and run
the **App Store v1 as the revenue launch** in parallel. Don't make spreading the word wait on the store
timeline.

## Critical path to a real App Store v1 (ordered)
1. **DEPLOY the migration batch (0062–0070) — do this first.** Still pending; it's blocking equip, box
   opens, and is a prime suspect for the **challenges-not-resetting** bug (0068 + the week-boundary
   logic). Run `DEPLOY_migrations_0062-0070.sql` in the SQL editor. Nothing else works right until this
   lands.
2. **Kill the launch-blocking bugs:** challenges reset (diagnose — likely the Sunday week-helper +
   deploy, PUNCHLIST_8 #5), ×10 vault crash (#74), Buy Direct rotation (#75), inventory wiring (#76).
3. **RevenueCat native build (#71):** Forge Pass subscription + ember packs as StoreKit IAP, **purchase
   success screen**. This one native EAS build can also carry the Live Activity pill (#87) if you want
   it in v1 — otherwise defer the pill to v1.1.
4. **Forge Pass de-slop:** properly rescope the battle pass (reward ladder, tiers, visual language) so
   it stops reading as AI slop.
5. **Cosmetics wired for real:** shop art + inventory + equip loop (PUNCHLIST 7/10/12/13). This is the
   free retention loop — it belongs in v1.
6. **Default cosmetics** (below).
7. **App Store Connect:** app record, privacy nutrition labels, screenshots, IAP products submitted,
   review.

## Default cosmetics — free retention ("Fortnite default skin") [NEW]
Every user starts with a **base loadout equipped from day one** so the cosmetic system feels alive
immediately (never empty) and creates upgrade desire:
- **Flame:** basic orange flame (default flame icon)
- **SFX start:** campfire spark (default start sting)
- **SFX end:** a default session-end sting
- **Aura:** orange base aura
- **+ a base version of every other slot** (halo, card, banner, title, particle…)

Why it's strong: it's zero-cost, it makes "equipped" visible to everyone from the first session, and the
contrast with the base set is what makes people *want* the shop/pass items. Implementation: seed the
default loadout into the `equipped_loadout` table (migration 0070) on account creation; base cosmetics
are permanent defaults — not sellable, not salvageable.

## What v1 must contain (Noah's list, consolidated)
Challenges reset fixed · Forge Pass properly scoped + de-slopped · cosmetics fully wired (retention) ·
default cosmetics equipped · RevenueCat + purchase success screen · the deploy landed · the shop bugs
cleared. The Live Activity pill and the 30/60/90 aura are premium polish — great to have, but can be
v1.1 if they threaten the timeline.

---
Sources: Laurier Policy 9.4 (Information Security), Policy 9.1 (Use of IT), Approved Software & Cloud
Solutions Catalog (ICT). Full step-by-step not public — confirm specifics with the ICT Service Desk.

---

## Timeline — target: submit to Apple by Wed Aug 20
Today is **Fri Aug 14**. Apple review is ~1–3 days now, so an Aug 20 submission clears the Sept 10 class
start with a big buffer. **The risk is the BUILD, not the review.** 6 days for this full scope is
aggressive but doable if Code moves and the deploy happens today.

- **Fri Aug 14** — Deploy migrations 0062–0070 (unblocks equip / boxes / challenges). Commit the batch.
  Start critical bugs.
- **Sat–Sun Aug 15–16** — Critical bugs (×10 vault crash, Buy Direct rotation, inventory wiring,
  challenges reset, Sunday week-helper) **+** the cosmetics wiring blitz (ember icon, cosmetic art,
  audio previews, SFX rescope + two slots, reveal-SFX ladder, box QOL, default cosmetics).
- **Mon Aug 17** — Forge Pass de-slop (the fuzziest task — reward ladder + visual rework).
- **Tue Aug 18** — RevenueCat native build: IAP products (Forge Pass sub + ember packs) + purchase
  success screen. Start App Store Connect (app record, privacy labels, screenshots).
- **Wed Aug 19** — Native EAS build → TestFlight → full internal QA sweep; fix regressions.
- **Thu Aug 20** — Final QA, **submit to App Store review.** (TestFlight already live for the gym table.)

**Flex → v1.1 (do NOT risk the Aug 20 date on these):** the 30/60/90 aura (#86) and the Live Activity
pill (#87) are native + heavy. Ship them as a fast-follow **v1.1** a week or so later — they can be in
review while v1 is already live. They stay in the punch list (Phase 5), marked v1.1.

**Biggest risks to the date:** (1) the deploy not happening today; (2) RevenueCat / App Store Connect
IAP setup bouncing; (3) the Forge Pass redesign expanding. If any slips, cut aura + pill first (already
planned), then trim Forge Pass polish to "clean, not fancy."
