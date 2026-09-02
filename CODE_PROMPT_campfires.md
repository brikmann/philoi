# Code Prompt — Campfire visual pass + campfire-challenge reward loop

Noah's on-device pass on the campfires surface. **Seven items, two halves:** §1–§4 are the campfire *visuals* (valley + detail screen), §5–§7 are the campfire *challenge/reward loop* (does a whole-campfire race pay AND reveal by placement). On `integration-wave1` — one branch, one Metro. §1–§4 + most of §5–§6 are client/OTA (ride the dev-client Metro, no rebuild); §7 may touch a settlement function (additive migration on the one push path).

**Report per item what was actually broken vs already working** — several of these may be partially built, and item 1 is a design decision, not a bug.

---

## PART A — CAMPFIRE VISUALS

### §1 · The valley shows raw emoji, not the scoped campfire visual (#186)
**Where:** the valley is Page 2 of `src/app/(tabs)/index.tsx` — `ValleyPage` → `ValleyNode` / `MyFireValleyNode`, which today render **`<CampfireBadge emoji=… heat=… />`** (`src/components/campfire-badge.tsx`). `CampfireBadge` is **emoji-centred by design** (emoji in the middle, heat as a pulsing aura behind it), and at low/cold heat the aura is null (`AURA.cold = null`), so a cold campfire reads as *just an emoji in a frame*.

**Noah's call:** "it just shows the icons as emojis and not the actual campfire mock we scoped… **the icon + emoji should only be an internal identifier.**" So the emoji-centred badge is the wrong centerpiece. The valley node should show the **actual campfire illustration** — the flame/hearth art (`src/components/campfire-flame-stage.tsx` / `campfire-flame.tsx`, the same visual language as the home flame + mock 110/112 campfire redesign) — with the **emoji demoted to a small corner/identifier chip**, not the main visual.

**Do:**
- Confirm which scoped mock is the target campfire node art (check `110-campfire-redesign` / `112-campfire-full-map` and the flame-stage component). If the scoped node is the flame illustration, swap the valley nodes from emoji-centred `CampfireBadge` to that campfire-flame visual, sized by heat state (`roar`/`steady`/`cold` → the existing `SIZE_FOR_STATE` / flame-state mapping).
- Keep the **emoji as a small identifier** (corner chip / label), since it's still the owner-chosen identity — just no longer the centerpiece.
- Apply to **both** node types (`MyFireValleyNode` and the discovery `ValleyNode`) so your own fires and discover fires match.
- Note: `invite.tsx` also uses `CampfireBadge` — leave the badge component itself intact (invite/search rows may still want the emoji identity); this item is specifically the **valley nodes**.

**Done:** the valley renders each campfire as the scoped campfire illustration (flame/hearth), with the emoji as a small internal identifier — not a bare emoji as the main visual.

### §2 · The banner doesn't cover the whole campfire screen (#146)
**Where:** `src/app/group/[groupId]/index.tsx` owns the campfire-detail chrome; banner art is `campfire-banner-art.tsx` (+ `campfire-banner-picker.tsx`). Today the banner only paints a strip near the **title/header**, which reads as a misplaced band.

**Noah's call:** "the banner should cover the entirety of the campfire" — the owner's chosen banner should be the **backdrop for the whole detail screen**, not just a header strip.

