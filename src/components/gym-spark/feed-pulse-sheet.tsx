import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmberSearchBar } from '@/components/ui/ember-search-bar';
import { FlameLogo } from '@/components/ui/flame-logo';
import { Colors, Fonts, Spacing } from '@/constants/theme';

// THE PULSE PICKER (v2 §8, mock 410) — long-press the Feed's {program} / {patron} chip and this sheet
// lists every option: tile · name · one-line tagline, the active one ringed with a ✓. A tap hands the
// pick back and the host re-filters the feed (the same get_gym_feed filter as the chip's own value).
// It owns no network: the host passes the options (null while loading) and whether the load failed.

export type PulseOption = {
  key: string;
  name: string;
  tagline: string;
  /** The 36×36 crest / emoji tile, already drawn by the host. */
  tile: ReactNode;
  /** Extra text the search matches (a program's short label). */
  search?: string;
};

type Props = {
  visible: boolean;
  title: string;
  /** Right of the title: "12 total" / "48 programs". */
  countLabel: string;
  options: PulseOption[] | null;
  failed?: boolean;
  /** Pinned search field above the list (programs — the list can be long). */
  searchable?: boolean;
  activeKey: string | null;
  onPick: (option: PulseOption) => void;
  onClose: () => void;
};

export function FeedPulseSheet({ visible, title, countLabel, options, failed, searchable, activeKey, onPick, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!options || !q) return options ?? [];
    return options.filter((o) => o.name.toLowerCase().includes(q) || (o.search?.toLowerCase().includes(q) ?? false));
  }, [options, query]);

  function close() {
    setQuery('');
    onClose();
  }

  const total = options?.length ?? 0;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <Pressable style={styles.scrim} onPress={close} accessibilityLabel="Close">
        <Pressable style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, Spacing.three) }]} onPress={() => {}}>
          <View style={styles.handle} />
          <View style={styles.head}>
            <FlameLogo size={18} />
            <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
              {title}
            </Text>
            <Text style={styles.count}>{countLabel}</Text>
          </View>

          {searchable ? (
            <EmberSearchBar value={query} onChangeText={setQuery} placeholder="Search programs" style={styles.search} />
          ) : null}

          {failed ? (
            <Text style={styles.quiet}>Couldn’t load the list. Close and try again.</Text>
          ) : options === null ? (
            <ActivityIndicator color={Colors.navEmber} style={styles.loader} />
          ) : (
            <FlatList
              data={shown}
              keyExtractor={(o) => o.key}
              style={styles.list}
              keyboardShouldPersistTaps="handled"
              accessibilityRole="radiogroup"
              renderItem={({ item }) => {
                const on = item.key === activeKey;
                return (
                  <Pressable
                    onPress={() => {
                      setQuery('');
                      onPick(item);
                    }}
                    style={({ pressed }) => [styles.row, on && styles.rowOn, pressed && styles.pressed]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={item.tagline ? `${item.name}. ${item.tagline}` : item.name}>
                    {item.tile}
                    <View style={styles.text}>
                      <Text style={styles.name} numberOfLines={1}>
                        {item.name}
                      </Text>
                      {item.tagline ? (
                        <Text style={styles.tagline} numberOfLines={1}>
                          {item.tagline}
                        </Text>
                      ) : null}
                    </View>
                    {on ? <Ionicons name="checkmark" size={18} color={Colors.ink} /> : null}
                  </Pressable>
                );
              }}
              ListEmptyComponent={
                <Text style={styles.quiet}>{query.trim() ? `Nothing matches “${query.trim()}”.` : 'Nothing here yet.'}</Text>
              }
            />
          )}

          {total > 0 && !failed ? (
            <Text style={styles.footer}>
              Scroll for all {total}
              {searchable ? ' · or search' : ''}
            </Text>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** The 36×36 r10 tile for an option without a crest (programs): an emoji on a 135° gradient. */
export function PulseEmojiTile({ emoji, colors }: { emoji: string; colors: readonly [string, string] }) {
  return (
    <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.emojiTile}>
      <Text style={styles.emoji}>{emoji}</Text>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(5,3,12,0.82)',
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '78%',
    backgroundColor: Colors.spacePanel,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: Colors.spaceLine,
    paddingHorizontal: Spacing.three,
    paddingTop: 10,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#3a2f55',
    marginBottom: 14,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 4,
    marginBottom: 12,
  },
  title: {
    flex: 1,
    fontFamily: Fonts.bodyBold,
    fontSize: 16,
    fontWeight: '800',
    color: Colors.ink,
  },
  count: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.spaceDim,
  },
  search: {
    marginBottom: 10,
  },
  list: {
    flexGrow: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  rowOn: {
    backgroundColor: 'rgba(255,122,47,0.16)',
    borderColor: 'rgba(255,176,90,0.45)',
  },
  pressed: {
    opacity: 0.75,
  },
  text: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    fontWeight: '800',
    color: Colors.ink,
  },
  tagline: {
    marginTop: 1,
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.spaceDim,
  },
  emojiTile: {
    width: 36,
    height: 36,
    borderRadius: 10,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoji: {
    fontSize: 16,
  },
  quiet: {
    paddingVertical: Spacing.four,
    textAlign: 'center',
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.spaceDim,
  },
  loader: {
    marginVertical: Spacing.five,
  },
  footer: {
    paddingTop: 10,
    textAlign: 'center',
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.spaceDim,
  },
});
