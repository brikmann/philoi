import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

import { Avatar } from '@/components/ui/avatar';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { CampusVerificationError, sendCampusCode, verifyCampusCode } from '@/lib/api/campus-verification';
import { useAuth } from '@/lib/auth/auth-context';
import { getErrorMessage } from '@/lib/errors';
import { formatHintFor } from '@/lib/universities';

const CODE_LENGTH = 6;

type CampusVerificationProps = {
  university: string;
  /** The school's email domain. The caller must not render this at all when it's null — a school
   * with no known domain can't be verified. */
  domain: string;
  /** Called once university_email_verified is true server-side. The caller is responsible for
   * refreshing the profile; this component doesn't own auth state. */
  onVerified: (email: string) => void;
  onSkip?: () => void;
  skipLabel?: string;
  /** "Verify & unlock My Uni" in onboarding (mock 76B) vs a plainer "Verify" in Settings. */
  verifyCtaLabel?: string;
};

// Email → code → done (design-mocks/75B/75C, 76B). Shared by onboarding and Settings so the two
// can't drift — the flow, the cooldown and the error wording are identical wherever it's reached.
export function CampusVerification({
  university,
  domain,
  onVerified,
  onSkip,
  skipLabel = 'Skip — verify later',
  verifyCtaLabel = 'Verify',
}: CampusVerificationProps) {
  const [stage, setStage] = useState<'email' | 'code'>('email');
  // Only the local part is typed — the domain is locked to the school (mock 75B), which is also
  // the one thing the server enforces.
  const [localPart, setLocalPart] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  const hint = formatHintFor(university);
  const email = `${localPart.trim().toLowerCase()}@${domain}`;
  const canSend = localPart.trim().length > 0 && !busy;
  const canVerify = code.length === CODE_LENGTH && !busy;

  // One interval for the resend countdown, cleaned up on unmount — a stray timer here would keep
  // ticking behind a dismissed sheet and re-enable the button on a screen nobody's looking at.
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (cooldown <= 0) return;
    cooldownRef.current = setInterval(() => setCooldown((s) => (s <= 1 ? 0 : s - 1)), 1000);
    return () => {
      if (cooldownRef.current) clearInterval(cooldownRef.current);
    };
  }, [cooldown > 0]); // eslint-disable-line react-hooks/exhaustive-deps -- restart the ticker on the 0↔n edge only, not every tick

  async function handleSend() {
    setBusy(true);
    setError(null);
    try {
      const result = await sendCampusCode(email);
      setSentTo(result.email);
      setCooldown(result.cooldownSeconds);
      setCode('');
      setStage('code');
    } catch (e) {
      if (e instanceof CampusVerificationError && e.reason === 'cooldown' && e.retryAfter) {
        // A code is already out there — move on to entry rather than stranding them on a button
        // that won't work for another 30 seconds.
        setSentTo(email);
        setCooldown(e.retryAfter);
        setStage('code');
      }
      setError(getErrorMessage(e, 'Could not send that code.'));
    } finally {
      setBusy(false);
    }
  }

  async function handleVerify() {
    setBusy(true);
    setError(null);
    try {
      await verifyCampusCode(sentTo, code);
      onVerified(sentTo);
    } catch (e) {
      setError(getErrorMessage(e, 'Could not check that code.'));
      // An expired or burnt-out code needs a fresh send, not another guess — clear the field so
      // the next tap is obviously "Resend" rather than a seventh attempt at the same digits.
      if (e instanceof CampusVerificationError && (e.reason === 'expired' || e.reason === 'too_many_attempts')) {
        setCode('');
        setCooldown(0);
      }
      // The code was RIGHT — the address is simply spoken for (migration 0136). Nothing about this
      // screen can free it, so go back to the email field: the only move left is a different
      // address, and leaving them on a code entry implies a retry that can never succeed. The
      // server's sentence survives the stage change, which is what tells them why they moved.
      if (e instanceof CampusVerificationError && e.reason === 'email_taken') {
        setCode('');
        setCooldown(0);
        setLocalPart('');
        setStage('email');
      }
    } finally {
      setBusy(false);
    }
  }

  if (stage === 'email') {
    return (
      <View style={styles.wrap}>
        <Text style={styles.title}>Verify your campus</Text>
        <Text style={styles.body}>
          Enter your {university} email — we&apos;ll send a 6-digit code. Only students with a real @{domain} get in.
        </Text>

        <View style={styles.schoolRow}>
          <Text style={styles.schoolEmoji}>🎓</Text>
          <Text style={styles.schoolName} numberOfLines={1}>
            {university}
          </Text>
          <Text style={styles.schoolDomain}>{domain}</Text>
        </View>

        <View style={styles.emailRow}>
          <TextInput
            style={styles.localInput}
            value={localPart}
            onChangeText={(t) => setLocalPart(t.replace(/\s/g, ''))}
            placeholder={hint?.match(/e\.g\.\s*([\w.+-]+)/i)?.[1] ?? 'your.name'}
            placeholderTextColor={Colors.textTertiary}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            editable={!busy}
            accessibilityLabel="Your school email, before the @"
          />
          {/* Locked, not typed — this is the one thing enforced server-side. */}
          <Text style={styles.domainSuffix}>@{domain}</Text>
        </View>

        {/* Guidance only. Nothing about the local part is ever enforced: conventions vary within
            a school, and a regex here would falsely reject short surnames, collision suffixes and
            grad/staff accounts (§1b). */}
        {hint && (
          <Text style={styles.hint}>
            Format: {hint}. Not sure? Just enter the email you actually use — the code confirms it.
          </Text>
        )}

        <View style={styles.privacy}>
          <Ionicons name="lock-closed" size={12} color={Colors.muted} />
          <Text style={styles.privacyText}>
            This is verification only — you still sign in with Google. We never post from it or share it.
          </Text>
        </View>

        {error && <Text style={styles.error}>{error}</Text>}

        <Pressable onPress={handleSend} disabled={!canSend} style={[styles.cta, !canSend && styles.ctaDisabled]}>
          {busy ? <ActivityIndicator color={Colors.ink} /> : <Text style={styles.ctaLabel}>Send code</Text>}
        </Pressable>
        {onSkip && (
          <Pressable onPress={onSkip} disabled={busy} style={styles.skip}>
            <Text style={styles.skipLabel}>{skipLabel}</Text>
          </Pressable>
        )}
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Enter the code</Text>
      <Text style={styles.body}>Sent to {sentTo}. It expires in 10 minutes.</Text>

      <TextInput
        style={styles.codeInput}
        value={code}
        onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, CODE_LENGTH))}
        placeholder="000000"
        placeholderTextColor={Colors.lineStrong}
        keyboardType="number-pad"
        maxLength={CODE_LENGTH}
        editable={!busy}
        autoFocus
        accessibilityLabel="6-digit verification code"
      />

      {error && <Text style={styles.error}>{error}</Text>}

      <Pressable
        onPress={handleSend}
        disabled={cooldown > 0 || busy}
        style={styles.resend}
        accessibilityLabel={cooldown > 0 ? `Resend available in ${cooldown} seconds` : 'Resend code'}>
        <Text style={[styles.resendLabel, cooldown > 0 && styles.resendWaiting]}>
          {cooldown > 0
            ? `Didn't get it? Resend in 0:${String(cooldown).padStart(2, '0')}`
            : "Didn't get it? Resend"}
        </Text>
      </Pressable>

      <Pressable onPress={handleVerify} disabled={!canVerify} style={[styles.cta, !canVerify && styles.ctaDisabled]}>
        {busy ? <ActivityIndicator color={Colors.ink} /> : <Text style={styles.ctaLabel}>{verifyCtaLabel}</Text>}
      </Pressable>

      <Pressable
        onPress={() => {
          setStage('email');
          setError(null);
          setCode('');
        }}
        disabled={busy}
        style={styles.skip}>
        <Text style={styles.skipLabel}>Wrong email? Change it</Text>
      </Pressable>
    </View>
  );
}

