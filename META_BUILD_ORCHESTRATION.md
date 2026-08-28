# Meta-prompt — parallel build orchestration (logic + UI)

Everything is scoped. This splits the build across **6 agents running in parallel**, each in its own isolated worktree, with reserved migration blocks and non-overlapping file ownership — so nothing collides the way the last campfire pass did (three agents uncommitted in one tree).

---

## GOLDEN RULES (every agent, no exceptions)
1. **One worktree per agent.** Each agent branches off `integration-base` into its **own git worktree**. Never two agents in the same working tree. Commit only your own files; never another agent's.
2. **Migration blocks are reserved.** Use **only** your assigned range. Creating a migration outside your block is the #1 collision risk — two files sharing a leading number roll back silently.
3. **Shared files are additive-only.** `src/types/database.ts` is touched by several agents — **append** your types in a clearly-commented block; never reorder or delete another agent's lines. Integrator unions them.
4. **Agreed pref keys** (so Settings ⇄ Cosmetics don't clash): `session_audio_enabled`, `keep_screen_awake`, `reward_sfx_enabled` — defined in `reward-settings`, owned by **Settings**, read by **Cosmetics**.
5. **`tsc --noEmit` clean on your branch before handoff.** Report what you committed, which migrations (final numbers), and what you flagged.

---

## WAVE 0 · Establish the base (coordinator / Noah — do FIRST, alone)
The tree currently holds uncommitted campfire/challenge + flame + Cindy work mixed together (see `CAMPFIRE_BUG_LEDGER.md` *Process deviation*). Before any agent spawns:
1. Commit each in-flight bucket to its proper branch (challenge pass, flame, Cindy) — no cross-contamination.
2. Merge `fix/app-sweep` so migrations **0112–0118** are all landed.
3. **Deploy the challenge lifecycle:** `0112 → 0113 → 0114 → 0115 → 0116` in order (0116 after 0114). Verify the reward reveal per the ledger's sanity queries.
4. Tag/branch **`integration-base`** at this point. Every agent branches off it.

Nothing below starts until `integration-base` exists with 0112–0118 deployed.

---

## THE 6 AGENTS (all Wave 1, parallel off `integration-base`)

### Agent 1 · LOGIC — the drafted 0119+ batch
- **Migrations:** `0119–0123`.
- **Build:** relic progress feeder (steps→km + all discipline ladders), `session_complete` push, rank-up reward grant (embers+box on div/tier up), verify H2H tie pays across shapes, verify Forge-Pass ember grant fires.
- **Owns:** its migrations + relic/rank/economy trigger libs + push wiring. **Refs:** `LOGIC_SCOPE_BEFORE_UI.md`, `CODE_PROMPT_logic_fixes.md`, `LOGIC_AUDIT_2026-08.md`.

### Agent 2 · CHALLENGE v2 — the red gaps
- **Migrations:** `0124–0127`.
- **Build (per `CODE_PROMPT_challenge_v2.md` Phase B):** custom durations + date picker, group public-name field, placement/ranked shape (create + settle + standings, mock 114), box-"Open" from result (challenge→`loot_boxes` id link).
- **Owns (exclusive):** `src/app/challenge/*`, `challenge-info/*`, `watch/*`, `challenge-change/*`, challenge components, `social-challenges` api. **Out of scope:** Cindy-authored challenges + vouching. 🔒 reward firewall.

### Agent 3 · AGORA — backend + UI (greenfield, self-contained)
- **Migrations:** `0128–0130`.
- **Build:** `agora_posts` + `agora_comments` + feed RPC (query over milestones + posts at friends/campus/university/global scope, reuse `milestone_cheers`); then the feed screen + post composer + Photo/Achievement/Lock-in pickers + comments sheet.
- **Owns:** new `agora_*` migrations, new `src/app/agora/*` route, new components. **Refs:** `AGORA_SPEC.md`, mocks 160 + 162. Author cards render equipped halo/card (coordinate with Agent 4's `applied-art`).

### Agent 4 · COSMETICS — applied-layer fixes + audio + keep-awake
- **Migrations:** none.
- **Build (per `COSMETIC_UI_FIXES.md`):** cards (`EquippedCardBackdrop`), halos (`EquippedAvatarHalo` centering/scale), flare init/blob fix + Zeus'-wrath gold + **build the applied particle layer** (`flare-perimeter`), audio off-toggle + per-session switch (`sound.ts`), **install `expo-keep-awake`** + hold-screen in `lock-in/index.tsx` (gated on `keep_screen_awake`).
- **Owns (exclusive):** `item-art.tsx`, `applied-art.tsx`, `flare-perimeter.tsx`, `campfire-banner-art.tsx` (render only), `sound.ts`, `equipped-audio.ts`, `lock-in/index.tsx`. **Refs:** mocks 164–167. **Reads** prefs owned by Agent 6.

### Agent 5 · CHROME — nav shell + icon sets + campfire badge
- **Migrations:** none.
- **Build:** single side-drawer nav + custom vector icon set (inactive grey → active orange, mocks 157–161); swap `GOAL_TYPE_ICON`/`CHALLENGE_TYPE_ICON` to the mock-163 discipline set; unified **`CampfireBadge`** (emoji + pulsing activity aura, mock 168) applied to valley nodes, lists, discover/invite/search, header; the campfire **banner-set affordance** (owner picks a banner, mock 164).
- **Owns (exclusive):** `src/app/_layout.tsx` (nav), `(tabs)/index.tsx` (valley), `campfire-header.tsx`, `discover-circle-card.tsx`, `campfire-options-sheet.tsx`, `goal-types.ts`, new `CampfireBadge` + icon components. **Refs:** mocks 157–161, 163, 168, 154.

### Agent 6 · SETTINGS — cleanup + toggles + prefs
- **Migrations:** none.
- **Build:** settings reorganization (#126/#134), per-type notification toggles, the **Audio section** (session-audio toggle) + **keep-awake row** + feedback/contact form; **define the shared pref keys** in `reward-settings` (rule 4).
- **Owns (exclusive):** `settings.tsx`, `settings-notifications.tsx`, `reward-settings` (pref definitions). Agents 4 read these prefs.

---

## Dependency notes
- **Only cross-agent coupling:** Agent 4 (Cosmetics) reads pref keys **defined by** Agent 6 (Settings). Both proceed in parallel using the agreed key names in rule 4 — no blocking.
- Agent 3's Agora author cards use Agent 4's `applied-art` halo/card — additive, no contention (Agora only *calls* it).
- Everything else is disjoint. `types/database.ts` unions per rule 3.

## Integration order (after all 6 report tsc-clean)
1. Merge branches in this order, resolving `types/database.ts` as a union: **1 (Logic) → 2 (Challenge) → 3 (Agora) → 6 (Settings) → 4 (Cosmetics) → 5 (Chrome)**.
2. Apply migrations **ascending: 0119 → 0130**.
3. `tsc --noEmit` on the integrated tree; run the Wave-0 sanity queries again + a smoke of each new surface.
4. Report the final migration numbers, any union conflicts resolved, and any gap flagged rather than built.

**Spin-up:** launch Agents 1–6 as parallel worktree agents once `integration-base` exists; each gets its section above + the golden rules as its brief.
