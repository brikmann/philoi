import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ChatsHub } from '@/components/chat/chats-hub';
import { AppTopBar } from '@/components/nav/app-top-bar';
import { NavGlyph } from '@/components/ui/nav-glyph';
import { GYM_SPARK } from '@/constants/feature-flags';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { useGroup } from '@/hooks/use-group';
import { GYM_ROOM_ID } from '@/lib/api/gym-spark';

// CHAT (mock 331) — friends, forests and campfires in one conversation list. See
// components/chat/chats-hub.tsx.
//
// THE GYM SPARK (spec §5): the bar's Chat slot opens THE gym room directly (/group/GYM_ROOM_ID,
// components/nav/bottom-bar.tsx), so this tab is only reached by an old deep link to /chat. It must not
// show the hub — the hub offers campfire discovery and "start a campfire", both out of the Spark — so
// it shows the one room and a way into it. Deliberately NOT an auto-redirect: Back from the room would
// land here and bounce straight back in, with no way out.

export default function ChatScreen() {
  return GYM_SPARK ? <SparkChat /> : <ChatsHub />;
}

function SparkChat() {
  const router = useRouter();
  const { group } = useGroup(GYM_ROOM_ID);

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <AppTopBar title="Chat" />
      <View style={styles.body}>
        <Pressable
          style={({ pressed }) => [styles.room, pressed && styles.pressed]}
          onPress={() => router.navigate({ pathname: '/group/[groupId]', params: { groupId: GYM_ROOM_ID } })}
          accessibilityRole="button"
          accessibilityLabel={`Open ${group?.name ?? 'the gym chat'}`}>
          <View style={styles.tile}>
            {group?.emoji ? <Text style={styles.emoji}>{group.emoji}</Text> : <NavGlyph name="chat" size={22} color={Colors.navEmber2} />}
          </View>
          <View style={styles.text}>
            <Text style={styles.name} numberOfLines={1}>
              {group?.name ?? 'The gym chat'}
            </Text>
            <Text style={styles.sub}>Everyone at the gym, one room</Text>
          </View>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  body: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two },
  room: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 16,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  pressed: { opacity: 0.7 },
  tile: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: Colors.spacePanel2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoji: { fontSize: 22 },
  text: { flex: 1, gap: 2 },
  name: { fontFamily: Fonts.bodyBold, fontSize: 16, color: Colors.ink },
  sub: { fontFamily: Fonts.body, fontSize: 13, color: Colors.spaceDim },
});
