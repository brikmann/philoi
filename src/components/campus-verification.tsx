import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { CampusVerificationError, sendCampusCode, verifyCampusCode } from '@/lib/api/campus-verification';
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

// The unlocked state (mock 75D) — shown once verification lands, in onboarding and as the
// Settings "Campus" row's success view.
export function CampusVerifiedPanel({
  university,
  onContinue,
  continueLabel = 'Enter Philoi',
}: {
  university: string;
  onContinue?: () => void;
  continueLabel?: string;
}) {
  return (
    <View style={styles.wrap}>
      <View style={styles.tick}>
        <Ionicons name="checkmark" size={30} color={Colors.ink} />
      </View>
      <Text style={styles.title}>You&apos;re verified at {university}</Text>
      <Text style={styles.body}>
        A verified-campus check now sits on your profile — and two leaderboards just unlocked.
      </Text>

      <View style={styles.unlockedRow}>
        <View style={styles.unlocked}>
          <Text style={styles.unlockedText}>🎓 My Uni</Text>
          <Ionicons name="checkmark" size={13} color={Colors.green} />
        </View>
        <View style={styles.unlocked}>
          <Text style={styles.unlockedText}>⚔ Vs Unis</Text>
          <Ionicons name="checkmark" size={13} color={Colors.green} />
        </View>
      </View>

      <View style={styles.privacy}>
        <Text style={styles.privacyText}>
          🏆 Only verified students count on My Uni &amp; Vs Unis — so the campus rankings are real.
        </Text>
      </View>

      {onContinue && (
        <Pressable onPress={onContinue} style={styles.cta}>
          <Text style={styles.ctaLabel}>{continueLabel}</Text>
        </Pressable>
      )}
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
  tick: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Colors.green,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  unlockedRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  unlocked: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: Colors.card,
    borderRadius: Radius.card,
    paddingVertical: Spacing.three,
  },
  unlockedText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12.5,
    color: Colors.ink,
  },
});
