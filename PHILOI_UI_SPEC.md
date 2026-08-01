# Philoi — UI Implementation Spec (hand-off)

*The build-ready spec, derived from the approved campfire mockup. Exact tokens, the flame logo, and screen layouts. This operationalizes the direction in `UI_REDESIGN_SPEC.md` — Code builds from **this** doc. Dark/twilight theme is the default. Font, color, and the flame logo are considered locked; the flame vector below is the working logo while final refinement continues.*

## Design mocks (pixel-exact reference)

Approved screen designs live in **`design-mocks/`** — open each in a browser and **build the screen to match it** (this doc gives the rules; the mock gives the exact pixels + animations). Map: `01` splash (§20) · `02` home swipe (§5) · `03` campfire lock-in screen (§6) · `04` field (§10) · `05` rank-up Infernal (§11) · `06` campfire interior chat (§12) · `07` goal picker (§12) · `08` solo campfire (§12) · `09` running session (§13) · `10` create campfire/class (§14) · `11` leaderboard (§15) · `12` challenges tab (§16) · `13` start challenge (§16) · `14` fitness sync (§17) · `15` profile (§18) · `16` settings (§19) · `17` onboarding (§21).

---

## 1. Design tokens

### Color — twilight purple base
Rich deep twilight purple background, cream text, firelight accents.

| Token | Hex | Use |
|---|---|---|
| `twilight-900` | `#14111C` | deepest — nav bar, phone frame, behind everything |
| `twilight-800` | `#1B1726` | **app background** (every screen) — the deep twilight purple |
| `twilight-700` | `#241C38` | elevated surface — cards, sheets, fields, discover rows |
| `twilight-600` | `#2D2740` | controls, avatar bg, progress-track bg |
| `plum-500` | `#3A2E5C` | brand plum — lighter accent surface, logo backplate |

### Color — firelight accent
| Token | Hex | Use |
|---|---|---|
| `coral` | `#E0612C` | primary accent — CTAs, active state, logo outer flame, XP fill |
| `amber` | `#F2A33C` | mid flame, sparks, secondary accent |
| `ember` | `#FFD27A` | flame core, highlights, accent text on dark |
| `log-brown` | `#8A5A2B` / `#6E4423` | logo logs |

### Color — text & lines
| Token | Hex | Use |
|---|---|---|
| `text-primary` | `#FFF6EC` | headings, body (cream) |
| `text-secondary` | `#A99CBD` | muted lavender — subtitles, meta |
| `text-tertiary` | `#7C7194` | hints, disabled |
| `line` | `rgba(255,255,255,0.08)` | hairline borders |
| `line-strong` | `rgba(255,255,255,0.12)` | field borders |

### Semantic
`success` `#3DA85C` (streak alive) · `info` `#4FB0E5`. Warm chip bg `#3A2A22` / text `ember`. Cold chip bg `#3A3350` / text `#C9BDE6`.

### Shape & spacing
Radii: cards `12px`, buttons/inputs `14px`, pills `999px`. Spacing scale: `4 / 8 / 12 / 16 / 24 / 32`. Avatar overlap: `-8px`.

---

## 2. Typography

- **Family:** `Inter` (replaces Fredoka + Nunito — the rounded Fredoka is what read as "AI slop"). Clean, neutral, athletic. Load via `expo-font`.
- **Weights:** 400 regular, 500 medium (default for labels/headings), 600 for big numbers (rank, XP, session time). No rounded display face.
- **Scale:** screen title 17 / 500 · section 15 / 500 · body 13–14 / 400 · meta & captions 11–12 · big numerals 24–28 / 600.
- **Case:** sentence case everywhere. No ALL CAPS.

---

## 3. Logo — the campfire flame (Philoi's new mark)

The campfire (crossed logs + three-layer flame) is the logo. Working vector below — build the mark from this; a designer can refine curves later without changing the system.

```svg
<svg viewBox="0 0 120 150" xmlns="http://www.w3.org/2000/svg">
  <!-- logs -->
  <rect x="30" y="112" width="60" height="9" rx="4" fill="#8A5A2B" transform="rotate(18 60 116)"/>
  <rect x="30" y="112" width="60" height="9" rx="4" fill="#6E4423" transform="rotate(-18 60 116)"/>
  <circle cx="60" cy="116" r="4" fill="#F2A33C"/>
  <!-- flame: outer / mid / core -->
  <path d="M60 20 C74 46 90 62 85 92 C82 108 72 116 60 116 C48 116 37 107 37 92 C37 82 42 76 47 72 C44 84 51 92 59 92 C68 92 72 82 67 72 C60 58 52 44 60 20 Z" fill="#E0612C"/>
  <path d="M60 44 C70 62 78 74 74 92 C72 104 67 110 60 110 C52 110 47 103 47 93 C47 86 50 82 54 80 C52 88 56 94 61 94 C67 94 70 87 67 80 C62 70 56 58 60 44 Z" fill="#F2A33C"/>
  <path d="M60 66 C66 78 70 84 68 94 C67 101 64 105 60 105 C55 105 52 100 52 94 C52 88 55 84 60 66 Z" fill="#FFD27A"/>
</svg>
```

**Variants:** app icon = flame centered on a full-bleed `twilight-800`/`plum-500` square, no transparency (see the flattened `philoi_strava_icon` already produced). In-app mark = flame only. Monochrome = single `cream` fill for small/nav use.

---

## 4. The living flame (signature motif + states)

The flame is the app's core visual — a live gauge of activity, reused at three scales (session → campfire → app). States:

| State | Trigger | Look |
|---|---|---|
| Roaring | multiple locked in / hot streak | large, fast flicker, sparks rising, ember core bright |
| Steady | some activity | normal flame, gentle flicker |
| Going cold | fading activity | smaller, dimmer, grayscale drifting in |
| Out / smoking | dormant | grey smoke wisps rising, ~50% opacity, embers only |

### Animations (from the mock — keyframe reference)
- **Flicker (steady):** `scaleY 1→1.05→1`, `scaleX 1→0.97→1`, 1.6s ease-in-out infinite. Transform-origin `50% 88%` (flame base).
- **Roar:** 0.9s — at 30% `scaleY 1.13 / scaleX 0.94`, at 60% `scaleY 1.06 / scaleX 1.02`.
- **Spark (roaring):** small `amber` dots, `translateY 0→-95px, scale 1→0.3, opacity 0.9→0`, 1.4s, random delay/offset, ~5–6 emitters.
- **Smoke (out):** grey dots, `translateY 0→-100px, scale 0.7→1.8, opacity 0.32→0`, 3.2s.
- Respect reduced-motion: fall back to a static flame per state.

### Flame skins (Philoi Fire cosmetic — see MONETIZATION.md)
Paid **flame skins** recolor the flame's palette (ember-blue, emerald, violet, molten-gold, seasonal). **Hard constraint: a skin may only change the color ramp — never the state legibility.** Intensity/size/animation must still read *activity* exactly as the table above (roaring vs steady vs going-cold vs out). Implement skins as a swappable **palette/gradient token set** layered under the same state logic, so activity remains unambiguous regardless of skin. Subscribers may also carry a subtle persistent ember-glow so being on Philoi Fire is visible — but it must not be confusable with the "roaring" activity state.

---

## 4b. Global chrome — shared shell (backgrounds · header · tab bar · keyboard)

*These keep drifting per-screen. They are GLOBAL: implement once in a shared shell, never re-implement (or override) per screen.*

### One background everywhere
Every screen uses the **same app background — `Colors.cream` / `twilight-800 #1B1726`** (the flat twilight). No screen sets its own darker/lighter bg. Only exceptions: the **bottom tab bar** (slightly lighter surface), and the two deliberately-immersive full-screen moments — the **running lock-in session** and the **rank-up forge** (`#17131f`) — which are documented one-offs. In particular the **campfire interior / valley must be `#1B1726`** (this has regressed repeatedly — it must not carry its own darker bg).

### One shared header, identical height
The other main-tab titles ("Leaderboard" · "Challenges" · "Profile") render through **one shared header component** so they sit at the **same top inset, height, and type size/weight** — switching tabs must not jump the title. On those tabs the header's right side carries only what a screen genuinely needs (e.g. a **settings gear** where relevant) — **no redundant profile/friend avatar** (the bottom Profile tab already goes there).

**Home is the exception — no title.** The Home ("Your fire") header carries **no title label at all** (the word "Your fire" + flame icon were clutter; the centered greeting below already owns the screen). Instead its two top corners hold the two key menus so both are one tap from home: **friends icon top-LEFT**, **settings gear top-RIGHT**. Same top inset/height as the other headers so nothing jumps.

### Bottom tab bar — line icons, not emoji
Four tabs: **Campfires · Leaderboards · Challenges · Profile.** Use clean **line icons** (Tabler/Ionicons outline), **not emoji** — emoji render inconsistently across devices and clash with the twilight aesthetic. Campfires uses the **brand flame vector** (the signature mark); the others = `trophy` / `target` / `user` outlines. **Active tab = coral `#E0612C`**, inactive = muted grey, short text label under each. The bar sits on the lighter surface.

### Keyboard avoidance (app-wide)
Every screen with an input lifts its UI above the keyboard — iOS `KeyboardAvoidingView` (`behavior="padding"`, tab-bar height as `keyboardVerticalOffset`); Android `windowSoftInputMode = adjustResize`. No input (campfire composer, valley search, challenge fields, etc.) should ever sit behind the keyboard.

### Navigation & entry points — one home for everything
Primary navigation is the **bottom tab bar only** (Campfires · Leaderboards · Challenges · Profile). Secondary destinations get **exactly one** entry point — no duplicates, and each header carries at most one right-side action pointing to a *different* destination per screen:
- **Friends ("Your people", mock 21):** a **friends icon in the Home (Campfires) header, top-LEFT** — the single Friends entry. NOT under Profile.
- **Settings:** the **gear in the Home header, top-RIGHT** (primary — so both key menus are reachable from home with minimal effort). It may also remain in the Profile header as the conventional spot; both open the same settings.
- **Add a friend / accept friend requests (mock 34):** inside the Friends screen — search by `@username`, with **send → accept/decline** requests.
- **Join a campfire:** in the **valley / discover** ("Have a code?" + search + "Start your own"). NOT in the Friends screen.
- **Remove** the profile avatar from Home (the Profile tab already goes there).

