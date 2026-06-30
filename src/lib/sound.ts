import { useAudioPlayer } from 'expo-audio';

// Tier-1 "Spark" — fires on every check-in. Bloom (streak milestones) and Surge (personal
// records) land in Phase 6 alongside the shared <RewardBurst> wrapper; this is deliberately
// just the sound half for now, played alongside the haptic + scale animation already in
// check-in.tsx.
const SPARK_SOUND = require('../../assets/sounds/spark.wav');

export function useSparkSound() {
  const player = useAudioPlayer(SPARK_SOUND);

  return function playSpark() {
    player.seekTo(0);
    player.play();
  };
}
