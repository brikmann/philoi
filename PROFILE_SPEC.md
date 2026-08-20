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

## D. New: Trophy Hall (the flex surface)
A dedicated section = **earned proof of status**, distinct from cosmetics (which are equippable / buyable).
Renders on **your** profile and on **others'** (this is the compare surface).
1. **Featured trophies** — a row of the user's best **`RELIC` / `MEDAL`** showcase items (ITEM_CATALOG §4a/§4b),
   each tinted by its rarity aura (Mythic purple / Legendary gold / Epic violet). Tap → item + lore. Non-equip.
2. **Earned badges grid** — non-cosmetic proof: streak milestones (7/30/…-day), season titles / placements,
   challenge-win badges (e.g. *Firestarter*), *Built Different*, campus-placement, etc. Locked ones render
   greyed so there's a visible "collection to complete." Count pips (×7) where a badge stacks.
3. **Challenge record** — **duels won / lost / win-rate**. Hard, earned social proof (not cosmetics).
4. **"See all"** → full Trophy Hall (all relics, medals, badges, full W-L history).

**Why it's on other profiles too:** cosmetics can be bought, so they don't prove much. Badges, medals,
placements and a W-L record are **earned** — showing them side-by-side is instant, credible status. When
viewing someone else, add a small **compare banner** ("She's ahead on trophies + streak; your win rate's
higher") and the **Challenge / Add friend** CTAs (Frame 2).

## E. New: Journal (achievement comments)
- Each notable achievement (rank-up, streak milestone, challenge win, season placement) becomes a **journal
  entry**; the user can attach a **short comment** ("finally — the 4:30 alarms are paying off").
- Turns the profile into a personal progress log, and softens the social read: instead of "this person just
  grinds," a viewer sees *why* they grind. `＋ add a note` on any entry without one (own profile).
- Comments are visible on the public profile (own-profile can toggle an entry private if we want; default
  public). Leads each row with the achievement's art (rank hexagon, flame, trophy) — same art resolver as
  notifications (`NOTIFICATIONS_SPEC.md` leading-art table).

## F. Lock-in share card — fixes (Frame 3)
The share sheet that opens from a lock-in (Share / Keep private) has two bugs:
1. **Session-type icon is an emoji** (📚) → replace with the **vector session-type icon** (book for Study,
   dumbbell for Gym, etc.) — same icon set as the lock-in list rows, tinted ember.
2. **A "PRs" stat shows on every session** — a study session reading "0 PRs" is nonsense. **Make the stat row
   conditional on session type:**
   - **Study / Read / Work** → Streak + XP (no PRs).
   - **Gym / Lift** → Streak + **PRs** + XP.
   - Only surface a stat that's meaningful for that activity; never show a zeroed-out irrelevant stat.

## Acceptance
- [ ] "University — N here" string gone app-wide; inv/loadout row, Study chip, and duplicate gear removed.
- [ ] Profile card backdrop + avatar halo render the **equipped art** (not flat colour), from the loadout,
      with the 30/60/90 live aura ramp; default loadout as fallback.
- [ ] Bio (editable, own profile) renders under identity.
- [ ] Trophy Hall renders featured relics/medals + earned-badge grid (locked = greyed) + duel W-L; visible on
      own AND other profiles; "See all" opens the full hall; other-profile has compare banner + CTAs.
- [ ] Journal lists achievements with optional user comments + `＋ add a note`; leads with achievement art.
- [ ] Share card uses vector session icons; stat row is per-session-type (no PRs on non-gym).
