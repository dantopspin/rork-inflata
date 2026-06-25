import { router, useLocalSearchParams } from "expo-router";
import { ArrowLeft, Lock, MapPin, Share2 } from "lucide-react-native";
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
import { aggregateItems, itemConfidence, withOverspend } from "@/lib/inflation";
import { useApp } from "@/providers/AppProvider";
import { View as RNView } from "react-native";

export default function ItemDetail() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { hydrated, scans, frequency, subscribed } = useApp();

  const stat = useMemo(() => {
    const stats = withOverspend(aggregateItems(scans), frequency);
    return stats.find((s) => s.key === id);
  }, [scans, frequency, id]);

  const [paywall, setPaywall] = useState<boolean>(false);
  const cardRef = useRef<RNView>(null);

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
            <Sparkline prices={stat.history.map((h) => h.price)} height={96} strokeWidth={2.5} />
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

        {/* Best Price Found At — store-to-store arbitrage */}
        {stat.cheapestPrice !== undefined && stat.cheapestStore ? (
          <View style={[styles.card, { marginTop: 24 }]}>
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
});
