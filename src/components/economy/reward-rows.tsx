import { Ionicons } from '@expo/vector-icons';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/ui/primary-button';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';

// The reward-row language shared by mocks 47 and 103 (`.rw` / `.ri` / `.rlab` / `.rval`).
//
// One primitive rather than two near-identical copies: the mocks explicitly call for "same reward
// row language as mock 47", and a challenge win and a goal streak pay in the same four currencies
// (XP, embers, a box, a badge). Two implementations would drift the moment one of them gained a
// fifth.
//
// A row is deliberately dumb — it renders what it is handed. Deciding WHAT was won belongs to the
// server (grant_reward / economy_award_goal_day); a screen that computed its own reward list could
// disagree with the ledger, and the ledger is what actually paid.

export type RewardRowKind = 'xp' | 'embers' | 'box' | 'badge' | 'cosmetic';

export type RewardRowSpec = {
  kind: RewardRowKind;
  /** Bold first line — "+235 Embers", "\"Firestarter\" badge". */
  title: string;
  /**
   * The quiet second line explaining where it came from. Optional — the daily reveal's ember row
   * drops it entirely ("Daily goal · easy target" was a caption on a screen whose whole point is
   * that it is one number and one button).
   */
  detail?: string;
  /** Right-aligned amount (mock 47's `.rval`), e.g. "+1,000". Omit for rows with a chip instead. */
  value?: string;
  /** Small pill after the title — "LEGENDARY", "EARNED". */
  chip?: { label: string; color: string };
  /** Where it landed — mock 103's `.dest`, e.g. "→ wallet". */
  destination?: string;
  /**
   * The row's own colour — the box's RARITY, the cosmetic's rarity, the tier's accent.
   *
   * 🔴 THE FIX FOR "THE IGNITION CRATE IS AMBER". Every box row in the app hardcoded
   * `Colors.amber` for its chip and its icon, so all six crates rendered the same gold regardless
   * of what they actually are — while the box art, the shop, the inventory and mock 170 all agree
   * that Ignition is GREEN (uncommon), Furnace BLUE (rare) and Hestia PURPLE (epic). Rarity is
   * semantic in this app: it is the one thing a player reads before the name. Handing the row an
   * accent, and deriving that accent from `BOXES[key].rarity` at the call sites, is what stops a
   * seventh copy of the hardcode appearing on the next screen.
   */
  accent?: string;
  /** Renders the row as the openable box (mock 47's `.rw.box` with its Open button). */
  onOpen?: () => void;
  /** A flight is in the air somewhere on the screen, so Open should not take a tap either. */
  openDisabled?: boolean;
  /**
   * Already taken — the row dims and its control becomes a tick.
   *
   * THE STATE PER-ROW CLAIMING NEEDED AND SEQUENTIAL CLAIMING DID NOT. When one footer button
   * walked the rewards in order, "claimed" was implicit in the index: everything above the current
   * step was done. With every row carrying its own control there is no order left to infer it
   * from, so each row has to say. It is also the only feedback that a claim which flew off-screen
   * actually happened — the embers land in a pill in the corner, not in the row you pressed.
   */
  claimed?: boolean;
  /**
   * The claim, INSIDE the row, in the slot `destination` would have used.
   *
   * The daily reveal is now a title and one row (see goal-streak-reward-screen), so its footer CTA
   * is gone and the row itself has to carry the action. "→ wallet" was a label describing where the
   * embers were going once you pressed something else; this is the something else, in the same
   * place, saying the same thing as a verb.
   *
   * Takes precedence over `value` and `destination` — a row that can be claimed is a row whose
   * right-hand side is the claim.
   */
  claim?: { label: string; onPress: () => void; disabled?: boolean };
  /**
   * A cosmetic's action. Equip, not Claim — §0b of the parity pass.
   *
   * A title or a skin the event granted is ALREADY OWNED by the time this screen renders (the
   * grant minted it server-side, like everything else here). There is nothing to claim and nowhere
   * to fly it to: the only thing left to do with it is put it on. So the row carries the same verb
   * the unlock reveal uses, and `equipped` is its finished state rather than `claimed`.
   */
  equip?: { onPress: () => void; disabled?: boolean; equipped?: boolean };
};

const KIND_ICON: Record<RewardRowKind, { name: keyof typeof Ionicons.glyphMap; tint: string; bg: string }> = {
  xp: { name: 'flash', tint: Colors.amber, bg: 'rgba(242,163,60,0.16)' },
  embers: { name: 'flame', tint: Colors.ember, bg: 'rgba(255,210,122,0.16)' },
  box: { name: 'cube', tint: '#FFD27A', bg: 'rgba(138,90,18,0.35)' },
  badge: { name: 'star', tint: Colors.green, bg: 'rgba(61,168,92,0.16)' },
  cosmetic: { name: 'sparkles', tint: '#C99BF7', bg: 'rgba(168,85,247,0.16)' },
};

