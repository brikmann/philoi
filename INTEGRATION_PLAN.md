# Integration — merge the 6 agent branches into one tree

All 6 agents reported **done, tsc-clean, on isolated worktrees off `integration-base`**. No collisions (the orchestration worked). Now merge, wire the deliberately-deferred cross-agent seams, and — critically — **actually run the SQL**, which no agent could (no Docker in a worktree).

## Branches
| Agent | Branch | Migrations | Head |
|---|---|---|---|
| 1 Logic | `agent1-logic` | 0119–0123 | 3 commits |
| 2 Challenge | `agent2/challenge-v2` | 0124–0127 | 3 commits |
| 3 Agora | `worktree-agora` | 0128–0130 | `3edfc1d` |
| 4 Cosmetics | `worktree-cosmetics` | — | `63768de·771d523·5c25051` |
| 5 Chrome | `worktree-chrome` | — | `6f7fb82` |
| 6 Settings | `worktree-settings` | — | `9daaaa6` |

## Step 0 · On-branch, before you merge
**Agora photo cleanup (#149).** On `worktree-agora`, make post removal (author *and* moderation) **permanently delete the storage object**, not just the DB row — so a deleted image can't keep resolving. This is the anti-abuse guard that makes the public bucket safe; 0128 is otherwise **unchanged (bucket stays public)**.

## Step 1 · Merge in order, union the shared file
Merge **1 → 2 → 3 → 6 → 4 → 5**. Only `src/types/database.ts` needs a union (Agents 2, 3, 6 appended commented blocks; 1 and 5 didn't touch it) — additive, no reorders, so it's a concatenation, not a conflict. Watch one real overlap: **`lockin-goal-picker.tsx`** — Agent 4 added 4 lines (per-session audio switcher), Agent 5 flagged line 220 (raw emoji). Different lines; keep both.

## Step 2 · Wire the cross-agent seams (each agent left these for the integrator, on purpose)
1. **Challenge glyphs** — Agent 5 defined `CHALLENGE_TYPE_GLYPH` but couldn't wire it (Agent 2's files). Swap `<Ionicons name={CHALLENGE_TYPE_ICON[x]}>` → `<DisciplineIcon name={CHALLENGE_TYPE_GLYPH[x]}>` in `challenge/create.tsx:492`, `challenge-info/[challengeId].tsx:388`, `challenge-card.tsx:132`, `challenge-completion-card.tsx:15` (+ import).
2. **Home flame particles** — mount `<EquippedFlameParticles/>` as the flame's first child in `(tabs)/index.tsx` (Agent 5's file; Agent 4 built the component). One line.
3. **Prefs — one source of truth** — Agent 6 owns the keys in `reward-settings` (synchronously cached, warmed on boot). Collapse Agent 4's `session-prefs.ts` into imports of Agent 6's accessors (`isSessionAudioEnabled` / `isKeepScreenAwakeEnabled` / `isRewardSfxEnabled`). Then collapse Agent 6's `sound` alias of `reward_sfx_enabled`.
4. **`duck_to_music`** — Agent 6 shipped the toggle + row; wire it in Agent 4's `sound.ts` via `setAudioModeAsync`. Until then it's a no-op switch.
5. **`session_complete` push category** — Agent 1's 0120 push has no `notification_category()` mapping, so it files under the wrong toggle. Add one line to that function **in Agent 1's migration block** (0120) mapping `session_complete` → its category.
6. **Agora route** — Agent 5's drawer row points at `/agora`; the 3-before-5 merge order provides it. Confirm the route resolves, not "Unmatched Route".

## Step 3 · Run the SQL (nobody has)
Every migration is **reviewed + schema-verified but unexecuted.** Apply **0119 → 0130 ascending against a scratch/staging DB first**, then prod. Use Agent 1's `supabase/verify_0119_0123.sql` (rollback-wrapped) + the ledger's roster==field sanity queries. Note prod already has 0111–0118 + the pg_cron finalize job running.

## Step 3.5 · Before prod — apply the economy cap (#148)
Long / large-field placement races cap at **legendary** (top box = Hephaestus' Chest), never mythic (Promethean Vault). Apply in the settlement reward path (0127 area) on the integrated branch, **before any challenge migration touches prod.**

## Step 4 · Verify the integrated tree
Full-tree `tsc --noEmit`; smoke each new surface (Agora feed at all 4 scopes, a placement challenge create→settle, a rank-up paying embers+box, cards/halos/flares/particles on a device, keep-awake during a lock-in, the drawer nav).

---

## RESOLVED decisions — all six are build items now
| Decision | Outcome | Where it runs | Task |
|---|---|---|---|
| Agora bucket | Stay **public** + hard-delete the storage object on removal | Step 0 (pre-merge, on `worktree-agora`) | #149 |
| `claim_pass_level` | Server validates reward **content**, not just shape | Own migration, **before Sept 10** | #144 |
| Economy | Long / large races cap at **legendary**, not mythic | Step 3.5 (before prod) | #148 |
| Per-campfire banner | `groups.banner_item_id`, owner sets it per-fire | Native-rebuild bundle | #146 |
| Background audio | `UIBackgroundModes:['audio']` + background play | Native-rebuild bundle | #147 |
| Per-type toggles | `type_<event>` gate so every switch is honest | Native-rebuild bundle | #150 |

## FINAL EXECUTION ORDER
1. **Step 0** — Agora photo cleanup on `worktree-agora` (#149).
2. **Merge** 1→2→3→6→4→5, union `types/database.ts`, wire the 7 seams (Step 2).
3. **Scratch DB** — apply 0119→0130 ascending + verify scripts / sanity queries (Step 3).
4. **Economy cap** (#148) on the integrated branch (Step 3.5).
5. **Full-tree tsc + smoke** every new surface (Step 4).
6. **Deploy** migrations staging → prod.

**Parallel tracks (do NOT gate the merge):**
- **`claim_pass_level`** (#144) — its own migration, verified + landed **before Sept 10**. Highest urgency of anything here.
- **Native-rebuild bundle** — batch #146 + #147 + #150 into **one** native rebuild. Each is a small migration/config that needs a fresh build anyway; don't cut three separate builds.

## Re-verify at season open (2026-09-10)
The whole Flame Pass economy (rank-up grant, pass XP, claim) is **untested code** — prod is `season_phase() = 'upcoming'` until the 10th. Re-run the reward paths then rather than assuming.
