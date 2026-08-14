import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Component, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { Sentry } from '@/lib/sentry';

type ErrorBoundaryProps = {
  children: ReactNode;
  /** Shown above the recovery actions — keep it specific to where this boundary is mounted
   * (e.g. "Something went wrong with this lock-in") rather than a generic app-wide message. */
  title?: string;
  /** Where the escape hatch goes. Defaults to Home, but a screen whose work is already banked
   * server-side (a box open — the pull is granted before a single frame plays) should send the
   * user to where that work landed instead. */
  exitTo?: string;
  exitLabel?: string;
};

type ErrorBoundaryState = {
  error: Error | null;
};

// A screen-scoped safety net (currently wraps the lock-in session screen — a failed RPC there,
// e.g. a stale PostgREST schema cache after a migration, must never trap the user on a frozen
// screen with no way out). React error boundaries have to be class components; this is the one
// place in the app that needs to be.
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    Sentry.captureException(error, { extra: { componentStack: info.componentStack } });
  }

  handleRetry = () => {
    this.setState({ error: null });
  };

  handleGoHome = () => {
    this.setState({ error: null });
    router.replace((this.props.exitTo ?? '/') as Parameters<typeof router.replace>[0]);
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <View style={styles.container}>
        <Ionicons name="alert-circle-outline" size={40} color={Colors.coral} />
        <Text style={styles.title}>{this.props.title ?? 'Something went wrong'}</Text>
        <Text style={styles.message}>{this.state.error.message || 'An unexpected error interrupted this screen.'}</Text>
        <Pressable style={styles.primaryButton} onPress={this.handleRetry}>
          <Text style={styles.primaryButtonLabel}>Try again</Text>
        </Pressable>
        <Pressable style={styles.secondaryButton} onPress={this.handleGoHome}>
          <Text style={styles.secondaryButtonLabel}>{this.props.exitLabel ?? 'Go home'}</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    padding: Spacing.five,
    backgroundColor: Colors.cream,
  },
  title: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 17,
    color: Colors.ink,
    textAlign: 'center',
    marginTop: Spacing.two,
  },
  message: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.muted,
    textAlign: 'center',
    marginBottom: Spacing.three,
  },
  primaryButton: {
    backgroundColor: Colors.coral,
    borderRadius: Radius.button,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.six,
  },
  primaryButtonLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 15,
    color: Colors.ink,
  },
  secondaryButton: {
    paddingVertical: Spacing.two,
  },
  secondaryButtonLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13.5,
    color: Colors.muted,
  },
});
