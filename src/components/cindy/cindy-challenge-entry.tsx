import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { EquippedFlameSvg } from '@/components/flame-icon';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { track } from '@/lib/analytics';

// CINDY ON THE PRE-CHALLENGE SCREEN — mock 143's second path, "Ask Cindy".
//
// Mock 143 draws the create screen as TWO doors onto the same thing: "Build it yourself" (quick
// presets — the form this sits above) and "Ask Cindy" (for exactly what you want: "70% in KP451",
// "first to learn a backflip", anything the pills cannot express). The form was the only door.
//
// OPT-IN AND NON-BLOCKING, which is the whole design of it. This is a row above the form, not a
// step in front of it: the pills, the opponent picker and the Send button are all exactly where
// they were and work without ever touching this. Somebody who knows they want a 72-hour lock-in
// duel should never have to talk to anybody to get one.
//
// WIRED TO THE REAL COACH, not a mock of one. Tapping routes to /cindy — the same chat screen the
// header flame opens, the same sendToCindy, the same history — with the composer PREFILLED via
// ?ask=. That prefill-don't-send contract is the lock-in quick sheet's, adopted here for the same
// reason it gives: arriving in a chat that has already spoken on your behalf is disorienting, and
// a filled box is still one tap to send and editable if the canned phrasing is not quite it.
//
// /cindy shows the consent gate before any chat, so this is a valid entry point pre-consent too
// and deliberately does not check `consented` itself — the same call CindyHeaderFlame makes, and
// for the same reason: gating both entry points on consent once left no way to REACH consent.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// WHAT THIS DELIBERATELY DOES NOT CLAIM.
//
// Mock 140 goes further than this: Cindy parses the sentence into a structured challenge, the
// server prices it from difficulty + ambition + verifiability, and she shows the box and the ember
// figure before you confirm. None of that pipeline exists — there is no challenge-authoring tool
// on the coach, and grant_reward has no "price this hypothetical" mode. So the copy here says she
// will help you work it out, and stops short of promising she will build it and hand it back.
// Claiming the mock-140 flow before it is built would be a worse outcome than not offering it.
export function CindyChallengeEntry({
  seed,
  body,
}: {
  seed: string;
  /** Override for the one line of copy. The default speaks about the SOCIAL form's pills; the
   * personal-goal form sits above a different set of controls and has a different offer to make
   * (scope what you just built, rather than say what the pills cannot), so it passes its own. */
  body?: string;
}) {
  const router = useRouter();

  return (
    <Pressable
      style={styles.card}
      onPress={() => {
        track('cindy_challenge_entry_opened');
        router.push({ pathname: '/cindy', params: { ask: seed } });
      }}
      accessibilityRole="button"
      accessibilityLabel="Ask Cindy to help design this challenge">
      <View style={styles.flame}>
        <EquippedFlameSvg width={17} height={21} />
      </View>
      <View style={styles.copy}>
        <Text style={styles.eyebrow}>CUSTOM</Text>
        <Text style={styles.title}>Ask Cindy</Text>
        <Text style={styles.body}>
          {body ??
            'Something the pills below can’t say — a grade in one course, an odd metric, a target only you two would get. Describe it and she’ll help you shape it.'}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />
    </Pressable>
  );
}

/**
 * The sentence the composer opens with, tuned to whatever the form is already showing.
 *
 * Seeded from the live form rather than being one fixed string: somebody who has already picked
 * Duel and an opponent has told us half of what they want, and making them retype it would be the
 * screen forgetting what it can plainly see. Mock 140's own example opens exactly this way — "I
 * want a 70% in Physiology this semester" — a plain sentence, not a filled-in form read aloud.
 */
