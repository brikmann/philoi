# Profile screen redesign + Trophy Hall

Global-nav review (Aug 20). The profile tab is bare, redundant, and — critically — **not rendering the
cosmetics we scoped**. This makes it "this is YOU": real equipped art, earned trophies as social proof, and
a personal journal. The same hall renders on **other people's** profiles for instant status comparison.

**Mock:** `design-mocks/107-profile-trophy-hall.html` (Frame 1 = you · Frame 2 = someone else / compare ·
Frame 3 = fixed lock-in share card).

## A. Cut / retire (current screen)
1. **Retire `"Wilfrid Laurier University — 8 here"` outright.** Dead metric from the photo-as-lock-in era.
   Remove the string and the "N here" count everywhere it still appears — not just hide it on this card.
2. **Remove the `Inventory & loadout` row** from the profile body and the **floating `Study` chip** under it.
   Inventory/loadout lives in the ⚙ menu (or the equip editor); the goal chip belongs in the editor, not here.
3. **Remove the duplicate settings gear** that floats over the XP bar. **One gear, top-right of the header
   only.**
4. **Remove the streak / lock-ins / hours-locked-in stat strip.** Redundant — those live on Home. Keeps the
   profile lean: identity banner + rank strip + journal + hall.

**Kept:** the identity banner (name · @handle · title · verified uni · bio) and the **rank strip** (current
rank + XP bar). Rank is a **global, persistent** signal across a student's whole time on Philoi, so it stays
here on the identity — it is **not** duplicated into the Trophy Hall as a "peak rank" tile.

## B. 🔴 Cosmetics must render as their ACTUAL ART (the real bug)
Right now the **CARD backdrop** and **avatar HALO** render as flat colours. They must render as the vector/
textured art from `ITEM_CATALOG.md` §2a (`CARD`) and §2b (`HALO`), reading from the user's **equipped
loadout** — the same equip slots the inventory already writes.
- **CARD** (profile-card backdrop) → the equipped skin's texture (e.g. *Cracked Magma* = magma cracks over a
  molten gradient; *Golden Anvil* = brushed gold). Not a solid fill.
- **HALO** (avatar ring) → the equipped halo's art (e.g. *Inferno Flare* = ring of fire; *Hades Halo* =
  mythic purple aura). Not a plain `border-color`.
- Honor the **live session-tiered aura** ramp (§2b: Kindled/Burning/Locked-In at 30/60/90) when the user is
  mid-lock-in.
