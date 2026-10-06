import { useRouter } from 'expo-router';
import { useId, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';

import { FallingEmbers } from '@/components/pass/emberfall-art';
import { ShineSweep } from '@/components/pass/pass-motion';
import { Colors, Fonts } from '@/constants/theme';
import { useSeason, type SeasonState } from '@/hooks/use-season';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// THE EMBERFALL SPLASH (mock 259) — the season banner pinned atop the Leaderboard.
//
// Every date and number on it comes from useSeason(), i.e. the live economy_config.season row, so a
// retuned window reaches installed builds without a release. It renders nothing once season_phase()
// would say 'closed', and switches to a claim-window variant for the week after the track freezes.
//
// ── THE END DATE IS THE LAST DAY, NOT ends_at ──
// ends_at is Eastern MIDNIGHT opening Dec 23 (0187) — the instant the season stops, not a day of it.
// Printing it as a date says "Dec 23" for a season whose last playable day is Dec 22, which is also
// what the tutorial tells people. So the range prints the day of ends_at − 1ms.
//
// ── HOW THE FIELD IS DRAWN ──
// Measure-then-paint, as EmberFill does: an absolutely-positioned <Svg> sized by style alone
// measures zero on Android (season-chip.tsx). Until the first layout lands, the solid mid-ember
// background shows, so the banner is never a hole for a frame.
// ══════════════════════════════════════════════════════════════════════════════════════════════

const DAY_MS = 86_400_000;

// Mock 259's field: a 115° burn from charcoal-ember to lit orange, with a gold bloom top-right.
const FIELD = ['#3a1402', '#7a2a08', '#b8541a'] as const;
const BLOOM = '#F5C542';

// The motion is the Flame Pass banner's (mock 224), reused rather than re-drawn: embers falling
// through the field and a soft light pass across it. Both come from the pass's own primitives, so
// they share its reduce-motion / app-backgrounded gating (usePassMotion) — a Reduce Motion user
// gets the still field, and nothing animates while the app is off-screen.

function shortDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

/** "82 days left" / "Last day" — whole days, rounded up, so the pill never says 0 while it's live. */
function daysPhrase(ms: number, unit: 'left' | 'to claim' | 'opens'): string {
  const days = Math.ceil(ms / DAY_MS);
  if (unit === 'opens') return days <= 1 ? 'Opens tomorrow' : `Opens in ${days} days`;
  if (days <= 1) return unit === 'left' ? 'Last day' : 'Last day to claim';
  return `${days} days ${unit}`;
}

const WORDMARK_SIZE = 28;
// Inter Black caps with the 0.5 tracking run ~0.78em per glyph — measured off "EMBERFALL", and a
// touch generous so the estimate errs toward fitting rather than clipping.
const WORDMARK_EM_PER_CHAR = 0.78;
const INNER_PADDING_X = 32; // styles.inner paddingHorizontal × 2

/** Full size unless the name would overrun the banner; never below 60%. Before layout: full size. */
function wordmarkSize(name: string, bannerWidth: number): { fontSize: number; lineHeight: number } {
  const room = bannerWidth - INNER_PADDING_X;
  const fit = room > 0 ? room / (Math.max(name.length, 1) * WORDMARK_EM_PER_CHAR) : WORDMARK_SIZE;
  const fontSize = Math.max(WORDMARK_SIZE * 0.6, Math.min(WORDMARK_SIZE, fit));
  return { fontSize, lineHeight: Math.round(fontSize * 1.15) };
}

type Copy = {
  kicker: string;
  pill: string;
  tagline: string;
  tappable: boolean;
};

function copyFor(s: SeasonState): Copy | null {
  const n = s.id.replace(/\D/g, '') || s.id;
  switch (s.phase) {
    case 'live':
      return {
        kicker: `◆ Season ${n} · Live`,
        pill: s.endsAt !== null ? `🔥 ${daysPhrase(s.endsAt - s.now, 'left')}` : '🔥 Live now',
        tagline: 'Climb before the embers fade — top finishers are stamped forever.',
        tappable: false,
      };
    case 'claim-window':
      return {
        kicker: `◆ Season ${n} · Claim window`,
        pill: `⏳ ${daysPhrase(s.endsAt! + s.claimWindowDays * DAY_MS - s.now, 'to claim')}`,
        tagline: 'The climb is over — claim what you earned before the window shuts.',
        tappable: true,
      };
    case 'upcoming':
      return {
        kicker: `◆ Season ${n} · Soon`,
        pill: `🔥 ${daysPhrase(s.startsAt! - s.now, 'opens')}`,
        tagline: 'The embers are about to fall — be on the board when they do.',
        tappable: false,
      };
    case 'closed':
      return null;
  }
}

export function EmberfallSplash() {
  const router = useRouter();
  const season = useSeason();
  const ids = useId();
  const [size, setSize] = useState({ w: 0, h: 0 });

  const copy = copyFor(season);
  if (!copy) return null;

  const range =
    season.startsAt !== null && season.endsAt !== null
      ? `${shortDate(season.startsAt)} – ${shortDate(season.endsAt - 1)}`
      : null;

  const onLayout = (e: LayoutChangeEvent) => {
    const { width: w, height: h } = e.nativeEvent.layout;
    // A 0 pass (a remount mid-transition) must not wipe a good measurement.
    if (w > 0 && h > 0) setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
  };
  // Gradient ids are global in react-native-svg — a shared literal blanks every instance after the
  // first on Android.
  const fieldId = `emberfall-field-${ids}`;
  const bloomId = `emberfall-bloom-${ids}`;

  const body = (
    <View style={styles.clip} onLayout={onLayout}>
      {size.w > 0 && (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <Svg width={size.w} height={size.h}>
            <Defs>
              {/* ~115°: mostly left→right with a downward lean. */}
              <LinearGradient id={fieldId} x1="0" y1="0.2" x2="1" y2="0.8">
                <Stop offset="0" stopColor={FIELD[0]} />
                <Stop offset="0.45" stopColor={FIELD[1]} />
                <Stop offset="1" stopColor={FIELD[2]} />
              </LinearGradient>
              <RadialGradient id={bloomId} cx="85%" cy="-10%" rx="70%" ry="120%" fx="85%" fy="-10%">
                <Stop offset="0" stopColor={BLOOM} stopOpacity={0.55} />
                <Stop offset="0.6" stopColor={BLOOM} stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Rect x="0" y="0" width={size.w} height={size.h} fill={`url(#${fieldId})`} />
            <Rect x="0" y="0" width={size.w} height={size.h} fill={`url(#${bloomId})`} />
          </Svg>
        </View>
      )}
      {size.h > 0 ? <FallingEmbers count={6} fall={size.h + 20} /> : null}
      <ShineSweep period={4200} opacity={0.22} />
      {/* The faint inner gold hairline — drawn over the field, inside the clip, so it follows the
          radius exactly. */}
      <View style={styles.hairline} pointerEvents="none" />

      <View style={styles.inner}>
        <Text style={styles.kicker}>{copy.kicker}</Text>
        {/* Sized here, NOT by adjustsFontSizeToFit. On iOS that prop shrank this line to a sliver
            ("ridiculously small") — it fits against the fixed lineHeight as well as the width, and
            re-keying on width didn't save it. The wordmark only ever needs to shrink for a long
            season name, and that is arithmetic on the measured width. */}
        <Text style={[styles.wordmark, wordmarkSize(season.name, size.w)]} numberOfLines={1}>
          {season.name.toUpperCase()}
        </Text>
        <View style={styles.row}>
          {range ? <Text style={styles.dates}>{range}</Text> : <View />}
          <View style={styles.pill}>
            <Text style={styles.pillText}>{copy.pill}</Text>
          </View>
        </View>
        <Text style={styles.tagline}>{copy.tagline}</Text>
      </View>
    </View>
  );

  const label = `${season.name} season. ${copy.kicker.replace('◆ ', '')}. ${range ?? ''}. ${copy.pill.replace(/^\S+ /, '')}.`;

  // The shadow lives on an UNCLIPPED wrapper: iOS drops a shadow on a view with overflow hidden.
  return copy.tappable ? (
    <Pressable
      style={styles.shadow}
      onPress={() => router.push('/forge-pass')}
      accessibilityRole="button"
      accessibilityLabel={`${label} Open the pass to claim.`}>
      {body}
    </Pressable>
  ) : (
    <View style={styles.shadow} accessible accessibilityLabel={label}>
      {body}
    </View>
  );
}

const RADIUS = 18;

const styles = StyleSheet.create({
  shadow: {
    borderRadius: RADIUS,
    // Android's elevation shadow needs an opaque background to cast from.
    backgroundColor: FIELD[1],
    shadowColor: Colors.coral,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 15,
    elevation: 6,
  },
  clip: {
    borderRadius: RADIUS,
    overflow: 'hidden',
    backgroundColor: FIELD[1],
  },
  hairline: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: 'rgba(245,197,66,0.25)',
  },
  inner: {
    paddingTop: 13,
    paddingBottom: 12,
    paddingHorizontal: 16,
  },
  kicker: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
    letterSpacing: 3,
    color: '#FFE7A0',
    textTransform: 'uppercase',
  },
  wordmark: {
    fontFamily: Fonts.black,
    fontSize: 28,
    lineHeight: 32,
    letterSpacing: 0.5,
    color: '#FFFFFF',
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 14,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  dates: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: '#ffe3c4',
  },
  pill: {
    backgroundColor: 'rgba(0,0,0,0.28)',
    borderWidth: 1,
    borderColor: 'rgba(255,227,160,0.35)',
    borderRadius: 999,
    paddingVertical: 3,
    paddingHorizontal: 10,
  },
  pillText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11.5,
    color: '#FFE7A0',
  },
  tagline: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: '#ffd9b8',
    marginTop: 7,
    opacity: 0.95,
  },
});
