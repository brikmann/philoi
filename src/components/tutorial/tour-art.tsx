import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { CampfireBannerArt } from '@/components/campfire-banner-art';
import { EquippedAvatarHalo, EquippedCardBackdrop } from '@/components/economy/applied-art';
import { BoxArt } from '@/components/economy/box-art';
import { loadoutForItem } from '@/components/economy/cosmetic-render';
import { CrateOpen } from '@/components/economy/crate-open';
import { FlameParticleField, FlarePerimeter, particleMotionFor } from '@/components/economy/flare-perimeter';
import { ForgeStrike } from '@/components/economy/forge-strike';
import { ItemArt } from '@/components/economy/item-art';
import { CosmeticAvatar } from '@/components/economy/public-identity';
import { FLAME_ASPECT_RATIO, FlameSvg } from '@/components/flame-icon';
import { RankBadge } from '@/components/rank-badge';
import { SessionFlame } from '@/components/session-flame';
import { Colors, Fonts } from '@/constants/theme';
import { useReduceMotion } from '@/hooks/use-reduce-motion';
import { BOXES, type BoxKey } from '@/lib/economy/boxes';
import { getItem, titleLabel, type CatalogItem } from '@/lib/economy/catalog';
import { rampFor } from '@/lib/economy/flame-ramp';
import { RARITY_COLOR } from '@/lib/economy/rarity';
import { RANK_TIER_LABEL } from '@/lib/rank-tiers';
import type { RankTierName } from '@/types/database';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// THE TOUR'S REAL ART — design-mocks/239-tutorial-unified.html ("REAL ART").
//
// mini-ui.tsx is still the FRAME every card draws in — the header, the rows, the inert buttons. What
// lives here is the SUBJECT of each card, and it is the shipped renderer, not a picture of it: the
// lock-in flame is SessionFlame, a ring is EquippedAvatarHalo, a crate cracks with CrateOpen, a fuse
// is ForgeStrike. An emoji 🔥 in a tour that is selling cosmetics was selling the wrong thing.
//
// 🔒 STILL INERT, and that is the constraint every component here was chosen against. Each one is
// presentational and is handed a STATIC catalog item — a loadout built with `loadoutForItem`, an
// avatar with `userId={null}` and a loadout supplied so it never self-fetches. Nothing here reads
// the network, starts a session, grants or writes. The one thing two of them do beyond drawing is
// play the box-open sting (CrateOpen, ForgeStrike), which respects the reward-SFX setting.
//
// Reduce Motion is honoured by the shipped components themselves; the two loops authored here (the
// forge's fuse and the haul's tile pulse) gate on it explicitly.
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** Catalog lookup that tolerates a renamed id: the tour drops one tile rather than crashing. */
function item(id: string): CatalogItem | undefined {
  return getItem(id);
}

function items(ids: string[]): CatalogItem[] {
  return ids.map(item).filter((x): x is CatalogItem => Boolean(x));
}

// ─────────────────────────── the flame ───────────────────────────

/** The real lock-in flame. `itemId` previews a flame skin or flare colourway instead of the equipped one. */
export function TourFlame({ height, itemId }: { height: number; itemId?: string }) {
  const it = itemId ? item(itemId) : undefined;
  const ramp = it
    ? it.flare
      ? rampFor({ art: { from: it.flare.colour, to: Colors.ember } })
      : rampFor(it)
    : undefined;
  return <SessionFlame height={height} ramp={ramp} />;
}

/** The brand silhouette at icon size — for MiniHeader's chip and list rows. */
export function FlameGlyph({ size = 12 }: { size?: number }) {
  return <FlameSvg width={size * FLAME_ASPECT_RATIO} height={size} />;
}

// ─────────────────────────── the profile chip ───────────────────────────

/**
 * A profile row wearing `itemId` — the mock's `.prof`. Card backdrop, the real avatar (halo + flare
 * aura), particles drifting round it, the name and the equipped title under it.
 *
 * Every un-previewed slot falls back to the starter loadout (loadoutForItem), so a chip previewing a
 * ring still has a card and a title — a believable profile, not an empty one.
 */
