import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { memo, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';

import { AttachmentRow } from '@/components/agora/agora-card';
import { BurningName } from '@/components/burning-name';
import { EquippedCardBackdrop } from '@/components/economy/applied-art';
import { flareDisplayColour } from '@/components/economy/flare-signature';
import { FlarePerimeter } from '@/components/economy/flare-perimeter';
import { PublicTitle, publicFlameTint } from '@/components/economy/loadout-bits';
import { CosmeticAvatar } from '@/components/economy/public-identity';
import { HouseSealInline } from '@/components/house/house-seal';
import { IdentityLine } from '@/components/house/identity-line';
import { Icon, IconText } from '@/components/ui/icon';
import { NavGlyph } from '@/components/ui/nav-glyph';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import type { PublicLoadout } from '@/hooks/use-public-loadouts';
import { attachmentKey, attachmentView, itemAttachments, type AgoraAttachmentView } from '@/lib/agora-attachment';
import { agoraPhotoUrl, audienceTag } from '@/lib/api/agora';
import { formatClipLength, getAgoraVideoUrls, itemVideo, type AgoraVideoSnapshot, type AgoraVideoUrls } from '@/lib/api/agora-video';
import {
  formatLiftWeight,
  getLiftClipUrls,
  getVerifiedLift,
  mayCarryLift,
  parseResolution,
  type VerifiedLift,
} from '@/lib/api/reel-challenge';
import { isSharedPost } from '@/lib/api/shared-post';
import { formatRelativeTime, formatSessionDuration } from '@/lib/format';
import { RANK_TIER_METAL, formatRankTier } from '@/lib/rank-tiers';
import { getRewardPreferencesSync } from '@/lib/reward-settings';
import type { AgoraItem } from '@/types/database';

// ONE PAGE OF THE IMMERSIVE FEED (mock 317 frame 1). Every post fills the viewport, but the MEDIA
// REGION ADAPTS to what the post is — the square has clips, photos, session auto-posts, rewards and
// plain text, so this is not a video-only reels feed:
//
//   • video   → fills the page; muted autoplay while in view, tap to unmute (and the choice sticks
//               across pages, like every reels feed). Off-view pages hold the poster only — at most
//               ONE player exists at a time, so a long scroll never stacks decoders.
//   • photo   → fills the page, letterboxed over a blurred copy of itself so a landscape shot isn't
//               cropped to a sliver; several photos swipe sideways.
//   • card    → a session, a reward, or text: a designed full-bleed fill on the space-purple canvas
//               (mock 326) — a session's big duration under a flame, a reward's row, or the words
//               set large. Never a box floating on the page.
//
// ONE BOTTOM CARD FOR EVERY PAGE (mock 326): author · title · audience tag, then the caption, over
// the same scrim and beside the same rail, whatever the media is. A card page's body is the hero in
// the middle, so its caption is the attachment's one-line summary instead.
//
// COSMETICS FLEX HERE (the monetisation point of the mock). Every page wears its AUTHOR's loadout:
//   • the FLARE as a perimeter aura around the whole page — the real FlarePerimeter on the page in
//     view, a still rim on its neighbours so the swipe doesn't pop;
//   • the FLAME rings and tints the cheer button;
//   • the CARD is the plate the author row sits on; seal · title · "Heir to …" sit on that row.
// Earned and bought stay visually distinct: the house seal and the rank line (earned) are never
// tinted by a bought colour, and nothing here draws an achievement the author doesn't hold.
//
// COMMENT-FIRST, NO TALLIES (#259). The rail is comment · cheer · share. A cheer is a quiet
// acknowledgement that reaches the author's bell (cheer_agora_post, first cheer only) — it shows
// whether YOU cheered, never a count. Under the caption, "leave a nice one" drops a preset comment:
// the lowest-friction thing to do on someone's post is to encourage them, not to rank them.
//
// A VERIFIED LIFT (mock 319, 0282). When the post carries a set whose clip verifies it — on file,
// consented to review, shown by its owner — the page plays THAT clip and wears a green
// "🏋️ 405 lb Deadlift ✓ this clip verifies it" badge, and a friend gets ⚔ on the rail: a pre-filled
// head-to-head to beat that exact set. The server decides the badge (agora_verified_lifts); nothing
// here decorates a post the server didn't vouch for.

const NICE_ONES = ['respect 🫡', 'insane 💪', "let's go"] as const;

/**
 * "↳ from your story" (mock 324, 0286): this post came in through Share → Philoi. Asked of every
 * post (batched, one RPC per page of scrolling) — it can't be read off the row, because the feed
 * RPCs aren't restated to carry the column.
 */
function useSharedPost(item: AgoraItem): boolean {
  const [shared, setShared] = useState(false);
  useEffect(() => {
    if (item.item_type !== 'post') return;
    let alive = true;
    isSharedPost(item.id).then((s) => {
      if (alive) setShared(s);
    });
    return () => {
      alive = false;
    };
  }, [item.id, item.item_type]);
  return item.item_type === 'post' && shared;
}

/**
 * The verified lift this post shows the viewer, or null. Asked only of posts that could carry one —
 * which includes a shared post: a "Post with ⚔" that wasn't a PR carries its set with no attachment
 * saying so (finish_shared_post links it directly).
 */
function useVerifiedLift(item: AgoraItem, version: number, shared: boolean): VerifiedLift | null {
  const eligible = mayCarryLift(item) || (shared && !itemVideo(item));
  const [lift, setLift] = useState<VerifiedLift | null>(null);
  useEffect(() => {
    if (!eligible) return;
    let alive = true;
    getVerifiedLift(item.id).then((l) => {
      if (alive) setLift(l);
    });
    return () => {
      alive = false;
    };
  }, [item.id, eligible, version]);
  return eligible ? lift : null;
}

export type FeedPageMedia = 'video' | 'photo' | 'card';

/** Every photo a post carries: its own, then a session's extras (0273's lockin snapshot). */
function postPhotos(item: AgoraItem): string[] {
  const extra = itemAttachments(item).flatMap((a) => (a.kind === 'lockin' ? (a.snapshot.photos ?? []) : []));
  return [...(item.photo_path ? [item.photo_path] : []), ...extra];
}

export function feedPageMedia(item: AgoraItem): FeedPageMedia {
  if (itemVideo(item)) return 'video';
  if (postPhotos(item).length > 0) return 'photo';
  return 'card';
}

/** Room a fill page keeps clear at the bottom for the bottom card (author · caption · nice ones). */
const META_RESERVE = 190;
/** The rail's lane on the right; the caption wraps short of it. */
const RAIL_LANE = 64;

type Props = {
  item: AgoraItem;
  loadout: PublicLoadout;
  width: number;
  height: number;
  /** The floating top bar + chip row's height — a card page centres below it. */
  topInset: number;
  /** In view, on a focused screen in the foreground. Only an active page plays or animates. */
  active: boolean;
  /** Adjacent to the active page — prefetches its poster. */
  near: boolean;
  /** Muted autoplay is allowed (off on cellular / expensive connections). */
  autoplay: boolean;
  muted: boolean;
  mine: boolean;
  onToggleMute: () => void;
  onComment: (item: AgoraItem) => void;
  onCheer: (item: AgoraItem) => void;
  onShare: (item: AgoraItem) => void;
  onMore: (item: AgoraItem) => void;
  /** ⚔ on a verified lift — opens the pre-filled challenge sheet. */
  onChallenge: (item: AgoraItem, lift: VerifiedLift) => void;
  /** "Leave a nice one" — posts the preset as a comment. Resolves false when it didn't land. */
  onNiceComment: (item: AgoraItem, text: string) => Promise<boolean>;
  /** Bumped after a challenge is sent, so the page re-reads its lift ("already sent"). */
  liftVersion: number;
};

function FeedPageInner(props: Props) {
  const { item, loadout, width, height, topInset, active } = props;
  const router = useRouter();
  const video = itemVideo(item);
  const shared = useSharedPost(item);
  const lift = useVerifiedLift(item, props.liftVersion, shared);
  // A verified lift's clip IS the page's media — but only on a post without its own video, which
  // the server already guarantees (agora_verified_lifts skips those).
  const media: FeedPageMedia = lift && !video ? 'video' : feedPageMedia(item);
  const [expanded, setExpanded] = useState(false);
  // A card page's body is its hero, so its caption is what the post carries, in one line.
  const caption = media !== 'card' ? item.body : fillSummary(item);

  const flare = loadout.flare?.flare;
  const flareColour = flare ? flareDisplayColour(flare.effect, flare.colour) : null;

  function openAttachment(view: AgoraAttachmentView) {
    // Per attachment, as on the list card: a relic opens the relic, a session the session; one with
    // nowhere to go opens the conversation.
    if (view.route) router.push(view.route as never);
    else props.onComment(item);
  }

  return (
    <View style={[styles.page, { width, height }]}>
      {media === 'video' && video ? (
        <VideoLayer
          postId={item.id}
          video={video}
          active={active}
          near={props.near}
          autoplay={props.autoplay}
          muted={props.muted}
          onToggleMute={props.onToggleMute}
        />
      ) : media === 'video' && lift ? (
        <VideoLayer
          postId={item.id}
          video={liftVideo(lift)}
          liftSetId={lift.workout_set_id}
          active={active}
          near={props.near}
          autoplay={props.autoplay}
          muted={props.muted}
          onToggleMute={props.onToggleMute}
        />
      ) : media === 'photo' ? (
        <PhotoLayer paths={postPhotos(item)} width={width} height={height} topInset={topInset} />
      ) : (
        <FillLayer item={item} topInset={topInset} onAttachment={openAttachment} />
      )}

      {/* The bottom card's legibility scrim — the same on every page, so every card reads alike. */}
      <LinearGradient
        pointerEvents="none"
        colors={['transparent', 'rgba(9,6,20,0.5)', 'rgba(9,6,20,0.95)']}
        locations={[0, 0.45, 1]}
        style={styles.scrim}
      />

      {flare && flareColour ? (
        // +1000 Aura's effect is a "+N AURA" counter read off the VIEWER's own session clock —
        // feed furniture, not the author's flex (mock 326). On the feed it wears its rim only.
        active && flare.effect !== 'aura-counter' ? (
          <FlarePerimeter colour={flare.colour} effect={flare.effect} tier={2} />
        ) : (
          <StillRim colour={flareColour} />
        )
      ) : null}

      {lift ? <VerifiedBadge lift={lift} top={topInset + Spacing.two} /> : null}
      {shared ? (
        <View style={[styles.sharedTag, { top: topInset + Spacing.two }]} pointerEvents="none">
          <Text style={styles.sharedTagText}>↳ from your story</Text>
        </View>
      ) : null}

      <Rail {...props} media={media} lift={lift} />

      <View style={styles.meta} pointerEvents="box-none">
        <AuthorRow item={item} loadout={loadout} active={active} mine={props.mine} />
        {caption ? (
          <Pressable onPress={() => setExpanded((e) => !e)} accessibilityRole="button" accessibilityHint="Shows the whole caption">
            <Text style={styles.caption} numberOfLines={expanded ? 12 : 3}>
              {caption}
            </Text>
          </Pressable>
        ) : null}
        {!props.mine ? <NiceOnes item={item} onSend={props.onNiceComment} /> : null}
        {/* A session posted WITH photos is a photo page; its summary still rides along, under the caption. */}
        {media !== 'card'
          ? itemAttachments(item)
              .filter((a) => a.kind !== 'video')
              .slice(0, 1)
              .map((a) => {
                const view = attachmentView(a.kind, a.snapshot);
                if (!view) return null;
                return (
                  <AttachmentRow
                    key={attachmentKey(a)}
                    view={{ ...view, lift: null }}
                    xp={a.kind === 'lockin' ? a.snapshot.xp_earned : undefined}
                    onPress={() => openAttachment(view)}
                  />
                );
              })
          : null}
      </View>
    </View>
  );
}

// ───────────────────────────── media ─────────────────────────────

/** A verified lift's clip in the reel's snapshot shape — keys stay server-side, so they're blank. */
function liftVideo(lift: VerifiedLift): AgoraVideoSnapshot {
  const dims = parseResolution(lift.resolution);
  return { video_key: '', poster_key: '', duration_s: lift.duration_s ?? 0, width: dims?.width ?? null, height: dims?.height ?? null };
}

function VideoLayer({
  postId,
  video,
  liftSetId,
  active,
  near,
  autoplay,
  muted,
  onToggleMute,
}: {
  postId: string;
  video: AgoraVideoSnapshot;
  /** Play this set's gym clip instead of the post's own Agora video (a verified lift, 0282). */
  liftSetId?: string;
  active: boolean;
  near: boolean;
  autoplay: boolean;
  muted: boolean;
  onToggleMute: () => void;
}) {
  const [urls, setUrls] = useState<(Omit<AgoraVideoUrls, 'posterUrl'> & { posterUrl: string | null }) | null | undefined>(undefined);
  // On a connection that doesn't autoplay, a tap starts this one clip. Reset when it leaves view.
  const [started, setStarted] = useState(false);
  if (!active && started) setStarted(false);

  // Mounted pages are the active one and its neighbours (the list's window), so this fetch IS the
  // prefetch. getAgoraVideoUrls batches every ask in the same ~40ms into one edge call.
  useEffect(() => {
    if (!active && !near) return;
    let alive = true;
    (liftSetId ? getLiftClipUrls(liftSetId) : getAgoraVideoUrls(postId)).then((u) => {
      if (alive) setUrls(u);
    });
    return () => {
      alive = false;
    };
  }, [postId, liftSetId, active, near]);

  // Portrait clips fill the page; landscape ones letterbox rather than crop two-thirds away.
  const portrait = video.width && video.height ? video.height >= video.width : true;
  const fit = portrait ? 'cover' : 'contain';
  const playing = active && Boolean(urls) && (autoplay || started);

  if (urls === null) {
    return (
      <View style={styles.unavailable}>
        <Ionicons name="videocam-off-outline" size={22} color={Colors.spaceDim} />
        <Text style={styles.unavailableText}>Video unavailable</Text>
      </View>
    );
  }

  return (
    <Pressable
      style={StyleSheet.absoluteFill}
      onPress={() => (playing ? onToggleMute() : setStarted(true))}
      accessibilityRole="button"
      accessibilityLabel={playing ? (muted ? 'Unmute video' : 'Mute video') : `Play video, ${formatClipLength(video.duration_s)}`}>
      {urls ? (
        urls.posterUrl ? (
          <Image source={{ uri: urls.posterUrl }} style={StyleSheet.absoluteFill} contentFit={fit} transition={120} />
        ) : null
      ) : (
        <ActivityIndicator color={Colors.spaceDim} style={styles.loader} />
      )}
      {playing && urls ? <ReelPlayer uri={urls.videoUrl} muted={muted} fit={fit} /> : null}
      {!playing && urls ? (
        <View style={styles.playBtn} pointerEvents="none">
          <Ionicons name="play" size={30} color="#FFFFFF" />
        </View>
      ) : null}
      {video.duration_s > 0 && !playing ? (
        <View style={styles.length} pointerEvents="none">
          <Text style={styles.lengthText}>{formatClipLength(video.duration_s)}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/**
 * The one live player. Mounted only on the page in view and unmounted the moment it leaves, which
 * is what stops it — there is no pause bookkeeping to get wrong. Loops, starts muted, and leaves
 * other apps' audio alone while muted (expo-video's default 'auto' mixing).
 */
function ReelPlayer({ uri, muted, fit }: { uri: string; muted: boolean; fit: 'cover' | 'contain' }) {
  // Deferred, like every other expo-video consumer (gym-clip-player.tsx).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { VideoView, useVideoPlayer } = require('expo-video') as typeof import('expo-video');
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = muted;
    p.play();
  });
  useEffect(() => {
    // eslint-disable-next-line react-hooks/immutability -- expo-video's player is a native handle; muting is a property write
    player.muted = muted;
  }, [player, muted]);
  return <VideoView player={player} style={StyleSheet.absoluteFill} contentFit={fit} nativeControls={false} />;
}

function PhotoLayer({ paths, width, height, topInset }: { paths: string[]; width: number; height: number; topInset: number }) {
  const [failed, setFailed] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const shown = paths.filter((p) => !failed.includes(p) && agoraPhotoUrl(p));

  if (shown.length === 0) {
    return (
      <View style={styles.unavailable}>
        <Ionicons name="image-outline" size={22} color={Colors.spaceDim} />
      </View>
    );
  }

  const drop = (p: string) => setFailed((cur) => (cur.includes(p) ? cur : [...cur, p]));

  return (
    <>
      <FlatList
        data={shown}
        keyExtractor={(p) => p}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEnabled={shown.length > 1}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
        renderItem={({ item: p }) => {
          const uri = agoraPhotoUrl(p) as string;
          return (
            <View style={{ width, height }}>
              {/* The blurred bed, so a landscape photo letterboxes onto itself, not onto black. */}
              <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={28} />
              <View style={styles.bedDim} />
              <Image
                source={{ uri }}
                style={StyleSheet.absoluteFill}
                contentFit="contain"
                transition={120}
                onError={() => drop(p)}
              />
            </View>
          );
        }}
      />
      {shown.length > 1 ? (
        <View style={[styles.dots, { top: topInset + Spacing.one }]} pointerEvents="none">
          {shown.map((p, i) => (
            <View key={p} style={[styles.dot, i === index && styles.dotOn]} />
          ))}
        </View>
      ) : null}
    </>
  );
}

/** A card page's caption: its first attachment, said in one line ("Deep Work · 1h 8m"). */
function fillSummary(item: AgoraItem): string | null {
  for (const a of itemAttachments(item)) {
    if (a.kind === 'video') continue;
    const view = attachmentView(a.kind, a.snapshot);
    if (view) return view.subtitle ? `${view.title} · ${view.subtitle}` : view.title;
  }
  return null;
}

/**
 * A session, a reward or text, filling the page (mock 326's `.fillbg` + `.fillcenter`): the canvas
 * glows from the top, and the post's content sits centred in the band between the top bar and the
 * bottom card. A session leads with its duration under a flame; any other attachment keeps its
 * row; the person's own words come after, or ARE the page when there is nothing else.
 */
function FillLayer({
  item,
  topInset,
  onAttachment,
}: {
  item: AgoraItem;
  topInset: number;
  onAttachment: (view: AgoraAttachmentView) => void;
}) {
  const attachments = itemAttachments(item).filter((a) => a.kind !== 'video');
  const textOnly = attachments.length === 0;
  return (
    <View style={[styles.fillStage, { paddingTop: topInset + Spacing.three }]}>
      <LinearGradient
        pointerEvents="none"
        colors={['#2A1A4A', '#1A1233', '#120D22']}
        locations={[0, 0.4, 1]}
        style={StyleSheet.absoluteFill}
      />
      {attachments.map((a) => {
        const view = attachmentView(a.kind, a.snapshot);
        if (!view) return null;
        const seconds = a.kind === 'lockin' ? (a.snapshot.duration_seconds ?? 0) : 0;
        if (seconds > 0) {
          return (
            <Pressable
              key={attachmentKey(a)}
              style={styles.sessionHero}
              onPress={() => onAttachment(view)}
              accessibilityRole="button"
              accessibilityLabel={`${view.title}, ${formatSessionDuration(seconds)}. Open the session`}>
              <NavGlyph name="flame" size={32} color={Colors.navEmber} />
              <Text style={styles.sessionTime}>{formatSessionDuration(seconds)}</Text>
              <Text style={styles.sessionLabel} numberOfLines={1}>
                {view.title.toUpperCase()} · locked in
              </Text>
            </Pressable>
          );
        }
        return (
          <View key={attachmentKey(a)} style={styles.fillRow}>
            <AttachmentRow
              view={view}
              xp={a.kind === 'lockin' ? a.snapshot.xp_earned : undefined}
              onPress={() => onAttachment(view)}
            />
          </View>
        );
      })}
      {item.body ? (
        <Text style={textOnly ? styles.fillWords : styles.fillQuote} numberOfLines={textOnly ? 10 : 5}>
          {textOnly ? item.body : `“${item.body}”`}
        </Text>
      ) : null}
    </View>
  );
}

// ───────────────────────────── overlays ─────────────────────────────

/**
 * The flare on a page that isn't in view: the rim alone, no motion. Four soft inward ramps and a
 * hairline in the flare's drawn colour — mock 317's `inset 0 0 44px` glow — so paging from a still
 * neighbour into the live FlarePerimeter reads as the same aura waking, not appearing.
 */
function StillRim({ colour }: { colour: string }) {
  const glow = colour + '59';
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderWidth: 2, borderColor: colour + '8C' }]}>
      <LinearGradient colors={[glow, 'transparent']} style={styles.rimTop} />
      <LinearGradient colors={['transparent', glow]} style={styles.rimBottom} />
      <LinearGradient colors={[glow, 'transparent']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.rimLeft} />
      <LinearGradient colors={['transparent', glow]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.rimRight} />
    </View>
  );
}

