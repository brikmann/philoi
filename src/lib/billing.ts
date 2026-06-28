// Philoi Pro — pricing is a placeholder until real billing is wired up.
export const PRO_PRICING = {
  monthly: { amount: 2.99, label: '$2.99/mo' },
  yearly: { amount: 19.99, label: '$19.99/yr' },
} as const;

export const PRO_FEATURES = [
  'Custom app themes & flame colors',
  'Animated profile flair & badges',
  'Advanced stats — history & consistency charts',
  'Custom challenges & goal rules',
  'Extra reminder slots',
  'Exclusive Pro badge on the leaderboard',
] as const;

// TODO: RevenueCat — replace these stubs with Purchases.configure() on app start,
// Purchases.purchasePackage() here, and Purchases.restorePurchases() below.
// Public SDK keys already have a seam in app.config.ts → extra.revenueCatIosKey / revenueCatAndroidKey.
export async function purchasePro(_plan: keyof typeof PRO_PRICING): Promise<{ success: boolean }> {
  throw new Error('Billing is not wired up yet — use the dev Pro toggle in Profile to test Pro features.');
}

export async function restorePurchases(): Promise<{ success: boolean }> {
  throw new Error('Billing is not wired up yet — use the dev Pro toggle in Profile to test Pro features.');
}
