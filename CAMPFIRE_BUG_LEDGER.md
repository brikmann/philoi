# Campfire + challenge pass — bug ledger

Diagnose pass over the campfire/challenge/watch surface built in the A/B parallel pass. Tick `[x]` to approve,
strike through to reject, add a note under any item where the fix should change.

**Status of the work:** every item below is **already written into the working tree** (see *Process deviation*
at the bottom — this pass started before the branch-per-agent rules arrived, so it ran diagnose-and-apply in
one go on `add-marketing-site`). `npx tsc --noEmit` is clean; `eslint` is clean on every touched file except
one pre-existing error logged as item 21. **Nothing is committed and nothing is merged.**

**Headline:** the loop was broken end to end. 0096 added `challenge_participants`, 0111 taught *settlement* to
read it, and nothing in between was updated — so two of the three write paths never inserted a row, and three
readers still counted the whole campfire. The visible consequence was that **no group challenge created since
0098 could ever be started**, and **no duel ever produced a result page**.

---

## A · Lifecycle dead ends (P0)

### 1 · A group challenge can never be started
- [ ] approve
- **Repro:** campfire → Challenges → Start a challenge → Group → Start group challenge → back in the tab, tap
  **Start the race**. Error: *"Nobody has accepted yet."* Every time, forever.
- **Root cause:** `create_group_challenge` (0098) inserts a draft with **no participants**.
  `invite_challenge_members` (0096) is the only thing that ever writes one — and it had **zero call sites** in
  the app (`inviteChallengeMembers` in `challenge-lifecycle.ts` was written and never called). `start_challenge`
  refuses to start a race nobody accepted, so it refused all of them.
- **Fix:** built the **member ticker** the spec asks for (`CHALLENGE_V2_SPEC` §1, mock 113 §1) —
  `src/components/challenge-member-ticker.tsx`, a search + toggle multi-select over `list_campfire_members`.
  Wired inline into `challenge/create.tsx` (group mode) and as a sheet on a stranded draft in
  `challenges-tab.tsx`. Migration 0112 also writes the **creator** in as `accepted`, so a field of one admin is
  a startable race rather than an empty one.
- **Verify:** create a group challenge with 2 people ticked → their cards show Accept/Decline → after one
  accepts, admin's **Start the race** succeeds and the challenge goes `active` with baselines set.

### 2 · A duel never produces a result page
- [ ] approve
- **Repro:** finish a duel → the `challenge_won` push arrives → tap it → lands on `/challenge-info` showing
  the *rules*, with "Watch live" gone and nothing in its place.
- **Root cause:** two halves. (a) `create_h2h_challenge` / `respond_to_h2h_challenge` predate
  `challenge_participants`, so a duel has no roster → 0111's participant arm never fires → `final_value` /
  `final_rank` are never written → `get_challenge_results` returns an empty set for every duel ever run.
  (b) `get_challenge_results` had **no client caller at all**.
- **Fix:** 0112 gives both create paths a roster (challenger `accepted`, opponent `invited`) and takes
  baselines in `respond_to_h2h_challenge` at the moment of acceptance, which is when a duel's gun actually
  fires. Client: `fetchChallengeResults()` + a **Final standings** block on `challenge-info` for any settled
  challenge, showing place, percentile band, and **what the ledger actually paid** (never re-derived).
- **Verify:** settle a duel → bell row → challenge-info shows both racers, #1 crowned, `+200 XP` on the winner.

### 3 · `ChallengeRewardScreen` and `ChallengeWinShareCard` are dead code
- [ ] approve — **NOT FIXED, needs your call**
- Both components are fully built and have **zero call sites**. The result arc now terminates at the Final
  standings block (item 2) rather than at mock 47's full reward screen + share card.
- Wiring them properly means deciding where they fire (on the settled deep-link? once, then never again?) and
  where the `grant_reward` payload (`embers/box/badge/band`) is read from — `get_challenge_results` returns XP
  only. That is a design decision plus a new RPC, not a bugfix, so I stopped at the standings.
- **Note:**

---

## B · Wrong denominators — client and server describing different races (P0)

### 4 · The watch screen lists the whole campfire, not the racers
- [ ] approve
- **Root cause:** `get_group_challenge_watch` selects from `group_members`. Since 0096 a group challenge is an
  invited subset, and 0111 already moved *settlement* off that denominator — the read path was left behind. A
  4-person race in a 30-person campfire drew 30 meters while settling out of 4.
