import Constants from 'expo-constants';
import PostHog from 'posthog-react-native';

const { posthogApiKey, posthogHost } = Constants.expoConfig?.extra ?? {};

// Null when POSTHOG_API_KEY isn't set — track()/identify() below no-op instead of crashing,
// so analytics being unconfigured never breaks the app. Set POSTHOG_API_KEY in .env to enable.
export const posthog: PostHog | null = posthogApiKey
  ? new PostHog(posthogApiKey, { host: posthogHost ?? 'https://us.i.posthog.com' })
  : null;

if (!posthogApiKey && __DEV__) {
  console.warn('[posthog] POSTHOG_API_KEY is not set — events will only be written to Supabase.');
}
