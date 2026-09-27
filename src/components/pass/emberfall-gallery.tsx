import { useEffect, useId } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, LinearGradient, Pattern, RadialGradient, Rect, Stop } from 'react-native-svg';

import { EquippedAvatarHalo } from '@/components/economy/applied-art';
import { ItemArt } from '@/components/economy/item-art';
import { EMBER, EmberfallSeal, Laurel } from '@/components/pass/emberfall-art';
import { RisingEmbers, usePassMotion } from '@/components/pass/pass-motion';
import { Fonts } from '@/constants/theme';
import { getItem, titleLabel, type CatalogItem, type ItemType } from '@/lib/economy/catalog';
import { LEVEL_ZERO_UNLOCK, PASS_LEVELS, passUnlockLevel } from '@/lib/economy/forge-pass';
import { RARITY_COLOR, RARITY_LABEL } from '@/lib/economy/rarity';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// THE SEASON'S COSMETICS — the paywall's gallery (mock 223, "The season's cosmetics").
//
// Each card is a laurel-framed stage with a small render of how the item looks ON YOU (your initial,
// your name), a rarity badge and an unlock tag: "⚡ Instant" for the purchase receipt, "Lv N" for
// the rest. Ordered by unlock level, with the Emberfall Seal (L100) as the highlighted finale.
//
// 🔴 NOTHING ON A CARD IS TYPED IN. The name, lore, rarity and art colours come from catalog.ts;
// the level comes from the pass track via passUnlockLevel(). The one editorial choice here is WHICH
// items are the marquee — the list below. An id the track no longer grants drops out of the
// gallery rather than advertising a level that does not exist.
//
// Every card is tappable: `onOpen` hands the item up, and the owner opens <CosmeticDetailSheet>
// (the full render, the lore, and what the item DOES). The gallery holds no sheet state of its
// own, so the paywall and the pass track share one sheet rather than each growing a copy.
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** The marquee, in the order ties at the same level should show. The Seal is always the finale. */
const MARQUEE_IDS = [
  'flare-emberfall-ascendant',
  'banner-emberfall-mythic',
  'particle-void-smoke',
  'halo-emberfall-mythic',
  'sfx-emberfall-strike',
  'card-emberfall-mythic',
  'relic-emberfall',
  'title-forged-in-ember',
  'medal-emberfall-crown',
] as const;

const FINALE_ID = 'medal-emberfall-crown';

type Marquee = { item: CatalogItem; level: number };

export function emberfallMarquee(): Marquee[] {
  const rows = MARQUEE_IDS.flatMap((id, order) => {
    const item = getItem(id);
    const level = passUnlockLevel(id);
    return item && level !== null ? [{ item, level, order }] : [];
  });
  rows.sort((a, b) => {
    if (a.item.id === FINALE_ID) return 1;
    if (b.item.id === FINALE_ID) return -1;
    return a.level - b.level || a.order - b.order;
  });
  return rows.map(({ item, level }) => ({ item, level }));
}

/**
 * "Across the 100-level track" — the premium lane's OTHER looks, by name, off the same table the
 * grant pays. First few only; the chip row ends in "+ more" rather than listing thirty things.
 */
export function trackHighlights(limit = 5): string[] {
  const marquee = new Set<string>(MARQUEE_IDS);
  const seen = new Set<string>();
  const names: string[] = [];
  for (const r of [...LEVEL_ZERO_UNLOCK, ...PASS_LEVELS.flatMap((l) => l.premium)]) {
    if (r.kind !== 'item' || marquee.has(r.itemId) || seen.has(r.itemId)) continue;
    seen.add(r.itemId);
    const item = getItem(r.itemId);
    if (item) names.push(withTypeWord(titleLabel(item).name, item.type, ' ', true));
  }
  return names.slice(0, limit);
}

const TYPE_WORD: Record<ItemType, string> = {
  FLAME: 'Flame',
  PARTICLE: 'Particle',
  FLARE: 'Flare',
  CARD: 'Card',
  HALO: 'Halo',
  TITLE: 'Title',
  BANNER: 'Banner',
  AUDIO: 'Audio',
  SFX: 'SFX',
  RELIC: 'Relic',
  MEDAL: 'Medal',
};

/** Appends the type word unless the name already ends in it ("Forge Flame", not "Forge Flame Flame"). */
function withTypeWord(name: string, type: ItemType, sep: string, lower = false): string {
  const word = TYPE_WORD[type];
  if (type === 'MEDAL' || name.toLowerCase().endsWith(word.toLowerCase())) return name;
  return `${name}${sep}${lower ? word.toLowerCase() : word}`;
}

