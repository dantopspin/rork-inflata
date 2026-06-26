import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Colors, Fonts, Radius } from "@/constants/theme";

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error("[ErrorBoundary]", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.screen}>
          <Text style={styles.title}>Something went wrong.</Text>
          <Text style={styles.body}>
            Your data is safe. Try restarting the app.
            If this keeps happening, clear your data
            in Settings.
          </Text>
          <Pressable
            onPress={() => this.setState({ hasError: false, error: null })}
            style={styles.btn}
            accessibilityRole="button"
            accessibilityLabel="Try again"
          >
            <Text style={styles.btnText}>TRY AGAIN</Text>
          </Pressable>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    backgroundColor: Colors.background,
  },
  title: {
    fontFamily: Fonts.extrabold,
    fontSize: 22,
    letterSpacing: -0.5,
    color: Colors.foreground,
    textAlign: "center",
  },
  body: {
    marginTop: 12,
    fontFamily: Fonts.regular,
    fontSize: 14,
    lineHeight: 20,
    color: Colors.mutedForeground,
    textAlign: "center",
  },
  btn: {
    marginTop: 24,
    height: 48,
    paddingHorizontal: 28,
    borderRadius: Radius.full,
    backgroundColor: Colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  btnText: {
    fontFamily: Fonts.bold,
    fontSize: 13,
    letterSpacing: 0.5,
    color: Colors.accentForeground,
  },
});
