# Code Prompt — Challenge algo: Cindy on pre-challenge, grade challenges, reward reveal (+ tab rescope, pending)

Four Challenge items. Three are scoped below; the fourth (Challenges-tab rescope) is **blocked pending Noah's images** — do NOT guess it. On `integration-wave1`, one branch, client-first (dev-client Metro), migrations additive on the one push path.

---

## §1 · Cindy on the pre-challenge screen (#180)
`src/app/challenge/create.tsx` has **no Cindy** today. Add her per **mock `140-cindy-custom-challenge.html`** (and check `143-create-challenge.html` for the create layout). Cindy on the pre-challenge/create surface — her framing/suggestion for the challenge you're about to set up (e.g. proposing a metric/opponent, or a "want me to set this up?" custom-challenge entry). Reuse the existing Cindy components (`CindyBubble` / the coach `sendToCindy` surface) rather than a new one; match the mock's placement and copy. Keep it opt-in / non-blocking — it assists the create flow, doesn't gate it.

**Done:** the pre-challenge/create screen shows Cindy per mock 140, wired to the real coach surface, not a static placeholder.

---

## §2 · Grade challenges for a course land appropriately (#182)
The concept exists in schema (`0096` — "BU111 grade" as an example public name; being in the course campfire is the entry), but the **grade-metric challenge type needs to work end-to-end.**

**Verify + fix the full loop:**
- **Create** — you can create a grade challenge tied to a course (the grade/GPA metric, the course/campfire scope), per the create mocks.
- **Progress/entry** — participants enter/update their grade (however the metric is captured — a self-reported grade, a target, etc.; follow the schema's intent).
- **Settle** — it resolves appropriately at the end (who hit the grade / highest grade / target met), pays the reward, and reveals it like the other challenge types.
- Report what was actually missing (create path? metric capture? settlement?) — it may be partially built.

**Done:** a grade challenge for a course can be created, tracked, and settled with its reward, same as the other challenge shapes.

---

## §3 · Reward reveal lands visually with the actual reward (#183)
The reward-rays audit found personal/team/placement challenge settlements **already reveal correctly** — `ChallengeRewardScreen` via the settlement watcher reading the unseen-rewards RPC, showing the actual reward (mock `137-challenge-reward-screen`). So this is mostly done. Two things to close:
- **Route the settlement watcher through the shared reward queue** (from the reward-rays pass) so a challenge reveal can't stack on top of a rank-up or another reveal — they sequence.
- **On-device confirm** each challenge type (personal / team / placement) plays its rays and shows the real embers/box/cosmetic won; placement shows the mock-114 percentile result.

**Done:** every challenge settlement plays its reward reveal with the actual reward, queued (never stacked), verified on device.

---

## §4 · Challenges-tab logic-path fixes + presentation cleanup (#181)
Noah's on-device images show the current tab has real **logic bugs** (priority) plus **presentation inconsistency**. It does not follow mocks 102/98/148; don't try to match those — fix these specific issues and make the presentation consistent.

### 4a · LOGIC BUGS (priority — these are wrong output, not styling)
1. **🔴 Inverted winner on finished challenges.** A finished "Most lock-in time" shows **You 2h 12m vs Noah 32m** with the progress bar showing YOU ahead, yet reads "Noah Brikman leads by 1h 40m" and "**Noah Brikman won**." The higher metric should win — the winner attribution is flipped. The magnitude (1h 40m) is right; the *person* is wrong. Note the LIVE card computes correctly ("You lead by 2h 2m"), so the bug is in the **finished/settled** winner display and/or the settlement's `winner_id`. Trace both: (a) is the server `winner_id` correct for a most-lock-in-time / most-XP race (check the settlement functions, 0122/0127), and (b) does the finished-card renderer (`social-challenge-card.tsx` / `challenge-card.tsx`) attribute the win to the right side? Fix wherever it inverts, and audit every race type (most lock-in time, most XP, all-or-nothing) + the tie path (the "Most XP 1,116 vs 1,116 → It's a tie" case renders correctly — keep that).
2. **Wrong tense on finished challenges.** A settled challenge says "**leads by**" (present tense, the live-card copy). It should read "**won by**" / past tense once finished.
3. **Watch screen perspective.** The Watch screen (`watch/[challengeId]`) shows both competitors by real name — "Noah Brikman vs Noah Brikman" — instead of "**You** vs Noah Brikman" for the viewer. Challenge-info gets this right ("You vs Noah Brikman"); make Watch use the same viewer-perspective labelling.
4. **Raw route in the header.** The challenge-info screen's title is the literal route string `challenge-info/[challengeId]` instead of a real title. Fix the screen's header (proper title, e.g. the challenge name, or hide it) — a route path must never render as a title.

### 4b · PRESENTATION cleanup
- **Consistent finished cards.** Finished results are inconsistent — some render as full vs-cards (with avatars, times, bar), others as a bare "Noah Brikman won + Rematch" text row. Unify: every finished challenge uses the same result-card shape (the vs layout + a clear "You won / Noah won / Tie" verdict + Rematch), not a stray text row.
- **Clear status grouping** on `src/app/(tabs)/challenges.tsx`: **active** (progress + "you lead by"), **pending / waiting-on-answers** (the manage-sheet state — a challenge "still waiting on an answer" should read as a distinct pending card, not blend with live ones), and **finished** (won/tie + rematch), with **History** collapsing the older ones. Friends vs Personal tabs stay.
- Keep the good bits: the vs-avatars, the two-colour progress bar, "You lead by X", the ✦ title on a competitor, the group "everyone who finishes scores" card.

**Done:** the finished-challenge winner is correct for every race type (bar, verdict, and copy all agree), finished copy reads past-tense, Watch shows "You vs …", no raw route renders as a title, and finished results all use one consistent card with clear active/pending/finished grouping.

---

## Guardrails + Done
- One branch (`integration-wave1`), one push path; migrations additive, restate nothing.
- Client-first (OTA via dev-client Metro); report snapshot age before any prod push.
- Per section, report what was broken vs already working.
- §4 stays untouched until Noah's images land.
