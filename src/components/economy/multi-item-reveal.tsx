import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";

import { hueInk, itemHue } from "@/components/economy/cosmetic-in-context";
import { formatEmbers } from "@/components/economy/economy-bits";
import { ItemArt } from "@/components/economy/item-art";
import { UnlockReveal } from "@/components/economy/unlock-reveal";
import { Colors, Fonts, Radius, Spacing } from "@/constants/theme";
import { useReduceMotion } from "@/hooks/use-reduce-motion";
import type { OpenResult } from "@/lib/api/inventory";
import type { CatalogItem } from "@/lib/economy/catalog";
import {
  RARITIES,
  RARITY_COLOR,
  RARITY_LABEL,
  RARITY_ORDER,
  type Rarity,
} from "@/lib/economy/rarity";
import { fireReveal } from "@/lib/reward-feedback";

// ══════════════════════════════════════════════════════════════════════════════════════════════
// HOW A BOX LANDS (mock 256) — the many-item side of the unlock reveal.
//
// The unlock reveal is one item, three beats. A ×10 box is ten items, and ten three-beat reveals in
// a row is a minute of tapping through things you mostly already own. So the batch is split by the
// only question that matters to the person holding it — "what's NEW?":
//
//   NEW ITEMS get the reveal, rarest first. The rarest leads as a spotlight ("★ MYTHIC · NEW", tap to
//   see it in action); the rest follow under "Also new · rarest first". Tapping ANY new tile opens
//   that item's full three-beat reveal as an overlay; back returns here. Nothing auto-plays.
//
//   DUPLICATES get no reveal. The server already salvaged them inside open_loot_box, so they are
//   embers, not items — one line ("7 duplicates salvaged → +240 🔥") with an itemised receipt under
//   it, for the record. A box that was ALL duplicates shows only that, plus "open another?".
//
// THE SOUND STILL CRESCENDOS. The tiles are laid out rarest-first, but they animate in from the
// bottom of the list up — least rare first, the spotlight last — each on its own rung of the
// common→mythic ladder (fireReveal). So the room still builds to the best pull, the way the crate's
// single sting does on a ×1. Duplicate rungs play at the quiet volume fireReveal keeps for them.
//
// 🔒 PRESENTATION ONLY. Everything here is read off the OpenResults the server returned before the
// crate drew a frame — salvage values included. Nothing is granted, re-rolled or re-priced.
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** Gap between tiles landing — enough for each rung of the ladder to be heard as its own note. */
const STAGGER_MS = 260;

type Pull = { result: OpenResult; item: CatalogItem };

function asRarity(r: string | undefined): Rarity {
  return (RARITIES as readonly string[]).includes(r ?? "")
    ? (r as Rarity)
    : "common";
}

/** Rarest first; within a rarity, the order the server rolled them. */
function byRarityDesc(a: Pull, b: Pull): number {
  return (
    RARITY_ORDER[asRarity(b.result.rarity)] -
    RARITY_ORDER[asRarity(a.result.rarity)]
  );
}

type Props = {
  results: OpenResult[];
  boxName: string;
  /** Boxes in this batch that never opened — still unopened rows, not losses. */
  unopened?: number;
  /** Equip a new item and leave — the box flow's own exit (it refreshes the wallet the dupes moved). */
  onEquip: (item: CatalogItem) => void;
  equipping?: boolean;
  /** "Add all to inventory" — leave for the inventory. */
  onDone: () => void;
  /** The all-duplicates case's "open another?" — absent when there is nothing left to open. */
  onOpenAnother?: () => void;
  /** Share the haul, under the CTAs. */
  footer?: ReactNode;
};

