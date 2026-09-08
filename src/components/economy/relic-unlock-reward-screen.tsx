import { StyleSheet, Text, View } from 'react-native';

import { ItemArt } from '@/components/economy/item-art';
import { useRewardClaim } from '@/components/economy/reward-claim';
import { RewardRevealFrame, RevealHeadline } from '@/components/economy/reward-reveal-frame';
import { PrimaryButton } from '@/components/ui/primary-button';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { useRevealSting } from '@/hooks/use-audio-preview';
import { getItem } from '@/lib/economy/catalog';
import { RELIC_LADDERS, RUNG_GLYPH } from '@/lib/economy/relic-ladders';
import { RARITY_COLOR, RARITY_LABEL, rarityGlow, type Rarity } from '@/lib/economy/rarity';
import type { UnseenRelicUnlock } from '@/types/database';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// A RELIC UNLOCK, CELEBRATED — CODE_PROMPT_loop_signoff_meta.md §1.2, migration 0176.
//
// THE FIFTH WRAPPER ON THE SAME FRAME, and the argument for that is the same as it was for the
// fourth: `RewardRevealFrame` already owns the ray fan, the build-in, the top bar and the way out.
// What is genuinely this payout's own is the hero — a relic in its rarity aura — and the line under
// it that says what was actually done to earn it. Everything else is inherited.
//
// 🔴 IT IS A SINGLE-STEP REVEAL, DELIBERATELY. Every other reveal in the app has a second face
// listing what you can claim; this one has nothing to claim. A relic pays no embers, mints no crate
// and moves no XP — the relic IS the reward, and it is already on the shelf by the time this draws.
// Handing it a "See rewards" button would promise a second screen whose only row is a restatement
// of the thing already filling the first. `rows={[]}` and the frame collapses to one step on its
// own; the footer carries Share, which is the only thing there is to DO with a relic.
//
// 🔒 PRESENTATION ONLY. NOTHING HERE GRANTS ANYTHING. economy_grant_relic already ran, inside a
// trigger, usually with no client anywhere near it. Every word on this screen is read back off the
// row it wrote.
// ══════════════════════════════════════════════════════════════════════════════════════════════

type Props = {
  relic: UnseenRelicUnlock;
  onClose: () => void;
  /** Photograph the story card. Absent while a capture is already in flight. */
  onShare?: () => void;
  sharing?: boolean;
};

export function RelicUnlockRewardScreen({ relic, onClose, onShare, sharing }: Props) {
  const item = getItem(relic.out_relic_key);
  // The catalog is the authority on art and rarity, and it can miss: a relic granted by a server
  // that knows a key this build does not (the exact shape the box-open error boundary exists for).
  // Falling back to legendary rather than bailing keeps the reveal — a user who earned a relic
  // should see SOMETHING happen, and the name comes off the server row either way.
  const rarity: Rarity = item?.rarity ?? 'legendary';
  const tint = RARITY_COLOR[rarity];

  // NO BOX, NO EMBERS, NO XP — so `kinds` is empty, nothing is claimable, and `ctaLabel` resolves to
  // "Done". The hook is still what drives the frame's top bar, its build-in and its dismiss, which
  // is why it is constructed at all.
  const claim = useRewardClaim({
    boxKey: null,
    boxName: null,
    embers: 0,
    walletEmbers: null,
    onDone: onClose,
  });

  // THE RARITY LADDER (#85), not one fixed fanfare. A Legendary Scroll and a Mythic Crown of
  // Olympus landing on the same sting would flatten the one distinction the reveal is built around,
  // and the six escalating cues already exist for exactly this. Fires once per mount, respects the
  // reward-SFX setting inside fireReveal, and carries the per-tier haptic with it.
  useRevealSting(rarity, false);

  const line = relicEarnedLine(relic);

  return (
    <RewardRevealFrame
      claim={claim}
      kind="relic_unlock"
      heroStyle={styles.hero}
      hero={
        <View style={styles.heroInner}>
          {/* The gold aura the brief asks for, as light rather than as a border — a disc of the
              relic's own rarity behind the art, so a Mythic reads red and a Legendary gold without
              the layout changing. Sized past the art on purpose: the glow should look like it is
              coming OFF the relic, and the frame blooms its ray fan from this same node. */}
          <View style={[styles.aura, { backgroundColor: rarityGlow(rarity, 0.42) }]} />
          <View style={[styles.auraInner, { backgroundColor: rarityGlow(rarity, 0.3) }]} />
          {item ? <ItemArt item={item} size={124} /> : <Text style={[styles.glyphFallback, { color: tint }]}>◆</Text>}
        </View>
      }
      rows={[]}
      footer={
        onShare ? (
          <PrimaryButton
            label={sharing ? 'Preparing…' : 'Share'}
            onPress={onShare}
            disabled={sharing}
            variant="ghost"
          />
        ) : null
      }>
      <RevealHeadline
        // The capstone gets its own word. Crown of Olympus is every ladder maxed — the rarest event
        // in the app — and calling it "RELIC UNLOCKED" like the 10h Scroll would be the reveal
        // failing to notice what just happened.
        eyebrow={relic.out_is_capstone ? 'THE CROWN IS YOURS' : 'RELIC UNLOCKED'}
        eyebrowColor={tint}
        headline={relic.out_name}
        subline={line}
      />
      <View style={[styles.chip, { borderColor: tint }]}>
        <Text style={[styles.chipText, { color: tint }]}>
          {RARITY_LABEL[rarity].toUpperCase()} · DISCIPLINE RELIC
        </Text>
      </View>
      {/* Where it went. A relic never appears in the inventory grid with the flame skins — it lives
          on the Trophy Hall shelf — and a user who taps Done and then goes looking in the wrong
          room is the same complaint the 0176 deep-link change fixes on the push side. */}
      <Text style={styles.dest}>Added to your Trophy Hall</Text>
    </RewardRevealFrame>
  );
}

