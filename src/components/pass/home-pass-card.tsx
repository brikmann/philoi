import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { NavGlyph } from '@/components/ui/nav-glyph';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useInventory } from '@/hooks/use-inventory';
import { track } from '@/lib/analytics';
import { PASS_LEVELS, SEASON, levelFromXp, seasonPhase } from '@/lib/economy/forge-pass';
import { pluralize } from '@/lib/format';

// THE FLAME PASS ON HOME (mock 306 frame 1) — the Pass's best conversion placement, because Home is
// the screen everyone opens. It rides at the top of the feed (AgoraFeed's `feedHeader`) so it
// reads as part of the feed, not as a banner bolted over it.
//
// Everything here is the same arithmetic /forge-pass draws its track with — levelFromXp over the
// inventory's pass_xp, claims keyed `${tier}:${lane}` — so the "N rewards waiting" on Home is the
// number the Pass screen will show when you land on it. Display only; the server re-derives every
// claim (claim_pass_tier).
//
// "WAITING" COUNTS THE LOCKED PREMIUM LANE for a non-owner, on purpose: those are rewards they have
// already reached and would receive the moment they unlock, which is exactly the pitch. For an
// owner it is the claimable count, and the CTA turns into Claim.

export function HomePassCard() {
  const router = useRouter();
  const { pass } = useInventory();
  const phase = seasonPhase();

  const ownsPremium = pass?.owns_premium ?? false;
  const passXp = pass?.pass_xp ?? 0;
  const { level, intoLevel, nextLevelCost, prestige } = levelFromXp(passXp);

  const waiting = useMemo(() => {
    const claimed = new Set((pass?.claims ?? []).map((c) => `${c.tier}:${c.lane}`));
    let n = 0;
    for (const l of PASS_LEVELS) {
      if (l.level > level) break;
      if (l.free.length && !claimed.has(`${l.level}:free`)) n += 1;
      if (l.premium.length && !claimed.has(`${l.level}:premium`)) n += 1;
    }
    return n;
  }, [pass, level]);

  // Nothing to sell or claim outside the season (the claim window still has claims to make).
  if (phase === 'upcoming' || phase === 'closed' || !pass) return null;

  const claimable = ownsPremium && waiting > 0;
  const cta = !ownsPremium ? 'Unlock' : claimable ? 'Claim' : 'Open';
  const seasonNumber = SEASON.id.replace(/^S/, '');
  const shownLevel = level + prestige;
  const pct = nextLevelCost > 0 ? Math.min(1, intoLevel / nextLevelCost) : 1;
  const toNext = Math.max(0, nextLevelCost - intoLevel);

  function open() {
    track('home_pass_card_tapped', { cta, level: shownLevel, owns_premium: ownsPremium, waiting });
    router.push('/forge-pass');
  }

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={open}
        accessibilityRole="button"
        accessibilityLabel={`Flame Pass, Season ${seasonNumber}. Level ${shownLevel}. ${waiting} rewards waiting. ${cta}`}>
        <LinearGradient
          colors={['rgba(255,122,47,0.22)', 'rgba(185,139,255,0.16)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.card}>
          <View style={styles.row}>
            <View style={styles.ticket}>
              <NavGlyph name="ticket" size={28} color="#FFF2E6" />
            </View>
            <View style={styles.text}>
              <Text style={styles.title} numberOfLines={1}>
                Flame Pass · Season {seasonNumber}
              </Text>
              <Text style={styles.sub} numberOfLines={1}>
                Level {shownLevel}
                {waiting > 0 ? ` · ${waiting} ${pluralize(waiting, 'reward')} waiting` : ''}
              </Text>
            </View>
            <LinearGradient
              colors={[Colors.navEmber, Colors.navEmber2]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.cta}>
              <Text style={styles.ctaText}>{cta}</Text>
            </LinearGradient>
          </View>

          <View style={styles.bar}>
            <LinearGradient
              colors={[Colors.gold, Colors.navEmber2]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={[styles.fill, { width: `${Math.round(pct * 100)}%` }]}
            />
          </View>
          <View style={styles.meta}>
            <Text style={styles.metaText}>Lv {shownLevel}</Text>
            <Text style={styles.metaText}>
              {toNext.toLocaleString()} XP to {level >= SEASON.totalLevels ? 'next prestige' : `Lv ${shownLevel + 1}`}
            </Text>
          </View>
        </LinearGradient>
      </Pressable>

      <Pressable
        style={styles.shop}
        onPress={() => {
          track('home_shop_shortcut_tapped', {});
          router.push('/shop');
        }}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel="Open the shop">
        <Text style={styles.shopText}>Shop ›</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: Spacing.twelve,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#4A3718',
    paddingVertical: 13,
    paddingHorizontal: 14,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  ticket: {
    shadowColor: Colors.navEmber,
    shadowOpacity: 0.6,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  text: {
    flex: 1,
  },
  title: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.ink,
  },
  sub: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    color: Colors.navEmber2,
    marginTop: 2,
  },
  cta: {
    borderRadius: Radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  ctaText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: Colors.onEmber,
  },
  bar: {
    height: 7,
    borderRadius: 5,
    backgroundColor: 'rgba(0,0,0,0.35)',
    marginTop: 11,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 5,
  },
  meta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 5,
  },
  metaText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 10,
    color: Colors.muted,
  },
  // The Shop shortcut, under the card's right edge — a second door into the same economy.
  shop: {
    alignSelf: 'flex-end',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 7,
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: Radius.pill,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  shopText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    color: Colors.navEmber2,
  },
});