export function ProfileChip({
  name,
  itemId,
  rank = 'Diamond III',
  caption,
}: {
  name: string;
  itemId?: string;
  rank?: string;
  /** Replaces the rank line — the haul's "now wearing · …". */
  caption?: string;
}) {
  const reduceMotion = useReduceMotion();
  const previewed = item(itemId ?? 'halo-base-ring');
  if (!previewed) return null;
  const loadout = loadoutForItem(previewed);
  const flare = loadout.flare?.flare;
  const title = loadout.title;

  return (
    <View style={[styles.chipShell, flare && { borderColor: flare.colour, shadowColor: flare.colour, ...styles.chipFlare }]}>
      <EquippedCardBackdrop cardId={loadout.card?.id} radius={14}>
        <View style={styles.chip}>
          <View style={styles.chipAvatar}>
            {loadout.particle ? (
              <View style={styles.chipParticles} pointerEvents="none">
                <FlameParticleField
                  from={loadout.particle.art.from}
                  to={loadout.particle.art.to}
                  motion={particleMotionFor(loadout.particle.id)}
                />
              </View>
            ) : null}
            <CosmeticAvatar
              userId={null}
              name={name}
              size={30}
              loadout={loadout}
              motion={reduceMotion ? 'reduced' : 'full'}
            />
          </View>
          <View style={styles.chipText}>
            <View style={styles.chipNameRow}>
              {previewed.type === 'FLAME' ? (
                <FlameSvg width={11 * FLAME_ASPECT_RATIO} height={11} ramp={rampFor(previewed)} />
              ) : null}
              <Text style={styles.chipName} numberOfLines={1}>
                {name}
              </Text>
            </View>
            {title ? (
              <Text style={[styles.chipTitle, { color: RARITY_COLOR[title.rarity] }]} numberOfLines={1}>
                ✦ {titleLabel(title).name}
              </Text>
            ) : null}
            <Text style={[styles.chipSub, caption ? styles.chipCaption : null]} numberOfLines={1}>
              {caption ?? rank}
            </Text>
          </View>
        </View>
      </EquippedCardBackdrop>
    </View>
  );
}

// ─────────────────────────── the nine cosmetic types ───────────────────────────

export type CosmeticKind = 'flame' | 'flare' | 'ring' | 'particles' | 'banner' | 'title' | 'sfx' | 'audio' | 'card';

/** The real item each step previews. Real ids, so the rarity chip and the art cannot disagree. */
export const COSMETIC_ITEM: Record<CosmeticKind, string> = {
  flame: 'flame-cosmic-purple',
  flare: 'flare-inferno',
  ring: 'halo-inferno-flare',
  particles: 'particle-ember-swarm',
  banner: 'banner-emberfall-night',
  title: 'title-the-relentless',
  sfx: 'sfx-heavy-anvil-slam',
  audio: 'audio-lofi-lullaby',
  card: 'card-cracked-magma',
};

/** The rarity a step's chip shows — read off the catalog, never typed in beside it. */
export function cosmeticRarity(kind: CosmeticKind) {
  return item(COSMETIC_ITEM[kind])?.rarity ?? 'common';
}

/**
 * One cosmetic, on the flame AND on a profile — the mock's point that every effect follows you
 * from the lock-in screen to everywhere your name appears.
 */
