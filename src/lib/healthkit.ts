import { Platform } from 'react-native';

import { FITNESS_SYNC_ENABLED } from '@/constants/feature-flags';

const STEP_COUNT = 'HKQuantityTypeIdentifierStepCount';

// Apple HealthKit — device-verified steps (PHILOI_UI_SPEC.md §17). READ-ONLY: every call below
// requests `toRead` and NEVER `toShare` — this app has no legitimate reason to write to a
// user's Health data and never will, so there's no write path to accidentally widen later.
//
// The native module is a Nitro module (@kingstinct/react-native-healthkit) that isn't compiled
// into any build until the EAS dev-client rebuild ships (see FITNESS_SYNC_ENABLED) — every
// export here is guarded on isHealthKitSupported() first and `require()`s the module lazily
// inside the guarded path, never at the top of this file, so importing this file is always safe
// even on Android or an old binary that doesn't have the native code at all.
export function isHealthKitSupported(): boolean {
  return Platform.OS === 'ios' && FITNESS_SYNC_ENABLED;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy-load, see file header
const healthKit = () => require('@kingstinct/react-native-healthkit') as typeof import('@kingstinct/react-native-healthkit');

/** Requests read-only step-count access. Resolves `true` once the OS sheet has been presented
 * and answered — HealthKit deliberately never tells a READ requester whether the user actually
 * granted or denied it (a well-known, intentional Apple privacy behavior), so "true" here means
 * "the request completed," not "access confirmed." The first real query is what actually reveals
 * whether there's anything to read. */
export async function requestStepsAuthorization(): Promise<boolean> {
  if (!isHealthKitSupported()) return false;
  const hk = healthKit();
  const available = await hk.isHealthDataAvailableAsync();
  if (!available) return false;
  await hk.requestAuthorization({ toRead: [STEP_COUNT] });
  return true;
}

/** Total steps in [startDate, endDate], summed on-device by HealthKit itself (a native
 * cumulative-sum statistics query, not a client-side reduce over raw samples) — the app only
 * ever sees this one number, never the underlying samples. */
export async function getStepsBetween(startDate: Date, endDate: Date): Promise<number> {
  if (!isHealthKitSupported()) return 0;
  const hk = healthKit();
  const stats = await hk.queryStatisticsForQuantity(STEP_COUNT, ['cumulativeSum'], {
    filter: { date: { startDate, endDate } },
    unit: 'count',
  });
  return stats.sumQuantity?.quantity ?? 0;
}