- **Fix:** 0112 rebuilds it over `challenge_field(...)` — the same function 0111 settles against, so there is
  now one definition of "who is in this race" instead of three.

### 5 · The card's "N / M done" counts the whole campfire too
- [ ] approve
- Same cause in `get_my_social_challenges` (`member_count` / `completed_count`). "2 / 30 done" on a race of
  four, which can essentially never read complete. Same fix.

### 6 · A settled group race is unwatchable
- [ ] approve
- **Root cause:** `get_group_challenge_watch` gated on the literal `status = 'active'`. `get_challenge_watch`
  has allowed the settled band since 0056 — so a finished *duel* opened its final standings and a finished
  *campfire race* raised "not found". 0112 puts it on `challenge_is_live(...) or challenge_is_settled(...)`.

### 7 · The reward trigger uses a third, different denominator
- [ ] approve
- `economy_on_social_challenge_closed` (0089) derives participants from "locked in during the window". Someone
  on the roster who logged nothing got **no reward event**; someone in the campfire who was **not invited got
  paid**. 0112 routes it through `challenge_field` too, falling back to 0089's derivation for pre-0096 rows.

---

## C · Settlement correctness (P0/P1)

### 8 · Volume and distance races are scored as XP
- [ ] approve
- **Root cause:** `social_challenge_score`'s CASE is `when 'lockin_time' then duration_seconds else xp_earned`
  — written before 0096 added the metric set. `create.tsx` offers **Volume** and **Distance**; the card, both
  watch RPCs and 0111's legacy settle arm then all scored them as **XP**. A gym duel was silently an XP duel.
- **Fix:** 0112 routes volume/distance through `challenge_metric_value` windowed as (end − start) — the same
  expression `start_challenge` uses for baselines, so live score and settled score share one definition. The
  lockin_time/xp arm is unchanged, so nothing already running changes what it measures.

### 9 · Two concurrent cron ticks can pay a challenge twice
- [ ] approve
- **Root cause:** idempotency rested entirely on the status flip inside the same transaction. Read-committed
  lets two overlapping `finalize_social_challenges` runs both see `status='active'` and both insert into
  `bonus_xp_awards`.
- **Fix:** `FOR UPDATE` on the driving cursor. The second tick blocks, then re-evaluates the WHERE against the
  committed row (now `'completed'`) and skips.
- **Deliberately NOT** a unique index: adding one requires deduplicating awards that have already been paid,
  and deleting a landed XP award to satisfy a constraint is worse than the race it prevents.

### 10 · `start_challenge` keeps declined participants on the roster
- [ ] approve — **verified NOT a live bug, no change made**
- `start_challenge` deletes `state='invited'` rows but leaves `'declined'` ones, and then writes baselines for
  every row including those. Traced it through: `challenge_field` filters `state = 'accepted'`, so a decliner
  never reaches the denominator, the payout, or the standings. The stray baseline is inert. Logged so the next
  person doesn't re-derive it.

---

## D · Old schematics still rendering (P1)

### 11 · Manage is still a trash can
- [ ] approve
- `CAMPFIRE_REDESIGN_SPEC` 🔴: *"Manage = a kebab / hamburger, not a trash can."* Still `trash-outline`, in a
  component literally named `ManageTrash`, with a paragraph of comment explaining that it is "neutral on
  purpose" and does not delete anything — which is the tell.
- **Fix:** `ManageKebab` / `ellipsis-horizontal`. Now visible on **every** card, not just active ones, because
  Delete has to be reachable on a draft and on a finished row.

### 12 · "Delete challenge" was missing
- [ ] approve
- Spec: *"Add a Delete challenge action (currently missing) — inside that ⋯ menu."*
- **Fix:** `delete_social_challenge` RPC (0112) — creator **or** campfire admin, gated on `is_campfire_admin`
  (never `owner_id`). **Refuses a live race**: a running challenge is a deal other people are keeping, and
  cancel/forfeit are the consented routes out. `bonus_xp_awards.challenge_id` is `ON DELETE SET NULL`, so
  deleting a settled challenge never claws back XP that landed.