export function CosmeticHero({ kind, name }: { kind: CosmeticKind; name: string }) {
  const id = COSMETIC_ITEM[kind];
  const it = item(id);
  if (!it) return null;

  switch (kind) {
    case 'flare':
      return (
        // Decluttered (mock v3): the flame, the chip, nothing else — the aura needs the room.
        <View style={styles.hero}>
          {it.flare ? (
            <View style={StyleSheet.absoluteFill} pointerEvents="none">
              <FlarePerimeter colour={it.flare.colour} effect={it.flare.effect} />
            </View>
          ) : null}
          <TourFlame height={70} itemId={id} />
          <ProfileChip name={name} itemId={id} />
        </View>
      );

    case 'ring':
      return (
        <View style={styles.hero}>
          {/* The ring renderer draws OUTSIDE its child and centres on it by construction, so the
              ring cannot drift off the flame — the mock-v2 bug. */}
          <EquippedAvatarHalo haloId={id} size={84}>
            <View style={styles.ringInner}>
              <TourFlame height={54} />
            </View>
          </EquippedAvatarHalo>
          <Text style={styles.heroLabel}>…and circles your profile icon</Text>
          <ProfileChip name={name} itemId={id} />
        </View>
      );

    case 'particles':
      return (
        <View style={styles.hero}>
          <View style={styles.particleStage}>
            <View style={StyleSheet.absoluteFill} pointerEvents="none">
              <FlameParticleField from={it.art.from} to={it.art.to} motion={particleMotionFor(id)} />
            </View>
            <TourFlame height={66} />
          </View>
          <Text style={styles.heroLabel}>…and drift around your profile</Text>
          <ProfileChip name={name} itemId={id} />
        </View>
      );

    case 'banner':
      return (
        <View style={styles.hero}>
          <View style={styles.bannerBox}>
            <CampfireBannerArt itemKey={id} variant="screen" animated />
            <Text style={styles.bannerName}>LRC · your campfire</Text>
          </View>
          <Text style={styles.heroLabel}>Flies over your profile and your campfire</Text>
        </View>
      );

    case 'title':
      return (
        <View style={styles.hero}>
          <ProfileChip name={name} itemId={id} />
        </View>
      );

    case 'sfx':
    case 'audio':
      return (
        <View style={styles.hero}>
          <ItemArt item={it} size={84} motion="on" />
          <Text style={styles.heroLabel}>{kind === 'sfx' ? '▶ plays as you lock in, and as you finish' : '♪ plays while you grind'}</Text>
        </View>
      );

    case 'card':
      return (
        <View style={styles.hero}>
          <ProfileChip name={name} itemId={id} />
        </View>
      );

    case 'flame':
    default: {
      const swatches = items(['flame-electric-cyan', 'flame-toxic-green', 'flame-solar-flare']);
      return (
        <View style={styles.hero}>
          <TourFlame height={80} itemId={id} />
          <View style={styles.swatches}>
            {swatches.map((s) => (
              <View key={s.id} style={[styles.swatch, { borderColor: RARITY_COLOR[s.rarity] }]}>
                <FlameSvg width={14 * FLAME_ASPECT_RATIO} height={14} ramp={rampFor(s)} />
              </View>
            ))}
          </View>
          <ProfileChip name={name} itemId={id} />
        </View>
      );
    }
  }
}

// ─────────────────────────── the ranks ───────────────────────────

/**
 * 🔴 COPY + EMBLEMS ONLY. Rank is a lifetime climb (0230): it never decays and never resets — the
 * Flame Pass is the only seasonal track. The effort labels are each tier's entry in locked-in hours
 * on 0203's curve (250 XP/h, streak bonus ignored), rounded; the server computes none of them.
 */
const ASCENSION: { tier: RankTierName; effort: string }[] = [
  { tier: 'primordial', effort: '~2,500 h · years' },
  { tier: 'immortal', effort: '~900 h' },
  { tier: 'olympian', effort: '~660 h' },
  { tier: 'titan', effort: '~480 h' },
  { tier: 'hero', effort: '~340 h · the ascension gate' },
];

const MORTAL: { tier: RankTierName; effort: string }[] = [
  { tier: 'diamond', effort: '~230 h' },
  { tier: 'platinum', effort: '~150 h' },
  { tier: 'gold', effort: '~85 h' },
  { tier: 'silver', effort: '~40 h' },
  { tier: 'bronze', effort: 'where everyone starts' },
];

export function RankLadder() {
  return (
    <View style={styles.ladder}>
      <View style={styles.reset}>
        <Text style={styles.resetText}>
          ↑ <Text style={styles.resetStrong}>Your rank never resets</Text> — every hour you lock in counts for good. The
          Flame Pass is what starts fresh each season.
        </Text>
      </View>
      <Band label="⬆ ASCENSION — only a handful reach it" ascension />
      {ASCENSION.map((r) => (
        <RankRow key={r.tier} tier={r.tier} effort={r.effort} ascension />
      ))}
      <Band label="MORTAL — everyone climbs here" />
      {MORTAL.map((r) => (
        <RankRow key={r.tier} tier={r.tier} effort={r.tier === 'diamond' ? `you're here · ${r.effort}` : r.effort} here={r.tier === 'diamond'} />
      ))}
    </View>
  );
}

