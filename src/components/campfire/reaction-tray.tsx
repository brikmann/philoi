import { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TextInput } from '@/components/ui/text-input';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useReduceMotion } from '@/hooks/use-reduce-motion';

// THE REACTION TRAY (D6, design-mocks/178-message-reactions.html).
//
// ══════════════════════════════════════════════════════════════════════════════════════════════
// INSTAGRAM, NOT DISCORD — AND THE DIFFERENCE IS VISIBLE RIGHT HERE
//
// This tray never renders a count, and it cannot: it is handed the ONE emoji the viewer currently
// holds on this message (`current`) and it highlights it. There is no per-emoji tally to show,
// because migration 0171's primary key on (message_id, user_id) makes a tally impossible. Tapping
// the highlighted glyph clears the reaction; tapping a different one swaps it. Both are the same
// call — the tray reports the emoji that was tapped and the server decides set/swap/clear.
//
// THE QUICK SET IS DELIBERATE, not a default emoji list. 🔥 is first because this is a fire app
// and it is the reaction the product is about. 💀 and 🥀 are in the six on purpose: they are the
// "I'm dead" / "deceased" reactions this audience actually sends, and their absence is what makes
// a reaction set feel like it was picked by someone's parents.
//
// ══════════════════════════════════════════════════════════════════════════════════════════════
// WHY THE TRAY IS ANCHORED BY MEASUREMENT RATHER THAN LAID OUT IN THE LIST
//
// The tray has to float ABOVE the pressed bubble, over a dim scrim, outside the FlatList's
// clipping and above every other row. A tray rendered inside the message row would be clipped by
// the list, would scroll with it, and would have to fight z-order with the rows after it. So the
// caller measures the pressed bubble in window coordinates and passes that rect here; this
// component positions itself against the window and clamps to the screen so a tray on the first or
// last message, or on a bubble at the screen edge, is never half off-screen.

/** Mock 178's tray: six, then the ＋ that opens the full picker. 🔥 leads. */
const QUICK_SET = ['🔥', '💀', '😭', '❤️', '🥀', '😂'] as const;

/** Mock 178's picker categories, transcribed. "Popular" is first and carries the Gen-Z staples. */
const PICKER: { name: string; emoji: string[] }[] = [
  {
    name: 'Popular',
    emoji: ['💀', '🥀', '😭', '🔥', '😂', '💅', '🫠', '🗿', '🤡', '👀', '💯', '✨', '🥴', '😩', '🫡', '🧍', '🙄', '😐', '🤨', '😮‍💨', '🫶', '🙏'],
  },
  { name: 'Smileys', emoji: ['😀', '😂', '🥹', '😍', '😎', '🤩', '😭', '😤', '🤯', '🥶', '😅', '🫡', '🙃', '😴', '🤔', '🫠'] },
  { name: 'Gestures', emoji: ['🔥', '💪', '🙌', '👏', '🙏', '👍', '👎', '🤝', '✊', '🫶', '💯', '⚡'] },
  { name: 'Hearts', emoji: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '💔', '❤️‍🔥'] },
  { name: 'Symbols', emoji: ['🏆', '🥇', '🎯', '📚', '🏃', '🏋️', '🧠', '👑', '🥊', '⏱️'] },
];

/** Search terms per emoji, so "fire" finds 🔥. Only the ones worth typing a word for. */
const SEARCH_TERMS: Record<string, string> = {
  '🔥': 'fire lit hot flame',
  '💀': 'skull dead dying im dead',
  '🥀': 'rose deceased wilted dead flower',
  '😭': 'crying sob bawling',
  '❤️': 'heart love red',
  '😂': 'laugh crying laughing joy',
  '💅': 'nails slay',
  '🫠': 'melting',
  '🗿': 'moai stone face',
  '🤡': 'clown',
  '👀': 'eyes looking',
  '💯': 'hundred keep it real',
  '✨': 'sparkles',
  '🥴': 'woozy',
  '😩': 'weary',
  '🫡': 'salute',
  '🧍': 'standing',
  '🙄': 'eye roll',
  '🤨': 'raised eyebrow',
  '😮‍💨': 'exhale sigh',
  '🫶': 'heart hands',
  '🙏': 'pray thanks',
  '💪': 'muscle strong gym',
  '🏆': 'trophy win',
  '👑': 'crown king',
  '🏋️': 'lift gym weights',
  '🏃': 'run running',
  '📚': 'study books',
  '🧠': 'brain smart',
};

