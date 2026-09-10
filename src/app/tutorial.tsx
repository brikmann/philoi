import { Stack, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TapHint } from '@/components/tutorial/mini-ui';
import { tutorialCards, type TutorialCard } from '@/components/tutorial/tutorial-cards';
import { PrimaryButton } from '@/components/ui/primary-button';
import { ScreenBackground } from '@/components/ui/screen-background';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { track } from '@/lib/analytics';
import { useAuth } from '@/lib/auth/auth-context';
import { noteTourClosed } from '@/lib/coach-marks';
import { markTutorialDone } from '@/lib/tutorial';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// THE FIRST-RUN TUTORIAL — design-mocks/187, CODE_PROMPT_tutorial.md. 🔴 LAUNCH GATE.
//
// The app is not shippable to the App Store without this. See tutorial-cards.tsx for the tour
// itself and why it is shaped the way it is; this file is the frame around it.
//
// ─────────────────────────── THREE DECISIONS WORTH STATING ───────────────────────────
//
// 1. 🔴 IT IS SKIPPABLE. Always, from the first card, in the top-right. A tour you cannot leave is
//    a tour people resent, and the person most likely to want out — someone who already knows the
//    app, reinstalling — is exactly the person a forced tour insults. It is NUDGED instead: Skip
//    asks once, and the ask names what they would miss rather than guilting them.
//
// 2. 🔴 COMPLETION IS TRACKED WHETHER THEY FINISH OR SKIP. Both land in `markTutorialDone`, and
//    that is deliberate — the flag means "this device has been offered the tour", not "this user
//    watched all twenty cards". A flag that only set on completion would re-launch the whole tour
//    on the next cold start for everyone who skipped, which is the single most annoying thing a
//    first-run experience can do. Analytics carries the difference (`completed` vs `skipped_at`)
//    so the funnel is still legible.
//
// 3. THE RAIL IS THE PROGRESS UI, and it is tappable. Jumping around a tutorial is not cheating —
//    someone who wants to know about the Forge should be able to get to the Forge — and letting
//    them means the rail's "here is everything" promise is real rather than decorative.
//
// 🔒 IT TOUCHES NOTHING. No grant, no write, no network beyond the completion flag. Every preview
// is an inert miniature (see mini-ui.tsx), so a mis-tap during the tour cannot start a lock-in,
// spend an ember or send a duel.
// ══════════════════════════════════════════════════════════════════════════════════════════════

