import { StyleSheet, Text, View } from 'react-native';

import { ItemArt } from '@/components/economy/item-art';
import { useRewardClaim } from '@/components/economy/reward-claim';
import { RewardRevealFrame, RevealHeadline } from '@/components/economy/reward-reveal-frame';
import { PrimaryButton } from '@/components/ui/primary-button';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { useRevealSting } from '@/hooks/use-audio-preview';
import { useInventory } from '@/hooks/use-inventory';
import { getItem } from '@/lib/economy/catalog';
import {
  RELIC_LADDERS,
  RUNG_GLYPH,
  isLadderRelic,
  ladderRarity,
  rungGlyph,
} from '@/lib/economy/relic-ladders';
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
  /**
   * This is a RUNG climbed on a ladder already held, not a first unlock — migration 0179's inbox.
   *
   * ONE FLAG RATHER THAN A SECOND SCREEN, and the reason is that the two events differ in exactly
   * two sentences. A rank-up has the same hero (the same relic, in a hotter aura), the same rung
   * line, the same share card and the same single-step shape; what it must NOT say is "unlocked"
   * and "added to your Trophy Hall", because the relic has been sitting there since rung α and
   * telling someone it just arrived is the reveal not knowing what happened. A forked screen would
   * duplicate the other ninety lines to change those two.
   *
   * Passed by the watcher, which knows which inbox the row came from, rather than sniffed off the
   * payload — the two are structurally interchangeable on purpose (see `UnseenRelicRung`).
   */
  rankUp?: boolean;
  /** Photograph the story card. Absent while a capture is already in flight. */
  onShare?: () => void;
  sharing?: boolean;
};