function Band({ label, ascension }: { label: string; ascension?: boolean }) {
  return (
    <View style={styles.band}>
      <Text style={[styles.bandText, ascension && { color: Colors.amber }]} numberOfLines={1}>
        {label}
      </Text>
      <View style={styles.bandLine} />
    </View>
  );
}

function RankRow({ tier, effort, ascension, here }: { tier: RankTierName; effort: string; ascension?: boolean; here?: boolean }) {
  return (
    <View style={[styles.rk, here && styles.rkHere]}>
      <View style={ascension ? styles.emblemGlow : null}>
        <RankBadge tier={tier} size={14} />
      </View>
      <Text style={styles.rkName} numberOfLines={1}>
        {RANK_TIER_LABEL[tier]}
      </Text>
      <Text style={[styles.rkEffort, here && styles.rkEffortHere]} numberOfLines={1}>
        {effort}
      </Text>
    </View>
  );
}

// ─────────────────────────── the shop, the crate, the haul ───────────────────────────

/** Three real crates for the shop shelf. */
export function CrateShelf({ boxes }: { boxes: BoxKey[] }) {
  return (
    <View style={styles.shelf}>
      {boxes.map((b) => (
        <View key={b} style={[styles.shelfTile, { borderColor: RARITY_COLOR[BOXES[b].rarity] }]}>
          <BoxArt boxKey={b} size={34} />
        </View>
      ))}
    </View>
  );
}

/**
 * The real crate-open — rattle, lid lift, burst — played once on mount. `handsOff` because the
 * tour's next step owns the reveal (the face-down shards), so the rarity sting is not this crate's
 * to play. `onDone` is therefore never called; it exists to satisfy the contract.
 */
export function TourCrateOpen() {
  const reduceMotion = useReduceMotion();
  const noop = useCallback(() => {}, []);
  return (
    <View style={styles.crateStage}>
      <CrateOpen boxKey="furnace" itemRarity="epic" reduceMotion={reduceMotion} handsOff onDone={noop} size={104} />
    </View>
  );
}

/** A face-down shard: the flame mark, unlit. Rarity is the surprise, so nothing here is coloured. */
export function FaceDownTile() {
  return (
    <View style={[styles.haulTile, styles.faceDown]}>
      <View style={styles.faceDownMark}>
        <FlameSvg width={14 * FLAME_ASPECT_RATIO} height={14} />
      </View>
    </View>
  );
}

/**
 * 🔴 TEN PULLS — Open ×10 is ten, and the grid used to draw eight. Ordinary cosmetics at mixed
 * rarities: the tour does NOT promise a Mythic (and never the Crown of Olympus, which no crate drops).
 */
export const HAUL_IDS = [
  'halo-glowing-amber',
  'flame-electric-cyan',
  'particle-ember-swarm',
  'title-pacesetter',
  'flare-solar',
  'banner-emberfall-night',
  'card-carbon-fiber',
  'halo-copper-ring',
  'flame-cosmic-purple',
  'title-the-relentless',
];

/** The haul, tappable: whatever you tap loads onto the profile chip under it, live. */
export function HaulPreview({ name }: { name: string }) {
  const haul = items(HAUL_IDS);
  const [picked, setPicked] = useState(haul[0]?.id ?? null);
  const pickedItem = picked ? item(picked) : undefined;
  return (
    <View style={styles.haul}>
      <View style={styles.haulGrid}>
        {haul.map((h) => (
          <Pressable
            key={h.id}
            onPress={() => setPicked(h.id)}
            accessibilityRole="button"
            accessibilityLabel={`Try on ${h.name}`}
            style={[
              styles.haulTile,
              { borderColor: RARITY_COLOR[h.rarity] },
              picked === h.id && styles.haulTileOn,
            ]}>
            <ItemArt item={h} size={28} motion="off" />
          </Pressable>
        ))}
      </View>
      <Text style={styles.haulHint}>Tap any to load it on your profile</Text>
      {pickedItem ? (
        <ProfileChip name={name} itemId={pickedItem.id} caption={`now wearing · ${titleOrName(pickedItem)}`} />
      ) : null}
    </View>
  );
}

function titleOrName(it: CatalogItem): string {
  return it.type === 'TITLE' ? titleLabel(it).name : it.name;
}

