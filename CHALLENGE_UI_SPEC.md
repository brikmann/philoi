# Challenge & Goal UI — build spec (mocks 70–74)

Update the challenges + individual-goals experience. Mocks in `design-mocks/`. Some of this is already
in the tree (don't redo) — flagged ✅. Everything here is JS + a couple of SQL migrations; no native change.

---

## Already done (verify present, don't rebuild)
- ✅ **Challenge card redesign** — `social-challenge-card.tsx` (H2H tug scoreboard + group segments, mocks 44/45).
- ✅ **Daily step aggregation** — `fitness-challenge-sync.ts` (`.gte('created_at', challenge.period_start)`).
- ✅ **Challenge progress floor** — migration `0051` (`check_in_qualifies_for_challenge` ≥ 60s).

---

## 1 · Grey trash on active cards → Manage (mocks 72, 70)
- A quiet **grey** trash button, **top-right** of every **active** challenge the viewer is a participant in
  (after the time-left). Neutral styling — red lives only on the "Request to cancel" button inside the sheet.
- Tapping opens the **Manage sheet** (§2) — NOT an instant delete.
- Pending *outgoing* invites keep their existing "Cancel" text link (unilateral — no one agreed yet).
  **Completed** challenges show no trash.

## 2 · Manage / edit challenge sheet (mock 70)
Bottom sheet from the trash. Shows the challenge summary + **Terms**:
- **Editable:** window (extend/shorten), and for group the target count. **Fixed:** metric, stakes (payout).
- Actions: **Request changes** (primary, enabled only when a term was edited) and **Request to cancel** (red).
- Consent banner: *"Any change or cancel needs [name]'s consent — nothing changes until they agree; progress
  keeps counting in the meantime."*
- **Escape hatch (design decision):** *edit* always requires consent. *Cancel* offers the consent route as the
  clean, no-penalty option, but ALSO keep a unilateral **"forfeit & leave"** (you bail → opponent wins / neither
  scores) so a ghosting opponent can't trap someone. Surface forfeit as a secondary/last-resort action.

## 3 · Consent flow (mock 71) — data model + RPCs + push
**Schema (new migration):**
```
challenge_change_requests (
  id uuid pk, challenge_id uuid fk social_challenges, requested_by uuid fk profiles,
  kind text check (kind in ('edit','cancel')),
  proposed jsonb,            -- e.g. {"window_hours": 72} or {"target_count": 3}; null for cancel
  status text default 'pending' check (status in ('pending','agreed','declined','expired')),
  created_at timestamptz default now()
)
-- one open request per challenge at a time (partial unique index on challenge_id where status='pending')
```
**RPCs (security definer):**
- `request_challenge_change(p_challenge_id, p_kind, p_proposed)` — caller must be a participant; challenge
  must be active; no existing pending request. Inserts the request, `notify_push` the OTHER participant
  ("X wants to change your challenge").
- `respond_to_challenge_change(p_request_id, p_agree)` — only the **other** participant may respond.
  - agree + edit → apply `proposed` to `social_challenges` (update window_hours/ends_at or target_count),
    set request `agreed`.
  - agree + cancel → set challenge `status='completed'` (or a `cancelled` state) with **no payout**, request `agreed`.
  - decline → request `declined`, challenge unchanged.
**Consent screen (mock 71):** opened from the push. Shows the proposed change **before → after** (e.g. window
`48h → 72h`) + live standings + **Agree / Decline** (decline = "keep it as is"). Handles the cancel variant
("X wants to end it early — neither side gets the +XP").

## 4 · Completed challenges → clickable + History (PUNCHLIST_4 E)
- Make **completed** challenges tappable → the Watch screen in a read-only "final" state (final standings/result).
- Move completed challenges (both personal goals and social) OUT of the active list into a collapsed
  **"History"** section below "Personal goals", so finished ones don't clutter the tab.

## 5 · Individual-goal card, redesigned (mock 73B)
The current card crams 🔗/✅/🏆 into the corner — replace with a clean left→right read:
- **icon tile → name → cadence chip** (top row).
- **one-line sub**: source only — `⚡ Auto · Health Connect` or `✏️ Logged by hand`. **No campfire binding** (§6).
- single **progress bar** + numbers, and **one** status: a `%` while in progress, a green **"Smashed ✓"** when
  the target's hit. Quiet `Resets Monday · +XP banked` line to close.

## 6 · Goals are NOT bound to a campfire — posting is multi-campfire
- **Remove `circle_id` (single campfire) from the individual-goal model.** A goal is just the user's own.
- Posting progress to campfires is **decoupled and multi-select**, chosen **per lock-in on the done screen**
  (one, several, or none). Check-ins already fan out to multiple circles server-side — this is mostly exposing
  a **multi-select campfire picker** on the lock-in done screen, not a rewrite. (Drop the old single-campfire
  binding anywhere goals reference it.)

## 7 · Set-a-goal flow (mock 73A)
One screen: metric chips (**Steps · Study time · Gym visits · Run · Custom**) → **Target** (number + unit) →
**Cadence** (Daily / Weekly) → **Track it** (Automatically / Log myself). Show **Automatically** ONLY when a
real device metric exists for the chosen metric (Steps → pedometer, Run → Strava); otherwise offer manual only.
No campfire step in setup.

## 8 · Custom goal (mock 74)
Picking **Custom**:
- **Name it** (free text) — this also registers the name as a custom **lock-in goal type**.
- **What counts toward it** (radio): **Time locked in** (lock in on that activity → minutes accrue, like Study/
  Gym) OR **A count I log** (a number + the user's own unit — pages, reps, glasses).
- **Target** (+ unit) + **Cadence**.
- **Never offers an auto-track source** — custom has no device metric, so it's lock-in-time or manual only.
  No dead "Connect" option.

## 9 · Fix the goal-setup sheet chrome (PUNCHLIST_4 F)
`fitness-sync-prompt.tsx` ("Track this automatically?") — its context header currently collides with the
status bar. Wrap in a top SafeAreaView / add the inset, clean the header + Connect rows, and apply §7's rule
(only show sources that can actually measure the metric).

---

## Ship
All JS except §3's one migration (`challenge_change_requests` + the two RPCs) and §6's goal `circle_id` drop.
JS rides the next build/OTA; the migrations go via `supabase db push`.
