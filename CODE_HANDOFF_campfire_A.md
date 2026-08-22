# Code handoff A — Campfire shell + social + safety (UI-heavy)

One of two parallel prompts (A = campfire container/social/safety; **B = the challenge subsystem**). Student-side
B2C only. Full context: `CODE_HANDOFF_campfire.md`.

**⚠ Coordination (READ FIRST)**
- Clear any stuck `.git/index.lock`; commit the outstanding tree first. **Work in your own git worktree.**
- **A/B boundary (critical):**
  - **You (A) own the campfire container screen + tab chrome** (header, the Leaderboard/Feed/Challenges tab
    bar, options). **B owns the *content* of the Challenges tab + the Watch screen.** Render the Challenges tab
    as a slot that mounts B's `<ChallengesTab/>` (agree on the component name) — don't build challenge cards.
  - **You build the campfire membership ROLES foundation** (owner/admin vs member) — B consumes it to gate
    challenge start/manage. Land this early and tell B the shape.
  - You both touch `NOTIFICATIONS_SPEC.md` events — you add the **report/campfire** events, B adds cheer; keep
    to your own rows.
- Don't edit mocks/specs; flag disagreements in chat.

**Source of truth:** `CAMPFIRE_REDESIGN_SPEC.md` §Phase 1, mocks **110** (main), **111** (report), **112** (every screen).

## Scope
1. **Header rebuild** (cohesive ember): banner art as bg · heat flame (coal-bed states) · **kill the off-brand
   blue gear** (app-wide in campfire) · **Lock-in → top-right pill** · **hamburger → options sheet**.
2. **Feed tab** — full-screen swipe · crisp ember cards (drop old bold-orange) · **redesigned round text field
   + ember send** · chat docked bottom.
3. **Leaderboard tab** — keep; streak-under-XP subtle.
4. **Options sheet (hamburger)** + **Edit campfire** + **Invite** + **Join** + **Join requests** (approve/
   decline) + **delete confirm → ember dialog** (not the OS gray alert). (mock 112.)
5. **Report** (mock 111) — ember restyle, CSAE kept; 🔴 **on submit emails the admin** "{reporter} reported
   {campfire} for {reason}" via **Resend** (the provider already set up for uni verification); CSAE escalated.
6. **Membership roles** — owner/admin vs member; gate edit/delete/invite-approve to admins. (Shared foundation.)

## Bugs / fixes (yours)
- 🔴 **Join requests SQL "column reference \"id\" is ambiguous"** — qualify the column (`join_requests.id` vs
  `profiles.id`).
- 🔗 **Domain → `philoi.app`** on invite + join link + deep/universal link; **drop the raw URL line** (keep
  code + Share).
- **CTAs above the bottom safe area** — Light campfire · Save changes · Share invite · Submit report not flush
  to the edge.

## Acceptance
Per `CAMPFIRE_REDESIGN_SPEC.md` Phase-1 list (header/feed/options/report/invite/join-requests/domain/SQL) —
minus the Challenges-tab content + Watch (those are B).
