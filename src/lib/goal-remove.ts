import { Alert } from 'react-native';

import { archiveGoal } from '@/lib/api/goals';
import { getErrorMessage } from '@/lib/errors';
import type { Goal } from '@/types/database';

/**
 * "Delete" on a goal you made (pre-submission C8) — the Lock In tab's goal row and the goal picker
 * both ask through this, so they say and do the same thing.
 *
 * It ARCHIVES rather than deletes: archived_at drops the goal from fetchMyGoals — every goal list,
 * and anything that counts toward it — on every device, while the sessions already logged under it
 * keep their history. goals has no delete policy for exactly that reason (0002); "goals: update
 * own" is what lets this write.
 *
 * `onRemoved` fires on confirm, before the write lands, so the caller can drop the chip at once;
 * `onFailed` fires if the write is refused, so the caller can re-read its list.
 */
export function confirmRemoveGoal(goal: Goal, { onRemoved, onFailed }: { onRemoved: () => void; onFailed: () => void }) {
  const label = (goal.label ?? '').trim();
  Alert.alert(`Delete “${label}”?`, 'It comes off your goals and stops tracking. Sessions you already logged stay in your history.', [
    { text: 'Cancel', style: 'cancel' },
    {
      text: 'Delete',
      style: 'destructive',
      onPress: () => {
        onRemoved();
        archiveGoal(goal.id, goal.type).catch((e) => {
          onFailed();
          Alert.alert('Could not delete', getErrorMessage(e, 'Something went wrong.'));
        });
      },
    },
  ]);
}
