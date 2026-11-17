import { ChatsHub } from '@/components/chat/chats-hub';
import { GroupRoom } from '@/components/group-room';
import { GYM_SPARK } from '@/constants/feature-flags';
import { GYM_ROOM_ID } from '@/lib/api/gym-spark';

// CHAT (mock 331) — friends, forests and campfires in one conversation list. See
// components/chat/chats-hub.tsx.
//
// THE GYM SPARK (v2 §7): the Chat tab IS the Laurier Gym room and shows nothing else — no DM list, no
// "Group chats live in Rooms" footer. The room renders inline as a tab (components/group-room.tsx with
// `asTab`): GymTopBar on top, the bottom bar under it, no back arrow. DMs moved behind the top bar's ✈
// (/messages). /group/GYM_ROOM_ID redirects here, so pushes and old links land on the tab too.

export default function ChatScreen() {
  return GYM_SPARK ? <GroupRoom groupId={GYM_ROOM_ID} asTab /> : <ChatsHub />;
}
