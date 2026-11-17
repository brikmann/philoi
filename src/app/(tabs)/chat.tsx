import { ChatsHub } from '@/components/chat/chats-hub';
import { GymChatList } from '@/components/gym-spark/gym-chat-list';
import { GYM_SPARK } from '@/constants/feature-flags';

// CHAT (mock 331) — friends, forests and campfires in one conversation list. See
// components/chat/chats-hub.tsx.
//
// THE GYM SPARK (v2-fixes §4): the Chat tab is a chat LIST — GymTopBar, the Laurier Gym room pinned
// first, then your DMs / other conversations (components/gym-spark/gym-chat-list.tsx, built on
// ChatsHub's data + rows). The gym row pushes /group/GYM_ROOM_ID as a normal room screen with a back
// arrow. (v2 §7 had made this tab the room itself, inline — that hid everyone you'd want to DM.)

export default function ChatScreen() {
  return GYM_SPARK ? <GymChatList /> : <ChatsHub />;
}
