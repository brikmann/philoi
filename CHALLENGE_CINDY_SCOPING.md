# Cindy-Authored Challenges — Scoping
_Custom, natural-language challenges as the default for every type (solo · duel · group), with an algorithmic reward and a verification model._

## The problem this fixes
Solo challenges have real variety (study hours, steps, workout minutes, Whoop strain). But **duel/group metrics are arbitrary and redundant** — "Most lock-in minutes" and "Most XP" are effectively the same number. That's a thin, uninspiring set for the most social part of the app.

## The shift: Cindy is the default author for ALL challenges
Instead of picking from a fixed metric list, you tell Cindy what you want — for yourself, against a friend, or across a group — and she structures it. This gives creative clarity and maps to the goals students actually track:
- **Ipsative** (self-referenced): "Get a 70% in Physiology," "Bench 225," "Study 20h this week."
- **Group-referenced** (competitive): "First to run 100 km," "First to learn a backflip," "Most focused hours this week."

Any type can be a **target** ("hit X") or a **race** ("first to / most X"). Cindy decides the shape from the phrasing.

## Architecture — Cindy proposes, the server computes, the server grants
This preserves the existing firewall (**Cindy grants nothing**):
1. **Cindy parses** the natural-language ask into **structured params**: `metric`, `target`, `shape` (target|race), `duration`, `participants`, `difficulty_class`, `verifiability`.
2. **The server computes the reward** from those params with a deterministic function (below). Cindy only *displays* it.
3. At settlement, the server **grants** per the verification path. Cindy may *read* proof (vision) and report, but never decides the payout.

## The reward algorithm (server-side, deterministic)
Reward = a **rarity tier** → `{box, embers, pass XP}`, then scaled by duration/scope.

**Rarity tiers → payout** (reuse the real boxes):

| Tier | Box | Embers | Pass XP |
|---|---|---|---|
| Uncommon | Ignition Crate | 60 | 100 |
| Rare | The Furnace | 150 | 200 |
| Epic | Vessel of Hestia | 300 | 350 |
| Legendary | Hephaestus' Chest | 600 | 600 |
| Mythic | Promethean Vault | 1200 | 1000 |

_(Numbers are the starting point — tune against the ember economy.)_

**Base tier** comes from the ambition of the ask. For **grade** challenges it's a fixed ladder (below). For **auto-tracked** metrics (hours/distance/volume) it scales with how far the target is above the person's recent baseline (ipsative) or the field (race) — the effort formula already used by `grant_reward` (difficulty × log(scope) × duration).

**Modifiers:**
- **Course difficulty (+tier)** for grades — STEM is harder than humanities (see below).
- **Duration/scope multiplier** — a month-long or 8-person challenge pays more than a one-day duel.
- **Verifiability (honor discount)** — see verification model. Auto-tracked = full; honor-based = box −1 tier + trimmed currency.

Cindy shows the result at creation: *"This challenge is worth a Furnace, 150 embers, and 200 XP."*

## Grade challenges — the specifics you called out
**Default grade = 50%** if the target is missing or nonsensical ("a 5% grade" is not a goal — floor it to passing).

**Grade band → base rarity:**

| Grade | Base tier |
|---|---|
| 50–59% | Uncommon |
| 60–69% | Rare |
| 70–79% | Epic |
| 80–89% | Legendary |
| 90–100% | Mythic |

**Course difficulty → tier bump** (Cindy classifies the course from its name):
- **Hard STEM** (anatomy, physiology, organic chem, physics, advanced math): **+1 tier**
- **STEM** (biology, chemistry, intro math, CS, engineering): **+1 tier**
- **Humanities / other** (philosophy, English, history, art): **+0 tier**

So the **achievement tier** for **"50% in Physiology" → Uncommon +1 = Rare**; **"50% in Art" → Uncommon**. Cap at Mythic. (A 90% in Physiology = Mythic +1, clamped to Mythic.)

