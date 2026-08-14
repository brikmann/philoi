import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { BoxArt, BOX_TINT } from '@/components/economy/box-art';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import type { BoxStack } from '@/hooks/use-inventory';
import { BOXES, OPEN_COUNTS, type BoxKey } from '@/lib/economy/boxes';
import { RARITY_COLOR, RARITY_LABEL } from '@/lib/economy/rarity';

// How many of a stack to open at once (punchlist 9 §4). Unlike the shop's buy-and-open these boxes
// already EXIST as loot_boxes rows, so there's nothing to purchase — this is pure batch selection.
//
// A stack of 2–4 gets an "open the lot" button instead of a bare "Open 1". Without it, condensing
// tiles would be a regression for small stacks: three tiles used to mean three taps, and a single
// tile offering only ×1 would mean three taps AND three trips through this sheet.
function openOptions(count: number): number[] {
  if (count > 1 && count < 5) return [1, count];
  return OPEN_COUNTS.filter((n) => n <= count);
}

type Props = {
  stack: BoxStack | null;
  onOpen: (count: number) => void;
  onClose: () => void;
};

export function BoxStackSheet({ stack, onOpen, onClose }: Props) {
  const box = stack ? BOXES[stack.boxKey as BoxKey] : undefined;

  return (
    <Modal visible={!!stack && !!box} animationType="fade" transparent onRequestClose={onClose}>
      {stack && box ? (
        <View style={styles.scrim}>
          <View style={styles.sheet}>
            <View style={[styles.art, { backgroundColor: BOX_TINT[box.key] }]}>
              <BoxArt boxKey={box.key} size={54} />
            </View>
            <Text style={styles.name}>
              {box.name} ×{stack.count}
            </Text>
            <Text style={[styles.rarity, { color: RARITY_COLOR[box.rarity] }]}>{RARITY_LABEL[box.rarity]} BOX</Text>

            {/* Provenance survives the grouping. A stack that's all earned says so in one line; a
                mixed one is itemised rather than averaged into a vague "various", because how a box
                was come by is the part that isn't fungible (§0.3). */}
            <View style={styles.sources}>
              {stack.sources.map((s) => (
                <Text key={s.label} style={styles.sourceLine} numberOfLines={2}>
                  {stack.sources.length > 1 || s.count > 1 ? `${s.count} · ` : ''}
                  {s.label}
                </Text>
              ))}
            </View>

            <View style={styles.ctas}>
              {openOptions(stack.count).map((n) => (
                <Pressable
                  key={n}
                  style={[styles.btn, n === 1 ? styles.btnGhost : styles.btnPrimary]}
                  onPress={() => onOpen(n)}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${n} ${box.name}`}>
                  <Text style={n === 1 ? styles.btnGhostText : styles.btnPrimaryText}>
                    {n === stack.count && n > 1 ? `Open all ${n}` : `Open ${n}`}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Pressable style={styles.plainBtn} onPress={onClose}>
              <Text style={styles.plainBtnText}>Not now</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(10,8,14,0.62)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.card,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.five,
    alignItems: 'center',
  },
  art: {
    width: 78,
    height: 78,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: {
    fontFamily: Fonts.bodyBold,
    fontSize: 20,
    color: Colors.ink,
    marginTop: Spacing.three,
    textAlign: 'center',
  },
  rarity: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9.5,
    letterSpacing: 1.4,
    marginTop: Spacing.half,
  },
  sources: {
    alignSelf: 'stretch',
    backgroundColor: Colors.cardDark,
    borderRadius: Radius.card,
    padding: Spacing.twelve,
    gap: 3,
    marginTop: Spacing.three,
  },
  sourceLine: {
    fontFamily: Fonts.body,
    fontSize: 11,
    lineHeight: 16,
    color: Colors.muted,
    textAlign: 'center',
  },
  ctas: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.four,
  },
  btn: {
    flex: 1,
    borderRadius: 13,
    paddingVertical: 13,
    alignItems: 'center',
  },
  btnPrimary: {
    backgroundColor: Colors.plum,
  },
  btnGhost: {
    backgroundColor: Colors.cardDark,
  },
  btnPrimaryText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13.5,
    color: Colors.ink,
  },
  btnGhostText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13.5,
    color: '#c79bec',
  },
  plainBtn: {
    paddingVertical: Spacing.two,
    marginTop: Spacing.two,
  },
  plainBtnText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.muted,
  },
});