### 13 · A group goal renders as a 1v1 VS — labelled "Opponent"
- [ ] approve
- **Repro:** open a group challenge → **Challenge info**. A VS arena, with your avatar on the left and the
  literal word **"Opponent"** on the right. Both of the spec's 🔴s on one screen.
- **Root cause:** `challenge-info` had no shape branch, and `otherName` fell back to the string `'Opponent'`
  when `opponent_id` was null — which it always is for a group challenge.
- **Fix:** branches on `shape` (0096), not on whether `opponent_id` happens to be set. A collective goal gets
  a house hero (count + campfire name), its own rules table, and its own note copy — the old note promised
  "Winner +300 XP … the loser gets a rematch" for an all-or-nothing group race.

### 14 · "Most XP" on four screens that aren't XP races
- [ ] approve
- The same two-branch ternary, copy-pasted four times, written when the metric set was `{lockin_time, xp}`:
  `social-challenge-card`, `challenge-info`, `watch/[challengeId]` (a 2-key map defaulting to `"Race"`), and
  `challenge-sent-sheet` — which announced "Most XP" one tap after the user picked **Volume**.
- **Fix:** `src/lib/challenge-metric.ts`, one spec per metric (label · noun · formatter). Also fixes the units:
  the watch screen printed `${seconds}s` (a four-hour lead read as **"14400s"**) and `${value} XP` for volume
  and distance. Null `race_metric` maps to a collective spec, not to XP.

### 15 · `public_name` was written and rendered nowhere
- [ ] approve
- `create.tsx` has sent it since 0098 and `get_my_social_challenges` never selected it, so every surface fell
  back to describing the metric. 0112 selects it; the card, challenge-info, the watch header and the manage
  sheet now title with it.

---

## E · Cheering (P1)

### 16 · A cheer fires no push and no bell row
- [ ] approve
- Spec 🔴: *"Fires a push + bell: '🔥 {name} cheered you on' + the note if present."* 0110 built the note, the
  composer, the wall and the cap — the notification was never wired.
- **Fix:** `cheer_challenge` calls `notify_event` (0086/0087), not `notify_push` — so it writes the bell row
  too, honours the category toggle and quiet hours, and derives the **cheerer's avatar** as leading art from
  `p_actor_id`. Route carries `mode` so the tap lands on the right watch variant. Added `challenge_cheered` to
  `notification_category` → `'challenges'` (unmapped types default to `friends_social`, which would have filed
  it under the wrong toggle in both directions).
- **Idempotent for free:** guarded on `v_inserted > 0`, and one cheer per spectator is already enforced by the
  `ON CONFLICT` — a repeat tap inserts nothing and notifies nobody.

### 17 · Nobody in a group race can be cheered
- [ ] approve
- `cheer_challenge` rejected any target that was not `created_by` / `opponent_id` — the duel's shape. So the
  spec's *"cheer count under each person"* had no data behind it, and `GroupWatch` had no cheer UI at all.
- **Fix:** eligibility comes off the roster for every shape (duel columns kept as the pre-roster fallback);
  `get_group_challenge_watch` returns `member_cheers` + `cheered_by_me`; `GroupWatch` draws a cheer control
  under each meter and reuses the existing `CheerComposer` for the note.

### 18 · `cheer_challenge` never checked whether the caller could see the challenge
- [ ] approve
- It checked only that the *target* was in the challenge. 0110 extracted `can_watch_challenge` for exactly this
  and cheer never adopted it. Now gated. **Tightening, not weakening.**

---

## F · Smaller (P2)

### 19 · Draft challenges vanish from the Challenges tab
- [ ] approve
- `liveSocial` filtered `pending|active` and `pastSocial` filtered `completed|expired` — a `draft` was in
  **neither**, so a challenge you created but hadn't invited anyone to was returned by the RPC and dropped by
  both filters. Invisible on the one screen that lists your challenges. Added to the live band.

### 20 · `challenges-tab` fetched twice on mount
- [ ] approve
- A hand-inlined copy of `load` in the mount effect — same RPC, same campfire filter, same error string. Two
  copies of the scoping rule. Now calls `load()`.

### 21 · Pre-existing lint error in `challenge/create.tsx`
- [ ] approve — **NOT FIXED, deliberately**
- `react-hooks/set-state-in-effect` at the deep-link prefill effect. Verified present at HEAD (linted the HEAD
  copy), untouched by this pass. Left alone rather than silently adding a suppression to unrelated code — say
  the word and I'll add the disable comment the codebase uses elsewhere.

