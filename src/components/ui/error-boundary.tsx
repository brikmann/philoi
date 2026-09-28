import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';

type Props = {
  children: ReactNode;
  /** Names the surface in logs so a blank-screen report can be traced to the throwing screen. */
  label?: string;
  /** Optional custom fallback. Receives a reset() that clears the error and re-mounts children. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
};

type State = { error: Error | null };

// A screen-level error boundary. A data hook that throws during render (a null-deref, an
// unexpected query shape) takes its whole screen down to a blank white view because React
// unmounts the subtree — and with no boundary anywhere above it, that white view IS the app
// (device triage build 9, P0 #4: Friends + Campfire Valley "render fully white"). Wrapping a
// screen in this turns that into a legible "couldn't load" card with a retry, so one screen's
// bug degrades to a message instead of a dead app. Class component on purpose: componentDidCatch
// / getDerivedStateFromError have no hooks equivalent.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[ErrorBoundary${this.props.label ? ` · ${this.props.label}` : ''}]`, error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);

    return (
      <View style={styles.container}>
        <Text style={styles.emoji}>🌫️</Text>
        <Text style={styles.title}>This didn&apos;t load</Text>
        <Text style={styles.body}>Something went wrong showing this screen. It isn&apos;t you — try again.</Text>
        <Pressable style={styles.button} onPress={this.reset} accessibilityRole="button">
          <Text style={styles.buttonLabel}>Try again</Text>
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
    gap: Spacing.three,
    paddingVertical: Spacing.six,
    paddingHorizontal: Spacing.four,
  },
  emoji: { fontSize: 40 },
  title: {
    fontFamily: Fonts.display,
    fontSize: 20,
    color: Colors.ink,
    textAlign: 'center',
  },
  body: {
    fontFamily: Fonts.body,
    fontSize: 15,
    color: Colors.muted,
    textAlign: 'center',
  },
  button: {
    marginTop: Spacing.two,
    paddingVertical: 10,
    paddingHorizontal: Spacing.four,
    borderRadius: Radius.pill,
    backgroundColor: Colors.coral,
  },
  buttonLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 14,
    color: '#FFFFFF',
  },
});
