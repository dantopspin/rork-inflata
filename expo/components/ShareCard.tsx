import { forwardRef } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Sparkline } from "@/components/Sparkline";
import { Colors, Fonts, Radius } from "@/constants/theme";
import { fmtPct, fmtUSD } from "@/lib/format";
import { itemConfidence } from "@/lib/inflation";
import { ItemStat } from "@/types";

/** Small perforation notch used for the tear-off paper edge. */
function PerfEdge() {
  return (
    <View style={perfStyles.edge} accessibilityElementsHidden>
      {Array.from({ length: 16 }).map((_, i) => (
        <View key={i} style={perfStyles.notch} />
      ))}
    </View>
  );
}

/**
 * Hall of Shame card — the primary growth asset. Data-journalism aesthetic:
 * white background, bold black type, red-orange accents on the percentages.
 * Rendered as a real view so react-native-view-shot can export it as an image.
 */
export const HallOfShameCard = forwardRef<View, {
  items: ItemStat[];
  inflation: number;
  monthLabel: string;
}>(function HallOfShameCard({ items, inflation, monthLabel }, ref) {
  return (
    <View ref={ref} collapsable={false} style={styles.card}>
      <PerfEdge />
      <View style={styles.head}>
        <Text style={styles.wordmark}>INFLATA</Text>
        <View style={styles.dot} />
      </View>

      <Text style={styles.hosTitle}>
        My Grocery{"\n"}
        <Text style={styles.italic}>Hall of Shame</Text>
      </Text>
      <Text style={styles.monthLabel}>{monthLabel.toUpperCase()}</Text>

      <View style={styles.hosList}>
        {items.slice(0, 3).map((it, idx) => (
          <View key={it.key} style={styles.hosRow}>
            <View style={styles.hosRankCol}>
              <Text style={styles.hosRankNum}>{idx + 1}</Text>
            </View>
            <Text style={styles.hosName} numberOfLines={1}>
              {it.name}
            </Text>
            <View style={styles.hosStatGroup}>
              <Text style={styles.hosPct}>{fmtPct(it.pctChange)}</Text>
              <Text style={styles.hosDollar}>+{fmtUSD(Math.max(0, it.dollarChange))}</Text>
            </View>
          </View>
        ))}
      </View>

      <View style={styles.hosFooter}>
        <View>
          <Text style={styles.miLabel}>MY INFLATION</Text>
          <Text style={styles.miValue}>{fmtPct(inflation)}</Text>
        </View>
        <Text style={styles.tagline}>
          Tracking my real prices.{"\n"}Build your own with Inflata.
        </Text>
      </View>

      <PerfEdge />
    </View>
  );
});

/** Individual item spike card — secondary share asset. */
export const ItemSpikeCard = forwardRef<View, { stat: ItemStat; sinceLabel: string; rank?: number }>(
  function ItemSpikeCard({ stat, sinceLabel, rank }, ref) {
    const conf = itemConfidence(stat);
    return (
      <View ref={ref} collapsable={false} style={styles.card}>
        <PerfEdge />
        <View style={styles.head}>
          <Text style={styles.wordmark}>INFLATA</Text>
          <View style={styles.dot} />
        </View>

        {rank !== undefined ? (
          <Text style={styles.spikeRank}>#{rank} WORST OFFENDER</Text>
        ) : null}
        <Text style={styles.itemName}>{stat.name}</Text>
        <Text style={styles.itemUp}>
          Up {fmtPct(stat.pctChange, false)} since {sinceLabel}
        </Text>

        <Text style={styles.itemPocket}>
          That&apos;s{" "}
          <Text style={styles.bold}>{fmtUSD(stat.cumulativeOverspend)}</Text> more out of your
          pocket in the last 6 months.
        </Text>

        <View style={styles.sparkBox}>
          <Sparkline prices={stat.history.map((h) => h.price)} height={56} strokeWidth={3} />
          <Text style={styles.sparkLabel}>
            {fmtUSD(stat.firstPrice)} → {fmtUSD(stat.currentPrice)}
          </Text>
        </View>

        <View style={styles.itemFooter}>
          <Text style={styles.confLabel}>{conf.label.toUpperCase()}</Text>
          <Text style={styles.confLabel}>INFLATA</Text>
        </View>

        <PerfEdge />
      </View>
    );
  },
);

