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
  | 'rankup-olympian'
  | 'rankup-primordial'
  | 'rankup-riser'
  // The Victory Anthem (RANKUP_SPEC §3) — the two band crossings ONLY. Pre-mixed by hand from the
  // Pixabay layers in RANKUP_AUDIO_SOURCES.md; see ASCENSION_SOURCES below for why these aren't
  // required yet.
  | 'ascension-hero'
  | 'ascension-primordial';

// The rank-up riser build (PHILOI_UI_SPEC.md §11/§22) — a long swell that runs the length of the
// forge and is cut at the flare so it resolves *into* the per-tier hit rather than competing with
// it (see rank-up-celebration.tsx's timing). Two alternate cuts sit beside it in assets/sounds/;
// switch the primary by pointing this one constant at another file — nothing else changes.
const RANKUP_RISER_SOURCE = require('../../assets/sounds/rankup-riser.wav');
// Swappable alternates: '../../assets/sounds/rankup-riser-wildfire.wav'
//                       '../../assets/sounds/rankup-riser-drone.wav'

// Cues whose asset hasn't been mixed yet (RANKUP_AUDIO_SOURCES.md — Noah pre-mixes each rank from
// the Pixabay component clips and drops the result in assets/audio/rank/).
//
// Deliberately NOT a `require()` of a not-yet-existing path: Metro resolves require() at BUNDLE
// time, so a missing file is a hard bundler failure — the app wouldn't build at all, which is the
// opposite of "no-op gracefully if a file is missing". An absent entry here means playRewardSound
// finds no player and returns silently, which is exactly the graceful path.
//
// TO ACTIVATE: drop the mixed file in, then uncomment its line. Nothing else changes — the cue
// names, the tier mapping (ASCENSION_CUE_BY_TIER in reward-feedback.ts) and the playback call are
// already wired and will start producing sound the moment a source appears.
//
//   assets/audio/rank/ascension-hero.m4a        → Diamond I → Hero III  (war-horn + shield-bash)
//   assets/audio/rank/ascension-primordial.m4a  → Immortal I → Primordial (vacuum → plasma → drop)
const ASCENSION_SOURCES: Partial<Record<RewardCue, number>> = {
  // 'ascension-hero': require('../../assets/audio/rank/ascension-hero.m4a'),
  // 'ascension-primordial': require('../../assets/audio/rank/ascension-primordial.m4a'),
};

const SOURCES: Omit<Record<RewardCue, number>, 'ascension-hero' | 'ascension-primordial'> = {
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
  // rankup-diamond-sparkle.wav shipped alongside the others but was never wired up; the four
  // legend tiers (hero/titan/olympian/immortal) have no bespoke audio yet, so Olympian claims
  // this bright celestial one and the rest fall back to the generic 'rankup' hit — see
  // RANKUP_CUE_BY_TIER in reward-feedback.ts. Worth commissioning dedicated cues before launch.
  'rankup-olympian': require('../../assets/sounds/rankup-diamond-sparkle.wav'), // bright celestial sparkle
  // The apex keeps its original molten recording — the asset was renamed alongside the tier so
  // nothing in the tree still carries the old name.
  'rankup-primordial': require('../../assets/sounds/rankup-primordial.wav'), // mean guitar riff
  'rankup-riser': RANKUP_RISER_SOURCE, // the forge build, cut at the flare
};

// Partial: the ascension cues only get a player once their asset lands (see ASCENSION_SOURCES).
let players: Partial<Record<RewardCue, AudioPlayer>> | null = null;

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
      'rankup-olympian': createAudioPlayer(SOURCES['rankup-olympian']),
      'rankup-primordial': createAudioPlayer(SOURCES['rankup-primordial']),
      'rankup-riser': createAudioPlayer(SOURCES['rankup-riser']),
    };
    // Any ascension mix that has actually been dropped in. Absent = that cue stays silent.
    for (const [cue, source] of Object.entries(ASCENSION_SOURCES)) {
      if (source !== undefined) players[cue as RewardCue] = createAudioPlayer(source);
    }
    // The riser is a one-shot build cut manually at the flare — never a loop. Set explicitly so it
    // can't replay itself after finishing (the "audio plays multiple times" bug); all the other
    // cues are short one-shots where the default already suffices.
    // Non-null: created unconditionally just above. `players` is Partial only because the optional
    // ascension mixes may be absent.
    players['rankup-riser']!.loop = false;
  } catch (e) {
    console.warn('[sound] expo-audio unavailable — reward sounds disabled this session:', e);
  }
}

// Fire-and-forget by design — RewardBurst.fire() calls this without awaiting so sound,
// haptic, and animation all kick off on the same synchronous tick. The players are
// preloaded and idle between plays, so seekTo(0) resolves near-instantly; only needed
// because these are shared long-lived players replayed many times, unlike a fresh
// one-shot player that's already at position 0.
/** Whether a cue actually has a loaded player. Lets a caller pick a different arrangement when an
 * optional asset (the ascension mixes) hasn't been dropped in yet, instead of silently playing
 * nothing — see fireRankUp's anthem branch. */
export function hasRewardSound(cue: RewardCue): boolean {
  return Boolean(players?.[cue]);
}

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