**Course codes → an embers/XP modifier (not a box change).** Cindy asks for the **course code** (e.g. `KP451`), because a topic name alone is ambiguous: "Human Physiology" at Laurier ≠ at UofT, and *Advanced* Biomechanics (KP451) is harder than *Intro* (KP251). This difficulty lives *within* the STEM tier — it stays a STEM course, so the **box tier is unchanged** — and instead scales **embers & XP by ±25% (bounded)**:
- **Course level** (the number): 100/200 = intro (neutral to slight −), 300/400+ = advanced (up to +25%). `KP451 > KP251` even in the same subject.
- **Institution rigor**: where Cindy has a defensible read on relative pass/fail difficulty, a small nudge (harder school → toward +). **Cindy does not have live pass-rate data**, so this is coarse, reasoned, and **defaults to neutral when unsure** — never a fabricated precise number, and always bounded so it can't be gamed by naming a scary code.

So `KP451` and `KP251` both sit in the same box tier for the same grade, but the advanced code pays more embers/XP. No code given → Cindy asks once; if still none, treat as mid-level (neutral).

Then, because grades are **Honor** class, the honor discount applies to the payout: box −1 tier, currency −20%. Worked:

| Ask | Achievement tier | After honor discount |
|---|---|---|
| 50% in Art | Uncommon | no box · ~48 embers · 80 XP |
| 50% in Physiology | Rare | Ignition Crate (Uncommon) · ~120 embers · 160 XP |
| 70% in Physiology | Legendary | Vessel of Hestia (Epic) · ~480 embers · 480 XP |
| 90% in Physiology | Mythic | Hephaestus' Chest (Legendary) · ~960 embers · 800 XP |

The table shows the **Unvouched** payout. If 1–2 friends vouch, it upgrades to **Vouched** — the full box tier back, currency at −10%. Example: 70% in Physiology, vouched → Hephaestus' Chest (Legendary) · ~540 embers · 540 XP (vs the unvouched Vessel of Hestia · 480 · 480). A comparable **Auto** challenge (100 km race, Epic) pays its full tier with no trim — so the order Auto > Vouched > Unvouched always holds.

Cindy keeps a small difficulty map and reasons about unfamiliar courses by field; unknown → treat as Humanities (conservative, lower reward) so a made-up course can't inflate the payout.

## Verification — honor system with a discount (DECIDED)
A student can *say* "I got a 70%" (or "I landed the backflip") when they didn't. We deliberately **do not** try to verify it. Reading grades / matching student numbers against a university platform is a serious security liability and, for a new app, impractical — so that path is off the table. Instead we **remove the incentive to lie** with a simple structural discount:

**Three reward tiers by how checkable the outcome is** — a gradient, never a hard gate:
- **Auto** — the app tracks it (lock-in hours, steps, distance, workout volume, Whoop strain). Cheat-resistant. **Full computed reward.** The big farmable currency lives here.
- **Vouched honor** — self-reported, then **1–2 friends approve** it (see flow). A soft signal, not proof (friends can collude), so it pays close to full but not quite: **full box tier · −10% currency.**
- **Unvouched honor** — self-reported, nobody vouches. **Box −1 rarity tier** (Legendary→Epic, Rare→Uncommon; below Uncommon → no box) · **−20% currency.**

So the honesty gradient is **Auto > Vouched > Unvouched**, and vouching is *worth doing* (you keep the full box and only lose 10%) without ever being *required* (no-vouch still settles, just discounted). Collusion only ever buys you the middle tier — never more than genuine app-tracked effort — which is exactly the ceiling we want on a gameable signal.

**The vouch flow.** When an honor challenge ends, its result posts as **"pending"** and the player taps 1–2 friends to request a vouch. Each friend gets a prompt ("Noah says he got 70% in Physiology — did he?") and taps **Vouch** or **Nah**. Reaching the vouch count within a window (e.g. 48h) upgrades the reward to the Vouched tier; the window closing settles it as Unvouched. Results land in the campfire/opponent feed regardless, and report-to-flag exists for egregious abuse.

**Anti-collusion caps** (stop rings from rubber-stamping each other):
- **Same-pair limit:** friend A's vouch for player B only counts toward the requirement **twice per 30 days** — a third within the window is recorded but doesn't upgrade the reward. Kills "you vouch me, I vouch you" farming.
- **Reciprocity dampening:** if A and B are each other's frequent vouchers (mutual vouch rate above a threshold), their vouches for one another stop counting until the rate cools.
- **Giver rate limit:** a person can give at most ~5 counting vouches per week, so one account can't authenticate the whole ring.
- The two required vouches must come from **two distinct friends** (already), and a person can't vouch their own challenge.

