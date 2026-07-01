const { getSentryExpoConfig } = require('@sentry/react-native/metro');

// getSentryExpoConfig wraps Expo's default Metro config (expo/metro-config) and additionally
// configures module resolution for Sentry's own dual ESM/CJS packages — without it, Metro
// fails to resolve @sentry/core's internal exports-mapped submodules (e.g.
// "./tracing/measurement.js") even though the files exist on disk.
module.exports = getSentryExpoConfig(__dirname);