### 22 · Campfire flame glyph — flagged for step 1, not touched
- [ ] approve — **NOT FIXED, wrong owner**
- The apply prompt anticipates a "#1 campfire flame glyph" item. The campfire's flame is
  `heat-flame.tsx` via `CampfireHeader` / `campfire-flame.tsx` / `campfire-flame-stage.tsx`, and **flame
  components belong to step 1 (`feat/global-flame`)**, which is editing `flame-logo.tsx`, `flame-icon.tsx`,
  `personal-flame.tsx` and `session-flame.tsx` in this tree right now. Flagging rather than editing, per the
  ownership map.
- Worth the flame agent's attention: `heat-flame.tsx` is **not** in their current change set, and it is
  deliberately *not* the brand mark — it is a three-state coal-bed gauge whose paths are copied verbatim out
  of `design-mocks/93-flame-heat-states.html`. So "flip it to the canonical glyph" may be the wrong move here,
  or it may need its own mirrored geometry. Their call, not mine.

---

## Verified working — no change needed

- `RESOLVE_B_MERGE.md` **did land as written.** `challenges-tab.tsx` is B's real implementation on A's exact
  prop contract; `database.ts` is the additive union (A's `MemberRole`/`CampfireMember` + role RPCs *and* B's
  challenge status/shape/metric/participant types); `create.tsx` and `social-challenges.ts` are B's. No
  conflict markers anywhere in `src/`, `supabase/`. No duplicate or lost symbols found.
- Migration numbering: `0094`–`0101`, `0105`, `0110`–`0111` — **no duplicate leading versions**.
- Blue floating gear: gone. Lock-in pill and hamburger are top-right in one chrome row (`campfire-header.tsx`).
- Invite domain is `philoi.app` (`INVITE_DOMAIN` in `lib/api/groups.ts`); raw URL line dropped.
- Report → Resend email: built and wired (`supabase/functions/report_alert`, 0095).
- Delete-campfire confirm uses the ember `ConfirmDialog`, not the OS alert.
- Join-requests `"column reference id is ambiguous"`: fixed in 0094.
- Watch `"status is ambiguous"`: fixed in 0099, and 0110's rewrite preserves the qualification.

## Found, NOT fixed — out of a bugfix pass's scope

These are **unbuilt v2 features**, not regressions. `create.tsx` is still on the pre-v2 schematic for them:

- **Placement (ranked) shape** — mock 114. Column and type exist; nothing creates one.
- **✨ AI custom goal metric** — `ai_config` column and the `'ai'` metric exist; no server-side Sonnet parse,
  no UI, no rate limit.
- **Calendar / custom spans** — `starts_on` / `ends_on` exist and `start_challenge` honours them; create still
  offers only 24h / 3d / 1w, no 1d/1w/1mo presets and no date picker.
- **Public name for group mode** — the field renders only in the h2h branch, so a group challenge always sends
  a null name (it is now *read* everywhere, per item 15, but there is still no way to set one).
- **Challenge photos / clips**, **watch share card**, **milestone tie**.
- `challenge_metric_value`'s `'distance'` arm sums `check_ins.distance_m` **without** `removed_at is null` or
  `check_in_qualifies_for_challenge` — inconsistent with the XP/time path. Left alone: tightening it changes
  what a live race measures mid-flight.

---

## Files changed

**New**
- `supabase/migrations/0112_challenge_loop_repair.sql`
- `src/lib/challenge-metric.ts`
- `src/components/challenge-member-ticker.tsx`
- `CAMPFIRE_BUG_LEDGER.md`

**Modified**
- `src/types/database.ts` — `SocialChallenge` gains `public_name`/`shape`/`invited_count`/`accepted_count`/
  `my_state`; new `ChallengeResultRow`; `GroupChallengeWatchRow` gains `status`/`public_name`/`member_cheers`/
  `cheered_by_me`; corrected the stale `create_h2h_challenge`/`create_group_challenge` signatures (both were
  missing `p_public_name`, which the client has been sending since 0098); new `challenge_deleted` event.
