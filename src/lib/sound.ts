import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';

export type RewardTier = 'spark' | 'bloom' | 'surge';

const SOURCES: Record<RewardTier, number> = {
  spark: require('../../assets/sounds/spark.wav'),
  bloom: require('../../assets/sounds/bloom.wav'),
  surge: require('../../assets/sounds/surge.wav'),
};

let players: Record<RewardTier, AudioPlayer> | null = null;

// Preloads all three reward sounds once at app start (see _layout.tsx) so the very first
// check-in has zero playback latency, and configures the audio session to respect the
// phone's silent/vibrate switch — expo-audio's default (playsInSilentMode: true) overrides
// it, which is the opposite of what "respect silent mode" means here.
export async function preloadRewardSounds(): Promise<void> {
  await setAudioModeAsync({ playsInSilentMode: false });
  if (players) return;
  players = {
    spark: createAudioPlayer(SOURCES.spark),
    bloom: createAudioPlayer(SOURCES.bloom),
    surge: createAudioPlayer(SOURCES.surge),
  };
}

// Fire-and-forget by design — RewardBurst.fire() calls this without awaiting so sound,
// haptic, and animation all kick off on the same synchronous tick. The players are
// preloaded and idle between plays, so seekTo(0) resolves near-instantly; only needed
// because these are shared long-lived players replayed many times, unlike a fresh
// one-shot player that's already at position 0.
export function playRewardSound(tier: RewardTier): void {
  const player = players?.[tier];
  if (!player) return;
  player.volume = 1;
  player.seekTo(0).finally(() => player.play());
}
