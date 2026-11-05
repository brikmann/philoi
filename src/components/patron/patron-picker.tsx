import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { PatronCrestTile } from '@/components/patron/patron-crest-tile';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { fetchPatronRoster, PATRON_SORTS, sortPatrons, type Patron, type PatronSort } from '@/lib/api/patrons';

/**
 * ONE PATRON CARD (mocks 340 / 341) — plain, always: crest · name · official title · "For: …".
 * No trait, no extra descriptor. `inline` is the picker's read ("Zeus, King of the Gods" on one line,
 * For: beneath); the default stacks name / title / for-line like the roster sheet.
 */
export function PatronCard({
  patron,
  selected = false,
  inline = false,
  onPress,
}: {
  patron: Patron;
  selected?: boolean;
  inline?: boolean;
  onPress?: () => void;
}) {
  const body = (
    <>
      <PatronCrestTile patronKey={patron.key} name={patron.name} size={inline ? 44 : 52} />
      <View style={styles.text}>
        {inline ? (
          <Text style={styles.name} numberOfLines={1}>
            {patron.name}
            <Text style={styles.titleInline}>, {patron.title}</Text>
          </Text>
        ) : (
          <>
            <Text style={styles.name}>{patron.name}</Text>
            <Text style={styles.title}>{patron.title}</Text>
          </>
        )}
        <Text style={styles.forLine}>
          <Text style={styles.forLabel}>For: </Text>
          {patron.for_line}
        </Text>
      </View>
      {selected ? <Text style={styles.tick}>✓</Text> : null}
    </>
  );
  if (!onPress) return <View style={styles.card}>{body}</View>;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, selected && styles.cardOn, pressed && styles.pressed]}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${patron.name}, ${patron.title}. For ${patron.for_line}`}>
      {body}
    </Pressable>
  );
}

/**
 * THE PICKER (mock 340) — the twelve as a one-tap list with "Sort: Featured ▾". Sorting by vibe
 * orders by the hidden `represents` trait; the trait itself never appears. No ceremony: a tap is
 * the whole choice, and the host screen saves it.
 */
export function PatronPicker({ value, onChange }: { value: string | null; onChange: (patron: Patron) => void }) {
  const [roster, setRoster] = useState<Patron[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [sort, setSort] = useState<PatronSort>('featured');
  const [sortOpen, setSortOpen] = useState(false);

  useEffect(() => {
    let live = true;
    fetchPatronRoster()
      .then((r) => {
        if (live) setRoster(r);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, []);

  const shown = useMemo(() => (roster ? sortPatrons(roster, sort) : []), [roster, sort]);
  const sortLabel = PATRON_SORTS.find((s) => s.key === sort)?.label ?? 'Featured';

  if (failed) return <Text style={styles.quiet}>Couldn’t load the patrons — you can pick one later from your profile.</Text>;
  if (!roster) return <ActivityIndicator color={Colors.navEmber} style={styles.loader} />;

  return (
    <View>
      <View style={styles.head}>
        <Text style={styles.headLabel}>Pick your patron</Text>
        <Pressable onPress={() => setSortOpen(true)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Sort: ${sortLabel}`}>
          <Text style={styles.sort}>Sort: {sortLabel} ▾</Text>
        </Pressable>
      </View>
      <View style={styles.list} accessibilityRole="radiogroup">
        {shown.map((p) => (
          <PatronCard key={p.key} patron={p} inline selected={value === p.key} onPress={() => onChange(p)} />
        ))}
      </View>

      <Modal visible={sortOpen} transparent animationType="fade" onRequestClose={() => setSortOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setSortOpen(false)} accessibilityLabel="Close">
          <View style={styles.menu}>
            {PATRON_SORTS.map((s) => (
              <Pressable
                key={s.key}
                style={styles.menuRow}
                onPress={() => {
                  setSort(s.key);
                  setSortOpen(false);
                }}
                accessibilityRole="button">
                <Text style={[styles.menuText, s.key === sort && styles.menuTextOn]}>{s.label}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    backgroundColor: 'rgba(26,18,48,0.65)',
  },
  cardOn: {
    borderColor: Colors.navEmber2,
    backgroundColor: 'rgba(255,122,47,0.10)',
  },
  pressed: {
    opacity: 0.85,
  },
  text: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14.5,
    color: Colors.ink,
  },
  titleInline: {
    fontFamily: Fonts.bodySemiBold,
    color: Colors.spaceDim,
  },
  title: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.navEmber2,
    marginTop: 1,
  },
  forLine: {
    fontFamily: Fonts.body,
    fontSize: 12,
    lineHeight: 16,
    color: Colors.spaceDim,
    marginTop: 3,
  },
  forLabel: {
    fontFamily: Fonts.bodyBold,
    color: Colors.spaceFaint,
  },
  tick: {
    fontFamily: Fonts.black,
    fontSize: 16,
    color: Colors.navEmber2,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.two,
  },
  headLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10.5,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: Colors.spaceFaint,
  },
  sort: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.navEmber2,
  },
  list: {
    gap: 8,
  },
  loader: {
    marginVertical: Spacing.four,
  },
  quiet: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.spaceDim,
  },
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(6,4,14,0.6)',
  },
  menu: {
    minWidth: 200,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  menuRow: {
    paddingVertical: 12,
    paddingHorizontal: 18,
  },
  menuText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 14,
    color: Colors.ink,
  },
  menuTextOn: {
    color: Colors.navEmber2,
  },
});