export function RelicUnlockRewardScreen({ relic, onClose, rankUp, onShare, sharing }: Props) {
  const item = getItem(relic.out_relic_key);
  // 🔴 THE RUNG'S RARITY, NOT THE CATALOG'S. A ladder relic has ONE catalog entry carrying its
  // FIRST rung's rarity — Hercules' Might is listed uncommon — and every rung after that raises
  // `cosmetics_owned.rarity_override` instead of minting a second item. Reading `item.rarity` here
  // meant a 250,000 lb Mythic unlock announced itself with an uncommon chip, an uncommon aura and
  // the uncommon sting: the reveal celebrating the top of a five-rung ladder exactly as loudly as
  // its first. `ladderRarity` resolves it from the rung the server just reported, which is what the
  // shelf and the Trophy Hall already do.
  //
  // The catalog is still the fallback, and it can miss entirely: a relic granted by a server that
  // knows a key this build does not (the exact shape the box-open error boundary exists for).
  // Falling back rather than bailing keeps the reveal — someone who earned a relic should see
  // SOMETHING happen, and the name comes off the server row either way.
  const rarity: Rarity =
    ladderRarity(relic.out_relic_key, relic.out_rung ?? 0) ?? item?.rarity ?? 'legendary';
  const tint = RARITY_COLOR[rarity];

  // 🐛 THE PILL READ AS A DASH ON DEVICE, and it was this screen's doing: `walletEmbers: null`
  // is what the hook is told when a wallet read is still in flight, and passing a literal null
  // meant the read never STARTED. The dash then sat there for the whole reveal, on the one screen
  // in the app whose entire job is to say what you now have.
  //
  // Nothing is claimed here, so the balance never moves — but the pill is in the top bar of every
  // reveal, and a bar showing a real number on four of them and a dash on the fifth is the fifth
  // one looking broken. Same read the other four run (task #161), and the same refusal to guess
  // while it is in flight: withheld, drawn as a skeleton by ClaimBalancePill, then the number.
  const { embers: walletEmbers, loading: walletLoading } = useInventory();

  // NO BOX, NO EMBERS, NO XP — so `kinds` is empty, nothing is claimable, and `ctaLabel` resolves to
  // "Done". The hook is still what drives the frame's top bar, its build-in and its dismiss, which
  // is why it is constructed at all.
  const claim = useRewardClaim({
    boxKey: null,
    boxName: null,
    embers: 0,
    walletEmbers: walletLoading ? null : walletEmbers,
    onDone: onClose,
  });

  // THE RARITY LADDER (#85), not one fixed fanfare. A Legendary Scroll and a Mythic Crown of
  // Olympus landing on the same sting would flatten the one distinction the reveal is built around,
  // and the six escalating cues already exist for exactly this. Fires once per mount, respects the
  // reward-SFX setting inside fireReveal, and carries the per-tier haptic with it.
  useRevealSting(rarity, false);

  const line = relicEarnedLine(relic);
  // The relic's own sentence, off the catalog row that already carries one for all fourteen keys.
  // Null only for a key this build has never heard of — the same case the art falls back for, and
  // a reveal with a name and a threshold and no lore is still a reveal.
  const lore = item?.lore ?? null;

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
          {/* THE RELIC ITSELF, not a rarity gem. ItemArt draws per relic KEY since relic-art.tsx —
              a scroll for the Scroll, a winged sandal for the Sandals — so the hero of this screen
              is the object the lore under it is about, and it is the same drawing the Trophy Hall
              shelf has been filling a bar toward. The ◆ is now only ever a key granted by a server
              running ahead of this build. */}
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
      {/* ⚠️ EVERY LINE BELOW RENDERED AS NOTHING UNTIL THE FRAME'S STEP-ONE GATE WAS FIXED.
          `rows={[]}` makes `showRewards` start true, and the frame read that alone to decide step
          one was over — so the whole column was skipped and the reveal shipped as an icon between
          two buttons. The gate now also asks whether there IS a step two. Nothing here is written
          to work around it; the fix is in reward-reveal-frame.tsx, where the bug was. */}
      <RevealHeadline
        // The capstone gets its own word. Crown of Olympus is every ladder maxed — the rarest event
        // in the app — and calling it "RELIC UNLOCKED" like the 10h Scroll would be the reveal
        // failing to notice what just happened. A Mythic rung short of the crown — Ω Hercules,
        // δ Movement — gets the middle register rather than the flat one, for the same reason.
        //
        // 0179 · A RANK-UP CANNOT SAY "UNLOCKED". The relic has been on the shelf since rung α, and
        // the whole event is that it moved. The rarity escalation is kept underneath rather than
        // replaced: climbing to a Mythic rung is the loudest thing that happens in this app short
        // of the Crown, and flattening it to the same words as a β would lose exactly the
        // distinction the ladder exists to draw.
        eyebrow={
          relic.out_is_capstone
            ? 'THE CROWN IS YOURS'
            : rankUp
              ? rarity === 'mythic'
                ? 'MYTHIC RUNG'
                : 'RELIC RANKED UP'
              : rarity === 'mythic'
                ? 'MYTHIC RELIC'
                : 'RELIC UNLOCKED'
        }
        eyebrowColor={tint}
        headline={relic.out_name}
        // "Study · 10 hours · β" — the discipline, what it cost, and which rung, in that order.
        subline={line}
      />
      {/* "DISCIPLINE RELIC" WAS SAID OF ALL FOURTEEN, and it is only true of five. The seven §4a
          ancient relics ride no ladder and belong to no discipline — Athena's Aegis is not a Gym
          relic — and the Crown is the thing you get for maxing all of them, which is the opposite
          of one discipline. `isLadderRelic` is the same test the shelf uses to decide whether to
          draw a rung glyph at all. */}
      <View style={[styles.chip, { borderColor: tint }]}>
        <Text style={[styles.chipText, { color: tint }]}>
          {RARITY_LABEL[rarity].toUpperCase()} ·{' '}
          {relic.out_is_capstone
            ? 'CAPSTONE RELIC'
            : isLadderRelic(relic.out_relic_key)
              ? 'DISCIPLINE RELIC'
              : 'ANCIENT RELIC'}
        </Text>
      </View>
      {/* The relic's one line of lore — the only copy on this screen written about the OBJECT
          rather than about the metric. The same sentence the share card prints under the name, off
          the same catalog row, so the two can never come to say different things. */}
      {lore ? <Text style={styles.lore}>{lore}</Text> : null}
      {/* 🔴 WHAT DID I ACTUALLY GET. Stated rather than implied, because "the relic IS the reward"
          is obvious to whoever built the economy and to nobody else — and this is the one reveal in
          the app with no reward rows to answer it. economy_grant_relic pays no embers, mints no
          crate and moves no XP (0176, and 0090/0120 before it): it inserts one showcase row. So the
          line names the relic as the payout and says where it went, rather than leaving an empty
          screen to be read as a payout that failed. A relic never appears in the inventory grid
          with the flame skins — it lives on the Trophy Hall shelf — and someone tapping Done and
          then looking in the wrong room is the complaint the 0176 deep link fixes on the push
          side. */}
      {/* 0179 · AND FOR A RANK-UP IT SAYS WHAT MOVED. "Added to your Trophy Hall" is false on a
          rung 2+ — the relic has been there since rung α — and a reveal whose one factual line is
          wrong is worse than one with no line at all. The rung is what changed, so the rung is what
          this states, in the ladder's own notation (β, not "tier 2") because that is what the shelf
          tile, the Trophy Hall bar and the subline directly above all print. `out_prev_rung` is not
          drawn: "α → β" needs the reader to hold both glyphs to find the news, and the news is the
          second one. */}
      <View style={styles.reward}>
        <Text style={styles.rewardLabel}>{rankUp ? 'RANK' : 'REWARD'}</Text>
        <Text style={styles.rewardText}>
          <Text style={[styles.rewardItem, { color: tint }]}>{relic.out_name}</Text>
          {rankUp
            ? rungGlyph(relic.out_rung ?? 0)
              ? ` — now rung ${rungGlyph(relic.out_rung ?? 0)}, on your Trophy Hall`
              : ' — ranked up, on your Trophy Hall'
            : ' — added to your Trophy Hall'}
        </Text>
      </View>
    </RewardRevealFrame>
  );
}

