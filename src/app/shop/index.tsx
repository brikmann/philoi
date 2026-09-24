import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BoxArt, BOX_TINT } from '@/components/economy/box-art';
import { EmberIcon } from '@/components/economy/ember-icon';
import { EmberAmount, EmberPill, RarityLabel, SectionLabel, formatEmbers } from '@/components/economy/economy-bits';
import { ItemArt } from '@/components/economy/item-art';
import { FlamePassTile } from '@/components/pass/flame-pass-tile';
import { PreviewBadgeCorner } from '@/components/economy/preview-button';
import { Screen } from '@/components/ui/screen';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useCoachMark } from '@/hooks/use-coach-mark';
import { useGatedInterval } from '@/hooks/use-motion-active';
import { useInventory } from '@/hooks/use-inventory';
import { BOX_LIST } from '@/lib/economy/boxes';
import { boxPool, type CatalogItem } from '@/lib/economy/catalog';
import { EMBER_PACKS, levelFromXp, passOnSale, seasonPhase } from '@/lib/economy/forge-pass';
import { DIRECT_BUY_PRICE, RARITY_COLOR } from '@/lib/economy/rarity';
import { FORGE_PASS_PRODUCT_ID, storeProductId } from '@/lib/economy/iap';
import { useAuth } from '@/lib/auth/auth-context';
import { formatWeekCountdown, nextWeekReset, weekIndex } from '@/lib/time/week';
import { isBillingConfigured } from '@/lib/billing';
import { useProductPrices, usePurchase } from '@/hooks/use-purchase';

// The week the Featured row is dealt from (§8.4). Read ONCE at module load rather than in render:
// Date.now() is impure, and this project runs the React Compiler, which correctly refuses an
// impure call inside a useMemo — an unstable value there would reshuffle the row on any
// re-render. A week-granularity rotation has nothing to gain from being recomputed per frame.
//
// The week boundary comes from the shared helper now (punchlist 8 §5). This used to floor
// `Date.now() / WEEK_MS` directly, which anchors to the Unix epoch — a Thursday — so the shop
// rotated on a different weekday than every other weekly timer in the app.
const WEEK_INDEX = weekIndex();
const NEXT_ROTATION_MS = nextWeekReset();

// §8.4 — the Featured row rotates. Only box-pool cosmetics are ever direct-buyable; the picks are
// derived from the week number so they're stable for everyone for seven days without needing a
// server table.
//
// The pool this indexes into MUST be the full catalog pool, not an owned-filtered one (punchlist
// 8 §2). Filtering first made `pool.length` a function of what you own, so buying one item changed
// the modulus and re-dealt the entire row mid-week — the rotation looked random and the weekly
// promise was a lie. Ownership is a render concern now: an owned pick stays in its slot and reads
// as sold out. With nothing user-specific left in the derivation it belongs at module scope beside
// WEEK_INDEX, not in a useMemo.
const FEATURED: CatalogItem[] = (() => {
  const pool = boxPool();
  if (pool.length === 0) return [];
  const offset = WEEK_INDEX % pool.length;
  return Array.from({ length: Math.min(5, pool.length) }, (_, i) => pool[(offset + i * 7) % pool.length]);
})();

/**
 * "Rotates in 3d 4h 12m" — the header action on the Featured row, replacing a static "Rotates
 * weekly" that said nothing about when (punchlist 8 §2).
 *
 * Past the boundary the row on screen is genuinely stale: WEEK_INDEX and FEATURED were fixed when
 * the bundle loaded, and only a relaunch re-deals them. Saying so is better than counting down
 * past zero or claiming a rotation that hasn't visibly happened.
 */
function rotatesInLabel(now: number): string {
  const left = NEXT_ROTATION_MS - now;
  if (left <= 0) return 'New picks on reopen';
  return `Rotates in ${formatWeekCountdown(left)}`;
}

