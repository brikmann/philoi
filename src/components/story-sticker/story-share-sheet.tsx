import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Switch, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, Pattern, Rect } from 'react-native-svg';

import { StorySticker, STICKER_WIDTH, type StickerSkin } from '@/components/story-sticker/story-sticker';
import { PrimaryButton } from '@/components/ui/primary-button';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { track } from '@/lib/analytics';
import { getItem, isDefaultItem } from '@/lib/economy/catalog';
import { useFlameRamp } from '@/lib/economy/flame-ramp';
import { useEquipped } from '@/lib/economy/loadout';
import { useStickerModel, type StickerSession } from '@/lib/story-sticker/data';
import { useStickerPrefs, type StickerBackdrop } from '@/lib/story-sticker/prefs';
import {
  canShareToInstagramStories,
  captureSticker,
  saveStickerToLibrary,
  shareStickerSystem,
  shareStickerToInstagram,
} from '@/lib/story-sticker/share';

type Props = {
  visible: boolean;
  session: StickerSession | null;
  onClose: () => void;
};

type Busy = 'instagram' | 'save' | 'system' | null;

// The share flow for the story sticker: a live preview, the backdrop choice (My photo / My
// cosmetic), the opt-in flexes, and the three ways out — Instagram Stories (the Strava hand-off),
// Save image, and the system share sheet for everything else.
//
// The preview is NOT what gets photographed. It is scaled to fit the phone and plays a rare card's
// live layer; the export is a second, hidden instance at the fixed 360pt layout with the art held
// still, so the PNG is the same pixels on every device and never catches the art mid-frame.
export function StoryShareSheet({ visible, session, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const { width: screenW } = useWindowDimensions();
  const [prefs, setPrefs] = useStickerPrefs();
  const { model } = useStickerModel(visible ? session : null);
  const [customizing, setCustomizing] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [saved, setSaved] = useState(false);
  const [previewH, setPreviewH] = useState(0);
  const [exportSize, setExportSize] = useState({ width: 0, height: 0 });
  const exportRef = useRef<View>(null);

  const equippedCard = useEquipped('card');
  const flame = useEquipped('flame');
  const flare = useEquipped('flare');
  const ramp = useFlameRamp();
  // The worn fire tints the glass card only when there IS one beyond the starter flame — the base
  // ramp is the brand ember, which the card already uses.
  const tinted = !!flare || (!!flame && !isDefaultItem(flame.id));
  const skin: StickerSkin = {
    backdrop: prefs.backdrop,
    card: equippedCard ?? getItem('card-base-hearth') ?? null,
    flameRamp: tinted ? ramp : null,
  };

  const scale = Math.min(1, (screenW - Spacing.four * 2 - 24) / STICKER_WIDTH);
  const igReady = canShareToInstagramStories();

  async function run(target: Exclude<Busy, null>) {
    if (busy) return;
    setBusy(target);
    try {
      const uri = await captureSticker(exportRef, exportSize);
      if (!uri) return;
      let done = false;
      if (target === 'instagram') {
        done = await shareStickerToInstagram(uri);
        // Instagram missing, or it refused the hand-off — the sticker still goes somewhere.
        if (!done) await shareStickerSystem(uri);
      } else if (target === 'save') {
        done = await saveStickerToLibrary(uri);
        if (done) {
          setSaved(true);
          setTimeout(() => setSaved(false), 1800);
        }
      } else {
        await shareStickerSystem(uri);
      }
      void track('story_sticker_shared', {
        target: target === 'instagram' && !done ? 'system' : target,
        backdrop: prefs.backdrop,
        goal_type: session?.goalType ?? null,
        rank: prefs.showRank,
        streak: prefs.showStreak,
        campus: prefs.showCampus,
        exercises: prefs.showExercises && (model?.exercises.length ?? 0) > 0,
      });
    } catch (e) {
      console.warn('[story-sticker] share failed:', e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen">
      <View style={[styles.screen, { paddingTop: insets.top + Spacing.two, paddingBottom: insets.bottom + Spacing.three }]}>
        <View style={styles.header}>
          <Text style={styles.title}>Share your lock-in</Text>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
            <Ionicons name="close" size={24} color={Colors.muted} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.segment}>
            {(['photo', 'cosmetic'] as StickerBackdrop[]).map((b) => (
              <Pressable
                key={b}
                onPress={() => setPrefs({ backdrop: b })}
                style={[styles.segmentBtn, prefs.backdrop === b && styles.segmentOn]}
                accessibilityRole="button"
                accessibilityState={{ selected: prefs.backdrop === b }}
              >
                <Text style={[styles.segmentText, prefs.backdrop === b && styles.segmentTextOn]}>
                  {b === 'photo' ? 'My photo' : 'My cosmetic'}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.hint}>
            {prefs.backdrop === 'photo'
              ? 'A see-through sticker — drop it on your own photo in Stories.'
              : 'Your equipped card fills the sticker. No photo needed.'}
          </Text>

          {/* The canvas: a checkerboard shows the transparency the PNG really has. */}
          <View style={styles.canvas}>
            {prefs.backdrop === 'photo' ? <Checker /> : (
              <LinearGradient colors={['#241A12', '#14181F', '#0C0E14']} style={StyleSheet.absoluteFill} />
            )}
            {model ? (
              <View style={{ width: STICKER_WIDTH * scale, height: previewH * scale }}>
                <View
                  style={{
                    position: 'absolute',
                    left: (STICKER_WIDTH * scale - STICKER_WIDTH) / 2,
                    top: (previewH * scale - previewH) / 2,
                    transform: [{ scale }],
                  }}
                >
                  <StorySticker
                    model={model}
                    prefs={prefs}
                    skin={skin}
                    motion="full"
                    onLayout={(e) => setPreviewH(e.nativeEvent.layout.height)}
                  />
                </View>
              </View>
            ) : null}
          </View>

          <Pressable onPress={() => setCustomizing((c) => !c)} style={styles.customizeLink} accessibilityRole="button">
            <Text style={styles.customizeText}>{customizing ? 'Done' : 'Customize'}</Text>
            <Ionicons name={customizing ? 'chevron-up' : 'chevron-down'} size={14} color={Colors.amber} />
          </Pressable>

          {customizing ? (
            <View style={styles.toggles}>
              <Text style={styles.togglesTitle}>Add your flexes</Text>
              <Text style={styles.togglesSub}>Earned it? Show it off.</Text>
              <ToggleRow
                name="Rank"
                detail={model?.rank?.label ?? 'Loading…'}
                value={prefs.showRank}
                disabled={!model?.rank}
                onChange={(v) => setPrefs({ showRank: v })}
              />
              <ToggleRow
                name="Day streak"
                detail={model && model.streakDays > 0 ? `🔥 ${model.streakDays} days` : 'No streak yet'}
                value={prefs.showStreak}
                disabled={!model || model.streakDays <= 0}
                onChange={(v) => setPrefs({ showStreak: v })}
              />
              <ToggleRow
                name="Campus rank"
                detail={model?.campus?.phrase ?? 'Not on a board yet'}
                value={prefs.showCampus}
                disabled={!model?.campus}
                onChange={(v) => setPrefs({ showCampus: v })}
              />
              {/* Gym only, and only when the session logged anything — a toggle for an empty list is noise. */}
              {model && model.exercises.length > 0 ? (
                <ToggleRow
                  name="Exercises"
                  detail={exercisesDetail(model.exercises.length, model.exercises.filter((e) => e.isPr).length)}
                  value={prefs.showExercises}
                  onChange={(v) => setPrefs({ showExercises: v })}
                />
              ) : null}
            </View>
          ) : null}
        </ScrollView>

        <View style={styles.actions}>
          <PrimaryButton
            label={igReady ? 'Share to Instagram Stories' : 'Share'}
            onPress={() => void run(igReady ? 'instagram' : 'system')}
            loading={busy === 'instagram' || (!igReady && busy === 'system')}
            disabled={!model || exportSize.width === 0}
          />
          <View style={styles.secondaryRow}>
            <Pressable onPress={() => void run('save')} disabled={!!busy || !model} style={styles.secondary} accessibilityRole="button">
              <Ionicons name={saved ? 'checkmark' : 'download-outline'} size={16} color={Colors.ink} />
              <Text style={styles.secondaryText}>{busy === 'save' ? 'Saving…' : saved ? 'Saved' : 'Save image'}</Text>
            </Pressable>
            {igReady ? (
              <Pressable onPress={() => void run('system')} disabled={!!busy || !model} style={styles.secondary} accessibilityRole="button">
                <Ionicons name="share-outline" size={16} color={Colors.ink} />
                <Text style={styles.secondaryText}>More…</Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        {/* The export instance — fixed 360pt layout, art held still, never visible. */}
        {model ? (
          <View style={styles.offscreen} pointerEvents="none">
            <StorySticker
              ref={exportRef}
              model={model}
              prefs={prefs}
              skin={skin}
              motion="still"
              onLayout={(e) => setExportSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
            />
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

/** "4 exercises · 2 new PRs". */
function exercisesDetail(count: number, prs: number): string {
  const base = `${count} exercise${count === 1 ? '' : 's'}`;
  return prs > 0 ? `${base} · ${prs} new PR${prs === 1 ? '' : 's'}` : base;
}

function ToggleRow({
  name,
  detail,
  value,
  disabled,
  onChange,
}: {
  name: string;
  detail: string;
  value: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={[styles.toggleRow, disabled && styles.toggleDisabled]}>
      <View style={styles.toggleText}>
        <Text style={styles.toggleName}>{name}</Text>
        <Text style={styles.toggleDetail}>{detail}</Text>
      </View>
      <Switch
        value={value && !disabled}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ true: Colors.amber, false: Colors.trackAlt }}
        thumbColor="#FFFFFF"
      />
    </View>
  );
}

function Checker() {
  return (
    <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
      <Defs>
        <Pattern id="stickerChecker" width={24} height={24} patternUnits="userSpaceOnUse">
          <Rect width={24} height={24} fill="#1A1626" />
          <Rect width={12} height={12} fill="#2A2438" />
          <Rect x={12} y={12} width={12} height={12} fill="#2A2438" />
        </Pattern>
      </Defs>
      <Rect width="100%" height="100%" fill="url(#stickerChecker)" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#0B0812',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.two,
  },
  title: {
    fontFamily: Fonts.displayHeavy,
    fontSize: 18,
    color: Colors.ink,
  },
  scroll: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.four,
  },
  segment: {
    flexDirection: 'row',
    backgroundColor: '#171222',
    borderRadius: 12,
    padding: 3,
    borderWidth: 1,
    borderColor: '#2C2340',
  },
  segmentBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 9,
    borderRadius: 9,
  },
  segmentOn: {
    backgroundColor: '#2C2340',
  },
  segmentText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: Colors.textTertiary,
  },
  segmentTextOn: {
    color: Colors.ink,
  },
  hint: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.muted,
    textAlign: 'center',
    marginTop: Spacing.two,
  },
  canvas: {
    marginTop: Spacing.three,
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#241C36',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 36,
    minHeight: 320,
  },
  customizeLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: Spacing.three,
  },
  customizeText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: Colors.amber,
  },
  toggles: {
    gap: 10,
  },
  togglesTitle: {
    fontFamily: Fonts.black,
    fontSize: 17,
    color: Colors.ink,
  },
  togglesSub: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.muted,
    marginBottom: 4,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#171222',
    borderWidth: 1,
    borderColor: '#2C2340',
    borderRadius: 14,
    paddingVertical: 11,
    paddingHorizontal: 14,
  },
  toggleDisabled: {
    opacity: 0.5,
  },
  toggleText: {
    flex: 1,
  },
  toggleName: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.ink,
  },
  toggleDetail: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.textTertiary,
    marginTop: 2,
  },
  actions: {
    paddingHorizontal: Spacing.four,
    gap: Spacing.two,
  },
  secondaryRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  secondary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Colors.card,
    borderRadius: 14,
    paddingVertical: 13,
  },
  secondaryText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.ink,
  },
  offscreen: {
    position: 'absolute',
    top: -10000,
    left: 0,
  },
});