export function MultiItemReveal({
  results,
  boxName,
  unopened = 0,
  onEquip,
  equipping,
  onDone,
  onOpenAnother,
  footer,
}: Props) {
  const reduceMotion = useReduceMotion();
  const [open, setOpen] = useState<CatalogItem | null>(null);

  const { fresh, dupes, unknown, salvaged } = useMemo(() => {
    const fresh: Pull[] = [];
    const dupes: Pull[] = [];
    const unknown: OpenResult[] = [];
    for (const r of results) {
      if (!r.item) unknown.push(r);
      else if (r.dupe) dupes.push({ result: r, item: r.item });
      else fresh.push({ result: r, item: r.item });
    }
    fresh.sort(byRarityDesc);
    dupes.sort(byRarityDesc);
    return {
      fresh,
      dupes,
      unknown,
      salvaged: dupes.reduce((n, d) => n + (d.result.embers ?? 0), 0),
    };
  }, [results]);

  const lead = fresh[0] ?? null;
  const rest = fresh.slice(1);

  // The ladder, least rare up to the spotlight. Fires once per mount; Reduce Motion keeps only the
  // spotlight's sting, because a run of stings with nothing landing under them is noise.
  useEffect(() => {
    if (fresh.length === 0) {
      // All duplicates: one quiet rung for the best of them, so opening a batch is never silent. Not
      // on a ×1 — its crate already fired the sting on the lid-off frame.
      if (dupes[0] && results.length > 1) fireReveal(asRarity(dupes[0].result.rarity), true);
      return;
    }
    if (reduceMotion) {
      fireReveal(asRarity(fresh[0].result.rarity));
      return;
    }
    const ascending = [...fresh].reverse();
    const timers = ascending.map((p, i) =>
      setTimeout(
        () => fireReveal(asRarity(p.result.rarity), i < ascending.length - 1),
        i * STAGGER_MS,
      ),
    );
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one ladder per haul
  }, []);

  /** When a tile lands: the bottom of the list first, the spotlight last. */
  const landsAt = (indexInFresh: number) =>
    (fresh.length - 1 - indexInFresh) * STAGGER_MS;

  const total = results.length;

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.boxName}>
          {boxName} ×{total}
        </Text>
        <Text style={styles.summary}>
          {fresh.length} new · {dupes.length}{" "}
          {dupes.length === 1 ? "duplicate" : "duplicates"}
        </Text>
        {lead ? (
          <Text style={styles.hint}>
            new drops, rarest first · tap any to see it in action
          </Text>
        ) : null}

        {lead ? (
          <Animated.View
            entering={
              reduceMotion
                ? undefined
                : FadeInDown.delay(landsAt(0)).duration(420)
            }
          >
            <Spotlight pull={lead} onPress={() => setOpen(lead.item)} />
          </Animated.View>
        ) : null}

        {rest.length > 0 ? (
          <>
            <Text style={styles.section}>ALSO NEW · RAREST FIRST</Text>
            <View style={styles.tiles}>
              {rest.map((p, i) => (
                <Animated.View
                  key={`${p.item.id}-${i}`}
                  entering={
                    reduceMotion
                      ? undefined
                      : FadeInDown.delay(landsAt(i + 1)).duration(360)
                  }
                  style={styles.tileCell}
                >
                  <NewTile pull={p} onPress={() => setOpen(p.item)} />
                </Animated.View>
              ))}
            </View>
          </>
        ) : null}

        {dupes.length > 0 ? (
          <SalvageReceipt dupes={dupes} total={salvaged} />
        ) : null}

        {unknown.length > 0 ? (
          <Text style={styles.note}>
            {unknown.length === 1 ? "One item" : `${unknown.length} items`} this
            version can&apos;t draw yet — already in your inventory. Update the
            app to see {unknown.length === 1 ? "it" : "them"}.
          </Text>
        ) : null}
        {unopened > 0 ? (
          <Text style={styles.note}>
            {unopened} {unopened === 1 ? "box" : "boxes"} didn&apos;t open —
            still unopened in your inventory, nothing lost.
          </Text>
        ) : null}
      </ScrollView>

      <View style={styles.cta}>
        {lead && lead.item.slot ? (
          <Pressable
            style={[
              styles.primary,
              { backgroundColor: itemHue(lead.item) },
              equipping && styles.busy,
            ]}
            onPress={() => onEquip(lead.item)}
            disabled={equipping}
            accessibilityRole="button"
          >
            <Text
              style={[
                styles.primaryText,
                { color: hueInk(itemHue(lead.item)) },
              ]}
              numberOfLines={1}
            >
              {equipping ? "Equipping…" : `Equip ${lead.item.name}`}
            </Text>
          </Pressable>
        ) : null}
        {!lead && onOpenAnother ? (
          <Pressable
            style={[styles.primary, styles.openAnother]}
            onPress={onOpenAnother}
            accessibilityRole="button"
          >
            <Text style={styles.primaryText}>Open another?</Text>
          </Pressable>
        ) : null}
        <Pressable
          style={styles.ghost}
          onPress={onDone}
          accessibilityRole="button"
        >
          <Text style={styles.ghostText}>
            {lead ? "Add all to inventory" : "Done"}
          </Text>
        </Pressable>
        {footer}
      </View>

      {/* The full three-beat reveal, over the grid. Back returns here; "Add to inventory" does too —
          the item is already banked, and the rest of the haul is still on this screen. */}
      {open ? (
        <View style={StyleSheet.absoluteFill}>
          <UnlockReveal
            key={open.id}
            item={open}
            onBack={() => setOpen(null)}
            onClose={() => setOpen(null)}
            closeLabel="Back to the haul"
            // The reveal equips the item itself; what comes back here is only the box flow's exit.
            onEquipped={onDone}
            // The ladder above already played this item's rung as it landed.
            sting={false}
          />
        </View>
      ) : null}
    </View>
  );
}

