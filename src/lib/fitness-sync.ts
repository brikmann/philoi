import { Platform } from 'react-native';

import * as HealthConnect from '@/lib/health-connect';
import * as HealthKit from '@/lib/healthkit';
import type { ChallengeType } from '@/types/database';

export type FitnessSourceKey = 'apple_health' | 'health_connect' | 'strava' | 'whoop';

// The platform-aware default device source (PHILOI_UI_SPEC.md §17) — iOS gets Apple Health,
// Android gets Health Connect. There's exactly one real device-pedometer source per platform, so
// "the default" and "the only real option" are the same thing for now; this stays named/shaped
// so a second real source per platform slots in without restructuring the callers below.
export function getPlatformFitnessSource(): FitnessSourceKey | null {
  if (Platform.OS === 'ios') return 'apple_health';
  if (Platform.OS === 'android') return 'health_connect';
  return null;
}

// Which source is actually real for a given challenge type — steps reads the phone's own
// pedometer (HealthKit/Health Connect); runs and rides read Strava instead (§17's "Strava for
// runs + rides"), cross-platform, since neither HealthKit nor Health Connect distance reading is
// wired up here; workouts, strain and sleep read Whoop. Everything else
// (gym_visits/study_hours/custom) has no device metric at all.
export function getRealFitnessSourceForChallengeType(type: ChallengeType): FitnessSourceKey | null {
  if (type === 'steps') return getPlatformFitnessSource();
  if (type === 'run_distance' || type === 'ride_distance') return 'strava';
  if (type === 'workout_minutes' || type === 'strain' || type === 'sleep_hours') return 'whoop';
  return null;
}

// METRIC FIT (§17) — "don't offer every source for every challenge. Show a source only when it
// can actually measure the challenge's metric." This is which sources are even CANDIDATES for a
// type; exactly one of them (getRealFitnessSourceForChallengeType, above) is wired up today and
// the rest of a candidate list is an honest "coming soon".
//
// The rule that matters most here: WHOOP HAS NO STEP COUNT — it measures strain, heart rate,
// workouts, sleep and recovery — so it must never appear on a steps challenge, and neither
// pedometer may appear on a strain challenge. Both pedometers stay candidates for steps because
// the non-platform one is a real product that measures it, just not on this device.
const CANDIDATE_SOURCES_BY_CHALLENGE_TYPE: Partial<Record<ChallengeType, FitnessSourceKey[]>> = {
  steps: ['apple_health', 'health_connect'],
  run_distance: ['strava'],
  ride_distance: ['strava'],
  workout_minutes: ['whoop'],
  strain: ['whoop'],
  sleep_hours: ['whoop'],
};

export function fitnessSourcesForChallengeType(type: ChallengeType): FitnessSourceKey[] {
  return CANDIDATE_SOURCES_BY_CHALLENGE_TYPE[type] ?? [];
}

// Display names, kept here rather than in any one screen — the goal card, the setup flow and the
// sync prompt all name the same four sources and must not drift apart.
export const FITNESS_SOURCE_NAME: Record<FitnessSourceKey, string> = {
  apple_health: 'Apple Health',
  health_connect: 'Health Connect',
  strava: 'Strava',
  whoop: 'Whoop',
};

/** True when a goal of this type could ever track itself. `custom`, `gym_visits` and
 * `study_hours` have no device metric at all, so their setup must never offer a Connect row
 * that goes nowhere (§7/§8). */
export function canAutoTrackChallengeType(type: ChallengeType): boolean {
  return getRealFitnessSourceForChallengeType(type) !== null;
}

export function isDeviceFitnessSupported(): boolean {
  return HealthKit.isHealthKitSupported() || HealthConnect.isHealthConnectSupported();
}

/** Requests read-only step access from whichever source is real on this platform. */
export async function requestDeviceFitnessAuthorization(): Promise<boolean> {
  if (HealthKit.isHealthKitSupported()) return HealthKit.requestStepsAuthorization();
  if (HealthConnect.isHealthConnectSupported()) return HealthConnect.requestStepsAuthorization();
  return false;
}

export async function getDeviceStepsBetween(startDate: Date, endDate: Date): Promise<number> {
  if (HealthKit.isHealthKitSupported()) return HealthKit.getStepsBetween(startDate, endDate);
  if (HealthConnect.isHealthConnectSupported()) return HealthConnect.getStepsBetween(startDate, endDate);
  return 0;
}
