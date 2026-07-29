// Philoi membership pricing — dormant. Decision log 2026-06-28: shipping fully free during
// early access to chase traction first; src/lib/analytics.ts is what tells us when/how to
// actually turn this on. When that data says "go," it'll be a flat membership fee (not a
// tiered Free/Pro split) — these constants and the paywall screen are the seam for that.

export const MEMBERSHIP_PRICING = {
  monthly: { amount: 2.99, label: '$2.99/mo' },
  yearly: { amount: 19.99, label: '$19.99/yr' },
} as const;

export const MEMBERSHIP_PITCH = [
  'Unlimited Campfires, friends, and check-ins',
  'Streaks, leaderboards, and the full feed',
  'Reminders so you never break a streak by accident',
  "You're in — no ads, no algorithm, just your people",
] as const;

// TODO: RevenueCat — replace these stubs with Purchases.configure() on app start,
// Purchases.purchasePackage() here, and Purchases.restorePurchases() below.
// Public SDK keys already have a seam in app.config.ts → extra.revenueCatIosKey / revenueCatAndroidKey.
export async function purchaseMembership(_plan: keyof typeof MEMBERSHIP_PRICING): Promise<{ success: boolean }> {
  throw new Error('Billing is not wired up yet — use the dev membership toggle in Profile to test it.');
}

export async function restorePurchases(): Promise<{ success: boolean }> {
  throw new Error('Billing is not wired up yet — use the dev membership toggle in Profile to test it.');
}
