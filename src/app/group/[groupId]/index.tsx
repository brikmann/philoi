import { Stack, useLocalSearchParams } from 'expo-router';

import { GroupRoom } from '@/components/group-room';

// THE CAMPFIRE screen route. The screen itself lives in components/group-room.tsx.
//
// THE GYM SPARK (v2-fixes §4): the Laurier Gym room opens here too, as a normal pushed screen with a
// back arrow — the Chat tab is now a list with the gym room pinned first (v2 §7's redirect of
// /group/GYM_ROOM_ID to /chat is gone, since /chat is no longer the room).

export default function GroupScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <GroupRoom groupId={groupId} />
    </>
  );
}
