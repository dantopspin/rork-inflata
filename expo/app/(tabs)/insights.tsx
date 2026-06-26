import { BlurView } from "expo-blur";
import { Lock, AlertTriangle, ArrowRight, TrendingDown, TrendingUp } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { PaywallSheet } from "@/components/PaywallSheet";
import { Colors, Fonts, Radius } from "@/constants/theme";
import { fmtUSD } from "@/lib/format";
import { aggregateItems, nextTripEstimate } from "@/lib/inflation";
import { STAPLES } from "@/lib/seed";
import { useApp } from "@/providers/AppProvider";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// National average basket: sum of all STAPLES prices as a loose comparison point
const NATIONAL_AVG_BASKET = STAPLES.reduce((sum, s) => sum + s.avgPrice, 0);

// Category colours — distinct, high-contrast
const CAT_COLORS: Record<string, string> = {
  Dairy:   "#D4894A",
  Meat:    "#C25B52",
  Produce: "#4A9B5F",
  Pantry:  "#8B7355",
  Snacks:  "#C47B2E",
};

// ── Skeleton data shown behind the paywall blur ──────────────────────────
// Always rendered at a fixed shape/height when the user is not subscribed,
// regardless of how much (or how little) real scan data exists. This keeps
// the lock overlay's size and content consistent, and means we never render
// real text/empty-state copy in the exact spot the blur has to cover.
const SKELETON_MONTH_LABELS = ["Mar", "Apr", "May", "Jun"];
const SKELETON_BAR_HEIGHTS = [48, 72, 58, 86]; // percent
const SKELETON_VOLATILE = [
  { key: "sk1", name: "Ground Beef", pctChange: 14.2 },
  { key: "sk2", name: "Eggs (dozen)", pctChange: -8.6 },
  { key: "sk3", name: "Olive Oil", pctChange: 11.9 },
];
const SKELETON_CATEGORIES: [string, number][] = [
  ["Produce", 34],
  ["Dairy", 24],
  ["Meat", 22],
  ["Pantry", 20],
];

function labelMonth(yyyyMm: string): string {
  const [, m] = yyyyMm.split("-");
  return MONTHS[parseInt(m, 10) - 1] ?? m;
}

function pctColor(pct: number): string {
  if (pct > 0) return Colors.accent;
  if (pct < 0) return Colors.success;
  return Colors.mutedForeground;
}

/** Compute category breakdown from AI-assigned categories. Falls back to "Uncategorized" if missing. */
function computeCategories(scans: ReturnType<typeof useApp>["scans"]): [string, number][] | null {
  let total = 0;
  const sums: Record<string, number> = {};

  for (const s of scans) {
    if (s.source !== "scan") continue;
    for (const it of s.items) {
      const cat = it.category || "Uncategorized";
      sums[cat] = (sums[cat] ?? 0) + it.price;
      total += it.price;
    }
  }

  if (total === 0) return null;

  return Object.entries(sums)
    .map(([label, sum]): [string, number] => [label, Math.round((sum / total) * 100)])
    .filter(([, pct]) => pct > 0)
    .sort(([, a], [, b]) => b - a);
}

