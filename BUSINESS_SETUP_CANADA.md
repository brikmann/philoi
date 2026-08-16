# Business + tax setup (Canada) — to activate the App Store paid agreement

**TL;DR:** Sole proprietor now, no incorporation needed. Register for a **GST/HST account** with the CRA
as a sole proprietor → you're issued a **Business Number (BN) + RT account** → that's exactly what App
Store Connect's Form 506 needs. (Not legal/tax advice — plain-language; CRA or an accountant can confirm.)

## What the form wants
- A **9-digit Business Number** + the **RT** (GST/HST program account, e.g. `123456789 RT0001`).
- You get **both at once** by registering for GST/HST — not by incorporating or registering a company.

## Steps
1. **Register for GST/HST via CRA Business Registration Online (BRO)** at canada.ca.
   (Phone registration ended Nov 2025 — online only now.)
   - Sign in (CRA My Business Account, or your bank as a "Sign-In Partner").
   - Structure = **Sole proprietor**; give your legal name + contact info.
   - You're issued the **9-digit BN on the spot** + the **RT0001** GST/HST account.
2. **Enter BN + RT in Form 506** → certify (completes Part D; Apple completes Part E).
3. **Complete the Banking + U.S. Tax (W-8BEN)** sections in App Store Connect → Business.
   (The U.S. Tax section is required for everyone, even non-US; the W-8BEN claims the Canada–US treaty
   rate so Apple doesn't over-withhold ~30%.)
4. Contract activates once agreement + tax + banking are all done → then you can create paid IAP.

## The small-supplier nuance (why you're registering voluntarily)
- Under **$30,000/yr** in taxable revenue (over 4 consecutive quarters) you're a "small supplier" and the
  CRA does **not** require you to register. But **Apple requires it to sell to Canadian users**, so you
  register **voluntarily**.
- **Upside:** via Form 506 you elect to have **Apple Canada collect + remit the GST/HST for you** on
  App Store sales — you don't chase tax per sale.
- **Downside:** once registered you must **file GST/HST returns** (usually nil / simple if the App Store
  is your only income). Watch the filing frequency + deadline the CRA assigns (often annual for small
  filers).

## The "Philoi" name (optional, do later)
- Not required for the form or to launch — you can register GST under your **own legal name**
  (Noah Brikman).
- To operate formally as "Philoi": register the trade name in the **Ontario Business Registry** (~$60,
  renews every 5 years). Optional.

## Sole prop vs. incorporate — a later decision
- Sole prop = simplest; income flows to your personal taxes; you're personally liable.
- Incorporate later if revenue grows, for liability protection, or tax planning.
- **Talk to an accountant before incorporating** — real tax + liability implications. Not needed to
  launch.

Sources: CRA — [register for GST/HST](https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/account-register.html) ·
[when to register / small supplier](https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/when-register-charge)