/** "Emberfall Ascendant · Flare" on a gallery card and its detail sheet. */
export function cosmeticTitle(item: CatalogItem): string {
  const name = item.type === 'TITLE' ? `“${titleLabel(item).name}”` : item.name;
  return withTypeWord(name, item.type, ' · ');
}

export function EmberfallGallery({ name, onOpen }: { name: string; onOpen: (item: CatalogItem) => void }) {
  const rows = emberfallMarquee();
  return (
    <View style={styles.list}>
      {rows.map(({ item, level }) => (
        <GalleryCard
          key={item.id}
          item={item}
          level={level}
          name={name}
          finale={item.id === FINALE_ID}
          onPress={() => onOpen(item)}
        />
      ))}
    </View>
  );
}

function GalleryCard({
  item,
  level,
  name,
  finale,
  onPress,
}: {
  item: CatalogItem;
  level: number;
  name: string;
  finale: boolean;
  onPress: () => void;
}) {
  const rarity = RARITY_COLOR[item.rarity];
  return (
    <Pressable
      style={({ pressed }) => [styles.card, finale && styles.cardFinale, pressed && styles.cardPressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${cosmeticTitle(item)}, ${RARITY_LABEL[item.rarity]}. Show details`}>
      <View style={[styles.unlock, level === 0 ? styles.unlockNow : styles.unlockLv]}>
        <Text style={[styles.unlockText, level === 0 && styles.unlockTextNow]}>{level === 0 ? '⚡ Instant' : `Lv ${level}`}</Text>
      </View>
      <View style={[styles.rarity, { backgroundColor: rarity }]}>
        <Text style={styles.rarityText}>{RARITY_LABEL[item.rarity].toUpperCase()}</Text>
      </View>

      <View style={styles.stage}>
        <View style={styles.laurelL}>
          <Laurel height={86} />
        </View>
        <View style={styles.laurelR}>
          <Laurel height={86} flip />
        </View>
        <CosmeticRender item={item} name={name} />
      </View>

      <Text style={styles.cname}>{cosmeticTitle(item)}</Text>
      <Text style={styles.clore}>{item.lore}</Text>
    </Pressable>
  );
}

// ─────────────────────────── the renders ───────────────────────────

/** How the item looks ON the viewer — the card's stage, and (scaled up) the detail sheet's. */
export function CosmeticRender({ item, name }: { item: CatalogItem; name: string }) {
  switch (item.type) {
    case 'FLARE':
      return <FlareRender item={item} name={name} />;
    case 'BANNER':
      return <BannerRender item={item} name={name} />;
    case 'PARTICLE':
      return <SmokeRender item={item} name={name} />;
    case 'HALO':
      return (
        <EquippedAvatarHalo haloId={item.id} size={44}>
          <AvatarFill name={name} />
        </EquippedAvatarHalo>
      );
    case 'SFX':
      return <StrikeRender item={item} />;
    case 'CARD':
      return <CardRender item={item} name={name} />;
    case 'TITLE':
      return (
        <View style={styles.center}>
          <Avatar name={name} />
          <Text style={[styles.pname, styles.mt5]}>{name}</Text>
          <Text style={[styles.titleLine, { color: item.art.to }]}>“{titleLabel(item).name}”</Text>
        </View>
      );
    case 'MEDAL':
      return (
        <View style={styles.sealRow}>
          <View>
            <Text style={styles.pname}>{name}</Text>
            <Text style={styles.sealSub}>seal-bearer</Text>
          </View>
          <EmberfallSeal size={34} />
        </View>
      );
    default:
      return <ItemArt item={item} size={64} />;
  }
}

/** The avatar every render wears: a violet disc with your initial. */
function Avatar({ name, size = 44 }: { name: string; size?: number }) {
  return (
    <View style={[styles.av, { width: size, height: size, borderRadius: size / 2 }]}>
      <AvatarFill name={name} size={size} />
    </View>
  );
}

function AvatarFill({ name, size = 44 }: { name: string; size?: number }) {
  const grad = `efAv-${useId()}`;
  return (
    <View style={StyleSheet.absoluteFill}>
      <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id={grad} cx="35%" cy="30%" r="75%">
            <Stop offset="0" stopColor="#4a3a68" />
            <Stop offset="1" stopColor="#241a3a" />
          </RadialGradient>
        </Defs>
        <Circle cx="50%" cy="50%" r="50%" fill={`url(#${grad})`} />
      </Svg>
      <View style={styles.avInitialWrap}>
        <Text style={[styles.avInitial, { fontSize: size * 0.4 }]}>{name.charAt(0).toUpperCase() || '🔥'}</Text>
      </View>
    </View>
  );
}

/** A loop 0→1 for a render, parked mid-way when motion is off. */
function useLoop(duration: number, reverse = true, delay = 0) {
  const run = usePassMotion();
  const t = useSharedValue(0.5);
  useEffect(() => {
    if (!run) {
      cancelAnimation(t);
      t.value = 0.5;
      return;
    }
    t.value = 0;
    t.value = withDelay(delay, withRepeat(withTiming(1, { duration, easing: Easing.inOut(Easing.sin) }), -1, reverse));
  }, [run, t, duration, reverse, delay]);
  return t;
}

/**
 * Emberfall Ascendant — the aura breathing round a profile card, and its flames RISING inside it.
 * That upward motion is the item's signature: the one fire that climbs while the season rains down.
 */
function FlareRender({ item, name }: { item: CatalogItem; name: string }) {
  const t = useLoop(1400);
  const colour = item.flare?.colour ?? item.art.from;
  const aura = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0, 1], [0.45, 0.95]),
    transform: [{ scale: interpolate(t.value, [0, 1], [0.98, 1.05]) }],
  }));
  return (
    <View>
      <Animated.View style={[styles.flareAura, { backgroundColor: colour, shadowColor: colour }, aura]} />
      <View style={[styles.flareCard, { borderColor: `${item.art.to}AA` }]}>
        <RisingEmbers count={7} rise={74} />
        <Avatar name={name} />
        <Text style={[styles.pname, styles.mt5]}>{name}</Text>
      </View>
    </View>
  );
}