/** A small grid of real owned items — the inventory card. */
export function ItemGrid({ ids, size = 30 }: { ids: string[]; size?: number }) {
  return (
    <View style={styles.haulGrid}>
      {items(ids).map((h) => (
        <View key={h.id} style={[styles.haulTile, { borderColor: RARITY_COLOR[h.rarity] }]}>
          <ItemArt item={h} size={size} motion="off" />
        </View>
      ))}
    </View>
  );
}

/** One item, large, floating — a reveal or a detail view. */
export function ItemHero({ id, size = 64 }: { id: string; size?: number }) {
  const it = item(id);
  return it ? <ItemArt item={it} size={size} motion="on" /> : null;
}

/** The relic shelf — the real per-relic drawings, pedestalled by ItemArt. */
export function RelicTile({ relicKey }: { relicKey: string }) {
  const it = item(relicKey);
  return it ? <ItemArt item={it} size={32} motion="off" /> : null;
}

// ─────────────────────────── the forge ───────────────────────────

/** Two Epic dupes in, one Legendary out — real items, one rarity apart. */
export const FORGE_IN = 'flame-solar-flare';
export const FORGE_OUT = 'flame-cosmic-purple';

/**
 * Before → Forge → after (mock 239, 18/20). The two inputs lean in toward each other on a loop — the
 * fuse being promised — and hold still under Reduce Motion.
 */
export function ForgeBefore({ forgeButton }: { forgeButton: React.ReactNode }) {
  const reduceMotion = useReduceMotion();
  const pull = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) return;
    pull.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: 900, easing: Easing.inOut(Easing.quad) })
      ),
      -1,
      false
    );
    return () => cancelAnimation(pull);
  }, [pull, reduceMotion]);
  const left = useAnimatedStyle(() => ({ transform: [{ translateX: pull.value * 10 }] }));
  const right = useAnimatedStyle(() => ({ transform: [{ translateX: pull.value * -10 }] }));

  const input = item(FORGE_IN);
  const output = item(FORGE_OUT);
  if (!input || !output) return null;
  return (
    <View style={styles.forge}>
      <Text style={styles.forgeCap}>YOU HAD</Text>
      <View style={styles.forgePair}>
        <Animated.View style={left}>
          <ItemArt item={input} size={40} motion="off" />
        </Animated.View>
        <Animated.View style={right}>
          <ItemArt item={input} size={40} motion="off" />
        </Animated.View>
      </View>
      <Text style={styles.forgeLine}>
        2× {input.name} · <Text style={{ color: RARITY_COLOR[input.rarity] }}>Epic</Text>
      </Text>
      {forgeButton}
      <Text style={[styles.forgeCap, { color: RARITY_COLOR[output.rarity] }]}>YOU&apos;LL GET</Text>
      <ItemArt item={output} size={44} motion="off" />
      <Text style={[styles.forgeLine, { color: RARITY_COLOR[output.rarity] }]}>1× {output.name} · Legendary</Text>
    </View>
  );
}

