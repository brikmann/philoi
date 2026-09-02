# Code Prompt — consolidate wave1, notification tweak, then the reward-algo rays (today's focus)

Three parts, in order. §0 makes `integration-wave1` the single source of truth and ends the Metro-port roulette. §1 is a quick notification fix. **§2 is the day's real work — every reward event firing its own "rays" reveal — and where most of the time goes.** All on `integration-wave1`, one branch, one push path (`MIGRATIONS.md`).

---

## §0 · Consolidate onto integration-wave1 + cut a real build (do first)
- **Re-merge `worktree-cosmetics-mocks` → `integration-wave1`.** It's 2 commits ahead of what wave1 merged — `0505d62` (finish hellfire recolour) + `6efb7f7` (flame colour follows loadout / home flame+glow recolor). Cosmetics-only; Forge/Cindy don't touch those files, so it should be clean. After this, wave1 has **everything**: Forge + Cindy inline + full flares/hellfire + all device-smoke/reward/rank/email fixes + migrations 0136–0140.
- **Cut a fresh build off wave1** so the device stops depending on which Metro is up on which port. Root cause of the confusion: the `development` profile is `developmentClient: true` → loads JS from **Metro, not the OTA channel** (that's why the earlier `development` OTA was inert). Cut a `preview` (or dev-client) build off `integration-wave1` and have Noah install it — then there's one coherent binary, not port 8081 (cosmetics-mocks, no Forge) vs 8082.
- **Roll back the inert `development` OTA** to embedded so nobody mistakes it for shipped: `npx eas-cli@latest update:roll-back-to-embedded --channel development --platform android`.
- Leave the other session's Metro alone (it respawns; the fresh build moots it).

---

## §1 · Notification tweak (#179) — quick, server migration
Additive migration (next number after 0140, on wave1; restate nothing; prove `prosrc` removes nothing).
1. **Stale copy:** the campfire check-in push still says "…just checked in 🔥" (photo-proof/check-in era — `0012`'s handle-check-in notify). Rewrite to lock-in language, e.g. *"{name} locked in — {activity} 🔥"* / *"{name}'s locked in on {activity} 🔥"*. Grep every notify title/body for other "check in"-era wording and update.
2. **XP-to-rank-up in the session-complete push:** `0120`'s `session_complete` body already appends "· +{xp} XP". Add the remaining-to-next-rank, e.g. *"45 min studying · +120 XP · 340 XP to Gold II. Nice work."* The trigger must read the user's rank state (xp_for_next_tier − xp_into_tier + the **next** division label via the same nextRank logic the client uses) at push time. Skip cleanly at max rank.
3. **Audit every notification type fires** with correct, current copy (rank-up, relic unlock, session-complete, reaction, cheer, challenge invite/result, streak-risk, daily-fire). Note any that never fire.

---

## §2 · Reward algorithm — every event fires its own rays reveal (TODAY'S FOCUS)
**The goal:** rank-up / pass-level-up / daily-fire / personal-challenge / team-challenge / placement-challenge each fire **their own reward reveal — "the rays"** — and each **shows the actual reward** (embers / box / cosmetic / XP), with a fitting SFX. Not a silent grant, not a generic toast.

**What exists to build on (reuse, don't reinvent):**
- `rank-up-celebration.tsx` (the rays celebration) + `rank-up-watcher.tsx` (global trigger on rank increase).
- `reward-burst.tsx` (Lottie: `settle`/`rankup`/`spark`) + the `RewardCue` SFX map in `sound.ts`.
- `challenge-settlement-watcher.tsx` (#163, fires on unseen settled challenges) + `goal-streak-reward-screen.tsx` (payout screen).

**Audit + wire each of the six — one consistent rays language, distinct per event:**

| Event | Trigger today | What's needed |
|---|---|---|
| **Rank up** (division/tier) | RankUpWatcher → RankUpCelebration | Verify it fires AND shows the rank-up **rewards** (the 0121 embers + box grant), not just the band cross. |
| **Pass level up** (claim_pass_level) | claim on Flame Pass | Fire the rays reveal showing the **claimed level's reward** (item/embers). Likely unwired — add it. |
| **Daily fire** (daily streak reward) | daily fire complete/claim | Fire a rays reveal with the daily reward. Likely unwired — add it. |
| **Personal challenge** (solo settle) | settlement watcher | Reveal must **show the reward won** (embers/box), with rays, not just "you won". |
| **Team challenge** (group settle) | settlement watcher | Same — rays + the actual payout. |
| **Placement challenge** (placement settle) | settlement watcher | The mock-114 percentile result screen + rays + the placement reward shown. |

**Requirements:**
- **One shared "rays" celebration primitive** (generalize `rank-up-celebration`'s rays, or a `RewardRays` component) that every event uses, **tinted/scaled/labelled per event** so they're distinct but clearly the same family. Rank-up stays the biggest.
- **Each reveal reads the authoritative reward** (server result / grant), shows *what you got* (ember count, box rarity, cosmetic art, XP, pass level), and **never re-grants** — presentation only.
- **One at a time / queued** — if a lock-in ends and it's also a rank-up and a daily-fire, they sequence, they don't stack (RankUpWatcher already has a pending/queue pattern — follow it; order rank-up last as the crescendo).
- **SFX per event** via the existing `RewardCue` map — pick/scope the cue for each (rank-up already has the `rankup-<tier>` ladder; give pass-level, daily-fire, and the challenge wins their cues; reuse where a new asset isn't ready and flag which need real audio — that's #185).
- Respect reduce-motion + the haptics/sfx prefs (the burst already does).

**This is the iterate-with-Noah part** — build it so intensity, tint, and per-event distinctness are tunable (named constants), because he'll want to feel each one on-device and adjust.

---

## §3 · Verify + ship
- `tsc --noEmit` clean; lint no new errors; commit in logical chunks on `integration-wave1`.
- §1's migration deploys via the one push path (PITR/backup posture; report snapshot age first).
- §2 is client → rides the wave1 build/Metro from §0.
- On-device (Noah): each of the six events fires its rays reveal showing the real reward, sequenced not stacked, with sound; the fixed notification copy + XP-to-rank-up appears on a real push.

## Done =
wave1 is the one branch with everything, on a fresh installed build; the stale check-in copy is gone and the session-complete push shows XP-to-rank-up; and all six reward events fire their own rays reveal showing the actual reward, queued and with SFX — tunable for Noah to feel and adjust on-device.
