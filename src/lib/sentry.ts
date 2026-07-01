import Constants from 'expo-constants';
import * as Sentry from '@sentry/react-native';

const { sentryDsn } = Constants.expoConfig?.extra ?? {};

// No-op when SENTRY_DSN isn't set (e.g. the "development" EAS profile, deliberately excluded
// — dev-client sessions already have Metro/red-box visibility, so crash reporting there would
// just be noise). Set SENTRY_DSN in .env / the eas.json build profile to enable.
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    sendDefaultPii: false,
  });
} else if (__DEV__) {
  console.warn('[sentry] SENTRY_DSN is not set — crash reports will not be sent.');
}

export { Sentry };
