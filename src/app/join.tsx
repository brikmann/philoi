import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { FlameLogo } from '@/components/ui/flame-logo';
import { SocialGlyph } from '@/components/ui/glyphs-social';
import { Screen } from '@/components/ui/screen';
import { SPACE_GUTTER, SpaceButton, SpaceHeader, SpaceIconButton } from '@/components/ui/space-kit';
import { TextInput } from '@/components/ui/text-input';
import { UiGlyph } from '@/components/ui/ui-glyph';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { track } from '@/lib/analytics';
import { useAuth } from '@/lib/auth/auth-context';
import { signInWithGoogle } from '@/lib/auth/providers';
import { getErrorMessage } from '@/lib/errors';
import { joinGroupWithCode } from '@/lib/api/groups';

// Reached via philoi://join?code=ABC123 whether or not the user is signed in. Punchlist 2, §3:
// this had drifted from the current create/join visual language (mocks 04/10) — the header +
// field-card treatment below now match group/create.tsx exactly rather than a plain bare form.
// Space-purple pass: the header is the kit's SpaceHeader (no back — this is a modal-style
// destination you close), and both CTAs are SpaceButton's ember primary.
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
          <SpaceButton
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
      <SpaceHeader
        title="Join a campfire"
        back={false}
        right={
          <SpaceIconButton onPress={() => router.back()} label="Close">
            <UiGlyph name="close" size={18} color={Colors.ink} />
          </SpaceIconButton>
        }
      />

      <View style={styles.form}>
        <View style={styles.icon}>
          <FlameLogo size={48} />
        </View>
        <Text style={styles.body}>Paste or type the code your friend shared.</Text>

        <Text style={styles.lbl}>Invite code</Text>
        <View style={styles.field}>
          <View style={styles.fieldIcon}>
            <SocialGlyph name="key" size={15} color={Colors.navEmber} />
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
        <SpaceButton label="Join Campfire" onPress={() => handleJoin(code)} loading={loading} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
  },
  screen: {
    paddingTop: Spacing.two,
  },
  signInPrompt: {
    gap: Spacing.three,
  },
  form: {
    gap: Spacing.three,
    paddingHorizontal: SPACE_GUTTER,
    paddingTop: Spacing.two,
  },
  icon: {
    alignSelf: 'center',
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: 26,
    color: Colors.ink,
  },
  // Was Colors.cream — which the space retheme repointed to the #0E0A1C BACKGROUND, so this title
  // had become dark-on-dark. Ink is what "on dark" means now.
  titleOnDark: {
    color: Colors.ink,
  },
  body: {
    fontFamily: Fonts.body,
    fontSize: 15,
    color: Colors.spaceDim,
    textAlign: 'center',
  },
  bodyOnDark: {
    color: Colors.navEmber2,
  },
  // SpaceSection's label treatment, kept inline because the form's gap already spaces it.
  lbl: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10.5,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: Colors.spaceFaint,
    marginTop: 4,
    marginBottom: -4,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    borderRadius: 14,
    paddingVertical: 11,
    paddingHorizontal: 12,
  },
  fieldIcon: {
    width: 26,
    height: 26,
    borderRadius: 7,
    backgroundColor: 'rgba(255,122,47,0.14)',
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
    color: Colors.danger,
  },
});
