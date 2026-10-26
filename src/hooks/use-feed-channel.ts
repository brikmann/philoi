import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { track } from '@/lib/analytics';
import { AGORA_SCOPES } from '@/lib/api/agora';
import { channelKey, fetchMyFeedChannels, parseFeedKey, type FeedChannel, type FeedKey } from '@/lib/api/feed-channels';
import { useAuth } from '@/lib/auth/auth-context';

// WHICH CHANNEL THE FEED IS ON (0277, mock 315) — a scope, or one of your campfires/forests.
//
// The immersive Home feed (mock 317) and the classic /agora list both carry the same chip row, so
// the remembering lives here, under the SAME storage key the Agora screen writes: pick a campfire
// on one and the other opens on it too.

const SCOPE_KEYS = new Set<string>(AGORA_SCOPES.map((s) => s.key));
const lastChannelKey = (userId: string) => `philoi_feed_channel_${userId}`;

/** A key that names a scope, or a well-formed campfire/forest channel — anything else is dropped. */
export function asFeedKey(raw: string | null | undefined): FeedKey | null {
  if (!raw) return null;
  if (SCOPE_KEYS.has(raw)) return raw as FeedKey;
  return parseFeedKey(raw as FeedKey) ? (raw as FeedKey) : null;
}

export function useFeedChannel({
  requestedChannel,
  onRequestedChannelSeen,
}: {
  /** Open on this channel ("campfire:<id>") — a campfire screen's posts button, via Home's params. */
  requestedChannel?: string;
  /** Called once a requested channel has been applied, so the caller can clear its param. */
  onRequestedChannelSeen?: () => void;
} = {}) {
  const { profile } = useAuth();
  const userId = profile?.id ?? null;
  const [scope, setScope] = useState<FeedKey>('all');
  const [channels, setChannels] = useState<FeedChannel[] | null>(null);
  const channel = channels?.find((c) => channelKey(c) === scope) ?? null;

  // On focus, so a campfire joined (or left) elsewhere is right when you come back.
  useFocusEffect(
    useCallback(() => {
      let live = true;
      fetchMyFeedChannels()
        .then((rows) => {
          if (live) setChannels(rows);
        })
        .catch(() => {
          // The scopes still work; the row just carries no channels this time.
          if (live) setChannels((prev) => prev ?? []);
        });
      return () => {
        live = false;
      };
    }, [])
  );

  // The last channel you were on, per account. Read once; written by changeScope.
  const restored = useRef(false);
  useEffect(() => {
    if (!userId || restored.current) return;
    restored.current = true;
    AsyncStorage.getItem(lastChannelKey(userId))
      .then((raw) => {
        const key = asFeedKey(raw);
        // A request (a campfire's posts button) outranks the remembered pick.
        if (key && !requestedChannel) setScope(key);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per account; the request has its own effect
  }, [userId]);

  // A remembered or requested channel you're no longer in (left the campfire) falls back to All (0280's default).
  useEffect(() => {
    if (channels && parseFeedKey(scope) && !channel) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reconciling against the server's list
      setScope('all');
    }
  }, [channels, channel, scope]);

  // A campfire screen's "posts" button: open on that channel, then let the caller clear the param.
  useEffect(() => {
    const key = asFeedKey(requestedChannel);
    if (!key) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- driven by a route param, applied once
    setScope(key);
    onRequestedChannelSeen?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the callback is a fresh closure each render
  }, [requestedChannel]);

  const scopeRef = useRef(scope);
  useEffect(() => {
    scopeRef.current = scope;
  }, [scope]);

  const changeScope = useCallback(
    (next: FeedKey) => {
      if (next === scopeRef.current) return;
      setScope(next);
      // The channel id is not tracked — only which kind of thing was picked.
      track('agora_scope_changed', { scope: parseFeedKey(next)?.kind ?? next });
      if (userId) AsyncStorage.setItem(lastChannelKey(userId), next).catch(() => {});
    },
    [userId]
  );

  return { scope, changeScope, channels, channel };
}
