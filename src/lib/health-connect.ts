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

/** Health Connect is native on Android 14+ but an installable Play Store app on older versions
 * — this never throws for "not installed," it just reports unavailable so the caller can fall
 * back to manual entry (§18 — never gate participation on this being present). */
export async function isHealthConnectAvailable(): Promise<boolean> {
  if (!isHealthConnectSupported()) return false;
  const hc = healthConnect();
  const status = await hc.getSdkStatus();
  return status === hc.SdkAvailabilityStatus.SDK_AVAILABLE;
}

/** Requests read-only step-count access. Unlike HealthKit, Health Connect's permission API
 * reliably reports what was actually granted (no read-privacy obscuring), so the return value
 * here means what it says. */
export async function requestStepsAuthorization(): Promise<boolean> {
  if (!(await isHealthConnectAvailable())) return false;
  const hc = healthConnect();
  await hc.initialize();
  const granted = await hc.requestPermission([{ accessType: 'read', recordType: STEPS }]);
  return granted.some((p) => p.recordType === STEPS && p.accessType === 'read');
}

/** Total steps in [startDate, endDate], aggregated on-device by Health Connect itself — the app
 * only ever sees this one number, never the underlying records. */
export async function getStepsBetween(startDate: Date, endDate: Date): Promise<number> {
  if (!isHealthConnectSupported()) return 0;
  const hc = healthConnect();
  const result = await hc.aggregateRecord({
    recordType: STEPS,
    timeRangeFilter: { operator: 'between', startTime: startDate.toISOString(), endTime: endDate.toISOString() },
  });
  return result.COUNT_TOTAL ?? 0;
}
