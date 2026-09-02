# Code Prompt — Cindy difficulty scoping for free-text goals (replace the `custom → floor`)

**Spec:** `DIFFICULTY_SCOPING.md` (rubric + calibration + Cindy prompt + anti-cheese). Extends `CHALLENGE_CINDY_SCOPING.md` + `CHALLENGE_REWARD_ALGO.md`. On `integration-wave1`. Migrations additive; **report prod snapshot age before any push** and restate nothing.

## The problem
Every custom goal/challenge — solo, duel, campfire — pays an **Ignition Crate (Uncommon)** regardless of how hard it is. That's the current *policy*, not a bug: `0116`/`0085` derive difficulty from `economy_config.goal_difficulty`, where `custom = {"moderate":0,"ambitious":0}` forces the `else 'easy'` arm, and the challenge grant maps everything to the floor box. We're replacing the flat floor with **Cindy scoring the intrinsic difficulty of the described feat** ("learn a backflip" → Epic; "run the Toronto Marathon" → Legendary), scoped to the median 18-20 Gen Z. See the calibration table in the spec.

## 🔴 The hard gate — do NOT raise the ceiling without the verifiability discount in the SAME change
Raising the custom ceiling **alone** reopens a mint hole: type "run a marathon", self-mark done, collect a Legendary box. The `custom → floor` rule was the plug. So the difficulty raise and the honor discount **ship together**:
- The **scoped tier** is the *achievement* tier (what the feat is worth).
- The **paid** reward runs through the **Auto / Vouched / Unvouched** gradient (`CHALLENGE_CINDY_SCOPING.md §Verification`): auto-tracked = full; self-reported + photo/vouch = full box −10%; **self-reported, unproven = box −1 tier, −20% currency, and NEVER the top box.**
- If the full vouch flow isn't landing in this change, **at minimum** ship the *unvouched floor*: a `verifiability='honor'` goal with no proof pays **box −1 tier** and cannot self-grant above **Rare** without a proof artifact. A raised ceiling with no discount is a rejected change.

## §1 · Store a scoped tier on the goal/challenge (Cindy writes it at create)
- Add `difficulty_tier text` (`common|uncommon|rare|epic|legendary|mythic`) and `verifiability text` (`auto|honor`) to the **goal** and **challenge** rows (wherever custom goals/challenges are created — trace `create_goal` / the challenge create RPC; `0155` one-time goals + `0149` custom-count goals are the recent create paths).
- **Cindy sets these at creation** via the scoping prompt in `DIFFICULTY_SCOPING.md` (JSON out: `difficulty_tier`, `verifiability`, `measurable`, `rationale`, `clarifying_question`). Firewall intact: **Cindy proposes the tier; the server computes and grants.** Never let the client pass a tier the server trusts blindly — the server re-derives the payout from the stored tier + config, and the tier itself is written server-side from Cindy's structured output (validate it's one of the six).
- **Measurability gate:** if Cindy returns `measurable:false`, the goal is floored at **Uncommon** and the create UI surfaces her `clarifying_question` ("Landing a specific song start-to-finish? I can scope that."). No tier above Uncommon without a specific, checkable target.
- **Unknown/unfamiliar feat → conservative:** resolve to the lower plausible tier (spec §Cindy prompt step 2).

## §2 · Make the payout read the tier (kill the `custom → 'easy'` floor)
- **`economy_config`:** replace the 3-level `goal_difficulty` (easy/moderate/ambitious) usage for **custom** goals with the **6-tier** map. Keep the auto-tracked types (steps/hours/distance/grade) on their existing threshold derivation — this change is about *custom/free-text* goals, which now carry an explicit `difficulty_tier` instead of the `{0,0}` sentinel. Add a `tier_payout` config block: tier → `{box_key, embers, xp}` per the table in `CHALLENGE_CINDY_SCOPING.md` (Ignition Crate / The Furnace / Vessel of Hestia / Hephaestus' Chest / Promethean Vault). All amounts stay **server config**, not client constants.
- **The daily drip (`0116`/`0085`):** for a custom goal, map its `difficulty_tier` → the small daily-ember drip (don't pay a box every day — the box is a *completion/settlement* reward). Suggested: common/uncommon→~12-18, rare→~22, epic+→~25 (cap the drip; the tier's real value is the completion box, per `CHALLENGE_REWARD_ALGO.md §Guardrails` weekly ~300 ceiling). Remove the hard `when v_goal.type = 'custom' then 'easy'` arm — custom now resolves through its stored tier.
- **The completion / settlement grant (`grant_reward` → `reward_payload {embers, box, box_id, badge, band}`, stored per `0118/0125`, read by `get_challenge_reward` / `0154`):** set `band` = the scoped `difficulty_tier` and pick `box_key`/`box_id` from `tier_payout`, **then apply the verifiability discount** before writing `reward_payload`. So the reveal shows the *scoped, discounted* box — not a hard-coded Ignition Crate.
- **Solo one-time skill goals** (`0155`): completing one grants its scoped box via the same `grant_reward` path (currently they likely only drip). A one-time "learn a backflip" that completes (honor) should pay the Epic-tier box −1 = **The Furnace**, upgradable on proof — not an Ignition Crate.

## §3 · Show the scoped reward at creation (the honest tease)
On the create/confirm screen (Cindy flow + the "build it yourself" form, mocks 140/143), after Cindy scopes it, show the **server-computed** reward preview before the user commits:
> **Cindy scoped this: EPIC.** Most people never land a backflip. → **Vessel of Hestia** + embers + XP. *Proof or a friend's vouch unlocks the full box; unverified pays one tier down.*

Pull the numbers from the server preview (a `preview_challenge_reward(params)` read, or reuse `compute`/`grant` in a dry-run mode) — never let Cindy state final ember/XP numbers herself (spec firewall).

## §4 · Duel / campfire scoping
Same tier engine; the existing **duration/scope multiplier + placement** (significance × scope × duration × placement, `CHALLENGE_REWARD_ALGO.md`) stacks on top. A "first to land a backflip" duel: winner takes the scoped Epic tier (through their verifiability path), losers get consolation XP. A campfire "everyone hits a target" pays each finisher the scoped tier. The **race/target/collective shapes** already exist (`CHALLENGE_CINDY_SCOPING.md §Shape`); this only changes *which tier* the custom metric resolves to.

## §5 · Cindy prompt + few-shot
Wire the scoping prompt from `DIFFICULTY_SCOPING.md §"Cindy's scoping prompt"` into Cindy's challenge-authoring path, few-shot-anchored on the **calibration table** in the spec (keep the table as the single source; load it as the anchor set). Output is structured JSON only; the server validates and stores.

## Verification / Done
- **Report what was actually floored vs already tiered** before you touch it (trace `0085`/`0116`/`grant_reward` + the challenge create RPC; name the exact CASE arms and config keys).
- **Prove the anti-cheese holds:** a self-reported "ran a marathon" with no proof must pay **≤ the unvouched-discounted tier** and cannot mint the top box. Show the payout for: (a) Strava-synced marathon (Auto → full Legendary), (b) typed-done marathon, no proof (honor → discounted, capped), (c) vouched backflip (full Epic −10%). 
- **On-device / SQL demo:** create "learn a backflip" (should scope Epic, pay The Furnace unvouched) and "10-min walk" (Common, embers only) and confirm the reveal shows the *scoped* box, not an Ignition Crate.
- Migrations additive; snapshot-age check before prod push; coordinate the migration number with the parallel session (last on tree is `0158`).