const styles = StyleSheet.create({
  card: {
    width: 340,
    backgroundColor: "#F9F9F7",
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 24,
    transform: [{ rotate: "-1deg" }],
  },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  wordmark: { fontFamily: Fonts.mono, fontSize: 11, letterSpacing: 1.5, color: Colors.foreground },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.accent },
  hosTitle: {
    marginTop: 24,
    fontFamily: Fonts.extrabold,
    fontSize: 26,
    lineHeight: 28,
    letterSpacing: -0.8,
    color: Colors.foreground,
  },
  italic: { fontStyle: "italic" },
  monthLabel: {
    marginTop: 2,
    fontFamily: Fonts.mono,
    fontSize: 10,
    letterSpacing: 1.5,
    color: Colors.mutedForeground,
  },
  hosList: {
    marginTop: 24,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: Colors.border,
    paddingVertical: 18,
    gap: 14,
  },
  hosRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  hosRankCol: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.foreground,
    alignItems: "center",
    justifyContent: "center",
  },
  hosRankNum: {
    fontFamily: Fonts.mono,
    fontSize: 18,
    color: Colors.background,
    lineHeight: 20,
  },
  hosName: { flex: 1, fontFamily: Fonts.bold, fontSize: 14, letterSpacing: -0.3, color: Colors.foreground },
  hosStatGroup: { alignItems: "flex-end", gap: 2 },
  hosPct: { fontFamily: Fonts.extrabold, fontSize: 18, color: Colors.accent },
  hosDollar: { fontFamily: Fonts.mono, fontSize: 10, color: Colors.mutedForeground },
  hosFooter: { marginTop: 20, flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" },
  miLabel: { fontFamily: Fonts.mono, fontSize: 10, letterSpacing: 1.5, color: Colors.mutedForeground },
  miValue: {
    fontFamily: Fonts.extrabold,
    fontSize: 36,
    letterSpacing: -1.2,
    color: Colors.foreground,
    fontVariant: ["tabular-nums"],
  },
  tagline: { maxWidth: 140, textAlign: "right", fontSize: 10, color: Colors.mutedForeground, fontFamily: Fonts.medium },
  spikeRank: {
    marginTop: 24,
    fontFamily: Fonts.mono,
    fontSize: 10,
    letterSpacing: 1.5,
    color: Colors.accent,
  },
  itemName: {
    marginTop: 24,
    fontFamily: Fonts.extrabold,
    fontSize: 30,
    lineHeight: 32,
    letterSpacing: -1,
    color: Colors.foreground,
  },
  itemUp: { marginTop: 4, fontFamily: Fonts.bold, fontSize: 16, color: Colors.accent },
  itemPocket: { marginTop: 16, fontSize: 14, lineHeight: 20, color: Colors.foreground, fontFamily: Fonts.regular },
  bold: { fontFamily: Fonts.extrabold },
  sparkBox: { marginTop: 20, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md, padding: 12 },
  sparkLabel: {
    marginTop: 8,
    fontFamily: Fonts.mono,
    fontSize: 10,
    letterSpacing: 1,
    color: Colors.mutedForeground,
  },
  itemFooter: { marginTop: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  confLabel: { fontFamily: Fonts.mono, fontSize: 10, letterSpacing: 1, color: Colors.mutedForeground },
});

const perfStyles = StyleSheet.create({
  edge: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 4,
    marginBottom: 16,
    marginTop: 0,
  },
  notch: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: Colors.background,
  },
});