/**
 * What was actually done to earn it — "Study · 10 hours · β", "Movement · 50 km · α".
 *
 * DISCIPLINE FIRST, THEN THE COST, THEN THE RUNG. It used to read "10 hours of Study · rung β",
 * which buries the only word that says WHICH ladder just moved behind a number that means nothing
 * until you know. Someone who has five bars filling wants to know which one paid out before they
 * want to know what it cost. The rung glyph loses the word "rung" with it: α…Ω is the ladder's own
 * notation, it is printed bare on every shelf tile and in the Trophy Hall, and spelling it out here
 * and nowhere else made the reveal the odd one out.
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
        ? ` · ${RUNG_GLYPH[relic.out_rung - 1]}`
        : '';
    // "10 h" reads worse than "10 hours", and only the hours ladder has that problem — 'lb' and
    // 'km' are already how anyone would say them out loud.
    const unit = ladder.unit === 'h' ? 'hours' : ladder.unit;
    return `${ladder.short} · ${amount} ${unit}${rung}`;
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
  lore: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    lineHeight: 18,
    color: Colors.muted,
    textAlign: 'center',
    fontStyle: 'italic',
    marginTop: Spacing.two,
    // Held off the screen edges so a two-line lore breaks near the middle rather than one word
    // short of the bezel — the frame's own padding is sized for a headline, not for a sentence.
    paddingHorizontal: Spacing.two,
  },
  reward: {
    alignSelf: 'stretch',
    alignItems: 'center',
    gap: 3,
    marginTop: Spacing.three,
    paddingTop: Spacing.two,
    // A hairline rather than a card: this is the last line of the column, and boxing it would put
    // it in competition with the rarity chip above for the same "here is the important part" read.
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,246,236,0.12)',
  },
  rewardLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9.5,
    letterSpacing: 1.4,
    color: Colors.textTertiary,
  },
  rewardText: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    lineHeight: 18,
    color: Colors.muted,
    textAlign: 'center',
  },
  rewardItem: {
    fontFamily: Fonts.bodyBold,
  },
});