These are counting rules only — they never block settlement (a capped-out challenge just settles Unvouched), so honest occasional vouching between real study partners still works. Enforce in `submit_vouch` against the `challenge_vouches` history.

**Notifications + routing (mock 142).** Three new event types on the existing `notify_event` pipeline (bell + eligible OS push, custom leading art):
- `vouch_requested` → each asked friend. Title "Noah wants you to vouch", body the claim, **leading art = requester's avatar**. Route `/vouch/[challengeId]` → the vouch prompt (mock 141-2). This is the entry into the vouch screen. (A "Tap to vouch" affordance in the row/push.)
- `vouch_received` (optional, light) → requester, when each friend vouches: "Maya vouched for you." Bell-only, no push (low-value).
- `vouch_passed` → requester, when the 2nd **counting** vouch lands inside the window: "2 friends vouched — reward upgraded." Route `/challenge/[id]/reward` and play the **upgrade animation** (mock 142-A: box tier bumps, embers/XP tick up).
- `vouch_settled` → requester, when the window closes below threshold: gentle "Vouch window closed — you kept your reward." Route to the **base reward** screen (mock 142-B), non-punishing.

**Settlement mechanics.** Honor challenge ends → reward computed + stored at the **Unvouched** tier, status `pending_vouch`, `vouch_deadline = now()+48h`. Each `submit_vouch` re-checks the counting rules; when the count hits the threshold in-window, `compute_challenge_reward(..., vouched)` recomputes to the **Vouched** tier, the stored `reward_payload` is upgraded, and `vouch_passed` fires. A cron (reuse the finalize sweep) closes expired `pending_vouch` challenges at the Unvouched tier and fires `vouch_settled`. **The reward never drops below Unvouched** — a "Nah" or an expiry only means "no upgrade", never a penalty.

**Why it holds:** the economy is fed mainly by Auto challenges and normal lock-ins, so the honor layer is a discounted creative bonus. The rational move is to do the verifiable thing for full value; the honor stuff stays mostly honest because lying nets a capped prize and is socially visible — and vouching adds a light, opt-in accountability beat without any grade-reading or ID matching.

## Client flow (mock 140)
Create challenge → talk to Cindy → she echoes the structured challenge + the **computed reward** + the **verification method**, then you confirm. Same flow for solo/duel/group; the only difference is participants.

## Creation — two paths, one structured challenge (mock 143)
Tapping **+** on the Challenge tab offers **Ask Cindy** (conversational, recommended) or **Build it yourself** (a guided form: type · metric · shape · window · participants). Both produce the same `challenge_params` and show the same server-computed reward preview before confirm. The manual form has a "…or describe it to Cindy" escape hatch, and Cindy's flow can hand off to the form to tweak a field. Neither path grants — the server does.

