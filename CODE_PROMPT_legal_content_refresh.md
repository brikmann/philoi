# Code Prompt — Refresh legal content to match the *current* Philoi product

**Goal:** `site/privacy.html`, `site/terms.html`, and `site/child-safety.html` were copied from the old getphiloi.com pages, which described a **retired product** (invite-only "circles," camera-only "photo check-ins," "no open feed"). The current Philoi is a different app — lock-ins/accountability sessions, campfires, challenges, ranks & leaderboards, the Agora (a public campus feed), DMs/Ping, an ember cosmetic economy, the Forge, a Cindy AI coach, and opt-in fitness/calendar integrations. Rewrite the **descriptive content** of all three pages so the legalese accurately describes what the app does today and **removes every reference to the old product**.

This is a **content-accuracy** pass, not a domain/link migration (that's the other prompt) and not a redesign. Keep the existing page structure, styling, `<head>`/nav/footer, section numbering scheme, the **18+** age gate, and the **nb@philoi.app** contact. Change the words, not the frame.

## Guardrails (read first)
- **Describe reality, don't invent protections.** Every claim must match how the app actually behaves. If you can't confirm a data flow from the codebase, **flag it — do not fabricate** a guarantee (e.g. don't promise encryption, retention windows, or "we never share X" unless it's true).
- **You are not writing new legal theory.** Keep the existing legal clauses (liability, disclaimers, termination, rights, transfers) intact. Only the *product description* and *what-data / who-sees-what* substance changes.
- **Flag, don't guess, on anything that needs a human/legal call** — e.g. whether the Agora being public changes consent obligations, whether virtual-currency terms need a "no cash value / no refunds" clause, whether health data triggers extra disclosure. List these at the end of your report for Noah to review with a lawyer.
- Preserve any uncommitted in-progress work; commit only these three files.

## Step 1 — Enumerate before you write
1. `grep -niE "circle|photo|check-?in|camera|open feed|no public|invite-only" site/*.html` and list every hit. These are the old-product tells to remove or rewrite.
2. Confirm the **actual current data surfaces** from the codebase (don't assume) so the privacy page stays factually correct. At minimum verify what's collected/stored for: lock-in/focus sessions, campfire membership + chat, challenges (solo/duel/group, incl. Cindy-authored + custom/grade goals + wagered ember rewards + **vouching**), ranks/XP/leaderboards, **the Agora feed + comments/cheers**, DMs + Ping, the ember economy (purchases/IAP, loot boxes, the Forge), Cindy AI (what context is sent to Anthropic), fitness integrations (Apple Health/Garmin/Strava/etc.), Google Calendar, screen-time/Family Controls if used, push tokens, university affiliation/verification email.

## Step 2 — privacy.html (the one that must be *factually* right)
Rewrite so the collection/use/visibility sections match the current app. Specific must-fixes:
- **§1 "Who we are"** (line ~166): the "share your progress with a small group of friends (a campfire)" framing undersells the product. Describe it accurately: accountability sessions ("lock-ins"), campfires, challenges, ranks, and a **campus feed (the Agora)**.
- **§2 "What we collect"** (~line 184–186): "your check-ins" → replace with the real signals (completed lock-in sessions, challenge participation & outcomes, ranks/XP, ember transactions, Agora posts/comments/cheers, DMs & Pings). Keep it to what's actually stored.
- **§5 "Who can see what"** (~line 241–248): **this is currently false and must change.** It says *"Nothing is public by default. Philoi has no public profiles and no open feed. Campfires are invite-only."* The Agora is a **campus-wide/public feed** where milestones and posts surface to an audience beyond one's campfire. Rewrite this section to describe the Agora's actual visibility (who can see a post — friends / campus / everyone), what auto-surfaces there (milestones, rank-ups), and what stays private (DMs, lock-in detail, campfire chat). Be precise about the friends/Laurier/Waterloo/All reach tiers.
- **§6 "How we use your data"** (~line 255): update the "core product" list to the real surfaces (sessions, campfires, challenges, ranks, leaderboards, the Agora, the ember economy) and drop "check-ins."
- Fitness (§3), Calendar (§4), Anthropic/AI (§7), retention (§9): these are already current-product-accurate — **leave them unless a fact changed.** If the ember economy involves real-money IAP, make sure a payments/purchase data line exists and is correct (App Store / Play / RevenueCat or whatever's actually used).
- Keep **§12 Children = 18+**.

## Step 3 — terms.html (most old-product language lives here)
- **§3 "Your content"** (~line 171–172): entirely old-product — "photos and captions," a license to display to "the circle(s) you post it in," "Check-ins are camera-only by design… proof that you showed up, not a photo library upload." Rewrite for what users actually post now: Agora posts, campfire messages, challenge activity, profile content. Keep a normal user-content license clause (store & display to operate the app; no sale; no ad use) but framed around the current content types, not camera check-ins.
- **§4 "Acceptable use"** (~line 182): "access another user's account or **circle**" → "campfire." Add current-product abuse cases if warranted (e.g. gaming challenges/vouching or leaderboards dishonestly, harassment in the Agora/DMs).
- **§5 "Reporting & moderation"** (~line 186): "report or block… from their check-in" → from an Agora post / message / profile.
- **§6 "Account deletion"** (~line 189): "removes your profile, check-ins, photos, and circle memberships" → profile, sessions, challenge history, campfire memberships, Agora posts, messages (match privacy §9).
- **Ember economy / virtual currency:** if embers are bought with real money, Terms should cover it — virtual currency with **no cash value, non-transferable outside the app, no refunds** (standard for IAP). **Flag for Noah** if there's no such clause today; propose one but note it's a legal/business decision.

## Step 4 — child-safety.html
- "Adults-only" 18+ framing is correct — **keep it.**
- Replace check-in-specific moderation language (~line 158, 165): *"Every check-in… has a Report option"* and *"tap the ··· menu on any check-in"* → describe reporting on the surfaces that actually exist (Agora posts, DMs/messages, profiles, challenges). Keep the **"Child safety / CSAE"** dedicated report reason and the nb@philoi.app contact.

## Step 5 — Verify & report
- `grep -niE "circle|check-?in|camera|photo library|no open feed|no public profiles"` across the three files returns **nothing** (except legitimately current uses, if any — call them out).
- Each page still renders with its existing header/footer/CSS; section numbering intact; 18+ preserved; contact = nb@philoi.app.
- Privacy §5 now truthfully describes the Agora's public/campus reach.
- **Report back:** the list of old-product references you removed, the current data surfaces you confirmed from code (and any you *couldn't* confirm), and the flagged legal decisions (Agora-public-consent, ember/virtual-currency terms, anything health-data-related) for Noah to run past a lawyer.

## Commit
Commit only these three files together, on the same branch as the other marketing-site legal work (`add-marketing-site`), so the merge/deploy prompt picks them up in one shot. Don't deploy here — deploy is handled by the merge/deploy prompt.

> Note: this is descriptive-accuracy cleanup, not certified legal drafting. Recommend a human legal review before relying on these for IT vetting or app-store submission, especially the public-feed and paid-virtual-currency sections.
