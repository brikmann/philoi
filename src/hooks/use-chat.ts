import { useCallback, useEffect, useState } from 'react';

import { fetchMessages, subscribeToMessages, type ChatMessage } from '@/lib/api/messages';
import { getErrorMessage } from '@/lib/errors';

export function useChat(groupId: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    try {
      setError(null);
      setMessages(await fetchMessages(groupId));
    } catch (e) {
      setError(getErrorMessage(e, 'Could not load chat.'));
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount, no caching layer to defer to
    refetch();
  }, [refetch]);

  useEffect(() => {
    return subscribeToMessages(groupId, refetch);
  }, [groupId, refetch]);

  return { messages, loading, error, refetch };
}