export default function TutorialScreen() {
  const router = useRouter();
  const { profile } = useAuth();

  const cards = useMemo(
    () => tutorialCards(profile?.display_name ?? null, profile?.handle ?? null),
    [profile?.display_name, profile?.handle]
  );

  const [index, setIndex] = useState(0);
  // The sub-step within the current card. Reset on every card change rather than remembered per
  // card: going Back and forward again should replay the little flow, which is the point of it.
  const [step, setStep] = useState(0);
  const [confirmSkip, setConfirmSkip] = useState(false);

  const card: TutorialCard = cards[index];
  const lastStep = card.steps.length - 1;
  const isLast = index === cards.length - 1;

  const finish = useCallback(
    (how: 'completed' | 'skipped') => {
      track('tutorial_finished', { how, card: card.key, card_index: index });
      // Starts the coach-marks' cooldown (CODE_PROMPT_coach_marks.md). The tour just walked through
      // all seven of the surfaces they annotate, and landing on Home straight out of it only to be
      // told what the Lock in button does is the app repeating itself. In-memory and one minute
      // long: it suppresses the immediate echo and nothing else, so a surface reached later in the
      // session — or in any session after this one — still gets its line.
      noteTourClosed();
      // Not awaited: the flag is a local write and the user should not watch a spinner to leave a
      // tutorial. If it somehow fails they see the tour once more, which is survivable.
      markTutorialDone().catch(() => {});
      router.replace('/');
    },
    [card.key, index, router]
  );

  const goTo = useCallback((i: number) => {
    setIndex(i);
    setStep(0);
  }, []);

  const onNext = useCallback(() => {
    if (card.buy) {
      // The Flame Pass card's primary sells; it does not advance. Marking the tour done first
      // means someone who buys and then backs out of the paywall is not dropped into card one.
      track('tutorial_pass_cta', { card_index: index });
      // Leaving via the Flame Pass CTA ends the tour just as much as Skip or the last card does.
      noteTourClosed();
      markTutorialDone().catch(() => {});
      router.replace('/forge-pass');
      return;
    }
    if (isLast) {
      finish('completed');
      return;
    }
    track('tutorial_card_advanced', { card: card.key, card_index: index });
    goTo(index + 1);
  }, [card.buy, card.key, finish, goTo, index, isLast, router]);

  const onPreviewTap = useCallback(() => {
    if (step < lastStep) setStep((s) => s + 1);
  }, [lastStep, step]);

  const cindyLine = card.cindy[Math.min(step, card.cindy.length - 1)];
  const playable = step < lastStep;

  return (
    <>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      <ScreenBackground>
        <SafeAreaView style={styles.safe}>
          {/* ── Skip, always available ── */}
          <View style={styles.top}>
            <Text style={styles.counter}>
              {index + 1} / {cards.length}
            </Text>
            <Pressable
              onPress={() => setConfirmSkip(true)}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Skip the tutorial">
              <Text style={styles.skip}>Skip</Text>
            </Pressable>
          </View>

          <View style={styles.main}>
            {/* ── THE RAIL: every section at once, grouped into four acts ── */}
            <ScrollView
              style={styles.rail}
              contentContainerStyle={styles.railContent}
              showsVerticalScrollIndicator={false}>
              {cards.map((c, i) => (
                <View key={c.key}>
                  {c.section ? <Text style={styles.railSection}>{c.section.toUpperCase()}</Text> : null}
                  <Pressable
                    onPress={() => goTo(i)}
                    accessibilityRole="button"
                    accessibilityLabel={c.title}
                    style={[styles.railItem, i === index && styles.railItemOn]}>
                    <View
                      style={[
                        styles.railDot,
                        i < index && styles.railDotDone,
                        i === index && styles.railDotOn,
                      ]}
                    />
                    <Text
                      style={[
                        styles.railText,
                        i < index && styles.railTextDone,
                        i === index && styles.railTextOn,
                      ]}
                      numberOfLines={2}>
                      {c.title}
                    </Text>
                  </Pressable>
                </View>
              ))}
            </ScrollView>

            {/* ── THE STAGE: a real, tappable miniature of the screen being explained ── */}
            <Pressable
              style={styles.stage}
              onPress={onPreviewTap}
              disabled={!playable}
              accessibilityRole={playable ? 'button' : undefined}
              accessibilityLabel={playable ? 'Continue this demo' : undefined}>
              {card.steps[Math.min(step, lastStep)]}
              {playable ? <TapHint /> : null}
            </Pressable>
          </View>

          {/* ── CINDY: one warm line per beat ── */}
          <View style={styles.guide}>
            <View style={styles.cindyAvatar}>
              <Text style={styles.cindyFlame}>🔥</Text>
            </View>
            <Text style={styles.bubble}>{cindyLine}</Text>
          </View>

          <View style={styles.footer}>
            <View style={styles.footerRow}>
              <Pressable
                onPress={() => (index > 0 ? goTo(index - 1) : undefined)}
                disabled={index === 0}
                accessibilityRole="button"
                style={[styles.back, index === 0 && styles.backDisabled]}>
                <Text style={styles.backText}>Back</Text>
              </Pressable>
              <View style={styles.grow}>
                <PrimaryButton label={card.next ?? 'Next'} onPress={onNext} />
              </View>
            </View>
            {card.secondary ? (
              <Pressable onPress={() => (isLast ? finish('completed') : goTo(index + 1))} accessibilityRole="button">
                <Text style={styles.secondary}>{card.secondary}</Text>
              </Pressable>
            ) : null}
          </View>

          {/* ── The nudge. Asked once, and it names what they'd miss rather than guilting. ── */}
          {confirmSkip ? (
            <View style={styles.scrim}>
              <View style={styles.sheet}>
                <Text style={styles.sheetTitle}>Skip the tour?</Text>
                <Text style={styles.sheetBody}>
                  It&apos;s about two minutes and it covers the whole app — challenges, campfires, crates and
                  the settings worth turning on. You can always replay it from Settings.
                </Text>
                <PrimaryButton label="Keep going" onPress={() => setConfirmSkip(false)} />
                <Pressable onPress={() => finish('skipped')} accessibilityRole="button">
                  <Text style={styles.secondary}>Skip anyway</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </SafeAreaView>
      </ScreenBackground>
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
  },
  counter: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textTertiary },
  skip: { fontFamily: Fonts.bodyBold, fontSize: 14, color: Colors.muted },
  main: { flex: 1, flexDirection: 'row', gap: Spacing.two, paddingHorizontal: Spacing.three, paddingTop: Spacing.two, minHeight: 0 },
  rail: { width: 128, flexGrow: 0, flexShrink: 0 },
  railContent: { paddingBottom: Spacing.three },
  railSection: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9,
    letterSpacing: 1.2,
    color: Colors.textTertiary,
    marginTop: Spacing.two,
    marginBottom: 2,
    paddingLeft: 6,
  },
  railItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 5,
    paddingLeft: 6,
    borderLeftWidth: 2,
    borderLeftColor: 'transparent',
  },
  railItemOn: { borderLeftColor: Colors.amber },
  railDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#3a2c58' },
  railDotDone: { backgroundColor: '#5a5075' },
  railDotOn: { backgroundColor: Colors.amber },
  railText: { flex: 1, fontFamily: Fonts.bodyBold, fontSize: 12, color: '#6a6180', lineHeight: 15 },
  railTextDone: { color: Colors.muted },
  railTextOn: { color: Colors.amber },
  stage: { flex: 1, minWidth: 0 },
  guide: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
  },
  cindyAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#241a38',
    borderWidth: 1,
    borderColor: Colors.amber,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cindyFlame: { fontSize: 17 },
  bubble: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 13,
    lineHeight: 18.5,
    color: Colors.ink,
    backgroundColor: '#241a38',
    borderRadius: Radius.card,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  footer: { paddingHorizontal: Spacing.three, paddingTop: Spacing.three, paddingBottom: Spacing.two, gap: Spacing.two },
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  grow: { flex: 1 },
  back: {
    paddingHorizontal: Spacing.three,
    paddingVertical: 13,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.lineStrong,
  },
  backDisabled: { opacity: 0.35 },
  backText: { fontFamily: Fonts.bodyBold, fontSize: 14, color: Colors.muted },
  secondary: {
    fontFamily: Fonts.body,
    fontSize: 13.5,
    color: Colors.muted,
    textAlign: 'center',
    paddingVertical: Spacing.two,
  },
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#000000bb',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  sheet: {
    width: '100%',
    backgroundColor: Colors.card,
    borderRadius: Radius.card,
    padding: Spacing.four,
    gap: Spacing.two,
  },
  sheetTitle: { fontFamily: Fonts.display, fontSize: 19, color: Colors.ink },
  sheetBody: {
    fontFamily: Fonts.body,
    fontSize: 13.5,
    lineHeight: 19,
    color: Colors.muted,
    marginBottom: Spacing.one,
  },
});
