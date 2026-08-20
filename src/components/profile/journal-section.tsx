import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { FlameLogo } from '@/components/ui/flame-logo';
import { TextInput } from '@/components/ui/text-input';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { fetchJournal, setJournalHidden, setJournalNote } from '@/lib/api/journal';
import { formatRelativeTime } from '@/lib/format';
import type { JournalEntry, NotificationImageShape } from '@/types/database';

// §5 — the Journal, sitting directly under the rank strip and above the Trophy Hall.
//
// Placed high ON PURPOSE, per the spec: it is the "there's a real human behind this screen" layer,
// and burying it under a wall of trophies would invert the thing it exists to do. A viewer should
// see WHY someone grinds before they see how much.
//
// Entries are achievements the server already recorded; the only thing written here is the note.

const ART = 40;

const SHAPE_RADIUS: Record<NotificationImageShape, number> = {
  circle: 999,
  hexagon: 12,
  rounded: 10,
  square: 4,
  flame: 999,
};

export function JournalSection({
  userId,
  isOwn,
  onAddMilestone,
}: {
  userId: string;
  isOwn: boolean;
  /** §8's composer entry point. Omitted on someone else's profile. */
  onAddMilestone?: () => void;
}) {
  const router = useRouter();
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [editing, setEditing] = useState<JournalEntry | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setEntries(await fetchJournal(userId));
    } catch {
      // Ambient: a journal that fails to load leaves the section empty rather than breaking the
      // profile around it. The rank strip and trophies above and below still render.
    }
  }, [userId]);

  useEffect(() => {
    let current = true;
    (async () => {
      try {
        const rows = await fetchJournal(userId);
        if (current) setEntries(rows);
      } catch {
        // see load()
      }
    })();
    return () => {
      current = false;
    };
  }, [userId]);

  function openEditor(entry: JournalEntry) {
    setEditing(entry);
    setDraft(entry.note ?? '');
  }

  async function saveNote() {
    if (!editing) return;
    setSaving(true);
    try {
      await setJournalNote(editing.entry_key, draft);
      setEditing(null);
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function toggleHidden(entry: JournalEntry) {
    await setJournalHidden(entry.entry_key, !entry.hidden);
    await load();
  }

  // Someone else's empty journal renders nothing at all — an empty state on a profile you are
  // visiting is a comment on that person, not a prompt you can act on.
  if (entries.length === 0 && !isOwn) return null;

  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <Text style={styles.heading}>Journal</Text>
        {isOwn && onAddMilestone ? (
          <Pressable onPress={onAddMilestone} hitSlop={8} style={styles.addBtn} accessibilityRole="button">
            <Ionicons name="add" size={14} color={Colors.ember} />
            <Text style={styles.addText}>Milestone</Text>
          </Pressable>
        ) : null}
      </View>

      {entries.length === 0 ? (
        <Text style={styles.empty}>
          Rank-ups, streaks and challenge wins land here. Add a note to any of them.
        </Text>
      ) : (
        entries.map((entry) => {
          // §8 — a pinned milestone is a journal entry the USER wrote. It already carries its note
          // from the composer, so it offers no "＋ add a note" and no note editor: a second,
          // competing note on a post you just authored would have nothing to say. It taps through
          // to its own permalink instead, where it can be shared and cheered.
          const isMilestone = entry.kind === 'milestone';
          return (
            <Pressable
              key={entry.entry_key}
              style={styles.row}
              onPress={
                isMilestone
                  ? () => router.push({ pathname: '/milestone/[id]', params: { id: entry.entry_key } })
                  : undefined
              }
              disabled={!isMilestone}
              accessibilityRole={isMilestone ? 'button' : undefined}>
              {isMilestone ? (
                <View style={[styles.art, styles.artFallback, styles.milestoneArt]}>
                  <Ionicons name="ribbon" size={19} color={Colors.ember} />
                </View>
              ) : (
                <Art url={entry.image_url} shape={entry.image_shape} />
              )}
              <View style={styles.rowText}>
                <Text style={styles.title} numberOfLines={2}>
                  {entry.title}
                </Text>
                {!isMilestone && entry.body ? (
                  <Text style={styles.body} numberOfLines={2}>
                    {entry.body}
                  </Text>
                ) : null}

                {entry.note ? (
                  <Text style={styles.note}>“{entry.note}”</Text>
                ) : isOwn && !isMilestone ? (
                  <Pressable onPress={() => openEditor(entry)} hitSlop={6}>
                    <Text style={styles.addNote}>＋ add a note</Text>
                  </Pressable>
                ) : null}

                <View style={styles.metaRow}>
                  <Text style={styles.time}>{formatRelativeTime(entry.created_at)}</Text>
                  {isMilestone ? <Text style={styles.time}>· milestone</Text> : null}
                  {isOwn && entry.note && !isMilestone ? (
                    <Pressable onPress={() => openEditor(entry)} hitSlop={6}>
                      <Text style={styles.metaAction}>Edit</Text>
                    </Pressable>
                  ) : null}
                  {isOwn && !isMilestone ? (
                    <Pressable onPress={() => toggleHidden(entry)} hitSlop={6}>
                      <Text style={styles.metaAction}>{entry.hidden ? 'Hidden · show' : 'Hide'}</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            </Pressable>
          );
        })
      )}

      <Modal visible={editing !== null} transparent animationType="fade" onRequestClose={() => setEditing(null)}>
        <Pressable style={styles.backdrop} onPress={() => setEditing(null)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.sheetTitle}>{editing?.title}</Text>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="finally — the 4:30 alarms are paying off"
              multiline
              maxLength={280}
              style={styles.input}
            />
            <View style={styles.sheetActions}>
              {/* Clearing is saving an empty note, not a separate destructive action — the server
                  stores null for blank, so one path covers both. */}
              <Pressable onPress={() => setDraft('')} hitSlop={8}>
                <Text style={styles.clear}>Clear</Text>
              </Pressable>
              <Pressable onPress={saveNote} disabled={saving} style={styles.save} accessibilityRole="button">
                <Text style={styles.saveText}>{saving ? 'Saving…' : 'Save'}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

/** Leading art, masked per subject — the same shapes the bell feed uses, from the same resolver. */
function Art({ url, shape }: { url: string | null; shape: NotificationImageShape }) {
  if (!url) {
    return (
      <View style={[styles.art, styles.artFallback]}>
        <FlameLogo size={20} />
      </View>
    );
  }
  return <Image source={{ uri: url }} style={[styles.art, { borderRadius: SHAPE_RADIUS[shape] }]} contentFit="cover" />;
}

const styles = StyleSheet.create({
  section: {
    marginTop: Spacing.four,
    gap: Spacing.twelve,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heading: {
    fontFamily: Fonts.bodyBold,
    fontSize: 15,
    color: Colors.ink,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(242,163,60,0.14)',
    borderRadius: Radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  addText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11.5,
    color: Colors.ember,
  },
  empty: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.muted,
    lineHeight: 18,
  },
  row: {
    flexDirection: 'row',
    gap: Spacing.twelve,
  },
  art: {
    width: ART,
    height: ART,
    backgroundColor: Colors.disabled,
  },
  artFallback: {
    borderRadius: Radius.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Milestones lead with a ribbon rather than the flame: the flame is the effort economy's mark
  // everywhere else in the app, and a milestone is precisely the thing that earned none of it.
  milestoneArt: {
    backgroundColor: 'rgba(242,163,60,0.14)',
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13.5,
    color: Colors.ink,
  },
  body: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.muted,
  },
  // The note is the point of the row, so it is set as speech rather than as another metadata line.
  note: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.warmSubtext,
    fontStyle: 'italic',
    marginTop: 3,
    lineHeight: 18,
  },
  addNote: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.ember,
    marginTop: 3,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.twelve,
    marginTop: 3,
  },
  time: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.textTertiary,
  },
  metaAction: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 10.5,
    color: Colors.textTertiary,
  },
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
    gap: Spacing.three,
  },
  sheetTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 15,
    color: Colors.ink,
  },
  input: {
    minHeight: 84,
    textAlignVertical: 'top',
  },
  sheetActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
