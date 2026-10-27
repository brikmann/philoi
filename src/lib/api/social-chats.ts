import type { IconName } from '@/components/ui/icon';
import { fetchMyDmThreads } from '@/lib/api/dm';
import { fetchMyFeedChannels } from '@/lib/api/feed-channels';
import { fetchMyGroups } from '@/lib/api/groups';
import { supabase } from '@/lib/supabase';

// SOCIAL → CHATS, v1 (mock 320). One list over the chat surfaces that already exist: each campfire's
// group chat (/group/[id] IS the chat) and every 1:1 DM thread (0206). No new model — a persistent
// chat system (threads, members, read state for groups, its own push/moderation) is its own build.
//
// Forest rows are the forests you're in (get_my_feed_channels). A forest has no chat of its own
// until 0284 lands, so its row opens the forest — its posts are its conversation today — and shows
// its newest post time rather than a message line.
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
      /** Drawn before lastLine when the last message was a photo / attachment rather than words. */
      lastIcon: IconName | null;
      /** 0284's chat_reads pointer. Absent on the pre-0284 path, which has no read state for a room. */
      unread?: number;
      muted?: boolean;
    }
  | {
      kind: 'forest';
      id: string;
      name: string;
      emoji: string;
      memberCount: number;
      lastAt: string | null;
      /** 0284 · the room chat's newest line, when forests have one. Absent = the row says its member count. */
      lastLine?: string | null;
      lastIcon?: IconName | null;
      unread?: number;
      muted?: boolean;
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
      muted?: boolean;
    };

/** The newest live message in one campfire, as "Name: text". RLS ("messages: read if member") gates it. */
async function lastCampfireLine(groupId: string): Promise<{ at: string; line: string; icon: IconName | null } | null> {
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
  const body = data.body?.trim();
  const said = body || (data.attach_kind === 'photo' ? 'Photo' : data.attach_kind ? 'Shared something' : '');
  const icon: IconName | null = body ? null : data.attach_kind === 'photo' ? 'photo' : data.attach_kind ? 'clip' : null;
  return { at: data.created_at as string, line: `${who}: ${said}`, icon };
}

/** Campfire chats + forests + DMs, the most recently active first. A failed half degrades to the other half. */
export async function fetchMySocialChats(userId: string): Promise<SocialChat[]> {
  const [groups, threads, channels] = await Promise.all([
    fetchMyGroups(userId).catch(() => []),
    fetchMyDmThreads().catch(() => []),
    fetchMyFeedChannels().catch(() => []),
  ]);

  const campfires = await Promise.all(
    groups.map(async (g): Promise<SocialChat> => {
      const last = await lastCampfireLine(g.id);
      return {
        kind: 'campfire',
        id: g.id,
        name: g.name,
        emoji: g.emoji,
        lastAt: last?.at ?? null,
        lastLine: last?.line ?? null,
        lastIcon: last?.icon ?? null,
      };
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

  const forests: SocialChat[] = channels
    .filter((c) => c.kind === 'forest')
    .map((c) => ({ kind: 'forest', id: c.id, name: c.name, emoji: c.emoji, memberCount: c.member_count, lastAt: c.last_post_at }));

  // A chat nobody has spoken in yet sorts last, by name.
  return [...campfires, ...forests, ...dms].sort((a, b) => {
    if (a.lastAt && b.lastAt) return b.lastAt.localeCompare(a.lastAt);
    if (a.lastAt || b.lastAt) return a.lastAt ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}