// Memoised: `rows` is already a stable useMemo for the length of a flight, so this stops the
// balance counter re-rendering rows that cannot have changed.
export const RewardRow = memo(function RewardRow({ spec }: { spec: RewardRowSpec }) {
  const base = KIND_ICON[spec.kind];
  // The accent wins where it is given, so a row's icon, chip and action all carry one colour and
  // that colour is the reward's own rarity rather than a per-screen guess.
  const icon = spec.accent ? { ...base, tint: spec.accent, bg: withAlpha(spec.accent) } : base;
  const isBox = Boolean(spec.onOpen);
  const done = spec.claimed || spec.equip?.equipped;

  return (
    <View style={[styles.row, isBox && styles.rowBox, done && styles.rowClaimed]}>
      <View style={[styles.iconTile, { backgroundColor: icon.bg }]}>
        <Ionicons name={icon.name} size={16} color={icon.tint} />
      </View>

      <View style={styles.labels}>
        <View style={styles.titleLine}>
          <Text style={styles.title} numberOfLines={1}>
            {spec.title}
          </Text>
          {spec.chip ? (
            <View style={[styles.chip, { backgroundColor: withAlpha(spec.chip.color) }]}>
              <Text style={[styles.chipText, { color: spec.chip.color }]}>{spec.chip.label}</Text>
            </View>
          ) : null}
        </View>
        {spec.detail ? (
          <Text style={styles.detail} numberOfLines={2}>
            {spec.detail}
          </Text>
        ) : null}
      </View>

      {done ? (
        // Taken. Not a disabled button — a disabled control still reads as something you failed to
        // press, and this is the opposite: the one row on screen that is finished.
        <View style={styles.takenSlot} accessibilityLabel="Claimed">
          <Ionicons name="checkmark" size={15} color={Colors.green} />
        </View>
      ) : spec.equip ? (
        // Mock 170's `.cbtn.equip` — gold, and deliberately not the ember PrimaryButton the Claim
        // rows use. Equipping is not claiming, and giving the two the same button would say it is.
        <Pressable
          style={[styles.equipBtn, spec.equip.disabled && styles.openBtnDisabled]}
          onPress={spec.equip.onPress}
          disabled={spec.equip.disabled}
          accessibilityRole="button">
          <Text style={styles.equipBtnText}>Equip</Text>
        </Pressable>
      ) : spec.onOpen ? (
        <Pressable
          // Tinted by the box's rarity (mock 170's `.cbtn.open` / `.cbtn.open.green`), so the one
          // control on the row agrees with the crate it opens.
          style={[
            styles.openBtn,
            spec.accent ? { backgroundColor: spec.accent } : null,
            spec.openDisabled && styles.openBtnDisabled,
          ]}
          onPress={spec.onOpen}
          disabled={spec.openDisabled}
          accessibilityRole="button">
          <Text style={styles.openBtnText}>Open</Text>
        </Pressable>
      ) : spec.claim ? (
        // 🎨 THE REAL PRIMARY BUTTON, at row size. This was drawn with EmberFill, which paints the
        // same two ember stops but HORIZONTALLY and at a pill radius — while every other primary
        // CTA in the app is those stops at 135° with Radius.button. Identical palette, visibly
        // different object, which is what "isn't the ember UI the other buttons use" was. Now it is
        // literally the same component, so its press state, its disabled state and its gradient can
        // never drift from the rest again.
        <View style={styles.claimSlot}>
          <PrimaryButton
            label={spec.claim.label}
            onPress={spec.claim.onPress}
            disabled={spec.claim.disabled}
            compact
          />
        </View>
      ) : spec.value ? (
        <Text style={[styles.value, { color: icon.tint }]}>{spec.value}</Text>
      ) : spec.destination ? (
        <Text style={styles.destination}>{spec.destination}</Text>
      ) : null}
    </View>
  );
});

/** The chip background is the chip's own colour at low alpha — one input, so a new rarity can't
 * arrive with a background that doesn't match its text. */
function withAlpha(hex: string): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, 0.18)`;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.twelve,
    backgroundColor: Colors.achieverBg,
    borderRadius: Radius.card,
    paddingVertical: Spacing.twelve,
    paddingHorizontal: Spacing.twelve,
  },
  // Mock 47 gives the box row its own warmer ground so the one actionable row reads as the one
  // you're meant to tap.
  rowBox: {
    backgroundColor: '#3A2A18',
    borderWidth: 1,
    borderColor: 'rgba(242,163,60,0.35)',
  },
  iconTile: {
    width: 34,
    height: 34,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  labels: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  titleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  title: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13.5,
    color: Colors.ink,
    flexShrink: 1,
  },
  detail: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.muted,
  },
  chip: {
    borderRadius: Radius.pill,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  chipText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 8.5,
    letterSpacing: 0.4,
  },
  value: {
    fontFamily: Fonts.bodyBold,
    fontSize: 16,
    fontVariant: ['tabular-nums'],
  },
  destination: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textTertiary,
  },
  openBtn: {
    backgroundColor: Colors.amber,
    borderRadius: Radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  openBtnText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12.5,
    color: '#3A2410',
  },
  // The button sizes itself; this only stops the row's flex from squeezing it when the title runs
  // long ("+1,000 Embers").
  claimSlot: {
    flexShrink: 0,
  },
  // Dimmed rather than hidden. The manifest is a receipt as much as a set of controls — a row that
  // vanished on claim would leave the screen shrinking under the user's thumb and take the record
  // of what they won with it.
  rowClaimed: {
    opacity: 0.55,
  },
  takenSlot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(61,168,92,0.16)',
    flexShrink: 0,
  },
  openBtnDisabled: {
    opacity: 0.45,
  },
  equipBtn: {
    backgroundColor: Colors.amber,
    borderRadius: Radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 7,
    flexShrink: 0,
  },
  equipBtnText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12.5,
    color: '#241207',
  },
});
