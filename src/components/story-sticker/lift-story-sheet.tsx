import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { forwardRef, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fitFontSize } from '@/components/share-card-frame';
import { FlameLogo, FlameWordmark } from '@/components/ui/flame-logo';
import { PrimaryButton } from '@/components/ui/primary-button';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { track } from '@/lib/analytics';
import { formatLiftWeight } from '@/lib/api/reel-challenge';
import { canShareToInstagramStories, shareSticker } from '@/lib/story-sticker/share';

// Philoi → Instagram for a verified lift (mock 324, frame 1): "New 1RM · 405 lb", "✓ verified on
// Philoi", a way back. Same hand-off as the lock-in sticker (modules/philoi-story-share): a PNG on
// Instagram's Stories composer, the system share sheet when Instagram can't take it.
//
// THE WAY BACK IS PRINTED, NOT LINKED. Meta only lets approved partners attach a tappable link to a
// shared Story, so "philoi.app" is text on the art; the person can add Instagram's own Link sticker
// on top. Copy says "match it on philoi.app", never "tap" — nothing here is tappable.
//
// Original art only: the brand flame and wordmark. No Instagram logo or wordmark anywhere — the
// button says "Add to Instagram Story", which is a description, not a mark.

export type LiftStoryStat = {
  exercise: string;
  /**
   * Null when the post carries no structured lift — a Gym Spark post the author flagged as a PR
   * with only a photo and a caption. The card then leads with the caption instead of a number, and
   * never invents one.
   */
  weight: number | null;
  reps: number | null;
  isPr: boolean;
  handle: string | null;
  /** The post's caption — the headline's stand-in when there is no weight to print. */
  caption?: string | null;
  /**
   * Whether the numbers came off a server-verified set (a 'pr' attachment or a logged session).
   * Defaults true for the lift-import path, which always posts a verified set. False hides the
   * "verified on Philoi" pill — a caption is the author's word, not a verified lift.
   */
  verified?: boolean;
};

const CARD_WIDTH = 360;
/** The green the reel's verified badge and the composer's audience promise use (#39D98A). */
const VERIFIED_GREEN = '#39D98A';
/** A caption past this is a paragraph, not a headline — clipped with an ellipsis. */
const CAPTION_LINES = 4;

/** "New 1RM · 405 lb" / "New PR · 315 lb × 3" / "405 lb × 3" / "New PR" (caption-only). */
function headline(stat: LiftStoryStat): string {
  if (stat.weight == null) return stat.isPr ? 'New PR' : 'New set';
  const reps = stat.reps ?? 1;
  const set = `${formatLiftWeight(stat.weight)}${reps > 1 ? ` × ${reps}` : ''}`;
  if (!stat.isPr) return set;
  return `${reps === 1 ? 'New 1RM' : 'New PR'} · ${set}`;
}

export const LiftStoryCard = forwardRef<View, { stat: LiftStoryStat; onLayout?: (e: LayoutChangeEvent) => void }>(
  function LiftStoryCard({ stat, onLayout }, ref) {
    const caption = stat.weight == null ? stat.caption?.trim() || null : null;
    const verified = stat.weight != null && stat.verified !== false;
    const meta = [stat.handle ? `@${stat.handle}` : null, stat.exercise || null].filter(Boolean).join(' · ');
    return (
      <View ref={ref} collapsable={false} style={styles.card} onLayout={onLayout}>
        <LinearGradient colors={['#2A1A4A', '#120D22']} style={StyleSheet.absoluteFill} />
        <FlameWordmark size={30} />
        <View style={styles.flameGlow}>
          <FlameLogo size={64} />
        </View>
        <Text style={styles.stat}>{headline(stat)}</Text>
        {caption ? (
          <Text
            style={[styles.caption, { fontSize: fitFontSize(caption, 17, 12, 60) }]}
            numberOfLines={CAPTION_LINES}>
            “{caption}”
          </Text>
        ) : null}
        {meta ? <Text style={styles.meta}>{meta}</Text> : null}
        {verified ? (
          <View style={styles.verified}>
            <Ionicons name="checkmark" size={12} color={VERIFIED_GREEN} />
            <Text style={styles.verifiedText}>verified on Philoi</Text>
          </View>
        ) : null}
        <Text style={styles.back}>think you can match it? · philoi.app</Text>
      </View>
    );
  }
);

type Props = { visible: boolean; stat: LiftStoryStat | null; onClose: () => void };

export function LiftStorySheet({ visible, stat, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const ref = useRef<View>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [busy, setBusy] = useState(false);
  const igReady = canShareToInstagramStories();

  async function share() {
    if (busy || !stat) return;
    setBusy(true);
    try {
      // Settles + re-measures before the capture (story-sticker/settle.ts), then Instagram or the
      // system sheet — the one path every sticker shares through.
      const target = await shareSticker(ref, size);
      if (!target) return;
      void track('story_sticker_shared', { target, backdrop: 'lift', is_pr: stat.isPr });
    } catch (e) {
      console.warn('[lift-story] share failed:', e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen">
      <View style={[styles.screen, { paddingTop: insets.top + Spacing.two, paddingBottom: insets.bottom + Spacing.three }]}>
        <View style={styles.header}>
          <View style={styles.flex}>
            <Text style={styles.title}>Share your set</Text>
            <Text style={styles.sub}>Log it on Philoi, flex it on your story.</Text>
          </View>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
            <Ionicons name="close" size={24} color={Colors.muted} />
          </Pressable>
        </View>

        <View style={styles.stage}>
          {stat ? (
            <LiftStoryCard
              ref={ref}
              stat={stat}
              onLayout={(e) => setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
            />
          ) : null}
        </View>

        <View style={styles.actions}>
          <PrimaryButton
            label={igReady ? 'Add to Instagram Story' : 'Share'}
            onPress={() => void share()}
            loading={busy}
            disabled={!stat || size.width === 0}
          />
          <Text style={styles.hint}>
            {igReady ? 'Opens your Instagram story composer.' : 'Opens the share sheet.'}
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: '#0E0A1C' },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.two,
  },
  title: { fontFamily: Fonts.displayHeavy, fontSize: 19, color: Colors.ink },
  sub: { fontFamily: Fonts.body, fontSize: 12, color: Colors.muted, marginTop: 4 },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.four },
  card: {
    width: CARD_WIDTH,
    maxWidth: '100%',
    aspectRatio: 9 / 14,
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#352A52',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: Spacing.four,
  },
  flameGlow: {
    marginVertical: Spacing.two,
    shadowColor: '#FF7A2F',
    shadowOpacity: 0.6,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 0 },
  },
  stat: { fontFamily: Fonts.black, fontSize: 28, color: Colors.ink, textAlign: 'center' },
  meta: { fontFamily: Fonts.body, fontSize: 12, color: Colors.muted, textAlign: 'center' },
  caption: { fontFamily: Fonts.bodySemiBold, color: Colors.ink, textAlign: 'center', lineHeight: 22 },
  verified: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#1F5A40',
    backgroundColor: 'rgba(57,217,138,0.1)',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  verifiedText: { fontFamily: Fonts.bodyBold, fontSize: 11, color: VERIFIED_GREEN },
  back: {
    position: 'absolute',
    bottom: 16,
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: Colors.spaceFaint,
  },
  actions: { paddingHorizontal: Spacing.four, gap: Spacing.two },
  hint: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textTertiary, textAlign: 'center' },
});
