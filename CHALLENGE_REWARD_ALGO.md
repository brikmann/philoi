# Challenge & goal reward calibration (extends REWARD_ECONOMY.md)

## The engine already exists
`REWARD_ECONOMY.md §3`: `grantReward(context) → {embers, box, badge}`, where
**significance = difficulty × competitionScope × duration × placement** → a payout band. §5 guardrails already say
earned rewards are prestige + **modest embers, never ember floods that undercut paid packs**. So the *fairness*
(scales with ambition) and the *anti-cannibalization* (won't step on the economy) are already the design.

**Gap this fills:** the engine covers challenge *wins* and *season placement*, but (a) the ember numbers are abstract
("small/med/lg"), and (b) the **daily personal-goal + streak** path (your "10k steps every day for a week") wasn't
concretely calibrated. Below is that path + launch-default numbers.

## Daily personal goal — the drip
Each day you hit the goal, a small ember drip scaled by the same `difficulty` signal the XP algo uses:
- easy goal → ~12 embers · moderate → ~18 · **ambitious** (10k steps, 2h+ lock-in) → ~25.

## Streak milestones — the "week of 10k steps" reward
On top of the daily drip, an unbroken run banks a milestone bonus:
| Streak | Bonus |
|---|---|
| 3 days | +30 |
| **7 days** | **+60** |
| 14 days | +150 |
| 30 days | +400 **+ a box** |

**Worked example — 10k steps every day for a week (ambitious):**
`7 × ~25 daily = 175` **+ 7-day milestone 60 = ~235 embers.` ✅ (your "~200 or more"). An *easier* daily goal for a
week lands ~120–150 — the reward scales with ambition, exactly as intended.

## Concrete band numbers (fills the abstract sizes in §3, launch defaults)
| Band | Embers |
|---|---|
| Completion floor | 10 |
| small | 20 |
| med | 45 |
| med-lg | 90 |
| lg | 200 |
| xl (rare apex) | 500 |

## Guardrails — does NOT step on the Flame Pass or the packs
- **Weekly earned-ember ceiling from goals ≈ 300.** A perfect week ≈ 235; the cap stops someone stacking a dozen
  goals for unbounded embers. A perfect *month* ≈ ~1,000 (≈ one Chest, CA$9.99) — but that's **30 days of real daily
  effort**, so buying is still the fast path.
- **The Flame Pass's value is EXCLUSIVE cosmetics, not embers** — the mythic flare / banner / title are un-earnable.
  Goal-earned embers never touch the pass's core value, so the two economies don't collide.
- **Embers = the scarce/monetized currency; XP = the abundant free one.** So friend duels pay mostly **XP** (the
  "Winner +200 XP" headline) + only **small embers on a win (~25–40)** — the ember faucet stays slow.
- **All amounts are server config, not client constants** (per §5) — rebalance post-launch with no release.

**Net:** ambitious goals feel genuinely rewarding (~235 for a perfect week), the faucet is capped, and paid
(speed + exclusive cosmetics) stays clearly the better deal. Fold these numbers into `REWARD_ECONOMY.md §3/§4`.