export default function Insights() {
  const insets = useSafeAreaInsets();
  const { subscribed, scans, frequency } = useApp();
  const [paywall, setPaywall] = useState(false);

  // Auto-close the paywall sheet when the user's subscription becomes active
  // (e.g. after a successful purchase completes).
  useEffect(() => {
    if (subscribed) setPaywall(false);
  }, [subscribed]);

  // When locked, we render a fixed skeleton instead of real data — see
  // SKELETON_* constants above. This avoids blurring near-empty real
  // content (dead space) and avoids real text rendering in the exact
  // spot the blur has to fully obscure (text-ghosting risk).
  const showSkeleton = !subscribed;

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
      .sort((a, b) => {
        // Prefer unit-price change for volatility ranking when available
        const aVal = Math.abs(a.unitPriceChange ?? a.pctChange);
        const bVal = Math.abs(b.unitPriceChange ?? b.pctChange);
        return bVal - aVal;
      })
      .slice(0, 5);
  }, [scans]);

  const categories = useMemo(() => computeCategories(scans), [scans]);

  // Projected next trip estimate
  const stats = useMemo(() => aggregateItems(scans), [scans]);
  const projectedNext = useMemo(() => nextTripEstimate(scans, stats), [scans, stats]);

  // Only show real data — never fabricate demo data for SUBSCRIBED users.
  // (Non-subscribed users see the fixed skeleton instead, handled separately.)
  const hasRealScans = scans.some((s) => s.source === "scan");
  const monthlyData = hasRealScans ? monthly : [];
  const volatileData: { key: string; name: string; pctChange: number; unitPrice?: number; unitMeasure?: string; isOutlier?: boolean }[] =
    volatile.length
      ? volatile
          .filter((v) => v.unitPriceChange != null)
          .map((v) => ({
            key: v.key,
            name: v.name,
            pctChange: v.unitPriceChange!,
            unitPrice: v.canonicalUnitPrice,
            unitMeasure: v.unitMeasure,
            isOutlier: v.isOutlier ?? false,
          }))
      : [];
  const categoryData = categories ?? null;

  // Month-over-month % changes for accessibility
  const momPcts = useMemo(() => {
    const pcts: (number | null)[] = [null]; // first month has no prior
    for (let i = 1; i < monthlyData.length; i++) {
      const prev = monthlyData[i - 1][1];
      const cur = monthlyData[i][1];
      pcts.push(prev > 0 ? ((cur - prev) / prev) * 100 : null);
    }
    return pcts;
  }, [monthlyData]);

  const showNationalAvg = monthlyData.length <= 1;

  // --- Max spend for chart scaling ---
  const maxSpend = Math.max(
    1,
    ...monthlyData.map(([, v]) => v),
    ...(showNationalAvg ? [NATIONAL_AVG_BASKET] : []),
    ...(projectedNext > 0 ? [projectedNext] : []),
  );

  // Build an accessible label for the chart
  const chartAccessibilityLabel = useMemo(() => {
    if (showSkeleton) return "Insights locked. Subscribe to see your monthly spend chart.";

    const parts = monthlyData.map(([k, v], i) => {
      const month = labelMonth(k);
      const mom = momPcts[i];
      if (mom !== null) {
        const dir = mom > 0 ? "up" : mom < 0 ? "down" : "flat";
        return `${month}: $${v.toFixed(0)}, ${dir} ${Math.abs(mom).toFixed(0)}% from prior`;
      }
      return `${month}: $${v.toFixed(0)}`;
    });

    // Identify the highest month from the user's actual data.
    let highestMonth = "";
    let highestVal = 0;
    for (const [k, v] of monthlyData) {
      if (v > highestVal) { highestVal = v; highestMonth = labelMonth(k); }
    }

    const extras: string[] = [];
    if (highestMonth) extras.push(`Highest month: ${highestMonth} at $${highestVal.toFixed(0)}`);
    if (projectedNext > 0) extras.push(`Projected: $${projectedNext.toFixed(0)}`);
    if (showNationalAvg) extras.push(`National average: $${NATIONAL_AVG_BASKET.toFixed(0)}`);

    return `Monthly spend chart. ${parts.join(". ")}. ${extras.join(". ")}`;
  }, [monthlyData, momPcts, projectedNext, showNationalAvg, showSkeleton]);

  return (
    <View style={styles.screen}>
      <ErrorBoundary>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 24,
          paddingTop: insets.top + 12,
          paddingBottom: insets.bottom + 120,
        }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.kicker}>INSIGHTS</Text>
        <Text style={styles.title}>Month over month</Text>

        {/* ── Monthly Impact Card ── */}
        {showSkeleton ? null : monthlyData.length >= 2 ? (
          (() => {
            const cur = monthlyData[monthlyData.length - 1];
            const prev = monthlyData[monthlyData.length - 2];
            const diff = cur[1] - prev[1];
            const diffPct = prev[1] > 0 ? ((diff / prev[1]) * 100) : 0;
            const isUp = diff > 0;
            return (
              <View style={styles.impactCard}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  {isUp ? (
                    <TrendingUp size={18} color={Colors.accent} strokeWidth={2} />
                  ) : (
                    <TrendingDown size={18} color={Colors.success} strokeWidth={2} />
                  )}
                  <Text style={styles.impactKicker}>MONTHLY IMPACT</Text>
                </View>
                <Text style={[styles.impactValue, { color: isUp ? Colors.accent : Colors.success }]}>
                  {isUp ? "+" : ""}{fmtUSD(Math.abs(diff))}
                </Text>
                <Text style={styles.impactSub}>
                  {isUp ? "Up" : "Down"} {Math.abs(diffPct).toFixed(1)}% from {labelMonth(prev[0])} to {labelMonth(cur[0])}
                </Text>
              </View>
            );
          })()
        ) : monthlyData.length === 1 ? (
          <View style={styles.impactCard}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <TrendingUp size={18} color={Colors.mutedForeground} strokeWidth={2} />
              <Text style={styles.impactKicker}>MONTHLY IMPACT</Text>
            </View>
            <Text style={styles.impactHint}>
              Scan one more month to compare your spend trend.
            </Text>
          </View>
        ) : null}

        <View style={{ position: "relative", marginTop: 32 }}>
          {/* Content — pointer-events disabled for non-subscribers */}
          <View style={{ pointerEvents: subscribed ? "auto" : "none" }}>

            {/* ── Monthly spend bar chart ── */}
            <View style={styles.card} accessibilityLabel={chartAccessibilityLabel}>
              <Text style={styles.cardKicker}>MONTHLY SPEND</Text>

              {showSkeleton ? (
                <View style={styles.chart}>
                  {SKELETON_BAR_HEIGHTS.map((h, i) => (
                    <View key={i} style={styles.barCol}>
                      <View style={styles.trendBadgeSpacer} />
                      <View style={styles.barTrack}>
                        <View style={[styles.bar, styles.skeletonBar, { height: `${h}%` }]} />
                      </View>
                      <Text style={styles.barLabel} numberOfLines={1}>
                        {SKELETON_MONTH_LABELS[i]}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : monthlyData.length === 0 ? (
                <View style={{ alignItems: "center", paddingVertical: 32 }}>
                  <Text style={styles.emptyHint}>
                    Scan your first receipt to start tracking your monthly grocery spend.
                  </Text>
                  <Pressable
                    onPress={() => router.push("/scan")}
                    style={({ pressed }) => [
                      styles.startScanBtn,
                      pressed && { transform: [{ scale: 0.97 }] },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="Start scanning receipts"
                  >
                    <Text style={styles.startScanBtnText}>START SCANNING</Text>
                    <ArrowRight size={16} color={Colors.accentForeground} />
                  </Pressable>
                </View>
              ) : (
                <>
              <View style={styles.legend}>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: Colors.accent }]} />
                  <Text style={styles.legendText}>Actual</Text>
                </View>
                {projectedNext > 0 && (
                  <View style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: Colors.mutedForeground, opacity: 0.5 }]} />
                    <Text style={styles.legendText}>Projected</Text>
                  </View>
                )}
                {showNationalAvg && (
                  <View style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: Colors.border, borderWidth: 1, borderColor: Colors.mutedForeground }]} />
                    <Text style={styles.legendText}>Nat'l Avg</Text>
                  </View>
                )}
              </View>
              <View style={styles.chart}>
                {/* National average ghost bar — only shown when 0-1 real months */}
                {showNationalAvg && (
                  <View key="natavg" style={styles.barCol} accessibilityLabel={`National average: $${NATIONAL_AVG_BASKET.toFixed(0)}`}>
                    <View style={styles.barTrack}>
                      <View
                        style={[
                          styles.bar,
                          styles.ghostBar,
                          { height: `${(NATIONAL_AVG_BASKET / maxSpend) * 100}%` },
                        ]}
                      />
                    </View>
                    <Text style={styles.barLabel} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                      NAT'L AVG
                    </Text>
                  </View>
                )}

                {monthlyData.map(([k, v], i) => {
                  const mom = momPcts[i];
                  const pctLabel = mom !== null ? ` (${mom > 0 ? "+" : ""}${mom.toFixed(0)}%)` : "";
                  return (
                    <View key={k} style={styles.barCol} accessibilityLabel={`${labelMonth(k)}: $${v.toFixed(0)}${pctLabel}`}>
                      {/* Trend Badge above bar */}
                      {mom !== null ? (
                        <Text
                          style={[
                            styles.trendBadge,
                            { color: mom > 0 ? Colors.accent : mom < 0 ? Colors.success : Colors.mutedForeground },
                          ]}
                          numberOfLines={1}
                        >
                          {mom > 0 ? "+" : ""}{mom.toFixed(0)}%
                        </Text>
                      ) : (
                        <View style={styles.trendBadgeSpacer} />
                      )}
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
                  );
                })}

                {/* Projected next month bar */}
                {projectedNext > 0 && (
                  <View key="proj" style={styles.barCol} accessibilityLabel={`Projected next month: $${projectedNext.toFixed(0)}`}>
                    <View style={styles.barTrack}>
                      <Animated.View
                        entering={FadeInDown.duration(500).delay(monthlyData.length * 60)}
                        style={[styles.bar, styles.projectedBar, { height: `${(projectedNext / maxSpend) * 100}%` }]}
                      />
                    </View>
                    <Text style={[styles.barLabel, styles.projectedLabel]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                      PROJ
                    </Text>
                  </View>
                )}
              </View>
                </>
              )}
            </View>

            {/* ── Most volatile ── */}
            <Text style={[styles.cardKicker, { marginTop: 28 }]}>MOST VOLATILE</Text>
            {showSkeleton ? (
              <View style={{ gap: 8, marginTop: 12 }}>
                {SKELETON_VOLATILE.map((v) => (
                  <View key={v.key} style={styles.volatileRow}>
                    <View style={styles.volatileLeft}>
                      <Text style={styles.volatileName}>{v.name}</Text>
                    </View>
                    <Text style={[styles.volatilePct, { color: pctColor(v.pctChange) }]}>
                      {v.pctChange > 0 ? "+" : ""}
                      {v.pctChange.toFixed(1)}%
                    </Text>
                  </View>
                ))}
              </View>
            ) : volatileData.length === 0 ? (
              <Text style={[styles.volatileSubtitle, { marginTop: 8 }]}>
                Scan more receipts to see which items are changing the most.
              </Text>
            ) : (
              <>
                <Text style={styles.volatileSubtitle}>Ranked by biggest price change per unit.</Text>
                <View style={{ gap: 8, marginTop: 12 }}>
                  {volatileData.map((v) => (
                <View key={v.key} style={[styles.volatileRow, v.isOutlier && styles.volatileRowOutlier]}>
                  <View style={styles.volatileLeft}>
                    <Text style={[styles.volatileName, v.isOutlier && { color: Colors.destructive }]}>
                      {v.name}
                    </Text>
                    {v.unitPrice != null && v.unitMeasure ? (
                      <Text style={styles.unitPriceLabel}>
                        {fmtUSD(v.unitPrice)}/{v.unitMeasure}
                      </Text>
                    ) : null}
                    {v.isOutlier && (
                      <View style={styles.outlierBadge}>
                        <AlertTriangle size={10} color={Colors.destructive} />
                        <Text style={styles.outlierText}>POTENTIAL DATA ERROR</Text>
                      </View>
                    )}
                  </View>
                  <Text style={[styles.volatilePct, { color: v.isOutlier ? Colors.destructive : pctColor(v.pctChange) }]}>
                    {v.pctChange > 0 ? "+" : ""}
                    {v.pctChange.toFixed(1)}%
                  </Text>
                </View>
              ))}
                </View>
              </>
            )}

            {/* ── Category breakdown ── */}
            <View style={[styles.card, { marginTop: 24 }]}>
              <Text style={styles.cardKicker}>CATEGORY BREAKDOWN</Text>
              {showSkeleton ? (
                <View style={{ gap: 14, marginTop: 16 }}>
                  {SKELETON_CATEGORIES.map(([label, pct]) => (
                    <View key={label}>
                      <View style={styles.catRow}>
                        <Text style={styles.catLabel}>{label}</Text>
                        <Text style={styles.catPct}>{pct}%</Text>
                      </View>
                      <View style={styles.catTrack}>
                        <View
                          style={[
                            styles.catFill,
                            { width: `${pct}%`, backgroundColor: CAT_COLORS[label] ?? Colors.mutedForeground },
                          ]}
                        />
                      </View>
                    </View>
                  ))}
                </View>
              ) : categoryData && categoryData.length > 0 ? (
                <>
                  <Text style={styles.volatileSubtitle}>AI-assigned from receipt line items</Text>
                  <View style={{ gap: 14, marginTop: 16 }}>
                    {categoryData.map(([label, pct]) => (
                      <View key={label}>
                        <View style={styles.catRow}>
                          <Text style={styles.catLabel}>{label}</Text>
                          <Text style={styles.catPct}>{pct}%</Text>
                        </View>
                        <View style={styles.catTrack}>
                          <View
                            style={[
                              styles.catFill,
                              { width: `${pct}%`, backgroundColor: CAT_COLORS[label] ?? Colors.mutedForeground },
                            ]}
                          />
                        </View>
                      </View>
                    ))}
                  </View>
                </>
              ) : (
                <View style={{ alignItems: "center", paddingVertical: 28 }}>
                  <Text style={[styles.emptyHint, { marginTop: 12 }]}>
                    Scan more receipts to see how your spend breaks down by category.
                  </Text>
                  <Pressable
                    onPress={() => router.push("/scan")}
                    style={({ pressed }) => [
                      styles.startScanBtn,
                      pressed && { transform: [{ scale: 0.97 }] },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="Start scanning receipts"
                  >
                    <Text style={styles.startScanBtnText}>START SCANNING</Text>
                    <ArrowRight size={16} color={Colors.accentForeground} />
                  </Pressable>
                </View>
              )}
            </View>
          </View>

          {/* ── Paywall blur overlay ── */}
          {!subscribed && (
            <BlurView intensity={55} tint="light" style={styles.lockOverlay}>
              <View style={styles.lockInner}>
                <Lock size={32} color={Colors.accent} />
                <Text style={styles.lockTitle}>Insights are locked.</Text>
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
      </ErrorBoundary>

      <PaywallSheet
        open={paywall && !subscribed}
        onClose={() => setPaywall(false)}
        reason="Insights are a paid feature"
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

  // Legend
  legend: { flexDirection: "row", gap: 16, marginTop: 10 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 999 },
  legendText: { fontSize: 10, fontFamily: Fonts.mono, color: Colors.mutedForeground },

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
  ghostBar: {
    backgroundColor: "transparent",
    borderWidth: 1.5,
    borderColor: Colors.mutedForeground,
  },
  projectedBar: {
    backgroundColor: Colors.mutedForeground,
    opacity: 0.45,
  },
  skeletonBar: {
    backgroundColor: Colors.mutedForeground,
    opacity: 0.3,
  },
  barLabel: {
    fontFamily: Fonts.mono,
    fontSize: 9,
    letterSpacing: 0.5,
    color: Colors.mutedForeground,
    maxWidth: 44,
  },
  projectedLabel: {
    color: Colors.mutedForeground,
    opacity: 0.6,
  },

  // Volatile rows
  volatileSubtitle: {
    marginTop: 2,
    fontFamily: Fonts.regular,
    fontSize: 11,
    color: Colors.mutedForeground,
  },
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
  volatileRowOutlier: {
    borderColor: Colors.destructive,
    borderWidth: 1.5,
    backgroundColor: "rgba(230,180,0,0.08)",
  },
  volatileLeft: { flex: 1, gap: 3 },
  volatileName: {
    fontFamily: Fonts.bold,
    fontSize: 14,
    color: Colors.foreground,
  },
  unitPriceLabel: {
    fontFamily: Fonts.mono,
    fontSize: 11,
    color: Colors.mutedForeground,
  },
  volatilePct: {
    fontFamily: Fonts.monoMedium,
    fontSize: 14,
  },

  // Outlier badge
  outlierBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 2,
  },
  outlierText: {
    fontFamily: Fonts.mono,
    fontSize: 9,
    color: Colors.destructive,
    letterSpacing: 0.3,
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
  catFill: { height: "100%", borderRadius: 999 },

  // Empty state
  emptyHint: {
    fontSize: 13,
    fontFamily: Fonts.regular,
    color: Colors.mutedForeground,
    textAlign: "center",
    lineHeight: 18,
    maxWidth: 240,
  },
  startScanBtn: {
    marginTop: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 44,
    paddingHorizontal: 20,
    borderRadius: 999,
    backgroundColor: Colors.accent,
    shadowColor: Colors.accent,
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  startScanBtnText: {
    fontFamily: Fonts.bold,
    fontSize: 13,
    letterSpacing: 0.5,
    color: Colors.accentForeground,
  },

  // ── Monthly Impact Card ──
  impactCard: {
    marginTop: 24,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    padding: 20,
  },
  impactKicker: {
    fontFamily: Fonts.mono,
    fontSize: 10,
    letterSpacing: 1.2,
    color: Colors.mutedForeground,
  },
  impactValue: {
    marginTop: 10,
    fontFamily: Fonts.extrabold,
    fontSize: 36,
    letterSpacing: -1.2,
    fontVariant: ["tabular-nums"],
  },
  impactSub: {
    marginTop: 4,
    fontFamily: Fonts.regular,
    fontSize: 13,
    color: Colors.mutedForeground,
  },
  impactHint: {
    marginTop: 10,
    fontFamily: Fonts.regular,
    fontSize: 13,
    color: Colors.mutedForeground,
    lineHeight: 18,
  },

  // ── Trend Badge ──
  trendBadge: {
    fontFamily: Fonts.monoMedium,
    fontSize: 9,
    letterSpacing: 0.3,
    marginBottom: 4,
    textAlign: "center" as const,
  },
  trendBadgeSpacer: { height: 16 },

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