- Fallback to the **default equipped loadout** (task #88) when nothing rarer is equipped — never a bare colour.
- Same resolver drives your card AND anyone else's profile, so a viewer sees exactly what that person equipped.

## C. New: identity + bio
- Identity block = avatar (haloed) · name · @handle · **equipped Title** (with rarity) · **Campus Verified**
  chip (§2 earned badge — green check, never bought).
- **Bio** — a short free-text line under the identity block, editable via `✎ edit bio` (own profile only).
  Purpose: make the social layer personal — a one-liner of who they are / what they're grinding for, so a
  profile reads as a person, not just a stats dump.

## D. New: Trophy Hall (the flex surface) — SCOPED
A dedicated section = **earned proof of status ONLY**. Nothing here is purchasable *or* rollable — if a whale
could get it from a shop or a loot box, it doesn't belong. Cosmetics (CARD/HALO/FLAME/etc.) stay on the
identity card + inventory; the Hall is the "you can't buy this" surface. Renders on **your** profile and on
**others'** (the compare surface).

### ‼ Change this pulls in: Relics become EARNED (not loot-box)
Noah's call: **Greek Mythic Relics (`RELIC`, §4a) move out of the loot-box pool and become achievement
unlocks**, like Medals. **Downstream:** remove relics from box loot tables (ITEM_CATALOG §4a note + the box
drop config); update §4a to "earned, never rolled/bought." **Proposed earn triggers (confirm before build):**
- **Hestia's Hearthstone** (Epic) — hold a **30-day streak** (the undying hearth).
- **Athena's Aegis** (Epic) — a **full month with zero dead days** / never break a defended rank in a season.
- **Icarus' Feather** (Legendary) — hit a **new personal peak rank** at Gold+ (flew high enough to burn).
- **Anvil of Hephaestus** (Legendary) — **500 total hours** locked in.
- **Prometheus' Shard** (Mythic) — **Top 1% of a season** *or* bring **N friends who verify** (spread the fire).

### What the Hall contains (full "See all" view, grouped)
No peak-rank tile — rank persists on the identity strip (§A). The hall is placements + collected items + record.
1. **Season placements** — one card **per completed season**, labeled plainly **"Season 1"** (NOT "résumé"):
   final **placement + cohort** ("#300 / 30,000 · Top 1%"), the **title** earned, and the season **Medal**
   (§4b). The headline career flex.
2. **Relics** (§4a, now earned) — Epic→Mythic, rarity-glowed, tap → lore + how it was earned. Showcase only.
3. **Milestone badges** (grid, locked = greyed so there's a collection to complete) — streak milestones
   (7/30/100-day), lock-in totals (100/500), hours locked in, challenge-win badges (*Firestarter*, etc.).
   Count pips (×7) where a badge stacks. **Campus Verified + First Flame** founder badge live here too.
4. **Challenge record** — **duels won / lost / win-rate**, current **win streak**, biggest upset.

### Collapsed profile (what shows before "See all") — AUTO-featured
No manual picker. The profile shows: the **latest Season card** (placement + title + medal) + an auto-curated
strip of **rarest trophy + most-recent unlock** + the **W-L record**. Always fresh, zero maintenance.
**"See all"** → the full grouped hall.

### Visibility (other profiles) — per-item toggle
Everything defaults **public**. Owner can **hide individual trophies / the record** from public view (own
profile → long-press or a manage screen). Hidden items still show in the owner's own full hall, just not to
visitors. (We keep the honest-compare value by defaulting public; hiding is opt-in.)

**Why it's on other profiles too:** cosmetics can be bought, so they don't prove much. Peak rank, medals,
season placements, earned relics and a W-L record **can't** — showing them side-by-side is instant, credible
status. Viewing someone else adds a **compare banner** ("She's ahead on trophies + streak; your win rate's
higher") + the **Challenge / Add friend** CTAs (Frame 2).

## E. New: Journal (achievement comments) — surfaced HIGH
**Placement:** the journal leads — it sits **directly under the identity/rank strip, above the Trophy Hall**.
It's the "there's a real human behind this screen" layer, so it's the most accessible thing on the profile,
not buried at the bottom. **Screen order:** identity banner → rank strip → **Journal** → Trophy Hall → recent
lock-ins.
- Each notable achievement (rank-up, streak milestone, challenge win, season placement) becomes a **journal
  entry**; the user can attach a **short comment** ("finally — the 4:30 alarms are paying off").
- Turns the profile into a personal progress log, and softens the social read: instead of "this person just
  grinds," a viewer sees *why* they grind. `＋ add a note` on any entry without one (own profile).
- Comments are visible on the public profile (own-profile can toggle an entry private if we want; default
  public). Leads each row with the achievement's art (rank hexagon, flame, trophy) — same art resolver as
  notifications (`NOTIFICATIONS_SPEC.md` leading-art table).

## E2. New: Collection browse — RL-style closet (Frame 4)
A read-only view of someone's whole cosmetic collection — reachable from a **"Loadout & Collection"** entry on
the profile (own + others). This is distinct from the removed cluttered "Inventory & loadout" edit-row (§A):
**viewing/showcase lives on the profile; editing/equipping stays in the inventory (⚙ menu).**
- **Equipped loadout up top** — the slots she's running now (Flame · Halo · Card · Title · Particle/Flare/Audio).
- **Full owned collection below**, **grouped by type** (Flames, Halos, Cards, Particles, Flares, Titles, Audio,
  SFX, Banners) + **Relics** (earned). Within a group, **rarity-sorted** (Mythic→Common), each tile
  rarity-tinted, the **equipped one ringed** ("EQUIPPED"). Tap a tile → name · rarity · lore.
- **Why:** it's both a flex ("look what I've collected") and a **desire engine** — you see a Mythic flame you
  don't own and now you want it. Pairs with the Trophy Hall: Hall = *what I earned*, Collection = *what I own*.
- **Read-only on others.** Respects the same **per-item hide** toggle (§D) — hidden items don't show to
  visitors ("🔒 N hidden by owner"). Own view shows everything.
- Resolves item art from the catalog (same art the equip UI + notifications use).

## F. Lock-in share card — fixes (Frame 3)
The share sheet that opens from a lock-in (Share / Keep private) has two bugs:
1. **Session-type icon is an emoji** (📚) → replace with the **vector session-type icon** (book for Study,
   dumbbell for Gym, etc.) — same icon set as the lock-in list rows, tinted ember.
2. **A "PRs" stat shows on every session** — a study session reading "0 PRs" is nonsense. **Make the stat row
   conditional on session type:**
   - **Study / Read / Work** → Streak + XP (no PRs).
   - **Gym / Lift** → Streak + **PRs** + XP.
   - Only surface a stat that's meaningful for that activity; never show a zeroed-out irrelevant stat.

## G. New: Milestones — the "advertise a win" layer
People use Philoi as social media to broadcast wins ("85% on a brutal Orgo midterm," "got the internship").
We support that **without breaking the ipsative ethos** by splitting the app into two layers with a **hard
firewall**:
- **Rewarded layer** (exists today) — effort/consistency → XP · embers · rank. Ipsative. **Grades/outcomes
  never touch this.**
- **Celebrated layer** (new) — **Milestones**: user-declared wins that are **purely social**.

### 🔒 Firewall (non-negotiable)
A Milestone grants **ZERO XP, ZERO embers, ZERO rank movement.** The create path must **not** call
`grantReward` or touch any progression/economy table — it's a **content post**, not an economy event. The
instant a grade earns currency, Philoi becomes a grade-comparison app and the "effort not outcome" identity
collapses. (Bonus: because there's no reward, there's no incentive to fake one — self-report stays honest for
free, so we **don't verify** grades.)

### What it is
A user-declared win. **Types:** Grade · Admission/Offer · Certification/License · Fitness PR · Project/Deadline
shipped · Custom. Headline + optional note.

### Where it's reached
**Primary entry = a "＋ Milestone" button in the Journal section header** on your own profile (Frame 1). Since
milestones *are* user-authored journal entries, that's the natural, single home — one tap from the Profile tab,
no extra chrome. (Opens the composer, Frame 5a.) No other entry point needed for v1; if we want more
discoverability later, the app's global compose "+" could offer "Milestone" alongside challenge/lock-in.

### Effort auto-attach (ON by default) — the Philoi twist
The milestone auto-pulls the **effort receipts** behind it from the user's own session data over a sensible
window (the month / since the last milestone / a course tag if we have one): **hours locked in · streak ·
# lock-ins.** So the card reads *"85% on the Orgo midterm — backed by 23h locked in + a 14-day streak this
month."* This is the differentiator: it celebrates the grade **through the effort**, tying outcome to the
receipts no other app has. (User can edit/trim the attached stats, but it's on by default.)

### Surfaces (kept lean — no dedicated shelf)
1. A **Journal entry** (same feed surfaced high in §E) — user-authored rather than system-generated.
   **User-controlled via a "Pin to my Journal" toggle in the composer (default ON).** If off, the milestone
   only produces a share card and posts nothing to the profile.
2. A **Milestone share card** (share-card family, mock 96/104 frame) — the advertise surface: headline +
   effort receipts + philoi footer.

### Social + visibility
- Friends can **cheer / react** → notification ("Maya cheered your milestone") — **add to
  `NOTIFICATIONS_SPEC.md` Friends & social.**
- **Default visibility = friends-only** (grades are sensitive). Per-post bump to campus/public. **Never
  public by default.**

## Acceptance
- [ ] Milestones: composer (typed, headline + note); effort receipts auto-attached; posts a journal entry +
      generates a share card; **grants no XP/embers/rank** (firewall); default friends-only; friend cheer fires
      a notification. No dedicated shelf.
- [ ] "University — N here" string gone app-wide; inv/loadout row, Study chip, and duplicate gear removed.
- [ ] Profile card backdrop + avatar halo render the **equipped art** (not flat colour), from the loadout,
      with the 30/60/90 live aura ramp; default loadout as fallback.
- [ ] Bio (editable, own profile) renders under identity.
- [ ] Trophy Hall renders featured relics/medals + earned-badge grid (locked = greyed) + duel W-L; visible on
      own AND other profiles; "See all" opens the full hall; other-profile has compare banner + CTAs.
- [ ] Journal lists achievements with optional user comments + `＋ add a note`; leads with achievement art.
- [ ] Collection browse: "Loadout & Collection" entry opens equipped loadout + full owned closet grouped by
      type, rarity-sorted, equipped ringed; read-only on others; per-item hide respected; tap → item lore.
- [ ] Share card uses vector session icons; stat row is per-session-type (no PRs on non-gym).