### A "friend" = a mutual connection, NOT a campfire member
A **friend** is someone you explicitly **add** and who **accepts** — a real, mutual friend graph (friend requests: send / accept / decline, mock 34). It is **NOT** "anyone in one of my campfires." Campfire membership and friendship are separate graphs. The **friend ping** (mock 21) and **friend-to-friend H2H challenge** (§16, mock 13) operate on your **friends**, not on campfire members. (Gated-campfire *join* requests, mock 22, are a different thing entirely — approving who joins a campfire, not who's your friend.)

---

## 5. Screen — Campfire home (swipeable)

Full-screen `twilight-800`. **Two pages only**, horizontal pager (2 dots):
- **Page 1 = "Your fire"** (solo): **no header title** (see §4b — friends icon top-left, settings gear top-right only); a **centered** dynamic greeting (below), living flame, streak + personal rank hex + XP bar, recent lock-ins, CTA "Lock in". Default page.
- **Page 2 = the valley** (discovery, §10) — the searchable field (My fires / My school / Classes / Popular), where your joined campfires live under "My fires". Reached by swiping right; no Saturn button.

There is NO scroll-wheel of per-campfire cards and NO separate "Find a campfire" list. Only fully animate the centered flame (perf).

### Dynamic home greeting (page 1) — by today's lock-ins × time of day
The greeting line is driven by **how many lock-ins the user has logged today** (resets local midnight) and the **time of day**. It is **horizontally centered** (it replaces the old header title as the screen's top anchor). **While a session is actively running, show NO greeting** — the flame + live mini-map (§5b/§13) carry it. Rotate among variants (random or round-robin) so regulars don't see the same line twice.

Time buckets: Morning 5–11 · Afternoon 11–17 · Evening 17–21 · Late 21–5.

| Count today | Line(s) |
|---|---|
| **0** (fresh) | Morning: "Morning, {name} — first lock-in?" / "New day, {name}. Let's light it." · Afternoon: "Afternoon, {name} — time to lock in." / "Still fresh, {name}. Let's go." · Evening: "Evening, {name} — get one in?" / "There's still time, {name}." · Late: "One before bed, {name}?" / "Late night, {name} — quick one?" |
| **1** | "Nice lock-in, {name}. Want to keep going?" / "That's one, {name} — keep the fire going?" · *(evening)* "Good one, {name}. Night's young." |
| **2** | "2 down, more to go, {name}." / "Two in, {name} — rolling now." |
| **3** | "Three's a charm, {name}." / "Hat trick, {name}." |
| **4** | "You're heating up, {name}." / "Four deep, {name} — dialed." |
| **5** | "You're on fire today, {name}!" / "Five and blazing, {name}!" |
| **6+** | "Unstoppable, {name}." / "The fire's roaring, {name}." / "Certified machine, {name}." |

**Tone arc (hold this):** nudge early (1–2 invite "more"), **celebrate late** (5+ is pure praise, never "do more"). **Late-night wind-down:** at high counts in the **Late** bucket, swap in a rest line instead of a nudge — e.g. "Huge day, {name}. Rest up." — so the app never pushes someone to grind past midnight. This keeps the feature feeling on the user's side, not milking engagement.

### Daily flame meter (page 1) — today's fire
Two progress tracks, rendered as **vertical bars flanking the hero campfire** (mock `30-fire-rank-layouts.html`, option B): **Today's fire bar on the LEFT, rank bar on the RIGHT**, the campfire + streak centered between them. Each column = badge on top, vertical fill bar, XP underneath, label underneath ("Today's fire" / the rank name). Normalize the two: the **fire badge is the same size as the rank hex**, and the **"Today's fire" label is the same size as the rank name**. Below the flanked hero sits the **"Lock in" CTA**, and the freed bottom third holds **"Your recent lock-ins."** Position alone carries the two-track meaning — **fire = today (left), rank = forever (right)**. (The `26-flame-meter.html` fill tiers — ⅓ embers → ⅔ particles → full ignites — still describe the fire bar's states, adapted to the vertical bar.)

**Completion is once per day.** When it fills → **bonus XP** (+ reserve the hook for **ember** currency, see MONETIZATION.md) + a completion card + a fill sound (§22) + haptic. Lock-ins *beyond* completion still earn normal rank XP but do **not** re-trigger the reward — it's a daily "I showed up" milestone, **not farmable**.

**Animation tiers** (Reanimated; reduced-motion → static per tier):
- **⅓** — slow rising embers off the fill.
- **⅔** — more/faster particles.
- **Full** — small, faint flames ring the **whole perimeter** (pointing outward) + steady rising embers + a **steady** soft glow (no pulsing).

**Publish (opt-in):** completing the meter can publish an "I completed my fire today" card to the user's campfires — like a lock-in. **Consent-gated**, toggle in Settings, **default off**.

#### Daily goal = adaptive by default, static override available
- **`daily_goal_mode = auto` (default):** today's target is computed from the user's **rolling ~14-day average lock-ins/day**, with guardrails so it motivates without punishing:
  - **Floor of 1** (always an achievable fire) and a **cap** so it can't spiral.
  - **Small stretch** only after the user has hit goal several days running — progression is *earned by consistency*, not imposed.
  - **Adapts DOWN as well as up** — eases when they slow (rest week, exams), climbs back as they ramp. It meets you where you are.
  - **Smoothed** off the average, so one monster day or one zero day doesn't whipsaw tomorrow.
  - **New users:** gentle fixed default (~1) for the first ~week until there's history.
  - *Principle:* this is real progressive overload (includes deloads/plateaus), not infinite linear increase. "A little more than yesterday" motivates; "always more forever" burns people out and leaks users.
- **`daily_goal_mode = manual`:** user sets a fixed daily target in Settings.
- *Data (Code):* persist `daily_goal_mode`, the computed/target value, today's progress, and a per-day `completed` flag.

### Global live-session inset (app-wide)
When a lock-in is active, the mini-map (§5b) is pinned at the top **on every screen**. Reserve a **single global top inset** at the root/tab layout — equal to the bar's height + a small gap, below the safe area — that pushes **all** screens' top content down: home, campfires, campfire interior, leaderboard, challenges, profile — everything. When no session is active the inset is **zero** (no reserved space). Implement it **once, globally** — no per-screen offsets — so nothing can collide with the bar on any page. (The running-session route, where the mini-map is suppressed, needs no inset.)

---

## 6. Screen — the Campfire (lock-in screen)  ← primary spec

Top → bottom, on `twilight-800`:

1. **Header row:** campfire name (17/500 cream) + subtitle ("6 in this campfire", `text-secondary`) on the left; on the right, your **personal rank badge** (mini hexagon + XP, tap → profile) and the **state chip** (Roaring = warm chip; Going cold = cold chip). *Your rank (top) and the campfire level (bottom) are two different things — both visible at a glance.*
2. **Flame stage (center):** the living flame at its current state. **Feed photos scattered around the fire** — small white polaroid-style cards (~50px, 4–6px radius), tilted `-9°…+8°`, each with the poster's photo + a tiny name caption; the **most recent posts get a 2px `coral` outline** ("fresh"), older ones sit plain. Photos are **opt-in only** (respect the profile photo-privacy toggle); in public/discoverable campfires show only photos the poster made public.
3. **Presence line:** "{Name} & {n} others locked in right now" in `ember`, centered.
4. **Avatars row — directly under the presence line:** overlapping circles (32px), `-8px` overlap. Those **locked in now are "lit"** (`coral` border, `#3A2A22` bg, `ember` initials); others dimmed (`opacity 0.45`); overflow shows `+N`.
5. **Footer:**
   - **Campfire level:** a rotated-square hex badge (34px, `#3A2A22` bg, `amber` border, level number) + an XP progress bar (`track` = `twilight-600`, fill = `coral`) labelled "Campfire level {L}" and "{xp} / {next} XP". *This is the campfire's shared level — every member's lock-ins feed it, and each lock-in also feeds the user's own personal rank.*
   - **Group streak line:** `ti-flame` (amber) + "{d}-day group streak · keep it lit".
   - **CTA (full-width, `coral`, 14px radius):** for a member → **"Lock in with them"**; for a non-member viewing via discovery → **"Join this campfire"**.

---

## 7. Components (from the mock)

- **Avatar:** 32px circle, `twilight-600` bg, 2px `twilight-900` border, `-8px` overlap. *Lit:* `coral` border, `#3A2A22` bg, `ember` text. *Off:* `opacity 0.45`.
- **Feed photo card:** ~50px, white bg, 5px radius, 4px pad; image area ~44px with the post; 8px caption in `twilight-700` text. *Fresh:* 2px `coral` outline. Tilted. Tap → opens the feed.
- **Campfire-level bar:** hex badge (rotate 45°, number upright) + label row + 6px progress track (`twilight-600`) with `coral` fill.
- **Chip:** 11px, pill. Roaring `#3A2A22`/`ember` · Going cold `#3A3350`/`#C9BDE6` · Solo `twilight-600`/`#CBBFE0`.
- **CTA button:** full-width, 14px radius, 14px pad, 15/500. Primary = `coral` on cream text; cold variant = `#3A3350` on `#E7DDF5`.

---

## 8. Implementation notes for Code (Expo / React Native)

- **Flame:** render with `react-native-svg`; drive flicker/roar via `react-native-reanimated` (animate the flame `<g>` scale, origin at base). Sparks/smoke = looped reanimated views. **Only animate the on-screen/centered flame** — pause off-screen ones for perf. Lottie is an acceptable alternative if smoother.
- **Home swipe:** paged `FlatList` (or reanimated + gesture-handler) — one campfire per page; lazy-render adjacent pages lightly.
- **Feed photos:** `expo-image`; render only opted-in posts; cap to the ~4–6 most recent around the fire; lazy-load.
- **Fonts:** load `Inter` (400/500/600) via `expo-font`; remove Fredoka/Nunito from `theme.ts`.
- **Theme:** make the twilight tokens above the default theme; keep a light variant as a later toggle. Update `philoi_brand_kit.md` + `src/constants/theme.ts` to these values.
- **Accessibility:** cream-on-twilight passes AA; never encode state by color alone (flame *shape/size* + chip label carry meaning); honor reduced-motion.

---

## 9. Navigation & transitions (motion)

**Golden rule:** navigation is *quiet* (fast, subtle) — reward moments (rank-up, lock-in start) are *loud*. A nav transition must never compete with a celebration. And the axes carry meaning: **horizontal swipe = which campfire · vertical push = deeper into one · pinch/zoom = out to the field, in to a fire (§10) · tabs = a different space entirely.** Keep those distinct or the app feels muddy.

### Motion tokens
- **Easing (standard, decelerate):** `cubic-bezier(0.22, 0.61, 0.36, 1)`.
- **Gesture spring** (swipe settle): stiffness ≈ 180, damping ≈ 22 (tune on device).
- **Durations:** tap feedback 90ms · tab/screen 200ms · drill-in 320ms.

### Horizontal — swipe between campfires (Home)
- Finger-tracked 1:1 `translateX`; on release, **spring-settle** to the nearest card (or fling to next on high velocity). Rubber-band resistance at the first/last card.
- **Depth:** the photo/foreground layer translates ~1.15× the background for subtle parallax. The leaving flame dims and pauses; the **arriving flame resumes its state animation** (roar/steady) as it centers — the fire "comes alive" when it's yours to see.
- **Pager dots** animate *with* the drag (active dot elongates + `coral`), not just on settle.

### Bottom tabs — Campfires · Leaderboard · Challenges · Profile
- **Do not slide horizontally** — that's reserved for the campfire swipe. Tab changes are a **cross-fade + rise**: incoming screen `opacity 0→1`, `translateY 10→0`, `scale 0.98→1` over 200ms; outgoing `opacity 1→0` faster (~140ms) with **no movement** — a clean cut, not a shove.
- **Active tab icon** lights to `coral`/`ember` with a one-shot flame flicker (150ms `scale 1→1.12→1`); inactive icons `text-secondary`. Optional small ember dot under the active tab.
- Tabs are peers — no stack-slide hierarchy between them.

### Vertical — drilling into a campfire (chat / leaderboard / members)
- Tap a campfire, or swipe up → detail **pushes up** from the bottom (320ms, standard easing); back pushes down. This is what makes "horizontal = which fire, vertical = deeper" legible.
- *Stretch (nice-to-have):* shared-element — the campfire's mini flame scales/moves into the detail header so it feels continuous, not a hard screen swap.

### Reduced motion & performance
- **Reduced-motion:** replace everything above with a flat 120ms cross-fade; no translate/scale/parallax.
- Run all of it on the UI thread (Reanimated worklets / native driver). Animate **transform + opacity only** — never layout or the width of real content.
- **Expo Router / React Navigation wiring:** custom bottom `tabBar` + a Reanimated cross-fade wrapper for tab screens; the campfire pager lives *inside* the Home screen; campfire detail is a stack route with a custom vertical `cardStyleInterpolator`.

---

## 10. Screen — Campfire field (overview)

*The zoomed-out counterpart to the home swipe: all your campfires as fires across a dark twilight valley. Solves scanning when you're in many, doubles as an at-a-glance "are my worlds alive" dashboard, **and is where you discover + join new campfires** (there's no separate flat search list — the field IS find-a-campfire). Mock: `design-mocks/04-campfire-field.html`.*

