import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { memo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { EquippedAvatarHalo, EquippedCardBackdrop } from '@/components/economy/applied-art';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import type { PublicLoadout } from '@/hooks/use-public-loadouts';
import { attachmentKey, attachmentView, itemAttachments } from '@/lib/agora-attachment';
import type { AgoraAttachmentView } from '@/lib/agora-attachment';
import { agoraPhotoUrl } from '@/lib/api/agora';
import { formatRelativeTime } from '@/lib/format';
import { RANK_TIER_METAL, formatRankTier } from '@/lib/rank-tiers';
import type { AgoraItem } from '@/types/database';

// One card in the square (mock 162 panel 1). Renders both feed row types — a freeform post and a
// milestone that auto-surfaced — because to a reader they are the same object: somebody did a
// thing, here is what it was, here is how to cheer it and talk about it.
//
// AUTHOR COSMETICS. "Post authors render their equipped cosmetics — halo ring, flex background
// card. Another reason to grind." That art is `applied-art.tsx` (Agent 4's surface); this file
// only calls it, and passes the ids the batched `usePublicLoadouts` read already fetched for the
// whole page.
//
// MEDIA STACKS. A post can carry a photo and a lock-in and a reward at once (migration 0140), so
// the attachment is a LIST here, drawn in ATTACH_ORDER. Milestone rows arrive as a one-element
// list, and a post written before 0140 is normalised into one by `itemAttachments` — there is no
// second rendering path for the old shape to fall down.

/** "Hero II", tinted with its own metal. Null for anyone who hasn't ranked yet. */
function rankLabel(item: AgoraItem): { label: string; color: string } | null {
  const tier = item.rank_tier;
  if (!tier || !RANK_TIER_METAL[tier]) return null;
  return {
    label: formatRankTier(tier, item.rank_division ?? 1),
    color: RANK_TIER_METAL[tier].text,
  };
}

const AVATAR = 38;

type Props = {
  item: AgoraItem;
  loadout: PublicLoadout;
  onCheer: (item: AgoraItem) => void;
  onComment: (item: AgoraItem) => void;
  onMore: (item: AgoraItem) => void;
};

function AgoraCardInner({ item, loadout, onCheer, onComment, onMore }: Props) {
  const router = useRouter();
  const [photoFailed, setPhotoFailed] = useState(false);

  const attachments = itemAttachments(item);
  const rank = rankLabel(item);
  const photo = photoFailed ? null : agoraPhotoUrl(item.photo_path);

  function openAuthor() {
    router.push({ pathname: '/friend-profile', params: { userId: item.user_id } });
  }

  function openAttachment(view: AgoraAttachmentView) {
    // Spec: "Feed item routes to the underlying thing (relic → inventory, challenge → board)."
    // PER ATTACHMENT, not per card: on a post carrying a lock-in and a relic, tapping the relic
    // must not open the session. One with nothing to route to falls through to the comments,
    // which is the other thing someone tapping a card is plausibly reaching for.
    if (view.route) router.push(view.route as never);
    else onComment(item);
  }

  return (
    <CardSurface cardId={loadout.card?.id}>
      <View style={styles.head}>
        <Pressable onPress={openAuthor} hitSlop={6} accessibilityRole="button">
          <EquippedAvatarHalo haloId={loadout.halo?.id} size={AVATAR}>
            {item.avatar_url ? (
              <Image source={{ uri: item.avatar_url }} style={styles.avatar} contentFit="cover" />
            ) : (
              <View style={[styles.avatar, styles.avatarFallback]}>
                <Text style={styles.avatarInitial}>{item.display_name.charAt(0).toUpperCase()}</Text>
              </View>
            )}
          </EquippedAvatarHalo>
        </Pressable>

        <Pressable style={styles.headText} onPress={openAuthor} accessibilityRole="button">
          <Text style={styles.name} numberOfLines={1}>
            {item.display_name}
            {item.handle ? <Text style={styles.handle}> @{item.handle}</Text> : null}
          </Text>
          <View style={styles.metaRow}>
            <Text style={styles.time}>{formatRelativeTime(item.created_at)}</Text>
            {rank ? <Text style={[styles.rank, { color: rank.color }]}>· {rank.label}</Text> : null}
            {item.university ? (
              <View style={styles.uniPill}>
                <Text style={styles.uniPillText} numberOfLines={1}>
                  {item.university}
                </Text>
              </View>
            ) : null}
          </View>
        </Pressable>

        <Pressable onPress={() => onMore(item)} hitSlop={10} accessibilityLabel="More options">
          <Ionicons name="ellipsis-horizontal" size={18} color={Colors.textTertiary} />
        </Pressable>
      </View>

      {attachments.map((a) => {
        const view = attachmentView(a.kind, a.snapshot);
        if (!view) return null;
        return (
          <AttachmentRow key={attachmentKey(a)} view={view} onPress={() => openAttachment(view)} />
        );
      })}

      {item.body ? <Text style={styles.body}>{item.body}</Text> : null}

      {photo ? (
        <Image
          source={{ uri: photo }}
          style={styles.photo}
          contentFit="cover"
          transition={120}
          // A dead path must not leave a grey slab where a photo was — the rest of the card is
          // still a real post and should read as one.
          onError={() => setPhotoFailed(true)}
        />
      ) : null}

      <View style={styles.actions}>
        <Pressable
          style={styles.action}
          onPress={() => onCheer(item)}
          disabled={item.cheered}
          accessibilityRole="button"
          accessibilityLabel={item.cheered ? 'Already cheered' : 'Cheer'}>
          <Ionicons
            name={item.cheered ? 'flame' : 'flame-outline'}
            size={15}
            color={item.cheered ? Colors.amber : Colors.muted}
          />
          <Text style={[styles.actionLabel, item.cheered && styles.actionLabelOn]}>
            {item.cheers > 0 ? item.cheers : 'Cheer'}
          </Text>
        </Pressable>

        <Pressable style={styles.action} onPress={() => onComment(item)} accessibilityRole="button">
          <Ionicons name="chatbubble-outline" size={14} color={Colors.muted} />
          <Text style={styles.actionLabel}>{item.comments > 0 ? item.comments : 'Comment'}</Text>
        </Pressable>
      </View>
    </CardSurface>
  );
}

/** One attachment tile. Stacked, one per row, in the order `itemAttachments` fixed. */
function AttachmentRow({ view, onPress }: { view: AgoraAttachmentView; onPress: () => void }) {
  return (
    <Pressable
      style={styles.attach}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={[view.eyebrow, view.title, view.subtitle].filter(Boolean).join(' · ')}>
      <View style={[styles.attachIcon, { backgroundColor: view.tint }]}>
        <Ionicons name={view.icon} size={20} color={Colors.ink} />
      </View>
      <View style={styles.attachText}>
        <Text style={styles.attachTitle} numberOfLines={2}>
          {view.title}
        </Text>
        <View style={styles.attachSubRow}>
          {view.eyebrow ? (
            <Text style={[styles.attachEyebrow, { color: view.eyebrowColor }]}>{view.eyebrow}</Text>
          ) : null}
          {view.eyebrow && view.subtitle ? <Text style={styles.attachSub}> · </Text> : null}
          {view.subtitle ? (
            <Text style={styles.attachSub} numberOfLines={1}>
              {view.subtitle}
            </Text>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

/**
 * The card's own surface.
 *
 * Only wrapped in the equipped-card art when the author is ACTUALLY wearing one. EquippedCardBackdrop
 * falls back to the starter hearth skin, so wrapping unconditionally would put a textured SVG behind
 * all twenty rows of a page — expensive, and it would flatten the exact distinction the mock draws,
 * where the flexed card is the one that stands out from plain neighbours.
 */
function CardSurface({ cardId, children }: { cardId?: string; children: ReactNode }) {
  if (!cardId) return <View style={styles.card}>{children}</View>;
  return (
    <EquippedCardBackdrop cardId={cardId} radius={16}>
      <View style={styles.cardInner}>{children}</View>
    </EquippedCardBackdrop>
  );
}

// Memoized on the fields the card actually draws. A feed re-renders on every cheer, and without
// this each one re-renders all twenty rows — including their halo and card SVGs.
//
// Attachments are not compared: they are frozen at post time and a page's items are replaced
// wholesale on refresh, so the only thing that moves under a stable id is the cheer/comment counts.
export const AgoraCard = memo(
  AgoraCardInner,
  (a, b) =>
    a.item.id === b.item.id &&
    a.item.cheers === b.item.cheers &&
    a.item.cheered === b.item.cheered &&
    a.item.comments === b.item.comments &&
    a.loadout.halo?.id === b.loadout.halo?.id &&
    a.loadout.card?.id === b.loadout.card?.id
);

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.cardDark,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.line,
    padding: Spacing.twelve,
  },
  cardInner: {
    padding: Spacing.twelve,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  headText: {
    flex: 1,
  },
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
  },
  avatarFallback: {
    backgroundColor: Colors.disabled,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontFamily: Fonts.bodyBold,
    fontSize: 15,
    color: Colors.ink,
  },
  name: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: Colors.ink,
  },
  handle: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.textTertiary,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 2,
  },
  time: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.textTertiary,
  },
  rank: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 10.5,
  },
  uniPill: {
    flexShrink: 1,
    borderRadius: Radius.pill,
    paddingHorizontal: 7,
    paddingVertical: 1.5,
    backgroundColor: Colors.selectedBg,
  },
  uniPillText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 9,
    color: Colors.sky,
  },
  attach: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginTop: Spacing.twelve,
    backgroundColor: Colors.twilight900,
    borderRadius: Radius.card,
    padding: 10,
  },
  attachIcon: {
    width: 42,
    height: 42,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachText: {
    flex: 1,
  },
  attachTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: Colors.ink,
  },
  attachSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  attachEyebrow: {
    fontFamily: Fonts.bodyBold,
    fontSize: 8.5,
    letterSpacing: 0.5,
  },
  attachSub: {
    flexShrink: 1,
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.muted,
  },
  body: {
    fontFamily: Fonts.body,
    fontSize: 13,
    lineHeight: 19,
    color: Colors.ink,
    marginTop: Spacing.twelve,
  },
  photo: {
    marginTop: Spacing.two,
    height: 190,
    borderRadius: Radius.card,
    backgroundColor: Colors.disabled,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.four,
    marginTop: Spacing.twelve,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.line,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  actionLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11.5,
    color: Colors.muted,
  },
  actionLabelOn: {
    color: Colors.amber,
  },
});
