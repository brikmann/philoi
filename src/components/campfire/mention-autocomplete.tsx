import { Image } from 'expo-image';
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts } from '@/constants/theme';
import { MENTION_ALL } from '@/lib/mentions';
import type { CampfireMember } from '@/types/database';

// THE @-AUTOCOMPLETE (mock 101 frame 5).
//
// Opens when the caret is inside an "@…" token and closes the moment it isn't — that decision is
// activeMentionQuery()'s, not this component's; this only draws what it is handed. It is a plain
// absolutely-positioned popover rather than a Modal because it has to sit ABOVE the composer while
// the keyboard is up and the composer keeps focus. A Modal would take focus, dismiss the keyboard,
// and lose the caret position the whole feature depends on.
//
// @all IS FIRST AND ALWAYS PRESENT (mock: "Notify everyone in the campfire"). It is the one entry
// that is not a person, so it is visually separated by its own icon treatment rather than by a
// divider — a divider would read as a section header for a list of one.

const MAX_ROWS = 6;

export function MentionAutocomplete({
  query,
  members,
  myUserId,
  onPick,
  bottom,
}: {
  /** The partial handle after "@", lower-cased. Empty string right after typing "@". */
  query: string;
  members: CampfireMember[];
  myUserId: string;
  onPick: (handle: string) => void;
  /** Sits directly above the composer. */
  bottom: number;
}) {
  const matches = useMemo(() => {
    // You are excluded: mentioning yourself notifies you of your own message, which is noise
    // rather than a feature.
    const pool = members.filter((m) => m.user_id !== myUserId && m.handle);
    if (!query) return pool.slice(0, MAX_ROWS);
    return pool
      .filter(
        (m) =>
          (m.handle ?? '').toLowerCase().includes(query) || m.display_name.toLowerCase().includes(query)
      )
      .slice(0, MAX_ROWS);
  }, [members, myUserId, query]);

  const showAll = MENTION_ALL.startsWith(query);

  // Nothing to offer — the caller keeps the popover mounted while the token is live, so an empty
  // result should collapse rather than leave an empty box hanging over the composer.
  if (!showAll && matches.length === 0) return null;

  return (
    <View style={[styles.pop, { bottom }]}>
      <Text style={styles.head}>MENTION</Text>
      <ScrollView keyboardShouldPersistTaps="always" style={styles.scroll}>
        {showAll && (
          <Pressable style={styles.row} onPress={() => onPick(MENTION_ALL)} accessibilityRole="button">
            <View style={[styles.avatar, styles.avatarAll]}>
              <Text style={styles.avatarAllGlyph}>📢</Text>
            </View>
            <View style={styles.who}>
              <Text style={styles.name}>@all</Text>
              <Text style={styles.sub}>Notify everyone in the campfire</Text>
            </View>
          </Pressable>
        )}

        {matches.map((m) => (
          <Pressable
            key={m.user_id}
            style={styles.row}
            onPress={() => onPick((m.handle ?? '').toLowerCase())}
            accessibilityRole="button"
            accessibilityLabel={`Mention ${m.display_name}`}>
            <View style={styles.avatar}>
              {m.avatar_url ? (
                <Image source={{ uri: m.avatar_url }} style={StyleSheet.absoluteFill} contentFit="cover" />
              ) : (
                <Text style={styles.avatarInitial}>{m.display_name.charAt(0).toUpperCase()}</Text>
              )}
            </View>
            <View style={styles.who}>
              <Text style={styles.name}>{m.display_name}</Text>
              <Text style={styles.sub}>@{m.handle}</Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  pop: {
    position: 'absolute',
    left: 14,
    right: 70,
    backgroundColor: 'rgba(20,14,24,0.97)',
    borderWidth: 1,
    borderColor: Colors.lineStrong,
    borderRadius: 14,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.5,
    shadowRadius: 30,
    elevation: 12,
  },
  head: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
    letterSpacing: 1.4,
    color: Colors.textTertiary,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 6,
  },
  scroll: {
    maxHeight: 232,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.line,
  },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: Colors.plum,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarAll: {
    backgroundColor: Colors.selectedBg,
  },
  avatarAllGlyph: {
    fontSize: 14,
  },
  avatarInitial: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: Colors.ember,
  },
  who: {
    flex: 1,
  },
  name: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 14,
    color: Colors.ink,
  },
  sub: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textTertiary,
    marginTop: 1,
  },
});