// The Forge Shop (mock 56, 21g). Reached from Home's top-right and OPEN TO EVERYONE — there is no
// subscription to gate on, and gating the shop would contradict the whole model: the Flame Pass is
// one purchasable item *inside* the shop, not a wall around it.
//
// Four sections, top → bottom: the Pass hero, the Featured direct-buy row, the six loot boxes, and
// ember packs. Everything except the ember packs works today on EARNED embers.

export default function ShopScreen() {
  const shopCoachRef = useCoachMark('shop');
  const router = useRouter();
  const { embers, pass, ownedKeys, loading } = useInventory();

  // LEVEL, not tier — the Flame Pass counts in levels and the rank ladder counts in tiers, and the
  // two must never share a word (code prompt §"Copy rule").
  const level = pass ? levelFromXp(pass.pass_xp).level : 0;
  const ownsPremium = pass?.owns_premium ?? false;
  // The pass is only purchasable inside the season window (§3). Outside it the hero still renders —
  // it's the season's shopfront — but the buy CTA is replaced rather than left live.
  const phase = seasonPhase();
  const { profile } = useAuth();
  const onSale = passOnSale(phase, profile?.is_dev);

  // Minute-granularity countdown to the next rotation. Ticked rather than computed once so a shop
  // left open doesn't sit there claiming the row rotates in a time that's already passed.
  const [now, setNow] = useState(() => Date.now());
  useGatedInterval(() => setNow(Date.now()), 30_000);

  // Real money now runs through RevenueCat (#71). usePurchase handles the not-configured case
  // itself, so there is no longer a hard-coded dead end here — a build without SDK keys explains
  // itself, and a build with them charges.
  const { buy, busy } = usePurchase();
  const billingLive = isBillingConfigured();
  // Prices come from the STORE, localized per country — never from a literal in the codebase, which
  // could disagree with what the card is actually charged.
  const prices = useProductPrices();

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.top}>
          <Pressable onPress={() => router.back()} hitSlop={10} accessibilityLabel="Back">
            <Ionicons name="chevron-back" size={22} color={Colors.ink} />
          </Pressable>
          <Text style={styles.title}>Shop</Text>
          {/* Until now the ONLY route into the inventory was "Collect all → Inventory" after a box
              open, so everything bought outside that flow landed somewhere the user had no way to
              reach — which reads as "the purchase did nothing" (punchlist 8 §3). */}
          <Pressable
            onPress={() => router.push('/inventory')}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Your inventory">
            <Ionicons name="cube-outline" size={21} color={Colors.ember} />
          </Pressable>
          <EmberPill embers={embers} />
        </View>

        {/* ── Flame Pass hero (mock 214) ──
            The card owns its own copy, countdown, art and CTA now. What lived here was a flat plum
            slab that named the season three times and never once showed it; the tile shows the
            actual Emberfall set. The two destinations are unchanged: the body previews the track,
            the CTA opens the paywall (mock 200) rather than the store sheet — the case for the
            season lives on one screen instead of being re-made everywhere the Pass is mentioned. */}
        <FlamePassTile
          level={level}
          ownsPremium={ownsPremium}
          price={prices[FORGE_PASS_PRODUCT_ID] ?? null}
          onSale={onSale}
          onOpen={() => router.push('/forge-pass')}
          onBuy={() => router.push('/paywall')}
        />

        {/* ── Featured · direct buy (§8.4) ── */}
        <SectionLabel label="Featured · buy direct" action={rotatesInLabel(now)} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
          {FEATURED.map((item) => {
            const owned = ownedKeys.has(item.id);
            return (
              <Pressable
                key={item.id}
                style={[styles.tile, owned && styles.tileOwned]}
                onPress={() => router.push({ pathname: '/shop/item/[itemId]', params: { itemId: item.id } })}>
                {/* The same 3px rarity rule the inventory grid wears (mock 216) — a featured pick
                    and the copy of it you already own read as the same object. */}
                <View style={[styles.rarityBar, { backgroundColor: RARITY_COLOR[item.rarity] }]} />
                <View style={[styles.tileArt, { backgroundColor: Colors.cardDark }]}>
                  <ItemArt item={item} size={44} />
                  {/* Audition without leaving the row (PUNCHLIST_11) — a thumb can run down the
                      featured strip and hear each one. Starting any preview stops the last. */}
                  <PreviewBadgeCorner item={item} />
                </View>
                <Text style={styles.tileName} numberOfLines={1}>
                  {item.name}
                </Text>
                <RarityLabel rarity={item.rarity} />
                {/* Owned picks hold their slot for the rest of the week rather than vanishing —
                    the row is a fixed weekly set, and a gap that healed itself would be the same
                    reshuffle in a different costume. Still tappable: the detail screen is where
                    the lore and the salvage value live. */}
                {owned ? (
                  <Text style={styles.tileOwnedText}>OWNED</Text>
                ) : (
                  <EmberAmount amount={DIRECT_BUY_PRICE[item.rarity]} containerStyle={styles.tilePrice} />
                )}
              </Pressable>
            );
          })}
        </ScrollView>
        <Text style={styles.note}>
          A guaranteed item costs more than the gamble. Earned titles, medals, relics and Pass-exclusives are never
          for sale.
        </Text>

        {/* ── The six boxes ── */}
        <SectionLabel label="Loot boxes" />
        {/* First visit to the Shop (CODE_PROMPT_coach_marks.md). Anchored on the crate row rather
            than on an "Open ×N" button, because that button lives one screen deeper on
            shop/box/[boxKey] — the tip has to point at a control that is actually on this screen,
            and the row is the one that leads to the batch open. */}
        <View ref={shopCoachRef} collapsable={false}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
            {BOX_LIST.map((box) => (
              <Pressable
                key={box.key}
                style={styles.tile}
                onPress={() => router.push({ pathname: '/shop/box/[boxKey]', params: { boxKey: box.key } })}>
                <View style={[styles.rarityBar, { backgroundColor: RARITY_COLOR[box.rarity] }]} />
                <View style={[styles.tileArt, { backgroundColor: BOX_TINT[box.key] }]}>
                  <BoxArt boxKey={box.key} size={44} pedestal />
                </View>
                <Text style={styles.tileName} numberOfLines={1}>
                  {box.name}
                </Text>
                <RarityLabel rarity={box.rarity} />
                <EmberAmount amount={box.price} containerStyle={styles.tilePrice} />
              </Pressable>
            ))}
          </ScrollView>
        </View>
        <Text style={styles.note}>Published odds on every box. Every box can also be earned — none is purchase-only.</Text>

        {/* ── Ember packs — the only real-money surface, and it's deferred ── */}
        <SectionLabel label="Buy embers" />
        <View style={styles.packs}>
          {EMBER_PACKS.map((pack) => (
            <Pressable
              key={pack.key}
              style={[styles.pack, pack.best && styles.packBest, busy && styles.packBusy, !billingLive && styles.packOff]}
              disabled={busy}
              // storeProductId, not pack.productId: vault's Play id is `.vault2`, and asking the
              // store for the iOS id on Android finds no package and refuses the sale.
              onPress={() => buy(storeProductId(pack))}
              accessibilityRole="button"
              // The TOTAL is what's read out and what lands — the base/bonus split is a visual.
              accessibilityLabel={`Buy ${pack.name}, ${formatEmbers(pack.embers)} embers${
                pack.bonus > 0 ? ` including a ${formatEmbers(pack.bonus)} bonus` : ''
              }${prices[storeProductId(pack)] ? `, ${prices[storeProductId(pack)]}` : ''}`}>
              {pack.best ? (
                <View style={styles.bestTag}>
                  <Text style={styles.bestTagText}>BEST</Text>
                </View>
              ) : null}
              <View style={styles.packLeft}>
                <View style={styles.packAmtRow}>
                  <EmberIcon size={14} />
                  <Text style={styles.packAmt}>{formatEmbers(pack.base)}</Text>
                  {pack.bonus > 0 ? (
                    <View style={styles.bonusTag}>
                      <Text style={styles.bonusTagText}>+{formatEmbers(pack.bonus)}</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.packSub}>{pack.name}</Text>
              </View>
              <View style={styles.packPrice}>
                {/* An em-dash until the store answers. Deliberately NOT a hardcoded fallback: a
                    literal that disagrees with the real charge is worse than a blank. */}
                <Text style={styles.packPriceText}>{prices[storeProductId(pack)] ?? '—'}</Text>
              </View>
            </Pressable>
          ))}
        </View>
        <Text style={styles.note}>
          {billingLive
            ? 'Embers you earn by locking in buy everything here — packs are a shortcut, never a requirement.'
            : 'Real-money purchases need the next native build. Embers you earn by locking in already buy everything here.'}
        </Text>

        {/* Rule 0, stated where money is asked for. */}
        <Text style={styles.rule}>
          Cosmetics and currency only. Nothing here buys XP, rank, streaks, or a place on any leaderboard.
        </Text>

        {loading ? <Text style={styles.note}>Loading your embers…</Text> : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.six,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
  },
  title: {
    fontFamily: Fonts.bodyBold,
    fontSize: 20,
    color: Colors.ink,
    flex: 1,
  },
  packBusy: {
    opacity: 0.6,
  },
  // Dimmed only while the SDK keys are absent — a live button that can actually charge should look
  // live. This used to be baked into `pack` itself, back when every one of them was a stub.
  packOff: {
    opacity: 0.55,
  },
  row: {
    gap: Spacing.two,
    paddingBottom: Spacing.half,
  },
  tile: {
    width: 96,
    backgroundColor: Colors.cardDark,
    borderRadius: 14,
    // Clips the rarity bar to the tile's corners.
    overflow: 'hidden',
    paddingTop: Spacing.twelve,
    paddingBottom: Spacing.two,
    paddingHorizontal: Spacing.two,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.line,
  },
  rarityBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    opacity: 0.9,
  },
  tileArt: {
    width: 54,
    height: 54,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.two,
  },
  tileName: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10.5,
    color: Colors.ink,
    textAlign: 'center',
  },
  tilePrice: {
    marginTop: 6,
  },
  tileOwned: {
    opacity: 0.5,
  },
  tileOwnedText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9,
    letterSpacing: 1,
    color: Colors.textTertiary,
    marginTop: 6,
  },
  note: {
    fontFamily: Fonts.body,
    fontSize: 10,
    lineHeight: 15,
    color: Colors.textTertiary,
    marginTop: Spacing.two,
  },
  packs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  pack: {
    width: '48%',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.cardDark,
    borderRadius: 13,
    padding: Spacing.twelve,
    gap: Spacing.two,
  },
  packBest: {
    borderWidth: 1,
    borderColor: Colors.coral,
  },
  bestTag: {
    position: 'absolute',
    top: -8,
    right: 8,
    backgroundColor: Colors.coral,
    borderRadius: Radius.pill,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  bestTagText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 8,
    color: '#fff',
  },
  packLeft: {
    flex: 1,
  },
  packAmtRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  packAmt: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.ember,
  },
  bonusTag: {
    backgroundColor: Colors.achieverBg,
    borderRadius: Radius.pill,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  bonusTagText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9,
    color: Colors.achieverText,
  },
  packSub: {
    fontFamily: Fonts.body,
    fontSize: 9.5,
    color: Colors.textTertiary,
  },
  packPrice: {
    backgroundColor: Colors.selectedBg,
    borderRadius: 9,
    paddingVertical: 5,
    paddingHorizontal: 9,
  },
  packPriceText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11.5,
    color: Colors.ink,
  },
  rule: {
    fontFamily: Fonts.body,
    fontSize: 10,
    lineHeight: 15,
    color: Colors.textTertiary,
    textAlign: 'center',
    marginTop: Spacing.four,
  },
});
