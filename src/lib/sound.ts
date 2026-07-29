import type { AudioPlayer } from 'expo-audio';

// Semantic reward moments (PHILOI_UI_SPEC.md §22), not generic intensity tiers — each name is
// the specific beat it's tied to, not a "how loud" label. Real fire recordings (0.3-2.2s,
// peak-normalized to -1dBFS, mono 44.1k), replacing the earlier placeholder spark/bloom/surge
// set.
export type RewardCue =
  | 'ignite'
  | 'whoosh'
  | 'settle'
  | 'rankup'
  | 'spark'
  | 'rankup-bronze'
  | 'rankup-silver'
  | 'rankup-gold'
  | 'rankup-diamond'
  | 'rankup-infernal'
  | 'rankup-riser';

// The rank-up riser build (PHILOI_UI_SPEC.md §11/§22) — a long swell that runs the length of the
// forge and is cut at the flare so it resolves *into* the per-tier hit rather than competing with
// it (see rank-up-celebration.tsx's timing). Two alternate cuts sit beside it in assets/sounds/;
// switch the primary by pointing this one constant at another file — nothing else changes.
const RANKUP_RISER_SOURCE = require('../../assets/sounds/rankup-riser.wav');
// Swappable alternates: '../../assets/sounds/rankup-riser-wildfire.wav'
//                       '../../assets/sounds/rankup-riser-drone.wav'

const SOURCES: Record<RewardCue, number> = {
  ignite: require('../../assets/sounds/ignite.wav'), // Lock-in tap
  whoosh: require('../../assets/sounds/whoosh.wav'), // XP-bar fill on the done screen
  settle: require('../../assets/sounds/settle.wav'), // Done / Post
  rankup: require('../../assets/sounds/rankup.wav'), // generic rank-up fallback (platinum's crossing)
  spark: require('../../assets/sounds/spark.wav'), // per-ember landing tick (fire-complete celebration)
  // Per-tier-crossing cues (PHILOI_UI_SPEC.md §11/§22, selected by the NEW tier type).
  'rankup-bronze': require('../../assets/sounds/rankup-bronze.wav'), // blacksmith hammer strike
  'rankup-silver': require('../../assets/sounds/rankup-silver.wav'), // cash-register ka-ching
  'rankup-gold': require('../../assets/sounds/rankup-gold.wav'), // bright ching
  'rankup-diamond': require('../../assets/sounds/rankup-diamond.wav'), // angelic choir swell
  'rankup-infernal': require('../../assets/sounds/rankup-infernal.wav'), // mean guitar riff
  'rankup-riser': RANKUP_RISER_SOURCE, // the forge build, cut at the flare
};

let players: Record<RewardCue, AudioPlayer> | null = null;

// Preloads all four reward sounds once at app start (see _layout.tsx) so the very first
// check-in has zero playback latency, and configures the audio session to respect the
// phone's silent/vibrate switch — expo-audio's default (playsInSilentMode: true) overrides
// it, which is the opposite of what "respect silent mode" means here.
//
// expo-audio resolves its native binding at import time (AudioModule.js does a top-level
// `requireNativeModule('ExpoAudio')`, unlike expo-haptics which soft-checks lazily on each
// call) — so a dev-client build that predates this dependency crashes the instant anything
// `require`s the package, before any try/catch in our own code could run. Keeping the import
// out of this file's top level and only `require`-ing it inside this function means that
// crash, if it happens, happens *inside* the try/catch below instead of during bundle
// bootstrap. Reward sound is a nice-to-have; it must never take down app startup.
export async function preloadRewardSounds(): Promise<void> {
  try {
    const { createAudioPlayer, setAudioModeAsync } = require('expo-audio') as typeof import('expo-audio');
    await setAudioModeAsync({ playsInSilentMode: false });
    if (players) return;
    players = {
      ignite: createAudioPlayer(SOURCES.ignite),
      whoosh: createAudioPlayer(SOURCES.whoosh),
      settle: createAudioPlayer(SOURCES.settle),
      rankup: createAudioPlayer(SOURCES.rankup),
      spark: createAudioPlayer(SOURCES.spark),
      'rankup-bronze': createAudioPlayer(SOURCES['rankup-bronze']),
      'rankup-silver': createAudioPlayer(SOURCES['rankup-silver']),
      'rankup-gold': createAudioPlayer(SOURCES['rankup-gold']),
      'rankup-diamond': createAudioPlayer(SOURCES['rankup-diamond']),
      'rankup-infernal': createAudioPlayer(SOURCES['rankup-infernal']),
      'rankup-riser': createAudioPlayer(SOURCES['rankup-riser']),
    };
    // The riser is a one-shot build cut manually at the flare — never a loop. Set explicitly so it
    // can't replay itself after finishing (the "audio plays multiple times" bug); all the other
    // cues are short one-shots where the default already suffices.
    players['rankup-riser'].loop = false;
  } catch (e) {
    console.warn('[sound] expo-audio unavailable — reward sounds disabled this session:', e);
  }
}

// Fire-and-forget by design — RewardBurst.fire() calls this without awaiting so sound,
// haptic, and animation all kick off on the same synchronous tick. The players are
// preloaded and idle between plays, so seekTo(0) resolves near-instantly; only needed
// because these are shared long-lived players replayed many times, unlike a fresh
// one-shot player that's already at position 0.
export function playRewardSound(cue: RewardCue, volume = 1): void {
  const player = players?.[cue];
  if (!player) return;
  player.volume = volume;
  player.seekTo(0).finally(() => player.play());
}

// Stops a long/still-playing cue mid-flight and rewinds it so the next play starts clean from the
// top — used to cut the rank-up riser at the flare. Safe to call when nothing is playing (pause on
// an idle shared player is a no-op).
export function stopRewardSound(cue: RewardCue): void {
  const player = players?.[cue];
  if (!player) return;
  player.pause();
  player.seekTo(0).catch(() => {});
}
