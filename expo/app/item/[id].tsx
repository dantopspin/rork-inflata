import { router, useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";
import { Alert, Platform } from "react-native";
import { AlertTriangle, ArrowLeft, ArrowRight, Lock, MapPin, Ruler, Share2, Shuffle, Star, TrendingUp } from "lucide-react-native";
import { useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ConfidenceBadge } from "@/components/ConfidenceBadge";
import { PaywallSheet } from "@/components/PaywallSheet";
import { ItemSpikeCard } from "@/components/ShareCard";
import { Sparkline } from "@/components/Sparkline";
import { captureAndShare } from "@/lib/share";
import { Colors, Fonts, Radius } from "@/constants/theme";
import { fmtDate, fmtDateLong, fmtPct, fmtUSD } from "@/lib/format";
import { aggregateItems, detectShrinkflation, itemConfidence, withOverspend } from "@/lib/inflation";
import { useApp } from "@/providers/AppProvider";
import { View as RNView } from "react-native";
import { ItemStat } from "@/types";

/** Group item keys into food categories for smart substitution suggestions. */
const CATEGORY_MAP: Record<string, string> = {
  eggs: "protein",
  "chicken-breast": "protein",
  "ground-beef": "protein",
  milk: "dairy",
  butter: "dairy",
  cheddar: "dairy",
  yogurt: "dairy",
  bananas: "produce",
  avocado: "produce",
  apple: "produce",
  bread: "grains",
  pasta: "grains",
  "orange-juice": "beverages",
  coffee: "beverages",
};

function getCategory(key: string): string {
  return CATEGORY_MAP[key] ?? "other";
}

/** Find cheaper alternatives in the same food category from the user\'s history. */
function findAlternatives(current: ItemStat, allStats: ItemStat[]): ItemStat[] {
  const cat = getCategory(current.key);
  return allStats
    .filter(
      (s) =>
        s.key !== current.key &&
        getCategory(s.key) === cat &&
        s.currentPrice < current.currentPrice &&
        s.appearances >= 2,
    )
    .sort((a, b) => a.currentPrice - b.currentPrice)
    .slice(0, 2);
}

export default function ItemDetail() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { hydrated, scans, frequency, subscribed, watchlist, toggleWatchlist } = useApp();

  const stat = useMemo(() => {
    const stats = withOverspend(aggregateItems(scans), frequency);
    return stats.find((s) => s.key === id);
  }, [scans, frequency, id]);

  const [paywall, setPaywall] = useState<boolean>(false);
  const cardRef = useRef<RNView>(null);
  const hapticFired = useRef<boolean>(false);

  // All item stats for cross-item comparison (smart substitution)
  const allStats = useMemo(() => withOverspend(aggregateItems(scans), frequency), [scans, frequency]);

  // Find cheaper alternatives in the same food category when price spikes
  const alternatives = useMemo(() => {
    if (!stat || stat.pctChange <= 10) return [];
    return findAlternatives(stat, allStats);
  }, [stat, allStats]);

  // Compute the savings per trip if there is a cheaper store
  const savingsPerTrip = useMemo(() => {
    if (!stat || stat.cheapestPrice == null || stat.cheapestPrice >= stat.currentPrice) return null;
    return stat.currentPrice - stat.cheapestPrice;
  }, [stat]);

  // Find the index of the biggest jump date in the (sorted) history array
  const biggestJumpIndex = useMemo(() => {
    if (!stat?.biggestJumpDate || !stat.history.length) return -1;
    return stat.history.findIndex((h) => h.date === stat.biggestJumpDate);
  }, [stat]);

  // Shrinkflation detection: unit price went up while raw price stayed flat
  const isShrinkflation = useMemo(() => (stat ? detectShrinkflation(stat) : false), [stat]);

  // Unit price history entries (only those with known quantity)
  const unitPriceEntries = useMemo(
    () => stat?.history.filter((h) => h.canonicalUnitPrice != null) ?? [],
    [stat],
  );

  // Unit price change percentage (first real → last)
  const unitPriceChange = useMemo(() => {
    if (unitPriceEntries.length < 2) return null;
    // Anchor to the first REAL unit entry so a synthetic baseline estimate
    // doesn't skew the percentage.
    const firstReal = unitPriceEntries.find((h) => !h.fromBaseline);
    const anchor = firstReal ?? unitPriceEntries[0];
    const first = anchor.canonicalUnitPrice!;
    const last = unitPriceEntries[unitPriceEntries.length - 1].canonicalUnitPrice!;
    if (first <= 0) return null;
    return ((last - first) / first) * 100;
  }, [unitPriceEntries]);

  if (!hydrated) return <View style={styles.screen} />;

  if (!stat) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + 24, paddingHorizontal: 24 }]}>
        <Text style={styles.kicker}>NOT TRACKED</Text>
        <Text style={styles.notFound}>Item not found</Text>
        <Pressable onPress={() => router.replace("/(tabs)")}>
          <Text style={styles.backLink}>Back to dashboard</Text>
        </Pressable>
      </View>
    );
  }

  const conf = itemConfidence(stat);

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 24, paddingTop: insets.top + 8, paddingBottom: insets.bottom + 48 }}
        showsVerticalScrollIndicator={false}
      >
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <ArrowLeft size={14} color={Colors.mutedForeground} />
          <Text style={styles.backBtnText}>DASHBOARD</Text>
        </Pressable>

        {/* Star toggle — pin to top of watchlist */}
        <Pressable
          onPress={() => {
            if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            toggleWatchlist(id);
          }}
          hitSlop={8}
          accessibilityLabel={watchlist.includes(id) ? "Unpin from top" : "Pin to top"}
          accessibilityRole="button"
          style={styles.starBtn}
        >
          <Star
            size={20}
            color={watchlist.includes(id) ? Colors.amber : Colors.mutedForeground}
            fill={watchlist.includes(id) ? Colors.amber : "none"}
            strokeWidth={2}
          />
        </Pressable>

        {/* Savings Mission Badge */}
        {savingsPerTrip != null ? (
          <View style={styles.missionBadge}>
            <TrendingUp size={14} color={Colors.success} strokeWidth={2.5} />
            <Text style={styles.missionText}>
              GOAL: SAVE {fmtUSD(savingsPerTrip)} PER TRIP
            </Text>
          </View>
        ) : null}

        <Text style={styles.name}>{stat.name}</Text>
        <Text style={styles.since}>
          {fmtPct(stat.pctChange)} since {fmtDateLong(stat.firstDate)}
        </Text>
        <Text style={styles.pocket}>
          That&apos;s <Text style={styles.bold}>{fmtUSD(stat.cumulativeOverspend)}</Text> more out of
          your pocket projected over the next 30 days.
        </Text>

        <View style={{ marginTop: 16, gap: 8 }}>
          <ConfidenceBadge c={conf} />
          {stat.firstFromBaseline ? (
            <Text style={styles.baselineLabel}>ESTIMATED BASELINE — BASED ON YOUR SETUP</Text>
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardKicker}>PRICE HISTORY</Text>
          <View style={{ marginTop: 12 }}>
            <View>
              <Sparkline prices={stat.history.map((h) => h.price)} height={96} strokeWidth={2.5} />
              {/* Biggest Jump vertical marker */}
              {biggestJumpIndex >= 0 && stat.history.length > 1 ? (
                <View
                  style={[
                    styles.jumpMarker,
                    { left: `${(biggestJumpIndex / (stat.history.length - 1)) * 100}%` },
                  ]}
                >
                  <View style={styles.jumpMarkerLine} />
                  <View style={styles.jumpMarkerDot} />
                </View>
              ) : null}
            </View>
          </View>
          <View style={styles.firstLatest}>
            <View>
              <Text style={styles.flLabel}>FIRST</Text>
              <Text style={styles.flValue}>{fmtUSD(stat.firstPrice)}</Text>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={styles.flLabel}>LATEST</Text>
              <Text style={styles.flValue}>{fmtUSD(stat.currentPrice)}</Text>
            </View>
          </View>
          {stat.biggestJumpDate ? (
            <Text style={styles.jump}>
              Biggest single jump:{" "}
              <Text style={styles.jumpAccent}>{fmtPct(stat.biggestJumpPct ?? 0)}</Text> on{" "}
              {fmtDate(stat.biggestJumpDate)}.
            </Text>
          ) : null}
        </View>

        {/* ===== LOW CONFIDENCE UNIT-PRICE WARNING ===== */}
        {stat.unitPriceConfidence === "low" && unitPriceEntries.length >= 2 ? (
          <View style={[styles.card, { marginTop: 24, borderColor: Colors.amber, borderWidth: 1.5 }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <AlertTriangle size={14} color={Colors.amber} strokeWidth={2.5} />
              <Text style={[styles.cardKicker, { color: Colors.amber }]}>
                LOW CONFIDENCE — VERIFY UNITS
              </Text>
            </View>
            <Text style={styles.shrinkBody}>
              The unit-price data for {stat.name} is incomplete or inconsistent. Some scans may be missing
              quantity information (e.g., oz, ct). Tap each price entry below and confirm the correct
              unit size so your inflation math stays accurate.
            </Text>
          </View>
        ) : null}

        {/* ===== SHRINKFLATION WARNING ===== */}
        {isShrinkflation ? (
          <View style={[styles.card, { marginTop: 24, borderColor: Colors.amber, borderWidth: 1.5 }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <AlertTriangle size={14} color={Colors.amber} strokeWidth={2.5} />
              <Text style={[styles.cardKicker, { color: Colors.amber }]}>
                SHRINKFLATION DETECTED
              </Text>
            </View>
            <Text style={styles.shrinkBody}>
              The sticker price for {stat.name} has stayed nearly flat, but the{" "}
              <Text style={{ fontFamily: Fonts.bold, color: Colors.amber }}>price per unit</Text>{" "}
              has risen {unitPriceChange != null ? fmtPct(unitPriceChange) : ""}.{" "}
              You&apos;re paying the same for less product.
            </Text>
          </View>
        ) : null}

        {/* ===== UNIT PRICE TREND ===== */}
        {unitPriceEntries.length >= 2 ? (
          <View style={[styles.card, { marginTop: 24 }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <Ruler size={12} color={Colors.mutedForeground} strokeWidth={2} />
              <Text style={styles.cardKicker}>PRICE PER UNIT</Text>
              {stat.unitMeasure ? (
                <Text style={styles.unitLabel}>per {stat.unitMeasure}</Text>
              ) : null}
            </View>
            <View style={{ marginTop: 12 }}>
              <Sparkline
                prices={unitPriceEntries.map((h) => h.canonicalUnitPrice!)}
                height={72}
                strokeWidth={2}
                stroke={Colors.amber}
              />
            </View>
            <View style={styles.firstLatest}>
              <View>
                <Text style={styles.flLabel}>FIRST</Text>
                <Text style={styles.flValue}>
                  {fmtUSD(unitPriceEntries[0].canonicalUnitPrice!)}
                </Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={styles.flLabel}>LATEST</Text>
                <Text style={styles.flValue}>
                  {fmtUSD(unitPriceEntries[unitPriceEntries.length - 1].canonicalUnitPrice!)}
                </Text>
              </View>
            </View>
            {unitPriceChange != null ? (
              <Text style={[styles.jump, { marginTop: 10 }]}>
                Unit price change:{" "}
                <Text style={{ fontFamily: Fonts.bold, color: unitPriceChange > 0 ? Colors.accent : Colors.success }}>
                  {fmtPct(unitPriceChange)}
                </Text>
              </Text>
            ) : null}
          </View>
        ) : null}

        {/* Best Price Found At — store-to-store arbitrage */}
        {stat.cheapestPrice !== undefined && stat.cheapestStore ? (
          <View
            style={[styles.card, { marginTop: 24 }]}
            onLayout={() => {
              if (!hapticFired.current && Platform.OS !== "web") {
                hapticFired.current = true;
                Haptics.selectionAsync();
              }
            }}
          >
            <Text style={styles.cardKicker}>BEST PRICE FOUND AT</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 }}>
              <MapPin size={14} color={Colors.accent} strokeWidth={1.8} />
              <Text style={styles.cheapestLabel}>{stat.cheapestStore}</Text>
            </View>
            <Text style={styles.cheapestPrice}>{fmtUSD(stat.cheapestPrice)}</Text>
            {stat.cheapestPrice < stat.currentPrice ? (
              <Text style={styles.savingsNote}>
                You&apos;re paying {fmtUSD(stat.currentPrice - stat.cheapestPrice)} more at your current store —{" "}
                that&apos;s {((stat.currentPrice - stat.cheapestPrice) / stat.cheapestPrice * 100).toFixed(0)}% above the best price found.
              </Text>
            ) : null}

            {/* SHOP HERE NEXT button */}
            {stat.cheapestPrice < stat.currentPrice ? (
              <Pressable
                style={({ pressed }) => [
                  styles.shopHereBtn,
                  pressed && { transform: [{ scale: 0.98 }] },
                ]}
                onPress={() => {
                  Alert.alert(
                    `Shop at ${stat.cheapestStore}`,
                    `Look for ${stat.name} at ${fmtUSD(stat.cheapestPrice!)}. The best price we've tracked was at ${stat.cheapestStore}.`,
                    [{ text: "Got it", style: "default" }],
                  );
                }}
              >
                <Text style={styles.shopHereBtnText}>SHOP HERE NEXT</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {/* Substitution suggestion for highly volatile items */}
        {stat.pctChange > 20 ? (
          <View style={styles.subFooter}>
            <Text style={styles.subFooterText}>
              Prices for this item are volatile. Consider a generic brand or buying in bulk next trip.
            </Text>
            {alternatives.length > 0 ? (
              <View style={styles.altSection}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Shuffle size={12} color={Colors.success} strokeWidth={2.5} />
                  <Text style={styles.altKicker}>SMART SUBSTITUTION</Text>
                </View>
                {alternatives.map((alt) => (
                  <Pressable
                    key={alt.key}
                    style={({ pressed }) => [
                      styles.altRow,
                      pressed && { backgroundColor: Colors.muted },
                    ]}
                    onPress={() =>
                      Alert.alert(
                        `Switch to ${alt.name}`,
                        `You last paid ${fmtUSD(alt.currentPrice)} for ${alt.name} — that's ${fmtUSD(stat.currentPrice - alt.currentPrice)} less than ${stat.name}. Consider swapping on your next trip.`,
                        [
                          { text: "Got it", style: "default" },
                          { text: `View ${alt.name}`, onPress: () => router.replace(`/item/${alt.key}`) },
                        ],
                      )
                    }
                    accessibilityRole="button"
                    accessibilityLabel={`Switch to ${alt.name} at ${fmtUSD(alt.currentPrice)}`}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.altName}>{alt.name}</Text>
                      <Text style={styles.altMeta}>
                        You last paid {fmtUSD(alt.currentPrice)}
                        {alt.cheapestStore ? ` • Best at ${alt.cheapestStore}` : ""}
                      </Text>
                    </View>
                    <View style={{ alignItems: "flex-end" }}>
                      <Text style={styles.altSavings}>
                        SAVE {fmtUSD(stat.currentPrice - alt.currentPrice)}
                      </Text>
                      <ArrowRight size={12} color={Colors.success} strokeWidth={2.5} />
                    </View>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}

        <View style={{ marginTop: 32 }}>
          <Text style={styles.cardKicker}>ALL RECORDED PRICES</Text>
          <View style={{ marginTop: 8 }}>
            {[...stat.history].reverse().map((h, i) => (
              <View key={i} style={styles.histRow}>
                <Text style={styles.histPrice}>{fmtUSD(h.price)}</Text>
                <Text style={styles.histMeta}>
                  {fmtDate(h.date).toUpperCase()}
                  {h.fromBaseline ? " • ESTIMATED BASELINE" : ""}
                </Text>
              </View>
            ))}
          </View>
        </View>

        <Pressable
          onPress={() => {
            if (!subscribed) setPaywall(true);
            else captureAndShare(cardRef, `My ${stat.name} is up ${fmtPct(stat.pctChange)} — tracked with Inflata.`);
          }}
          style={({ pressed }) => [
            subscribed ? styles.shareBtn : styles.lockBtn,
            pressed && { transform: [{ scale: 0.99 }] },
          ]}
        >
          {subscribed ? (
            <Share2 size={16} color={Colors.accentForeground} />
          ) : (
            <Lock size={16} color={Colors.foreground} />
          )}
          <Text style={subscribed ? styles.shareBtnText : styles.lockBtnText}>
            {subscribed ? "SHARE SPIKE CARD" : "UNLOCK SPIKE CARD"}
          </Text>
        </Pressable>

        {subscribed ? (
          <View style={{ marginTop: 24, alignItems: "center" }}>
            <ItemSpikeCard ref={cardRef} stat={stat} sinceLabel={fmtDateLong(stat.firstDate)} />
          </View>
        ) : null}
      </ScrollView>

      <PaywallSheet open={paywall} onClose={() => setPaywall(false)} reason="Share unlocks with paid" />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  kicker: { fontFamily: Fonts.mono, fontSize: 10, letterSpacing: 1.5, color: Colors.mutedForeground },
  notFound: { marginTop: 8, fontFamily: Fonts.extrabold, fontSize: 24, letterSpacing: -0.6, color: Colors.foreground },
  backLink: { marginTop: 16, fontFamily: Fonts.bold, fontSize: 14, color: Colors.accent },
  backBtn: { flexDirection: "row", alignItems: "center", gap: 5 },
  backBtnText: { fontFamily: Fonts.bold, fontSize: 10, letterSpacing: 1, color: Colors.mutedForeground },

  /* Star toggle */
  starBtn: { alignSelf: "flex-start", marginBottom: 6, padding: 4 },

  /* Savings Mission Badge */
  missionBadge: {
    marginTop: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "flex-start",
    backgroundColor: Colors.successSoft,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.success,
  },
  missionText: {
    fontFamily: Fonts.bold,
    fontSize: 12.5,
    letterSpacing: 0.3,
    color: Colors.success,
  },

  name: { marginTop: 24, fontFamily: Fonts.extrabold, fontSize: 36, lineHeight: 40, letterSpacing: -1.2, color: Colors.foreground },
  since: { marginTop: 8, fontFamily: Fonts.bold, fontSize: 16, color: Colors.accent },
  pocket: { marginTop: 6, fontSize: 14, lineHeight: 20, color: Colors.foreground, fontFamily: Fonts.regular },
  bold: { fontFamily: Fonts.extrabold },
  baselineLabel: { fontFamily: Fonts.mono, fontSize: 9.5, letterSpacing: 1, color: Colors.mutedForeground },
  card: {
    marginTop: 32,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    padding: 20,
  },
  cardKicker: { fontFamily: Fonts.mono, fontSize: 10, letterSpacing: 1.5, color: Colors.mutedForeground },

  /* Biggest Jump vertical marker */
  jumpMarker: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 2,
    alignItems: "center",
  },
  jumpMarkerLine: {
    position: "absolute",
    top: 0,
    bottom: 12,
    width: 2,
    backgroundColor: Colors.accent,
    opacity: 0.5,
  },
  jumpMarkerDot: {
    position: "absolute",
    bottom: 4,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.accent,
  },

  firstLatest: { marginTop: 12, flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" },
  flLabel: { fontFamily: Fonts.mono, fontSize: 9.5, letterSpacing: 0.5, color: Colors.mutedForeground },
  flValue: { marginTop: 2, fontFamily: Fonts.bold, fontSize: 18, color: Colors.foreground, fontVariant: ["tabular-nums"] },
  jump: { marginTop: 12, fontSize: 12.5, color: Colors.mutedForeground, fontFamily: Fonts.regular },
  jumpAccent: { fontFamily: Fonts.bold, color: Colors.accent },
  histRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  histPrice: { fontFamily: Fonts.semibold, fontSize: 14, color: Colors.foreground, fontVariant: ["tabular-nums"] },
  histMeta: { fontFamily: Fonts.mono, fontSize: 9.5, letterSpacing: 0.5, color: Colors.mutedForeground },

  /* SHOP HERE NEXT button */
  shopHereBtn: {
    marginTop: 16,
    height: 48,
    borderRadius: Radius.full,
    borderWidth: 1.5,
    borderColor: Colors.success,
    alignItems: "center",
    justifyContent: "center",
  },
  shopHereBtnText: {
    fontFamily: Fonts.bold,
    fontSize: 12.5,
    letterSpacing: 0.8,
    color: Colors.success,
  },

  /* Substitution footer */
  subFooter: {
    marginTop: 24,
    paddingHorizontal: 4,
  },
  subFooterText: {
    fontFamily: Fonts.regular,
    fontSize: 12.5,
    lineHeight: 18,
    color: Colors.mutedForeground,
  },
  /* Smart substitution alternatives */
  altSection: {
    marginTop: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: 14,
    gap: 10,
  },
  altKicker: {
    fontFamily: Fonts.mono,
    fontSize: 10,
    letterSpacing: 1,
    color: Colors.success,
    textTransform: "uppercase" as const,
  },
  altRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: 14,
  },
  altName: {
    fontFamily: Fonts.bold,
    fontSize: 14,
    letterSpacing: -0.3,
    color: Colors.foreground,
  },
  altMeta: {
    marginTop: 3,
    fontFamily: Fonts.mono,
    fontSize: 10,
    letterSpacing: 0.3,
    color: Colors.mutedForeground,
  },
  altSavings: {
    fontFamily: Fonts.bold,
    fontSize: 11,
    letterSpacing: 0.3,
    color: Colors.success,
  },

  cheapestLabel: { fontFamily: Fonts.bold, fontSize: 14, letterSpacing: -0.3, color: Colors.foreground },
  cheapestPrice: {
    marginTop: 6,
    fontFamily: Fonts.extrabold,
    fontSize: 28,
    letterSpacing: -0.8,
    color: Colors.accent,
    fontVariant: ["tabular-nums"],
  },
  savingsNote: { marginTop: 8, fontSize: 12.5, lineHeight: 18, color: Colors.mutedForeground, fontFamily: Fonts.regular },

  /* Shrinkflation warning */
  shrinkBody: {
    fontFamily: Fonts.regular,
    fontSize: 13,
    lineHeight: 19,
    color: Colors.mutedForeground,
  },
  unitLabel: {
    fontFamily: Fonts.mono,
    fontSize: 9.5,
    letterSpacing: 0.5,
    color: Colors.mutedForeground,
  },

  shareBtn: {
    marginTop: 32,
    height: 52,
    borderRadius: 999,
    backgroundColor: Colors.accent,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    shadowColor: Colors.accent,
    shadowOpacity: 0.3,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  shareBtnText: { fontFamily: Fonts.bold, fontSize: 13, letterSpacing: 0.5, color: Colors.accentForeground },
  lockBtn: {
    marginTop: 32,
    height: 52,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.borderStrong,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  lockBtnText: { fontFamily: Fonts.bold, fontSize: 13, letterSpacing: 0.5, color: Colors.foreground },
});
