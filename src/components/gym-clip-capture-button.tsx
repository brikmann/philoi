import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet } from 'react-native';

import { GymClipRecorder } from '@/components/gym-clip-recorder';
import { Colors, Radius } from '@/constants/theme';
import { removeWorkoutSetClip } from '@/lib/api/gym-clips';
import { getErrorMessage } from '@/lib/errors';
import type { WorkoutSet, WorkoutSetClipRefs } from '@/types/database';

/** Only what this control actually reads. The live session logger holds the trimmed set shape
 * get_active_workout() returns, not a full workout_sets row, so requiring the whole thing here
 * would force a pointless refetch just to render a camera icon. */
type ClipTargetSet = Pick<WorkoutSet, 'id' | 'video_key'>;

type GymClipCaptureButtonProps = {
  set: ClipTargetSet;
  /** Opens the recorder immediately, framed as "Film this PR?" — the auto-prompt trigger
   * (PHILOI_UI_SPEC.md §23) for a set that just beat the stored best. Fire this once, right
   * after logging a set whose response came back with is_pr: true. */
  autoPromptPr?: boolean;
  /** The clip references after the change — attached (from attach_workout_set_clip's returned
   * row) or cleared. Both keys null means "this set no longer has a clip". */
  onChanged: (refs: WorkoutSetClipRefs) => void;
};

// The small per-set camera affordance (PHILOI_UI_SPEC.md §23) — drop one of these into each row
// of the session logger. Never auto-films: this is either a manual tap, or the caller passing
// autoPromptPr right after a PR set is banked. One clip per set — already-captured shows a
// checkmark (tap to re-record) instead of a bare camera icon.
export function GymClipCaptureButton({ set, autoPromptPr, onChanged }: GymClipCaptureButtonProps) {
  const [recorderOpen, setRecorderOpen] = useState(false);
  const [promptedThisSet, setPromptedThisSet] = useState(false);

  useEffect(() => {
    if (autoPromptPr && !promptedThisSet && !set.video_key) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time auto-open on a fresh PR, not a render-loop risk
      setPromptedThisSet(true);
      setRecorderOpen(true);
    }
  }, [autoPromptPr, promptedThisSet, set.video_key]);

  function handlePress() {
    if (set.video_key) {
      Alert.alert('Set clip', undefined, [
        { text: 'Re-record', onPress: () => setRecorderOpen(true) },
        {
          text: 'Remove clip',
          style: 'destructive',
          onPress: async () => {
            try {
              await removeWorkoutSetClip(set.id);
              onChanged({ id: set.id, video_key: null, thumb_key: null });
            } catch (e) {
              Alert.alert('Could not remove clip', getErrorMessage(e, 'Try again.'));
            }
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ]);
      return;
    }
    setRecorderOpen(true);
  }

  return (
    <>
      <Pressable style={styles.btn} onPress={handlePress} hitSlop={8} accessibilityLabel={set.video_key ? 'Set clip options' : 'Film this set'}>
        <Ionicons name={set.video_key ? 'checkmark-circle' : 'camera-outline'} size={16} color={set.video_key ? Colors.green : Colors.muted} />
      </Pressable>

      <GymClipRecorder
        visible={recorderOpen}
        workoutSetId={set.id}
        isPrPrompt={autoPromptPr && !set.video_key}
        onClose={() => setRecorderOpen(false)}
        onCaptured={(updated) => {
          setRecorderOpen(false);
          onChanged({ id: updated.id, video_key: updated.video_key, thumb_key: updated.thumb_key });
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: 28,
    height: 28,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.disabled,
  },
});
