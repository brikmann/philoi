# Laurier Policy 9.5 + HECVAT — Analysis & Strategy for Philoi

*Source: WLU Policy 9.5 (rev. June 8 2026) and EDUCAUSE HECVAT 4 (v4.1.6). Prepared for Noah.*

## TL;DR
The email is a **soft green light, not a rejection.** Laurier won't *review or endorse* Philoi because it's a student-direct app that doesn't touch Laurier's systems or store Laurier's institutional data — which under Policy 9.5 means Philoi is **out of scope for their formal vetting** (a faster path, not a blocked one). The one lever they handed you — **complete the HECVAT** — is worth doing not because Laurier requires it, but because it's a **reusable trust asset**: one completed HECVAT answers the security/privacy questions of *every* higher-ed institution, plus gyms and parents, and turns "trust me" into "here's the standard questionnaire, filled out."

---

## 1 · What Policy 9.5 actually says (and means for Philoi)

**Scope (§3):** 9.5 governs External IT "procured or used at Laurier by Members of the University Community." It sorts data into three classes:
- **Type 1 – Open:** public, no restrictions.
- **Type 2 – Internal:** unauthorized release = minor/short-term harm (most personal info sits here).
- **Type 3 – Restricted:** compromise = significant/lasting harm (protected by law/policy).

**The two paths it defines:**
- **§4.01 Procurement** — if Laurier *institutionally* adopts a system that stores Internal/Restricted data, it triggers a **PSIA (Privacy & Security Impact Assessment)**, legal review, a preference for **Canadian hosting**, and AODA compliance. This is the heavy path.
- **§4.03 Use of External IT (not provisioned by ICT)** — a student *may* use an outside app on their own, **for Open Data**, "without any expectation of assistance" from ICT. Internal/Restricted institutional data must stay on ICT-approved products.

**Where Philoi lands:** Philoi is **§4.03, not §4.01.** The data is submitted by the student directly (their own name, email, lock-ins, activity) — it's the *student's* personal information, not *Laurier's* institutional data, and nothing integrates with Laurier systems. So:
- Laurier has **nothing to procure and nothing to vet** — hence "we would not review or endorse this app." That's why they're out of the loop, and why you don't need their sign-off to launch to Laurier students.
- The flip side: **no institutional endorsement, no integration, no "official Laurier app" status** — by design. Keep it that way for now; the moment you integrate with a Laurier system (SIS, SSO, grades), you flip into §4.01 and inherit the full PSIA + legal + procurement burden.

**Two concrete things 9.5 flags that you should own regardless:**
1. **Canadian hosting preference.** 9.5 wants Canadian data residency. **Check your Supabase project region** — if it's US, that's the single most-cited flag any Canadian university (or privacy-conscious student) will raise. Moving to / launching on a **Canadian region** is a cheap, high-value trust move.
2. **Personal data = Type 2 posture.** Treat student email/name/activity/photos as Internal-class data even though Laurier won't classify it for you: encryption, access control, retention/deletion, breach process. The HECVAT will ask all of this.

---

## 2 · What the HECVAT is and what completing it requires

**What it is:** the **Higher Education Community Vendor Assessment Toolkit** — a free, community-standard questionnaire (EDUCAUSE + Internet2 + REN-ISAC). A vendor fills it out **once**; any institution can read it. Current release **HECVAT 4 (v4.1.6)**, a single scalable Excel workbook (HECVAT 4 merged the old Full/Lite/Triage versions into one tool and **added privacy and AI questions**). Free for vendors to use, no license.

