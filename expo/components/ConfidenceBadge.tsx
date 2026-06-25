import { StyleSheet, Text, View } from "react-native";

import { Colors, Fonts } from "@/constants/theme";
import { Confidence } from "@/types";

export function ConfidenceBadge({ c }: { c: Confidence }) {
  const palette =
    c.level === "high"
      ? { bg: "rgba(18,18,18,0.08)", fg: Colors.foreground, dot: Colors.foreground }
      : c.level === "medium"
        ? { bg: Colors.accentSoft, fg: Colors.accent, dot: Colors.accent }
        : { bg: Colors.amberSoft, fg: Colors.amber, dot: Colors.amber };

  return (
    <View style={[styles.badge, { backgroundColor: palette.bg }]}>
      <View style={[styles.dot, { backgroundColor: palette.dot }]} />
      <Text style={[styles.label, { color: palette.fg }]}>{c.label.toUpperCase()}</Text>
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
  label: { fontFamily: Fonts.mono, fontSize: 9.5, letterSpacing: 0.2 },
});
