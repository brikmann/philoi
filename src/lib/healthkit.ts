import { Platform } from 'react-native';

import { FITNESS_SYNC_ENABLED } from '@/constants/feature-flags';

const STEP_COUNT = 'HKQuantityTypeIdentifierStepCount';
const SLEEP_ANALYSIS = 'HKCategoryTypeIdentifierSleepAnalysis';

// Sleep is a CATEGORY type, not a quantity — there's no cumulativeSum to ask for, so the duration
// has to be summed from the samples themselves. Apple splits a night into stages, and the "in bed"
// value overlaps the asleep ones; counting all of them would roughly double every night. Only the
// asleep stages count.
const ASLEEP_VALUES = new Set([
  1, // HKCategoryValueSleepAnalysisAsleep (legacy, pre-iOS 16)
  3, // …AsleepCore
  4, // …AsleepDeep
  5, // …AsleepREM
]);

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

/** Read-only sleep access. Requested separately from steps so a steps goal never asks for sleep. */
export async function requestSleepAuthorization(): Promise<boolean> {
  if (!isHealthKitSupported()) return false;
  const hk = healthKit();
  const available = await hk.isHealthDataAvailableAsync();
  if (!available) return false;
  await hk.requestAuthorization({ toRead: [SLEEP_ANALYSIS] });
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

/**
 * Total hours ASLEEP in [startDate, endDate], summed from sleep-analysis samples.
 *
 * Unlike steps this can't be a native statistics query — category types have no cumulativeSum — so
 * the app does see individual samples here. It reads only their start/end and stage value, and
 * keeps nothing.
 */
export async function getSleepHoursBetween(startDate: Date, endDate: Date): Promise<number> {
  if (!isHealthKitSupported()) return 0;
  const hk = healthKit();
  const samples = await hk.queryCategorySamples(SLEEP_ANALYSIS, {
    filter: { date: { startDate, endDate } },
    // Required by the query API. A week of sleep is a few dozen stage samples even on a watch that
    // records every transition, so this is a generous ceiling rather than a real constraint.
    limit: 5000,
  });
  const seconds = (samples ?? []).reduce((sum, s) => {
    if (!ASLEEP_VALUES.has(s.value)) return sum;
    const start = new Date(s.startDate).getTime();
    const end = new Date(s.endDate).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return sum;
    return sum + (end - start) / 1000;
  }, 0);
  return seconds / 3600;
}
