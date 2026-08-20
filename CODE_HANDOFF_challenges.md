# Code handoff — Challenges + Rewards + Notifications + Profile (consolidated)

One pass covering **bugs → algorithm → viewing redesign → reward screens → share cards → notifications →
crown → profile/trophy hall**.
Build **A (bugs)** and **B (algorithm)** first — they're the broken core loop — then C/D/E/F/G (UI +
notifications + profile).

**Coordination (READ FIRST):** ⚠ **clear the stuck `.git/index.lock` and commit the outstanding tree before you
build** (last pass got stranded uncommitted). One writer per branch; don't edit the mocks/specs — flag disagreements
in chat.

**Reference files (source of truth):**
- `CHALLENGE_REDESIGN_SPEC.md` — master (bugs, algorithm, viewing IA, notifications §D)
- `CHALLENGE_REWARD_ALGO.md` — reward calibration (daily drip + streak milestones + concrete ember bands + guardrails)
- `REWARD_ECONOMY.md` §3–§5 — the `grantReward` engine + guardrails (fold the ALGO numbers in here)
- `CHALLENGE_REWARD_COPY.md` — win/loss/placement headline pools
- `NOTIFICATIONS_SPEC.md` — the **full** notification catalog (all categories) + leading-art + rich-push
- `PROFILE_SPEC.md` — profile redesign, cosmetic-render bug, Trophy Hall, bio/journal, share-card fixes
- `ITEM_CATALOG.md` §2a/§2b (CARD/HALO art) · §4a/§4b (RELIC/MEDAL trophies) — cosmetic + trophy source of truth
- Mocks: **102** (tab: Friends/Personal + info screens) · **47** (challenge/campfire reward) · **103** (goal/streak
  reward) · **104** (challenge + goal share cards) · **105** (leaderboard #1 crown) · **106** (surfacing + push + the
  new bell) · **107** (profile + trophy hall + fixed share card) · 44/45 (watch) · 46 (pick members)

---

