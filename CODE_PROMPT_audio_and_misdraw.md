# Code Prompt — wire the victory fanfare into the reward cues + correct the two mis-paid draws

Two independent jobs. §1 is a small OTA/JS wiring. §2 is a careful one-off prod **data** correction (not a migration — do NOT add a numbered migration file; the ledger is being verified separately under #188, don't touch it). On `integration-wave1`, one branch/one Metro.

---

## §1 · Wire the victory fanfare into the reward reveals (#185)
The reward-rays `REVEAL_TUNING` table currently points the **pass-level** and **challenge** cues at `settle`/`spark` placeholders because no bespoke audio existed. The asset now exists.

- **Assets:** `victory-fanfare.mp3` (3.84s) and `victory-fanfare-short.mp3` (2.53s) are in the session outputs folder (`…/outputs/`). Copy them into the app's SFX assets directory (wherever the existing `RewardCue` sounds live — `sound.ts` references them).
- **Register:** add a new `RewardCue` (e.g. `victory`) in `src/lib/sound.ts`, mapped to the fanfare, matching how the existing cues are declared/loaded.
- **Point the cues:** in `REVEAL_TUNING`, set the **pass-level, challenge (personal/team/placement), and task-complete** rows' `cue` to the new `victory` cue. Rank-ups keep their `rankup-<tier>` ladder — do NOT change those.
- **Which variant:** start with the **short** (2.53s) for the frequent events (task complete, pass level) and the **full** for challenge victories — but expose it via `REVEAL_TUNING` so Noah can A/B on-device. If unsure, use short everywhere and note it.
- Client/OTA — rides the wave1 Metro, no rebuild.
- **NOT this task (native, next build):** `ember-spark.mp3` is the *notification-channel* sound (Android `res/raw` + the `accountability` channel's sound config). Leave it for the next native build; don't try to wire it as a `RewardCue`.

**Done:** pass-level and challenge reveals play the real victory fanfare (not `settle`/`spark`); rank-up ladder untouched; the fanfare cue/variant is tunable from `REVEAL_TUNING`.

---

## §2 · Correct the two mis-paid draws (Noah's call: correct them)
The winner-determination bug (server metric read a start-stamped column → called races draws) is fixed forward. But **two duels on prod settled as draws and were *paid* as draws when one racer actually led.** Noah wants them corrected. One is `85e9c268…` (the screenshot); find the other.

**This is delicate — real paid rewards, no reversal path. Verify-first, additive-only.**

1. **Identify** both affected duels: settled duels where `winner_id IS NULL` (draw) but the **now-correct** metric (`challenge_metric_value` after the fix) shows a clear leader. Report the two rows (ids, the two racers, their real metric values, what each was paid) **before changing anything**.
2. **Report the reward math** for each: what the winner *was* paid (the tie/draw payout) vs what they *should* have been paid (the winner payout). Do this per row and show Noah the numbers.
3. **Correct, additively:**
   - Set `winner_id` to the real winner (so the result + display read correctly — "X won", not "It's a tie").
   - **Reconcile the reward additively only:** grant the winner the **difference** between the winner payout and the draw payout they already received (so the winner ends up correctly paid). **Never claw back** the loser's draw payout — there's no reversal on the reward path; the small over-pay to the loser stays. If a duel's winner payout is *less* than the draw payout (unlikely), grant nothing and just fix `winner_id` — never a negative grant.
   - Touch **only these two rows.** No other settled challenge.
4. **Backup posture:** PITR is on (7-day). Report snapshot age before the writes; verify the two rows before and after; confirm no other row changed.

**If the reward math is ambiguous** (e.g. the duel's winner-vs-draw payout shapes don't cleanly subtract), **STOP and report to Noah** rather than guessing a grant — these are only two rows and both are Noah's test duels, so a wrong grant isn't worth a guess.

**Done:** both duels read the correct winner, the winner is made whole with an additive grant, the loser's payout is left untouched, only two rows changed, with a before/after report of the metric values and reward numbers.

---

## Guardrails
- §2 is a data correction, **not** a migration — add no numbered SQL file; don't touch `schema_migrations` (the ledger is under separate verification, #188).
- Additive rewards only, no clawbacks, exactly two rows, verify-first, snapshot age reported.
- §1 is OTA; §2 writes prod data — keep them as separate commits/steps.
