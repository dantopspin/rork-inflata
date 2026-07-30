import { router, useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";
import { Alert, Modal, Platform, Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { AlertTriangle, ArrowLeft, ArrowRight, ChevronDown, Lock, MapPin, Ruler, Share2, Shuffle, Star, Store, TrendingDown, TrendingUp } from "lucide-react-native";
import { memo, useMemo, useRef, useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeIn, SlideInUp } from "react-native-reanimated";

import { ConfidenceBadge } from "@/components/ConfidenceBadge";
import { PaywallSheet } from "@/components/PaywallSheet";
import { PriceChart } from "@/components/PriceChart";
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

  const allStats = useMemo(() => withOverspend(aggregateItems(scans), frequency), [scans, frequency]);

  const stat = useMemo(() => allStats.find((s) => s.key === id) ?? null, [allStats, id]);

  const [paywall, setPaywall] = useState<boolean>(false);
  const [storeFilter, setStoreFilter] = useState<string>("ALL");
  const [storeFilterOpen, setStoreFilterOpen] = useState<boolean>(false);
  const cardRef = useRef<RNView>(null);
  const hapticFired = useRef<boolean>(false);

  // Weekly price change: compares the latest price to the price ~7 days prior.
  // Falls back to the earliest entry if no data point is at least a week old.
  const weeklyChange = useMemo(() => {
    if (!stat || stat.history.length < 2) return null;
    const sorted = [...stat.history].sort((a, b) => a.date.localeCompare(b.date));
    const latest = sorted[sorted.length - 1];
    const latestMs = new Date(latest.date).getTime();
    const weekAgo = latestMs - 7 * 24 * 60 * 60 * 1000;
    let anchor: { price: number } | null = null;
    for (let i = sorted.length - 2; i >= 0; i--) {
      if (new Date(sorted[i].date).getTime() <= weekAgo) {
        anchor = sorted[i];
        break;
      }
    }
    if (!anchor) anchor = sorted[0];
    if (anchor.price <= 0) return null;
    return ((latest.price - anchor.price) / anchor.price) * 100;
  }, [stat]);

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
  // Unique stores from this item's price history — for the retailer filter.
  const uniqueStores = useMemo(() => {
    const set = new Set<string>();
    for (const h of stat?.history ?? []) set.add(h.store);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [stat]);

  // Filtered price history based on the selected retailer.
  const filteredHistory = useMemo(() => {
    if (!stat) return [];
    const list = storeFilter === "ALL"
      ? [...stat.history]
      : stat.history.filter((h) => h.store === storeFilter);
    return list.reverse();
  }, [stat, storeFilter]);

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

  // Build a clean, copy-pasteable text summary of this item's price
  // findings for sharing to messaging apps. Kept plain-text so it pastes
  // cleanly into iMessage, WhatsApp, Slack, etc.
  const buildShareText = (): string => {
    if (!stat) return "";
    const dir = stat.pctChange > 0 ? "up" : stat.pctChange < 0 ? "down" : "flat";
    const lines: string[] = [
      `${stat.name} — price tracking summary`,
      ``,
      `First recorded: ${fmtUSD(stat.firstPrice)} (${fmtDateLong(stat.firstDate)})`,
      `Latest: ${fmtUSD(stat.currentPrice)} (${fmtDateLong(stat.currentDate)})`,
      `Change: ${fmtPct(stat.pctChange)} (${dir})`,
      `Out of pocket: ${stat.dollarChange >= 0 ? "+" : ""}${fmtUSD(stat.dollarChange)} vs first`,
    ];
    if (stat.cheapestStore && stat.cheapestPrice != null) {
      lines.push(`Cheapest found at: ${stat.cheapestStore} — ${fmtUSD(stat.cheapestPrice)}`);
    }
    if (stat.biggestJumpDate && stat.biggestJumpPct) {
      lines.push(`Biggest single jump: ${fmtPct(stat.biggestJumpPct)} on ${fmtDate(stat.biggestJumpDate)}`);
    }
    if (stat.history.length > 2) {
      lines.push(``, `All recorded prices:`);
      for (const h of [...stat.history].reverse()) {
        lines.push(`  ${fmtDate(h.date)} — ${fmtUSD(h.price)} @ ${h.store}${h.fromBaseline ? " (estimated)" : ""}`);
      }
    }
    lines.push(``, `Tracked with Inflata.`);
    return lines.join("\n");
  };

  const shareTextSummary = async () => {
    if (!stat) return;
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await Share.share({
        message: buildShareText(),
        title: `${stat.name} — price history`,
      });
    } catch {
      // user cancelled — no-op
    }
  };

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

        <View style={styles.nameRow}>
          <Text style={styles.name}>{stat.name}</Text>
          {weeklyChange != null ? (
            <View
              style={[
                styles.weeklyBadge,
                { backgroundColor: weeklyChange > 0 ? "rgba(245,72,27,0.10)" : weeklyChange < 0 ? "rgba(16,185,129,0.12)" : Colors.muted },
              ]}
            >
              {weeklyChange > 0 ? (
                <TrendingUp size={9} color={Colors.accent} strokeWidth={2.5} />
              ) : weeklyChange < 0 ? (
                <TrendingDown size={9} color={Colors.success} strokeWidth={2.5} />
              ) : null}
              <Text
                style={[
                  styles.weeklyBadgeText,
                  { color: weeklyChange > 0 ? Colors.accent : weeklyChange < 0 ? Colors.success : Colors.mutedForeground },
                ]}
              >
                {fmtPct(weeklyChange)} vs last wk
              </Text>
            </View>
          ) : null}
        </View>
        <Text style={[styles.since, { color: stat.pctChange > 0 ? Colors.accent : stat.pctChange < 0 ? Colors.success : Colors.mutedForeground }]}>
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
            <PriceChart
              data={stat.history.map((h) => ({ date: h.date, price: h.price, fromBaseline: h.fromBaseline }))}
              height={160}
              stroke={stat.pctChange > 0 ? Colors.accent : stat.pctChange < 0 ? Colors.success : Colors.accent}
            />
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
          {/* Lowest price summary header — absolute cheapest across all stores */}
          {stat.cheapestPrice != null && stat.cheapestStore ? (
            <View style={styles.lowestHeader}>
              <View style={styles.lowestIconWrap}>
                <TrendingDown size={14} color={Colors.success} strokeWidth={2.5} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.lowestKicker}>LOWEST PRICE FOUND</Text>
                <Text style={styles.lowestValue}>
                  {fmtUSD(stat.cheapestPrice)}{" "}
                  <Text style={styles.lowestStore}>at {stat.cheapestStore}</Text>
                </Text>
              </View>
            </View>
          ) : null}
          <View style={styles.histHeader}>
            <Text style={styles.cardKicker}>ALL RECORDED PRICES</Text>
            {uniqueStores.length > 1 ? (
              <Pressable
                onPress={() => {
                  if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setStoreFilterOpen(true);
                }}
                style={({ pressed }) => [
                  styles.storeFilterBtn,
                  pressed && { opacity: 0.6 },
                ]}
                accessibilityRole="button"
                accessibilityLabel={`Filter by retailer, currently ${storeFilter === "ALL" ? "all stores" : storeFilter}`}
              >
                <Store size={11} color={Colors.accent} strokeWidth={2} />
                <Text style={styles.storeFilterText}>
                  {storeFilter === "ALL" ? "ALL STORES" : storeFilter.toUpperCase()}
                </Text>
                <ChevronDown size={11} color={Colors.mutedForeground} strokeWidth={2.5} />
              </Pressable>
            ) : null}
          </View>
          <View style={{ marginTop: 8 }}>
            {filteredHistory.length === 0 ? (
              <Text style={styles.histEmpty}>
                No prices recorded at {storeFilter} yet.
              </Text>
            ) : (
              filteredHistory.map((h, i) => (
                <View key={i} style={styles.histRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.histPrice}>{fmtUSD(h.price)}</Text>
                    <Text style={styles.histMeta}>
                      {fmtDate(h.date).toUpperCase()}
                      {h.fromBaseline ? " • ESTIMATED BASELINE" : ""}
                    </Text>
                  </View>
                  {uniqueStores.length > 1 && storeFilter === "ALL" ? (
                    <Text style={styles.histStore}>{h.store}</Text>
                  ) : null}
                </View>
              ))
            )}
          </View>
        </View>

        {/* Share text summary — clean, copy-pasteable price findings for any messaging app */}
        <Pressable
          onPress={shareTextSummary}
          style={({ pressed }) => [
            styles.textShareBtn,
            pressed && { transform: [{ scale: 0.99 }] },
          ]}
          accessibilityRole="button"
          accessibilityLabel={`Share ${stat.name} price summary as text`}
        >
          <Share2 size={15} color={Colors.foreground} strokeWidth={2} />
          <Text style={styles.textShareBtnText}>SHARE PRICE SUMMARY</Text>
        </Pressable>

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

      {/* ── Retailer filter modal for price history ── */}
      <StoreFilterModal
        visible={storeFilterOpen}
        current={storeFilter}
        stores={uniqueStores}
        onSelect={(s) => {
          setStoreFilter(s);
          setStoreFilterOpen(false);
          if (Platform.OS !== "web") Haptics.selectionAsync();
        }}
        onClose={() => setStoreFilterOpen(false)}
      />
    </View>
  );
}

