# Code prompt — challenges redesign (mock 98)

Reference: **`design-mocks/98-challenges-redesign.html`** (empty · create · sent). Baseline tokens as everywhere:
deep-purple gradient bg (`ScreenBackground`), ember-gradient black-text CTA (`linear-gradient(135deg,#F2A33C,#E0612C)`,
text `#3a1608`), `FlameLogo`/`EmberToken`, muted surface `#1b1726`, muted-disabled `#241c30`.

## 1. Empty state — `src/app/(tabs)/challenges.tsx`
- **Drop the off-brand mascot.** Replace with a clean ember hero: a **target/crosshair** glyph (stroke `#F2A33C`)
  inside a soft radial ember glow (mock 98, screen 1).
- Copy: **"No active challenges"** + "Race a friend or set a personal goal. Winner takes the XP."
- CTA = **ember-gradient "Start a challenge"** (black text, rounded, glow) — not a flat orange.
- **History: pin it as a tidy bottom bar**, not floating awkwardly. A `border-top` row at the screen's bottom edge:
  `History  [count-chip]` on the left, a `⌄` chevron on the right; tapping expands the finished list. (Currently
  it's in an awkward mid/low position — move it to a fixed bottom bar.)

## 2. Create — `src/app/challenge/create.tsx`
- **Move the primary CTA to the BOTTOM** as a full-width **pinned footer** button (not inline after the content):
  - **Active** (friend + options chosen): ember-gradient **"Send challenge"**, black text.
  - **Disabled** (no one picked yet): **muted-on-brand** — bg `#241c30`, text `#6f6685`, `1px` border `#2f2740`,
    no shadow, label "Pick someone to challenge". (Kills the current awkward orange-on-dark disabled look.)
- **Remove the stray trailing arrow** on the "New challenge" button/row (the `→`/chevron at the right edge — it
  shouldn't be there).
- Keep the form, ember-tokenised: segmented **Challenge a friend / Personal goal** (active = ember-orange fill),
  Challenge type (Head-to-head / Group), Challenge who (avatar), The race, "Let a campfire watch" toggle,
  How long (24h / 3 days / 1 week), prize chip "🏆 Winner takes +N XP". Selected pills = `#20182f` + amber border.

## 3. Sent confirmation — (challenge-sent state / `55-challenge-request-sent` equivalent)
- Confirmation content **up top** (paper-plane/ember hero, "Sent to \<name\>", race summary, "⏳ Waiting for \<name\>
  to accept").
- **Primary CTA at the BOTTOM, not the top:** ember **"Done"** in a pinned footer, with a ghost **"Start another
  challenge"** beneath it. (Currently the primary action sits at the top — move it down.)

## Acceptance
- [ ] Empty state: ember hero (no mascot), ember CTA, History pinned as a bottom bar.
- [ ] Create: primary CTA pinned bottom; disabled state muted-on-brand; no trailing arrows.
- [ ] Sent: primary CTA at the bottom + ghost secondary.
- [ ] All three on the gradient bg with ember tokens.
