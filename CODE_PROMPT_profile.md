# Code prompt — Profile redesign + Trophy Hall + Collection + Milestones

Standalone build (challenges/rewards/notifications already shipped). Make the profile "this is YOU" — real
equipped art, earned trophies, an RL-style collection, and a social Milestones layer.

**Coordination:** ⚠ clear any stuck `.git/index.lock` and commit the outstanding tree before you build.
**Source of truth:** `PROFILE_SPEC.md` + mock **`design-mocks/107-profile-trophy-hall.html`** (5 frames) +
`ITEM_CATALOG.md` §2a/§2b (CARD/HALO art) · §4a/§4b (relics/medals). Don't edit the mock/specs — flag
disagreements in chat.

## 1. Declutter the profile
- Retire `"{University} — N here"` **app-wide** (dead photo-era metric).
- Remove: the **Inventory & loadout** row, the floating **Study** chip (→ ⚙ menu / editor), the **duplicate
  gear** over the XP bar (one gear, header top-right), and the **streak / lock-ins / hours stat strip**
  (redundant — lives on Home).
  - ⚠ **Still open (PUNCHLIST_22 #9):** the "Study" chip is the **goal-type chips at
    `src/app/(tabs)/profile.tsx:239`** — the earlier declutter commit left them. Remove them.
- **Keep:** identity banner (name · @handle · title · verified uni · bio) + the rank strip.
- **Screen order (lean):** identity banner → rank strip → **Journal** → **Trophy Hall** → recent lock-ins.

> **‼ Apply to `friend-profile.tsx`, not just `(tabs)/profile.tsx`.** `friend-profile.tsx` is the screen
> leaderboards + campfires actually link to; `(tabs)/profile.tsx?userId=` has no inbound links. Anything that
> must show on *other* people's profiles (§2 cosmetic render, §3 bio, §4 hall, §7 collection entry, compare
> banner) has to land on `friend-profile.tsx`. (PUNCHLIST_22 #10.)

## 2. 🔴 Cosmetics must render as ACTUAL ART (not flat colour)
The **CARD** backdrop + avatar **HALO** currently render as flat colours. Render the real §2a/§2b art from the
user's **equipped loadout** (Cracked Magma cracks, Inferno Flare ring, etc.), honoring the **30/60/90 live-aura
ramp** mid-lock-in, with the **default loadout** (already equipped on signup) as fallback — never a bare
colour. Same resolver drives your card AND anyone else's profile — **including `friend-profile.tsx`** (see the
note above).

## 3. Bio
Editable one-liner under the identity block (own profile only for editing) — but it **renders on visitors'
views too**, so wire it into **`friend-profile.tsx`** as well, not only `(tabs)/profile.tsx` (PUNCHLIST_22 #10).

## 4. Trophy Hall — EARNED-ONLY (nothing buyable/rollable)
Renders on **own and other** profiles = earned status compare. **No peak-rank tile** (rank persists on the rank
strip). Full "See all" groups:
- **Season placements** — one card per completed season, labeled plainly **"Season 1"** (NOT "résumé"):
  placement + cohort ("#300 / 30,000 · Top 1%") + earned title + season **Medal** (§4b).
- **Relics** (§4a) — see §6 below (now earned).
- **Milestone badges** (grid, locked = greyed) — streak milestones (7/30/100-day), lock-in totals (100/500),
  hours, challenge-win badges. **Campus Verified + First Flame** founder badge live here too.
- **Challenge record** — duels won / lost / **win-rate** + win streak.

**Collapsed profile = auto-featured** (no manual picker): latest **Season card** + **rarest trophy + newest
unlock** + the **W-L record**. "See all" → full grouped hall.

**Visibility:** everything defaults **public**; owner can **hide individual items / the record** (per-item
toggle). Hidden items still show in the owner's own hall, not to visitors. Other-profile adds a **compare
banner** ("She's ahead on trophies + streak; your win rate's higher") + **Challenge / Add friend** CTAs.

## 5. Journal — surfaced HIGH (the "human here" layer)
Directly under the rank strip, above the Trophy Hall. Each notable achievement (rank-up, streak milestone,
challenge win, season placement) becomes an entry; user can attach a **short comment**; `＋ add a note` on any
entry without one. Leads each row with the achievement's art (rank hexagon / flame / trophy — same resolver as
notifications). Default public.

