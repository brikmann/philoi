import { Redirect, Stack, useLocalSearchParams } from 'expo-router';

import { GroupRoom } from '@/components/group-room';
import { GYM_SPARK } from '@/constants/feature-flags';
import { GYM_ROOM_ID } from '@/lib/api/gym-spark';

// THE CAMPFIRE screen route. The screen itself lives in components/group-room.tsx so THE GYM SPARK's
// Chat tab can render the same room inline.
//
// THE GYM SPARK (v2 §7): the Laurier Gym room IS the Chat tab, so a deep link / push / old link to
// /group/GYM_ROOM_ID lands on the tab (bottom bar up, global top bar, no back-arrow dead end) instead
// of stacking a second copy of the room above it. Off the flag, or for any other campfire, unchanged.

export default function GroupScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  if (GYM_SPARK && groupId === GYM_ROOM_ID) return <Redirect href="/chat" />;
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <GroupRoom groupId={groupId} />
    </>
  );
}
