import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { memo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { feedCardImage } from '@/components/home/home-feed';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { AgoraVideoTile } from '@/components/agora/agora-video-tile';
import { attachmentView, itemAttachments } from '@/lib/agora-attachment';
import { itemVideo } from '@/lib/api/agora-video';
import { useAuth } from '@/lib/auth/auth-context';
import { formatRelativeTime } from '@/lib/format';
import type { AgoraItem } from '@/types/database';

// THE GYM SPARK · one post (mocks 400 + 403). Avatar, name, PR pill, @handle · time, the photo, the
// caption, 💬 count, and on the feed the newest comment ("Dyl: no shot…").
//
// COMMENT-ONLY. No cheer / like / 🔥 control and no 🔥 tally — the 🔥 in mock 400 was the old cheer
// count and the spec drops it ("remove likes entirely"). The server's cheer RPC is untouched for
// installed builds; nothing here calls it.
//
// Deliberately plainer than AgoraCard: no cosmetics, no house seal, no lift breakdown. A lock-in rides
// as one compact chip; the session's detail is one tap away on its own screen.

/** The feed row (GymFeedItem) or a bare AgoraItem from get_agora_item (detail), which has no is_pr. */
export type GymPostItem = AgoraItem & {
  is_pr?: boolean;
  top_comment_name?: string | null;
  top_comment_body?: string | null;
};

/** "12m" rather than "12m ago" — the mock's tighter meta line. */
export function shortTime(iso: string): string {
  return formatRelativeTime(iso).replace(/ ago$/, '');
}

const AVATAR_TINTS = ['#FF8A3D', '#3FD0D8', '#A78BFA', '#34D399', '#F472B6', '#FBBF24'];

function tintFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return AVATAR_TINTS[Math.abs(h) % AVATAR_TINTS.length];
}

export function GymAvatar({
  userId,
  name,
  url,
  size,
}: {
  userId: string;
  name: string;
  url: string | null;
  size: number;
}) {
  const box = { width: size, height: size, borderRadius: size / 2 };
  if (url) return <Image source={{ uri: url }} style={[box, styles.avatarImg]} contentFit="cover" />;
  return (
    <View style={[box, styles.avatarFallback, { backgroundColor: tintFor(userId) }]}>
      <Text style={[styles.avatarInitial, { fontSize: size * 0.4 }]}>{name.charAt(0).toUpperCase()}</Text>
    </View>
  );
}

export function PrPill() {
  return (
    <View style={styles.pr} accessibilityLabel="Personal record">
      <Text style={styles.prText}>PR</Text>
    </View>
  );
}

type Props = {
  item: GymPostItem;
  /** 'feed' = bordered card, tappable to detail, shows the top comment. 'detail' = flat, no tap. */
  variant: 'feed' | 'detail';
  /** Shown as a PR even when the row itself doesn't say so (detail opened from a PR card). */
  forcePr?: boolean;
  onMore: (item: GymPostItem) => void;
  /**
   * A sibling action drawn right after the PR pill (e.g. a story-share button for a PR). Rendered only
   * when the post is a PR. Callers: gym-feed-screen.tsx (renderItem) and gym-post-screen.tsx (header).
   */
  prAccessory?: ReactNode;
};