// ─────────────────────────────────────────────
// Store Filter Modal
// ─────────────────────────────────────────────

const StoreFilterModal = memo(function StoreFilterModal({
  visible,
  current,
  stores,
  onSelect,
  onClose,
}: {
  visible: boolean;
  current: string;
  stores: string[];
  onSelect: (s: string) => void;
  onClose: () => void;
}) {
  const options = ["ALL", ...stores];
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <Animated.View entering={FadeIn.duration(180)} style={filterStyles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>
      <View style={filterStyles.anchor} pointerEvents="box-none">
        <Animated.View
          entering={SlideInUp.springify().dampingRatio(0.7).stiffness(280)}
          style={filterStyles.sheet}
        >
          <View style={filterStyles.handle} />
          <View style={filterStyles.header}>
            <Text style={filterStyles.title}>Filter by retailer</Text>
            <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Close">
              <Text style={filterStyles.closeBtn}>×</Text>
            </Pressable>
          </View>
          <Text style={filterStyles.subtitle}>
            Show price trends for a specific store or all stores.
          </Text>
          <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false}>
            <View style={filterStyles.options}>
              {options.map((opt) => {
    const selected = current === opt;
                return (
                  <Pressable
                    key={opt}
                    onPress={() => onSelect(opt)}
                    style={({ pressed }) => [
                      filterStyles.option,
                      selected && filterStyles.optionSelected,
                      pressed && { transform: [{ scale: 0.99 }] },
                    ]}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
                      <Store size={16} color={selected ? Colors.accent : Colors.mutedForeground} strokeWidth={2} />
                      <Text style={[filterStyles.optionLabel, selected && { color: Colors.accent }]}>
                        {opt === "ALL" ? "All stores" : opt}
                      </Text>
                    </View>
                    {selected ? (
                      <Text style={filterStyles.checkText}>✓</Text>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
});

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

  nameRow: {
    marginTop: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  name: { fontFamily: Fonts.extrabold, fontSize: 36, lineHeight: 40, letterSpacing: -1.2, color: Colors.foreground, flexShrink: 1 },
  weeklyBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: Radius.full,
    paddingHorizontal: 9,
    paddingVertical: 5,
    marginTop: 6,
    flexShrink: 0,
  },
  weeklyBadgeText: {
    fontFamily: Fonts.bold,
    fontSize: 10,
    letterSpacing: 0.3,
  },
  // Default color is mutedForeground; the inline 3-way color branch in the
  // view body overrides it for spikes (accent) and drops (success) so a
  // price drop never renders in warning red.
  since: { marginTop: 8, fontFamily: Fonts.bold, fontSize: 16, color: Colors.mutedForeground },
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
  histStore: {
    fontFamily: Fonts.mono,
    fontSize: 9.5,
    letterSpacing: 0.5,
    color: Colors.accent,
    marginLeft: 8,
  },
  histHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  /* Lowest price summary header */
  lowestHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderColor: Colors.success,
    backgroundColor: Colors.successSoft,
    borderRadius: Radius.lg,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 20,
  },
  lowestIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(16,185,129,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  lowestKicker: {
    fontFamily: Fonts.mono,
    fontSize: 9.5,
    letterSpacing: 1,
    color: Colors.success,
  },
  lowestValue: {
    marginTop: 3,
    fontFamily: Fonts.extrabold,
    fontSize: 20,
    letterSpacing: -0.5,
    color: Colors.foreground,
    fontVariant: ["tabular-nums"],
  },
  lowestStore: {
    fontFamily: Fonts.bold,
    fontSize: 13,
    letterSpacing: -0.2,
    color: Colors.mutedForeground,
  },
  storeFilterBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: Colors.accentSoft,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  storeFilterText: {
    fontFamily: Fonts.bold,
    fontSize: 9,
    letterSpacing: 0.5,
    color: Colors.accent,
  },
  histEmpty: {
    fontFamily: Fonts.regular,
    fontSize: 13,
    color: Colors.mutedForeground,
    paddingVertical: 16,
    textAlign: "center",
  },

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
  // Text-summary share button — secondary visual weight (outlined, not filled)
  // so it reads as a lighter-weight companion to the primary Spike Card share.
  textShareBtn: {
    marginTop: 32,
    height: 48,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.borderStrong,
    backgroundColor: Colors.surface,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  textShareBtnText: { fontFamily: Fonts.bold, fontSize: 12, letterSpacing: 0.5, color: Colors.foreground },
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

const filterStyles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: Colors.overlay },
  anchor: { flex: 1, justifyContent: "flex-end" },
  sheet: {
    backgroundColor: Colors.background,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 32,
  },
  handle: {
    alignSelf: "center",
    width: 36,
    height: 5,
    borderRadius: 3,
    backgroundColor: Colors.borderStrong,
    marginBottom: 16,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  title: {
    fontFamily: Fonts.extrabold,
    fontSize: 20,
    letterSpacing: -0.5,
    color: Colors.foreground,
  },
  closeBtn: {
    fontSize: 28,
    color: Colors.mutedForeground,
    fontFamily: Fonts.regular,
    lineHeight: 28,
  },
  subtitle: {
    fontFamily: Fonts.regular,
    fontSize: 13,
    color: Colors.mutedForeground,
    marginBottom: 16,
    lineHeight: 18,
  },
  options: { gap: 10 },
  option: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: 16,
  },
  optionSelected: {
    borderColor: Colors.accent,
    backgroundColor: Colors.accentSoft,
  },
  optionLabel: {
    fontFamily: Fonts.bold,
    fontSize: 15,
    letterSpacing: -0.3,
    color: Colors.foreground,
  },
  checkText: {
    fontFamily: Fonts.bold,
    fontSize: 18,
    color: Colors.accent,
  },
});