**What it covers (the domains you'll answer):**
- **Company & product** — who you are, what the product does, hosting model.
- **Data handling** — what data you collect, its classification, where it's stored (residency!), retention, and **deletion on request**.
- **Encryption** — in transit (TLS) and at rest.
- **Authentication & access control** — how users log in, how *you* access prod, least privilege.
- **Third-party subprocessors** — everyone in your stack that touches data, each with terms/DPA.
- **Privacy & compliance** — consent, data-subject rights, applicable law (PIPEDA/Canada, FERPA if US student records, GDPR if EU), **minors** (age gating / COPPA-style handling).
- **AI** (new in v4) — any AI feature, what data it uses, model providers.
- **Incident response & breach notification** — do you have a plan and a notification commitment.
- **Business continuity / backup / DR.**
- **Vulnerability management, logging, monitoring.**
- **IT accessibility** — WCAG / AODA conformance.

**Philoi-specific: you're already ~60% of the way there.** From the security work already done, you can answer a lot of it today:
- ✅ **Access control / RLS** — Supabase Postgres row-level security is your access story.
- ✅ **Backup/DR** — PITR (7-day) is enabled.
- ✅ **Encryption** — Supabase gives TLS + at-rest by default (state versions).
- ✅ **Minors / child safety** — you have a child-safety page and CSAE handling.
- ✅ **Privacy docs** — terms.html + child-safety.html live on philoi.app.
- ⚠️ **Subprocessor list** — enumerate: **Supabase** (DB/auth/storage), **Expo/EAS** (build/OTA), **Firebase/FCM** (push), **Strava / Health Connect** (fitness), **RevenueCat** (IAP), **Resend** (email), **Sentry** (error logging), any AI provider behind **Cindy**. Each needs a line + a DPA/terms link.
- ⚠️ **Data residency** — the Supabase region question (§1 above).
- ⚠️ **Retention & deletion** — write a plain retention policy + a working "delete my account/data" path (also required by app stores + PIPEDA).
- ⚠️ **AI disclosure** — **Cindy** triggers the HECVAT 4 AI questions: what model/provider, what user data it sees, whether data trains the model.
- ⚠️ **Incident response** — a one-page IR + breach-notification plan.
- ⚠️ **Accessibility** — an honest WCAG/AODA self-rating (you don't need AA everywhere yet, but answer truthfully).

---

## 3 · Strategy & next steps

**Strategic frame:** Don't treat the HECVAT as a Laurier hoop — treat it as a **go-to-market asset and a moat.** Completing it (a) unblocks *every* future university conversation with one artifact, (b) is a credibility signal to gyms, student groups, and parents (especially given the minors/child-safety angle), and (c) forces you to close real security/privacy gaps before the closed test and any press. It's the same work you'd do for the Play Store data-safety form and PIPEDA anyway.

**Do NOT** pursue institutional integration (SSO/SIS/grades) yet — that flips Philoi from §4.03 (student-choice, no vetting) into §4.01 (full PSIA + legal + procurement). Stay a consumer app students opt into; it's the faster, lighter path and it's exactly what the email confirms is available to you.

**Next steps, in order:**
1. **Download HECVAT 4 (v4.1.6)** from EDUCAUSE (the .xlsx) and do a **self-assessment / gap pass** — most rows you can answer now; flag the ⚠️ items above.
2. **Confirm/settle data residency** — check the Supabase region; move to or confirm **Canada**. Highest-leverage single fix.
3. **Write three short docs** you're missing: a **subprocessor list** (with DPA links), a **data retention & deletion policy** (+ implement account/data deletion), and a **one-page incident-response/breach plan**. These are HECVAT answers *and* PIPEDA / app-store requirements.
4. **Disclose Cindy's AI** — provider, data flow, no-training claim — for the v4 AI section and your privacy policy.
5. **Publish a Trust/Security page** on philoi.app summarizing the posture (hosting region, encryption, RLS, PITR, child-safety, subprocessors) and offer the completed HECVAT on request — reusable for Laurier, other schools, gyms, parents.
6. **Reply to Laurier IT** (short, warm): thank them, confirm you understand Philoi operates under §4.03 as a student-direct tool storing only student-submitted data, and that you're **completing the HECVAT proactively** to meet the higher-ed bar and will share it when done. This keeps the relationship open for the day you *do* want an institutional conversation — and signals seriousness now.

**Bottom line:** Laurier isn't a gate you have to pass to launch — you're already clear to run the closed test with Laurier students. The HECVAT is the thing that makes Philoi *credible* to every institution and safety-conscious user at once, and most of it is already true in your stack. Knock out the ⚠️ gaps (residency, deletion, subprocessors, IR, AI, accessibility) and you have a durable trust asset, not a compliance chore.
