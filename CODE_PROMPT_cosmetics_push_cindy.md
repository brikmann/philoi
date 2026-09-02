# Code Prompt — three device-smoke fixes: push, cosmetics, Cindy circle

Three bugs found on the Android wave build. #1 (Cindy circle) is already fixed on this branch — verify only. #2 (push) has a confirmed one-line root cause. #3 (cosmetics) is a render-vs-mock audit. All three are client-side except the push verification, which touches no schema (the server push path already exists and is deployed).

Branch off the current working branch (`worktree-focus-nudge`, which carries the wave). All three are JS/TS — no native rebuild, OTA-able over Metro.

---

## 1 · Cindy tap-ring sitting over the flame — ✅ ALREADY FIXED, verify only

`src/components/cindy/cindy-flame-press.tsx` — the ring's resting opacity was `(1 - progress) * 0.42`, and `progress` is `0` at rest, so a static ember ring hovered over the flame permanently (hidden behind the 132px home flame, but peeking past the 200px lock-in flame). Fixed to `progress.value === 0 ? 0 : (1 - progress.value) * 0.42`.

**Verify:** start a lock-in → the flame is clean, no circle. Tap it → the ripple still fires. Home flame tap → ripple still fires. Nothing else to change here unless the ripple regressed.

---

## 2 · Push notifications never fire — CONFIRMED ROOT CAUSE

The in-app feed row is written for every event (`notify_event` inserts into `notification_events`), but **no device push arrives for anything.**

**Root cause:** `src/app/_layout.tsx` ~line 113 gates push-token registration on `hasCircle`:

```ts
if (appReady && session && !needsHandle && !needsConsent && !needsAccountDisabled && hasCircle) {
  registerPushToken(session.user.id);
}
```

A user who hasn't joined/created a campfire **never registers a push token**, so `push_tokens` is empty for them → the server's `notify_push_raw` builds `[]` messages → `net.http_post` to Expo is skipped → zero pushes, forever, for every event type. This is why the feed fills but nothing pushes.

**Fix (client, OTA):** register the token as soon as the user is authenticated and past the handle/consent/account-disabled gates — **drop `&& hasCircle`** from the condition (and its dep array). Token registration must not depend on social state; a solo user still gets rank-ups, relics, session-complete, streak risk, etc.

```ts
if (appReady && session && !needsHandle && !needsConsent && !needsAccountDisabled) {
  registerPushToken(session.user.id);
}
```

Keep `registerPushToken` itself as-is (it already requests permission, ensures Android channels, reads `expoConfig.extra.eas.projectId` which is present, and upserts `push_tokens`). The only change is *when* it's allowed to run.

**Then verify the whole path on-device (this is the real test — the client was never exercised):**
1. Fresh session → confirm a row lands in `push_tokens` for your user id (log the token, or check the table).
2. Trigger a feed event (finish a lock-in for `session_complete`, or earn a rank/relic) → confirm a **banner arrives on the device**, not just a feed row.
3. If the feed row appears but no push: check, in order — (a) `push_tokens` has your row; (b) `profiles.notification_prefs` master/category/`type_<event>` aren't false; (c) you're not inside quiet hours; (d) `net.http_post`/`pg_net` is enabled in the project and the Expo response isn't `DeviceNotRegistered` (a stale token from a prior build — delete and re-register).

**One correctness check while you're here:** `notify_event` excludes the actor with `where p_actor_id is null or u <> p_actor_id`. Confirm the **self-targeted** events (rank-up, relic unlock, session-complete) call `notify_event` with `p_actor_id => null` (or an actor that isn't the recipient) — if any of them pass the recipient as `p_actor_id`, the row is silently dropped for the one person who should get it. Grep the `notify_event(` call sites in `supabase/migrations/012*`/`013*`. If one is wrong, fix it in a **new additive migration** (do not restate an existing function — the wave's rule; splice and prove `prosrc` removes nothing).

---

## 3 · Cosmetics don't render to their mocks (flares / particles / cards)

Equipped flares and particles don't match their mock designs. The mocks are the source of truth and were iterated heavily — match them **exactly**, not approximately.

**Render code:**
- `src/components/economy/flare-perimeter.tsx` — the app-wide perimeter flare aura.
- `src/components/economy/item-art.tsx` — the 11 procedural ArtKinds (flame/particle/flare/card/halo/…).
- `src/components/economy/applied-art.tsx` — EquippedCardBackdrop, EquippedAvatarHalo.
- `EquippedFlameParticles` (used in `src/app/lock-in/index.tsx` and `src/app/(tabs)/index.tsx`, sits *behind* the flame).

**Mocks (open these and match per-variant):**
- `design-mocks/167-flare-effects.html` — the perimeter flares. Each must match its own final iteration:
  - **Zeus' Wrath** — whole screen **yellow**; lightning strikes appear **randomly across the screen from dark clouds at the top**; each bolt jagged/random per strike.
  - **Asgardian Valor** — screen **blue**; **top-to-bottom hammer strikes**, fewer but **thicker** bolts, each with a **jagged ragged impact mark** at the bottom.
  - **Toxic Rain** — clouds at top; **blob drops** (not thin streaks).
  - **Inferno Flare** — **full-screen engulf**: fire from top, bottom, AND both lateral edges (the laterals carry the same count as top/bottom).
  - **Void Plasma** — **purple**; faint **pulse** (circles pulsing, not popping).
  - **Emberfall Ascendant** — rising embers from the middle **and** the edges.
  - Every flare fills the **entire screen** with its perimeter colour, not just the border.
- `design-mocks/166-particle-effects.html` — the particle sets. Particles must **ascend from the top like smoke** (not emit from the centre only); **ember swarm circulates the fire**; **void smoke is gothic**. Render each against its marquee.
- Cross-refs if useful: `126-flames-particles-flares.html`, `63-item-art-flames-particles.html`, `88-flare-auras.html`.

**Method:** for each equipped variant, open the mock, run it in the app, and diff. Fix colour, motion direction, coverage, and count until they're identical. Where the mock uses a generated/random algorithm (Zeus/Asgardian lightning), port the algorithm, not a static frame.

**Also flag:** cards / banners / halos (outward-facing, mocks 158/165) — verify these render to spec too; fix any that drifted.

---

## Guardrails
- Mocks are the source of truth; "close enough" is a fail. The flare set in 167 was iterated many times to land exactly — honour the final state.
- All three fixes are JS/TS and OTA-able; no native rebuild. Smoke on-device over Metro.
- The push fix is a one-line gate change plus verification — resist rewriting `registerPushToken` or the server path; the plumbing works, it was just never reachable.
- If the self-actor migration fix is needed, it's **additive-only** (wave rule): splice onto the extracted body, prove `prosrc` before/after removes zero lines.

## Done =
- Lock-in flame has no circle over it; ripple still fires on tap (verify).
- A fresh session registers a `push_tokens` row; finishing a lock-in delivers a **device banner**, and toggling a type off in Settings suppresses it.
- Each equipped flare and particle set renders **identical to its mock** (166/167); cards/banners/halos verified.
