import { StyleSheet, Text, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { Colors, Fonts } from "@/constants/theme";
import { Confidence } from "@/types";

export function ConfidenceBadge({ c }: { c: Confidence }) {
  const isLow = c.level === "low";
  const isHigh = c.level === "high";

  const palette = isHigh
    ? { bg: Colors.black, fg: Colors.white, dot: Colors.white }
    : c.level === "medium"
      ? { bg: Colors.accentSoft, fg: Colors.accent, dot: Colors.accent }
      : { bg: Colors.amberSoft, fg: Colors.amber, dot: Colors.amber };

  // Pulse animation for the "GATHERING INTELLIGENCE" dot
  const pulseStyle = useAnimatedStyle(() => ({
    opacity: isLow
      ? withRepeat(withTiming(0.35, { duration: 800 }), -1, true)
      : 1,
  }));

  return (
    <View style={[styles.badge, { backgroundColor: palette.bg }]}>
      <Animated.View
        style={[
          styles.dot,
          { backgroundColor: palette.dot },
          isLow && pulseStyle,
        ]}
      />
      <Text style={[styles.label, { color: palette.fg }]}>{c.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  label: { fontFamily: Fonts.mono, fontSize: 9.5, letterSpacing: 1.0 },
});
