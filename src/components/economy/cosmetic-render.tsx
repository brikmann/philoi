import { type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { CampfireBannerArt } from '@/components/campfire-banner-art';
import { EquippedCardBackdrop } from '@/components/economy/applied-art';
import { FlameParticleField, FlarePerimeter, particleMotionFor } from '@/components/economy/flare-perimeter';
import { ItemArt } from '@/components/economy/item-art';
import { PreviewButton } from '@/components/economy/preview-button';
import { CosmeticAvatar } from '@/components/economy/public-identity';
import { RelicArt, hasRelicArt } from '@/components/economy/relic-art';
import { FLAME_ASPECT_RATIO, FlameSvg } from '@/components/flame-icon';
import { SealBadge } from '@/components/seal-badge';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import type { PublicItem, PublicLoadout } from '@/hooks/use-public-loadouts';
import { getItem, titleLabel, type CatalogItem, type EquipSlot } from '@/lib/economy/catalog';
import { rampFor } from '@/lib/economy/flame-ramp';
import { RARITY_COLOR } from '@/lib/economy/rarity';
import { SEAL_COSMETIC_KEY } from '@/lib/economy/seal-owners';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// CANONICAL "AS-EQUIPPED" RENDERER — one dispatch, every type, on its REAL surface.
//
// This is the single component the dev Cosmetic Preview Gallery (src/app/cosmetic-gallery.tsx)
// drives to paint every cosmetic in the catalog with the SAME native renderers the live app uses:
// the card backdrop, the avatar halo + flare aura, the lock-in flame + perimeter + particle field,
// and the campfire banner scene. Nothing here is a placeholder — each surface composes the shipped
// renderer for that slot, so what a reviewer signs off on IS what a user sees equipped.
//
// The item under preview is EQUIPPED into its own slot; every other slot falls back to the starter
// loadout, so the previewed piece reads in a believable context instead of on an empty stage.
//
// Reduce-Motion / off-screen fallbacks are inherited for free: FlareAura, FlameParticleField and
// CampfireBannerArt each gate their own animation on useReducedMotion()/useMotionActive().
// ══════════════════════════════════════════════════════════════════════════════════════════════

export type CosmeticSurface = 'art' | 'profile' | 'lockin' | 'chat';

export const COSMETIC_SURFACES: { key: CosmeticSurface; label: string }[] = [
  { key: 'art', label: 'Art' },
  { key: 'profile', label: 'Profile' },
  { key: 'lockin', label: 'Lock-in' },
  { key: 'chat', label: 'Group chat' },
];

/** The starter loadout every surface fills its un-previewed slots from — never a bare surface. */
const PREVIEW_DEFAULTS: Partial<Record<EquipSlot, string>> = {
  flame: 'flame-base-ember',
  particle: 'particle-base-spark',
  card: 'card-base-hearth',
  halo: 'halo-base-ring',
  title: 'title-base-kindling',
  banner: 'banner-base-hearth',
};

const PREVIEW_NAME = 'Ember';

function pub(id: string | undefined): PublicItem | undefined {
  const it = id ? getItem(id) : undefined;
  return it ? { ...it, seasonStamp: null } : undefined;
}

/** A synthetic public loadout with `item` equipped in its slot and the starter set everywhere else. */
export function loadoutForItem(item: CatalogItem): PublicLoadout {
  const out: PublicLoadout = {};
  (Object.keys(PREVIEW_DEFAULTS) as EquipSlot[]).forEach((slot) => {
    out[slot] = pub(PREVIEW_DEFAULTS[slot]);
  });
  if (item.slot) out[item.slot] = { ...item, seasonStamp: null };
  return out;
}

// ─────────────────────────────── the four surfaces ───────────────────────────────

/** The raw art — always paints, every type, via the shared ItemArt family (incl. the SFX waveform). */
function ArtStage({ item }: { item: CatalogItem }) {
  return (
    <View style={styles.artStage}>
      <ItemArt item={item} size={168} motion="on" />
      {(item.type === 'SFX' || item.type === 'AUDIO') && (
        <View style={styles.previewRow}>
          <PreviewButton item={item} />
        </View>
      )}
    </View>
  );
}

/** RL-style profile card WITH the user's name — card backdrop, banner behind the name, avatar with
 *  halo + flare aura + orbiting particles, title under the name, the Seal / a medal / a relic beside it. */
function ProfileStage({ item }: { item: CatalogItem }) {
  const loadout = loadoutForItem(item);
  const titleItem = loadout.title;
  const isSeal = item.id === SEAL_COSMETIC_KEY;
  const showRelic = item.type === 'RELIC';
  const showMedal = item.type === 'MEDAL' && !isSeal;

  return (
    <EquippedCardBackdrop cardId={loadout.card?.id} radius={Radius.card}>
      <View style={styles.profileInner}>
        <View style={styles.bannerStrip}>
          <CampfireBannerArt itemKey={loadout.banner?.id} variant="header" />
          <Text style={styles.bannerName} numberOfLines={1}>
            {PREVIEW_NAME}
          </Text>
        </View>

        <View style={styles.avatarWrap}>
          <View style={styles.particleHug} pointerEvents="none">
            {loadout.particle && (
              <FlameParticleField
                from={loadout.particle.art.from}
                to={loadout.particle.art.to}
                motion={particleMotionFor(loadout.particle.id)}
              />
            )}
          </View>
          <CosmeticAvatar userId={null} name={PREVIEW_NAME} size={92} loadout={loadout} motion="full" />
        </View>

        <View style={styles.nameRow}>
          {item.type === 'FLAME' && (
            <FlameSvg width={18 * FLAME_ASPECT_RATIO} height={18} ramp={rampFor(loadout.flame)} />
          )}
          <Text style={styles.profileName} numberOfLines={1}>
            {PREVIEW_NAME}
          </Text>
          {isSeal && <SealBadge owns size={16} style={styles.sealInline} />}
          {showMedal && (
            <View style={styles.inlineMedal}>
              <ItemArt item={item} size={22} motion="off" />
            </View>
          )}
        </View>

        {titleItem && (
          <Text style={[styles.titleLine, { color: RARITY_COLOR[titleItem.rarity] }]} numberOfLines={1}>
            ✦ {titleLabel(titleItem).name}
          </Text>
        )}

        {showRelic && (
          <View style={styles.relicShelf}>
            {hasRelicArt(item.id) ? (
              <RelicArt relicKey={item.id} from={item.art.from} to={item.art.to} size={52} />
            ) : (
              <ItemArt item={item} size={52} motion="off" />
            )}
          </View>
        )}
      </View>
    </EquippedCardBackdrop>
  );
}

/** The lock-in screen — the perimeter flare framing the screen, the skinned flame, its particle field. */
function LockInStage({ item }: { item: CatalogItem }) {
  const loadout = loadoutForItem(item);
  const flare = item.type === 'FLARE' ? item.flare : undefined;

  return (
    <View style={styles.lockin}>
      {flare && (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <FlarePerimeter colour={flare.colour} effect={flare.effect} />
        </View>
      )}
      <View style={styles.lockinParticles} pointerEvents="none">
        {loadout.particle && (
          <FlameParticleField
            from={loadout.particle.art.from}
            to={loadout.particle.art.to}
            motion={particleMotionFor(loadout.particle.id)}
          />
        )}
      </View>
      <View style={styles.lockinFlame}>
        <FlameSvg width={132 * FLAME_ASPECT_RATIO} height={132} ramp={rampFor(loadout.flame)} />
      </View>
      <Text style={styles.lockinCaption}>Locked in</Text>
    </View>
  );
}

/** The group-chat surface — the equipped banner as the header scene, a name + title over messages. */
function ChatStage({ item }: { item: CatalogItem }) {
  const loadout = loadoutForItem(item);
  const titleItem = loadout.title;

  return (
    <View style={styles.chat}>
      <View style={styles.chatHeader}>
        <CampfireBannerArt itemKey={loadout.banner?.id} variant="screen" animated />
        <View style={styles.chatHeaderText}>
          <Text style={styles.chatName} numberOfLines={1}>
            {PREVIEW_NAME}&apos;s Campfire
          </Text>
          {titleItem && (
            <Text style={[styles.chatTitle, { color: RARITY_COLOR[titleItem.rarity] }]} numberOfLines={1}>
              ✦ {titleLabel(titleItem).name}
            </Text>
          )}
        </View>
      </View>
      <View style={styles.chatBody}>
        <View style={[styles.bubble, styles.bubbleThem]}>
          <Text style={styles.bubbleText}>Who&apos;s locking in tonight?</Text>
        </View>
        <View style={[styles.bubble, styles.bubbleMe]}>
          <Text style={styles.bubbleText}>Me. Two hours, no phone.</Text>
        </View>
      </View>
    </View>
  );
}

/** Dispatch: render `item` on the chosen surface with the real, shipped renderers. */
export function CosmeticRender({ item, surface }: { item: CatalogItem; surface: CosmeticSurface }): ReactNode {
  switch (surface) {
    case 'profile':
      return <ProfileStage item={item} />;
    case 'lockin':
      return <LockInStage item={item} />;
    case 'chat':
      return <ChatStage item={item} />;
    case 'art':
    default:
      return <ArtStage item={item} />;
  }
}

const styles = StyleSheet.create({
  artStage: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.three,
    gap: Spacing.two,
  },
  previewRow: {
    marginTop: Spacing.one,
  },
  profileInner: {
    alignItems: 'center',
    paddingBottom: Spacing.four,
  },
  bannerStrip: {
    width: '100%',
    height: 72,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  bannerName: {
    fontFamily: Fonts.display,
    fontSize: 20,
    color: Colors.ink,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.one,
  },
  avatarWrap: {
    marginTop: -28,
    width: 132,
    height: 132,
    alignItems: 'center',
    justifyContent: 'center',
  },
  particleHug: {
    ...StyleSheet.absoluteFillObject,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    marginTop: Spacing.one,
  },
  profileName: {
    fontFamily: Fonts.bodyBold,
    fontSize: 17,
    color: Colors.ink,
  },
  sealInline: {
    marginLeft: 2,
  },
  inlineMedal: {
    marginLeft: 2,
  },
  titleLine: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    marginTop: 2,
  },
  relicShelf: {
    marginTop: Spacing.two,
    padding: Spacing.two,
    borderRadius: Radius.card,
    backgroundColor: Colors.cardDark,
  },
  lockin: {
    height: 280,
    borderRadius: Radius.card,
    backgroundColor: Colors.forgeBg,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockinParticles: {
    ...StyleSheet.absoluteFillObject,
  },
  lockinFlame: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockinCaption: {
    marginTop: Spacing.two,
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.muted,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  chat: {
    height: 280,
    borderRadius: Radius.card,
    backgroundColor: Colors.card,
    overflow: 'hidden',
  },
  chatHeader: {
    height: 120,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  chatHeaderText: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
  },
  chatName: {
    fontFamily: Fonts.display,
    fontSize: 18,
    color: Colors.ink,
  },
  chatTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    marginTop: 2,
  },
  chatBody: {
    flex: 1,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  bubble: {
    maxWidth: '80%',
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.card,
  },
  bubbleThem: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.cardDark,
  },
  bubbleMe: {
    alignSelf: 'flex-end',
    backgroundColor: Colors.ember,
  },
  bubbleText: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.ink,
  },
});
