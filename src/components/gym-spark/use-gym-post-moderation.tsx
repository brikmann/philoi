import { useState } from 'react';
import { Alert } from 'react-native';

import { ReportBlockSheet } from '@/components/report-block-sheet';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { blockAgoraUser, deleteAgoraPost, reportAgora, setMilestoneInAgora } from '@/lib/api/agora';
import { useAuth } from '@/lib/auth/auth-context';
import { getErrorMessage } from '@/lib/errors';
import type { AgoraItem } from '@/types/database';

// THE GYM SPARK · a post's ⋯ — your own post gets Delete, anyone else's gets Report / Block (Apple
// 1.2: every surface that shows UGC needs both). Same calls and copy as agora/[id].tsx's legacy screen.
//
// `onGone(item)` fires when the post should leave the viewer's screen: deleted, reported or its author
// blocked. The feed drops the card; the detail screen goes back.

export function useGymPostModeration(onGone: (item: AgoraItem, reason: 'deleted' | 'reported' | 'blocked') => void) {
  const { profile } = useAuth();
  const [target, setTarget] = useState<AgoraItem | null>(null);
  const [mode, setMode] = useState<'more' | 'remove' | null>(null);
  const [removing, setRemoving] = useState(false);

  function open(item: AgoraItem) {
    setTarget(item);
    setMode(item.user_id === profile?.id ? 'remove' : 'more');
  }

  function close() {
    setMode(null);
  }

  async function handleReport() {
    if (!target || !profile) return;
    try {
      await reportAgora({
        reporterId: profile.id,
        reportedUserId: target.user_id,
        reason: 'Reported from the Agora',
        postId: target.item_type === 'post' ? target.id : null,
      });
      Alert.alert('Reported', 'Thanks — we’ll take a look. You won’t see this post again.');
      onGone(target, 'reported');
    } catch (e) {
      Alert.alert('Could not report', getErrorMessage(e, 'Something went wrong.'));
    }
  }

  async function handleBlock() {
    if (!target || !profile) return;
    try {
      await blockAgoraUser(profile.id, target.user_id);
      onGone(target, 'blocked');
    } catch (e) {
      Alert.alert('Could not block', getErrorMessage(e, 'Something went wrong.'));
    }
  }

  async function confirmRemove() {
    if (!target || removing) return;
    setRemoving(true);
    try {
      if (target.item_type === 'post') await deleteAgoraPost(target.id);
      else await setMilestoneInAgora(target.id, false);
      setMode(null);
      onGone(target, 'deleted');
    } catch (e) {
      setMode(null);
      Alert.alert('Could not remove', getErrorMessage(e, 'Something went wrong.'));
    } finally {
      setRemoving(false);
    }
  }

  const isPost = target?.item_type !== 'milestone';
  const sheets = (
    <>
      <ReportBlockSheet
        visible={mode === 'more'}
        onClose={close}
        onReport={() => void handleReport()}
        onBlock={() => void handleBlock()}
      />
      <ConfirmDialog
        visible={mode === 'remove'}
        title={isPost ? 'Delete this post?' : 'Take this off the feed?'}
        body={isPost ? 'It disappears for everyone.' : 'It stays on your Journal — it just stops showing here.'}
        confirmLabel={isPost ? 'Delete' : 'Remove'}
        busy={removing}
        onCancel={close}
        onConfirm={() => void confirmRemove()}
      />
    </>
  );

  return { open, sheets };
}