export type TrayAnchor = { x: number; y: number; width: number; height: number };

const TRAY_HEIGHT = 52;
const TRAY_WIDTH = 7 * 44 + 20; // six emoji + the ＋, at 44 each, plus the pill's padding.
const EDGE = 12;

export function ReactionTray({
  visible,
  anchor,
  current,
  onPick,
  onClose,
  onMore,
}: {
  visible: boolean;
  /** The pressed bubble in window coordinates, from measureInWindow. */
  anchor: TrayAnchor | null;
  /** The emoji this viewer already holds on this message, if any — rendered selected. */
  current: string | null;
  /** Tapping the selected emoji is how it gets removed; the caller sends it either way. */
  onPick: (emoji: string) => void;
  onClose: () => void;
  /** The delete / report / block menu, which long-press used to open on its own. */
  onMore: () => void;
}) {
  const { width: screenW, height: screenH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState('');

  const t = useSharedValue(0);
  useEffect(() => {
    t.value = reduceMotion ? (visible ? 1 : 0) : withTiming(visible ? 1 : 0, { duration: 140, easing: Easing.out(Easing.quad) });
  }, [visible, reduceMotion, t]);

  // NOTE ON RESETTING: reopening on another message must not inherit the last message's open
  // picker or search text. That reset is NOT done with an effect here — `setState` in an effect
  // body triggers cascading renders and this repo's lint rules reject it. The caller passes a
  // `key` of the pressed message id instead, so each open is a fresh mount and this state starts
  // clean by construction. See circle-timeline.tsx's <ReactionTray key=… />.

  const trayStyle = useAnimatedStyle(() => ({
    opacity: t.value,
    transform: [{ scale: reduceMotion ? 1 : 0.9 + t.value * 0.1 }],
  }));

  // Above the bubble by preference; below it when the bubble is too near the top for the tray to
  // fit. Clamped horizontally so an edge-aligned bubble cannot push the pill off-screen.
  const placement = useMemo(() => {
    if (!anchor) return null;
    const wantAbove = anchor.y - TRAY_HEIGHT - 10;
    const top =
      wantAbove > insets.top + EDGE
        ? wantAbove
        : Math.min(anchor.y + anchor.height + 10, screenH - TRAY_HEIGHT - insets.bottom - EDGE);
    const wantLeft = anchor.x + anchor.width / 2 - TRAY_WIDTH / 2;
    const left = Math.max(EDGE, Math.min(wantLeft, screenW - TRAY_WIDTH - EDGE));
    return { top, left };
  }, [anchor, screenW, screenH, insets.top, insets.bottom]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    const seen = new Set<string>();
    const hits: string[] = [];
    for (const cat of PICKER) {
      for (const em of cat.emoji) {
        if (seen.has(em)) continue;
        if ((SEARCH_TERMS[em] ?? '').includes(q) || cat.name.toLowerCase().startsWith(q)) {
          seen.add(em);
          hits.push(em);
        }
      }
    }
    return hits;
  }, [query]);

  if (!visible || !placement) return null;

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      {/* The dim scrim. Tapping anywhere off the tray dismisses without reacting — a long-press
          that turns out to be a misgrab must have a free way out. */}
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close the reaction picker" />

      {!pickerOpen && (
        <Animated.View style={[styles.tray, { top: placement.top, left: placement.left }, trayStyle]}>
          {QUICK_SET.map((em) => {
            const selected = current === em;
            return (
              <Pressable
                key={em}
                onPress={() => onPick(em)}
                style={[styles.emo, selected && styles.emoSelected]}
                accessibilityRole="button"
                // The label says what the tap will DO, which for the held emoji is remove — the
                // second of the two remove affordances the design asks for.
                accessibilityLabel={selected ? `Remove your ${em} reaction` : `React with ${em}`}
                accessibilityState={{ selected }}>
                <Text style={styles.emoGlyph}>{em}</Text>
              </Pressable>
            );
          })}
          <Pressable
            onPress={() => setPickerOpen(true)}
            style={styles.emo}
            accessibilityRole="button"
            accessibilityLabel="More emoji">
            <Text style={styles.plus}>＋</Text>
          </Pressable>
        </Animated.View>
      )}

      {/* The message's own actions still need a home: long-press used to open delete / report /
          block directly, and D6 takes that gesture for the tray. A quiet row under the tray keeps
          it one gesture away instead of unreachable. */}
      {!pickerOpen && (
        <Pressable
          style={[styles.moreRow, { top: placement.top + TRAY_HEIGHT + 8, left: placement.left }]}
          onPress={onMore}
          accessibilityRole="button"
          accessibilityLabel="Message options">
          <Text style={styles.moreText}>Message options</Text>
        </Pressable>
      )}

      {pickerOpen && (
        <View style={[styles.picker, { paddingBottom: insets.bottom + Spacing.three }]}>
          <View style={styles.grab} />
          <Text style={styles.pickerTitle}>React with…</Text>
          <TextInput
            style={styles.search}
            placeholder="Search"
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
            autoCapitalize="none"
          />
          <ScrollView contentContainerStyle={styles.pickerBody} keyboardShouldPersistTaps="handled">
            {results ? (
              results.length === 0 ? (
                <Text style={styles.noHits}>Nothing matches “{query.trim()}”.</Text>
              ) : (
                <View style={styles.grid}>
                  {results.map((em) => (
                    <PickerEmoji key={em} emoji={em} selected={current === em} onPress={() => onPick(em)} />
                  ))}
                </View>
              )
            ) : (
              PICKER.map((cat) => (
                <View key={cat.name}>
                  <Text style={styles.catLabel}>{cat.name}</Text>
                  <View style={styles.grid}>
                    {cat.emoji.map((em) => (
                      <PickerEmoji
                        key={`${cat.name}-${em}`}
                        emoji={em}
                        selected={current === em}
                        onPress={() => onPick(em)}
                      />
                    ))}
                  </View>
                </View>
              ))
            )}
          </ScrollView>
        </View>
      )}
    </Modal>
  );
}

