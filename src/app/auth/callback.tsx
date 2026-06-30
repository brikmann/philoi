import { Redirect } from 'expo-router';

// The OAuth redirect (philoi://auth/callback) lands here after Google sign-in completes.
// expo-web-browser's openAuthSessionAsync already captured the token from this URL in
// providers.ts — this screen's only job is to not be a dead end. Bouncing to "/" lets the
// Stack.Protected guards in the root layout route to the right place once the session lands.
export default function AuthCallbackScreen() {
  return <Redirect href="/" />;
}