/** The real strike: the two inputs fall onto the anvil, the hammer lands, then the result. */
export function ForgeAfter() {
  const reduceMotion = useReduceMotion();
  const [done, setDone] = useState(false);
  // Stable on purpose: ForgeStrike's timeline effect lists onDone as a dep, and a fresh callback per
  // render would restart the strike.
  const onDone = useCallback(() => setDone(true), []);
  const input = item(FORGE_IN);
  const output = item(FORGE_OUT);
  if (!input || !output) return null;
  if (!done) return <ForgeStrike inputs={[input, input]} reduceMotion={reduceMotion} onDone={onDone} />;
  return (
    <View style={styles.forgeDone}>
      <ItemArt item={output} size={72} motion="on" />
      <Text style={[styles.forgeLine, { color: RARITY_COLOR[output.rarity] }]}>Forged! {output.name} · Legendary</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { flex: 1, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 6 },
  heroLabel: { fontFamily: Fonts.bodyBold, fontSize: 8.5, letterSpacing: 0.8, color: Colors.textTertiary, textAlign: 'center' },
  ringInner: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1d1430' },
  particleStage: { width: 120, height: 100, alignItems: 'center', justifyContent: 'flex-end' },
  bannerBox: { alignSelf: 'stretch', height: 92, borderRadius: 12, overflow: 'hidden', justifyContent: 'flex-end', padding: 8 },
  bannerName: { fontFamily: Fonts.bodyBold, fontSize: 11, color: Colors.ink },
  swatches: { flexDirection: 'row', gap: 6 },
  swatch: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    backgroundColor: '#171023',
    alignItems: 'center',
    justifyContent: 'center',
  },

  chipShell: { alignSelf: 'stretch', borderRadius: 14, borderWidth: 1, borderColor: '#2c2340' },
  chipFlare: { borderWidth: 1.5, shadowOpacity: 0.9, shadowRadius: 12, shadowOffset: { width: 0, height: 0 }, elevation: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 9, paddingVertical: 8 },
  chipAvatar: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  chipParticles: { position: 'absolute', top: -8, left: -8, right: -8, bottom: -8 },
  chipText: { flex: 1, minWidth: 0 },
  chipNameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  chipName: { flexShrink: 1, fontFamily: Fonts.bodyBold, fontSize: 11.5, color: Colors.ink },
  chipTitle: { fontFamily: Fonts.bodyBold, fontSize: 9, marginTop: 1 },
  chipSub: { fontFamily: Fonts.body, fontSize: 9, color: Colors.textTertiary, marginTop: 1 },
  chipCaption: { color: Colors.amber, fontFamily: Fonts.bodyBold },

  ladder: { flex: 1, gap: 1 },
  reset: { backgroundColor: '#241a38', borderWidth: 1, borderColor: '#3a2c58', borderRadius: 8, padding: 6, marginBottom: 3 },
  resetText: { fontFamily: Fonts.body, fontSize: 8.5, lineHeight: 12, color: Colors.muted },
  resetStrong: { fontFamily: Fonts.bodyBold, color: Colors.amber },
  band: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3, marginBottom: 1 },
  bandText: { fontFamily: Fonts.bodyBold, fontSize: 7.5, letterSpacing: 1, color: Colors.textTertiary },
  bandLine: { flex: 1, height: 1, backgroundColor: '#2c2340' },
  rk: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 1, paddingHorizontal: 4, borderRadius: 6 },
  rkHere: { backgroundColor: '#241a38', borderWidth: 1, borderColor: Colors.amber },
  emblemGlow: { shadowColor: Colors.amber, shadowOpacity: 0.8, shadowRadius: 5, shadowOffset: { width: 0, height: 0 } },
  rkName: { flex: 1, fontFamily: Fonts.bodyBold, fontSize: 9.5, color: Colors.ink },
  rkEffort: { fontFamily: Fonts.body, fontSize: 7.5, color: Colors.textTertiary },
  rkEffortHere: { fontFamily: Fonts.bodyBold, color: Colors.amber },

  shelf: { flexDirection: 'row', gap: 8, justifyContent: 'center', marginTop: 4 },
  shelfTile: {
    width: 46,
    height: 46,
    borderRadius: 12,
    borderWidth: 2,
    backgroundColor: '#1e1630',
    alignItems: 'center',
    justifyContent: 'center',
  },
  crateStage: { flex: 1, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },

  haul: { gap: 6 },
  haulGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, justifyContent: 'center', marginTop: 4 },
  haulTile: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 2,
    backgroundColor: '#1e1630',
    alignItems: 'center',
    justifyContent: 'center',
  },
  haulTileOn: { borderColor: Colors.amber, shadowColor: Colors.amber, shadowOpacity: 0.8, shadowRadius: 8, shadowOffset: { width: 0, height: 0 } },
  faceDown: { borderColor: '#3a2c58' },
  faceDownMark: { opacity: 0.3 },
  haulHint: { fontFamily: Fonts.bodyBold, fontSize: 9, color: Colors.amber, textAlign: 'center' },

  forge: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 5 },
  forgeCap: { fontFamily: Fonts.bodyBold, fontSize: 8, letterSpacing: 1.4, color: Colors.textTertiary },
  forgePair: { flexDirection: 'row', gap: 14 },
  forgeLine: { fontFamily: Fonts.body, fontSize: 9.5, color: Colors.muted, textAlign: 'center' },
  forgeDone: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
});
