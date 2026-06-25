import { BlurView } from "expo-blur";
import { Lock } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PaywallSheet } from "@/components/PaywallSheet";
import { Colors, Fonts, Radius } from "@/constants/theme";
import { aggregateItems } from "@/lib/inflation";
import { useApp } from "@/providers/AppProvider";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// Keyword maps for category inference
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  Dairy:   ["milk","butter","cheese","yogurt","cream","eggs","egg","cheddar","mozzarella","brie","kefir","whey"],
  Meat:    ["chicken","beef","pork","turkey","salmon","shrimp","steak","lamb","bacon","sausage","tuna","tilapia","cod","ham"],
  Produce: ["banana","apple","lettuce","tomato","onion","pepper","carrot","broccoli","spinach","avocado","potato","grape","berry","orange","lemon","lime","cucumber","zucchini","mushroom","celery","kale","mango","peach","pear","corn","asparagus"],
};

function inferCategory(name: string): string {
  const lower = name.toLowerCase();
  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) return cat;
  }
  return "Pantry";
}

function computeCategories(scans: ReturnType<typeof useApp>["scans"]): [string, number][] | null {
  let total = 0;
  const sums: Record<string, number> = { Dairy: 0, Meat: 0, Produce: 0, Pantry: 0 };

  for (const s of scans) {
    if (s.source !== "scan") continue;
    for (const it of s.items) {
      const cat = inferCategory(it.name);
      sums[cat] += it.price;
      total += it.price;
    }
  }

  if (total === 0) return null; // no real scan data — hide section

  return Object.entries(sums)
    .map(([label, sum]): [string, number] => [label, Math.round((sum / total) * 100)])
    .filter(([, pct]) => pct > 0)
    .sort(([, a], [, b]) => b - a);
}

// Realistic demo data — non-linear, looks like real grocery spend
const DEMO_MONTHLY: [string, number][] = [
  ["2026-01", 320],
  ["2026-02", 291],
  ["2026-03", 358],
  ["2026-04", 342],
  ["2026-05", 407],
  ["2026-06", 389],
];
const DEMO_VOLATILE = [
  { key: "eggs",           name: "Eggs",           pctChange: 41  },
  { key: "butter",         name: "Butter",          pctChange: 28  },
  { key: "milk",           name: "Whole Milk",      pctChange: 18  },
  { key: "chicken-breast", name: "Chicken Breast",  pctChange: 12  },
  { key: "bananas",        name: "Bananas",         pctChange: -3  },
];
const DEMO_CATEGORIES: [string, number][] = [
  ["Dairy",   38],
  ["Meat",    27],
  ["Produce", 18],
  ["Pantry",  17],
];

function labelMonth(yyyyMm: string): string {
  const [, m] = yyyyMm.split("-");
  return MONTHS[parseInt(m, 10) - 1] ?? m;
}

function pctColor(pct: number): string {
  if (pct > 0) return Colors.accent;      // red-orange — bad, price rose
  if (pct < 0) return "#22a06b";          // green — good, price fell
  return Colors.mutedForeground;
}