function GymPostCardInner({ item, variant, forcePr = false, onMore, prAccessory }: Props) {
  const router = useRouter();
  const { session } = useAuth();
  const [photoFailed, setPhotoFailed] = useState(false);

  const feed = variant === 'feed';
  const photo = photoFailed ? null : feedCardImage(item);
  const video = itemVideo(item);
  const mine = item.user_id === session?.user.id;
  const isPr = forcePr || item.is_pr === true;
  const lockin = itemAttachments(item).find((a) => a.kind === 'lockin');
  const lockinView = lockin ? attachmentView(lockin.kind, lockin.snapshot) : null;

  function openDetail() {
    const params: { id: string; type: string; pr?: string } = { id: item.id, type: item.item_type };
    if (isPr) params.pr = '1';
    router.push({ pathname: '/agora/[id]', params });
  }

  function openAuthor() {
    if (item.user_id === session?.user.id) router.push('/profile');
    else router.push({ pathname: '/friend-profile', params: { userId: item.user_id } });
  }

  function openSession() {
    if (lockinView?.route) router.push(lockinView.route as never);
    else if (feed) openDetail();
  }

  const content = (
    <>
      <View style={[styles.head, feed && styles.headPadded]}>
        <Pressable onPress={openAuthor} hitSlop={6} accessibilityRole="button" accessibilityLabel={item.display_name}>
          <GymAvatar userId={item.user_id} name={item.display_name} url={item.avatar_url} size={46} />
        </Pressable>
        <View style={styles.headText}>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={1}>
              {item.display_name}
            </Text>
            {isPr ? <PrPill /> : null}
            {/* PR ACCESSORY SLOT — e.g. <PrStoryButton item={item} />, passed in via `prAccessory`. */}
            {isPr && prAccessory ? prAccessory : null}
          </View>
          <Text style={styles.meta} numberOfLines={1}>
            {item.handle ? `@${item.handle} · ` : ''}
            {shortTime(item.created_at)}
          </Text>
        </View>
        <Pressable onPress={() => onMore(item)} hitSlop={10} accessibilityRole="button" accessibilityLabel="More options">
          <Ionicons name="ellipsis-horizontal" size={18} color={Colors.textTertiary} />
        </Pressable>
      </View>

      {photo ? (
        <Image
          source={{ uri: photo }}
          style={feed ? styles.photoFeed : styles.photoDetail}
          contentFit="cover"
          transition={120}
          onError={() => setPhotoFailed(true)}
        />
      ) : null}

      {/* A clip (0279): poster + tap-to-play, signed per viewer. Someone else's carries the report flag. */}
      {video ? (
        <View style={feed ? styles.videoFeed : undefined}>
          <AgoraVideoTile postId={item.id} video={video} onReport={mine ? undefined : () => onMore(item)} />
        </View>
      ) : null}

      <View style={feed ? styles.footPadded : styles.foot}>
        {lockinView ? (
          <Pressable style={styles.session} onPress={openSession} accessibilityRole="button">
            <Ionicons name={lockinView.icon} size={13} color={Colors.navEmber2} />
            <Text style={styles.sessionText} numberOfLines={1}>
              {lockinView.title}
              {lockinView.subtitle ? ` · ${lockinView.subtitle}` : ''}
            </Text>
          </Pressable>
        ) : null}

        {item.body ? (
          <Text style={styles.body} numberOfLines={feed ? 6 : undefined}>
            {item.body}
          </Text>
        ) : null}

        <View style={styles.counts}>
          <Ionicons name="chatbubble-outline" size={14} color={Colors.muted} />
          <Text style={styles.count}>{item.comments}</Text>
        </View>

        {feed && item.top_comment_body ? (
          <Text style={styles.topComment} numberOfLines={2}>
            <Text style={styles.topCommentName}>{item.top_comment_name ?? 'Someone'}: </Text>
            {item.top_comment_body}
          </Text>
        ) : null}
      </View>
    </>
  );

  if (!feed) return <View>{content}</View>;
  return (
    <Pressable
      style={styles.card}
      onPress={openDetail}
      accessibilityRole="button"
      accessibilityHint="Opens the post and its comments">
      {content}
    </Pressable>
  );
}

// The feed patches comment counts and top-comment previews on refresh; those are the fields that move
// under a stable id.
export const GymPostCard = memo(
  GymPostCardInner,
  (a, b) =>
    a.item.id === b.item.id &&
    a.item.comments === b.item.comments &&
    a.item.is_pr === b.item.is_pr &&
    a.item.body === b.item.body &&
    a.item.top_comment_body === b.item.top_comment_body &&
    a.item.top_comment_name === b.item.top_comment_name &&
    a.variant === b.variant &&
    a.forcePr === b.forcePr &&
    a.prAccessory === b.prAccessory &&
    a.onMore === b.onMore
);

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.cardDark,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    overflow: 'hidden',
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.twelve,
  },
  headPadded: {
    padding: Spacing.three,
  },
  headText: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  name: {
    flexShrink: 1,
    fontFamily: Fonts.bodyBold,
    fontSize: 16,
    color: Colors.ink,
  },
  meta: {
    marginTop: 1,
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.spaceDim,
  },
  avatarImg: {
    backgroundColor: Colors.spacePanel2,
  },
  avatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontFamily: Fonts.bodyBold,
    color: '#1A1030',
  },
  pr: {
    borderRadius: Radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 1,
    backgroundColor: Colors.navEmber2,
  },
  prText: {
    fontFamily: Fonts.black,
    fontSize: 11,
    letterSpacing: 0.4,
    color: '#1A1030',
  },
  photoFeed: {
    width: '100%',
    aspectRatio: 1.45,
    backgroundColor: Colors.spacePanel2,
  },
  photoDetail: {
    width: '100%',
    aspectRatio: 1.6,
    marginTop: Spacing.twelve,
    borderRadius: 18,
    backgroundColor: Colors.spacePanel2,
  },
  videoFeed: {
    paddingHorizontal: Spacing.three,
  },
  foot: {
    paddingTop: Spacing.twelve,
  },
  footPadded: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.twelve,
    paddingBottom: Spacing.three,
  },
  session: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    maxWidth: '100%',
    marginBottom: Spacing.two,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Radius.pill,
    backgroundColor: Colors.spacePanel2,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  sessionText: {
    flexShrink: 1,
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.ink,
  },
  body: {
    fontFamily: Fonts.body,
    fontSize: 15.5,
    lineHeight: 22,
    color: Colors.ink,
  },
  counts: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: Spacing.twelve,
  },
  count: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.muted,
    fontVariant: ['tabular-nums'],
  },
  topComment: {
    marginTop: Spacing.two,
    fontFamily: Fonts.body,
    fontSize: 13.5,
    lineHeight: 19,
    color: Colors.muted,
  },
  topCommentName: {
    fontFamily: Fonts.bodyBold,
    color: Colors.ink,
  },
});
