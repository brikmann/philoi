import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { BoxArt } from '@/components/economy/box-art';
import { EmberIcon } from '@/components/economy/ember-icon';
import { formatEmbers } from '@/components/economy/economy-bits';
import { ItemArt } from '@/components/economy/item-art';
import { Colors, Fonts, Radius } from '@/constants/theme';
import { BOXES } from '@/lib/economy/boxes';
import { getItem } from '@/lib/economy/catalog';
import { LEVEL_ZERO_UNLOCK, PASS_LEVELS, premiumLaneTotals, type PassReward } from '@/lib/economy/forge-pass';
import { RARITY_COLOR, RARITY_LABEL } from '@/lib/economy/rarity';

// "THE SEASON PASS" (mock 200-v2) — a vertical two-lane ladder: FREE on the left, PREMIUM on the
// right, level nodes down a centre spine.
//
// Only the ROW SELECTION lives here. Every reward drawn comes from LEVEL_ZERO_UNLOCK and PASS_LEVELS
// — the tables grant_forge_pass and claim_pass_level pay against — so what the paywall shows behind
// the lock is exactly what the purchase unlocks. (The mock's stand-in rows — an Emberfall flame at
// Level 1, a halo at 10 — aren't what those levels actually pay, so the real rows differ from it.)
//
// COPY RULE: LEVELS, NOT TIERS. `tier` is reserved for the rank ladder everywhere in this app (see
// forge-pass.ts); the mock's "100 tiers" loses to that rule, as it did on the previous paywall.

/** Which levels get a row: the receipt, the first climb, then the milestones up to the apex. */
const LADDER_LEVELS = [0, 1, 10, 25, 50, 75, 100] as const;

/** Each lane shows at most this many rewards per row, so the ladder stays scannable. */
const PER_LANE = 2;

function laneFor(level: number): { free: PassReward[]; premium: PassReward[] } {
  if (level === 0) return { free: [], premium: LEVEL_ZERO_UNLOCK };
  const row = PASS_LEVELS[level - 1];
  return row ? { free: row.free, premium: row.premium } : { free: [], premium: [] };
}

