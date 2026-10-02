import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useState, type ReactNode } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";

import {
  CosmeticInContext,
  IN_CONTEXT,
  hueInk,
  itemHue,
  type ContextBeat,
} from "@/components/economy/cosmetic-in-context";
import { FullscreenRays } from "@/components/economy/reward-rays";
import { SeasonChip, isSeasonItem } from "@/components/economy/season-chip";
import { Colors, Fonts, Radius, Spacing } from "@/constants/theme";
import { useReduceMotion } from "@/hooks/use-reduce-motion";
import { useRevealPreview, useRevealSting } from "@/hooks/use-audio-preview";
import { equipCosmetic } from "@/lib/api/inventory";
import type { CatalogItem } from "@/lib/economy/catalog";
import { cosmeticEffect } from "@/lib/economy/cosmetic-effect";
import { RARITY_COLOR, RARITY_LABEL, type Rarity } from "@/lib/economy/rarity";
import { requestInventoryRefresh } from "@/lib/economy/wallet-refresh";
import { getErrorMessage } from "@/lib/errors";

// ══════════════════════════════════════════════════════════════════════════════════════════════
// THE UNLOCK REVEAL — one payoff screen for every cosmetic, whatever paid it (mocks 251/253/254).
//
// A box, a Forge Pass level, a placement, a relic: four sources, one reveal. Before this each had
// its own hero (the box's SingleMenu, the forge's ForgeReveal, the pass's 24px icon row, the relic's
// frame) and none of them showed what the item DOES. This one does, in three beats:
//
//   ① the item itself + its lore   — drawn as itself: a flame burns, a flare loops, a medal is the
//                                     struck disc, a relic is the artifact.
//   ② visual status                — where it lives equipped (CosmeticInContext 'status').
//   ③ personal use                 — where it shows up in action (CosmeticInContext 'use'). For a
//                                     flare this is the lifecycle's top end: the perimeter wrapping
//                                     the lock-in and surging tier by tier.
//
// THE ITEM'S HUE RUNS THE SCREEN (mock 251). The rays, the name's glow and the Equip button take
// the item's own colour, so a Solar Flare reveal is gold and a Void Plasma one is violet. Rarity
// keeps its own colour on the chip, and the word on top: "EPIC UNLOCKED", then the name.
//
// The beats advance by themselves until the first tap, then stay where the user put them. Nothing
// auto-plays past ③, and nothing here chains into a second item — the box grid (multi-item-reveal)
// is what decides whether there is another reveal to open, and only on a tap.
//
// 🔒 PRESENTATION ONLY, like every reveal. The item is already owned when this draws. Equip is the
// one write, and it is the same equip_cosmetic the inventory makes.
// ══════════════════════════════════════════════════════════════════════════════════════════════

const BEATS: ContextBeat[] = ["item", "status", "use"];

/** How long each beat holds before the reveal walks on by itself — long enough to read the line. */
const BEAT_MS = 3800;

const BEAT_TAB: Record<ContextBeat, string> = {
  item: "The item",
  status: "Equipped",
  use: "In action",
};

const CIRCLED = ["①", "②", "③"];

type Props = {
  item: CatalogItem;
  /**
   * The rarity to announce, when it is not the catalog's — a ladder relic's rung, a placement
   * title's override. Defaults to `item.rarity`.
   */
  rarity?: Rarity;
  /** Replaces "EPIC UNLOCKED" — the relic's "THE CROWN IS YOURS", a rung's "RELIC RANKED UP". */
  eyebrow?: string;
  /** One line under the name — what was done to earn it ("Study · 10 hours · β"). */
  subline?: string | null;
  /** A closing statement under the beats — the relic's "added to your Trophy Hall". */
  note?: ReactNode;
  /** The secondary button. "Add to inventory" by default; a relic says "Done". */
  closeLabel?: string;
  onClose: () => void;
  /**
   * Overlay mode — the box grid opens this over itself. Draws a back chevron that returns to the
   * grid instead of leaving the flow.
   */
  onBack?: () => void;
  /**
   * What Equip does once the server has it on. Defaults to the loadout picker (mock 250), whose live
   * preview is the first place you see it applied. Callers inside a flow with their own exit (the box
   * open) pass that instead.
   */
  onEquipped?: () => void;
  /**
   * Fire the rarity sting on mount. Off where something upstream already played it — the ×1 box,
   * whose crate fires the ladder on its lid-off frame.
   */
  sting?: boolean;
  /** Under the buttons — Share. */
  footer?: ReactNode;
};

