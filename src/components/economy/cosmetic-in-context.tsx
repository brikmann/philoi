import { useEffect, useState, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

import { CampfireBannerArt } from "@/components/campfire-banner-art";
import {
  EquippedAvatarHalo,
  EquippedCardBackdrop,
} from "@/components/economy/applied-art";
import { FlareBorder } from "@/components/economy/flare-border";
import {
  FlameParticleField,
  FlarePerimeter,
  particleMotionFor,
  type FlareTier,
} from "@/components/economy/flare-perimeter";
import { ItemArt } from "@/components/economy/item-art";
import { PublicTitle } from "@/components/economy/loadout-bits";
import { PreviewButton } from "@/components/economy/preview-button";
import { CosmeticAvatar } from "@/components/economy/public-identity";
import { FLAME_ASPECT_RATIO, FlameSvg } from "@/components/flame-icon";
import { SealBadge } from "@/components/seal-badge";
import { SessionFlame } from "@/components/session-flame";
import { Colors, Fonts, Radius, Spacing } from "@/constants/theme";
import { useReduceMotion } from "@/hooks/use-reduce-motion";
import type { PublicLoadout } from "@/hooks/use-public-loadouts";
import { useAuth } from "@/lib/auth/auth-context";
import {
  DEFAULT_LOADOUT,
  getItem,
  type CatalogItem,
  type EquipSlot,
  type ItemType,
} from "@/lib/economy/catalog";
import { rampFor } from "@/lib/economy/flame-ramp";
import { useLoadout } from "@/lib/economy/loadout";
import { SEAL_COSMETIC_KEY } from "@/lib/economy/seal-owners";

// ══════════════════════════════════════════════════════════════════════════════════════════════
// "WHAT IT DOES" — one cosmetic, drawn on the surface it actually lives on (mocks 251 / 252 / 254).
//
// The half of the unlock reveal worth the most. An icon tells you what you own; this tells you what
// it does to YOU — a flare previews as a glow around your own profile card, a halo rings your own
// avatar, a banner flies over a campfire. It is the same component in the unlock reveal and in the
// loadout / inventory preview, so browsing, unlocking and hovering an item all answer the same
// question the same way: "oh, this makes my profile look like this."
//
// THREE BEATS, ONE PER STAGE (mock 254):
//   ① item    the thing itself — a flame as the flame, a flare as its loop, a medal as the struck
//             disc, a relic as the artifact. Never a generic glyph.
//   ② status  where it lives equipped, where other people see it.
//   ③ use     where it shows up while you are actually doing something.
//
// THE PREVIEW IS YOUR LOADOUT, NOT A MANNEQUIN. The item goes into its own slot on top of what you
// already have equipped; anything you have left empty falls back to the starter set, so the piece
// reads in a believable context instead of on a bare stage. Nothing here equips anything — the
// substitution is a render-time copy, the store is never written.
//
// EVERY STAGE COMPOSES A SHIPPED RENDERER (FlarePerimeter, EquippedAvatarHalo, EquippedCardBackdrop,
// CampfireBannerArt, SessionFlame, FlameParticleField, ItemArt). No stage draws its own version of a
// cosmetic, so what a reveal shows can never drift from what the profile paints. Reduce-Motion is
// inherited: each of those gates its own animation.
// ══════════════════════════════════════════════════════════════════════════════════════════════

export type ContextBeat = "item" | "status" | "use";

/**
 * Per-type copy for beats ② and ③ — the table in the Agent D brief, from mock 254.
 *
 * Keyed by TYPE so a new item explains itself the day it lands in catalog.ts, the same rule
 * cosmetic-effect.ts follows. AUDIO and SFX are not in the brief's table: their "surface" is a
 * sound, so both beats read the loadout slot they go in and the moment they play.
 */
export const IN_CONTEXT: Record<ItemType, { status: string; use: string }> = {
  FLAME: { status: "your home-screen flame", use: "the lock-in session flame" },
  FLARE: {
    status: "your profile border",
    use: "full-screen in a lock-in, surging with time",
  },
  HALO: { status: "circling your avatar", use: "circling your lock-in flame" },
  PARTICLE: {
    status: "drifting around your avatar",
    use: "around your lock-in flame",
  },
  CARD: {
    status: "behind your profile header",
    use: "your profile flex and share card",
  },
  BANNER: {
    status: "flying over your campfire",
    use: "behind your campfire chat",
  },
  MEDAL: {
    status: "in your profile showcase",
    use: "beside your name on the leaderboard",
  },
  RELIC: {
    status: "in your profile showcase",
    use: "on display in your Trophy Hall",
  },
  TITLE: {
    status: "under your name on your profile",
    use: "by your name on the leaderboard",
  },
  AUDIO: {
    status: "in your lock-in loadout",
    use: "playing under your lock-ins",
  },
  SFX: {
    status: "in your lock-in loadout",
    use: "the sting a lock-in starts or ends on",
  },
};

/** The short beat names for a stepper — "① Unlocked · ② On your profile · ③ In a lock-in". */
export function beatLabel(
  item: Pick<CatalogItem, "type">,
  beat: ContextBeat,
): string {
  if (beat === "item") return "Unlocked";
  return capitalise(IN_CONTEXT[item.type][beat]);
}

/**
 * The item's own colour — what the reveal's rays, name glow and Equip button inherit (mock 251:
 * "Hue = the item").
 *
 * A flare's hue is its `flare.colour`, the exact value the perimeter paints, which is why Solar
 * Flare reads gold in all three moments of mock 252. Everything else takes `art.to`, the bright
 * end of its ramp: `from` is the shaded base on most items and a reveal lit by it reads muddy.
 */
export function itemHue(item: Pick<CatalogItem, "art" | "flare">): string {
  return item.flare?.colour ?? item.art.to;
}

/** Dark ink on a light hue, light ink on a dark one — the button takes the item's colour, and a
 *  violet smoke flare's button cannot carry the same dark label as a gold one. */
export function hueInk(hex: string): string {
  const h = hex.replace("#", "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((d) => d + d)
          .join("")
      : h.slice(0, 6);
  const n = parseInt(full, 16);
  if (!Number.isFinite(n)) return "#1a1020";
  const lum =
    (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) /
    255;
  return lum > 0.55 ? "#1a1020" : "#FFF6EC";
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Your live loadout with `item` swapped into its slot — the starter set behind anything empty.
 *
 * Read off the loadout store (useLoadout), which is the signed-in user's equipped set and already
 * carries their rarity overrides and season stamps.
 */
function usePreviewLoadout(item: CatalogItem): PublicLoadout {
  const mine = useLoadout();
  const out: PublicLoadout = {};
  (Object.keys(DEFAULT_LOADOUT) as EquipSlot[]).forEach((slot) => {
    const fallback = DEFAULT_LOADOUT[slot];
    const it = fallback ? getItem(fallback) : undefined;
    if (it) out[slot] = { ...it, seasonStamp: null };
  });
  Object.assign(out, mine);
  if (item.slot) out[item.slot] = { ...item, seasonStamp: null };
  return out;
}

function usePreviewName(): string {
  const { profile } = useAuth();
  return profile?.display_name?.trim() || "You";
}

/**
 * The flare lifecycle's lock-in half (mock 252 ③): the perimeter climbs its tiers while you watch,
 * so "surging with time" is shown rather than claimed. The live screen climbs at 15/30/60 minutes
 * (FLARE_TIER_MINUTES); a preview compresses that into a few seconds and then holds at full before
 * looping. Reduce Motion holds at full from the start — the ceiling is what the item looks like.
 */
const SURGE_STEP_MS = 1400;
const SURGE_SEQUENCE: FlareTier[] = [0, 1, 2, 3, 3, 3];

function useSurgeTier(enabled: boolean): FlareTier {
  const reduceMotion = useReduceMotion();
  const [step, setStep] = useState(0);
  const live = enabled && !reduceMotion;
  useEffect(() => {
    if (!live) return;
    const id = setInterval(
      () => setStep((s) => (s + 1) % SURGE_SEQUENCE.length),
      SURGE_STEP_MS,
    );
    return () => clearInterval(id);
  }, [live]);
  return live ? SURGE_SEQUENCE[step] : 3;
}

// ─────────────────────────────── shared sample surfaces ───────────────────────────────

/** A compact profile card — card backdrop, avatar in its halo + aura, the name, the title. */
function MiniProfile({
  loadout,
  name,
  avatar = 56,
  besideName,
  footer,
}: {
  loadout: PublicLoadout;
  name: string;
  avatar?: number;
  besideName?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <EquippedCardBackdrop cardId={loadout.card?.id} radius={Radius.card}>
      <View style={styles.miniProfile}>
        <View style={styles.miniProfileRow}>
          <View
            style={[
              styles.avatarSlot,
              { width: avatar * 1.45, height: avatar * 1.45 },
            ]}
          >
            <CosmeticAvatar
              userId={null}
              name={name}
              size={avatar}
              loadout={loadout}
              motion="full"
            />
          </View>
          <View style={styles.who}>
            <View style={styles.nameLine}>
              <Text style={styles.name} numberOfLines={1}>
                {name}
              </Text>
              {besideName}
            </View>
            <PublicTitle loadout={loadout} compact />
          </View>
        </View>
        {footer}
      </View>
    </EquippedCardBackdrop>
  );
}

/** The lock-in screen in miniature: dark stage, the timer, the session flame. */
function MiniLockIn({
  loadout,
  flareTier,
  flare,
  flameWrap,
  particles = true,
  caption,
}: {
  loadout: PublicLoadout;
  flareTier?: FlareTier;
  flare?: CatalogItem["flare"];
  /** Something to wrap the flame in — a halo ring for the HALO use beat. */
  flameWrap?: (flame: ReactNode) => ReactNode;
  particles?: boolean;
  caption?: string;
}) {
  const ramp = rampFor(loadout.flame);
  const flame = <SessionFlame height={96} ramp={ramp} />;
  return (
    <View style={styles.lockin}>
      {flare ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <FlarePerimeter
            colour={flare.colour}
            effect={flare.effect}
            tier={flareTier}
          />
        </View>
      ) : null}
      {particles && loadout.particle ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <FlameParticleField
            from={loadout.particle.art.from}
            to={loadout.particle.art.to}
            motion={particleMotionFor(loadout.particle.id)}
          />
        </View>
      ) : null}
      <Text style={styles.lockinKicker}>LOCKED IN · STUDY</Text>
      <Text style={styles.lockinClock}>24:18</Text>
      <View style={styles.lockinFlame}>
        {flameWrap ? flameWrap(flame) : flame}
      </View>
      {caption ? <Text style={styles.lockinCaption}>{caption}</Text> : null}
    </View>
  );
}

/** A leaderboard row — rank, avatar, name, and whatever sits beside it. */
function MiniLeaderboardRow({
  loadout,
  name,
  beside,
  showTitle,
}: {
  loadout: PublicLoadout;
  name: string;
  beside?: ReactNode;
  showTitle?: boolean;
}) {
  return (
    <View style={styles.board}>
      <View style={[styles.boardRow, styles.boardGhost]}>
        <Text style={styles.boardRank}>1</Text>
        <View style={styles.boardGhostAvatar} />
        <View style={styles.boardGhostName} />
      </View>
      <View style={[styles.boardRow, styles.boardMe]}>
        <Text style={[styles.boardRank, styles.boardRankMe]}>2</Text>
        <CosmeticAvatar
          userId={null}
          name={name}
          size={30}
          loadout={loadout}
          motion="reduced"
        />
        <View style={styles.who}>
          <View style={styles.nameLine}>
            <Text style={styles.boardName} numberOfLines={1}>
              {name}
            </Text>
            {beside}
          </View>
          {showTitle ? <PublicTitle loadout={loadout} compact /> : null}
        </View>
      </View>
      <View style={[styles.boardRow, styles.boardGhost]}>
        <Text style={styles.boardRank}>3</Text>
        <View style={styles.boardGhostAvatar} />
        <View style={styles.boardGhostName} />
      </View>
    </View>
  );
}

/** A showcase shelf — the item in the first slot, two empty slots after it. */
function Showcase({ item, label }: { item: CatalogItem; label: string }) {
  return (
    <View style={styles.showcase}>
      <Text style={styles.showcaseLabel}>{label}</Text>
      <View style={styles.showcaseRow}>
        <View style={[styles.showcaseSlot, styles.showcaseSlotLit]}>
          <ItemArt item={item} size={58} motion="off" />
        </View>
        <View style={styles.showcaseSlot} />
        <View style={styles.showcaseSlot} />
      </View>
    </View>
  );
}

/** The medal as it sits beside a name — the Seal draws as its own burning badge, everything else
 *  as the struck disc in miniature. */
function MedalBesideName({ item }: { item: CatalogItem }) {
  if (item.id === SEAL_COSMETIC_KEY)
    return <SealBadge owns size={16} style={styles.beside} />;
  return (
    <View style={styles.beside}>
      <ItemArt item={item} size={20} motion="off" />
    </View>
  );
}

/** A campfire chat — the banner scene as the backdrop behind the bubbles. */
function MiniChat({ loadout, name }: { loadout: PublicLoadout; name: string }) {
  return (
    <View style={styles.chat}>
      <CampfireBannerArt
        itemKey={loadout.banner?.id}
        variant="screen"
        animated
      />
      <View style={styles.chatBody}>
        <View style={[styles.bubble, styles.bubbleThem]}>
          <Text style={styles.bubbleText}>locked in 45m 🔒</Text>
        </View>
        <View style={[styles.bubble, styles.bubbleMe]}>
          <Text style={styles.bubbleText}>let&apos;s go 🔥</Text>
        </View>
        <Text style={styles.chatWho} numberOfLines={1}>
          {name}&apos;s campfire
        </Text>
      </View>
    </View>
  );
}

// ─────────────────────────────── beat ① — the item itself ───────────────────────────────

/**
 * The item rendered AS ITSELF (brief, beat ①). A flame is the burning session flame in its own
 * colourway; a halo is its ring; a card is its scene; a banner is its sky; a title is the words in
 * their own gradient. Medals, relics, flares and sounds go through ItemArt, which already draws the
 * struck disc, the per-key artifact, the flare's live signature loop and the waveform.
 */
export function CosmeticHero({
  item,
  size = 156,
}: {
  item: CatalogItem;
  size?: number;
}) {
  switch (item.type) {
    case "FLAME":
      return <SessionFlame height={size} ramp={rampFor(item)} />;
    case "HALO":
      return (
        <EquippedAvatarHalo haloId={item.id} size={size * 0.62} motion="full">
          <View style={styles.heroAvatarDisc} />
        </EquippedAvatarHalo>
      );
    case "PARTICLE":
      return (
        <View
          style={{
            width: size,
            height: size,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            <FlameParticleField
              from={item.art.from}
              to={item.art.to}
              motion={particleMotionFor(item.id)}
            />
          </View>
          <FlameSvg
            width={size * 0.32 * FLAME_ASPECT_RATIO}
            height={size * 0.32}
            ramp={rampFor(undefined)}
          />
        </View>
      );
    case "CARD":
      return (
        <View style={{ width: size * 1.55, height: size * 0.95 }}>
          <EquippedCardBackdrop cardId={item.id} radius={Radius.card}>
            <View style={{ flex: 1 }} />
          </EquippedCardBackdrop>
        </View>
      );
    case "BANNER":
      // The banner's scene is composed portrait (216 × 452, a phone screen) and drawn with
      // preserveAspectRatio="none". The old size × 1.7 by size × 0.85 strip squashed it to a quarter
      // of its height under an 80% scrim, which read as a line. Fill the stage like a flame or
      // relic does, in the same box the "In action" chat uses, and show it bare: this beat IS the
      // banner, there is no chat on it to keep legible.
      return (
        <View style={styles.heroBanner}>
          <CampfireBannerArt
            itemKey={item.id}
            variant="screen"
            animated
            scrim={false}
          />
        </View>
      );
    case "TITLE":
      return (
        <View style={styles.heroTitle}>
          <PublicTitle loadout={{ title: { ...item, seasonStamp: null } }} />
        </View>
      );
    case "AUDIO":
    case "SFX":
      return (
        <View style={styles.heroSound}>
          <ItemArt item={item} size={size * 0.85} motion="on" />
          <PreviewButton item={item} />
        </View>
      );
    default:
      // FLARE · MEDAL · RELIC
      return <ItemArt item={item} size={size} motion="on" />;
  }
}

// ─────────────────────────────── beats ② and ③ ───────────────────────────────

function StatusStage({
  item,
  loadout,
  name,
}: {
  item: CatalogItem;
  loadout: PublicLoadout;
  name: string;
}) {
  switch (item.type) {
    case "FLAME":
      // The home screen's greeting and its flame — the flame you see every time you open the app.
      return (
        <View style={styles.home}>
          <Text style={styles.homeHi} numberOfLines={1}>
            Hi, {name.split(" ")[0]}
          </Text>
          <SessionFlame height={110} ramp={rampFor(item)} />
          <Text style={styles.homeCaption}>your flame</Text>
        </View>
      );
    case "FLARE":
      // The ambient half of the lifecycle (mock 252 ②): the profile card in the flare's card-edge
      // border — the same FlareBorder the real profile hero wears. Calm, not the lock-in surge.
      return (
        <FlareBorder flare={item.flare} radius={Radius.card}>
          <MiniProfile loadout={loadout} name={name} />
        </FlareBorder>
      );
    case "HALO":
    case "PARTICLE":
      return (
        <View style={styles.avatarStage}>
          {item.type === "PARTICLE" ? (
            <View style={StyleSheet.absoluteFill} pointerEvents="none">
              <FlameParticleField
                from={item.art.from}
                to={item.art.to}
                motion={particleMotionFor(item.id)}
              />
            </View>
          ) : null}
          <CosmeticAvatar
            userId={null}
            name={name}
            size={96}
            loadout={loadout}
            motion="full"
          />
          <Text style={styles.avatarName} numberOfLines={1}>
            {name}
          </Text>
        </View>
      );
    case "CARD":
      return <MiniProfile loadout={loadout} name={name} avatar={64} />;
    case "BANNER":
      return (
        <View style={styles.bannerHeader}>
          <CampfireBannerArt itemKey={item.id} variant="screen" animated />
          <Text style={styles.bannerHeaderName} numberOfLines={1}>
            🔥 {name}&apos;s campfire
          </Text>
        </View>
      );
    case "MEDAL":
      return item.id === SEAL_COSMETIC_KEY ? (
        // The Seal leaves the vault — it burns after its owner's name everywhere, so its status
        // beat is the name, not a shelf.
        <MiniProfile
          loadout={loadout}
          name={name}
          besideName={<MedalBesideName item={item} />}
        />
      ) : (
        <MiniProfile
          loadout={loadout}
          name={name}
          footer={<Showcase item={item} label="SHOWCASE" />}
        />
      );
    case "RELIC":
      return (
        <MiniProfile
          loadout={loadout}
          name={name}
          footer={<Showcase item={item} label="SHOWCASE" />}
        />
      );
    case "TITLE":
      return <MiniProfile loadout={loadout} name={name} avatar={64} />;
    default:
      return <SoundStage item={item} />;
  }
}

function UseStage({
  item,
  loadout,
  name,
}: {
  item: CatalogItem;
  loadout: PublicLoadout;
  name: string;
}) {
  const surge = useSurgeTier(item.type === "FLARE");
  switch (item.type) {
    case "FLAME":
      return <MiniLockIn loadout={loadout} particles={false} />;
    case "FLARE":
      return (
        <MiniLockIn
          loadout={loadout}
          flare={item.flare}
          flareTier={surge}
          caption={
            surge >= 3
              ? `${item.name} surging`
              : "the longer you stay, the harder it burns"
          }
        />
      );
    case "HALO":
      return (
        <MiniLockIn
          loadout={loadout}
          particles={false}
          flameWrap={(flame) => (
            <EquippedAvatarHalo haloId={item.id} size={120} motion="full">
              <View style={styles.haloFlameDisc}>{flame}</View>
            </EquippedAvatarHalo>
          )}
        />
      );
    case "PARTICLE":
      return <MiniLockIn loadout={loadout} />;
    case "CARD":
      // The flex / share card is a portrait poster of your identity on your card's scene.
      return (
        <View style={styles.shareCardWrap}>
          <View style={styles.shareCard}>
            <EquippedCardBackdrop cardId={item.id} radius={Radius.card}>
              <View style={styles.shareCardInner}>
                <CosmeticAvatar
                  userId={null}
                  name={name}
                  size={54}
                  loadout={loadout}
                  motion="reduced"
                />
                <Text style={styles.shareName} numberOfLines={1}>
                  {name}
                </Text>
                <PublicTitle loadout={loadout} compact />
                <Text style={styles.shareMark}>philoi</Text>
              </View>
            </EquippedCardBackdrop>
          </View>
        </View>
      );
    case "BANNER":
      return <MiniChat loadout={loadout} name={name} />;
    case "MEDAL":
      return (
        <MiniLeaderboardRow
          loadout={loadout}
          name={name}
          beside={<MedalBesideName item={item} />}
        />
      );
    case "RELIC":
      return (
        <View style={styles.hall}>
          <Text style={styles.hallLabel}>🏛 TROPHY HALL</Text>
          <View style={styles.hallShelf}>
            <ItemArt item={item} size={92} motion="on" />
          </View>
          <View style={styles.hallPlank} />
        </View>
      );
    case "TITLE":
      return <MiniLeaderboardRow loadout={loadout} name={name} showTitle />;
    default:
      return <SoundStage item={item} />;
  }
}

function SoundStage({ item }: { item: CatalogItem }) {
  return (
    <View style={styles.heroSound}>
      <ItemArt item={item} size={110} motion="on" />
      <PreviewButton item={item} />
    </View>
  );
}

/**
 * The item, drawn for one beat. Shared by the unlock reveal and the loadout / inventory preview.
 *
 * `beat="item"` is the hero alone; `status` and `use` place it on your own loadout.
 */
export function CosmeticInContext({
  item,
  beat,
}: {
  item: CatalogItem;
  beat: ContextBeat;
}) {
  const loadout = usePreviewLoadout(item);
  const name = usePreviewName();
  return (
    <View style={styles.stage}>
      {beat === "item" ? (
        <CosmeticHero item={item} />
      ) : beat === "status" ? (
        <StatusStage item={item} loadout={loadout} name={name} />
      ) : (
        <UseStage item={item} loadout={loadout} name={name} />
      )}
    </View>
  );
}

/**
 * Beats ② and ③ side by side under one heading — the inventory / loadout detail's "what it does"
 * block, so browsing an item shows the same two surfaces the reveal walks through.
 */
export function CosmeticContextPair({ item }: { item: CatalogItem }) {
  return (
    <View style={styles.pair}>
      {(["status", "use"] as const).map((beat) => (
        <View key={beat} style={styles.pairCell}>
          <Text style={styles.pairLabel}>
            {beatLabel(item, beat).toUpperCase()}
          </Text>
          <CosmeticInContext item={item} beat={beat} />
        </View>
      ))}
    </View>
  );
}

/** The fixed height every stage is laid out against, so switching beats never moves the page. */
export const CONTEXT_STAGE_HEIGHT = 236;

const styles = StyleSheet.create({
  stage: {
    height: CONTEXT_STAGE_HEIGHT,
    alignSelf: "stretch",
    alignItems: "center",
    justifyContent: "center",
  },
  // ── profile
  miniProfile: {
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    gap: Spacing.two,
    minWidth: 270,
  },
  miniProfileRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  avatarSlot: {
    alignItems: "center",
    justifyContent: "center",
  },
  who: {
    flexShrink: 1,
    gap: 2,
  },
  nameLine: {
    flexDirection: "row",
    alignItems: "center",
  },
  name: {
    fontFamily: Fonts.bodyBold,
    fontSize: 17,
    color: Colors.ink,
    flexShrink: 1,
  },
  beside: {
    marginLeft: 5,
  },
  // ── showcase
  showcase: {
    gap: 6,
  },
  showcaseLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9.5,
    letterSpacing: 1.4,
    color: Colors.textTertiary,
  },
  showcaseRow: {
    flexDirection: "row",
    gap: Spacing.two,
  },
  showcaseSlot: {
    width: 70,
    height: 70,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  showcaseSlotLit: {
    backgroundColor: "rgba(255,255,255,0.09)",
    borderColor: "rgba(255,255,255,0.2)",
  },
  // ── lock-in
  lockin: {
    width: 220,
    height: CONTEXT_STAGE_HEIGHT - 8,
    borderRadius: 26,
    backgroundColor: Colors.forgeBg,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  lockinKicker: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9.5,
    letterSpacing: 1.6,
    color: Colors.muted,
  },
  lockinClock: {
    fontFamily: Fonts.bodyBold,
    fontSize: 26,
    color: Colors.ink,
    marginTop: 2,
    fontVariant: ["tabular-nums"],
  },
  lockinFlame: {
    marginTop: Spacing.two,
    alignItems: "center",
    justifyContent: "center",
  },
  lockinCaption: {
    position: "absolute",
    bottom: 14,
    left: 10,
    right: 10,
    textAlign: "center",
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: Colors.ink,
  },
  haloFlameDisc: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.25)",
  },
  // ── home
  home: {
    width: 220,
    height: CONTEXT_STAGE_HEIGHT - 8,
    borderRadius: 26,
    backgroundColor: Colors.card,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  homeHi: {
    fontFamily: Fonts.display,
    fontSize: 20,
    color: Colors.ink,
  },
  homeCaption: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 10.5,
    letterSpacing: 1.2,
    color: Colors.textTertiary,
    textTransform: "uppercase",
  },
  // ── avatar
  avatarStage: {
    width: 200,
    height: 200,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarName: {
    fontFamily: Fonts.bodyBold,
    fontSize: 15,
    color: Colors.ink,
    marginTop: Spacing.three,
  },
  // ── banner
  bannerHeader: {
    width: 290,
    height: 150,
    borderRadius: Radius.card,
    overflow: "hidden",
    justifyContent: "flex-end",
  },
  bannerHeaderName: {
    fontFamily: Fonts.display,
    fontSize: 18,
    color: Colors.ink,
    padding: Spacing.three,
  },
  chat: {
    width: 270,
    height: CONTEXT_STAGE_HEIGHT - 8,
    borderRadius: Radius.card,
    overflow: "hidden",
    backgroundColor: Colors.card,
  },
  chatBody: {
    flex: 1,
    justifyContent: "flex-end",
    padding: Spacing.three,
    gap: Spacing.two,
  },
  chatWho: {
    position: "absolute",
    top: Spacing.three,
    left: Spacing.three,
    fontFamily: Fonts.display,
    fontSize: 15,
    color: Colors.ink,
  },
  bubble: {
    maxWidth: "80%",
    paddingVertical: 7,
    paddingHorizontal: Spacing.three,
    borderRadius: 16,
  },
  bubbleThem: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(20,14,30,0.82)",
  },
  bubbleMe: {
    alignSelf: "flex-end",
    backgroundColor: Colors.ember,
  },
  bubbleText: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.ink,
  },
  // ── leaderboard
  board: {
    width: 290,
    gap: 6,
  },
  boardRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    paddingVertical: 8,
    paddingHorizontal: Spacing.three,
    borderRadius: 14,
  },
  boardMe: {
    backgroundColor: "rgba(255,255,255,0.09)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    paddingVertical: 12,
  },
  boardGhost: {
    opacity: 0.4,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  boardRank: {
    width: 16,
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: Colors.muted,
    textAlign: "center",
  },
  boardRankMe: {
    color: Colors.ink,
  },
  boardGhostAvatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  boardGhostName: {
    width: 110,
    height: 9,
    borderRadius: 5,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  boardName: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.ink,
    flexShrink: 1,
  },
  // ── trophy hall
  hall: {
    width: 250,
    alignItems: "center",
  },
  hallLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 1.6,
    color: Colors.amber,
    marginBottom: Spacing.two,
  },
  hallShelf: {
    alignItems: "center",
    justifyContent: "flex-end",
    height: 120,
  },
  hallPlank: {
    width: 220,
    height: 10,
    borderRadius: 4,
    backgroundColor: "#3a2a18",
    borderTopWidth: 2,
    borderTopColor: "#6b4a24",
  },
  // ── share card
  shareCardWrap: {
    alignItems: "center",
  },
  shareCard: {
    width: 150,
    height: CONTEXT_STAGE_HEIGHT - 12,
  },
  shareCardInner: {
    flex: 1,
    minHeight: CONTEXT_STAGE_HEIGHT - 12,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    padding: Spacing.two,
  },
  shareName: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.ink,
    marginTop: 6,
  },
  shareMark: {
    position: "absolute",
    bottom: 10,
    fontFamily: Fonts.display,
    fontSize: 12,
    color: "rgba(255,255,255,0.55)",
  },
  // ── hero
  heroAvatarDisc: {
    flex: 1,
    backgroundColor: "#241a38",
  },
  heroBanner: {
    width: 270,
    height: CONTEXT_STAGE_HEIGHT - 8,
    borderRadius: Radius.card,
    overflow: "hidden",
  },
  heroTitle: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    borderRadius: Radius.card,
    backgroundColor: "rgba(255,255,255,0.05)",
    transform: [{ scale: 1.6 }],
  },
  heroSound: {
    alignItems: "center",
    gap: Spacing.two,
  },
  // ── pair (inventory / loadout)
  pair: {
    alignSelf: "stretch",
    gap: Spacing.three,
  },
  pairCell: {
    gap: Spacing.one,
  },
  pairLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
    letterSpacing: 1.3,
    color: Colors.textTertiary,
    textAlign: "center",
  },
});