/** Mock 319's green pill: the stat, and that THIS clip is what verifies it. */
function VerifiedBadge({ lift, top }: { lift: VerifiedLift; top: number }) {
  return (
    <View
      style={[styles.statBadge, { top }]}
      pointerEvents="none"
      accessibilityRole="text"
      accessibilityLabel={`${formatLiftWeight(lift.weight)} ${lift.exercise}, ${lift.reps} reps. This clip verifies it.`}>
      <IconText icon="gym" style={styles.statBadgeStat} numberOfLines={1} containerStyle={styles.statBadgeStatRow}>
        {formatLiftWeight(lift.weight)} {lift.exercise}
        {lift.reps > 1 ? ` × ${lift.reps}` : ''}
      </IconText>
      <IconText icon="check" style={styles.statBadgeVerified} gap={2}>
        this clip verifies it
      </IconText>
    </View>
  );
}

/** "Leave a nice one" — one tap drops an encouraging comment. One per page visit. */
function NiceOnes({ item, onSend }: { item: AgoraItem; onSend: Props['onNiceComment'] }) {
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(text: string) {
    if (busy || sent) return;
    setBusy(true);
    const ok = await onSend(item, text);
    setBusy(false);
    if (ok) setSent(text);
  }

  if (sent) {
    return (
      <IconText icon="comment" style={styles.niceSent}>
        You said “{sent}”
      </IconText>
    );
  }
  return (
    <View style={styles.niceRow}>
      <IconText icon="comment" style={styles.niceHint}>
        Leave a nice one
      </IconText>
      {NICE_ONES.map((text) => (
        <Pressable
          key={text}
          onPress={() => void send(text)}
          disabled={busy}
          style={styles.niceChip}
          hitSlop={4}
          accessibilityRole="button"
          accessibilityLabel={`Comment ${text}`}>
          <Text style={styles.niceChipText}>{text}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function AuthorRow({ item, loadout, active, mine }: { item: AgoraItem; loadout: PublicLoadout; active: boolean; mine: boolean }) {
  const router = useRouter();
  const tier = item.rank_tier && RANK_TIER_METAL[item.rank_tier] ? item.rank_tier : null;
  const tag = audienceTag(item);

  function openAuthor() {
    // Self goes to the Profile tab — friend-profile has no friendship row from you to yourself.
    if (mine) router.push('/profile');
    else router.push({ pathname: '/friend-profile', params: { userId: item.user_id } });
  }

  const row = (
    <Pressable style={styles.authorRow} onPress={openAuthor} accessibilityRole="button" accessibilityLabel={`${item.display_name}'s profile`}>
      <CosmeticAvatar
        userId={item.user_id}
        name={item.display_name}
        avatarUrl={item.avatar_url}
        size={40}
        loadout={loadout}
        motion={active ? 'full' : 'reduced'}
      />
      <View style={styles.authorText}>
        {/* The whole name, wrapping to a second line rather than clipping. The handle gets its own
            line so a long name never has to share its width with it. */}
        <BurningName userId={item.user_id} style={styles.name} numberOfLines={2} suffix={<HouseSealInline userId={item.user_id} size={14} />}>
          {item.display_name}
        </BurningName>
        {item.handle ? (
          <Text style={styles.handle} numberOfLines={1}>
            @{item.handle}
          </Text>
        ) : null}
        <PublicTitle loadout={loadout} compact />
        <IdentityLine userId={item.user_id} showSchool={false} style={styles.identity} />
        <Text style={styles.when} numberOfLines={1}>
          {formatRelativeTime(item.created_at)}
          {/* Rank is EARNED — drawn in its own metal, never in a bought colour. */}
          {tier ? (
            <Text style={{ color: RANK_TIER_METAL[tier].text }}> · {formatRankTier(tier, item.rank_division ?? 1)}</Text>
          ) : null}
        </Text>
      </View>
      {/* Mock 326's `.tag`: who it was shared with, at the row's right end on every page. */}
      <View style={styles.audienceTag}>
        {tag.emoji ? (
          <Text style={styles.audienceTagText} numberOfLines={1}>
            {`${tag.emoji} ${tag.label}`}
          </Text>
        ) : (
          <IconText icon={tag.icon} style={styles.audienceTagText} numberOfLines={1} gap={3}>
            {tag.label}
          </IconText>
        )}
      </View>
    </Pressable>
  );

  // The CARD cosmetic is the plate the author row sits on — only when they're wearing one, so the
  // flexed plate stands out from a plain neighbour (the same rule as the list card's CardSurface).
  if (!loadout.card) return row;
  return (
    <View style={styles.plateWrap}>
      <EquippedCardBackdrop cardId={loadout.card.id} radius={14} motion={active ? 'full' : 'still'}>
        <View style={styles.plate}>{row}</View>
      </EquippedCardBackdrop>
    </View>
  );
}

function Rail({
  item,
  loadout,
  media,
  mine,
  active,
  autoplay,
  muted,
  onToggleMute,
  onComment,
  onCheer,
  onShare,
  onMore,
  onChallenge,
  lift,
}: Props & { media: FeedPageMedia; lift: VerifiedLift | null }) {
  // The author's FLAME colour rings their cheer — base coral when they have none equipped.
  const flame = publicFlameTint(loadout);
  return (
    <View style={styles.rail} pointerEvents="box-none">
      <Pressable style={styles.railItem} onPress={() => onComment(item)} accessibilityRole="button" accessibilityLabel={`Comments, ${item.comments}`}>
        <Ionicons name="chatbubble-ellipses" size={27} color="#FFFFFF" style={styles.railShadow} />
        <Text style={styles.railLabel}>{item.comments > 0 ? item.comments : 'comment'}</Text>
      </Pressable>

      <CheerButton item={item} flame={flame} mine={mine} onCheer={onCheer} />

      {/* ⚔ only on a verified, comparable lift a friend posted — the server's can_challenge. */}
      {lift && lift.can_challenge && !mine ? (
        <Pressable
          style={styles.railItem}
          onPress={() => onChallenge(item, lift)}
          accessibilityRole="button"
          accessibilityLabel={lift.my_challenge_id ? 'Challenge sent' : `Challenge ${item.display_name} to beat ${formatLiftWeight(lift.weight)}`}>
          <View style={[styles.challenge, lift.my_challenge_id ? styles.challengeSent : null]}>
            <Icon name="challenge" size={20} color={Colors.onEmber} />
          </View>
          <Text style={styles.railLabel}>{lift.my_challenge_id ? 'sent' : 'Challenge'}</Text>
        </Pressable>
      ) : null}

      <Pressable style={styles.railItem} onPress={() => onShare(item)} accessibilityRole="button" accessibilityLabel="Share">
        <Ionicons name="arrow-redo" size={26} color="#FFFFFF" style={styles.railShadow} />
        <Text style={styles.railLabel}>share</Text>
      </Pressable>

      {media === 'video' && active && autoplay ? (
        <Pressable style={styles.railItem} onPress={onToggleMute} accessibilityRole="button" accessibilityLabel={muted ? 'Unmute' : 'Mute'}>
          <Ionicons name={muted ? 'volume-mute' : 'volume-high'} size={22} color="#FFFFFF" style={styles.railShadow} />
        </Pressable>
      ) : null}

      <Pressable style={styles.railItem} onPress={() => onMore(item)} hitSlop={6} accessibilityRole="button" accessibilityLabel="More options">
        <Ionicons name="ellipsis-horizontal" size={22} color="#FFFFFF" style={styles.railShadow} />
      </Pressable>
    </View>
  );
}

/**
 * 🔥 (mock 326 — "it does nothing"). It used to be a disabled Pressable on your own post and on one
 * you'd cheered, so on a feed of your own posts (a one-member room) every tap was swallowed, and a
 * landed cheer only nudged a fill. Now every tap answers: the flame pops and buzzes, a first cheer
 * lands optimistically (immersive-feed's onCheer — cheer_agora_post is idempotent), and your own
 * post says it's yours rather than looking broken.
 */
function CheerButton({
  item,
  flame,
  mine,
  onCheer,
}: {
  item: AgoraItem;
  flame: string;
  mine: boolean;
  onCheer: (item: AgoraItem) => void;
}) {
  const cheered = item.cheered;
  const pop = useSharedValue(1);
  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));

  function press() {
    pop.set(withSequence(
      withTiming(mine || cheered ? 1.08 : 1.3, { duration: 110, easing: Easing.out(Easing.quad) }),
      withSpring(1, { damping: 9, stiffness: 220 })
    ));
    if (getRewardPreferencesSync().haptics) {
      Haptics.impactAsync(mine || cheered ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    }
    if (!mine && !cheered) onCheer(item);
  }

  return (
    <Pressable
      style={styles.railItem}
      onPress={press}
      accessibilityRole="button"
      accessibilityState={{ selected: cheered }}
      accessibilityLabel={mine ? 'Your post' : cheered ? 'Cheered' : 'Cheer'}>
      <Animated.View
        style={[
          styles.cheer,
          { borderColor: flame, backgroundColor: cheered ? flame : flame + '26' },
          mine && styles.cheerMine,
          popStyle,
        ]}>
        <NavGlyph name="flame" size={22} color={cheered ? '#FFFFFF' : flame} />
      </Animated.View>
      <Text style={styles.railLabel}>{mine ? 'yours' : cheered ? 'cheered' : 'cheer'}</Text>
    </Pressable>
  );
}

// Memoized on what a page draws: the comment/cheer state, the author's slots, and the page's own
// playback inputs. A feed patch (one comment count) would otherwise re-render every mounted page and
// its aura. Same rule as AgoraCard: if FeedPageInner reads it, compare it here.
export const FeedPage = memo(
  FeedPageInner,
  (a, b) =>
    a.item.id === b.item.id &&
    a.item.comments === b.item.comments &&
    a.item.cheered === b.item.cheered &&
    a.loadout.halo?.id === b.loadout.halo?.id &&
    a.loadout.card?.id === b.loadout.card?.id &&
    a.loadout.flare?.id === b.loadout.flare?.id &&
    a.loadout.flame?.id === b.loadout.flame?.id &&
    a.loadout.title?.id === b.loadout.title?.id &&
    a.loadout.title?.rarity === b.loadout.title?.rarity &&
    a.loadout.title?.seasonStamp === b.loadout.title?.seasonStamp &&
    a.width === b.width &&
    a.height === b.height &&
    a.topInset === b.topInset &&
    a.active === b.active &&
    a.near === b.near &&
    a.autoplay === b.autoplay &&
    a.muted === b.muted &&
    a.mine === b.mine &&
    a.onComment === b.onComment &&
    a.onCheer === b.onCheer &&
    a.onShare === b.onShare &&
    a.onMore === b.onMore &&
    a.onChallenge === b.onChallenge &&
    a.onNiceComment === b.onNiceComment &&
    a.liftVersion === b.liftVersion &&
    a.onToggleMute === b.onToggleMute
);

const RIM = 44;

const styles = StyleSheet.create({
  page: {
    backgroundColor: Colors.spaceBg,
    overflow: 'hidden',
  },
  scrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '48%',
  },
  rimTop: { position: 'absolute', top: 0, left: 0, right: 0, height: RIM },
  rimBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, height: RIM },
  rimLeft: { position: 'absolute', top: 0, bottom: 0, left: 0, width: RIM },
  rimRight: { position: 'absolute', top: 0, bottom: 0, right: 0, width: RIM },
  loader: {
    flex: 1,
  },
  unavailable: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  unavailableText: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.spaceDim,
  },
  playBtn: {
    position: 'absolute',
    alignSelf: 'center',
    top: '50%',
    marginTop: -34,
    width: 68,
    height: 68,
    borderRadius: 34,
    paddingLeft: 4,
    backgroundColor: 'rgba(6,5,10,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  length: {
    position: 'absolute',
    top: '50%',
    marginTop: 44,
    alignSelf: 'center',
    borderRadius: Radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
    backgroundColor: 'rgba(6,5,10,0.65)',
  },
  lengthText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    color: '#FFFFFF',
  },
  bedDim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(11,7,24,0.45)',
  },
  // Under the floating chrome, where a swipe-sideways hint is read before the caption is.
  dots: {
    position: 'absolute',
    right: 0,
    left: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 5,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.4)',
  },
  dotOn: {
    backgroundColor: '#FFFFFF',
  },
  // Mock 326's `.fillcenter`: the band between the top bar and the bottom card, content centred.
  fillStage: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingBottom: META_RESERVE,
  },
  // `.sesscard`: the session's flame and duration, on a faint plate.
  sessionHero: {
    alignItems: 'center',
    gap: 4,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    backgroundColor: 'rgba(10,7,22,0.4)',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  sessionTime: {
    fontFamily: Fonts.black,
    fontSize: 38,
    letterSpacing: -1,
    color: Colors.ink,
  },
  sessionLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 0.4,
    color: Colors.muted,
  },
  fillRow: {
    alignSelf: 'stretch',
  },
  // `.quote`: the person's line under the hero.
  fillQuote: {
    fontFamily: Fonts.bodyBold,
    fontSize: 19,
    lineHeight: 25,
    textAlign: 'center',
    color: Colors.ink,
  },
  // A text post IS its words — big type, the page's only content.
  fillWords: {
    fontFamily: Fonts.black,
    fontSize: 26,
    lineHeight: 33,
    letterSpacing: -0.4,
    textAlign: 'center',
    color: Colors.ink,
  },
  meta: {
    position: 'absolute',
    left: Spacing.three,
    right: RAIL_LANE,
    bottom: Spacing.three,
    gap: Spacing.two,
  },
  plateWrap: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    borderRadius: 14,
    overflow: 'hidden',
  },
  plate: {
    paddingVertical: 7,
    paddingHorizontal: 9,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  authorText: {
    flexShrink: 2,
    minWidth: 0,
  },
  name: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: '#FFFFFF',
  },
  handle: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.muted,
    marginTop: 1,
  },
  identity: {
    marginTop: 1,
  },
  when: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.muted,
    marginTop: 2,
  },
  // Mock 320's `.aud` pill, at the author row's right end (mock 326's `.tag`). It shrinks before the
  // name does.
  audienceTag: {
    marginLeft: 'auto',
    flexShrink: 1,
    maxWidth: 120,
    borderRadius: Radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: 'rgba(57,217,138,0.12)',
    borderWidth: 1,
    borderColor: '#2A4D3A',
  },
  audienceTagText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9.5,
    color: '#39D98A',
  },
  caption: {
    fontFamily: Fonts.body,
    fontSize: 13.5,
    lineHeight: 19,
    color: '#FFFFFF',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowRadius: 4,
  },
  rail: {
    position: 'absolute',
    right: 10,
    bottom: 96,
    alignItems: 'center',
    gap: 16,
  },
  railItem: {
    alignItems: 'center',
    gap: 3,
    minWidth: 44,
  },
  railShadow: {
    textShadowColor: 'rgba(0,0,0,0.55)',
    textShadowRadius: 6,
  },
  railLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
    color: '#FFFFFF',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowRadius: 4,
  },
  cheer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Your own post: the ring still shows your flame (it's your flex), but it isn't a button.
  cheerMine: {
    opacity: 0.6,
  },
  challenge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.navEmber,
    borderWidth: 1.5,
    borderColor: Colors.navEmber2,
  },
  challengeSent: {
    opacity: 0.55,
  },

  // Mock 319's verified-stat pill, top-left under the chrome. Green = the board's "✓ clip on file".
  // "↳ from your story" — mock 324's `.src`, top right, opposite the verified badge.
  sharedTag: {
    position: 'absolute',
    right: Spacing.three,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    backgroundColor: 'rgba(10,7,22,0.75)',
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  sharedTagText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9,
    color: Colors.muted,
  },
  statBadge: {
    position: 'absolute',
    left: Spacing.three,
    maxWidth: '72%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.green,
    backgroundColor: 'rgba(10,7,22,0.78)',
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  statBadgeStatRow: {
    flexShrink: 1,
  },
  statBadgeStat: {
    flexShrink: 1,
    fontFamily: Fonts.bodyBold,
    fontSize: 12.5,
    color: '#FFFFFF',
  },
  statBadgeVerified: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9.5,
    color: Colors.green,
  },
  niceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  niceHint: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10.5,
    color: Colors.navEmber2,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowRadius: 4,
  },
  niceChip: {
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(255,176,90,0.45)',
    backgroundColor: 'rgba(10,7,22,0.55)',
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  niceChipText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: '#FFFFFF',
  },
  niceSent: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: Colors.navEmber2,
  },
});