export function PassLadder({ level }: { level: number }) {
  // The "you are here" marker sits on the last row the user has reached, floored at Level 1 — Level
  // 0 is a purchase, not a climb, so nobody is "on" it before they've bought.
  const reached = Math.max(1, level);
  const here = [...LADDER_LEVELS].reverse().find((l) => l !== 0 && l <= reached) ?? 1;

  return (
    <View style={styles.box}>
      <View style={styles.head}>
        <Text style={[styles.headText, styles.headFree]}>FREE — everyone</Text>
        <Text style={[styles.headText, styles.headPrem]}>PREMIUM — Flame Pass 🔒</Text>
      </View>
      <View>
        <View style={styles.spine} pointerEvents="none" />
        {LADDER_LEVELS.map((lv) => {
          const lanes = laneFor(lv);
          return (
            <View key={lv} style={[styles.row, lv === 0 && styles.rowZero]}>
              <View style={[styles.lane, styles.laneFree]}>
                {lanes.free.slice(0, PER_LANE).map((r, i) => (
                  <RewardChip key={i} reward={r} premium={false} />
                ))}
              </View>
              <View style={[styles.node, lv === here && styles.nodeHere]}>
                <Text style={styles.nodeText}>{lv === 0 ? 'LV' : lv}</Text>
                {lv === 0 ? <Text style={styles.nodeSub}>0</Text> : null}
              </View>
              <View style={[styles.lane, styles.lanePrem]}>
                {/* Level 0 is the receipt, so it shows everything the purchase hands over. */}
                {lanes.premium.slice(0, lv === 0 ? lanes.premium.length : PER_LANE).map((r, i) => (
                  <RewardChip key={i} reward={r} premium />
                ))}
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function RewardChip({ reward, premium }: { reward: PassReward; premium: boolean }) {
  const content = chipContent(reward);
  if (!content) return null;
  return (
    <View style={[styles.chip, premium ? styles.chipPrem : styles.chipFree]}>
      {content.art}
      <Text style={[styles.chipText, premium ? styles.chipTextPrem : styles.chipTextFree]} numberOfLines={1}>
        {content.label}
      </Text>
      {content.rarity ? (
        <Text style={[styles.rarity, { color: RARITY_COLOR[content.rarity] }]}>
          {RARITY_LABEL[content.rarity].slice(0, 4)}
        </Text>
      ) : null}
      {premium ? <Ionicons name="lock-closed" size={8} color={Colors.ember} style={styles.lock} /> : null}
    </View>
  );
}

function chipContent(reward: PassReward) {
  switch (reward.kind) {
    case 'embers':
      return { art: <EmberIcon size={14} />, label: formatEmbers(reward.amount), rarity: null };
    case 'box':
      return { art: <BoxArt boxKey={reward.box} size={18} />, label: BOXES[reward.box].name, rarity: null };
    case 'item': {
      const item = getItem(reward.itemId);
      if (!item) return null;
      // Only the rare end earns a chip — a "COMM" tag on every drip row would be noise.
      const loud = item.rarity === 'mythic' || item.rarity === 'legendary';
      return {
        art: <ItemArt item={item} size={18} />,
        label: item.name.replace(/^"|"$/g, ''),
        rarity: loud ? item.rarity : null,
      };
    }
    case 'badge':
      return { art: <Ionicons name="ribbon" size={14} color={Colors.ember} />, label: reward.label, rarity: null };
  }
}

/** The earn summary under the ladder — counted off the track, never typed in. */
export function EarnSummary() {
  const totals = premiumLaneTotals();
  return (
    <View style={styles.earn}>
      <View style={styles.earnCard}>
        <EmberIcon size={22} />
        <Text style={styles.earnBig}>{formatEmbers(totals.embers)}</Text>
        <Text style={styles.earnLabel}>embers on the{'\n'}premium lane</Text>
      </View>
      <View style={styles.earnCard}>
        <BoxArt boxKey="hephaestus" size={24} />
        <Text style={styles.earnBig}>{totals.boxes}</Text>
        <Text style={styles.earnLabel}>exclusive loot{'\n'}boxes, premium-only</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: '#18121F',
    borderWidth: 1,
    borderColor: 'rgba(242,163,60,0.16)',
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  head: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 6,
    paddingBottom: 8,
  },
  headText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9,
    letterSpacing: 0.5,
  },
  headFree: {
    color: '#8a7fa6',
  },
  headPrem: {
    color: Colors.ember,
  },
  spine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: '50%',
    width: 3,
    marginLeft: -1.5,
    borderRadius: 2,
    backgroundColor: 'rgba(242,163,60,0.55)',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
    gap: 6,
  },
  rowZero: {
    backgroundColor: 'rgba(245,64,28,0.08)',
    borderRadius: 12,
    paddingVertical: 9,
    marginBottom: 2,
  },
  lane: {
    flex: 1,
    gap: 4,
  },
  laneFree: {
    alignItems: 'flex-end',
    opacity: 0.75,
  },
  lanePrem: {
    alignItems: 'flex-start',
  },
  node: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#4A2F1C',
    borderWidth: 1,
    borderColor: Colors.amber,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nodeHere: {
    borderWidth: 2,
    borderColor: Colors.ember,
    shadowColor: Colors.amber,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 8,
    elevation: 6,
  },
  nodeText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: '#FFE7B0',
    lineHeight: 14,
  },
  nodeSub: {
    fontFamily: Fonts.bodyBold,
    fontSize: 7,
    color: '#C9A06A',
    lineHeight: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    maxWidth: '100%',
    borderRadius: 9,
    borderWidth: 1,
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  chipFree: {
    backgroundColor: '#211A30',
    borderColor: 'rgba(255,255,255,0.06)',
  },
  chipPrem: {
    backgroundColor: 'rgba(242,163,60,0.1)',
    borderColor: 'rgba(242,163,60,0.35)',
  },
  chipText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9,
    flexShrink: 1,
  },
  chipTextFree: {
    color: '#B8ABCF',
  },
  chipTextPrem: {
    color: '#FFE7B0',
  },
  rarity: {
    fontFamily: Fonts.bodyBold,
    fontSize: 6.5,
    letterSpacing: 0.4,
  },
  lock: {
    opacity: 0.8,
  },
  earn: {
    flexDirection: 'row',
    gap: 9,
  },
  earnCard: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: '#1F1629',
    borderWidth: 1,
    borderColor: 'rgba(242,163,60,0.2)',
    borderRadius: Radius.card + 2,
    paddingVertical: 12,
    paddingHorizontal: 10,
    gap: 2,
  },
  earnBig: {
    fontFamily: Fonts.bodyBold,
    fontSize: 20,
    color: Colors.ember,
  },
  earnLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 8.5,
    lineHeight: 11,
    color: '#9B8FB2',
    textAlign: 'center',
  },
});