**Do:** make the banner the full-screen background of the campfire detail (behind the header, tabs, and content), with the content legible over it (scrim/gradient overlay as needed for contrast — reuse `ScreenBackground`'s treatment so text stays readable). The banner is per-campfire (`groups.banner_item_id`, #146) — each fire flies its owner's chosen banner across the whole screen.

**Done:** the selected per-campfire banner covers the entire detail screen as a cohesive backdrop, content stays legible, no floating header-only strip.

### §3 · Mangled background colours — inconsistent purple shades (#128/#133)
**Where:** `src/app/group/[groupId]/index.tsx` mixes `Colors.*` tokens (`trackAlt`, `textTertiary`, `muted`, `amber`…) with at least one **hardcoded hex** (`backgroundColor: '#231A2E'`, line ~328). Different sections landing on different purples is the "some sections one shade, some another" complaint.

**Do:** audit every surface/background on the campfire detail (and the valley if it shares the issue), replace hardcoded hex backgrounds with the shared `Colors` theme tokens, and settle on **one consistent background treatment** across the screen's sections (header, tab bar, cards, feed). Grep the file for literal `#` colours and for divergent `Colors.*` background tokens; unify to the design system. If the banner backdrop from §2 lands, sections should sit on it consistently rather than each painting its own purple.

**Done:** the campfire screen reads as one coherent surface — no section-to-section purple mismatch, no stray hardcoded hex backgrounds.

### §4 · Swipe-up-to-open-feed doesn't work (#128/#133)
**Where:** `src/app/group/[groupId]/index.tsx` ~line 132: `const swipe = Gesture.Pan().onEnd((e) => { if (e.translationY < -20) runOnJS(setFeedFullScreen)(true); … })`, wrapped in a `<GestureDetector>` around the swipe-hint strip (~line 146), only rendered when `!feedFullScreen`.

**Noah's call:** the mechanic "doesn't work" — swiping up on the feed does not expand it to full screen.

**Do:** diagnose why the pan never fires / never expands. Likely suspects: (a) the `GestureDetector` wraps only the thin hint strip, so a swipe starting on the feed content misses it — the pan should cover the feed area, not just the grip; (b) gesture conflict with the inner feed list's own scroll (a `Pan` competing with a `ScrollView`/`FlatList` needs `simultaneousWithExternalGesture` / `blocksExternalGesture` or a `.activeOffsetY` threshold so an upward pan is recognised over the list scroll); (c) `onEnd`-only means a fling that the list claims never reaches `onEnd` — consider `.onUpdate` with an offset threshold; (d) missing `GestureHandlerRootView` at the root (check `_layout.tsx`). Fix so an upward swipe over the feed reliably opens full-screen and a downward swipe restores the header, without breaking the feed's own scroll. The `onPress` fallback on the grip should keep working.

**Done:** swiping up on the feed expands it to full screen (and down restores it) reliably, on both platforms, without stealing the feed list's scroll.

---

## PART B — CAMPFIRE CHALLENGE + REWARD LOOP

> Prereq: this assumes the main-Challenges-screen algorithm + reward reveal work is verified first (per `CODE_PROMPT_challenge.md` §3 and #183/#184). §5–§7 confirm the SAME loop fires when the challenge originates from / is scoped to a **campfire**.

### §5 · Challenges land from the campfires screen (#128)
The campfire detail mounts `<ChallengesTab/>` (`src/components/challenges-tab.tsx`) as its Challenges tab. Verify the **full loop originating from the campfire**: from a campfire you can see its active/pending/finished challenges, open them, and they render correctly in the campfire context (not just from the top-level Challenges tab). Report any campfire-scoped challenge that shows on the main challenges screen but is missing/broken inside the campfire, or vice-versa.

**Done:** the campfire's Challenges tab shows and opens the campfire's challenges correctly, consistent with the main challenges screen.

### §6 · "Set-a-race": an Owner sets a challenge for the whole campfire, seamlessly (#113)
The placement-race concept exists — `challenge/create.tsx` (~line 294: "a placement race is the admin's to call and the whole campfire is the field") and `social-challenges.ts` (~line 108: enrols the whole campfire as accepted). **Verify + smooth the owner flow end-to-end:** an owner of a campfire (a uni gym chat, a friend group, a course group) can, from the campfire, set a race that **enrols every member as the field** without inviting/answering per-person — one action, the whole fire is in. Check entry point placement (is "set a race" discoverable from the campfire for owners?), that non-owners can't, and that every member is actually enrolled and notified. Report friction or gaps.

**Done:** a campfire owner can set a whole-campfire race in one seamless flow; every member is enrolled as the field and notified; non-owners can't set it.

### §7 · 🔴 THE DOPAMINE LOOP — campfire challenge pays AND shows by placement (#183/#186)
**This is the big one.** A campfire placement challenge must (a) **pay the correct reward by finishing placement** (1st/2nd/…/percentile → the right embers/box/XP), and (b) **SHOW it** — the winner sees the reward reveal with rays + the actual reward, especially for a big-field campfire race. Paying silently kills the whole point.

The reveal machinery exists: `challenge-settlement-watcher.tsx` reads `get_my_unseen_challenge_rewards`, and for a row with `placement != null` builds `challengeRewardResult(...)` and presents `ChallengeRewardScreen` (mock 137) through the shared reveal floor/queue — so a placement settlement that lands while the app was closed SHOULD reveal on next foreground. **Verify the campfire path specifically:**
- **Settlement pays by placement.** Trace the campfire/placement settlement (the finalize path, `grant_reward`, 0122/0127-era functions): does a whole-campfire race compute each member's placement/percentile and grant the placement-scaled reward? Confirm the earlier silent-settlement bug (settlement paid *nobody* / mis-attributed the winner) does NOT recur for the campfire field. This is the forward-priority 🔴 from the challenge work.
- **Reveal shows the real placement reward.** On device, settle a campfire placement race and confirm the winner (and a mid-pack finisher) each get the reveal with their **actual** placement, percentile (mock 114 result), and reward (embers/box), rays firing, queued not stacked (shares the reveal floor with rank-up).
- **Field size shows.** A big-field campfire race should read as such (percentile / "Nth of M"), so winning a race with lots of people *feels* bigger — that's the point Noah's making.

**Done:** a settled campfire challenge pays each member the correct placement-based reward AND every member sees their reveal (real placement + percentile + reward + rays), verified on device for a multi-person campfire race — the full "win the campfire race" dopamine loop closes.

---

---

# ROUND 2 — Noah's on-device pass (valley/banner better now; six follow-ups)
The valley flame + banner-behind-header landed and read better. Remaining, from the recording:

## R1 · Campfire emoji is immutable after creation
A campfire's internal emoji is its fixed identity — **it cannot be changed after the campfire is created.** Ensure there's no post-create edit affordance for the emoji (it's set once at creation). If a settings/edit path exposes an emoji change, remove it; the emoji is locked for the life of the campfire.

## R2 · Banner: full-screen top-to-bottom + animated, like the flares
Today the banner paints only the **top ~third** of the campfire screen (behind the header/tabs) and fades to dark — and it's **static.** Noah wants it to work like the **flares**: **stretch from the very top of the screen to the very bottom** as a full-screen backdrop, and be **animated** (the flare perimeter/aura system is the reference — reuse that animation approach for the banner's motion, `src/components/economy/flare-perimeter.tsx`). The banner is also **immutable after creation** (set once, like the emoji — same rule as R1). *(If Noah instead wants the owner to be able to swap banners later, that's a one-line flag — default to immutable per his phrasing.)*

## R3 · Full-screen banner becomes the backdrop for Feed + "Message the campfire"
Consequence of R2, and intended (Noah: "which is cool"): once the banner runs top-to-bottom, it should also sit behind the **Feed** and the **message-the-campfire** screens as their backdrop — one continuous animated banner across the whole campfire experience, content legible over it (scrim as needed).

## R4 · "House rule" is unstyled
The campfire's **"House rule"** currently renders as **basic text with an emoji.** Style it as a proper element (a titled card/callout in the campfire's design language — not a raw emoji + line of text). Match the banner/campfire visual treatment.

## R5 · 🔴 Campfire challenge accept flow is broken (multiple bugs)
From the recording, a **Group · all-or-nothing** challenge created in the campfire:
- **Accept / Decline button colours are wrong** — Accept renders a **muted "weird yellow"/gold** and Decline an olive-tan; neither is on-brand. Fix to the app's action colours: **Accept = primary (coral→ember filled)**, **Decline = ghost/muted outline** (match the confirm buttons elsewhere).
- **🔴 The creator can't accept their own challenge** — pressing Accept shows **"No open invite for you on that challenge."** The owner who created the challenge has no invite/enrolment, so they can't participate. **The creator should be auto-enrolled (or issued an invite) in their own campfire challenge** — and R5's sibling: **the owner also cannot be invited to their own challenge** (invite list excludes them). Fix enrolment so the creator is a participant by default.
- **No "challenge accepted" state.** On an alt account, pressing Accept just **ticks the button** and the counter shifts (e.g. "0/0 done · waiting on 2" → "0/1 done · waiting on 1") with **no acceptance confirmation UI** — there's no "you're in" state/mock. Add a clear **accepted** state (the card reads as joined for that user; the waiting-on / field counts are correct). Also audit the counts: a fresh group challenge showing "waiting on 2" while the field/creator aren't counted right suggests enrolment math is off — reconcile field size, accepted count, and "waiting on N."
- Trace the accept path end-to-end: `social-challenges.ts` (enrolment / "enrols the whole campfire as accepted"), `challenge/create.tsx`, and the challenge card/accept component. Report what was actually wrong at each layer.

## R6 · 🔴 Campfire challenge notifications don't fire
Any challenge-related push/notification-feed events for **campfire challenges don't work** — invited, accepted, challenge started, settled/won. Wire these through the existing notify/push path (the same one rank-up/session-complete use). Confirm the token + `notify_event`/`notify_push` path fires for: you're invited to a campfire challenge, someone accepted, the challenge started, and it settled (with the reward). Report which events were missing.

**Done (Round 2):** emoji locked post-create; banner runs full-screen top-to-bottom, animated like the flares, backing the Feed + message screens, immutable; "House rule" is a styled element; challenge Accept/Decline are on-brand; the creator is enrolled in (and excluded from inviting) their own challenge; an accepted state shows with correct counts; and campfire-challenge notifications fire for invite/accept/start/settle.

## Guardrails + Done
- One branch (`integration-wave1`), one push path. §1–§6 + R1–R4 are client/OTA (dev-client Metro, no rebuild); §7 + R5/R6 settlement/enrolment/notify fixes are additive migrations on the one push path — restate nothing, report snapshot age before any prod push.
- §1 is a **design swap** (emoji-centred badge → campfire illustration), not a bug — confirm the scoped mock before rebuilding the node.
- Per item, report broken-vs-already-working, and keep the good bits (heat→state sizing, the emoji as identity, the existing reveal floor/queue).
- Do NOT touch the rank-up celebration or the reward-rays `REVEAL_TUNING` cues — §7 reuses them, doesn't rewrite them.
