# Punchlist 22 — notifications + challenges post-build fixes

Device review after the notifications/challenges build. Grouped P0 (broken) → P1 (placement/polish).
Refs: `NOTIFICATIONS_SPEC.md` (updated Impl notes), mock **106** (bell/feed/settings visuals),
`CODE_PROMPT_profile.md`/`CHALLENGE_REDESIGN_SPEC.md`.

## P0 — functional / SQL
1. 🔴 **Watch screen SQL error — "column reference \"status\" is ambiguous".** The watch query joins tables
   that both have a `status` column and it's unqualified. **Qualify it** (e.g. `challenges.status` /
   `challenge_participants.status`) everywhere in that query/RPC. Repro: open a Friends duel → Watch live.
2. 🔴 **Notification read-state never clears.** Icarus' Feather (reached Gold) fired, but the unread badge
   doesn't reset after viewing it in-app. **Mark read on in-app view → clear the bell badge + the activity
   unread count.** Unread should persist only until seen. (Spec: Impl notes → Read-state.)
3. 🔴 **Android push didn't fire.** The Gold/relic event only appeared in the in-app feed; no OS push on
   Android. Push must fire **on the event, independent of whether the feed was opened.** Verify the whole
   path:
   - Expo **push token registered + saved** for the device.
   - **FCM configured** for Android (google-services.json / FCM key in the Expo project).
   - The fan-out actually **calls Expo push send** for push-eligible events (not just writing the feed row).
   - Master switch / category toggle / quiet hours aren't wrongly suppressing it.
   - In-app viewing must NOT cancel/suppress the push. (Spec: Impl notes → Push fires independently.)

## P1 — settings placement (IA)
4. **Move the Notifications settings menu OFF the notifications/activity tab and INTO the global Settings page,
   under a "Notifications" row.** The content Code built (All-notifications master · 5 categories · daily
   reminder · quiet hours · lock-screen previews) is good — just **relocate the entry point**. The Activity
   screen must not host category toggles or its own settings gear. Optional: a small "Notification settings"
   link on Activity that deep-links into Settings → Notifications. **Remove the off-brand blue gear** on the
   Activity screen entirely.

## P1 — Activity (in-app feed) screen polish
5. **Redesign the empty/feed screen to match mock 106 / the ember language.** Current screen looks unfinished:
   - Header casing is inconsistent (nav title "notifications" lowercase + an in-body "Activity" with a back
     chevron + a stray sliders/filter icon + a bright **blue** gear). Pick **one** clean title ("Activity"),
     drop the duplicate chevron, remove the blue gear (see #4).
   - Empty state: keep it, but style on-brand — the amber flame/bell, proper spacing, muted copy ("Friend
     requests, challenges and campfire activity show up here"). Match mock 106's feed rows for the populated
     state (leading art per event: rank hexagon, friend avatar, campfire icon, reward box).

## P1 — challenges polish
6. **Personal goal card icon is still a raw footprints emoji (👣).** Replace with the **vector** steps icon
   (ember-tinted), consistent with the other challenge/goal icons. (Was A3 in the original list.)
7. **"Resets at midnight" → user-local.** The 10k-steps card should say/reset at **local** midnight, not UTC.
8. (Verify) **Home active-challenge card.** Home still shows the tiny "vs Noah · 3d left" chip. Spec §C wanted
   an active challenge to be a **proper card that supersedes the daily fire** (mock 106). Confirm whether that
   shipped; if not, it's still open.

## P2 — dev seed: one-time test notifications (remove before prod)
Fire **two** test notifications to exercise the pipeline end-to-end (leading-art resolver + feed row + push +
badge/read-state). **One-time fire. Do NOT create a "John Doe" user row.**
- **Route them through the real fan-out** (not hand-inserted feed rows) so they test the actual path — feed
  render, leading art, Expo push, and the unread badge (ties to P0 #2/#3).
- **Event 1 — rank up:** existing rank-up notif type · actor = **synthetic** `{name:"John Doe", avatar:
  placeholder}` · payload `{rank:"Silver III"}` · leading art = **Silver III tier hexagon** (its
  `RANK_TIER_METAL`) · copy "🎉 John Doe ranked up to Silver III" · tap → profile stub / no-op.
- **Event 2 — Flame Pass purchase (TEST-ONLY type):** actor = synthetic John Doe · payload
  `{product:"Flame Pass"}` · leading art = **Flame Pass / box art** · copy "John Doe purchased Flame Pass".
  (Not a shipped notification type — purely to test product-art + copy rendering. Decide separately whether
  friend-purchase broadcasts should ever ship.)
- **Synthetic actor:** pass actor as **inline display fields** (name + avatar), `actor_id` NULL — no `users`
  row. If the feed schema requires an `actor_id` FK, relax it to nullable + denormalized display fields (or a
  reserved sentinel) and **flag it** — that's itself a useful finding (real events like these need detached
  actors too).
- **One-time guard:** a dev-only "Fire test notifications" button in the debug/settings screen (fires on tap),
  or a seed that checks a flag so it doesn't re-fire on every boot. Target = the signed-in dev user
  (`spikeythedoge1@gmail.com`). Delete after verifying.

## Acceptance
- [ ] Watch opens (no ambiguous-`status` SQL error).
- [ ] Viewing a notification in-app clears the bell badge / unread count.
- [ ] A qualifying event delivers an **Android OS push** (token + FCM verified), independent of in-app view.
- [ ] Notification settings live under **global Settings → Notifications**; Activity tab has no toggles and no
      blue gear.
- [ ] Activity screen matches the ember language / mock 106 (clean header, on-brand empty + populated states).
- [ ] Personal goal card uses a vector steps icon; resets at local midnight.
