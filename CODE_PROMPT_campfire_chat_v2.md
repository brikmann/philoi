# Code Prompt — Campfire chat pass v2 (bugs + wiring from Noah's on-device run)

The chat-first campfire (mock 101) is live. Noah's pass found several bugs + unwired actions. `integration-wave1`; client/OTA except §7a/§7b (attachment migration). Report broken-vs-working per item.

## §1 · 🔴 Owner can't edit the emoji OR the banner (both missing from Edit campfire)
`src/app/group/[groupId]/edit.tsx` renders Name / Who-can-join / Min-rank / House-rule — but **no emoji picker and no banner picker**, so the owner literally cannot change either. Add both:
- **Emoji picker** → writes `groups.emoji`. *(This REVERSES the earlier "emoji is immutable" call — Noah now wants the owner able to change it.)*
- **Banner picker** → writes `groups.banner_item_id` (reuse `campfire-banner-picker.tsx`). This is the "owner unable to edit banner" 🔴 bug — the field just isn't there.
- Both save with the rest of the Edit campfire form.

## §2 · Header copy is generic ("🔥 3 members · burnt out")
The top bar shows a generic **fire emoji** because the campfire's emoji isn't set/editable (fixed by §1 — once the owner sets 🐐 it reads "🐐 Goat"). Confirm the header renders `group.emoji` (not a hardcoded flame). The "· burnt out" heat word is fine; the generic feel is the emoji.

## §3 · Ember, not yellow (recurring) — Save changes + Share invite link
Primary buttons are rendering **flat yellow (`Colors.amber`)** instead of the app's **ember gradient (amber→coral)**:
- `edit.tsx` **Save changes** (`styles.save`/`saveLabel`).
- `group/[groupId]/invite.tsx` **Share invite link** (`styles.share`/`shareLabel`).
Swap both to the ember-gradient primary treatment (match `PrimaryButton` / the "Start a challenge" fill). **Audit the campfire surfaces for any other solid-`Colors.amber` button and fix them the same way** — this keeps recurring.

## §4 · 🔴 Own-message colour + compressed embeds (`src/components/circle-timeline.tsx`)
- **Own messages render flat orange, not the ember treatment** from mock 101. The `isOwn` bubble (~line 252) should be the coral→ember gradient bubble the mock shows, not flat orange.
- **Embeds are compressed** — Strava activities, lock-in cards, and study-session cards render as a tall, thin, squished box (see screenshots). Fix the embed wrapper's layout so lock-in/Strava/challenge embeds render at their natural size (a width/height/flex constraint in the chat embed container is crushing them). They should look like the mock's inline embeds, not a vertical sliver.

## §5 · Leaderboard "This week" vs "All time" is meaningless (`src/components/campfire/leaderboard-panel.tsx`)
Both tabs show the same thing (lock-ins this week + total XP). Make the toggle actually change the metric:
- **This week** → XP **earned this week** (the weekly delta), ranked by that.
- **All time** → total XP, ranked by that.
Use the Sunday-anchored week helper (shared weekly window). The number under each member must change when you flip the toggle.

## §6 · Members screen (`src/app/group/[groupId]/members.tsx` or its component)
- **Remove "· X with keys"** — just show the member count ("3 members").
- **Add a native search field** to find a member by name/handle.
- **Make member rows tappable → open that person's profile.** This is where people will naturally add each other as friends, so the row should route to the profile (with the add-friend action available there).

## §7 · Unwired FAB actions
- **§7a · 🔴 Post a photo** — currently returns "Not wired up yet — the messages table has no attachment column." Add a **migration** adding an attachment column to the campfire messages table (kind + storage ref, mirror the Agora attachment model in `agora-attachment.ts` / `agora/compose.tsx`), the storage upload, and the render in `circle-timeline`. Additive migration on the one push path; report snapshot age.
- **§7b · Share a lock-in** — same blocker (attachment). Once §7a's attachment column exists, wire "share a lock-in" to post a lock-in card into the feed (reuse the lock-in embed).
- **§7c · Ping a member** — the `PingMemberSheet` (`src/components/campfire/ping-member-sheet.tsx`) opens but the send does nothing. Wire it to fire a **silent direct notification** to the chosen member through the notify/push path (see `CODE_PROMPT_campfires.md` R6 — campfire notifications). No chat message — it's a silent nudge.

## Working / no action
Kebab menu + the new custom icons look good; banner art (constellations) renders; Edit campfire layout is otherwise fine.

## Guardrails
- One branch; §7a/§7b are additive migrations (report snapshot age), rest is client/OTA.
- §1 reverses the emoji-immutability rule — emoji is now owner-editable.
- Ember gradient everywhere a primary button currently renders solid yellow.
