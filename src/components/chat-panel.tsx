import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { EmptyState } from '@/components/ui/empty-state';
import { TextInput } from '@/components/ui/text-input';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useChat } from '@/hooks/use-chat';
import { deleteMyMessage, sendMessage, type ChatMessage } from '@/lib/api/messages';
import { supabase } from '@/lib/supabase';

function formatRelativeTime(isoDate: string) {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function ChatPanel({ groupId, myUserId }: { groupId: string; myUserId: string }) {
  const router = useRouter();
  const chat = useChat(groupId);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  async function handleSend() {
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    setDraft('');
    try {
      await sendMessage(groupId, myUserId, body);
    } catch {
      setDraft(body);
      Alert.alert('Could not send', 'Try again.');
    } finally {
      setSending(false);
    }
  }

  function handleMore(message: ChatMessage) {
    const isOwn = message.user_id === myUserId;
    const options = isOwn
      ? [
          {
            text: 'Delete',
            style: 'destructive' as const,
            onPress: async () => {
              await deleteMyMessage(message.id);
              chat.refetch();
            },
          },
          { text: 'Cancel', style: 'cancel' as const },
        ]
      : [
          {
            text: 'Report',
            onPress: () => router.push(`/report?messageId=${message.id}&userId=${message.user_id}`),
          },
          {
            text: 'Block user',
            style: 'destructive' as const,
            onPress: async () => {
              await supabase.from('blocked_users').insert({ blocker_id: myUserId, blocked_id: message.user_id });
              chat.refetch();
              Alert.alert('User blocked', "You won't see their messages anymore.");
            },
          },
          { text: 'Cancel', style: 'cancel' as const },
        ];
    Alert.alert(isOwn ? 'Message options' : 'Report or block', '', options);
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
      {chat.error && <Text style={styles.error}>{chat.error}</Text>}

      <FlatList
        data={chat.messages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          !chat.loading ? <EmptyState title="No messages yet" body="Say something to your circle." /> : null
        }
        renderItem={({ item }) => {
          const isOwn = item.user_id === myUserId;
          return (
            <View style={[styles.bubbleRow, isOwn && styles.bubbleRowOwn]}>
              <Pressable
                onLongPress={() => handleMore(item)}
                style={[styles.bubble, isOwn ? styles.bubbleOwn : styles.bubbleOther]}>
                {!isOwn && <Text style={styles.sender}>{item.profiles.display_name}</Text>}
                <Text style={[styles.body, isOwn && styles.bodyOwn]}>{item.body}</Text>
                <Text style={[styles.time, isOwn && styles.timeOwn]}>{formatRelativeTime(item.created_at)}</Text>
              </Pressable>
            </View>
          );
        }}
      />

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          placeholder="Message your circle…"
          value={draft}
          onChangeText={setDraft}
          maxLength={2000}
          multiline
        />
        <Pressable onPress={handleSend} disabled={sending || !draft.trim()} style={styles.sendButton}>
          <Text style={styles.sendLabel}>Send</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  error: {
    fontFamily: Fonts.body,
    color: Colors.coral,
    textAlign: 'center',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
  },
  list: {
    padding: Spacing.four,
    gap: Spacing.two,
  },
  bubbleRow: {
    flexDirection: 'row',
  },
  bubbleRowOwn: {
    justifyContent: 'flex-end',
  },
  bubble: {
    maxWidth: '78%',
    borderRadius: Radius.card,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    gap: 2,
  },
  bubbleOther: {
    backgroundColor: Colors.card,
    borderWidth: 2,
    borderColor: Colors.line,
  },
  bubbleOwn: {
    backgroundColor: Colors.coral,
  },
  sender: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: Colors.muted,
  },
  body: {
    fontFamily: Fonts.body,
    fontSize: 15,
    color: Colors.ink,
  },
  bodyOwn: {
    color: '#FFFFFF',
  },
  time: {
    fontFamily: Fonts.body,
    fontSize: 10,
    color: Colors.muted,
  },
  timeOwn: {
    color: 'rgba(255,255,255,0.75)',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two,
    padding: Spacing.three,
    borderTopWidth: 1,
    borderTopColor: Colors.line,
  },
  input: {
    flex: 1,
    maxHeight: 100,
  },
  sendButton: {
    backgroundColor: Colors.coral,
    borderRadius: Radius.pill,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  sendLabel: {
    fontFamily: Fonts.bodyBold,
    color: '#FFFFFF',
    fontSize: 14,
  },
});
