import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { FlameLogo } from '@/components/ui/flame-logo';
import { PrimaryButton } from '@/components/ui/primary-button';
import { Screen } from '@/components/ui/screen';
import { TextInput } from '@/components/ui/text-input';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { track } from '@/lib/analytics';
import { useAuth } from '@/lib/auth/auth-context';
import { signInWithGoogle } from '@/lib/auth/providers';
import { getErrorMessage } from '@/lib/errors';
import { joinGroupWithCode } from '@/lib/api/groups';

// Reached via philoi://join?code=ABC123 whether or not the user is signed in. Punchlist 2, §3:
// this had drifted from the current create/join visual language (mocks 04/10) — the header +
// field-card treatment below now match group/create.tsx exactly rather than a plain bare form.
export default function JoinScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const params = useLocalSearchParams<{ code?: string }>();
  const [code, setCode] = useState(params.code ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoJoinedRef = useRef(false);

  async function handleJoin(joinCode: string) {
    if (!joinCode.trim()) {
      setError('Enter the code your friend shared.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const group = await joinGroupWithCode(joinCode.trim());
      track('invite_accepted', { group_id: group.id });
      router.replace(`/group/${group.id}`);
    } catch (e) {
      setError(getErrorMessage(e, 'Could not find that Campfire.'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (session && params.code && !autoJoinedRef.current) {
      autoJoinedRef.current = true;
      handleJoin(params.code);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, params.code]);

  if (!session) {
    return (
      <Screen dark style={styles.container}>
        <View style={styles.signInPrompt}>
          <Text style={[styles.title, styles.titleOnDark]}>
            Join {params.code ? `with code ${params.code.toUpperCase()}` : 'a Campfire'}
          </Text>
          <Text style={[styles.body, styles.bodyOnDark]}>Sign in first — your Campfire’s waiting.</Text>
          <PrimaryButton
            label="Continue with Google"
            onPress={() => signInWithGoogle().catch((e) => setError(getErrorMessage(e, 'Something went wrong — try again.')))}
          />
          {error && <Text style={styles.error}>{error}</Text>}
        </View>
      </Screen>
    );
  }

  return (
    <Screen padded={false} style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Join a campfire</Text>
        <Pressable onPress={() => router.back()} hitSlop={8} accessibilityLabel="Close">
          <Ionicons name="close" size={20} color={Colors.muted} />
        </Pressable>
      </View>

      <View style={styles.form}>
        <View style={styles.icon}>
          <FlameLogo size={48} />
        </View>
        <Text style={styles.body}>Paste or type the code your friend shared.</Text>

        <Text style={styles.lbl}>Invite code</Text>
        <View style={styles.field}>
          <View style={styles.fieldIcon}>
            <Ionicons name="key" size={15} color={Colors.amber} />
          </View>
          <TextInput
            style={styles.fieldInput}
            autoCapitalize="characters"
            placeholder="e.g. ABC123"
            value={code}
            onChangeText={setCode}
            maxLength={6}
          />
        </View>

        {error && <Text style={styles.error}>{error}</Text>}
        <PrimaryButton label="Join Campfire" onPress={() => handleJoin(code)} loading={loading} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
  },
  screen: {
    paddingHorizontal: 15,
    paddingTop: 16,
  },
  signInPrompt: {
    gap: Spacing.three,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  headerTitle: {
    fontFamily: Fonts.display,
    fontSize: 17,
    color: Colors.ink,
  },
  form: {
    gap: Spacing.three,
  },
  icon: {
    alignSelf: 'center',
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: 26,
    color: Colors.ink,
  },
  titleOnDark: {
    color: Colors.cream,
  },
  body: {
    fontFamily: Fonts.body,
    fontSize: 15,
    color: Colors.muted,
    textAlign: 'center',
  },
  bodyOnDark: {
    color: Colors.ember,
  },
  lbl: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textTertiary,
    marginTop: 4,
    marginBottom: -4,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: Radius.card,
    paddingVertical: 11,
    paddingHorizontal: 12,
  },
  fieldIcon: {
    width: 26,
    height: 26,
    borderRadius: 7,
    backgroundColor: Colors.achieverBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fieldInput: {
    flex: 1,
    backgroundColor: 'transparent',
    borderWidth: 0,
    padding: 0,
    fontSize: 13,
    color: Colors.ink,
  },
  error: {
    fontFamily: Fonts.body,
    color: Colors.coral,
  },
});
