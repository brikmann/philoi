# Code Prompt — deploy pass: flares (#171) + Cindy inline status (#173) + forge on-device verify (#170)

Line these three up onto one deployable build and ship them. All three are **client-side / OTA-able** — the forge's *migration* is already live on prod (0138 + the 0139 amendment, pushed and ledger-repaired), so nothing here touches the prod ledger. Follow the one-push-path discipline from `MIGRATIONS.md` regardless.

## §0 · Consolidate onto ONE deployable branch (prerequisite)
Verifying forge + flares + Cindy on one device means their code has to be on one branch. Integrate onto a single branch off the reconciled mainline (`worktree-device-smoke`, which now carries all five migrations 0136–0140 + the reward/email/rank/drawer/Agora fixes):
- **Forge client** — from `worktree-forge` (the `/forge` screen per mock 155, ladder module, RPC wrapper, hammer reveal, drawer Forge row, "Send to the Forge" on item detail). The **AccessibilityService fold-in** rode that branch too (flag on `preview`+`production`) — bring it along; it's already verified by prebuild.
- **Cosmetics/flares** — from `worktree-cosmetics-mocks` (the mock-matched flares/particles).
- Resolve merges cleanly; `tsc --noEmit` clean and lint no-new-errors after each merge. If any migration files collide, they must not — the ledger is already `0136–0140`; keep those exact files, add nothing new.

## §1 · Build #171 — flares ramp with lock-in time
Implement `CODE_PROMPT_flare_intensity.md` in full: the 4-tier time ramp (faint → toned-down max at 15/30/60), the threshold **surge + haptic**, the **"…flare up / flare max"** caption under the timer, per-session reset, previews at max, **Asgard/Zeus thin bolts**, **Emberfall Ascendant** (dots → rising flame glyphs + hellfire recolor `#F5401C`, both hardcodes), and the **gym dampening** (`GYM_FLARE_DAMPEN`). All levers behind named constants.

## §2 · Build #173 — Cindy "How am I doing?" answers inline
Implement `CODE_PROMPT_cindy_inline_status.md`: the lock-in `status` quick-action calls `sendToCindy(...)` and answers in the `CindyBubble` above the flame (loading → answer, dismissable, one bubble at a time), in both study and gym branches; `note`/`chat` still open the full chat; graceful failure.
- **Both #171 and #173 touch `src/app/lock-in/index.tsx`** — #171 at the `EquippedFlarePerimeter` mounts + timer caption, #173 at `handleCindyQuickAction` + the `CindyBubble`. Different regions; land them together and keep one coherent file.

## §3 · Verify + commit
`tsc --noEmit` clean; lint no new errors in touched files. Commit in logical chunks (branch consolidation, flares, Cindy), repo-style messages. Confirm nothing stranded across worktrees.

## §4 · Deploy (OTA)
All three are pure-JS/client. Ship via **`eas update`** on the channel the Pixel test build runs (`development` or `preview` — match the installed build's channel, since OTA only applies within the same runtime/SDK). Confirm the update lands: reload on-device and check the new build hash. No native rebuild is needed for #171/#173; the forge client is JS too. (The AccessibilityService only matters for a *fresh* Play build, not this OTA.)

## §5 · On-device verification — all three
**Forge (#170)** — migration already live, verify the flow: `/forge` renders (mock 155); feeding 3 same-rarity owned cosmetics → 1 of the next rarity with the hammer reveal; the output is **never one you already own**; wrong count / relic / season-item / mythic-input / unowned all refused; a fully-owned target tier **greys with `tier_complete`** and consumes nothing; drawer Forge row + "Send to the Forge" both reach it.

**Flares (#171)** — start a lock-in with a flare equipped: barely visible at first; a visible **surge + caption** at 15 / 30 / 60 ("…flare up", then "flare max"); max is the toned-down ceiling (not full-screen engulf); **Asgard reads as thin lightning, not lines**; **Emberfall Ascendant rises as flame glyphs in the hellfire orange-red**, not dots; a **gym** session's flare is clearly fainter than a study session's; inventory/shop preview shows the flare at max; a fresh session resets to faint; flame + timer legible throughout.

**Cindy (#173)** — mid-session, "How am I doing?" answers **in the bubble above the flame without leaving the session** (loading → answer, dismissable), in both study and gym; "Add a note" and "Chat" still open the full chat; a dropped connection degrades gracefully.

## §6 · Report
Which commit/branch shipped, what OTA'd to which channel, the on-device results per feature, and anything that needs a native rebuild rather than OTA (should be nothing here).

## Done =
One integration branch carries forge client + cosmetics + #171 + #173; `tsc`/lint clean; an `eas update` lands them on the test device; and all three verify on-device per §5.
