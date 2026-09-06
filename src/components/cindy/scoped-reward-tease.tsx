import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { BoxArt } from '@/components/economy/box-art';
import { EmberIcon } from '@/components/economy/ember-icon';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { previewScopedReward } from '@/lib/api/challenges';
import { BOX_KEYS, BOXES, type BoxKey } from '@/lib/economy/boxes';
import type { DifficultyTier, ScopedRewardPreview } from '@/types/database';

// §3 — the honest tease: what the server says this is worth, BEFORE you commit to it.
//
// 🔒 WHY THE NUMBERS COME OVER THE WIRE FOR A LINE THIS SMALL. Cindy scopes the feat and is
// forbidden from stating what it pays (see SCOPING_RULES in the coach prompt) — she proposes a
// tier, the server prices it. If this component computed "epic → Vessel of Hestia + 90" from a
// local table it would be a second source of truth for the payout, and the first time
// economy_config is retuned the create screen would promise one thing and the reveal would deliver
// another. So it asks preview_challenge_reward, which reads the same config grant_reward will read
// at completion. One round trip to never be wrong.
//
// The preview GRANTS NOTHING — it is a stable, read-only function. Showing it before the goal even
// exists is the whole point: the dopamine of "most people never land a backflip" belongs at the
// moment you decide to try, not four months later.

const TIER_LINE: Record<DifficultyTier, string> = {
  common: 'A daily habit.',
  uncommon: 'A solid push this week.',
  rare: 'A real training block.',
  epic: 'Most people never do this.',
  legendary: 'A genuine life feat.',
  mythic: 'Bragging rights for life.',
};

const TIER_COLOR: Record<DifficultyTier, string> = {
  common: Colors.muted,
  uncommon: Colors.green,
  rare: Colors.sky,
  epic: '#A06CD5',
  legendary: Colors.amber,
  mythic: Colors.coral,
};

function asBoxKey(key: string | null | undefined): BoxKey | null {
  return key != null && (BOX_KEYS as readonly string[]).includes(key) ? (key as BoxKey) : null;
}

export function ScopedRewardTease({ tier, rationale }: { tier: DifficultyTier; rationale?: string | null }) {
  const [preview, setPreview] = useState<ScopedRewardPreview | null>(null);

  useEffect(() => {
    let alive = true;
    // 'honor' is the right thing to ASK for here, not a guess: the server derives the real value
    // from the goal's metric at scope time, and a goal that has not been created yet has no metric
    // to derive from. Honor is the conservative half of that pair — so the tease can only
    // understate what an auto-tracked goal will actually pay, never overstate it.
    previewScopedReward(tier, 'honor').then((p) => {
      if (alive) setPreview(p);
    });
    return () => {
      alive = false;
    };
  }, [tier]);

  const boxKey = asBoxKey(preview?.box);

  return (
    <View style={styles.root}>
      <View style={styles.head}>
        <Text style={[styles.tier, { color: TIER_COLOR[tier] }]}>CINDY SCOPED THIS: {tier.toUpperCase()}</Text>
      </View>
      <Text style={styles.line}>{rationale?.trim() || TIER_LINE[tier]}</Text>

      {preview ? (
        <>
          <View style={styles.payoutRow}>
            {boxKey ? (
              <>
                <BoxArt boxKey={boxKey} size={26} />
                <Text style={styles.payoutText}>{BOXES[boxKey].name}</Text>
                <Text style={styles.plus}>+</Text>
              </>
            ) : null}
            <EmberIcon size={13} />
            <Text style={styles.payoutText}>{preview.embers.toLocaleString('en-US')}</Text>
          </View>

          {/* Said up front rather than discovered at the reveal. The discount is not a penalty for
              being honest — it is what lets the ceiling be high at all, and a user who knows a clip
              upgrades the box is a user who takes the clip. */}
          {preview.discounted ? (
            <Text style={styles.caveat}>
              Proof or a friend&apos;s vouch unlocks the full box — unverified pays one tier down.
            </Text>
          ) : (
            <Text style={styles.caveat}>Tracked automatically, so it pays the full tier.</Text>
          )}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: Colors.scrim,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: 'rgba(242,163,60,0.22)',
    paddingVertical: Spacing.twelve,
    paddingHorizontal: Spacing.three,
    gap: 5,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  tier: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10.5,
    letterSpacing: 1.2,
  },
  line: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    lineHeight: 18,
    color: Colors.ink,
  },
  payoutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 3,
  },
  payoutText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: Colors.ember,
  },
  plus: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.muted,
  },
  caveat: {
    fontFamily: Fonts.body,
    fontSize: 11,
    lineHeight: 16,
    color: Colors.textTertiary,
  },
});