export function UnlockReveal({
  item,
  rarity: rarityOverride,
  eyebrow,
  subline,
  note,
  closeLabel = "Add to inventory",
  onClose,
  onBack,
  onEquipped,
  sting = true,
  footer,
}: Props) {
  const router = useRouter();
  const reduceMotion = useReduceMotion();
  const rarity = rarityOverride ?? item.rarity;
  const hue = itemHue(item);
  const hueLight = lighten(hue, 0.55);

  const [beat, setBeat] = useState<ContextBeat>("item");
  const [touched, setTouched] = useState(false);
  const [equipping, setEquipping] = useState(false);
  const [equipped, setEquipped] = useState(false);

  // Auto-walk ①→②→③ until the user takes over, then hold. Stops at ③ rather than looping: the last
  // beat is the one that answers "what does it do", and cycling away from it mid-read undoes that.
  useEffect(() => {
    if (touched || beat === "use") return;
    const id = setTimeout(
      () =>
        setBeat((b) => BEATS[Math.min(BEATS.indexOf(b) + 1, BEATS.length - 1)]),
      BEAT_MS,
    );
    return () => clearTimeout(id);
  }, [beat, touched]);

  useRevealSting(sting ? rarity : undefined, false);
  // An AUDIO / SFX item's reveal IS its sound — auditioned once on mount, stopped on leave.
  useRevealPreview(item.id);

  // SFX has no slot of its own (the user picks Start, End or both), and relics and medals are never
  // worn — so "Equip now" exists only for an item with a slot, and an SFX routes to the loadout to
  // make that choice rather than guessing it here.
  const equippable = item.slot != null;
  const isSfx = item.type === "SFX";

  const goToLoadout = () => {
    if (onEquipped) onEquipped();
    else {
      onClose();
      router.push("/loadout");
    }
  };

  async function onEquip() {
    if (equipping) return;
    if (!equippable) {
      goToLoadout();
      return;
    }
    setEquipping(true);
    try {
      await equipCosmetic(item);
      // The loadout store is fed by inventory reads — this is what makes the profile, the flame and
      // every board pick the item up without a remount.
      requestInventoryRefresh();
      setEquipped(true);
      goToLoadout();
    } catch (e) {
      Alert.alert(
        "Couldn't equip that",
        getErrorMessage(e, "Something went wrong."),
      );
    } finally {
      setEquipping(false);
    }
  }

  const pick = (b: ContextBeat) => {
    setTouched(true);
    setBeat(b);
  };

  const caption =
    beat === "item"
      ? item.lore
        ? `“${item.lore}”`
        : null
      : beat === "status"
        ? cosmeticEffect(item)
        : capitalise(IN_CONTEXT[item.type].use) + ".";

  const primaryLabel = equipping
    ? "Equipping…"
    : equipped
      ? "Equipped ✓"
      : isSfx
        ? "Set it in your loadout"
        : "Equip now";

  return (
    <View style={styles.root}>
      <FullscreenRays
        kind="item_unlock"
        tint={{ inner: hueLight, outer: hue }}
        intensity={0.5}
      />

      {onBack ? (
        <Pressable
          style={styles.back}
          onPress={onBack}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={22} color={Colors.ink} />
        </Pressable>
      ) : null}

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View
          entering={reduceMotion ? undefined : FadeInDown.duration(500)}
          style={styles.top}
        >
          <Text style={[styles.kicker, { color: hueLight }]}>
            {eyebrow ?? `${RARITY_LABEL[rarity]} UNLOCKED`}
          </Text>
          <Text
            style={[styles.name, { textShadowColor: hue }]}
            numberOfLines={2}
          >
            {item.name}
          </Text>
          {subline ? <Text style={styles.subline}>{subline}</Text> : null}
        </Animated.View>

        {/* The stepper — three beats, the current one lit in the item's hue. */}
        <View style={styles.tabs} accessibilityRole="tablist">
          {BEATS.map((b, i) => {
            const on = b === beat;
            return (
              <Pressable
                key={b}
                onPress={() => pick(b)}
                style={[
                  styles.tab,
                  on && {
                    borderColor: hue,
                    backgroundColor: "rgba(255,255,255,0.08)",
                  },
                ]}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
              >
                <Text style={[styles.tabText, on && { color: Colors.ink }]}>
                  {CIRCLED[i]} {BEAT_TAB[b]}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {beat !== "item" ? (
          <Text style={[styles.where, { color: hueLight }]}>
            {IN_CONTEXT[item.type][beat].toUpperCase()}
          </Text>
        ) : (
          <View style={styles.whereSpacer} />
        )}

        {/* Keyed on the beat so each one fades in fresh; the stage height is fixed so the page never
            jumps between a short hero and a tall lock-in. */}
        <Animated.View
          key={beat}
          entering={reduceMotion ? undefined : FadeIn.duration(320)}
          style={styles.stageWrap}
        >
          <CosmeticInContext item={item} beat={beat} />
        </Animated.View>

        {caption ? (
          <Text style={[styles.caption, beat === "item" && styles.captionLore]}>
            {caption}
          </Text>
        ) : null}

        <View style={styles.chips}>
          <View
            style={[styles.rarityChip, { borderColor: RARITY_COLOR[rarity] }]}
          >
            <Text
              style={[styles.rarityChipText, { color: RARITY_COLOR[rarity] }]}
            >
              {RARITY_LABEL[rarity]} · {item.type}
            </Text>
          </View>
          {isSeasonItem(item) ? <SeasonChip size="md" /> : null}
        </View>

        {note ? <View style={styles.note}>{note}</View> : null}
      </ScrollView>

      <View style={styles.cta}>
        {equippable || isSfx ? (
          <Pressable
            style={[
              styles.primary,
              { backgroundColor: hue, shadowColor: hue },
              (equipping || equipped) && styles.primaryBusy,
            ]}
            onPress={onEquip}
            disabled={equipping || equipped}
            accessibilityRole="button"
          >
            <Text style={[styles.primaryText, { color: hueInk(hue) }]}>
              {primaryLabel}
            </Text>
          </Pressable>
        ) : null}
        <Pressable
          style={[styles.ghost, !(equippable || isSfx) && { borderColor: hue }]}
          onPress={onClose}
          accessibilityRole="button"
        >
          <Text style={styles.ghostText}>{closeLabel}</Text>
        </Pressable>
        {footer}
      </View>
    </View>
  );
}

/** Toward white, on the item's own hue — the kicker and the rays' hot core. */
function lighten(hex: string, amount: number): string {
  const n = parseInt(hex.replace("#", "").slice(0, 6), 16);
  if (!Number.isFinite(n)) return hex;
  const ch = (shift: number) => {
    const v = (n >> shift) & 255;
    return Math.round(v + (255 - v) * amount);
  };
  return `#${((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1)}`;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "rgba(11,8,20,0.94)",
    overflow: "hidden",
  },
  back: {
    position: "absolute",
    top: Spacing.three,
    left: Spacing.three,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    zIndex: 3,
  },
  scroll: {
    flexGrow: 1,
    alignItems: "center",
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.five,
    paddingBottom: Spacing.three,
  },
  top: {
    alignItems: "center",
  },
  kicker: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    letterSpacing: 3,
  },
  name: {
    fontFamily: Fonts.bodyBold,
    fontSize: 30,
    color: "#FFF6E4",
    textAlign: "center",
    marginTop: 6,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 14,
  },
  subline: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.muted,
    textAlign: "center",
    marginTop: 4,
  },
  tabs: {
    flexDirection: "row",
    gap: 6,
    marginTop: Spacing.four,
  },
  tab: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  tabText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11.5,
    color: Colors.muted,
  },
  where: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10.5,
    letterSpacing: 1.4,
    marginTop: Spacing.three,
    height: 14,
  },
  whereSpacer: {
    marginTop: Spacing.three,
    height: 14,
  },
  stageWrap: {
    alignSelf: "stretch",
    marginTop: Spacing.two,
  },
  caption: {
    fontFamily: Fonts.body,
    fontSize: 13.5,
    lineHeight: 20,
    color: "#d8cae8",
    textAlign: "center",
    maxWidth: 300,
    marginTop: Spacing.three,
    minHeight: 40,
  },
  captionLore: {
    fontStyle: "italic",
  },
  chips: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: Spacing.three,
  },
  rarityChip: {
    borderWidth: 1,
    borderRadius: Radius.pill,
    paddingHorizontal: 11,
    paddingVertical: 3,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  rarityChipText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10.5,
    letterSpacing: 0.6,
  },
  note: {
    alignSelf: "stretch",
    alignItems: "center",
    marginTop: Spacing.three,
  },
  cta: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.four,
    paddingTop: Spacing.two,
    gap: 10,
  },
  primary: {
    borderRadius: 15,
    paddingVertical: 15,
    alignItems: "center",
    shadowOpacity: 0.45,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  primaryBusy: {
    opacity: 0.75,
  },
  primaryText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 15,
  },
  ghost: {
    borderRadius: 15,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#3a3056",
  },
  ghostText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 15,
    color: "#cbb6e8",
  },
});
