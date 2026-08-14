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
export function getRealFitnessSourceForChallengeType(
  type: ChallengeType,
  opts?: { whoopConnected?: boolean }
): FitnessSourceKey | 'lock_ins' | null {
  if (type === 'steps') return getPlatformFitnessSource();
  if (type === 'run_distance' || type === 'ride_distance') return 'strava';
  // study + gym credit from the user's OWN lock-ins — the app already records exactly the
  // check-ins that should count, so these were never really "no device metric", just unrouted.
  if (type === 'study_hours' || type === 'gym_visits') return 'lock_ins';
  // Sleep is health data FIRST. Every phone can measure it; Whoop is one optional source among
  // several, and making it the only one left sleep dead for everyone without a band.
  if (type === 'sleep_hours') return opts?.whoopConnected ? 'whoop' : getPlatformFitnessSource();
  // Strain genuinely is a Whoop concept — there's no HealthKit/Health Connect equivalent — so it
  // stays Whoop-only and the picker says so.
  if (type === 'workout_minutes' || type === 'strain') return 'whoop';
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
  // Sleep now has three real candidates, not one. Whoop measures it, but so does every phone.
  sleep_hours: ['apple_health', 'health_connect', 'whoop'],
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

/** True when a goal of this type could ever track itself. Only `custom` can't — study and gym now
 * credit from lock-ins, so `custom` is the one type whose setup must never offer a Connect row
 * that goes nowhere (§7/§8). */
export function canAutoTrackChallengeType(type: ChallengeType): boolean {
  return getRealFitnessSourceForChallengeType(type) !== null;
}

/**
 * "Where does this number come from?" — shown under each option in the metric picker so nobody has
 * to guess what auto-updates. A metric whose source needs a connection says so plainly rather than
 * looking automatic and silently sitting at zero, which is exactly how study/gym/sleep read before.
 */
export function metricSourceLabel(type: ChallengeType): string | null {
  switch (type) {
    case 'steps':
      return Platform.OS === 'ios' ? 'From Apple Health or your watch' : 'From Health Connect or your watch';
    case 'run_distance':
    case 'ride_distance':
      return 'From Strava';
    case 'study_hours':
      return 'From your Study lock-ins';
    case 'gym_visits':
      return 'From your Gym lock-ins (needs a photo or logged sets)';
    case 'sleep_hours':
      return Platform.OS === 'ios' ? 'From Apple Health, or WHOOP if connected' : 'From Health Connect, or WHOOP if connected';
    case 'workout_minutes':
      return 'WHOOP only';
    case 'strain':
      return 'WHOOP only';
    default:
      return null;
  }
}

/**
 * Display name for any auto-source, including `lock_ins` which isn't a third-party integration.
 * Kept separate from FITNESS_SOURCE_NAME so that map stays exactly the four connectable services.
 */
export const AUTO_SOURCE_NAME: Record<FitnessSourceKey | 'lock_ins', string> = {
  ...FITNESS_SOURCE_NAME,
  lock_ins: 'your lock-ins',
};

/**
 * Whether a source needs the user to connect something first. Lock-ins never do — the app already
 * has the data — so a study or gym goal is genuinely automatic from the moment it's created, and
 * must not be labelled "logged by hand" just because no health permission was granted.
 */
export function sourceNeedsConnection(source: FitnessSourceKey | 'lock_ins'): boolean {
  return source !== 'lock_ins';
}

/** One or two words for inside a picker pill, where the full sentence above would never fit. */
export function metricSourceShort(type: ChallengeType): string | null {
  switch (type) {
    case 'steps':
      return 'Health';
    case 'run_distance':
    case 'ride_distance':
      return 'Strava';
    case 'study_hours':
    case 'gym_visits':
      return 'Lock-ins';
    case 'sleep_hours':
      return 'Health / WHOOP';
    case 'workout_minutes':
    case 'strain':
      return 'WHOOP only';
    default:
      return null;
  }
}

/** The live source for a metric, phrased for the goal card ("Sleep · from Apple Health"). */
export function activeSourceLabel(type: ChallengeType, opts?: { whoopConnected?: boolean }): string | null {
  const source = getRealFitnessSourceForChallengeType(type, opts);
  if (!source) return null;
  if (source === 'lock_ins') return type === 'gym_visits' ? 'from your Gym lock-ins' : 'from your Study lock-ins';
  return `from ${FITNESS_SOURCE_NAME[source]}`;
}

export async function requestDeviceSleepAuthorization(): Promise<boolean> {
  if (HealthKit.isHealthKitSupported()) return HealthKit.requestSleepAuthorization();
  if (HealthConnect.isHealthConnectSupported()) return HealthConnect.requestSleepAuthorization();
  return false;
}

export async function getDeviceSleepHoursBetween(startDate: Date, endDate: Date): Promise<number> {
  if (HealthKit.isHealthKitSupported()) return HealthKit.getSleepHoursBetween(startDate, endDate);
  if (HealthConnect.isHealthConnectSupported()) return HealthConnect.getSleepHoursBetween(startDate, endDate);
  return 0;
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
