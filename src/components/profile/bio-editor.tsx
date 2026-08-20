import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { TextInput } from '@/components/ui/text-input';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { setMyBio } from '@/lib/api/journal';

// §3 — the one-line bio, edited in a sheet rather than inline.
//
// A sheet, not an inline TextInput on the card: the identity block sits on a cosmetic backdrop
// whose height the layout depends on, and swapping a two-line Text for a growing multiline input
// would reflow the card (and the halo positioned against it) mid-keystroke.

/** Matches the CHECK on profiles.bio — the server refuses longer, so the input stops there too
 * rather than letting someone type 300 characters and lose them on save. */
const MAX = 160;

export function BioEditor({
  initial,
  onClose,
  onSaved,
}: {
  /** The draft to open with. The caller passes '' for "no bio yet". */
  initial: string;
  onClose: () => void;
  onSaved: (bio: string | null) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const stored = await setMyBio(draft);
      onSaved(stored);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save your bio.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <Text style={styles.title}>Your bio</Text>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Third-year chem. Mostly nocturnal."
            multiline
            maxLength={MAX}
            style={styles.input}
            autoFocus
          />
          <View style={styles.metaRow}>
            <Text style={styles.count}>
              {draft.length} / {MAX}
            </Text>
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </View>
          <View style={styles.actions}>
            {/* Saving an empty string is how you clear it — the server stores NULL for blank, so
                there is no separate delete path to get out of sync. */}
            <Pressable onPress={() => setDraft('')} hitSlop={8}>
              <Text style={styles.clear}>Clear</Text>
            </Pressable>
            <Pressable onPress={save} disabled={saving} style={styles.save} accessibilityRole="button">
              <Text style={styles.saveText}>{saving ? 'Saving…' : 'Save'}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.cream,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: Spacing.four,
    gap: Spacing.two,
  },
  title: {
    fontFamily: Fonts.bodyBold,
    fontSize: 16,
    color: Colors.ink,
  },
  input: {
    minHeight: 72,
    textAlignVertical: 'top',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  count: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textTertiary,
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.coral,
    flexShrink: 1,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.two,
  },
  clear: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.textTertiary,
  },
  save: {
    backgroundColor: Colors.ember,
    borderRadius: Radius.button,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  saveText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13.5,
    color: Colors.ink,
  },
});
