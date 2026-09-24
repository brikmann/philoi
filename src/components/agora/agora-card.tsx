import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { memo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { EquippedCardBackdrop } from '@/components/economy/applied-art';
import { ItemArt } from '@/components/economy/item-art';
import { PublicTitle } from '@/components/economy/loadout-bits';
import { CosmeticAvatar } from '@/components/economy/public-identity';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth/auth-context';
import type { PublicLoadout } from '@/hooks/use-public-loadouts';
import { GymClipThumbnail } from '@/components/gym-clip-player';
import { GYM_VIDEO_CLIPS_ENABLED } from '@/constants/feature-flags';
import { attachmentKey, attachmentView, formatVolume, itemAttachments } from '@/lib/agora-attachment';
import type { AgoraAttachmentView, AgoraLiftView } from '@/lib/agora-attachment';
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
// whole page. The halo now comes via CosmeticAvatar so the FLARE and the TITLE travel with it —
// the card had the loadout in hand all along and was spending it on the ring alone.
//
// MEDIA STACKS. A post can carry a photo and a lock-in and a reward at once (migration 0140), so
// the attachment is a LIST here, drawn in ATTACH_ORDER. Milestone rows arrive as a one-element
// list, and a post written before 0140 is normalised into one by `itemAttachments` — there is no
// second rendering path for the old shape to fall down.
//
// A POSTED LIFT CARRIES THE LIFT. A gym session used to reach the square as one line — "38:04" —
// which is the single fact about a workout that says least about it. Migration 0192 started
// freezing the sets, the volume, the PRs and the kept clips into the snapshot, and `LiftDetail`
// below is the half that draws them. Everything it needs was frozen at post time, so a card costs
// no extra round trip; only the clip THUMBNAILS are fetched, and only because their signed URLs
// expire and their access is re-checked per viewer.

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
  const { session } = useAuth();
  const [photoFailed, setPhotoFailed] = useState(false);

  const attachments = itemAttachments(item);
  const rank = rankLabel(item);
  const photo = photoFailed ? null : agoraPhotoUrl(item.photo_path);

  function openAuthor() {
    // Your own name on your own post goes to YOUR profile. `friend-profile` reads the relationship
    // between you and the id it is handed, and there is no friendship row from you to yourself —
    // so routing self there rendered a blank screen. Same split every other roster makes.
    if (item.user_id === session?.user.id) router.push('/profile');
    else router.push({ pathname: '/friend-profile', params: { userId: item.user_id } });
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
          {/* A feed scrolls, so the aura holds still here — same rule as the leaderboard rows. */}
          <CosmeticAvatar
            userId={item.user_id}
            name={item.display_name}
            avatarUrl={item.avatar_url}
            size={AVATAR}
            loadout={loadout}
            motion="reduced"
          />
        </Pressable>

        <Pressable style={styles.headText} onPress={openAuthor} accessibilityRole="button">
          <Text style={styles.name} numberOfLines={1}>
            {item.display_name}
            {item.handle ? <Text style={styles.handle}> @{item.handle}</Text> : null}
          </Text>
          <PublicTitle loadout={loadout} compact />
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
  // The lift sits OUTSIDE the Pressable, not inside it. A clip tile is its own tap target, and in
  // React Native the innermost pressable takes the responder — nesting them would mean tapping a
  // clip opened the session detail instead of playing the clip. Same lesson as D4 in the campfire
  // chain, learned there the expensive way.
  if (view.lift) {
    return (
      <View style={styles.attachGroup}>
        <AttachmentHeadRow view={view} onPress={onPress} />
        <LiftDetail lift={view.lift} />
      </View>
    );
  }
  return <AttachmentHeadRow view={view} onPress={onPress} />;
}

function AttachmentHeadRow({ view, onPress }: { view: AgoraAttachmentView; onPress: () => void }) {
  return (
    <Pressable
      style={[styles.attach, view.lift && styles.attachWithLift]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={[view.eyebrow, view.title, view.subtitle].filter(Boolean).join(' · ')}>
      {/* A COLLECTIBLE DRAWS ITSELF (item-art.tsx). The square is the flex feed, so a posted relic
          showing a generic diamond glyph was the one card that refused to show the thing it was
          bragging about. `view.art` is the resolved catalog entry and is null for every other
          kind — and for a key the catalog no longer has, which falls back to the glyph rather than
          to a hole. Neutral tile under it: `view.tint` for a cosmetic IS the item's own first
          gradient stop, so the art would be drawn in its colour on its colour. `motion="off"`
          because a feed scrolls, same rule as the author's aura above. */}
      {view.art ? (
        <View style={[styles.attachIcon, styles.attachIconArt]}>
          <ItemArt item={view.art} size={32} motion="off" />
        </View>
      ) : (
        <View style={[styles.attachIcon, { backgroundColor: view.tint }]}>
          <Ionicons name={view.icon} size={20} color={Colors.ink} />
        </View>
      )}
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
 * The posted workout, under its summary row.
 *
 * WHAT IT SHOWS, in the order a lifter reads a session: the load moved, then what moved it, then
 * the clips. `total_volume` and the set list are frozen facts from migration 0192 — the server
 * recomputed them from `workout_sets` at post time, so nothing here can be talked up by a client.
 *
 * WHAT IT DOES NOT SHOW: the session's PHOTOS. A lock-in's photos live in `check_in_photos`, whose
 * RLS scopes them to the poster's circle-mates, and there is no per-photo publish flag anywhere in
 * the schema. An Agora post can be campus- or globally-scoped, so lifting those photos onto this
 * card would publish, to strangers, media whose owner only ever cleared it for their campfires —
 * a new disclosure they never granted. The clips below are different in exactly the way that
 * matters: a clip is never auto-filmed (0054), `attach_workout_set_clip` is its only writer, and
 * only a clip whose upload the member completed is frozen at all. Per-item opt-in, already given.
 */
function LiftDetail({ lift }: { lift: AgoraLiftView }) {
  // Clips a stranger may not play. `gym-clip-playback-url` re-checks owner / circle-mate / friend
  // on EVERY request, which is what keeps a frozen reference in a public post from granting
  // anything — but it also means a global post's clips are legitimately refused for most of the
  // square. Those tiles drop out rather than sitting there as dead play buttons.
  const [blocked, setBlocked] = useState<string[]>([]);
  const clips = GYM_VIDEO_CLIPS_ENABLED
    ? lift.clips.filter((c) => !blocked.includes(c.workout_set_id))
    : [];
  // Trimmed against the VISIBLE tiles: if three of six clips were refused, "+2 more" would be
  // counting clips this viewer was just told they cannot have.
  const clipOverflow = clips.length === lift.clips.length ? lift.clipCount - lift.clips.length : 0;
  const setOverflow = lift.exerciseCount - lift.sets.length;

  return (
    <View style={styles.lift}>
      {/* `hasPr` earns this row on its own. A bodyweight session moves no bar, so it has no volume
          to print — but it can absolutely have set a record, and `has_pr` covers tracked sets that
          fall outside the 12 summary rows frozen below, so the badge is not always recoverable
          from the visible list. Gating the whole row on volume dropped those PRs silently. */}
      {lift.hasVolume || lift.hasPr ? (
        <View style={styles.volumeRow}>
          <Ionicons name="barbell" size={13} color={Colors.amber} />
          {lift.hasVolume ? (
            <>
              <Text style={styles.volumeValue}>{formatVolume(lift.totalVolume)}</Text>
              <Text style={styles.volumeLabel}>moved</Text>
            </>
          ) : (
            <Text style={styles.volumeLabel}>Bodyweight</Text>
          )}
          {lift.hasPr ? (
            <View style={styles.prTag}>
              <Ionicons name="trophy" size={8} color={Colors.achieverText} />
              <Text style={styles.prTagText}>PR</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {lift.sets.map((set, i) => (
        <View key={`${set.exercise}:${i}`} style={styles.liftRow}>
          <Text style={styles.liftText} numberOfLines={1}>
            {set.exercise} · {set.sets}×{set.reps}
            {set.weight ? ` @ ${Math.round(set.weight)} lb` : ''}
          </Text>
          {set.is_pr ? (
            <View style={styles.prTag}>
              <Ionicons name="trophy" size={8} color={Colors.achieverText} />
              <Text style={styles.prTagText}>PR</Text>
            </View>
          ) : null}
        </View>
      ))}

      {setOverflow > 0 ? (
        <Text style={styles.liftMore}>
          +{setOverflow} more {setOverflow === 1 ? 'exercise' : 'exercises'}
        </Text>
      ) : null}

      {clips.length > 0 ? (
        <View style={styles.clipsRow}>
          {clips.map((c) => (
            <GymClipThumbnail
              key={c.workout_set_id}
              workoutSetId={c.workout_set_id}
              size={56}
              onUnavailable={() =>
                setBlocked((current) =>
                  current.includes(c.workout_set_id) ? current : [...current, c.workout_set_id]
                )
              }
            />
          ))}
          {clipOverflow > 0 ? <Text style={styles.liftMore}>+{clipOverflow}</Text> : null}
        </View>
      ) : null}
    </View>
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
//
// 🐛 EVERY DRAWN SLOT HAS TO BE IN HERE. This compared the halo and the card only, while the card
// also draws the TITLE and (through CosmeticAvatar) the FLARE — so equipping a new title left the
// feed showing the old one even once a fresh loadout reached this prop. That is half of the "Agora
// shows Ash Walker, not Ascended" report; the other half was the cache upstream. The rule the next
// slot added to this card has to follow: if AgoraCardInner reads it, compare it here.
export const AgoraCard = memo(
  AgoraCardInner,
  (a, b) =>
    a.item.id === b.item.id &&
    a.item.cheers === b.item.cheers &&
    a.item.cheered === b.item.cheered &&
    a.item.comments === b.item.comments &&
    a.loadout.halo?.id === b.loadout.halo?.id &&
    a.loadout.card?.id === b.loadout.card?.id &&
    a.loadout.flare?.id === b.loadout.flare?.id &&
    a.loadout.title?.id === b.loadout.title?.id &&
    // A re-granted placement title keeps its key and changes only these two — see sameLoadout in
    // lib/economy/loadout.ts, which learned the same lesson.
    a.loadout.title?.rarity === b.loadout.title?.rarity &&
    a.loadout.title?.seasonStamp === b.loadout.title?.seasonStamp
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
  // A lift is ONE tile with two parts, not two stacked tiles. The head row gives up its bottom
  // corners and its own margin so the detail below reads as the same object continuing.
  attachGroup: {
    marginTop: Spacing.twelve,
  },
  attachWithLift: {
    marginTop: 0,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    paddingBottom: 8,
  },
  lift: {
    backgroundColor: Colors.twilight900,
    borderBottomLeftRadius: Radius.card,
    borderBottomRightRadius: Radius.card,
    paddingHorizontal: 10,
    paddingBottom: 10,
    gap: 3,
  },
  volumeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingBottom: 6,
    marginBottom: 3,
    borderBottomWidth: 1,
    borderBottomColor: Colors.line,
  },
  volumeValue: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.ink,
  },
  volumeLabel: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.muted,
  },
  liftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  liftText: {
    flexShrink: 1,
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.muted,
  },
  liftMore: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.textTertiary,
  },
  prTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    borderRadius: Radius.pill,
    paddingHorizontal: 5,
    paddingVertical: 1,
    backgroundColor: Colors.achieverBg,
  },
  prTagText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 8,
    letterSpacing: 0.4,
    color: Colors.achieverText,
  },
  clipsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 6,
  },
  attachIcon: {
    width: 42,
    height: 42,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachIconArt: {
    backgroundColor: Colors.cardDark,
    borderWidth: 1,
    borderColor: Colors.lineStrong,
    overflow: 'hidden',
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
