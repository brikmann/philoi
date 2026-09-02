import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts, Spacing } from '@/constants/theme';

// THE CAMPFIRE'S EMOJI (§1).
//
// ── THIS REVERSES A RULE THIS CODEBASE PREVIOUSLY ENFORCED ────────────────────────────────────
// Round 2's R1 said the emoji was the campfire's fixed identity and had to be immutable after
// creation, and edit.tsx was changed to enforce exactly that — the theme tiles were deleted and
// handleSave echoed `group.emoji` back untouched. Noah has reversed that call: the owner can
// change it. The old reasoning ("everyone else remembers the fire by its glyph") is not wrong, it
// simply lost to the more immediate problem that a campfire called Goat was stuck wearing a
// generic flame with no way to fix it.
//
// A CURATED GRID, NOT A FREE TEXT FIELD. A text input with the system emoji keyboard would allow
// anything, which sounds better and is worse in three ways: it also accepts letters and whole
// sentences, "one emoji" is genuinely hard to validate (many are multi-codepoint sequences with
// skin-tone and ZWJ joiners, so `.length === 1` is wrong and `[...s].length === 1` is still
// wrong), and the field would render an empty box for anything the device cannot draw. A grid can
// only ever return a glyph that this build knows renders.
//
// The set leans toward the things people actually name campfires after — animals for the in-jokes
// (🐐 is the one Noah asked for by name), then study, gym, running, and the fire/ember family the
// brand already speaks in.

const EMOJI_SET = [
  // The brand's own vocabulary first — a campfire that doesn't want to be clever picks one of these.
  '🔥', '🪵', '⛺', '🏕️', '✨', '⚡',
  // Animals — where the in-jokes live.
  '🐐', '🦍', '🐺', '🦁', '🐻', '🦅', '🐍', '🦈', '🐉', '🦌', '🐗', '🦉',
  // Study.
  '📚', '✏️', '🎓', '🧪', '🔬', '💻', '📐', '🧠',
  // Gym and sport.
  '🏋️', '💪', '🥊', '⚽', '🏀', '🏈', '🎾', '🏊', '🚴', '🏃', '🧗', '⛷️',
  // Time, grind, and the rest.
  '⏰', '🌅', '🌙', '☕', '🎯', '🏆', '👑', '💎', '🚀', '🎸', '🎮', '🍳',
];

export function CampfireEmojiPicker({ value, onChange }: { value: string; onChange: (emoji: string) => void }) {
  return (
    <View>
      <View style={styles.preview}>
        <View style={styles.previewTile}>
          <Text style={styles.previewGlyph}>{value}</Text>
        </View>
        <Text style={styles.previewNote}>
          This is how your fire shows up in the valley, in invites, and at the top of the chat.
        </Text>
      </View>

      {/* Horizontal rather than a wrapped grid: this sits in the middle of a form and a 50-tile
          wrapped block would push Save changes off the screen. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        keyboardShouldPersistTaps="handled">
        {EMOJI_SET.map((e) => {
          const on = e === value;
          return (
            <Pressable
              key={e}
              onPress={() => onChange(e)}
              style={[styles.tile, on && styles.tileOn]}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`Use ${e} as this campfire's emoji`}>
              <Text style={styles.glyph}>{e}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  preview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    marginBottom: 10,
  },
  previewTile: {
    width: 44,
    height: 44,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.selectedBg,
    borderWidth: 1,
    borderColor: Colors.amber,
  },
  previewGlyph: {
    // No lineHeight multiplier: an emoji in a fixed-height box gets clipped on Android.
    fontSize: 24,
  },
  previewNote: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 11,
    lineHeight: 15,
    color: Colors.textTertiary,
  },
  row: {
    flexDirection: 'row',
    gap: 7,
    paddingRight: Spacing.two,
  },
  tile: {
    width: 40,
    height: 40,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  tileOn: {
    backgroundColor: Colors.selectedBg,
    borderColor: Colors.coral,
  },
  glyph: {
    fontSize: 20,
  },
});