/**
 * What was actually done to earn it — "10 hours of Study", "50 km moved".
 *
 * Exported because the share card needs the SAME sentence: the card's flex pill and the reveal's
 * subline are the same claim about the same relic, and two copies would drift the first time one
 * of them was reworded.
 *
 * TWO SOURCES, AND THE LADDER ONE IS PREFERRED because it is the only one that can be phrased in
 * the user's terms. `provenance` is the sentence the server passed as `p_why` ("Tier I α — 10 h.
 * The ladder has begun.") which is good lore and bad copy for a headline subline: it leads with a
 * tier number nobody has been taught yet. When the relic rides a ladder we have the family, the
 * threshold and the unit as data and can write the sentence properly.
 *
 * The seven ancient relics ride no ladder and have no row to read, so provenance IS the copy for
 * them — and there it reads well, because it was written for them specifically ("500 hours. The
 * weight of the sky.").
 */
export function relicEarnedLine(relic: UnseenRelicUnlock): string | null {
  if (relic.out_is_capstone) return 'Every ladder maxed. Nobody does this by accident.';

  const ladder = RELIC_LADDERS.find((l) => l.family === relic.out_family);
  if (ladder && relic.out_rung_threshold != null) {
    const amount = relic.out_rung_threshold.toLocaleString('en-US');
    const rung =
      relic.out_rung != null && relic.out_rung >= 1 && relic.out_rung <= RUNG_GLYPH.length
        ? ` · rung ${RUNG_GLYPH[relic.out_rung - 1]}`
        : '';
    // "10 h of Study" reads worse than "10 hours of Study", and only the hours ladder has that
    // problem — 'lb' and 'km' are already how anyone would say them out loud.
    const unit = ladder.unit === 'h' ? 'hours' : ladder.unit;
    return `${amount} ${unit} of ${ladder.short}${rung}`;
  }

  return relic.out_provenance?.trim() || null;
}

const styles = StyleSheet.create({
  hero: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 196,
  },
  heroInner: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 196,
    height: 196,
  },
  // Two stacked discs rather than one: a single flat circle at 0.42 reads as a coloured plate
  // behind the art, and the app's glow language everywhere else (the flare perimeter, the crate
  // shadow) is a falloff. Two radii approximate one cheaply, and cheaply matters — this mounts
  // during a modal transition on the same frame the ray fan blooms.
  aura: {
    position: 'absolute',
    width: 190,
    height: 190,
    borderRadius: 95,
    opacity: 0.55,
  },
  auraInner: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
  },
  glyphFallback: {
    fontFamily: Fonts.display,
    fontSize: 72,
  },
  chip: {
    alignSelf: 'center',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: Spacing.two,
    paddingVertical: 4,
    marginTop: Spacing.two,
  },
  chipText: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    letterSpacing: 1.1,
  },
  dest: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    lineHeight: 18,
    color: Colors.muted,
    textAlign: 'center',
    marginTop: Spacing.one,
  },
});
