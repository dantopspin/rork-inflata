import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import { ArrowDownUp, ArrowRight, ChevronRight, Search, Store, X } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Colors, Fonts, Radius } from "@/constants/theme";
import { fmtUSD } from "@/lib/format";
import { aggregateItems } from "@/lib/inflation";
import { useApp } from "@/providers/AppProvider";

export default function Watchlist() {
  const insets = useSafeAreaInsets();
  const { scans } = useApp();
  const [search, setSearch] = useState<string>("");

  const bestPrices = useMemo(() => {
    const stats = aggregateItems(scans);
    return stats
      .filter((s) => s.cheapestPrice != null && s.cheapestStore)
      .sort((a, b) => {
        const aSavings = a.currentPrice - (a.cheapestPrice ?? a.currentPrice);
        const bSavings = b.currentPrice - (b.cheapestPrice ?? b.currentPrice);
        return bSavings - aSavings;
      });
  }, [scans]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return bestPrices;
    return bestPrices.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.cheapestStore ?? "").toLowerCase().includes(q),
    );
  }, [bestPrices, search]);

  const hasNoData = bestPrices.length === 0;

  return (
    <View style={styles.screen}>
      <ScrollView
        keyboardDismissMode="on-drag"
        contentContainerStyle={{
          paddingHorizontal: 24,
          paddingTop: insets.top + 12,
          paddingBottom: insets.bottom + 120,
        }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.kicker}>WATCHLIST</Text>
        <Text style={styles.title}>Best prices found</Text>
        <Text style={styles.subtitle}>
          Where each item is cheapest across all stores you've visited.
        </Text>

        {/* Search filter */}
        <View style={styles.searchWrap}>
          <Search size={14} color={Colors.mutedForeground} strokeWidth={2} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Filter by item or store…"
            placeholderTextColor={Colors.mutedForeground}
            returnKeyType="search"
            autoCorrect={false}
            autoCapitalize="none"
            style={styles.searchInput}
          />
          {search.length > 0 ? (
            <Pressable onPress={() => setSearch("")} hitSlop={8} accessibilityLabel="Clear search">
              <X size={14} color={Colors.mutedForeground} strokeWidth={2} />
            </Pressable>
          ) : null}
        </View>

        {filtered.length === 0 && search.length > 0 ? (
          <View style={styles.emptyCard}>
            <Search size={28} color={Colors.mutedForeground} strokeWidth={1.5} />
            <Text style={styles.emptyTitle}>No matches</Text>
            <Text style={styles.emptyBody}>
              No items or stores match "{search}". Try a different search term.
            </Text>
          </View>
        ) : hasNoData ? (
          <View style={styles.emptyCard}>
            <ArrowDownUp size={28} color={Colors.mutedForeground} strokeWidth={1.5} />
            <Text style={styles.emptyTitle}>Not enough data yet</Text>
            <Text style={styles.emptyBody}>
              Scan receipts from at least two different stores to start comparing prices
              and finding the best deals.
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
          <View style={{ gap: 10, marginTop: 24 }}>
            {filtered.map((item, i) => {
              const savings = item.currentPrice - (item.cheapestPrice ?? item.currentPrice);
              const savingsPct =
                item.currentPrice > 0
                  ? Math.round((savings / item.currentPrice) * 100)
                  : 0;

              return (
                <Animated.View
                  key={item.key}
                  entering={FadeInDown.duration(350).delay(i * 60)}
                >
                  <Pressable
                    onPress={() => {
                      if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      router.push(`/item/${item.key}`);
                    }}
                    style={({ pressed }) => [
                      styles.row,
                      pressed && { backgroundColor: Colors.muted },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={`${item.name}: cheapest at ${item.cheapestStore}, ${fmtUSD(item.cheapestPrice!)}, save ${fmtUSD(savings)}`}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.itemName}>{item.name}</Text>
                      <View style={styles.storeRow}>
                        <Store size={11} color={Colors.accent} strokeWidth={2} />
                        <Text style={styles.storeName}>
                          Cheapest at {item.cheapestStore}
                        </Text>
                      </View>
                    </View>

                    <View style={{ alignItems: "flex-end" }}>
                      <Text style={styles.cheapestPrice}>
                        {fmtUSD(item.cheapestPrice!)}
                      </Text>
                      {savings > 0 ? (
                        <View style={styles.savingsBadge}>
                          <Text style={styles.savingsText}>
                            SAVE {fmtUSD(savings)} ({savingsPct}%)
                          </Text>
                        </View>
                      ) : (
                        <Text style={styles.currentPrice}>
                          {fmtUSD(item.currentPrice)} now
                        </Text>
                      )}
                    </View>
                    <View style={{ marginLeft: 6 }}>
                      <ChevronRight
                        size={14}
                        color={Colors.mutedForeground}
                      />
                    </View>
                  </Pressable>
                </Animated.View>
              );
            })}
          </View>
        )}
      </ScrollView>
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
  subtitle: {
    marginTop: 8,
    fontFamily: Fonts.regular,
    fontSize: 13.5,
    color: Colors.mutedForeground,
    lineHeight: 20,
  },

  /* Search filter */
  searchWrap: {
    marginTop: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === "ios" ? 12 : 8,
  },
  searchInput: {
    flex: 1,
    fontFamily: Fonts.regular,
    fontSize: 14,
    color: Colors.foreground,
  },

  emptyCard: {
    marginTop: 40,
    alignItems: "center",
    paddingVertical: 48,
    paddingHorizontal: 24,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    gap: 14,
  },
  emptyTitle: {
    fontFamily: Fonts.bold,
    fontSize: 17,
    color: Colors.foreground,
    letterSpacing: -0.3,
  },
  emptyBody: {
    fontFamily: Fonts.regular,
    fontSize: 13.5,
    color: Colors.mutedForeground,
    textAlign: "center",
    lineHeight: 20,
    maxWidth: 280,
  },

  row: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: 16,
  },
  itemName: {
    fontFamily: Fonts.bold,
    fontSize: 14,
    letterSpacing: -0.3,
    color: Colors.foreground,
  },
  storeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 4,
  },
  storeName: {
    fontFamily: Fonts.mono,
    fontSize: 10,
    letterSpacing: 0.5,
    color: Colors.accent,
  },
  cheapestPrice: {
    fontFamily: Fonts.extrabold,
    fontSize: 17,
    letterSpacing: -0.4,
    color: Colors.foreground,
    fontVariant: ["tabular-nums"],
  },
  savingsBadge: {
    marginTop: 4,
    backgroundColor: "rgba(34,160,107,0.12)",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  savingsText: {
    fontFamily: Fonts.bold,
    fontSize: 9.5,
    letterSpacing: 0.4,
    color: "#22a06b",
  },
  currentPrice: {
    marginTop: 3,
    fontFamily: Fonts.mono,
    fontSize: 10,
    color: Colors.mutedForeground,
  },

  startScanBtn: {
    marginTop: 20,
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
});