**Purpose & feeling:** open it and see your communities as points of firelight in the dark — roaring where friends are active, smoking where they've gone quiet. The alive ones pull your eye; the cold ones gently nudge ("relight").

### Entry / exit (the zoom axis)
- From a campfire (Home): **pinch-out**, or tap an overview control (top-left), → the camera pulls back into the field.
- In the field: **tap a fire** → zoom into that campfire (shared-element: the field flame scales up into the campfire screen's flame). Pinch-in on the centered fire does the same.
- This makes the third spatial axis explicit — see the §9 golden rule.

### Layout
- Background: `twilight-900` night with a subtly lighter ground band toward the bottom (a valley receding into dark). Flat and minimal — points of light, not scenery.
- Fires sit at **stable positions** (hash the campfire id → position, so the field is a consistent *place* and never reshuffles).
- **Depth by activity:** the most active campfires render larger and toward the foreground; quieter/cold ones smaller and toward the back — so "where's the action" reads instantly.
- If the field exceeds the screen, allow **drag-to-pan** with light parallax (foreground fires move faster than background).

### Each fire node
- The living flame, **sized + stated by activity** (roaring = large, bright, sparks · steady = medium · going cold = small · out = ember + thin smoke).
- Name label under it (12/500 cream) + a tiny presence cue ("3 locked in", or a cluster of lit dots).
- **New activity pulses** to catch the eye — a brief flare/ripple when someone locks in "over there," then settles.
- Your solo "Your fire" is a node too, subtly marked as yours.

### Discovery — the field IS find-a-campfire
A **bottom control bar** over the valley turns the field into discovery (no separate flat search list):
- **Search** — filter by campfire name, course code, or school.
- **Filter toggles:** **My fires · My school · Classes · Popular.** Switching repopulates the valley (your campfires · all of your school's · class study-halls with helper counts · the biggest/hottest). **Most-active fires sort to the foreground.**
- **"Start a campfire of your own"** button.
- **Tap a fire → zoom in → Join** ("Open" if it's already yours).
- **Entry-dependent default:** pinch-out from a campfire lands on **My fires** (overview of your own); opening from a "find a campfire" entry defaults to **My school** (you came to find).
- *Optional:* long-press a fire for a quick preview (name, who's on, streak) without a full zoom.

### Motion
- Zoom-out: the focused fire shrinks back into the field among the others (continuous camera pull-back, shared-element); zoom-in reverses. 320–400ms, standard easing.
- Idle: fires flicker gently; only roaring ones animate fully.

### Performance (many fires on screen — important)
- Fully animate only the few roaring fires; render steady/cold/distant ones as low-frame or static flames. Cap the number of simultaneously-animated flames and drive them from **one shared clock**. Downscale off-center nodes.

### Sparse state
- With 1–2 campfires the field is mostly dark — lean into it: your fire(s) plus a bright "+ find a campfire" beacon, so emptiness reads as invitation, not a bug.

---

## 11. Rank-up moment (the campfire forge)

*Personal rank promotions. The fire you've fed **forges your new rank and lifts it out of the flames.** Full-screen, ~5s, deliberately slow — a "loud" reward moment (per §9), the opposite of quiet navigation.*

### The rank hexagon (badge)
Flat hexagon = **metal tier + roman-numeral division**: outer (dark metal) + inner (light metal) + numeral, with a small tier crest icon under the numeral.

| Tier | Outer | Inner | Numeral text |
|---|---|---|---|
| Bronze | `#6E4423` | `#B87333` | `#3A2410` |
| Silver | `#6B7280` | `#C4CBD6` | `#2B3038` |
| Gold | `#9A6A12` | `#F5C542` | `#4A3406` |
| Diamond | `#2C6E76` | `#7FE0E8` | `#06323A` |
| **Infernal** (apex) | `#B0431E` | `#F2A33C` (shimmer → `#F7B85A`) | `#4A1B0C` | *molten + faint firelight aura — see below* |

Divisions III → II → I within Bronze–Diamond. **This same hexagon is the persistent rank badge** on Profile + Leaderboard (resting idle breathe).

### Infernal — the apex tier (molten, with a faint firelight aura)
Above Diamond sits **Infernal**. Its hexagon isn't metal — it's **molten** (outer `#B0431E`, inner `#F2A33C` with a slow shimmer toward `#F7B85A`) and radiates a **faint, slow-pulsing firelight aura** in the hexagon's shape. **Not literal flames** — flame shapes read cheap. The aura is subtle: **fainter than the campfire smoke** (peak opacity ≈ 0.20, ~2.8s pulse). In the real build, render it as a **soft blurred radial glow** behind the badge — the flat layered-hexagon approximation in the mock is only a stand-in. Emblem = a **flame vector in the center of the hexagon** (the brand flame, molten `#B0431E` / `#E0612C`) — NOT a numeral, NOT a crown. (Renamed from "Legend" → **Infernal** for the fire theme.) This molten fill + shimmer + faint aura is the Infernal badge's **resting state everywhere it appears** (profile, leaderboard, share card, around a campfire), so it's unmistakable.

- **Singular, no divisions** — you're simply "Infernal." It's the ceiling; don't dilute it into III/II/I. (Optional prestige later: "days as Infernal" — keep the badge itself singular.)
- **Reaching Infernal = the loudest forge in the app:** the §11 sequence amplified — bigger flash, a **double shockwave** (two rings), denser sparks — resolving into the molten + aura resting state (the aura carries the fire; no literal ignition needed). Rarest moment in the app; make it the biggest.

### Forge composition (both metal and Infernal)
- **Three clean zones with generous air between them:** "Rank up" title at the top · the hexagon hovering in the middle · the campfire low at the bottom. Don't let the hex crowd the title or the fire.
- Keep particles **restrained** (~a dozen sparks, a handful of embers) — the moment should feel premium, not busy.

### Rank-up logic + tier-crossing effects (mock `31-rankup-tier-flash.html`)
- **Multi-rank skip → show the FINAL rank.** If the XP earned in one session clears **several ranks at once**, compute the final resulting rank and display **only that** in the celebration (e.g. 500 XP that clears Bronze III + Bronze II shows a rank-up to **Bronze I** — not each step). If it crosses multiple **tier types** at once, use the **final/highest** tier reached for the flash below.
- **Headline text — composed `{personal}, {name}. {social}`** (full copy: **`RANK_UP_COPY.md`**). Every rank-up pairs a **personal stem** (Bronze = the reached division's set III/II/I; other tiers = tier-level) with a **social sentence** (tier-level, no name) — e.g. *"In motion, {name}. Word is spreading."* Pick each half at random with **no immediate repeat**. School refs (`{school}`/`{mascot}`/`{rival}`) templated from profile (fallbacks in the copy file). This applies to every rank-up (division bump or tier crossing); only the flash/sound intensity differs by whether the tier *type* changed.
- **Every rank-up flushes the screen with a full COLOUR WASH in its tier's colour** — a strong tint that momentarily **engulfs the whole screen** (Bronze bronze, Silver silver, Gold gold, Diamond cyan, Infernal orange), like Infernal's fire but tier-colored. This full wash is what makes even a **division up** land — no promotion passes unmarked. **Division bump = the wash alone.** **Tier crossing = the wash PLUS the tier-specific spectacle** (sweep + particles, below). The wash must reliably fill the entire screen (a full-fill tint, NOT an edge vignette) on every rank-up, first play included. Infernal is singular (no divisions) so it's always the crossing version.
- **Tier-type crossing flash — the full-screen effect keyed to the NEW tier type** (the dramatic version, reserved for a tier *type* change):
  - **Silver:** a cool **metallic light sweep** across the screen (`#C4CBD6`).
  - **Gold:** a **golden sparkle burst** — falling gold glints (`#F5C542`).
  - **Diamond:** a bright **prismatic/angelic flash** — cyan + refracted shards (`#7FE0E8`).
  - **Infernal:** the **whole screen catches fire** — flames rise across it + a coral edge vignette, and the **hexagon burns** (flame licks around it) *for the transition*.
- **Infernal reconciliation (important):** the fiery Infernal effect is the **transition moment only**. The **settled/resting Infernal badge stays the molten + faint firelight aura** (no literal flames), per the Infernal section above — do not leave the badge permanently on fire.
- **Settling aura (all tiers).** As the badge lands in the splash, it carries a **soft glow tinted to its tier** (Bronze/Silver/Gold/Diamond in their metal color, Infernal the molten coral) — a gentle pulsing radial aura behind the hex. On Bronze–Diamond it's a brief celebratory glow; on **Infernal it persists as the resting molten aura** (per the reconciliation above).
- **Per-tier sound** (placeholders; §22): Silver = **coin ching** · Gold = **shiny ching** · Diamond = **rising angelic "haaa"** · Infernal = **intense flame roar**.

---

## 12. Campfire interior (tapping in) & the lock-in flow

### The campfire = chat + feed in one chain
Tapping into a campfire opens a **unified messaging chain** — chat and feed merged. Text messages and lock-in events live in the same timeline.

- **Lock-in event card** (the feed's core content — proof of showing up): distinct from chat bubbles — coral left-edge, the goal's flaming icon, "{Name} locked in", "{duration} · {goal}", "+{xp} XP · fed the fire", optional photo thumbnail(s), reactions.
- **Live "locked in now" strip** under the header: pulsing dot + lit avatars of who's currently locked in. Tapping a person **drops you into their session** (join the body-double). An active lock-in also shows in the chain as a card with a running timer.
- **System lines** for milestones (streaks, etc.).
- **Header:** down-chevron (you pushed up into this from home/field), flame + name + "{n} locked in now", members/leaderboard access. Spacing under the mini-map is handled by the **global live-session inset (§5)** — this header inherits it like every screen; no per-screen offset needed.

### Presence + "started" events are SCOPED to the campfire — solo never broadcasts
Every lock-in has a **scope**: `solo` or a specific `campfire_id` (chosen in the goal picker's "Solo vs. with the campfire" toggle). The two live recognitions fire **only** for lock-ins whose `scope == this campfire's id`:
- **Live "locked in now" strip** (avatar + join affordance) — shows a member **only while they're currently locked in *with this campfire*** ("someone's here, join them").
- **"{Name} is locked in" chain event** — posts **only when a member starts a lock-in scoped to this campfire** (a one-time event at start).

**A solo lock-in must NOT appear in any campfire** — no presence entry, no "started" event. (Bug being fixed: a solo lock-in was wrongly showing the user in a campfire's presence strip + posting a start event.) A lock-in scoped to a *different* campfire also must not appear here. Solo lock-ins still count fully for the user (XP, streak, recent lock-ins) — they just don't broadcast.
**Not affected:** the opt-in **posted recap card** from the done screen ("Post to the campfire") — a deliberate past-tense share that may come from any lock-in; distinct from live presence.

### Photos = lock-ins only (one photo path)
**No general composer camera.** Every photo in Philoi comes from a lock-in (captured during a session — see §13), landing on that lock-in's event card. This keeps the feed as pure proof-of-effort and kills the two-camera confusion. The composer is **text-only + the Lock-in button.**

### Composer — Lock in is the hero
A prominent **Lock in** bar (coral) sits *above* a slim message input (text + send). The app's gravity pulls toward locking in, not chatting.

### Lock-in goal picker (tap Lock in → bottom sheet)
"**What are you locking in for?**"
- Goal-type grid, each with its flaming icon: Gym, Study, Run, Job apps, Read, Custom (from the user's goal types).
- Optional **detail** field ("leg day", "CS midterm").
- **Solo vs. with the campfire** toggle ("3 already locked in — join them" / "just you").
- **Start lock-in** → launches the session (§13). The chosen goal + detail flow into the session and the resulting lock-in card.

**No fixed goals, no daily cap (important):** goals are **not** pre-committed at onboarding or held as a user-level list — you pick one **each time** you lock in, from a global menu (Gym, Study, Run, Job apps, Read, Custom + your own custom types). Lock in **however, whenever, and as often as you want** — multiple sessions a day are fine; there is no once-a-day rule. (Streak = you locked in *at all* that day; XP accrues per session.) The old rigidity — pre-set goals, one lock-in per day — is removed by design.

### Solo campfire = "Your fire" (home page 1)
Your own fire — **no chat, no feed** (no one to talk to). A personal launchpad:
- **Dynamic greeting** (by today's lock-ins × time of day — see §5), your **steady personal flame** (dims if *you* go quiet — a private nudge), plain **streak** (no "keep it lit" tagline).
- **Lock in** as the single hero CTA — no subtitle; "Lock in" is self-explanatory.
- Your **rank hexagon + XP bar**, and a short **private journal** of recent lock-ins (goal · detail · duration).
- Page 1 of the 2-page home → swipe right to the valley (§10). A solo lock-in from here is scoped `solo` (broadcasts to no campfire).

---

## 13. The running lock-in session

*Launches when you tap Start in the goal picker (§12). Full-screen, immersive focus mode.*

> **Redesign (current reference): mocks `51-lockin-session.html` (base), `53-lockin-other-activities.html` (all non-gym), `52-gym-lockin-overlay.html` (gym).** The **fire + timer own the screen**; a centered header shows the **activity + what you're doing** over the campfire name; **no goal-tool symbol inside the flame** (looked cheap — removed), no filler copy. Compact "Locked in with you" body-double strip + small camera + quiet Stop at the bottom. **Every non-gym activity uses this exact screen** — only the header swaps. **Gym is the sole exception (§23):** the giant flame drops to a **dimmed background** and a translucent **workout log** (exercise cards, set rows, auto-PR, ⋯ replace/reorder) rides on top; the timer shrinks to a **header pill** + an **energy chip**, body-doubles collapse, and the CTA is **Finish workout**.

- **Goal-as-fuel object:** the goal's tool burns *in* the flame — a **flaming dumbbell** (Gym), flaming pen (Study), flaming shoe (Run), flaming papers (Job apps), etc. Render the tool **bright (hot cream `#FFF3DC`), large, and legible** against the flame — swap per goal type. The fire may intensify the longer the session runs.
- **Count-up timer (not a countdown):** tracks how long you've been locked in; big, centered. Time = effort → XP. (Optional target later; open-ended is the default.)
- **Goal + detail chip** up top ("Gym · leg day") + the campfire name.
- **Body-doubles — "Locked in with you":** everyone else locked in right now, each with their own goal + **live timer** (the Focusmate effect — you're not alone even when physically alone). Lit avatars.
- **In-session camera = the only camera in the app (§12):** snap lock-in photos during the session; a badge shows the count. These become the photos on your lock-in card.
- **Stop** ends the session and **posts to the campfire chain** with duration, goal, XP, and photos. Style it **quiet** (not alarm-red) — closing a good session should feel satisfying, not like an emergency.
- Immersive darker background, minimal chrome, embers drifting.
- *Impl (Code):* count-up on a **background-safe clock** — persist the start timestamp and compute elapsed on resume so backgrounding the app doesn't lose the session. Flame + tool via `react-native-svg` + Reanimated; camera via `expo-camera`. On Stop, write the lock-in event + XP + photos to the campfire.

### The "done" screen (after Stop)
Stop → a **satisfying session recap** (mock `design-mocks/18-lockin-done.html`), not a loud celebration. Order, top → bottom:
1. **Activity** (goal + detail chip) and **Time** (the session duration).
2. **Immediately below: the animated XP bar.** On open it **fills from your pre-session XP to your new total** — the `+XP earned` fades in and the number **counts up** — with your **rank hexagon badge beside it**. *If the fill crosses a tier, chain into the full rank-up moment (§11).*
3. **Streak widget** directly under it — *only if applicable* (kept-alive / +1).
4. **Photos** from this session (if any).
5. **"Posting to {campfire}"** + primary **"Post to the campfire"** (writes the lock-in event to that chain with duration + XP + photos) and secondary **"Keep this one private."**

### The "too short" state (sub-30s session — anti-cheese, Step 18)
If the session ran **under 30 seconds**, replace the whole recap above with a calm "too short" state — the lock-in **still records** (it's in history/count) but earns **zero XP / no flame-meter progress / no ember reward**:
- Heading (rotate 2–3): "That was a quick one" / "Too short to count".
- Body: "Lock-ins under 30 seconds don't earn XP — it's logged, but give it a real go to earn fire."
- Single CTA **"Back to home"** → Home page 1. No XP bar, no streak, no photos, no share.
- **Neutral/muted** styling (NOT danger red) — a genuine misfire shouldn't read as failure. This is the visible face of the min-duration rule.

### Flame-meter-complete celebration (only when THIS lock-in fills the daily meter, §5)
When the session that just ended pushes the **daily flame meter to 100%**, the done screen plays a **once-a-day celebration** (mock `design-mocks/27-flame-meter-complete.html`) instead of the plain recap:
- The **campfire pops in and roars** (spark burst ring + rising sparks), and **"You're on fire, {name}!"** rises in (ember gradient).
- **Dual XP, shown side by side:** the normal **`+{n} XP`** (lock-in) beside the **`+50` fire bonus in orange** (`#F2A33C`) — the bonus is visibly *extra*, earned by completing the fire.
- **Ember reward = a currency-collection loop:** the **`+5` embers fly out of the campfire as tiny flames**, arc up and across in a staggered spread, and **clump onto the ember balance in the top-right**, each landing ticking the counter +1 with a small bump. (Embers = the monetization currency, MONETIZATION.md; the balance persists.)
- Rank progress bar + a prominent **"Share to your story"** (below).
- **Intensity sits a clear notch BELOW the full rank-up forge (§11).** If a session both fills the meter *and* crosses a rank tier, the **rank-up forge wins** — play it, and fold/queue the fire-complete beats after (don't run both takeovers at once).

### Share card (the growth hook) — iOS + Android
"Share to your story" generates a **pre-composed 9:16 image, not a screenshot** (mocks `28-story-share-ios.html`, `29-story-share-android.html`): roaring campfire on the twilight gradient, **"{NAME} IS ON FIRE"**, streak, rank chip, and the **`philoi` wordmark + `philoi.app`** (that footer is the install ad — keep it). Same card art on both platforms; hand it to the **native share sheet** (iOS: Instagram Stories / Messages / AirDrop · Android/Material: story / WhatsApp / Messages / Quick Share). *Impl (Code):* render the card off-screen and capture to a file (`react-native-view-shot` or a server render), same mechanism as the rank-up share card (§11).

---

## 14. Creating a campfire (+ class campfires)

### Create flow
- **Name + emoji.**
- **"For a class?" toggle** — turns a social campfire into a **course study-hall**. When on, reveals:
  - **Course** field — code + name (e.g. "CP164 · Data Structures").
  - **School** — prefilled from the user's profile.
- **"I can help with this class" toggle** — flags you as a **helper / veteran** (you've taken or aced it and can give advice).
- **"Who can join" — privacy selector (3 states, pick one):**
  - **Open** — shows in the valley; anyone can join instantly, no approval.
  - **Gated** — shows in the valley; joining sends the owner a request to **approve/deny** (see below).
  - **Private** — hidden from the valley; joinable **only by code** (share the code/link from the invite screen, §12 / mock 20).
- **Create** ("Light the campfire").

### Privacy is changeable any time
The Open / Gated / Private state is a `privacy` enum on the campfire, editable by the owner in **campfire settings / Edit campfire** at any point — it is not locked at creation. Transitions: **→ Open** auto-approves any pending join requests; **→ Private** removes it from the valley (existing members stay, code still works); **→ Gated** starts collecting requests. The valley query (§10) surfaces **Open + Gated** only.

### Join requests (owner approve/deny) — gated campfires only
- On a gated campfire's preview (§10), the join CTA reads **"Request to join"**; after tapping it flips to a disabled **"Requested · pending"**.
- The owner sees a **"Join requests" row** (with a count badge) in the campfire options sheet (mock 19), owner-only, shown only while gated with pending requests; a badge dot also appears on the interior header.
- The **requests screen** (mock 22): each request shows avatar, name + `@username`, and a context line (school, mutual friends/campfires), with **Approve** (adds them as a member) and **Deny** (dismisses). An **"Approve all"** header action; empty state when none.
- On approval the requester gets a notification ("You're in 🔥 <campfire>") deep-linking into the interior.
- *Permissions (Code):* gate the requests screen + approve/deny on an owner/admin role check (role-based from the start, not a hardcoded creator), enforced in RLS as well as UI.

### Class campfire mechanic — the student advantage
- A class-tagged campfire is **searchable + discoverable by course code + school** (feeds the discovery search and the field's "find a campfire"). A student searching "CP164" finds their class's campfire and joins → instant study-accountability community for that exact course.
- **Helper flag:** members can mark themselves as having aced/taken the class. In the campfire's members list / leaderboard, **helpers are surfaced with a badge**, so someone *proficient is findable* — you get advice from people who've actually done well. That's the concrete advantage: **accountability + peer expertise for one specific class.**
- Otherwise a class campfire behaves like any campfire (chat + lock-ins + the flame); the class tag is **metadata + a discovery/expertise layer** on top.
- *Data (Code):* store `course_code`, `school`, and a per-membership `is_helper` flag; index `course_code + school` for search. v1 = self-declared helper status; consider light verification later (grade proof or peer endorsement).

---

## 15. Leaderboards

**Two levels, two feelings:**
- **Intra-campfire** (inside each campfire): *"am I winning among my people?"* — just that campfire's members. The tight everyday rivalry; lives in the campfire (header/detail).
- **Cross-campfire** (the Leaderboard tab): *"how do I stack up across everyone I'm connected to?"* — the broader pool.

### Core principle — rank people, not campfires
Ranking is always by an **individual's own XP**, so being in a big public campfire never inflates anyone. In the merged "Campfires" pool, **dedup** people who share more than one of your campfires (show once).

### Ranking metric
- **Primary sort = total XP.** Tiers tie (5,100 Silver II must sit above 5,000 Silver II), so XP is the true order; the **rank hexagon is a color badge only, never the sort key.**
- **Streaks = a separate metric toggle** (days, flame icon) — swaps the whole list; never mixed into the XP list.

### Format — the Parthenon podium (mocks `42-parthenon-leaderboard.html`, empty state `41-empty-states-greek.html`)
The board renders as ascending **Parthenon marble columns** (Greek theme). The **top 3 rise as a podium** — #1 tallest in the center — each column topped by the person's **avatar at its apex**, a **gold/silver/bronze position medal** (the metals match `RANK_TIER_METAL`), and **name + rank hexagon + value** beneath. Ranks **4–10 fill a clean list** below the podium. **Your own pillar/row always pins at the very bottom** with your true rank (e.g. #47) so you're findable even on a 4,000-person board.
- **Two distinct rank signals, both shown:** the **position medal (1/2/3)** = today's standing on *this* board; the **rank hexagon** = your overall tier (Bronze→Infernal, `RANK_TIER_METAL` colours). Every individual row/pillar shows the hexagon.

### Leaderboard tab — scopes (4 tabs)
1. **Campfires** — every individual across all your campfires, pooled + deduped, ranked by XP.
2. **My university** — everyone at your school (podium + list + your pinned pillar).
3. **Vs. universities** — schools ranked **collectively**; each pillar is a whole university (brand-colour **crest + monogram** — official logos are trademarked and need licensing, so the colour-crest is the shipping default). Metric toggle: **Total XP / Avg per member** (per-capita so a small campus can win on merit). No individual rank hexagons here (tiers are an individual thing).
4. **Global** — the best **individuals anywhere, period** (you vs. the world). Same podium format; your pillar pinned. *(Vs. unis = collective; Global = individual — they answer different questions.)*

### Search (magnifier — header top-right, resting icon expands to a field, mock 42 frame C)
Find anyone by **name or @username**. Each result shows their **rank hexagon, live position, XP, and which board**; **friends are tagged**. Tap a result (or any pillar/row) → **their profile** (§18, mock `43-friend-profile.html`).

### Small-board + empty handling
- **Fewer than 3 rankable people** (e.g. a 2-person campfire) → gracefully fall back (2 columns, or a plain list) — never a broken 3-column podium.
- **No campfires yet** → the **burnt-out-campfire empty state** (mock 41: charred crossed logs, dying embers).

### Intra-campfire leaderboard
Inside every campfire, a local board of just its members — same Parthenon format + the XP/Streaks toggle. The intimate, motivating one for small groups (uses the small-board fallback when tiny).

**Your row/pillar is always highlighted** (coral border/tint) wherever it appears.

---

## 16. Challenges

### Watch — live challenge spectator view (consent-gated)
*Opened from a campfire's active-challenge marker (mock 37, scoped to that fire) or a friend's profile (mock 43, scoped to friends + their opt-in). You watch the **contest**, never the person.*
- **What it shows, live:** the **matchup** (competitors' avatars + names), the **goal + time remaining**; a **live head-to-head scoreboard** — each side's current metric total + an "ahead by" bar — updating as people lock in / sync; **live status** ("🔥 locked in now · Gym · 12:34" or "last active 2h ago"); and a **Cheer** action (spectators send a reaction to a competitor, with a count). A **group** challenge shows a live **group leaderboard** instead of the 1v1 bar.
- **Never shows:** the competitor's camera, private session content, or anything beyond the challenge numbers already shared. Watch the game, not the player.
- **Access gate:** *campfire* Watch = any member of that fire; *profile* Watch = **friends only AND** the person's **"Let friends watch my live challenges"** opt-in (§19, default OFF) — otherwise the Watch CTA is hidden entirely.
- **Realtime:** standings + live status push over a realtime subscription (Supabase) so it feels like watching, not refreshing.

### Who can start a campfire challenge — admin governance
*Friend-to-friend H2H is peer + consensual (they accept) and is **NEVER** gated — anyone can challenge a friend. This governs **group / campfire** challenges only.*
- **Per-campfire setting "Who can start a challenge here":** **Everyone** · **Admins & co-admins only** · **Members can propose → admin approves.**
- **Default scales with size + visibility** (not a manual chore): small / private fires default to **Everyone** (intimate, low troll risk); **large (≈25+ members) or public/discoverable** fires default to **Admins & co-admins only** — so a 40–50+ Laurier general gym fire can't be spammed with troll challenges that read as defeatist to less-motivated members. Owner can override in campfire settings (§19 / campfire options, mock 19).
- **Roles:** owner + **co-admins** (owner promotes trusted members). Only these can start (or approve) when a fire is gated.
- **Blocked state:** a non-permitted member's "Challenge this campfire" is disabled with *"Only admins can start challenges here"* — plus an optional **"Suggest a challenge"** that pings the admins (the propose→approve path), so keen members aren't fully silenced.
- **Why:** a challenge from a respected admin carries authority — people know them, opt in, and follow through; random member-started challenges in a big fire mostly generate noise and pressure.
- **Non-defeatist join model (pairs with this + the mock 46 "pick who's in" picker):** members a campfire challenge targets get an **invite (Join / Ignore), not forced entry** — nobody is auto-dropped into a competition they'll lose and feel bad about. The Watch leaderboard (mock 45) ranks whoever **joins**.


*In for V1 (competitive users will make heavy use of it). H2H also doubles as a re-engagement / WOM lever — "I challenged you" is a reason to pull a friend in or wake a dormant one.*

### Three types
1. **Head-to-head** — challenge a specific person in your campfire to an **XP race** over a window (24h / 3 days / 1 week). Winner gets a bonus payout **and** a "beat {name}" flag on the leaderboard; loser gets nothing.
2. **Individual ("sick challenge")** — announce a personal challenge to the campfire ("10k steps every day this week"). The group witnesses + cheers; complete it → bonus XP + a badge. Others can jump in → it becomes a group challenge.
3. **Group — all or nothing** — the whole campfire commits ("everyone locks in 5× this week"). Everyone completes → **everyone gets a big payout**; anyone fails → nobody does. Max peer pressure + consistency — the most powerful of the three.

### Rules that protect the economy (non-negotiable)
- **Metric = real lock-in XP.** You can't win a challenge without actually locking in — challenges *reinforce* the core loop, never a farmable side-game.
- **Payouts are capped + scaled to effort.** Big enough to thrill, not big enough to exploit. Without this, two friends trade wins and the leaderboard turns to mush.
- **Anti-collusion:** cooldown before you can re-challenge the same person; a daily cap on challenge-derived XP. Watch for win-trading rings.

### Resolution
- Auto-resolved at the buzzer (system tallies each side's lock-in XP in the window).
- Result **posts to the campfire chain** as a celebration event (reuse the reward/forge visual language, smaller than a rank-up). Winner gets the leaderboard flag; group payout drops to everyone if all finished.

### Where it lives
- **Challenges tab** (bottom nav): sections for **Active · Invites · History · Start one.**
- **Inline in the campfire chain:** a challenge card when one's issued ("Noah challenged Aidan — XP race, 24h — [Accept/Decline]"), a live progress card while it runs, and the result when it ends.

### Start / accept flow
- **Start is campfire-first:** pick **which campfire** → challenge type → set it up (H2H: pick an opponent from *that campfire* + metric · Group: set the goal, scoped to that campfire's members · Solo: describe it) → **window** (24h / 3 days / 1 week) → review the **payout** (capped/scaled, shown in plain sight) → send. The send button **relabels to the exact action** ("Challenge Aidan" / "Start group challenge" / "Announce challenge"). A challenge always **belongs to the chosen campfire** — it posts to that chain and affects that campfire's board. Switching the campfire swaps the opponent list + group size to that campfire's members.
- If the challenge metric is a **device-tracked fitness metric** (steps, distance, workouts), a **sync prompt** appears — see §17.
- **Invite:** recipient sees an **Accept / Decline** card (tab + chain). On accept, the live race/progress begins.

### Card anatomy (from the mock)
- **H2H:** type label + time-left · both competitors with avatars + live XP · a **split progress bar** (your share coral, theirs grey) · payout footer ("winner +200 XP").
- **Group:** type label + time-left · the goal · **member progress dots** (done = green) · payout footer ("4 of 6 done · +300 XP each if everyone finishes").
- **Invite:** distinct coral border + Accept/Decline buttons.

### Build note
Ships in V1, but sequence it **after** the core loop + leaderboard are working — challenges are meaningless without XP flowing. H2H first (simplest + the growth lever), then group, then the individual announce.

---

## 17. Fitness integrations (auto-tracking)

*Trigger: when a fitness goal or challenge uses a **device-tracked metric** (steps, distance, active minutes, workouts), prompt to connect a source so it **auto-verifies from real activity** instead of self-report.*

### The sync prompt
When someone sets a fitness challenge/goal with a device metric (e.g. "10k steps every day", "who runs farther this week"), a sheet appears — **"Track this automatically?"**:
- **Apple Health** (HealthKit) — iOS / Apple Watch.
- **Health Connect** (Wear OS / Samsung / Android phones).
- **Strava** — runs + rides, cross-platform.
- **Garmin** — Garmin watches; steps/distance/activities, cross-platform.
- **Whoop** — strain / workouts / sleep / recovery (NOT steps — see metric fit).
- **Log it manually** — always the fallback.

**Metric fit matters — don't offer every source for every challenge.** Steps/distance challenges → Apple Health, Health Connect, Strava (runs/rides), Garmin. **Whoop has no step count** — it's strain/heart-rate/workout/sleep — so offer Whoop for *workout-minutes / strain / sleep* challenges, not step races. Show a source only when it can actually measure the challenge's metric.

### Rules
- **Always optional.** Manual entry (or a lock-in session) is the fallback so users **without a wearable can still play** — never gate participation on an integration (about half the student population owns no wearable; this was the friction that hurt the old Aspire OS concept).
- **Auto-verify:** once connected, the source tallies the challenge metric (steps toward "10k daily", distance toward a run race, workout minutes). Cuts cheating vs. self-report.
- **Metric fit:** *time/effort* challenges run on lock-in sessions (§13); *quantitative fitness* challenges (steps/distance) use the device metric. The sync prompt appears **only** for the latter.
- **Platform-aware defaults:** iOS → Apple Health; Android → Health Connect; Strava offered on both.

### Sequencing & gates
1. **Apple HealthKit + Google Health Connect first** — highest coverage, **no partner approval** (entitlements only).
2. **Strava next** — OAuth + Strava's review gate (self-upgrade to 10 athletes, review beyond; its API terms restrict displaying *other* users' data, so a member only ever sees their **own** Strava-derived numbers).
3. **Whoop next** — OAuth 2.0, developer-dashboard app + production review; strain/workout/sleep metrics, own-data only.
4. **Garmin last (heaviest gate)** — requires **Garmin developer-program partner approval** (a B2B application + review, not just entitlements), OAuth, and **webhook/push** delivery (Garmin pushes to your backend rather than you polling). Own-data only.
- All of these are **Phase 2** (heavy + external approval for Strava/Whoop/Garmin), but designed here so challenges/goals plug into any source cleanly when it lands. Each is independent — ship them one at a time behind the fitness flag; the manual fallback covers everyone in the meantime.

### Privacy
Request **minimal scopes** — only the metric a challenge needs. Keep raw health data on-device where possible; the campfire only ever sees the **challenge-relevant number** ("8,200 / 10,000 steps"), never a full health export. Opt-in per source.

### §17b — Auto lock-in from a synced activity (Strava → lock-in → campfire)
*A device-verified workout becomes a lock-in automatically, and — opt-in — posts itself to a campfire. Reuses the existing sync + lock-in + campfire-post pipeline; NO new native code (server + JS, OTA-shippable).*

**Flow:** a newly synced activity (Strava first; HealthKit / Health Connect later) → **dedup** → **create a lock-in** → **optionally auto-post** to a campfire the user opted in.

**Which activities qualify (scope = runs/rides/workouts over a threshold):** only Run, Ride, and Workout/WeightTraining types **above a floor** (≈ **≥10 min moving time OR ≥1 km**) — the device-metric equivalent of the 30s manual lock-in floor (§13/Step 18); tiny or accidental activities are ignored. Map type → goal: Run→`run`, Ride→`run` (cardio), Workout/WeightTraining→`gym`.

**Dedup (load-bearing):** every synced activity carries the source's activity ID. Store it on the lock-in with a **unique (user_id, source, external_id)** constraint so re-syncing the same activity can NEVER create a duplicate lock-in. This is the #1 correctness risk.

**The lock-in it creates:** mapped goal type, **duration = the activity's moving time**, plus real distance/pace; `source = 'strava'` so it's badged **"via Strava."** Because it's **device-verified it's the strongest anti-cheese case** (Step 18) — it earns XP and counts toward the flame meter like any lock-in, but under the **same daily cap + diminishing returns**, so syncing many activities can't farm past the cap.

**Auto-post = per-campfire opt-in (consent).** Posting to a campfire is publishing on the user's behalf, so it's gated behind an explicit **per-campfire toggle**: the user turns on **"Auto-post my synced workouts"** for a chosen campfire once. Then every qualifying synced activity auto-posts to that fire — the chat card shows **Run · 5.2 km · 26:30 · "via Strava."** Toggle **off (default)** → the lock-in is still created (private, in history), just **not posted**. Never auto-post to a campfire the user hasn't opted that fire into. (This also answers "which campfire" — whichever fires have the toggle on.)

**Trigger = real-time Strava webhook.** Subscribe to Strava's webhook (push) API; Strava posts an event to a Supabase Edge Function endpoint the instant an activity is created/updated → process it immediately (fetch the activity, dedup, create the lock-in, auto-post if opted in). A **poll on app open** stays as a backfill safety net (catch anything the webhook missed) but the webhook is the primary path — the magic is a run appearing in your fire seconds after you stop it.

### §17b cross-integration surfaces (design-mock `40-strava-cross-integration.html`)
The synced activity is visibly, tappably "from Strava" everywhere it appears — Strava orange `#FC4C02` is the "your connected app did this" signal:
- **Home diary (personal lock-ins):** the synced entry logs as its activity name + an **"Activity · Strava"** badge, on an **orange-hued card** (warm tint, `#FC4C02` border) with the Strava mark — sits alongside manual lock-ins so you see the connected app did it.
- **Campfire post:** the whole card carries an **orange glow + the Strava logo**, shows the real stats (distance · time · pace) + any in-app photos, and a **"View on Strava"** action. Tapping the card/link **deep-links to the actual activity** — `strava://activities/{id}` with an `https://www.strava.com/activities/{id}` web fallback. A real two-way link, not a screenshot.
- **Profile / activity detail:** tap a synced activity to revisit route, splits, and the **photos taken during that lock-in**, with a one-tap **"Open on Strava."**
- **Photos scope note:** current scope is `activity:read` (stats + route, NOT Strava's own photos) — so the photos shown are the **in-app lock-in camera photos** (§12/§13), not pulled from Strava. Pulling Strava photos = broader scope + extra brand review; keep to in-app photos for v1.

### §17b Strava brand compliance (HARD — [developers.strava.com/guidelines](https://developers.strava.com/guidelines/))
Non-negotiable so the integration stays allowed:
- **Official "Powered by Strava" logo, UNMODIFIED** — already bundled at **`assets/strava/powered-by/`** (horiz + stack, orange/white/black, PNG + SVG). Show it on the Connected Apps screen. On the twilight dark UI use the **orange or white** variant (never black). Never recreate/redraw it.
- **Official "Connect with Strava" button** for the OAuth entry (not a custom button) — bundled at **`assets/strava/connect-button/`** (`btn_strava_connect_with_orange` / `_white`, `@1x` + `_x2`, PNG + SVG). The `_x2` PNG is 474×96.
- **"View on Strava"** is the exact required wording for every link back to a source activity.
- **Logo rules:** Strava's logo stays **separate from and less prominent than Philoi's own mark**, is **never** used as the app icon, and nothing may imply Strava built or sponsors Philoi. The orange hue/glow is fine (color isn't owned); the *logo* must be the official asset.
- **Data handling** per Strava's API Agreement + API Policy (storage/caching limits, privacy, rules on how another user's data may appear); if an activity is Garmin-sourced, add Garmin attribution too. Higher rate limits need a review submission (use case + screenshots) — do a line-by-line policy audit first.

**Data (Code):** `lock_ins` gains `source` (`'manual'|'strava'|'healthkit'|'health_connect'`), `external_id` (text, nullable — the Strava activity id, for dedup + the deep link), `distance_m`; a per-user-per-campfire `auto_post_synced` flag (on `group_members` or a small settings table). Add the unique index `(user_id, source, external_id)`. Store the Strava webhook subscription + a per-connection sync cursor.

---

## 18. Profile

- **Header:** avatar, display name, @handle, university; a **settings gear** (top-right → §19) and a down-chevron to dismiss.
- **Your rank:** hexagon (tier + division) + XP bar to next.
- **Stats:** day streak · total lock-ins · total hours locked in.
- **Goals:** chips of the goal types you're working on.
- **Lock-in photo grid ("Lock-ins · {n}"):** every lock-in photo you've taken, each with its goal icon + duration overlay — the visible proof of the grind / nostalgia journal.
- **Own vs. others':** your own profile shows the gear + edit affordances; someone else's respects their **photo-privacy** setting (§19) — the grid only shows if they've allowed it.
- **Viewing someone else's profile (mock `43-friend-profile.html`):** reached by tapping any name on the **leaderboard / search** (§15) or a friend row. NO redundant top-bar title (the name lives in the hero with the **Friend** tag if applicable). Shows their rank hexagon + XP-to-next, streak/lock-ins/hours, goals, and photo grid (privacy-gated). Header actions: **Add friend / Friends ✓** (per the §16 friend state machine) + **Challenge** (friend-to-friend H2H). The ⋯ menu holds **report / block**.
- **Watch a friend's live challenge (consent-gated):** if the person has an active challenge, a **Watch** CTA appears on that chip — but **only when BOTH (a) you are friends AND (b) they've opted in** to being watched (a "Let friends watch my live challenges" toggle in §19, default OFF). Otherwise the Watch CTA is hidden entirely — never let anyone spectate a stranger, and never without the person's own opt-in. (Same Watch affordance as the in-campfire active-challenge marker, mock 37 — but campfire Watch is scoped to that fire; profile Watch is scoped to friends + consent.)
- **Rank is always in the app header too:** a mini hexagon + XP rides in the top bar on every screen (tap → this profile), so your rank is one glance away — **distinct from the campfire level** (the group's shared fire at the bottom of the campfire screen).

## 19. Settings

Deliberately simple: a **profile summary row** (→ §18), then:

- **Notifications** · **Who can see my photos** · **Edit goals** · **Daily fire goal** · **Sound & haptics**
- **Sign out**
- **Delete account** (danger, red)

### Notifications
Grouped toggles:
- *Your campfires:* someone locks in · someone reacts to your check-in · a ping ("come join") · the campfire's going cold.
- *You:* streak about to lapse (nightly) · challenge invite + result · rank-up.
- Master toggle + optional quiet hours. Sensible defaults on; streak-lapse + ping are the highest-value.

### Who can see my photos
Single-select — applies to the profile grid **and** your photos shown around campfires:
- **My campfires** (default) · **Everyone** · **Just me** (private journal).
- Public/discoverable campfires only ever surface photos set to **Everyone** (the §6/§12 safety rule).

### Edit goals
Manage your **user-level goal types** (set at onboarding): add/remove from Gym, Study, Run, Job apps, Read, Custom; reorder. Feeds the lock-in goal picker (§12) and your profile chips. Removing a goal keeps past lock-ins/photos intact.

### Daily fire goal (flame meter, §5)
- **Goal mode:** **Adaptive** (default — auto-tunes to your ~14-day average with guardrails) vs **Manual** (you set a fixed daily target). Sets `daily_goal_mode`.
- **Publish completion to campfires:** opt-in toggle, **default off** — when on, completing today's fire posts an "I completed my fire today" card to your campfires (like a lock-in).

### Sound & haptics (§22)
- Master **sound** toggle (reward cues: lock-in ignite, done/settle, flame-meter fill, rank-up) + **haptics** toggle. Respects the device mute switch and reduced-motion regardless.

### Sign out
Confirm ("Sign out of Philoi?") → clears the session → returns to **Splash / sign-in (§20)**. Non-destructive; server data stays.

### Delete account
Destructive + irreversible:
- States plainly what's lost — **all lock-ins, photos, streaks, XP/rank, and campfire memberships, permanently.**
- Requires an **explicit confirm** (type DELETE or a distinct hold-to-confirm), never a single tap.
- On confirm: **hard-delete** server-side — purge the profile, remove from campfires, and **delete their photos from storage** (teardown already exists in schema). No soft-disable masquerading as delete.

## 20. Splash / sign-in

The cold-open screen and where **Sign out** lands. Fresh + inviting — the warm half of "determined yet warm."

- Twilight background; the **campfire logo centered, gently flickering with embers rising** — warm and alive, not a static logo.
- **Philoi** wordmark, then the **Greek etymology as subtext** under the fire: **φίλοι** (ember) · *fee-loy* · Ancient Greek, and the definition — *"close friends bound by trust, affection, and shared effort."* The meaning doubles as the mission (shared effort = locking in together). *(Definition is our own concise phrasing, not a copied source. Pronunciation: Ancient/Erasmian ≈ "fee-loy"; Modern Greek ≈ "fee-lee" — confirm which you want.)*
- One primary action: **Continue with Google** (cream button, Google mark) — the app's auth.
- Terms & Privacy fine print. Reduced-motion → static flame.
- **Fix the OAuth consent branding here** (must read **Philoi**, per the P0 in `V1_BUILD_SPEC.md` — never "Aspire OS" / "supabase").

---

## 21. Onboarding

*After first Google sign-in. Short, low-friction — get to the first Lock-in fast. **No goals step** — goals are chosen per lock-in (§12).*

Three steps + a progress indicator:

1. **Pick a username** — a `@handle`, availability-checked and unique, plus a display name.
2. **Choose your school** — a **real, searchable university picker**, *not* a free-text field. Type to filter a canonical list ("Wilfrid Laurier…"), tap to select; "not listed" fallback. Backed by a **canonical universities table** so campus leaderboards (§15) and class campfires (§14) group cleanly — free text would fragment them.
3. **Consent** — agree to Terms + Privacy, with the key data use explained plainly. (Photo + notification permissions are requested **in-context later** — during a lock-in / from settings — not dumped here.)

Then → first-run tutorial / first campfire, routed to get them to a Lock-in quickly.

- **No goals collected here** (removed — the old pre-set-goals + once-a-day model was bad design). Username + school are the only required identity fields; everything else is discovered through use.
- *Data (Code):* `handle` (unique), `display_name`, `school` (FK → canonical `universities` table). Do **not** pre-populate a per-user goals list.

---

## 22. Sound + haptics (soundification)

*Extends the existing `RewardBurst` system (Spark/Bloom/Surge tiers). Match intensity to significance — quiet navigation, loud rewards (§9).*

- **Lock in (Start):** a satisfying **"ignite"** cue + a firm haptic. One of the two most important taps in the app — must feel great.
- **Done / Post:** a warm **"settle/complete"** cue + haptic on Stop → recap; a subtle **rising tick/whoosh as the XP bar fills** (§13); a confirming cue on Post.
- **Flame meter filled (§5/§13):** a **"meter fill / complete"** cue as the bar ignites — a rising whoosh building into a short flourish + haptic. Fires **once per day** on completion (not on every lock-in). During the done-screen celebration, each **ember that lands on the balance** gets a tiny **light sparkle/tick** (staggered with the flying particles) — subtle, layered under the main cue, à la a coin-collect loop.
- **Rank-up (§11):** the **loudest** — RewardBurst **Surge** tier + a strong haptic; Infernal the biggest.
  - **Riser under the forge (EVERY rank-up):** on the ~3.7s hex-materialize, play **`rankup-riser.wav`** from the start (t=0). It **swells and climaxes exactly on the flare** (`FLARE_DELAY_MS ≈ 3700`) where the per-tier cue then hits — the riser cuts as the tier sound lands, so they don't compete. This is what turns the build-up from bland into tense. Plays on **both** division bumps and tier crossings (the forge plays on every rank-up, §11); only the flare payoff scales. Files: `rankup-riser.wav` (primary = cinematic), alts `rankup-riser-wildfire.wav` (on-theme fire), `rankup-riser-drone.wav` (subtle).
  - **Per-tier-crossing cues — real files in `assets/sounds/`, selected by the NEW tier type:** Bronze = `rankup-bronze.wav` (blacksmith hammer strike) · Silver = `rankup-silver.wav` (cash-register ka-ching) · Gold = `rankup-gold.wav` (bright ching) · Diamond = `rankup-diamond.wav` (angelic choir swell) · Infernal = `rankup-infernal.wav` (victory rock-guitar riff). Alternates on hand: Diamond `rankup-diamond-sparkle.wav` (shimmer), Infernal `rankup.wav` (flame roar). A within-tier **division bump** gets a **small, soft cue** (a light version — every rank-up is rewarded, scaled down) paired with its lighter flash.
- **Streak kept / milestone · challenge win · reactions & pings:** small tiered cues (crackle / triumph / light taps).
- Use `expo-audio` + `expo-haptics`; **preload at startup** (already done for RewardBurst). Respect the **device mute switch**, **reduced-motion**, and a global **sound toggle in Settings**.
- **Navigation transitions (§9) stay silent** — sound is for *rewards*, not movement.

### Tier promotion — the full campfire forge (~5s, hold this pacing)
1. **0–0.5s — the fire roars.** Full-screen twilight; the roaring campfire (the one you built) sits center-low; **smoke begins to gather** above it.
2. **0.5–4.4s — materialize.** The hexagon **emerges tiny and near-transparent from the smoke** (~0.1 scale, low), then **slowly rises, grows, and solidifies** — opacity ramping up, **three full turns (~1080° `rotateY`)** over the ascent before it settles. Slow ease-out (`cubic-bezier(.25,.55,.25,1)`). The slowness *is* the point: it must feel forged, not popped.
3. **~3.7–4.4s — solidify.** As it becomes fully solid it **flares** — soft warm flash + spark burst + an expanding ring.
4. **4.4s → persists — hover + pulse.** The badge settles above the flames and **stays**: gentle float (translateY ±8px) + slow pulse (scale ~1.05 breathe). Fire keeps roaring beneath; embers drift up continuously. It does **not** auto-dismiss.
5. **4.5–5.1s — the words rise in.** "Rank up" → tier name ("Diamond III") → fire-forged meta ("forged from a 12-day streak · your rank now") → **Continue** + **Share**.

On **Continue**, the overlay dismisses and this same hexagon lives on as your rank on Profile/Leaderboard — the moment resolves *into* your identity, it doesn't vanish.

### Every rank-up gets the forge + riser — the PAYOFF scales
**Every** rank-up (division bump *or* tier crossing) plays the full-screen **forge + riser** build (the ~3.7s rise) — the build-up is what makes each one feel like an event. What scales is the **payoff at the flare**, not whether there's a build:
- **Division bump** (e.g. Bronze III → II): the **lighter flash** (quick tier-colored shimmer + small spark) + the **soft per-tier cue**.
- **Tier crossing** (Bronze→Silver→…→Infernal): the **full dramatic tier flash** + the **full per-tier sound**, and it's the rarer, bigger beat.

So the riser plays on both; the difference the user feels is how hard the flare hits. (If frequent Bronze-division bumps ever feel long, we can shorten the bump's forge+riser — but default is the full build for all.)

### Share card (growth hook)
**Share** generates a polished, pre-composed card — *not* a raw screenshot: hexagon + tier, your streak, the campfire name, and the Philoi mark, sized for IG/story. A rank-up posted to someone's story is free distribution — make it beautiful and one tap.

### Implementation (Code)
- `react-native-svg` for hexagon + flame; a **Reanimated timeline** for the ~5s sequence (`withDelay` / `withSequence` / `withTiming`). Smoke + spark-burst = one-shot particles; embers = looped. Reuse the **RewardBurst** tiers for audio; **haptic** on the solidify flare.
- **Reduced-motion:** skip the sequence — fade straight to the settled, hovering badge + text.
- Pause background campfire animations while the moment plays; it's a one-off full-screen route so its own cost is fine.

---

## 23. Gym tracker (lean V1) — STUB, full spec to follow

*V1 scope decided: a lean in-session workout log, NO per-set video (deferred to phase 2). One optional session clip via the existing lock-in photo path. Mocks: `23-gym-routine-picker.html`, `24-gym-session-logger.html`. This section is a placeholder capturing the locked decisions; expand into the full spec (data model, chat-card + done-screen variants, PR history) in a dedicated pass.*

### Locked decisions so far
- **Flow:** Gym goal at lock-in → routine picker (saved routines from **memory** / Freestyle) + a one-tap **energy** state → in-session **workout log** (exercises → sets of weight×reps, add/replace/reorder/remove exercise, auto-PR) → Finish → workout summary becomes **lock-in data**, kept **private** or **posted** to the campfire.
- **Auto-PR:** on saving a set, flag a PR if it beats the stored best for that lift (`personal_records`). Cheap to compute; it's the core dopamine.
- **Replace exercise mid-session:** every exercise's ⋯ menu offers **Replace** (swap in a substitute if a machine's taken), Reorder, Remove — a routine can flex without derailing.
- **Data (Code):** `exercises` library, `workouts` (→ lock_in), `workout_sets` (weight/reps/is_pr), `routines`, `personal_records`.

### Energy state (pre-workout mood) — two rules to hold
1. **Gentle nudge, not a rewrite.** Light / Same / Dialed applies a **small ±% adjustment (~5%) to *suggested* target numbers only** — never a hard override. Every set stays fully editable; the suggestion is a starting point, not a mandate.
2. **Honest brag.** The chat log's "…was feeling **dialed** today on Push day" framing, and any "elevated numbers" flex, should surface **only when the user actually hit the higher numbers** — the mood you *picked* doesn't earn the brag; the lifts you *logged* do. Keeps the social signal truthful.

### Deferred to phase 2 (post-retention)
Per-set video/form clips (see below), history charts, plate math, rest timers, supersets/RPE, per-lift PR leaderboards.

### Phase 2 — video clips (form/progress sharing): tiers, cost, architecture
*Short workout clips shared to friends/campfires. Modeled cost is near-zero; the real constraints are mobile upload reliability and egress, not storage.*

**Quota tiers (per user / month):**
- **Free:** **10 clips**, **720p / 30fps**, 10s each.
- **Paid:** **unlimited clips** (soft fair-use guard against automated abuse only — per-clip cost is a rounding error, §cost), **1080p / 60fps**, up to ~15–20s each.

**Resolution decision — 1080p is the ceiling; NO 4K.** On a phone screen a 10s clip at 4K is indistinguishable from 1080p (the display can't resolve it), a 4K clip is 25–44 MB and takes **40–70s to upload on cellular** (fails constantly in a gym), and 4K egress is the one line that gets expensive (~$1–2k/mo at 100k users on non-free-egress providers). 1080p ≈ 5.8 MB, uploads in ~9s, and is visibly sharper than 720p. The premium "feels higher quality" lever is what's actually perceptible on mobile — **higher bitrate (fewer artifacts), 60fps (smooth motion, great for form), longer clips** — NOT resolution. Resolution is capped by mobile upload realism.

**Cost model (verify current rates):** 10s 720p ≈ 2.7 MB, 1080p ≈ 5.8 MB. Storage is trivial (a max-quota free user ≈ $0.0002/mo). All-in fleet cost is dominated by *transcode* if done server-side (~$342/mo at 100k) — **compress on-device** to push that to ~$0. Realistic 100k-user total ≈ **$16–65/mo** on R2. Per-user cost is a rounding error, so quotas are a **plan differentiator + anti-spam lever, not a cost necessity** (alt accounts aren't a cost threat and stay siloed anyway).

**Architecture:**
- **Object storage, not Postgres.** Clips live in **Cloudflare R2** (or Backblaze) — chosen specifically for **free/near-free egress** (the only variable-cost risk if a clip gets watched a lot). Postgres holds only metadata + references (URL, owner, lock_in_id).
- **Encryption = server-side-at-rest (SSE)** — free/automatic — plus **signed, expiring URLs + campfire/friend access control**. NOT end-to-end (E2E blocks thumbnails/transcode/CDN and is overkill for friend-shared gym clips).
- **Compress/normalize on-device** (to the tier's 720p/1080p target) before upload → faster uploads + ~$0 transcode.
- **Keep clips scoped to campfires/friends, not a public feed** — the one thing that actually gets expensive with UGC video is **moderation**, and private scoping avoids it.
- Retention: a rolling TTL (e.g. 90-day) keeps storage bounded long-term (barely matters at these volumes, but tidy).

**Per-set capture mechanic (the flow):**
- **Never auto-film every set** — it kills the workout flow and burns quota on junk. A clip is **opt-in per set**: each set row in the session logger (`workout-set-logger.tsx`) carries a small **camera affordance**; tapping it films *that* set.
- **Two triggers:** (1) manual tap (a form check or a lift worth recording); (2) an **auto-prompt on a PR set** — when a saved set beats the stored best, offer "Film this PR?" (that's the moment worth capturing + sharing). One clip per set, always optional, always skippable.
- **Hard-cap length at capture** to the tier (10s free / 15–20s paid) so clips stay short and uploads survive gym cellular.

**Pipeline (reuses the architecture above):**
1. **Record** — `expo-camera` video mode, capped to the tier length.
2. **Compress on-device** — `react-native-compressor` to the tier target (720p/1080p) *before* upload → ~$0 transcode + reliable uploads.
3. **Poster frame on-device** — `expo-video-thumbnails` at record time (no server-side thumbnail step).
4. **Upload** — request a **signed upload URL** from an Edge Function, PUT the compressed clip + thumbnail **directly to R2** (never through the app server).
5. **Store references on the set** (Postgres holds only metadata — see fields below).
6. **Playback** — `expo-video` with a **signed, expiring GET URL**, poster thumbnail while loading.

**Data model — extend `workout_sets`** with (all nullable; a clip is optional per set): `video_key`, `thumb_key`, `duration_s`, `resolution`, `uploaded_at`. The bytes live in R2; Postgres stores only references.

**Quota enforcement:** before allowing capture, check the user's clip count this month against their tier (**free 10 / paid unlimited**) — a plan differentiator, NOT a cost gate (per-clip cost is a rounding error). Paid is effectively uncapped; keep only a soft fair-use guard against automated abuse. Show the counter ("N left this month") **only to free users** — paid users have no countdown.

**Where clips surface:** the done-screen recap, PR history, and — the point — the **posted campfire chat card** (a PR clip is the flex; a form clip invites feedback). Tap-to-play, **campfire/friend-scoped only** (private scoping avoids the UGC-video moderation cost trap). 

**Native note:** capture/compress/playback libs (`react-native-compressor`, `expo-video`, `expo-video-thumbnails`; `expo-camera` video mode — camera already present) are native → per-set video ships in a **build**, not OTA.