- `src/lib/api/social-challenges.ts` — `deleteSocialChallenge`, `fetchChallengeResults`
- `src/app/challenge/create.tsx` — member ticker + invite call; dropped the dead `useLeaderboard`
- `src/app/challenge-info/[challengeId].tsx` — shape-aware; Final standings
- `src/app/watch/[challengeId].tsx` — metric labels/units; group cheer under each meter; settled band
- `src/app/(tabs)/challenges.tsx` — draft band
- `src/components/challenges-tab.tsx` — invite sheet; dedupe mount fetch; thread `isAdmin`
- `src/components/social-challenge-card.tsx` — kebab; `public_name`; metric spec
- `src/components/challenge-manage-sheet.tsx` — Delete; non-live body; metric spec
- `src/components/challenge-sent-sheet.tsx` — metric spec

---

## Deploy-gated — for Noah, not run here

1. **`npx supabase db push`** → applies **0112**. Ordinary DDL plus two narrow backfill INSERTs into
   `challenge_participants` (unsettled challenges only, `ON CONFLICT DO NOTHING`, baseline 0 — so anything
   mid-flight keeps the deal it was created under).
2. **No `functions deploy` needed** — no edge function changed.
3. **Watch the first cron tick** after the push. `finalize_social_challenges` now takes `FOR UPDATE`; confirm
   the sweep still completes and that a settled challenge produces exactly one `bonus_xp_awards` row per
   racer.
4. **No native rebuild** — no new native module.
5. **Sanity query after the push** (roster and denominator now agree):
   ```sql
   select sc.id, sc.mode, sc.status,
          (select count(*) from challenge_participants p where p.challenge_id = sc.id) as roster,
          (select count(*) from challenge_field(sc.id, sc.circle_id))                  as field
   from social_challenges sc
   where not challenge_is_settled(sc.status) and sc.status <> 'declined';
   ```

---

## Process deviation — please read

This pass ran **diagnose-and-apply in one go, uncommitted, on `add-marketing-site`**, because it started before
the branch-per-agent rules arrived mid-run. Against the run order it should have been: branch
`fix/campfire-pass` **off `feat/global-flame`**, diagnose only, ledger, gate, then a separate apply pass.

**Three agents are currently writing uncommitted into `add-marketing-site` at once.** `git status` shows my
challenge files alongside step 1's flame work (`flame-logo.tsx`, `flame-icon.tsx`, `personal-flame.tsx`,
`session-flame.tsx`, `app.config.ts`, the icon/splash/favicon assets, `site/`) *and* Cindy entry-point work
(`cindy.tsx`, `cindy-consent.tsx`, `cindy-quick-sheet.tsx`) that `ORCHESTRATION.md` says is not in this batch.
My `tsc --noEmit` is therefore green over the *combined* tree, not over this pass alone.

One ownership crossing to adjudicate: **`src/lib/api/fitness-challenge-sync.ts`** is modified and it was not me.
The diff is a real, well-reasoned fix (daily goals asked the health store for a UTC-midnight window instead of
the owner's local midnight, per 0084). The ownership map puts challenge api on this pass — though that file is
arguably personal-goal/fitness rather than the campfire challenge subsystem, so the boundary is genuinely
ambiguous. Flagging rather than reverting someone else's correct work.

Two things block me from correcting the branch situation myself:

1. **`feat/global-flame` does not exist yet.** Branches present: `add-marketing-site`, `fix/app-sweep`,
   `master`, and the three worktree branches. Step 1 has not landed, so I cannot branch off it.
2. **The git writer lease is held by another session** (`e342ea95`, `.git/claude-writer.lease`). Per `AGENTS.md`
   I will not clear it without your say-so.

**No flame components or icon/splash/favicon assets were touched**, so there is no ownership overlap with step 1
— `campfire-header.tsx` consumes `HeatFlame`/`FlameLogo` but is unmodified by this pass.

The work is sitting uncommitted in the shared tree, which is the state the rules exist to prevent. Tell me which
you want and I'll do it as soon as the lease frees up:

- **(a)** Land `feat/global-flame` first, then I cut `fix/campfire-pass` off it and commit this as-is for your
  gate; or
- **(b)** I cut `fix/campfire-pass` off `add-marketing-site` now to get the work off the shared tree, and it
  gets rebased onto `feat/global-flame` at integration; or
- **(c)** I revert the working tree and re-run as a clean diagnose-only pass once step 1 lands — this ledger
  survives either way, it is the diagnosis.
