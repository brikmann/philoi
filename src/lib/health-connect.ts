import { Platform } from 'react-native';

import { FITNESS_SYNC_ENABLED } from '@/constants/feature-flags';

const STEPS = 'Steps';

// Google Health Connect — device-verified steps on Android (PHILOI_UI_SPEC.md §17). READ-ONLY:
// every permission requested below is `{ accessType: 'read' }`, never 'write' — same guarantee
// as src/lib/healthkit.ts's iOS counterpart.
//
// The native module (react-native-health-connect) isn't compiled into any build until the EAS
// dev-client rebuild ships (see FITNESS_SYNC_ENABLED) — every export here is guarded on
// isHealthConnectSupported() first and `require()`s the module lazily inside the guarded path,
// never at the top of this file, so importing this file is always safe even on iOS or an old
// binary that doesn't have the native code at all.
export function isHealthConnectSupported(): boolean {
  return Platform.OS === 'android' && FITNESS_SYNC_ENABLED;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy-load, see file header
const healthConnect = () => require('react-native-health-connect') as typeof import('react-native-health-connect');

// Every Health Connect client call requires initialize() first, and it is NOT implied by having
// been granted permission in some earlier app session — permission persists across launches, the
// client's initialized state does not. Memoized on the promise so concurrent callers share one
// init and repeat calls are free; reset on failure so a transient error doesn't poison every
// later call with a permanently-rejected promise.
let initPromise: Promise<unknown> | null = null;
function ensureInitialized(): Promise<unknown> {
  if (!initPromise) {
    initPromise = healthConnect()
      .initialize()
      .catch((e) => {
        initPromise = null;
        throw e;
      });
  }
  return initPromise;
}

/** Why Health Connect isn't usable, when it isn't — 'unsupported' (wrong platform or the flag is
 * off), 'not_installed' (Android 13 and below, where it's a Play Store app), 'needs_update' (it's
 * there but too old). Distinguished because these need genuinely different things from the user
 * and collapsing them to a bare false is what made this failure invisible: the connect flow
 * reported the same "Could not connect" whether Health Connect was missing, stale, or fine. */
export type HealthConnectAvailability = 'available' | 'unsupported' | 'not_installed' | 'needs_update';

export async function getHealthConnectAvailability(): Promise<HealthConnectAvailability> {
  if (!isHealthConnectSupported()) return 'unsupported';
  const hc = healthConnect();
  const status = await hc.getSdkStatus();
  if (status === hc.SdkAvailabilityStatus.SDK_AVAILABLE) return 'available';
  if (status === hc.SdkAvailabilityStatus.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED) return 'needs_update';
  return 'not_installed';
}

/** Health Connect is native on Android 14+ but an installable Play Store app on older versions
 * — this never throws for "not installed," it just reports unavailable so the caller can fall
 * back to manual entry (§18 — never gate participation on this being present). */
export async function isHealthConnectAvailable(): Promise<boolean> {
  return (await getHealthConnectAvailability()) === 'available';
}

/** Requests read-only step-count access. Unlike HealthKit, Health Connect's permission API
 * reliably reports what was actually granted (no read-privacy obscuring), so the return value
 * here means what it says. */
export async function requestStepsAuthorization(): Promise<boolean> {
  // Throws rather than returning false for the two states the user can actually DO something
  // about — the caller turns these into a real message instead of the generic "not available
  // right now" that made a missing Health Connect app indistinguishable from a denied prompt.
  const availability = await getHealthConnectAvailability();
  if (availability === 'not_installed') {
    throw new Error('Health Connect isn’t set up on this phone. Install it from the Play Store, then try again.');
  }
  if (availability === 'needs_update') {
    throw new Error('Health Connect needs updating before Philoi can read your steps. Update it in the Play Store, then try again.');
  }
  if (availability !== 'available') return false;

  const hc = healthConnect();
  await ensureInitialized();
  const granted = await hc.requestPermission([{ accessType: 'read', recordType: STEPS }]);
  return granted.some((p) => p.recordType === STEPS && p.accessType === 'read');
}

/** Total steps in [startDate, endDate], aggregated on-device by Health Connect itself — the app
 * only ever sees this one number, never the underlying records. */
export async function getStepsBetween(startDate: Date, endDate: Date): Promise<number> {
  if (!isHealthConnectSupported()) return 0;
  const hc = healthConnect();
  // Not just in the permission path: this runs on its own on a later launch (a steps challenge
  // syncing against a permission granted days ago), where nothing else would have initialized.
  await ensureInitialized();
  const result = await hc.aggregateRecord({
    recordType: STEPS,
    timeRangeFilter: { operator: 'between', startTime: startDate.toISOString(), endTime: endDate.toISOString() },
  });
  return result.COUNT_TOTAL ?? 0;
}
