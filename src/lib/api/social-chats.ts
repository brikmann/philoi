import { fetchMyDmThreads } from '@/lib/api/dm';
import { fetchMyGroups } from '@/lib/api/groups';
import { supabase } from '@/lib/supabase';

// SOCIAL → CHATS, v1 (mock 320). One list over the chat surfaces that already exist: each campfire's
// group chat (/group/[id] IS the chat) and every 1:1 DM thread (0206). No new model — a persistent
// chat system (threads, members, read state for groups, its own push/moderation) is its own build.
//
// Campfire rows carry no unread count: group chats have no per-member read state today, so the
// row shows the last message and when, and nothing it would have to guess at.

export type SocialChat =
  | {
      kind: 'campfire';
      id: string;
      name: string;
      emoji: string;
      lastAt: string | null;
      lastLine: string | null;
    }
  | {
      kind: 'dm';
      id: string;
      friendId: string;
      name: string;
      avatarUrl: string | null;
      lastAt: string;
      lastLine: string | null;
      unread: number;
    };

/** The newest live message in one campfire, as "Name: text". RLS ("messages: read if member") gates it. */
async function lastCampfireLine(groupId: string): Promise<{ at: string; line: string } | null> {
  const { data, error } = await supabase
    .from('messages')
    // Hinted embed: see fetchMessages in lib/api/messages.ts for why a bare profiles(...) fails.
    .select('body, attach_kind, created_at, profiles!messages_user_id_fkey(display_name)')
    .eq('group_id', groupId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const who = (data.profiles as unknown as { display_name: string } | null)?.display_name ?? 'Someone';
  const said = data.body?.trim() || (data.attach_kind === 'photo' ? '📷 Photo' : data.attach_kind ? '📎 Shared something' : '');
  return { at: data.created_at as string, line: `${who}: ${said}` };
}

/** Campfire chats + DMs, the most recently active first. A failed half degrades to the other half. */
export async function fetchMySocialChats(userId: string): Promise<SocialChat[]> {
  const [groups, threads] = await Promise.all([fetchMyGroups(userId).catch(() => []), fetchMyDmThreads().catch(() => [])]);

  const campfires = await Promise.all(
    groups.map(async (g): Promise<SocialChat> => {
      const last = await lastCampfireLine(g.id);
      return { kind: 'campfire', id: g.id, name: g.name, emoji: g.emoji, lastAt: last?.at ?? null, lastLine: last?.line ?? null };
    })
  );
  const dms: SocialChat[] = threads.map((t) => ({
    kind: 'dm',
    id: t.threadId,
    friendId: t.friendId,
    name: t.displayName,
    avatarUrl: t.avatarUrl,
    lastAt: t.lastMessageAt,
    lastLine: t.lastBody ? `${t.lastSenderId === userId ? 'You: ' : ''}${t.lastBody}` : null,
    unread: t.unread,
  }));

  // A chat nobody has spoken in yet sorts last, by name.
  return [...campfires, ...dms].sort((a, b) => {
    if (a.lastAt && b.lastAt) return b.lastAt.localeCompare(a.lastAt);
    if (a.lastAt || b.lastAt) return a.lastAt ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}