function PickerEmoji({ emoji, selected, onPress }: { emoji: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.pemo, selected && styles.emoSelected]}
      accessibilityRole="button"
      accessibilityLabel={selected ? `Remove your ${emoji} reaction` : `React with ${emoji}`}
      accessibilityState={{ selected }}>
      <Text style={styles.pemoGlyph}>{emoji}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(6,4,10,0.62)',
  },
  tray: {
    position: 'absolute',
    width: TRAY_WIDTH,
    height: TRAY_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    borderRadius: 30,
    backgroundColor: 'rgba(28,20,40,0.98)',
    borderWidth: 1,
    borderColor: Colors.lineStrong,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 18,
    elevation: 12,
  },
  emo: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Amber, matching the badge on the bubble, so "the one I'm holding" looks the same in both
  // places and the toggle is legible without a word of explanation.
  emoSelected: {
    backgroundColor: Colors.selectedBg,
    borderWidth: 1,
    borderColor: Colors.amber,
  },
  emoGlyph: {
    fontSize: 24,
  },
  plus: {
    fontSize: 20,
    fontFamily: Fonts.bodyBold,
    color: Colors.textTertiary,
  },
  moreRow: {
    position: 'absolute',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(20,14,24,0.94)',
    borderWidth: 1,
    borderColor: Colors.lineStrong,
  },
  moreText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12.5,
    color: Colors.muted,
  },
  picker: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '72%',
    backgroundColor: 'rgba(16,11,20,0.98)',
    borderTopWidth: 1,
    borderTopColor: Colors.lineStrong,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: 8,
    paddingHorizontal: Spacing.three,
  },
  grab: {
    width: 38,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: Colors.trackAlt,
    alignSelf: 'center',
    marginTop: 4,
    marginBottom: 12,
  },
  pickerTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 16,
    color: Colors.ink,
    marginBottom: Spacing.two,
  },
  search: {
    marginBottom: Spacing.two,
  },
  pickerBody: {
    paddingBottom: Spacing.three,
  },
  catLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: Colors.textTertiary,
    marginTop: Spacing.two,
    marginBottom: 6,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  pemo: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pemoGlyph: {
    fontSize: 26,
  },
  noHits: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.muted,
    paddingVertical: Spacing.three,
  },
});