// The green of the verified state, brighter than the semantic Colors.green so the badge ring,
// the school name and the "✓ UNLOCKED" labels read as lit rather than merely "success" —
// design-mocks/82-verified.html's #4FD98A / #5FE39B.
const VERIFIED_RING = '#4FD98A';
const VERIFIED_TEXT = '#5FE39B';
/** Near-white with a green cast — text sitting ON the verified green surfaces. */
const VERIFIED_INK = '#EAFFF1';

// The unlocked state (design-mocks/82-verified.html) — ONE component for both entry points:
// onboarding's step 3 and Settings → Campus. Identical copy and layout in both; only the CTA
// label differs ("Enter Philoi" vs "Done").
//
// It reads `university_email_verified` off the live profile itself and renders nothing when the
// server doesn't say verified (punchlist 6 §1). That guard is the whole point: this panel used
// to be mounted off a caller's optimistic local flag, which is how a previous account's
// "You're verified at Laurier" survived a sign-out and showed against the wrong session.
export function CampusVerifiedPanel({
  university,
  onContinue,
  continueLabel = 'Enter Philoi',
  showChangeHint = true,
}: {
  university: string;
  onContinue?: () => void;
  continueLabel?: string;
  /** Settings → Campus already has "Change school" right below, so the hint is onboarding-only. */
  showChangeHint?: boolean;
}) {
  const { profile } = useAuth();

  if (!profile?.university_email_verified) return null;

  return (
    <View style={styles.verifiedWrap}>
      <View style={styles.badgeWrap}>
        {/* Radial glow rather than a full animation — celebratory but calm (mock 82's notes). */}
        <Svg width={150} height={150} style={styles.badgeGlow} pointerEvents="none">
          <Defs>
            <RadialGradient id="campusVerifiedGlow" cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor={Colors.green} stopOpacity={0.32} />
              <Stop offset="62%" stopColor={Colors.green} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx={75} cy={75} r={75} fill="url(#campusVerifiedGlow)" />
        </Svg>
        <View style={styles.badge}>
          <Ionicons name="checkmark" size={44} color={VERIFIED_INK} />
        </View>
        <View style={styles.badgeCrest}>
          <Text style={styles.badgeCrestText}>🎓</Text>
        </View>
      </View>

      <Text style={styles.verifiedTitle}>
        You&apos;re verified at <Text style={styles.verifiedTitleUni}>{university}</Text>
      </Text>
      <Text style={styles.verifiedBody}>
        A verified-campus check now sits on your profile — and two leaderboards just unlocked.
      </Text>

      <View style={styles.unlockedRow}>
        <View style={styles.unlocked}>
          <Text style={styles.unlockedIcon}>🎓</Text>
          <Text style={styles.unlockedText}>My Uni</Text>
          <Text style={styles.unlockedState}>✓ UNLOCKED</Text>
        </View>
        <View style={styles.unlocked}>
          <Text style={styles.unlockedIcon}>⚔️</Text>
          <Text style={styles.unlockedText}>Vs Unis</Text>
          <Text style={styles.unlockedState}>✓ UNLOCKED</Text>
        </View>
      </View>

      <View style={styles.trust}>
        <Text style={styles.trustIcon}>🏆</Text>
        <Text style={styles.trustText}>
          <Text style={styles.trustStrong}>Only verified students count</Text> on My Uni &amp; Vs Unis — so the
          campus rankings stay real.
        </Text>
      </View>

      {/* Previews the badge that now sits on their profile, so the payoff is a thing they can see
          rather than a claim. */}
      <View style={styles.profChip}>
        <Avatar label={profile.display_name ?? 'You'} size={22} lit />
        <Text style={styles.profChipName} numberOfLines={1}>
          {profile.display_name ?? 'you'}
        </Text>
        <Text style={styles.profChipVerified}>🎓 {university} ✓</Text>
      </View>

      {onContinue && (
        <Pressable onPress={onContinue} style={[styles.cta, styles.verifiedCta]}>
          <Text style={styles.ctaLabel}>{continueLabel}</Text>
        </Pressable>
      )}
      {showChangeHint && <Text style={styles.verifiedHint}>Change schools anytime in Settings → Campus.</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: Spacing.three,
  },
  title: {
    fontFamily: Fonts.displayHeavy,
    fontSize: 22,
    color: Colors.ink,
  },
  body: {
    fontFamily: Fonts.body,
    fontSize: 13,
    lineHeight: 19,
    color: Colors.muted,
  },
  schoolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    backgroundColor: Colors.card,
    borderRadius: Radius.card,
    padding: Spacing.three,
  },
  schoolEmoji: {
    fontSize: 16,
  },
  schoolName: {
    flex: 1,
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13.5,
    color: Colors.ink,
  },
  schoolDomain: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.amber,
  },
  emailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: Radius.input,
    borderWidth: 1.5,
    borderColor: Colors.line,
    paddingHorizontal: Spacing.three,
  },
  localInput: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 15,
    color: Colors.ink,
    paddingVertical: Spacing.three,
  },
  domainSuffix: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 14,
    color: Colors.muted,
  },
  hint: {
    fontFamily: Fonts.body,
    fontSize: 11,
    lineHeight: 16,
    color: Colors.textTertiary,
  },
  privacy: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
    backgroundColor: Colors.card,
    borderRadius: Radius.card,
    padding: Spacing.three,
  },
  privacyText: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 11,
    lineHeight: 16.5,
    color: Colors.muted,
  },
  codeInput: {
    fontFamily: Fonts.displayHeavy,
    fontSize: 34,
    letterSpacing: 12,
    textAlign: 'center',
    color: Colors.ink,
    backgroundColor: Colors.card,
    borderRadius: Radius.card,
    borderWidth: 1.5,
    borderColor: Colors.line,
    paddingVertical: Spacing.three,
  },
  resend: {
    alignSelf: 'center',
  },
  resendLabel: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.amber,
  },
  resendWaiting: {
    color: Colors.textTertiary,
  },
  cta: {
    backgroundColor: Colors.coral,
    borderRadius: Radius.button,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  ctaDisabled: {
    opacity: 0.45,
  },
  ctaLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 15,
    color: Colors.ink,
  },
  skip: {
    alignSelf: 'center',
    paddingVertical: Spacing.two,
  },
  skipLabel: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.textTertiary,
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.coral,
  },
  // ───────────────────────── verified panel (design-mocks/82) ─────────────────────────
  verifiedWrap: {
    alignItems: 'center',
    gap: Spacing.two,
  },
  badgeWrap: {
    width: 110,
    height: 110,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.two,
  },
  badgeGlow: {
    position: 'absolute',
  },
  badge: {
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: Colors.green,
    borderWidth: 2,
    borderColor: VERIFIED_RING,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeCrest: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: Colors.cardDark,
    borderWidth: 1,
    borderColor: Colors.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeCrestText: {
    fontSize: 15,
  },
  verifiedTitle: {
    fontFamily: Fonts.displayHeavy,
    fontSize: 24,
    lineHeight: 28,
    color: Colors.ink,
    textAlign: 'center',
    marginTop: Spacing.two,
  },
  verifiedTitleUni: {
    color: VERIFIED_TEXT,
  },
  verifiedBody: {
    fontFamily: Fonts.body,
    fontSize: 13,
    lineHeight: 19,
    color: Colors.muted,
    textAlign: 'center',
    maxWidth: 260,
  },
  unlockedRow: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  unlocked: {
    flex: 1,
    alignItems: 'center',
    gap: 5,
    // Green-tinted rather than the flat card surface — these two are the payoff, not a list row.
    backgroundColor: 'rgba(61,168,92,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(79,217,138,0.45)',
    borderRadius: 13,
    paddingVertical: 13,
    paddingHorizontal: 10,
  },
  unlockedIcon: {
    fontSize: 19,
  },
  unlockedText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: VERIFIED_INK,
  },
  unlockedState: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9.5,
    letterSpacing: 0.5,
    color: VERIFIED_TEXT,
  },
  // Elevated off the screen background (Colors.cream), matching the mock's card-over-stage step.
  trust: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: Radius.input,
    paddingVertical: 13,
    paddingHorizontal: 14,
  },
  trustIcon: {
    fontSize: 13,
  },
  trustText: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 11.5,
    lineHeight: 17,
    color: Colors.coldChipText,
  },
  trustStrong: {
    fontFamily: Fonts.bodyBold,
    color: VERIFIED_INK,
  },
  profChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    maxWidth: '100%',
    backgroundColor: Colors.cardDark,
    borderRadius: Radius.pill,
    paddingVertical: 7,
    paddingHorizontal: 13,
  },
  profChipName: {
    flexShrink: 1,
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: Colors.ink,
  },
  profChipVerified: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10.5,
    color: VERIFIED_TEXT,
  },
  // The shared `cta` doesn't claim full width inside this centered column the way it does in
  // the form above (which isn't centered), so stretch it back out.
  verifiedCta: {
    alignSelf: 'stretch',
    marginTop: Spacing.two,
  },
  verifiedHint: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textTertiary,
    textAlign: 'center',
  },
});