function BannerRender({ item, name }: { item: CatalogItem; name: string }) {
  const grad = `efBanner-${useId()}`;
  const stripes = `efStripes-${useId()}`;
  return (
    <View style={styles.banner}>
      <Svg width={150} height={38}>
        <Defs>
          <LinearGradient id={grad} x1="0" y1="0" x2="1" y2="0.6">
            <Stop offset="0" stopColor={item.art.from} />
            <Stop offset="0.45" stopColor={EMBER.e0} />
            <Stop offset="0.7" stopColor={item.art.to} />
            <Stop offset="1" stopColor={item.art.from} />
          </LinearGradient>
          <Pattern id={stripes} width={14} height={38} patternUnits="userSpaceOnUse" patternTransform="skewX(-25)">
            <Rect x="0" y="0" width="6" height="38" fill="rgba(0,0,0,0.12)" />
          </Pattern>
        </Defs>
        <Rect x="0" y="0" width="150" height="38" fill={`url(#${grad})`} />
        <Rect x="0" y="0" width="150" height="38" fill={`url(#${stripes})`} />
      </Svg>
      <View style={styles.bannerName}>
        <Avatar name={name} size={22} />
        <Text style={styles.pname}>{name}</Text>
      </View>
    </View>
  );
}

const PUFFS = [
  { left: -2, delay: 0 },
  { left: 18, delay: 1000 },
  { left: 36, delay: 1800 },
] as const;

function SmokeRender({ item, name }: { item: CatalogItem; name: string }) {
  return (
    <View style={styles.smoke}>
      <Avatar name={name} />
      {PUFFS.map((p) => (
        <Puff key={p.left} left={p.left} delay={p.delay} colour={item.art.to} />
      ))}
    </View>
  );
}

function Puff({ left, delay, colour }: { left: number; delay: number; colour: string }) {
  const run = usePassMotion();
  const t = useSharedValue(0);
  useEffect(() => {
    if (!run) {
      cancelAnimation(t);
      t.value = 0.4;
      return;
    }
    t.value = withDelay(delay, withRepeat(withTiming(1, { duration: 3000, easing: Easing.in(Easing.quad) }), -1, false));
  }, [run, t, delay]);
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0, 0.3, 1], [0, 0.85, 0]),
    transform: [{ translateY: interpolate(t.value, [0, 1], [8, -28]) }, { scale: interpolate(t.value, [0, 1], [0.6, 1.5]) }],
  }));
  return (
    <Animated.View style={[styles.puff, { left, backgroundColor: `${colour}88`, shadowColor: colour }, style]} pointerEvents="none" />
  );
}

function StrikeRender({ item }: { item: CatalogItem }) {
  return (
    <View style={styles.strike}>
      <Ring colour={item.art.to} delay={0} />
      <Ring colour={item.art.to} delay={700} />
      <View style={[styles.strikeCore, { backgroundColor: EMBER.e2, shadowColor: item.art.to }]} />
      <Text style={styles.sfxTag}>▶ sound</Text>
    </View>
  );
}

function Ring({ colour, delay }: { colour: string; delay: number }) {
  const run = usePassMotion();
  const t = useSharedValue(0);
  useEffect(() => {
    if (!run) {
      cancelAnimation(t);
      t.value = 0.5;
      return;
    }
    t.value = withDelay(delay, withRepeat(withTiming(1, { duration: 2200, easing: Easing.out(Easing.quad) }), -1, false));
  }, [run, t, delay]);
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0, 1], [0.9, 0]),
    transform: [{ scale: interpolate(t.value, [0, 1], [0.14, 1]) }],
  }));
  return <Animated.View style={[styles.ring, { borderColor: colour }, style]} pointerEvents="none" />;
}

