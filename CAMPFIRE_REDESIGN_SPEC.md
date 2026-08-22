# Campfire redesign — device review (Aug 21)

"Good from the outside, vibe-coded on the inside." Two phases, sequenced as Noah asked:
**Phase 1 = visual/UI (now)** → mock 110 (+ 111 for watch/report). **Phase 2 = logic/integrations (later).**
Reference: mock 94 (campfire member view), DESIGN_LANGUAGE_EMBER, ITEM_CATALOG §2d (banner art).

---

## PHASE 1 — Visual / UI (build now)

### Header (the biggest "vibe-coded" offender → make cohesive)
- Rebuild to one consistent ember treatment. Elements: back · **campfire banner art landing as the header
  background** (§2d — currently not rendering) · the **collective heat flame** (coal-bed heat state, mock 93/94
  — cold = "BURNT OUT", warming, roaring) · status line "BURNT OUT · 0 of N in today" · name · meta
  ("Open/Gated · N members · founded Jul '26").
- 🔴 **Kill the off-brand bright-blue floating settings gear.** It appears mid-screen on several tabs. One
  control only, top-right, ember/subtle.
- **Move Lock-in to the top-right** (Noah's call): a compact **"Lock in" pill in the header**, not the big
  bottom "Lock in with the house" bar (old schematic). Frees the bottom for content/chat. (Scoped in mock 110.)
- **Hamburger (top-right) opens the options sheet** (replaces the gear as the menu entry).

### Tabs
- **Leaderboard** — fine as-is. Streak under XP is OK but optional; keep it subtle (small flame + `22× wk`).
- **Feed** —
  - **Make it up-swipeable to full-screen** — a half-visible chat under the stat strip is awkward.
  - **Crisper feed cards** — the current accent graphic is the old bold-orange; swap to the current ember
    language (thinner accent rail, ember not the loud orange, cleaner rows). Strava card keeps its attribution.
  - Chat input ("Message the campfire" + Send) docks at the bottom of the full-screen feed.
- **Challenges** — cards look crisp; keep the visual, fix the entry to **manage** (below).

### Challenge cards (visual bits only — logic is Phase 2)
- **Manage = a kebab / hamburger, not a trash can.** The trash-can-as-manage is confusing; replace with a
  `⋯` menu (Edit · Share · Delete · Report). Delete lives inside it.
- **Add a Delete challenge** action (currently missing) — inside that `⋯` menu.

### Watch screen (mock 111)
- Today it's a bare "leaderboard + metric." Redesign to the **per-person metric meters** — each participant
  gets a labeled bar/gauge of the challenge metric (XP / volume / distance / hours), racing live, scaled to
  the leader, leader **crowned**. Ember treatment, header, elapsed/time-left. Duel variant = facing meters +
  lead bar, **real name + avatar (never "Opponent")**.
- **Cheer feed under each person** — show each participant's **cheer count** (and who: "4 cheers · Maya,
  Jordan +2") right under their meter.
- 🔴 **Cheering is personal (wire it):**
  - Cheer is **capped** (one per person per challenge) and **authoritative** (no infinite-click).
  - Tapping Cheer opens a **note composer** (optional) — "add a note to make it personal" (hype / trash talk,
    e.g. a gym-volume duel). Skippable ("just cheer, no note").
  - Fires a **push + bell**: **"🔥 {name} cheered you on"** + the note if present (leads with the cheerer's
    avatar; taps through to the challenge). No note → just "{name} cheered you on 🔥". *(Added to
    `NOTIFICATIONS_SPEC.md` Friends & social.)*

### Report screen (mock 111)
- Restyle from vibe-coded radio list to the ember language (cards, spacing, ember selected state). Keep all
  reasons incl. **Child safety / CSAE** (compliance-required). Submit enables once a reason is picked.
- 🔴 **Wire the email alert:** on submit, send an automated email to the **safety/admin inbox** (Noah's) —
  subject/body: **"{reporter} reported {campfire name} for {reason}."** Include campfire id + reporter id +
  timestamp. **Child-safety/CSAE reports flagged for immediate escalation.** (Use the transactional email
  provider already set up for uni verification — Resend.)

### Invite / create
- 🔗 **Domain: `getphiloi.com` → `philoi.app`** on the invite screen + the join link. (Also verify the deep
  link/universal link points at philoi.app.)
- Consider **dropping the raw URL line** — keep the code + "Share invite link"; the visible long URL isn't
  needed. (Recommend: keep code, keep Share, drop the raw URL text.)

### Pure-visual/SQL bugs surfaced
- 🔴 **Join requests: "column reference \"id\" is ambiguous"** — same class as the watch `status` bug; qualify
  the column in that query (`join_requests.id` vs `profiles.id`).
- Delete campfire exists (options sheet) — keep, but make sure it's the styled confirm, not the OS default gray
  alert (screenshot shows a bare Android-style dialog; use the ember confirm).

---

## PHASE 2 — Logic / integrations (after visual)

- 🔴 **Challenges auto-start on creation** — no accept/approval, no admin gate. Add a **lifecycle**: created →
  pending/invited → accepted → live → settled. Group/campfire challenges need someone to start/approve.
- 🔴 **No admin privileges** — anyone can modify/delete a challenge. Add **roles** (owner/admin vs member);
  only admins edit/delete campfire + challenges, approve joins, start challenges.
- 🔴 **Challenge type mismatch** — a group goal ("everyone locked in 4× in 2 days", 3 people) renders as a
  1v1 **VS** card you can "watch." Fix the model→render mapping: group/collective ≠ duel.
- **"You vs Opponent"** shows the literal word "Opponent" instead of the real name (creator's view). Bind the
  actual participant.
- **Watch push doesn't fire** — updates land in-app only, no OS push. (Ties to PUNCHLIST_22 P0 #3 — the push
  pipeline.)
- **Reward / "you won" arc not wired** — the whole challenge-settled → placement → reward flow (mocks 47/103,
  CHALLENGE_REWARD_ALGO) needs to fire on campfire challenges. This is the "then we focus on integrations"
  work Noah flagged.

---

## Acceptance (Phase 1)
- [ ] Campfire header: banner art lands, heat flame renders (coal-bed states), cohesive ember, **no blue
      gear**, **Lock-in pill top-right**, **hamburger top-right** opens options.
- [ ] Feed: full-screen swipe, crisp ember cards (not old bold-orange), chat docked bottom.
- [ ] Challenge cards: manage via `⋯` (not trash), includes Delete.
- [ ] Watch: per-person metric meters, leader crowned, real name/avatar (mock 111); **cheer count under each
      person**; cheer capped + note composer + fires "🔥 {name} cheered you on{: note}" push.
- [ ] Report: restyled to ember (mock 111), CSAE kept; **on submit emails the admin** "{reporter} reported
      {campfire} for {reason}" (Resend), CSAE escalated.
- [ ] Invite/join uses **philoi.app**; raw URL line dropped.
- [ ] Join-requests SQL `id`-ambiguous fixed; delete confirms use the ember dialog.