function Spotlight({ pull, onPress }: { pull: Pull; onPress: () => void }) {
  const rarity = asRarity(pull.result.rarity);
  const hue = itemHue(pull.item);
  return (
    <Pressable
      onPress={onPress}
      style={[styles.spot, { borderColor: hue, shadowColor: hue }]}
      accessibilityRole="button"
      accessibilityLabel={`${RARITY_LABEL[rarity]} ${pull.item.name}, new. See it in action.`}
    >
      <View style={styles.spotArt}>
        <ItemArt item={pull.item} size={96} motion="on" />
      </View>
      <View style={styles.spotBody}>
        <Text style={[styles.spotKicker, { color: RARITY_COLOR[rarity] }]}>
          ★ {RARITY_LABEL[rarity]} · NEW
        </Text>
        <Text style={styles.spotName} numberOfLines={2}>
          {pull.item.name}
        </Text>
        <Text style={styles.spotType}>{titleCase(pull.item.type)}</Text>
        <Text style={[styles.spotTap, { color: hue }]} numberOfLines={1}>
          tap → see it in action ›
        </Text>
      </View>
    </Pressable>
  );
}

function NewTile({ pull, onPress }: { pull: Pull; onPress: () => void }) {
  const rarity = asRarity(pull.result.rarity);
  return (
    <Pressable
      onPress={onPress}
      style={[styles.tile, { borderColor: RARITY_COLOR[rarity] }]}
      accessibilityRole="button"
      accessibilityLabel={`${pull.item.name}, ${RARITY_LABEL[rarity]}, new`}
    >
      <View style={styles.newBadge}>
        <Text style={styles.newBadgeText}>NEW</Text>
      </View>
      <ItemArt item={pull.item} size={52} motion="off" />
      <Text style={styles.tileName} numberOfLines={1}>
        {pull.item.name}
      </Text>
      <Text style={[styles.tileRarity, { color: RARITY_COLOR[rarity] }]}>
        {titleCase(rarity)}
      </Text>
    </Pressable>
  );
}