function CardRender({ item, name }: { item: CatalogItem; name: string }) {
  const grad = `efCard-${useId()}`;
  return (
    <View style={styles.sovOuter}>
      <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id={grad} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={EMBER.e2} />
            <Stop offset="0.5" stopColor={item.art.to} />
            <Stop offset="1" stopColor="#7a1e0e" />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" rx={16} fill={`url(#${grad})`} />
      </Svg>
      <View style={styles.sovInner}>
        <Avatar name={name} />
        <Text style={[styles.pname, styles.mt5]}>{name}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: 13,
  },
  card: {
    backgroundColor: 'rgba(24,15,38,0.95)',
    borderWidth: 1,
    borderColor: EMBER.line,
    borderRadius: 18,
    paddingTop: 16,
    paddingBottom: 14,
    paddingHorizontal: 14,
    overflow: 'hidden',
  },
  cardFinale: {
    borderColor: 'rgba(255,180,90,0.5)',
    backgroundColor: 'rgba(42,22,44,0.96)',
  },
  cardPressed: {
    opacity: 0.85,
  },
  unlock: {
    position: 'absolute',
    top: 11,
    left: 12,
    borderRadius: 999,
    paddingVertical: 3,
    paddingHorizontal: 8,
    zIndex: 5,
  },
  unlockNow: {
    backgroundColor: EMBER.e2,
  },
  unlockLv: {
    backgroundColor: 'rgba(0,0,0,0.42)',
    borderWidth: 1,
    borderColor: EMBER.line,
  },
  unlockText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 8.5,
    letterSpacing: 0.4,
    color: EMBER.warm,
  },
  unlockTextNow: {
    color: '#160a02',
  },
  rarity: {
    position: 'absolute',
    top: 11,
    right: 12,
    borderRadius: 999,
    paddingVertical: 3,
    paddingHorizontal: 8,
    zIndex: 5,
  },
  rarityText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 8,
    letterSpacing: 0.6,
    color: '#160a02',
  },
  stage: {
    height: 106,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 11,
  },
  laurelL: {
    position: 'absolute',
    left: 6,
    top: 10,
    opacity: 0.85,
  },
  laurelR: {
    position: 'absolute',
    right: 6,
    top: 10,
    opacity: 0.85,
  },
  cname: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: EMBER.ink,
    textAlign: 'center',
  },
  clore: {
    fontFamily: Fonts.body,
    fontStyle: 'italic',
    fontSize: 11,
    lineHeight: 15.5,
    color: EMBER.dim,
    textAlign: 'center',
    marginTop: 3,
  },
  center: {
    alignItems: 'center',
  },
  mt5: {
    marginTop: 5,
  },
  av: {
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: EMBER.line2,
  },
  avInitialWrap: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avInitial: {
    fontFamily: Fonts.bodyBold,
    color: EMBER.ink,
  },
  pname: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: EMBER.ink,
  },
  titleLine: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
    letterSpacing: 0.2,
    marginTop: 3,
  },
  sealRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  sealSub: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9,
    letterSpacing: 0.3,
    color: EMBER.e2,
  },
  flareAura: {
    position: 'absolute',
    top: -5,
    left: -5,
    right: -5,
    bottom: -5,
    borderRadius: 18,
    shadowOpacity: 0.9,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
  },
  flareCard: {
    width: 150,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    backgroundColor: EMBER.card,
    overflow: 'hidden',
  },
  banner: {
    width: 150,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: EMBER.line2,
  },
  bannerName: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: EMBER.card,
    paddingVertical: 6,
    paddingHorizontal: 9,
  },
  smoke: {
    width: 44,
    height: 44,
  },
  puff: {
    position: 'absolute',
    top: 4,
    width: 12,
    height: 12,
    borderRadius: 6,
    shadowOpacity: 0.8,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 },
  },
  strike: {
    width: 64,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    width: 58,
    height: 58,
    borderRadius: 29,
    borderWidth: 2,
  },
  strikeCore: {
    width: 14,
    height: 14,
    borderRadius: 7,
    shadowOpacity: 0.9,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  sfxTag: {
    position: 'absolute',
    bottom: -8,
    fontFamily: Fonts.bodyBold,
    fontSize: 8.5,
    color: EMBER.mut,
  },
  sovOuter: {
    width: 130,
    padding: 2,
    borderRadius: 16,
  },
  sovInner: {
    backgroundColor: EMBER.card,
    borderRadius: 14,
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 10,
  },
});