## A. Bugs
1. **Sign-in replays the rank-up animation** → gate the rank-up trigger to a **live** rank increase during a session;
   never on login / initial hydrate (it's comparing loaded rank vs an empty baseline).
2. **Leaderboard #1 crown is an emoji (👑)** → build the **exact vector crown from `design-mocks/105-crown-vector.html`
   (Option A)**: gold 3-peak crown (same gold as the podium pillars), **elongated-hex ruby dead-centre** (midpoint of
   peak↔band), flanked by a **sapphire (L) + emerald (R)** side stone, ruby accents on the three peaks. Seat it on the
   #1 podium avatar as in the mock. No emoji.
3. 🔴 **Personal goals (steps etc.) broken:** raw shoe emoji icon → vector; **not tracked** (0/10,000) → wire to the
   source (Health steps / lock-in time); **no reward** → grant per §B; "Resets midnight **UTC**" → **user-local**.
4. **Watch screen:** poor header → ember header; **Cheer unlimited-click** → rate-limit (one per user per challenge
   or a cooldown), authoritative count; completed challenge → read-only "final" state (CHALLENGE_UI_SPEC §58).

## B. Algorithm (the core)
Implement per `CHALLENGE_REWARD_ALGO.md` + `REWARD_ECONOMY.md §3`:
- **Tracking:** on start snapshot baseline metric; accrue delta over the window (XP / lock-in / Health steps) into
  `challenge_progress`. Personal daily goals reset at **user-local midnight**.
- **Resolution:** highest metric wins; ties → first-to-reach then most lock-in; placement tier per COPY (1v1 →
  Rank1/2; group ≤8 → 1/2/3 then percentile; campfire/uni/season → percentile).
- **Rewards (`grantReward`, server-side, idempotent):** significance = difficulty × scope × duration × placement.
  - **Daily goal:** ~12/18/25 embers by difficulty; **streak milestones** 3d +30 · 7d +60 · 14d +150 · 30d +400+box.
    (10k steps × 7d ≈ **235 embers.**)
  - **Duel/group win:** mostly **XP** (Winner +200, effort-scaled + capped) + **small embers** (~25–40); loser →
    rematch/redemption, no penalty.
  - **Campfire/season placement:** percentile embers + rarity box + earned badge.
  - **Guardrails:** ~300 weekly earned-ember ceiling; embers stay scarce; **Flame Pass value = exclusive cosmetics,
    not embers** — never let free embers undercut packs/pass. All amounts server config.

## C. Viewing redesign (mock 102)
- Challenges tab = **`Friends` | `Personal`** tabs.
- **Minimal cards** — VS card = avatars + XP-lead bar + lead line + time; goal row = icon + progress + %. **No reward
  text on cards.**
- **Challenge info screen** (new) holds rules + rewards: type · race · duration · winner reward · tiebreak · watching;
  **goal variant** = target · source · reset · reward · goal streak.
- **Home:** an active challenge shows a **proper card that supersedes the daily fire** (not the tiny chip) — mock 106.
- **Surfacing / notifications (mock 106, spec §D):** Challenges-tab **badge** + header **bell** carry the pending count
  (invites + results to collect); **push** on the key events (challenged · accepted · passed · ending-soon · won/lost ·
  goal-at-risk), each deep-linking to the right screen (accept sheet / watch / **reward arc mock 47**). Respect OS
  permission + settings toggles; rate-limit + batch.

## D. Reward screens (wire — they exist, unwired)
- **Challenge win / campfire placement → mock 47.** Fire on challenge close; rows = XP + embers + box(open) + badge;
  copy from `CHALLENGE_REWARD_COPY.md` (win *and* loss/rematch tone).
- **Goal / streak milestone → mock 103.** Fire on a personal-goal milestone; embers → wallet, badge → earned, with
  the breakdown line.
- Distribution: embers → `ember_wallet` (+`ember_ledger` row), box → inventory, badge → earned, XP → progression.

## E. Share cards (mock 104)
Add two to the share set (same frame as mock 96, rank-in-hex + philoi.app footer):
- **`challenge-win-share-card`** — from mock 47's "Share to your story".
- **`goal-streak-share-card`** — from mock 103's "Share to your story".

## F. Notifications — the full system (`NOTIFICATIONS_SPEC.md`, mock 106)
Not just challenges — the app-wide notification layer.
- **One event pipeline → fan-out:** server emits `{type, actor, target, payload, image, imageShape}`; fan-out picks
  channels by the user's category toggles + defaults + quiet hours + rate-limits, writes the in-app **bell feed** row,
  and (if push-eligible) sends **Expo push**. Each `type` deep-links to a route.
- **Event catalog** (full table in the spec): Friends & social · Challenges · Campfires · Streak & reminders ·
  Season & rank. Sensible defaults (high-value ON, low-value OFF/bell-only), batching, quiet hours.
- **Leading art — pull the subject's image**, not the generic flame: rank → **tier hexagon** ("You ranked up to
  Silver I"), friend events → **their avatar**, campfire → **campfire icon**, duel → **opponent avatar**, win →
  **reward/box art**. Rich push via iOS `UNNotificationAttachment` (Notification Service Extension) / Android
  `BigPictureStyle`; same image in the bell feed, masked to shape.
- **Surfaces (mock 106):** Home **active-challenge card** (supersedes daily fire) · **header bell** (the new amber
  vector bell + ember badge, empty/2/9+, gently rings on unread) · **Challenges-tab badge**.
- 🔔 **Dedicated Settings → Notifications menu** — its **own screen** with a toggle per **category** (Friends &
  social · Challenges · Campfires · Streak & reminders · Season & rank) + the **daily-reminder time picker**. OFF
  categories still populate the in-app bell (just no push). (Replaces the single "Notifications" row.)

## G. Profile redesign + Trophy Hall (`PROFILE_SPEC.md`, mock 107)
Make the profile "this is YOU" — real equipped art, earned trophies, a journal — same hall on other profiles.
- **Cut:** retire `"{University} — N here"` **app-wide** (dead photo-era metric) · remove the **Inventory &
  loadout** row + floating **Study** chip (→ ⚙ menu / editor) · remove the **duplicate gear** over the XP bar
  (one gear, header top-right).
- 🔴 **Cosmetics must render as ACTUAL ART, not flat colour** — the **CARD** backdrop + avatar **HALO** read
  from the equipped loadout and render the §2a/§2b art (Cracked Magma cracks, Inferno Flare ring, etc.), with
  the 30/60/90 live-aura ramp; default loadout (task #88) as fallback. Same resolver on your card AND others'.
- **Bio** — editable one-liner under the identity block (own profile).
- **Trophy Hall** — featured **RELIC/MEDAL** showcase (rarity-glowed) + **earned-badge grid** (locked =
  greyed) + **duel W-L / win-rate**. Renders on **own and other** profiles = earned status compare (cosmetics
  can be bought, badges/record can't). Other-profile: **compare banner** + **Challenge / Add friend** CTAs.
- **Journal** — achievements become entries with optional **user comments** (`＋ add a note`); leads with the
  achievement's art (same resolver as the notifications leading-art table). Default public.
- **Share card fixes (Frame 3):** session-type icon → **vector** (no 📚 emoji); **stat row is per-session-
  type** — Study/Read → Streak + XP, Gym → Streak + **PRs** + XP. Never a zeroed "0 PRs" on a study session.

## Acceptance
- [ ] Profile: "University — N here" gone app-wide; inv/loadout row + Study chip + duplicate gear removed;
      CARD + HALO render equipped **art** (not colour) w/ live aura + default fallback; bio editable.
- [ ] Trophy Hall (relics/medals + badge grid + W-L) on own + other profiles; compare banner + CTAs on others;
      journal entries take comments and lead with achievement art.
- [ ] Share card: vector session icons; stat row conditional per session type (no PRs off-gym).
- [ ] Notifications: event pipeline + fan-out; **own Settings → Notifications menu** with per-category toggles +
      reminder time; rich push pulls the subject's art; the new bell + badges render (mock 106).
- [ ] Rank-up no longer replays on sign-in; leaderboard #1 crown is a vector.
- [ ] Personal goals track (real progress), reset local-midnight, and pay out per §B; no emoji icons.
- [ ] Watch: ember header, cheer capped, completed = read-only.
- [ ] `grantReward` covers daily/streak + duel + placement; 10k-steps-week ≈ 235 embers; weekly cap enforced.
- [ ] Tab = Friends/Personal, minimal cards, info screens (both variants).
- [ ] Mocks 47 + 103 fire on the right events and distribute rewards; 104 share cards generate.
