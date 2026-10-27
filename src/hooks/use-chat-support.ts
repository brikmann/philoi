import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';

import { chatMarkRead, chatSupported, chatSupportSnapshot, onChatSupport, type ChatRoomScope } from '@/lib/api/chat';

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
