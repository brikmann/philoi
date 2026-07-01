import { useAudioPlayer } from 'expo-audio';

// Tier-1 "Spark" — fires on every check-in. Bloom (streak milestones) and Surge (personal
// records) land in Phase 6 alongside the shared <RewardBurst> wrapper; this is deliberately
// just the sound half for now, played alongside the haptic + scale animation already in
// check-in.tsx.
const SPARK_SOUND = require('../../assets/sounds/spark.wav');

export function useSparkSound() {
  const player = useAudioPlayer(SPARK_SOUND);

  return function playSpark() {
    // A freshly created player is already at position 0 — no need to seek before playing,
    // and seekTo() is async, so firing it without awaiting risked racing play() on a player
    // that wasn't done loading yet.
    player.volume = 1;
    player.play();
  };
}
