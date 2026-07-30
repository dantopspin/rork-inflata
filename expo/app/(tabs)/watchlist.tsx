import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import { ArrowDownUp, ArrowRight, ChevronDown, ChevronRight, Search, Star, Store, X } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import Animated, { FadeIn, FadeInDown, SlideInUp } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Colors, Fonts, Radius } from "@/constants/theme";
import { fmtUSD } from "@/lib/format";
import { aggregateItems } from "@/lib/inflation";
import { useApp } from "@/providers/AppProvider";
import { FlashPrice } from "@/components/FlashPrice";

export default function Watchlist() {
  const insets = useSafeAreaInsets();
  const { scans, watchlist, toggleWatchlist } = useApp();
  const [search, setSearch] = useState<string>("");
  const [sortMode, setSortMode] = useState<SortMode>("savings");
  const [sortOpen, setSortOpen] = useState<boolean>(false);

  const bestPrices = useMemo(() => {
    const stats = aggregateItems(scans);
    return stats
      .filter((s) => s.cheapestPrice != null && s.cheapestStore && s.realAppearances > 0)
      .sort((a, b) => {
        const aSavings = a.currentPrice - (a.cheapestPrice ?? a.currentPrice);
        const bSavings = b.currentPrice - (b.cheapestPrice ?? b.currentPrice);
        return bSavings - aSavings;
      });
  }, [scans]);

  // Sorted list based on the selected sort mode. Watchlist-pinned items
  // always stay at the top unless the user is searching.
  const sorted = useMemo(() => {
    let list = [...bestPrices];
    switch (sortMode) {
      case "lowest":
        list.sort((a, b) => (a.cheapestPrice ?? a.currentPrice) - (b.cheapestPrice ?? b.currentPrice));
        break;
      case "highest":
        list.sort((a, b) => (b.cheapestPrice ?? b.currentPrice) - (a.cheapestPrice ?? a.currentPrice));
        break;
      case "recent":
        list.sort((a, b) => b.currentDate.localeCompare(a.currentDate));
        break;
      case "savings":
      default:
        // default savings sort is already applied in bestPrices
        break;
    }
    return list;
  }, [bestPrices, sortMode]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = sorted;
    // Pin watchlist items to the top when not searching
    if (!q && watchlist.length > 0) {
      const pinned = list.filter((s) => watchlist.includes(s.key));
      const rest = list.filter((s) => !watchlist.includes(s.key));
      list = [...pinned, ...rest];
    }
    if (!q) return list;
    return list.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.cheapestStore ?? "").toLowerCase().includes(q),
    );
  }, [sorted, search, watchlist]);

  const uniqueStoreCount = useMemo(() => {
    const stores = new Set(scans.filter((s) => s.source === "scan").map((s) => s.store));
    return stores.size;
  }, [scans]);

  const hasNoData = bestPrices.length === 0;
  // Determine the single store name when the user has only shopped at one place.
  const soleStore = useMemo(() => {
    if (uniqueStoreCount !== 1) return null;
    const real = scans.filter((s) => s.source === "scan");
    return real[real.length - 1]?.store ?? null;
  }, [uniqueStoreCount, scans]);

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

        {/* Search + Sort controls */}
        <View style={styles.controlsRow}>
          <View style={[styles.searchWrap, { flex: 1 }]}>
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
          {bestPrices.length > 0 ? (
            <Pressable
              onPress={() => {
                if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setSortOpen(true);
              }}
              style={({ pressed }) => [
                styles.sortBtn,
                pressed && { opacity: 0.6 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={`Sort items, currently ${SORT_LABELS[sortMode]}`}
            >
              <ArrowDownUp size={13} color={Colors.mutedForeground} strokeWidth={2} />
              <Text style={styles.sortBtnText}>{SORT_LABELS[sortMode]}</Text>
              <ChevronDown size={11} color={Colors.mutedForeground} strokeWidth={2.5} />
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
            {uniqueStoreCount === 1 && soleStore ? (
              <Text style={styles.emptyBody}>
                You&apos;ve only scanned {soleStore}. Scan a receipt from a different store to unlock price comparisons.
              </Text>
            ) : (
              <Text style={styles.emptyBody}>
                Scan receipts from at least two different stores to start comparing prices
                and finding the best deals.
              </Text>
            )}
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
                      watchlist.includes(item.key) && styles.rowPinned,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={`${item.name}: cheapest at ${item.cheapestStore}, ${fmtUSD(item.cheapestPrice ?? 0)}, save ${fmtUSD(savings)}`}
                  >
                    {/* Star toggle — pin to top of watchlist */}
                    <Pressable
                      onPress={(e) => {
                        e.stopPropagation();
                        if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        toggleWatchlist(item.key);
                      }}
                      hitSlop={8}
                      accessibilityLabel={watchlist.includes(item.key) ? "Unpin from top" : "Pin to top"}
                      accessibilityRole="button"
                      style={styles.starBtn}
                    >
                      <Star
                        size={16}
                        color={watchlist.includes(item.key) ? Colors.amber : Colors.mutedForeground}
                        fill={watchlist.includes(item.key) ? Colors.amber : "none"}
                        strokeWidth={2}
                      />
                    </Pressable>
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
                      <FlashPrice
                        price={item.cheapestPrice ?? item.currentPrice}
                        style={styles.cheapestPrice}
                      />
                      {savings > 0 ? (
                        <View style={styles.savingsBadge}>
                          <Text style={styles.savingsText}>
                            SAVE {fmtUSD(savings)} ({savingsPct}%)
                          </Text>
                        </View>
                      ) : (
                        <View style={styles.bestPriceBadge}>
                          <Text style={styles.bestPriceText}>BEST PRICE</Text>
                        </View>
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

      <SortModal
        visible={sortOpen}
        current={sortMode}
        onSelect={(m) => {
          setSortMode(m);
          setSortOpen(false);
          if (Platform.OS !== "web") Haptics.selectionAsync();
        }}
        onClose={() => setSortOpen(false)}
      />
    </View>
  );
}

// ─────────────────────────────────────────────
// Sort mode types & labels
// ─────────────────────────────────────────────

type SortMode = "savings" | "lowest" | "highest" | "recent";

const SORT_LABELS: Record<SortMode, string> = {
  savings: "Best savings",
  lowest: "Lowest price",
  highest: "Highest price",
  recent: "Date added",
};

const SORT_OPTIONS: { id: SortMode; label: string; sub: string }[] = [
  { id: "savings", label: "Best savings", sub: "Biggest potential savings first" },
  { id: "lowest", label: "Lowest price", sub: "Cheapest items first" },
  { id: "highest", label: "Highest price", sub: "Most expensive items first" },
  { id: "recent", label: "Date added", sub: "Recently scanned first" },
];

function SortModal({
  visible,
  current,
  onSelect,
  onClose,
}: {
  visible: boolean;
  current: SortMode;
  onSelect: (m: SortMode) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <Animated.View entering={FadeIn.duration(180)} style={sortStyles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>
      <View style={sortStyles.anchor} pointerEvents="box-none">
        <Animated.View
          entering={SlideInUp.springify().dampingRatio(0.7).stiffness(280)}
          style={sortStyles.sheet}
        >
          <View style={sortStyles.handle} />
          <View style={sortStyles.header}>
            <Text style={sortStyles.title}>Sort items</Text>
            <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Close">
              <X size={20} color={Colors.mutedForeground} />
            </Pressable>
          </View>
          <Text style={sortStyles.subtitle}>
            Choose how your tracked products are ordered.
          </Text>
          <View style={sortStyles.options}>
            {SORT_OPTIONS.map((opt) => {
              const selected = current === opt.id;
              return (
                <Pressable
                  key={opt.id}
                  onPress={() => onSelect(opt.id)}
                  style={({ pressed }) => [
                    sortStyles.option,
                    selected && sortStyles.optionSelected,
                    pressed && { transform: [{ scale: 0.99 }] },
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={sortStyles.optionLabel}>{opt.label}</Text>
                    <Text style={sortStyles.optionSub}>{opt.sub}</Text>
                  </View>
                  <View style={[sortStyles.radio, selected && sortStyles.radioOn]}>
                    {selected ? (
                      <Text style={sortStyles.radioCheck}>✓</Text>
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        </Animated.View>
      </View>
    </Modal>
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
  controlsRow: {
    marginTop: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  sortBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === "ios" ? 12 : 10,
  },
  sortBtnText: {
    fontFamily: Fonts.bold,
    fontSize: 11,
    letterSpacing: 0.3,
    color: Colors.foreground,
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
  rowPinned: { borderColor: Colors.amber, borderWidth: 1.5 },
  starBtn: { marginRight: 10, padding: 4 },
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
    color: Colors.success,
  },
  bestPriceBadge: {
    marginTop: 4,
    backgroundColor: Colors.successSoft,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  bestPriceText: {
    fontFamily: Fonts.bold,
    fontSize: 9.5,
    letterSpacing: 0.4,
    color: Colors.success,
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

const sortStyles = StyleSheet.create({
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
  optionSub: {
    marginTop: 2,
    fontSize: 12,
    color: Colors.mutedForeground,
    fontFamily: Fonts.regular,
  },
  radio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  radioOn: {
    borderColor: Colors.accent,
    backgroundColor: Colors.accent,
  },
  radioCheck: {
    fontFamily: Fonts.bold,
    fontSize: 14,
    color: Colors.accentForeground,
  },
});
