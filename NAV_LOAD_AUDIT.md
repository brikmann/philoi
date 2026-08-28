# Global nav — does every destination load? (audit)
_Checked each route's actual screen file on `add-marketing-site`. "Real" = substantial screen that renders live data. Line counts in parens._

## ✅ Loads — real, substantial screens
- **Home** — `(tabs)/index.tsx` (1008). The flame / lock-in hub.
- **Leaderboards** — `(tabs)/leaderboards.tsx` (676).
- **Challenges** — `(tabs)/challenges.tsx` (482).
- **Profile** — `(tabs)/profile.tsx` (580).
- **Flame Pass** — `forge-pass.tsx` (1240). Fully built season track.
- **Shop** — `shop/index.tsx` (500) + `box/` + `item/` + `open.tsx` (646).
- **Inventory** — `inventory/index.tsx` (693) + `[itemId].tsx` (379).
- **Settings** — `settings.tsx` (624).
- **Campfires** — `campfires.tsx` (14) — *thin wrapper, not a stub*: renders the real `ValleyPage` with group data, relocated from Home's old pager to the drawer. Loads fine.
- **Friends** — `people.tsx` (385) + `add-friend.tsx` + `friend-profile.tsx`.
- Supporting: Trophy Hall (436), Collection (327), Lock-in history (245), notifications, university-leaderboard, cindy, paywall — all real.

## ⚠️ Nav items with NO screen yet (must build before the drawer is complete)
- **Forge (crafting)** — **no route.** `forge-pass.tsx` is the *Flame Pass*, a different thing. The Forge crafting sink (`forge_cosmetic()` / `stoke_reroll()`) is unbuilt — backend and screen both. The drawer's "Forge" item (mock 161) has nowhere to go.
- **The Agora** — **no route.** Backend (`agora_posts`/`agora_comments`) and screen (mock 162) both unbuilt. Drawer's "The Agora" item has nowhere to go.

## 🟡 Wired but showing "coming soon" (UI/flag gaps, not missing screens)
- **connected-apps.tsx** shows **Google Calendar "coming soon"** (line 234) even though the GCal backend + `coach/gcal.ts` are built — a UI-wiring gap, worth flipping on.
- Fitness `StubRow`s show "coming soon" — tied to `FITNESS_SYNC_ENABLED=false` (task #43). Flip the flag + the Strava/Health rows go live.

## Verdict
The app is **programmatically complete except for the two unbuilt features already on the plan** — the Forge and the Agora (both need backend + screen). Everything else in the drawer loads a real screen today. Two small wiring fixes (GCal "coming soon", fitness flag) are cosmetic-adjacent, not missing screens.

So before the "cosmetic UI + campfire/challenge polish + settings cleanup" phase, the only *structural* gaps are: **build the Agora** (#139) and **build the Forge crafting screen** (its backend is also unbuilt). After those, the nav is whole.