## Host admin — edit (with approval) & delete (mock 144)
The **creator is the host with admin rights** over their challenge.
- **Delete:** host-only, kills the challenge (no payouts; standings discarded). Confirm dialog.
- **Edit (through Cindy) — mock 146:** entering edit **dims the rest of the app** and focuses the challenge card. A **mic button** sits at the bottom; the host holds to talk, their words appear as text, Cindy recomputes, and the changed fields render **in green** as a live diff (each stat crosses out with its new value below). Tapping **Edit challenge** opens a **confirm step** where the host sets **who approves** and adds a **note to the group**, then sends. The challenge **pauses** until it resolves.
  - **Who approves (host picks):** **Everyone** · **Co-admins** · **Just me**. Default: **Everyone** for a small friend group, **Co-admins** for a large campfire (so 40 people don't each tap). Host appoints co-admins.
  - **Note to the group:** an optional message sent with the request ("bumping it — 50 was too easy 💪") so the whole group sees the why. Lands in the change notification + the status view.
  - **Reject + threshold (anti-cheat / faster resolution):** approvers can **reject**, not just ignore. If **over 50% of participants reject**, the change is **blocked** (doesn't proceed) — this also settles a pending faster than waiting on stragglers. **Admin / co-admin can override** to push or drop the change regardless of the vote.
  - The whole thing is visible any time via the challenge's **ⓘ status** (mocks 144/148): proposed diff, the note, who's approved/rejected, the reject tally, and host controls (Nudge / Cancel).

## Opt-in group challenges — for big / open groups (mock 149)
A 400-person "Laurier Gym Rats" chat shouldn't auto-enroll everyone. An **open challenge** posts with an **opt-in window**:
- It shows the goal, reward, and an **opt-in deadline** with a countdown + a live count ("47 opted in").
- Anyone in the group **opts in** by the deadline (no friendship required). At the deadline the **roster locks** to exactly those who opted in, and the challenge goes live among only them.
- Only opted-in members are scored; everyone who meets the goal completes (ties included). People who missed the window simply aren't in this run — they catch the next.
- Data: challenge state `opt_in` with `opt_in_deadline`; `challenge_participants` rows created on opt-in; at the deadline a sweep flips `opt_in → live` and freezes the roster.

## Distribution — where the request/hosting lands
Same rule as every other event: in-app **and** scoped to OS push so people outside the app still see it.
- **Friends challenge (a few people):** the invite / edit-request goes **direct to each friend's notification feed** (bell + push): `challenge_invite`, `challenge_edit_requested`.
- **Whole-campfire challenge:** a new `challenge_hosted` event — the notification reads **"X is hosting a challenge *<name>* for *<campfire>*"** (bell + OS push to every campfire member), **and** the challenge posts as a card **in the campfire chat** (join CTA inline). Edits to a campfire challenge post an update card in chat + notify the same way.

New event types on `notify_event`: `challenge_invite`, `challenge_hosted`, `challenge_edit_requested`, `challenge_edit_applied` / `challenge_edit_declined`. Campfire posts reuse the campfire message pipeline so the card is a first-class chat item.

## Metrics taxonomy — a tree, with lock-in hours as the umbrella (mock 145)
Metrics are picked from a **branching tree** (Focus vs Fitness → sub-branch → leaf), not a flat list, because they nest:
- **Focus (mind)** — leads with what students actually track:
  - **Grade** — a % in a course. An *outcome*, honor-based (per the verification model), not a time metric.
  - **Study hours** — conceptual learning.
  - **Deep Work** — assignments / application (i.e. "assignments", the applied counterpart to conceptual study).
  - **Custom** — course-code types (KP251, BU111…). See custom lock-in types.
  - **Lock-in hours** — the *umbrella* summing every focus type. Racing on it = "most focus, any type"; on a leaf = "that type only".
  A course code can be tagged Study (conceptual) *or* Deep Work (assignments), so both log separately under the same class.
- **Fitness (body)** — **dynamic** (steps · distance · workout minutes · **Custom**, e.g. "learn a backflip") vs **static** (gym volume · max lift · **Custom**, e.g. "learn a snatch"). Both branches have a Custom leaf for skills. Whoop strain rides under Fitness.

The manual create form (mock 143) walks this tree; the metric field shows the chosen path as a breadcrumb (`Focus › Study hours`). Server stores the leaf metric key; the umbrella is just the sum over its child types.

## Shape — how you win (mock 143)
Three shapes, self-explanatory labels:
- **Most by the deadline** — highest total of the metric when the window closes wins (a race).
- **First to a target** — first to reach X wins (a race that can end early).
- **Everyone hits a target** — collective: everyone who reaches X succeeds (no single winner).

## Reward calibration — time-based must not out-reward hard outcomes
The significance formula needs tuning so **short auto-tracked time challenges stay modest**. A weekly 10h study duel is a light lift compared to earning a 70% in Physiology (an honor outcome), so it must **not** land at Epic. Rules of thumb: a one-week study/hours duel tops out around **Rare**; bumping the target a couple hours nudges **embers/XP within the tier**, not a whole box-tier jump (mock 146: 8h→10h moves 150→190 embers, 200→250 XP, box stays The Furnace). Reserve Epic+ for long, high-scope, or genuinely hard goals (month-long group races, big grades). Re-tune the `grant_reward`/`compute_challenge_reward` significance bands accordingly.

## Challenge status + the Challenges menu (mocks 148/146)
**Tapping a challenge** opens its page; the **status view** lives there — live standings, or, if an edit/proposal is in flight, the **pending** screen (proposed diff, the note, who approved/rejected, the reject tally, host controls to Nudge or Cancel). No separate ⓘ button. In the Challenges list, **hold** a challenge to **reorder** it (drag handle) or reveal a **trash can** to delete. The paused/approval screen from mock 146 is this status view, reachable any time by opening the challenge.

## Roles & permissions (mock 150)
- **Owner** (creator): edit, delete, override any vote, **grant/revoke roles**, transfer ownership.
- **Co-admin**: edit (with approval policy) & override votes; **cannot** delete the challenge or change roles.
- **Participant**: compete, vote on changes, and **propose** changes.
- **Only the owner** can grant/revoke **co-admin** (or co-owner, if enabled) — the "Make co-admin" control shows for the owner alone. The owner can also **transfer ownership to a co-admin**, and a **co-admin can request** the transfer (owner confirms). Store roles on `challenge_participants.role` in {owner, co_admin, participant}.

## Changes flow both ways (mocks 146/150)
- **Top-down (owner / co-admin edit):** applies per the approval policy (Everyone / Co-admins / Just me); **>50% reject blocks**; override available. (mock 146)
- **Bottom-up (participant proposal):** any participant can **propose** a change with a note; it passes by vote (rules below). Owner / co-admin can still **override** (push or veto). (mock 150)

**Resolution rules — don't lock at the first 51%.** A bare majority the instant it's crossed can shed the outvoted half. So:
- **Voting window, not instant.** A change resolves at its **deadline** (e.g. 18–24h), so late/busy members still get a vote; reaching a threshold early doesn't lock it.
- **Reward tracks difficulty.** Any change **recomputes the reward** (Cindy re-scores). Easing the goal **drops the reward** (e.g. 10h/wk → 5h/wk for a month = **Legendary → Epic**), so there's no incentive to vote an easy finish for the same prize.
- **Direction-aware threshold.** Making it **easier** passes on a **simple majority**. Making it **harder** needs a **supermajority the owner sets — any % from 50–100** (e.g. 75/80/85). Hit that threshold and it **auto-applies**; if it isn't reached by the **deadline (date fallback)**, the change fails.
- **Graceful exit.** If a change passes, anyone outvoted may **leave the challenge with their progress kept** (no penalty), so no one is trapped in terms they didn't sign up for.
- Non-voters abstain (don't tip direction); an optional quorum can require a minimum turnout before a change can pass.
- Store on one `challenge_change_requests` table (proposer_id, diff jsonb, direction, note, deadline, threshold, votes, status). Same status view for top-down and bottom-up. Owner/co-admin override supersedes the vote. Thresholds/window are tunable constants.

## Custom lock-in types = course-code tracking (mock 147)
Students log classes as **custom lock-in types nested under the umbrellas**. A course code (e.g. `KP251`) can live under **Study** (conceptual understanding) *and* **Deep Work** (application/assignments), so a study session and an assignment log **separately** but both roll up to the class.

- **Auto-add from a challenge.** Joining a challenge whose metric is a custom type **adds that type to your lock-in menu automatically**, marked with a **challenge aura** (⚡ "created for a challenge"). Every lock-in of that type then counts toward the challenge *and* builds your per-class history. Scenario: a class campfire where the professor hosts "Study KP251 · 5h/week" — everyone who joins gets KP251 on their lock-in screen, aura'd.
- **Create your own.** A short form: name/code, which umbrella(s) it lives under (Study / Deep Work / both), a colour. Logs separately from General time so the student can see exactly how much they've put into that class.
- **Data model:** `lockin_types` (id, user_id nullable for shared/challenge types, key, label, parent in {study, deep_work, …}, source in {user, challenge}, challenge_id, colour). A session's `type` points at a `lockin_types` row; the umbrella metric sums all children with the same parent. Challenge-created types are shared (one row, joinable) rather than per-user duplicates.
- This is also how **per-class progress** is tracked app-wide — the same custom-type rollups power a student's "hours in KP251" history, independent of any challenge.

## Build notes
- New: NL-parse (Cindy) → `challenge_params` JSON; a server `compute_challenge_reward(params, vouch_state)` returning `{tier, box, embers, xp}` (deterministic, single source of truth) applying Auto (full) / Vouched (full box, −10%) / Unvouched (box −1, −20%); a `verifiability` column ('auto'|'honor'); a `challenge_vouches` table (challenge_id, voucher_id, verdict, created_at) + a 48h pending window; a `request_vouch` / `submit_vouch` path. No proof-reading, no ID matching.
- Reuse: `grant_reward` payout primitives, `box-art`, the settlement sweep, the reward-reveal screen (mock 137), the leaderboard (mock 139).
- Firewall unchanged: Cindy parses + displays + reads proof; the server computes + grants.