export function cindyChallengeSeed(input: {
  shape: 'duel' | 'collective' | 'placement';
  opponentName?: string | null;
  circleName?: string | null;
  /**
   * Whether this person can actually host FOR that campfire — owner or admin of it.
   *
   * 🔒 Gates the wording, not the permission. See below.
   */
  canHostForCampfire?: boolean;
}): string {
  if (input.shape === 'duel') {
    return input.opponentName
      ? `Help me set up a challenge against ${input.opponentName}. I want `
      : 'Help me set up a challenge against a friend. I want ';
  }
  const where = input.circleName ? ` in ${input.circleName}` : '';

  // 🔒 "FOR {campfire}" IS THE PHRASE THAT ROUTES HER, so an admin gets it and nobody else does.
  //
  // The coach's tool description is explicit that naming a campfire is what selects
  // host_campfire_challenge over create_challenge — "use this instead of create_challenge whenever
  // they name a campfire; create_challenge makes a private goal only they can see". Hosting posts
  // a card into that campfire's chat and pushes every member, and it is admin-only.
  //
  // So the seed says "for Goat" only when this person can carry it through. A non-admin gets the
  // plain group-challenge sentence, which lands them on the ordinary personal-goal path rather
  // than walking them into a refusal at the end of a conversation.
  //
  // The server does not depend on any of this. create_group_challenge and host_campfire_challenge
  // both re-read the caller's role from group_members at write time (0162) and refuse whatever the
  // sentence claimed — this only decides which flow somebody is INVITED into.
  if (input.shape === 'collective' && input.canHostForCampfire && input.circleName) {
    return `Set a challenge for ${input.circleName} — everyone in the campfire. I want `;
  }
  return input.shape === 'placement'
    ? `Help me set up a ranked race${where}. I want `
    : `Help me set up a group challenge${where}. I want `;
}

/**
 * The same door, for a PERSONAL goal — the form that makes "10,000 steps daily".
 *
 * 🐛 THIS FORM HAD NO DOOR AT ALL. CindyChallengeEntry was rendered on the social-challenge form
 * only, so the entire Ask-Cindy path existed for duels, group challenges and placement races and
 * not for the one shape most people actually create. "Cindy can't scope my step goal" was exactly
 * that: not a scoping failure, an ABSENT ENTRY POINT. The coach has always been able to scope a
 * steps goal — the difficulty grid in her prompt names "10k steps in a day" as its own worked
 * example — there was simply nothing on this screen that would hand her one.
 *
 * ── WHY THIS SEED IS A FINISHED SENTENCE AND THE SOCIAL ONES ARE NOT ──
 *
 * The three above end on a dangling "I want " because a duel knows its opponent and nothing else;
 * the user still has to say what the challenge IS. This form is the opposite — by the time this
 * row is worth tapping, the metric, the number and the cadence are all on screen, so the sentence
 * can be complete and the user can simply send it. That is the difference between "ask Cindy to
 * help you write a goal" and "ask Cindy to price the goal you just built", and only the second one
 * is what somebody staring at a filled-in form wants.
 *
 * Still PREFILL, NEVER SEND — the same contract the lock-in quick sheet set and the social seeds
 * keep. A complete sentence is one tap from sent and still fully editable, which is the point: the
 * cost of getting it slightly wrong is a backspace, not a conversation that has already spoken.
 */
export function cindyPersonalGoalSeed(input: {
  /** The metric's own word — 'Steps', 'Sleep', or the custom goal's name once it has one. */
  metricLabel: string | null;
  /** Raw form text, so a half-typed or empty target is a real possibility and reads as one. */
  target: string;
  unit: string;
  period: 'day' | 'week' | 'once';
}): string {
  const what = input.metricLabel?.trim();
  const target = input.target.trim();
  const unit = input.unit.trim();
  // Nothing concrete to price yet — an unnamed custom goal, or a target the user has not typed.
  // Falls back to the open-ended phrasing rather than sending her a sentence with a hole in it.
  if (!what || !target || !unit) return 'Help me set up a goal and scope it. I want ';

  const cadence = input.period === 'day' ? ' every day' : input.period === 'week' ? ' every week' : '';
  // "10,000" rather than "10000" — this is read aloud in a chat bubble, not parsed.
  const pretty = Number(target);
  const figure = Number.isFinite(pretty) ? pretty.toLocaleString() : target;
  return `I want to hit ${figure} ${unit}${cadence}. Can you scope this goal for me?`;
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.card,
    backgroundColor: Colors.selectedBg,
    borderWidth: 1,
    // The same warm hairline CindyBubble uses, so she reads as the same voice wherever she is.
    borderColor: 'rgba(242,163,60,0.35)',
    marginBottom: Spacing.four,
  },
  flame: {
    width: 30,
    height: 30,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.achieverBg,
  },
  copy: {
    flex: 1,
    gap: 2,
  },
  eyebrow: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9.5,
    letterSpacing: 0.8,
    color: Colors.amber,
  },
  title: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.ink,
  },
  body: {
    fontFamily: Fonts.body,
    fontSize: 12,
    lineHeight: 17,
    color: Colors.muted,
  },
});
