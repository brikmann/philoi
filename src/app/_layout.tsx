import { useFonts as useFredokaFonts, Fredoka_500Medium, Fredoka_600SemiBold } from '@expo-google-fonts/fredoka';
import {
  useFonts as useNunitoFonts,
  Nunito_400Regular,
  Nunito_600SemiBold,
  Nunito_700Bold,
  Nunito_800ExtraBold,
} from '@expo-google-fonts/nunito';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts, Spacing } from '@/constants/theme';
import { AuthProvider, useAuth } from '@/lib/auth/auth-context';

SplashScreen.preventAutoHideAsync();

function RootNavigator() {
  const { ready, error, session, needsHandle } = useAuth();
  const [fredokaLoaded] = useFredokaFonts({ Fredoka_500Medium, Fredoka_600SemiBold });
  const [nunitoLoaded] = useNunitoFonts({
    Nunito_400Regular,
    Nunito_600SemiBold,
    Nunito_700Bold,
    Nunito_800ExtraBold,
  });

  const appReady = ready && fredokaLoaded && nunitoLoaded;

  useEffect(() => {
    if (appReady) SplashScreen.hideAsync();
  }, [appReady]);

  if (!appReady) return null;

  if (error) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorTitle}>Couldn't connect to Philoi</Text>
        <Text style={styles.errorBody}>{error}</Text>
        <Text style={styles.errorHint}>
          Check SUPABASE_URL / SUPABASE_ANON_KEY in .env, that supabase/schema.sql ran with no
          errors, and your network connection — then reload the app.
        </Text>
      </View>
    );
  }

  return (
    <Stack screenOptions={{ contentStyle: { backgroundColor: Colors.cream } }}>
      <Stack.Protected guard={!session}>
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      </Stack.Protected>

      <Stack.Protected guard={Boolean(session) && needsHandle}>
        <Stack.Screen name="setup-handle" options={{ headerShown: false }} />
      </Stack.Protected>

      <Stack.Protected guard={Boolean(session) && !needsHandle}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="group/[groupId]/index" options={{ title: '' }} />
        <Stack.Screen
          name="group/[groupId]/check-in"
          options={{ presentation: 'modal', title: 'Check in' }}
        />
        <Stack.Screen name="group/create" options={{ presentation: 'modal', title: 'Start a circle' }} />
        <Stack.Screen name="paywall" options={{ presentation: 'modal', title: '' }} />
      </Stack.Protected>

      {/* Public — reachable via philoi://join?code=ABC123 whether or not the user is signed in. */}
      <Stack.Screen name="join" options={{ headerShown: false }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <RootNavigator />
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  errorContainer: {
    flex: 1,
    backgroundColor: Colors.cream,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    padding: Spacing.four,
  },
  errorTitle: {
    fontFamily: Fonts.display,
    fontSize: 20,
    color: Colors.ink,
    textAlign: 'center',
  },
  errorBody: {
    fontFamily: Fonts.bodySemiBold,
    color: Colors.coral,
    textAlign: 'center',
  },
  errorHint: {
    fontFamily: Fonts.body,
    color: Colors.muted,
    textAlign: 'center',
    fontSize: 13,
  },
});
