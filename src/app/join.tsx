import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/ui/primary-button';
import { Screen } from '@/components/ui/screen';
import { TextInput } from '@/components/ui/text-input';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { track } from '@/lib/analytics';
import { useAuth } from '@/lib/auth/auth-context';
import { signInWithGoogle } from '@/lib/auth/providers';
import { getErrorMessage } from '@/lib/errors';
import { joinGroupWithCode } from '@/lib/api/groups';

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
      setError(getErrorMessage(e, 'Could not find that circle.'));
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
            Join {params.code ? `with code ${params.code.toUpperCase()}` : 'a circle'}
          </Text>
          <Text style={[styles.body, styles.bodyOnDark]}>Sign in first — your circle’s waiting.</Text>
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
    <Screen style={styles.container}>
      <View style={styles.form}>
        <Text style={styles.title}>Join a circle</Text>
        <Text style={styles.body}>Paste or type the code your friend shared.</Text>
        <TextInput
          autoCapitalize="characters"
          placeholder="e.g. ABC123"
          value={code}
          onChangeText={setCode}
          maxLength={6}
        />
        {error && <Text style={styles.error}>{error}</Text>}
        <PrimaryButton label="Join circle" onPress={() => handleJoin(code)} loading={loading} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
  },
  signInPrompt: {
    gap: Spacing.three,
  },
  form: {
    gap: Spacing.three,
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
  },
  bodyOnDark: {
    color: Colors.ember,
  },
  error: {
    fontFamily: Fonts.body,
    color: Colors.coral,
  },
});