export default function Trends() {
  const insets = useSafeAreaInsets();
  const { subscribed, scans } = useApp();
  const [paywall, setPaywall] = useState(false);

  const monthly = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of scans) {
      if (s.source !== "scan") continue;
      const k = s.date.slice(0, 7);
      const sum = s.items.reduce((a, i) => a + i.price, 0);
      m.set(k, (m.get(k) ?? 0) + sum);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [scans]);

  const volatile = useMemo(() => {
    const stats = aggregateItems(scans);
    return stats
      .filter((s) => s.history.length >= 2)
      .sort((a, b) => Math.abs(b.pctChange) - Math.abs(a.pctChange))
      .slice(0, 5);
  }, [scans]);

  const categories = useMemo(() => computeCategories(scans), [scans]);

  const monthlyData  = monthly.length ? monthly : DEMO_MONTHLY;
  const volatileData = volatile.length
    ? volatile.map((v) => ({ key: v.key, name: v.name, pctChange: v.pctChange }))
    : DEMO_VOLATILE;
  const categoryData = categories ?? (subscribed ? null : DEMO_CATEGORIES);
  const maxSpend     = Math.max(1, ...monthlyData.map(([, v]) => v));

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 24,
          paddingTop: insets.top + 12,
          paddingBottom: insets.bottom + 120,
        }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.kicker}>SPENDING</Text>
        <Text style={styles.title}>Month over month</Text>

        <View style={{ position: "relative", marginTop: 32 }}>
          {/* Content — pointer-events disabled for non-subscribers */}
          <View style={{ pointerEvents: subscribed ? "auto" : "none" }}>

            {/* ── Monthly spend bar chart ── */}
            <View style={styles.card} accessibilityLabel={`Monthly spend chart. Highest month: $${maxSpend.toFixed(0)}`}>
              <Text style={styles.cardKicker}>MONTHLY SPEND</Text>
              <View style={styles.chart}>
                {monthlyData.map(([k, v], i) => (
                  <View key={k} style={styles.barCol} accessibilityLabel={`${labelMonth(k)}: $${v.toFixed(0)}`}>
                    <View style={styles.barTrack}>
                      <Animated.View
                        entering={FadeInDown.duration(500).delay(i * 60)}
                        style={[styles.bar, { height: `${(v / maxSpend) * 100}%` }]}
                      />
                    </View>
                    <Text style={styles.barLabel} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                      {labelMonth(k)}
                    </Text>
                  </View>
                ))}
              </View>
            </View>

            {/* ── Most volatile ── */}
            <Text style={[styles.cardKicker, { marginTop: 28 }]}>MOST VOLATILE</Text>
            <View style={{ gap: 8, marginTop: 12 }}>
              {volatileData.map((v) => (
                <View key={v.key} style={styles.volatileRow}>
                  <Text style={styles.volatileName}>{v.name}</Text>
                  <Text style={[styles.volatilePct, { color: pctColor(v.pctChange) }]}>
                    {v.pctChange > 0 ? "+" : ""}
                    {v.pctChange.toFixed(1)}%
                  </Text>
                </View>
              ))}
            </View>

            {/* ── Category breakdown — only rendered when real data exists ── */}
            {categoryData && categoryData.length > 0 ? (
              <View style={[styles.card, { marginTop: 24 }]}>
                <Text style={styles.cardKicker}>CATEGORY BREAKDOWN</Text>
                <View style={{ gap: 14, marginTop: 16 }}>
                  {categoryData.map(([label, pct]) => (
                    <View key={label}>
                      <View style={styles.catRow}>
                        <Text style={styles.catLabel}>{label}</Text>
                        <Text style={styles.catPct}>{pct}%</Text>
                      </View>
                      <View style={styles.catTrack}>
                        <View style={[styles.catFill, { width: `${pct}%` }]} />
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            ) : subscribed ? (
              // Subscribed but no scan data yet — show empty state, not fake data
              <View style={[styles.card, { marginTop: 24, alignItems: "center", paddingVertical: 28 }]}>
                <Text style={styles.cardKicker}>CATEGORY BREAKDOWN</Text>
                <Text style={[styles.emptyHint, { marginTop: 12 }]}>
                  Scan more receipts to see how your spend breaks down by category.
                </Text>
              </View>
            ) : null}
          </View>

          {/* ── Paywall blur overlay ── */}
          {!subscribed && (
            <BlurView intensity={55} tint="light" style={styles.lockOverlay}>
              <View style={styles.lockInner}>
                <Lock size={32} color={Colors.accent} />
                <Text style={styles.lockTitle}>Trends are locked.</Text>
                <Text style={styles.lockBody}>
                  See exactly how your spend shifts month over month, plus what's driving it.
                </Text>
                <Pressable
                  onPress={() => setPaywall(true)}
                  style={({ pressed }) => [
                    styles.lockCta,
                    pressed && { transform: [{ scale: 0.97 }] },
                  ]}
                >
                  <Text style={styles.lockCtaText}>UNLOCK — FROM $3.99</Text>
                </Pressable>
              </View>
            </BlurView>
          )}
        </View>
      </ScrollView>

      <PaywallSheet
        open={paywall}
        onClose={() => setPaywall(false)}
        reason="Trends are a paid feature"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },

  kicker: {
    fontFamily: Fonts.mono,
    fontSize: 10,
    letterSpacing: 1.5,
    color: Colors.mutedForeground,
  },
  title: {
    marginTop: 8,
    fontFamily: Fonts.extrabold,
    fontSize: 30,
    lineHeight: 34,
    letterSpacing: -1,
    color: Colors.foreground,
  },

  card: {
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    padding: 20,
  },
  cardKicker: {
    fontFamily: Fonts.mono,
    fontSize: 10,
    letterSpacing: 1.5,
    color: Colors.mutedForeground,
  },

  // Bar chart
  chart: {
    marginTop: 16,
    height: 160,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
  },
  barCol: { flex: 1, minWidth: 30, alignItems: "center", gap: 6, height: "100%" },
  barTrack: { flex: 1, width: "100%", justifyContent: "flex-end" },
  bar: {
    width: "100%",
    backgroundColor: Colors.accent,
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
  },
  barLabel: {
    fontFamily: Fonts.mono,
    fontSize: 9,
    letterSpacing: 0.5,
    color: Colors.mutedForeground,
    maxWidth: 44,
  },

  // Volatile rows
  volatileRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: 14,
  },
  volatileName: {
    fontFamily: Fonts.bold,
    fontSize: 14,
    color: Colors.foreground,
  },
  volatilePct: {
    fontFamily: Fonts.monoMedium,
    fontSize: 14,
    // color set dynamically via pctColor()
  },

  // Category breakdown
  catRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  catLabel: { fontSize: 12.5, fontFamily: Fonts.medium, color: Colors.foreground },
  catPct:   { fontFamily: Fonts.mono, fontSize: 12, color: Colors.foreground },
  catTrack: {
    marginTop: 6,
    height: 6,
    borderRadius: 999,
    backgroundColor: Colors.muted,
    overflow: "hidden",
  },
  catFill: { height: "100%", backgroundColor: Colors.foreground, borderRadius: 999 },

  emptyHint: {
    fontSize: 13,
    fontFamily: Fonts.regular,
    color: Colors.mutedForeground,
    textAlign: "center",
    lineHeight: 18,
    maxWidth: 240,
  },

  // Paywall overlay
  lockOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: Radius.xl,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(250,249,245,0.55)",
  },
  lockInner: { alignItems: "center", paddingHorizontal: 24 },
  lockTitle: {
    marginTop: 12,
    fontFamily: Fonts.extrabold,
    fontSize: 24,
    letterSpacing: -0.6,
    color: Colors.foreground,
  },
  lockBody: {
    marginTop: 6,
    maxWidth: 260,
    textAlign: "center",
    fontSize: 13.5,
    color: Colors.mutedForeground,
    fontFamily: Fonts.regular,
    lineHeight: 20,
  },
  lockCta: {
    marginTop: 20,
    height: 48,
    paddingHorizontal: 24,
    borderRadius: 999,
    backgroundColor: Colors.accent,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: Colors.accent,
    shadowOpacity: 0.3,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  lockCtaText: {
    fontFamily: Fonts.bold,
    fontSize: 13,
    letterSpacing: 0.5,
    color: Colors.accentForeground,
  },
});