/** "N duplicates salvaged → +X 🔥", and the receipt that adds up to it. */
function SalvageReceipt({ dupes, total }: { dupes: Pull[]; total: number }) {
  return (
    <View style={styles.receipt}>
      <View style={styles.receiptHead}>
        <Text style={styles.receiptTitle}>
          {dupes.length} {dupes.length === 1 ? "duplicate" : "duplicates"}{" "}
          salvaged
        </Text>
        <Text style={styles.receiptTotal}>+{formatEmbers(total)} 🔥</Text>
      </View>
      {dupes.map((d, i) => {
        const rarity = asRarity(d.result.rarity);
        return (
          <View key={`${d.item.id}-${i}`} style={styles.receiptRow}>
            <Text style={styles.receiptName} numberOfLines={1}>
              {d.item.name}
            </Text>
            <Text
              style={[styles.receiptRarity, { color: RARITY_COLOR[rarity] }]}
            >
              {titleCase(rarity)}
            </Text>
            <Text style={styles.receiptValue}>
              +{formatEmbers(d.result.embers ?? 0)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  scroll: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.three,
    gap: Spacing.two,
  },
  boxName: {
    fontFamily: Fonts.bodyBold,
    fontSize: 22,
    color: Colors.ink,
    textAlign: "center",
  },
  summary: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.ink,
    textAlign: "center",
  },
  hint: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.muted,
    textAlign: "center",
    marginBottom: Spacing.two,
  },
  section: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
    letterSpacing: 1.4,
    color: Colors.textTertiary,
    marginTop: Spacing.three,
  },
  // ── spotlight
  spot: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: 18,
    borderWidth: 1.5,
    backgroundColor: "rgba(255,255,255,0.05)",
    shadowOpacity: 0.5,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
  spotArt: {
    width: 104,
    alignItems: "center",
  },
  spotBody: {
    flex: 1,
    gap: 2,
  },
  spotKicker: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 1.2,
  },
  spotName: {
    fontFamily: Fonts.bodyBold,
    fontSize: 20,
    color: Colors.ink,
  },
  spotType: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.muted,
  },
  spotTap: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    marginTop: 6,
  },
  // ── also new
  tiles: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.two,
  },
  tileCell: {
    width: "31.5%",
  },
  tile: {
    alignItems: "center",
    paddingVertical: Spacing.two,
    paddingHorizontal: 6,
    borderRadius: 14,
    borderWidth: 1,
    backgroundColor: Colors.cardDark,
    gap: 2,
  },
  newBadge: {
    position: "absolute",
    top: 5,
    right: 5,
    backgroundColor: Colors.coral,
    borderRadius: Radius.pill,
    paddingHorizontal: 5,
    paddingVertical: 1,
    zIndex: 1,
  },
  newBadgeText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 7.5,
    letterSpacing: 0.8,
    color: "#fff",
  },
  tileName: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11.5,
    color: Colors.ink,
    marginTop: 2,
  },
  tileRarity: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9.5,
  },
  // ── salvage
  receipt: {
    marginTop: Spacing.three,
    padding: Spacing.twelve,
    borderRadius: Radius.card,
    backgroundColor: Colors.cardDark,
    gap: 6,
  },
  receiptHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: 6,
    marginBottom: 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,246,236,0.14)",
  },
  receiptTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: Colors.ink,
  },
  receiptTotal: {
    fontFamily: Fonts.bodyBold,
    fontSize: 15,
    color: Colors.ember,
  },
  receiptRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  receiptName: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.muted,
  },
  receiptRarity: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    width: 72,
  },
  receiptValue: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.ember,
    width: 52,
    textAlign: "right",
  },
  note: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    lineHeight: 17,
    color: Colors.muted,
    textAlign: "center",
    marginTop: Spacing.two,
  },
  // ── ctas
  cta: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.four,
    paddingTop: Spacing.two,
    gap: 10,
  },
  primary: {
    borderRadius: 15,
    paddingVertical: 15,
    paddingHorizontal: Spacing.three,
    alignItems: "center",
  },
  openAnother: {
    backgroundColor: Colors.coral,
  },
  busy: {
    opacity: 0.75,
  },
  primaryText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 15,
    color: "#1a1020",
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
