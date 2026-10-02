# Integration order — cosmetic wave + bug batch + rank display

Everything that's now in flight: Agent A (migrations 0222/0223), Agent B (`agentB-item-art`), Agent C
(`agentC/surfaces`), Agent D (`agentD-unlock-reveal`), my client bug-fixes (notifications header,
lock-in stub, campfire render), migration 0224 (stale-lock-in P0), and the seasonal-seats migration
(0225, to build). Nothing has touched a device yet. Goal: one green integration branch → one preview
build → QA → main.

## Dependency facts that set the order
- **A is the floor.** B/C/D all read A's catalog fields, archetypes, new items (Marble, Sakura) and the
  `medal-s1-*` seeds. Until 0222/0223 are applied, `npm run typecheck` fails its seeding check and
  `check:cosmetic-rarity` fails — those clear the moment A lands, so don't chase them before.
- **B before C before D.** C's surfaces use B's renderers; D's reveal uses B *and* C. D also needs B's
  new shared files (`colour.ts`, `cosmetic-clock.ts`, `flare-signature.tsx`, `gradient-title.tsx`).
- **Migrations apply in number order:** 0222 → 0223 (0223's guard refuses until 0222 is applied) → 0224
  → 0225.
- **`_layout.tsx` is the one hot file** touched by both Agent C and my notifications fix — reconcile once.
- `heat-flame.tsx` (mine) and `circle-timeline.tsx` (mine) are untouched by any agent — no conflict.
- **Whole-file-copy hazard:** B/C/D each copied whole files off a snapshot of main's *uncommitted*
  work, so a blind `git merge` will show the same edits "arriving twice." Integrate by **owned files on
  top of the current working tree**, A→B→C→D, not three-way merges.

---

## Phase 0 — Git hygiene (do first; blocks every commit/merge)
0.1 Confirm no `git.exe` is touching the repo, then remove the stale `.git/packed-refs.lock` (empty,
    dated Sep 27). It can block git writes mid-merge.
0.2 Settle the stale leases (agentC took a stale one; agentD committed under a held lease). Establish a
    single writer before assembling.
0.3 Cut a fresh **integration branch** off current main. Main is never left in the broken
    (mangled `cosmetic-in-context.tsx` / `unlock-reveal.tsx`) state — the repair arrives with B/D.

*(Git actions are yours — I don't push/commit/clear locks.)*

## Phase 1 — Database (parallel with Phase 0; number order; you apply)
1.1 Apply **0222** then **0223** to prod together, then commit them. Clears the seeding typecheck
    failures and unblocks B/C/D's catalog deps.
1.2 Apply **0224** (stale-lock-in P0 crash) — already written, next in sequence.
1.3 Build **0225** from `CODE_PROMPT_rank_display_seasonal.md` (seasonal seat on every rank badge),
    then apply. Server-only, independent of the agents.
1.4 Deploy **ai-coach** so Cindy's unlock copy (A) updates — but first `git diff HEAD -- supabase/functions/`
    to confirm no sibling session's uncommitted function code rides along.

## Phase 2 — Assemble the integration branch (A→B→C→D)
2.1 **A (client side):** fold in any TS catalog-field additions A made (the migrations themselves are
    Phase 1).
2.2 **B (`agentB-item-art`, 217ab3a + fix ca8cecc):** bring in the 5 renderer files + relic/flare/medal
    work + the shared `colour.ts`/`cosmetic-clock.ts`/`flare-signature.tsx`/`gradient-title.tsx`. This
    also **repairs** the mangled `cosmetic-in-context.tsx` / `unlock-reveal.tsx` in the integration tree.
2.3 **C (`agentC/surfaces`, 9b8f846):** bring in profile-hero/flare-border/season-chip/loadout/
    profile-showcase + edits. **Fix the RN 0.86 break:** `StyleSheet.absoluteFillObject` is gone →
    use `StyleSheet.absoluteFill` (or spread `...StyleSheet.absoluteFillObject` where an object is
    needed) in `profile-hero.tsx` and `season-chip.tsx`.
2.4 **D (`agentD-unlock-reveal`):** bring in unlock-reveal/multi-item-reveal/reward-rays. D's
    `unlock-reveal.tsx` + `cosmetic-in-context.tsx` **supersede** B's stopgap repairs (D rewrote them).
    Then the two one-line drop-ins D flagged: `<CosmeticContextPair item={…}/>` into the inventory and
    loadout screens (C's files).

## Phase 3 — Fold in my client fixes + notif art (same branch)
3.1 `circle-timeline.tsx` (lock-in share stub + clipped tag) — standalone.
3.2 `heat-flame.tsx` (campfire log render) — standalone.
3.3 `_layout.tsx` — reconcile my `notifications` Stack.Screen registration **with** Agent C's `_layout`
    edits (one merge, both changes kept).
3.4 **Build the notif art** from `CODE_PROMPT_notification_art.md` (`notifications.tsx`). Slots in here
    because it needs B's `ItemArt`/`MedalArt` and A's catalog for the lookup.

## Phase 4 — Green the tree
Typecheck + lint the whole integration branch. Seed failures should be gone (0222/0223 applied); fix
any residual (absoluteFillObject, stray imports). Don't ship red.

## Phase 5 — One preview build + device QA (the whole thing at once)
Cut a single preview build. QA sweep:
- **Cosmetic wave:** 7 art families at shelf (27pt) + hero; 3-beat reveal; multi-item box (rarest-first,
  salvage receipt, "open another?"); flare-border lifecycle (calm→ramps while locked in; Valor/Wrath
  strike down; Void Plasma/Inferno fixed); medals (beaded disc, placement bronze→diamond, podium);
  13 relics; season chip on season items; Pass-claim / challenge-finisher / relic routes all use the
  one reveal.
- **Bug batch:** stale "Still locked in?" row no longer crashes; notifications = one clean header;
  dormant campfire = logs not eggs (valley + share card); shared lock-in full-width with uncut time tag;
  Agora badge now matches the Gold II chip (and board **order** unchanged); bell shows composed faces.

## Phase 6 — Merge integration → main, commit, then settle the reversible calls
Only after QA. Then decide the flagged toggles (below).

---

## Parked decisions (not blocking — settle at Phase 6)
- **Every equipped card animates now** (was Epic+ only) → more motion in the Agora feed. One-line gate
  restores the old behaviour. Keep or revert?
- **Valor/Wrath show nothing when frozen** (reduced-motion/off-screen) so a static bolt doesn't read as
  a crack. Fine?
- **Crown halo slightly larger** (room for the lava crown). Fine?
- **Campus #1 gets two medals** (Campus Sovereign + Emberfall Champion). Mock 246 implied Emberfall
  Champion was meant for **Divine I** instead — A left it as-is. Decide.
- **Season-long medals reuse one key** across seasons (re-earn → embers, not a 2nd medal). Consistent
  with existing Emberfall medals; confirm that's intended.

## Known follow-ups (separate work, after this wave)
- **Rank-up doesn't emit cosmetics yet.** D's `showUnlockReveal(item)` is wired, but the server rank-up
  payload carries no cosmetic — a server change to include unlocked cosmetics in `ranked_up` closes it.
  (The notif-art rank badge works regardless.)
- **Seasonal rank rollover** (full reset each season) — its own batch; it assumes 0225's seat-display is
  already live, which this wave delivers.
