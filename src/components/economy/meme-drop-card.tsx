import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { EmberAmount, RarityLabel } from '@/components/economy/economy-bits';
import { ItemArt } from '@/components/economy/item-art';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { countdownLabel, dropDateLabel, type MemeDrop } from '@/lib/economy/meme-drops';
import { RARITY_COLOR, rarityGlow } from '@/lib/economy/rarity';

/**
 * This week's Meme Monday drop (0243, weekly since 0255) — the shop's one limited slot.
 *
 * LIVE: the item, its server price and how long is left; tapping opens the buy screen, which the
 * server re-checks. UPCOMING: a locked date and nothing else — the art stays hidden so the drop is
 * still a reveal on the day. `after` is the following drop, shown as a date only.
 */
export function MemeDropCard({
  drop,
  phase,
  after,
  now,
  owned,
  onOpen,
}: {
  drop: MemeDrop;
  phase: 'live' | 'upcoming';
  after: MemeDrop | null;
  now: number;
  owned: boolean;
  onOpen: () => void;
}) {
  const live = phase === 'live';
  const { item } = drop;
  return (
    <View>
      <Pressable
        style={[styles.card, live && { borderColor: RARITY_COLOR[item.rarity] }]}
        onPress={live ? onOpen : undefined}
        disabled={!live}
        accessibilityRole={live ? 'button' : 'text'}
        accessibilityLabel={
          live
            ? `Meme Monday drop: ${item.name}. Ends in ${countdownLabel(drop.endsAt - now)}.`
            : `Next Meme Monday drop unlocks ${dropDateLabel(drop.unlocksAt)}.`
        }>
        <View style={[styles.art, live && { backgroundColor: rarityGlow(item.rarity, 0.22) }]}>
          {live ? <ItemArt item={item} size={64} /> : <Ionicons name="lock-closed" size={26} color={Colors.textTertiary} />}
        </View>
        <View style={styles.body}>
          <Text style={styles.kicker}>{live ? 'MEME MONDAY · LIVE NOW' : 'MEME MONDAY · NEXT DROP'}</Text>
          {live ? (
            <>
              <Text style={styles.name} numberOfLines={1}>
                {item.name}
              </Text>
              <RarityLabel rarity={item.rarity} type={item.type} size={9} />
              <View style={styles.footer}>
                {owned ? <Text style={styles.owned}>OWNED</Text> : <EmberAmount amount={drop.price} />}
                <Text style={styles.clock}>Ends in {countdownLabel(drop.endsAt - now)}</Text>
              </View>
            </>
          ) : (
            <>
              <Text style={styles.name}>{dropDateLabel(drop.unlocksAt)}</Text>
              <Text style={styles.clock}>Unlocks in {countdownLabel(drop.unlocksAt - now)}</Text>
            </>
          )}
        </View>
      </Pressable>
      <Text style={styles.note}>
        {"A new limited drop every Monday. Each is buyable for its week only, then it's gone for good."}
        {after ? ` Next: ${dropDateLabel(after.unlocksAt)}.` : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.twelve,
    backgroundColor: Colors.cardDark,
    borderRadius: Radius.button,
    borderWidth: 1,
    borderColor: Colors.line,
    padding: Spacing.twelve,
  },
  art: {
    width: 84,
    height: 84,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.disabled,
  },
  body: { flex: 1, gap: 3 },
  kicker: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9.5,
    letterSpacing: 1.2,
    color: Colors.ember,
  },
  name: {
    fontFamily: Fonts.bodyBold,
    fontSize: 17,
    color: Colors.ink,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  clock: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 10.5,
    color: Colors.muted,
  },
  owned: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9,
    letterSpacing: 1,
    color: Colors.textTertiary,
  },
  note: {
    fontFamily: Fonts.body,
    fontSize: 10,
    lineHeight: 15,
    color: Colors.textTertiary,
    marginTop: Spacing.two,
  },
});