## 6. ‼ Relics become EARNED (not loot-box)
**Remove `RELIC` from all box drop tables.** Grant via achievement triggers — **proposed, CONFIRM before
build** (ITEM_CATALOG §4a):
- Hestia's Hearthstone (Epic) — 30-day streak · Athena's Aegis (Epic) — a full month with zero dead days /
  never break a defended rank in a season · Icarus' Feather (Leg) — new personal peak rank (Gold+) · Anvil of
  Hephaestus (Leg) — 500 total hours locked in · Prometheus' Shard (Mythic) — Top 1% of a season / bring N
  friends who verify.

## 7. Collection browse — RL-style closet (mock Frame 4)
A **"Loadout & Collection"** entry on the profile (own + others) opens a **read-only** view: the **full owned
closet grouped by type** (Flames / Halos / Cards / Particles / Flares / Titles / Audio / SFX / Banners + earned
Relics), **rarity-sorted**, the **equipped tile ringed** ("EQUIPPED"), tap → item name · rarity · lore. (No
separate equipped strip — the ring marks it.) Read-only on others; **editing/equipping stays in the inventory**
(⚙). Respects the same **per-item hide** ("🔒 N hidden by owner"). Flex + desire engine; pairs with the Hall
(earned vs owned).

## 8. Milestones — the "advertise a win" layer (mock Frame 5)
People broadcast wins ("85% on a brutal Orgo midterm"). Two layers, hard firewall:
- 🔒 **FIREWALL (non-negotiable):** a milestone grants **ZERO XP / embers / rank**. The create path must **not**
  call `grantReward` or touch any progression/economy table — it's a **content post**. (No reward ⇒ no
  incentive to fake ⇒ we don't verify grades.)
- **Composer** (entry point = **"＋ Milestone" in the Journal section header** on own profile): typed win
  (Grade · Offer · Certification · Fitness PR · Project · Custom) + headline + optional note.
- **Effort auto-attach (ON):** pull the user's own effort receipts for the window (hours locked in · streak ·
  # lock-ins) onto the card — "85% on Orgo — backed by 23h + a 14-day streak this month." The Philoi twist:
  outcome tied to the receipts. (User can trim; on by default.)
- **Surfaces:** a **journal entry** (via a **"Pin to my Journal" toggle, default ON** — off ⇒ share card only,
  nothing posted) + a **milestone share card** (share-card family). No dedicated shelf.
- **Social:** friend **cheer** → notification (already in `NOTIFICATIONS_SPEC.md` Friends & social).
- **Visibility:** default **friends-only** (grades sensitive); per-post bump to campus/public.

## 9. Lock-in share card — fixes (mock Frame 3)
- Session-type icon → **vector** (no 📚 emoji), same icon set as the lock-in list rows, ember-tinted.
- **Stat row is per-session-type:** Study/Read/Work → Streak + XP; Gym/Lift → Streak + **PRs** + XP. Never a
  zeroed "0 PRs" on a study session.

## Acceptance
- [ ] "University — N here" gone app-wide; inv/loadout row + Study chip (`profile.tsx:239`) + duplicate gear +
      stat strip removed; order = banner → rank → journal → hall → lock-ins.
- [ ] CARD + HALO render equipped **art** (not colour) w/ 30/60/90 aura + default fallback; bio editable.
- [ ] **`friend-profile.tsx`** (the linked other-profile screen) shows §2 cosmetic art + bio + hall + collection
      entry + compare banner — not just `(tabs)/profile.tsx`.
- [ ] Trophy Hall (season placements + relics + badge grid + W-L) on own + other profiles; auto-featured
      collapsed; per-item hide; compare banner + CTAs on others. No peak-rank tile.
- [ ] Journal leads (under rank strip); entries take comments + `＋ add a note`; leads with achievement art.
- [ ] Relics removed from box tables + granted by achievement (triggers confirmed).
- [ ] Collection browse: full owned closet grouped/rarity-sorted, equipped ringed, read-only on others,
      per-item hide, tap → lore.
- [ ] Milestones: composer from Journal header; effort auto-attached; **grants no XP/embers/rank** (firewall);
      Pin-to-Journal toggle; default friends-only; cheer fires a notif.
- [ ] Share card: vector session icons; stat row conditional per session type (no PRs off-gym).
