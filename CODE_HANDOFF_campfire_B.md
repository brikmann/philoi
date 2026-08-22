# Code handoff B — Challenge subsystem end-to-end (logic + challenge/watch UI)

One of two parallel prompts (**A = campfire container/social/safety**; B = the challenge subsystem). Student-side
B2C only. Full context: `CODE_HANDOFF_campfire.md`.

**⚠ Coordination (READ FIRST)**
- Clear any stuck `.git/index.lock`; commit first. **Work in your own git worktree.**
- **A/B boundary (critical):**
  - **You own everything challenge:** the Challenges-tab **content + cards**, create flow, challenge info,
    manage ⋯, the **Watch** screen, cheer, post-challenge results, the reward arc. A owns the campfire shell +
    the tab bar — **your Challenges content mounts into A's tab slot** (agree on `<ChallengesTab/>`); don't
    build the campfire header/options.
  - **Admin gating consumes A's membership ROLES** (owner/admin vs member) — coordinate the shape; only admins
    start/edit/delete challenges + approve challenge invites.
  - Both touch `NOTIFICATIONS_SPEC.md` — you add the **cheer** row (+ challenge push events); leave A's
    report/campfire rows alone.
- Don't edit mocks/specs; flag disagreements in chat.

**Source of truth:** `CHALLENGE_V2_SPEC.md` · `CHALLENGE_REDESIGN_SPEC.md` · `CHALLENGE_REWARD_ALGO.md` ·
`REWARD_ECONOMY.md` · `PROFILE_SPEC.md §G` (milestone tie). Mocks **113** (challenge v2), **114** (placement),
**111** (watch/cheer), **47/103** (reward arc).

## Scope
### Logic (Phase 2)
- 🔴 **Lifecycle** — no auto-start: created → pending/invited → accepted → live → settled.
- 🔴 **Admin gating** (uses A's roles): only admins start/edit/delete; members accept/participate.
- 🔴 **Type model → render** — Duel (VS) · Collective goal (progress) · **Placement (ranked/percentile)**;
  a group goal must never render as a 1v1 VS. Bind **real participant name + avatar** (kill "Opponent").

### v2 create
- **Metrics:** Lock-in time · Volume · Distance · **✨ AI custom goal** (XP dropped — redundant with time).
- **Member ticker** — invite a subset → accept → admin starts.
- **Custom time** — 1d/1w/1mo presets + **calendar** for arbitrary spans (semester).
- **Public name** + **milestone tie** — named challenge races on lock-in time; grade = self-reported
  **milestone** (PROFILE_SPEC §G), 🔒 **firewalled: no XP for the grade**.
- **✨ AI custom goal (FREE, rate-limited)** — 🔴 **server-side Sonnet** parses the goal → structured config
  (metric · source · win · checkpoints). **Never let the client define "winning."** **Free for everyone** (it
  feeds the competitive loop → paywalling = pay-to-win); cost control via a **uniform rate limit**, not a
  paywall, and **not** tied to Flame Pass.

### Watch (mock 111) + media
- **Per-person metric meters**, leader **crowned**, real name/avatar, elapsed/left; duel = facing meters + lead bar.
- **Cheer** — capped (one/person/challenge) + authoritative · optional **note composer** · fires
  **"🔥 {name} cheered you on{: note}"** push+bell (cheerer avatar, taps to challenge). **Cheer count under each.**
- **Photos / videos** — challenge-tied lock-in nudges "post a photo or clip (≤30s)"; media in the watch feed,
  **video poster-frame thumbnail is the public preview** + play control; each cheerable. (Transcode/compress video.)
- **Watch share card** — story card of the live race + watch deep link.
- 🔴 **Watch SQL "status is ambiguous"** — qualify the column. **Watch push must actually fire** (not in-app only).

### Post-challenge
- **Results + reward arc** (mocks 47/103/113/114) — duel win · collective complete · named-milestone ·
  **placement (rank + percentile band → embers + box + class-stamped badge)**. `grantReward` server-side +
  idempotent, per `CHALLENGE_REWARD_ALGO`. All shareable.

## Deferred — NOT yours
Prof/B2B2C (S2, Laurier IT) · "Cindy" AI assistant (backlog).

## Open decisions (confirm before those bits)
- [x] AI custom-goal = **free + uniform rate limit** (decided — no paywall). · [ ] Metric set final
      (time/volume/distance/AI). · [ ] Reward numbers from `CHALLENGE_REWARD_ALGO`.

## Acceptance
Per `CHALLENGE_V2_SPEC.md` acceptance + `CHALLENGE_REDESIGN_SPEC.md` A–D (your portion): lifecycle, admin gating,
type render, metrics, ticker, custom time, milestone tie, AI goal, watch meters/cheer/media/share, post-challenge
rewards, placement.
