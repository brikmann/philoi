import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';

import {
  chatMarkRead,
  chatSetMuted,
  chatSupported,
  chatSupportSnapshot,
  fetchChatMuted,
  onChatSupport,
  type ChatRoomScope,
} from '@/lib/api/chat';
import { getErrorMessage } from '@/lib/errors';

/**
 * Does the server have 0284? `null` while the one per-session probe is in flight.
 *
 * Every screen that grows a chat ability reads this and draws the OLD surface for anything but
 * `true` — so a null (still asking) renders exactly today's app, and a slow probe can only ever
 * upgrade the screen, never take something away from under a thumb.
 */
export function useChatSupport(): boolean | null {
  const [value, setValue] = useState<boolean | null>(chatSupportSnapshot);

  useEffect(() => {
    const off = onChatSupport(setValue);
    let live = true;
    chatSupported().then((v) => {
      if (live) setValue(v);
    });
    return () => {
      live = false;
      off();
    };
  }, []);

  return value;
}

/**
 * Keep a room's 0284 read pointer at "now" while it's on screen: on focus, and again on blur so
 * everything said while you were looking at it doesn't come back as a badge on the Chats list.
 * A no-op without 0284 (chatMarkRead's failure is swallowed — a stale pointer is not an error).
 */
export function useMarkRoomReadWhileFocused(scope: ChatRoomScope, roomId: string | null | undefined, supported: boolean | null) {
  useFocusEffect(
    useCallback(() => {
      if (!supported || !roomId) return;
      chatMarkRead(scope, roomId).catch(() => {});
      return () => {
        chatMarkRead(scope, roomId).catch(() => {});
      };
    }, [scope, roomId, supported])
  );
}

/**
 * A DM's or a forest room's mute bit, and an optimistic toggle for it (0284 · chat_set_muted).
 *
 * `muted` is null until the server has answered — and stays null without 0284 — so a header draws
 * NO button rather than a bell that might be lying. The toggle flips at once and flips back with
 * an alert if the write fails: the bell you just tapped should never sit in a state the server
 * doesn't have.
 *
 * Not for campfires. A campfire's mute is group_members.chat_muted, already switched from the
 * campfire's own options sheet; chat_set_muted('campfire') writes that same column, and a second
 * switch for one setting is exactly what 0284 refused to build.
 */
export function useRoomMute(scope: 'dm' | 'forest', roomId: string | null | undefined, supported: boolean | null) {
  const [state, setState] = useState<{ roomId: string; muted: boolean | null } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (supported !== true || !roomId) return;
    let live = true;
    fetchChatMuted(scope, roomId)
      .then((m) => {
        if (live) setState({ roomId, muted: m });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [scope, roomId, supported]);

  const muted = supported === true && state && state.roomId === roomId ? state.muted : null;

  const toggle = useCallback(async () => {
    if (muted === null || !roomId || busy) return;
    const next = !muted;
    setBusy(true);
    setState({ roomId, muted: next });
    try {
      await chatSetMuted(scope, roomId, next);
    } catch (e) {
      setState({ roomId, muted: !next });
      Alert.alert(next ? 'Could not mute' : 'Could not unmute', getErrorMessage(e, 'Try again.'));
    } finally {
      setBusy(false);
    }
  }, [muted, roomId, busy, scope]);

  return { muted, toggle };
}
