import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { AlertTriangle, ArrowRight, ChevronRight, CircleDollarSign, Hash, Lock, MapPin, Receipt, Scale, Settings, Share2, Shuffle, TrendingDown, TrendingUp, X, Zap } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { FadeInDown, FadeIn, SlideInUp } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ConfidenceBadge } from "@/components/ConfidenceBadge";
import { PaywallSheet } from "@/components/PaywallSheet";
import { Colors, Fonts, Radius } from "@/constants/theme";
import { fmtDate, fmtDateLong, fmtPct, fmtUSD } from "@/lib/format";
import {
  aggregateItems,
  averageBasketSize,
  confidence,
  detectShrinkflation,
  effectivePriceChange,
  hasRecentSpike,
  inflationScore,
  nextTripEstimate,
  nextTripStrategyItems,
  realScanCount,
  savingsFound,
  topSpikingItems,
  totalSpendBaselineVsCurrent,
  weeklyBurnRate,
  withOverspend,
} from "@/lib/inflation";
import { useApp } from "@/providers/AppProvider";

export default function Dashboard() {
  const insets = useSafeAreaInsets();
  const { hydrated, scans, frequency, subscribed } = useApp();

  const realCount = realScanCount(scans);
  const stats = useMemo(() => withOverspend(aggregateItems(scans), frequency), [scans, frequency]);
  const inflation = useMemo(() => inflationScore(stats), [stats]);
  const totalDelta = useMemo(() => totalSpendBaselineVsCurrent(stats), [stats]);
  const conf = useMemo(() => confidence(scans, stats), [scans, stats]);
  const weeklyBurn = useMemo(() => weeklyBurnRate(stats), [stats]);
  const savings = useMemo(() => savingsFound(stats, frequency), [stats, frequency]);
  const tripEstimate = useMemo(() => nextTripEstimate(scans, stats), [scans, stats]);
  const avgBasket = useMemo(() => averageBasketSize(scans), [scans]);

  const worst = useMemo(() => [...stats].sort((a, b) => effectivePriceChange(b) - effectivePriceChange(a))[0] ?? null, [stats]);
  const hallOfShame = useMemo(
    () => [...stats].filter((s) => effectivePriceChange(s) > 0).sort((a, b) => effectivePriceChange(b) - effectivePriceChange(a)).slice(0, 3),
    [stats],
  );
  const strategyItems = useMemo(() => nextTripStrategyItems(scans, stats), [scans, stats]);
  const topSpikes = useMemo(() => topSpikingItems(stats, 3), [stats]);
  const recentScans = useMemo(
    () =>
      [...scans]
        .filter((s) => s.source === "scan")
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 3),
    [scans],
  );
  const recentItems = useMemo(
    () =>
      recentScans.flatMap((s) =>
        s.items.map((it, itemIdx) => ({ ...it, itemKey: it.itemKey, scanDate: s.date, store: s.store, rowKey: `${s.id}-${itemIdx}` })),
      ),
    [recentScans],
  );
  const firstScanDate = useMemo(() => {
    const real = scans.filter((s) => s.source === "scan").map((s) => s.date).sort();
    return real[0];
  }, [scans]);
  const uniqueStores = useMemo(() => {
    const stores = new Set(scans.filter((s) => s.source === "scan").map((s) => s.store));
    return stores.size;
  }, [scans]);
  // A price alert should fire when ANY tracked item had a recent spike,
  // not just the single worst offender — otherwise critical inflation
  // alerts get buried.
  const spikeTarget = useMemo(
    () =>
      topSpikes.find((s) => hasRecentSpike(s)) ??
      (worst && hasRecentSpike(worst) ? worst : null),
    [topSpikes, worst],
  );
  const showPriceAlert = spikeTarget !== null;

  const [paywall, setPaywall] = useState<boolean>(false);
  const [evidenceOpen, setEvidenceOpen] = useState<boolean>(false);

  if (!hydrated) {
    return <View style={styles.screen}><Header /></View>;
  }

  if (realCount === 0) {
    return (
      <View style={styles.screen}>
        <Header />
        <EmptyState />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Header />
      <ScrollView
        contentContainerStyle={{ paddingTop: 12, paddingBottom: insets.bottom + 120 }}
        showsVerticalScrollIndicator={false}
        accessibilityLabel="Dashboard"
      >
        {/* ===== PERSONAL INFLATION RATE — Free Preview ===== */}
        <Animated.View entering={FadeInDown.duration(400)} style={{ marginTop: 24, paddingHorizontal: 22 }}>
          <View style={[styles.inflationCard, { borderColor: inflation < 0 ? "#22a06b" : Colors.accent, shadowColor: inflation < 0 ? "#22a06b" : Colors.accent }]} accessibilityLabel={`Your personal inflation rate is ${fmtPct(inflation)}`}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <TrendingUp size={15} color={Colors.accent} strokeWidth={2.5} />
              <Text style={styles.inflationKicker}>PERSONAL INFLATION RATE</Text>
            </View>
            <Text style={[styles.inflationValue, { color: inflation < 0 ? "#22a06b" : Colors.accent }]}>{fmtPct(inflation)}</Text>
            <Text style={styles.inflationHint}>
              {conf.level === "low"
                ? "Based on limited data — scan more receipts for an accurate rate."
                : conf.level === "medium"
                  ? "Your rate is firming up as you scan more receipts."
                  : "Based on your verified scan history."}
            </Text>
            <View style={styles.inflationBar}>
              <LinearGradient
                colors={["#10B981", "#F5481B"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={[styles.inflationBarFill, { width: `${Math.min(100, Math.abs(inflation) * 10)}%` }]}
              />
            </View>
          </View>
        </Animated.View>

        {/* ===== INFLATION ALERT TICKER ===== */}
        {topSpikes.length > 0 ? (
          <Animated.View entering={FadeInDown.duration(400).delay(100)} style={{ marginTop: 20, paddingHorizontal: 24 }}>
            <View style={styles.tickerTrack}>
              <View style={styles.tickerBadge}>
                <AlertTriangle size={11} color={Colors.accentForeground} strokeWidth={2.5} />
                <Text style={styles.tickerBadgeText}>INFLATION ALERT</Text>
              </View>
              <ScrollView
                horizontal
                nestedScrollEnabled
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 16, paddingRight: 24 }}
              >
                {topSpikes.map((s) => (
                  <Pressable
                    key={s.key}
                    onPress={() => {
                      if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                      router.push(`/item/${s.key}`);
                    }}
                    style={({ pressed }) => [styles.tickerItem, pressed && { opacity: 0.7 }]}
                    accessibilityRole="button"
                    accessibilityLabel={`${s.name} unit price up ${fmtPct(s.unitPriceChange ?? 0)}`}
                  >
                    <Text style={styles.tickerItemName} numberOfLines={1}>{s.name}</Text>
                    <Text style={styles.tickerItemPct}>
                      {(s.unitPriceChange ?? 0) > 0 ? "+" : ""}{fmtPct(s.unitPriceChange ?? 0, false)} per unit
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          </Animated.View>
        ) : null}

        {/* ===== HERO METRIC CARD ===== */}
        <Animated.View entering={FadeInDown.duration(400).delay(60)} style={{ paddingHorizontal: 22, marginTop: 24 }}>
          {conf.level === "low" ? (
            /* Trust Banner — Gathering Intelligence */
            <View style={styles.heroCard} accessibilityLabel={`Gathering intelligence. ${3 - realCount} more scans needed to unlock your accurate inflation score.`}>
              <View style={styles.heroTopRow}>
                <Zap size={18} color={Colors.accent} strokeWidth={1.8} />
                <Text style={styles.heroKicker}>GATHERING INTELLIGENCE</Text>
              </View>
              <Text style={styles.trustTitle}>Building Your{"\n"}Inflation Profile</Text>
              <View style={styles.progressBar}>
                <View style={[styles.progressFill, { width: `${Math.min(100, (realCount / 3) * 100)}%` }]} />
              </View>
              <Text style={styles.trustSub}>
                Scan <Text style={styles.trustBold}>{Math.max(0, 3 - realCount)} more receipt{3 - realCount !== 1 ? "s" : ""}</Text> to unlock your accurate Inflation Score
              </Text>
            </View>
          ) : (
            /* Hero Metric — Weekly Burn */
            <View style={styles.heroCard} accessibilityLabel={`Weekly burn rate ${fmtUSD(weeklyBurn)}. Inflation rate ${fmtPct(inflation)}.`}>
              <View style={styles.heroTopRow}>
                <TrendingUp size={16} color={Colors.accent} strokeWidth={2} />
                <Text style={styles.heroKicker}>WEEKLY BURN RATE</Text>
              </View>
              <Text style={styles.heroDollar} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{fmtUSD(weeklyBurn)}</Text>
              <View style={styles.heroMetaRow}>
                <Text style={styles.heroSubPct}>
                  {fmtPct(inflation)} inflation
                </Text>
                <View style={styles.heroDot} />
                <Text style={styles.heroSubPct}>
                  {realCount} {realCount === 1 ? "scan" : "scans"}
                  {firstScanDate ? ` since ${fmtDate(firstScanDate)}` : ""}
                </Text>
              </View>
              <View style={styles.heroDivider} />
              {uniqueStores > 1 ? (
                <View style={styles.heroBottomRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.savingsLabel}>SAVINGS FOUND</Text>
                    <Text style={styles.savingsValue}>{fmtUSD(savings)}</Text>
                    <Text style={styles.savingsHint}>if bought at cheapest store</Text>
                  </View>
                  <ConfidenceBadge c={conf} />
                </View>
              ) : (
                <View style={styles.heroBottomRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.savingsLabel, { color: Colors.accent }]}>UNLOCK SAVINGS</Text>
                    <Text style={[styles.savingsHint, { marginTop: 4, fontSize: 12.5, lineHeight: 18 }]}>
                      Scan from a 2nd store to unlock savings comparison.
                    </Text>
                  </View>
                  <ConfidenceBadge c={conf} />
                </View>
              )}
            </View>
          )}
        </Animated.View>

        {/* ===== PRICE ALERT (replaces Worst Offender) ===== */}
        {showPriceAlert && spikeTarget ? (
          <Animated.View entering={FadeInDown.duration(400).delay(80)} style={{ marginTop: 24, paddingHorizontal: 24 }}>
            <Pressable
              onPress={() => {
                if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                router.push(`/item/${spikeTarget.key}`);
              }}
              style={({ pressed }) => [styles.priceAlert, pressed && { transform: [{ scale: 0.99 }] }]}
              accessibilityRole="button"
              accessibilityLabel={`Price spike alert: ${spikeTarget.name}, ${fmtPct(effectivePriceChange(spikeTarget))} increase in last 14 days`}
            >
              <View style={styles.priceAlertBanner}>
                <AlertTriangle size={16} color={Colors.accent} strokeWidth={2} />
                <Text style={styles.priceAlertBannerText}>PRICE SPIKE ALERT — LAST 14 DAYS</Text>
              </View>
              {detectShrinkflation(spikeTarget) ? (
                <View style={styles.shrinkflationBadge}>
                  <Scale size={12} color={Colors.destructive} strokeWidth={2} />
                  <Text style={styles.shrinkflationBadgeText}>SHRINKFLATION DETECTED</Text>
                </View>
              ) : null}
              <Text style={styles.priceAlertName}>{spikeTarget.name}</Text>
              <View style={styles.priceAlertGrid}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.priceAlertStatLabel}>SPIKE</Text>
                  <Text style={styles.priceAlertStat}>{fmtPct(spikeTarget.biggestJumpPct ?? effectivePriceChange(spikeTarget))}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.priceAlertStatLabel}>OUT OF POCKET</Text>
                  <Text style={styles.priceAlertStat}>+{fmtUSD(Math.max(0, spikeTarget.dollarChange))}</Text>
                </View>
              </View>
              <View style={styles.priceAlertFooter}>
                <Text style={styles.priceAlertSince}>
                  Since {fmtDateLong(spikeTarget.firstDate)}
                </Text>
                <ArrowRight size={16} color={Colors.accent} />
              </View>
            </Pressable>
          </Animated.View>
        ) : null}

        {/* ===== NEXT TRIP STRATEGY or DATA COLLECTION ===== */}
        {realCount >= 3 ? (
          <Animated.View entering={FadeInDown.duration(400).delay(150)} style={[styles.section, { marginHorizontal: 24 }]}>
            <Text style={styles.kicker}>NEXT TRIP STRATEGY</Text>
            <View style={{ gap: 10, marginTop: 14 }}>
              {uniqueStores <= 1 ? (
                <View style={styles.discoveryMission}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <MapPin size={17} color={Colors.accent} strokeWidth={2} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.discoveryTitle}>Discovery Mission</Text>
                      <Text style={styles.discoveryBody}>
                        Scan a receipt from a different store to unlock cross-store savings.
                      </Text>
                    </View>
                  </View>
                </View>
              ) : null}
              {uniqueStores >= 2 && strategyItems.length > 0 ? strategyItems.map((item) => {
                const isBuyAt = item.action === "buy_at";
                const isWait = item.action === "wait";
                const isStockUp = item.action === "stock_up";
                const isSubstitution = item.action === "substitution_suggested";

                return (
                  <Pressable
                    key={item.key}
                    onPress={() => router.push(`/item/${item.key}`)}
                    style={({ pressed }) => [styles.strategyRow, pressed && { backgroundColor: Colors.muted }]}
                    accessibilityRole="button"
                    accessibilityLabel={`${item.name}: ${isBuyAt ? `Buy at ${item.store}` : isWait ? "Wait for drop" : isStockUp ? `Stock up at ${item.store}` : isSubstitution ? "Consider swapping to a cheaper alternative" : "Buy as planned"}`}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.strategyName}>{item.name}</Text>
                      <Text style={styles.strategyVol}>
                        Volatility: {fmtPct(Math.abs(item.pctChange), false)}
                      </Text>
                    </View>
                    <View style={styles.strategyAction}>
                      {isBuyAt ? (
                        <>
                          <TrendingDown size={11} color={Colors.foreground} strokeWidth={2.5} />
                          <Text style={styles.strategyActionText}>BUY AT</Text>
                          <Text style={styles.strategyActionStore}>{item.store.toUpperCase()}</Text>
                        </>
                      ) : isWait ? (
                        <>
                          <TrendingUp size={11} color={Colors.mutedForeground} strokeWidth={2.5} />
                          <Text style={[styles.strategyActionText, { color: Colors.mutedForeground }]}>WAIT FOR DROP</Text>
                        </>
                      ) : isStockUp ? (
                        <>
                          <TrendingDown size={11} color={Colors.foreground} strokeWidth={2.5} />
                          <Text style={styles.strategyActionText}>STOCK UP</Text>
                          <Text style={styles.strategyActionStore}>{item.store.toUpperCase()}</Text>
                        </>
                      ) : isSubstitution ? (
                        <>
                          <Shuffle size={11} color={Colors.accent} strokeWidth={2.5} />
                          <Text style={[styles.strategyActionText, { color: Colors.accent }]}>SWITCH IT UP</Text>
                        </>
                      ) : (
                        <Text style={[styles.strategyActionText, { color: Colors.mutedForeground }]}>AS PLANNED</Text>
                      )}
                    </View>
                  </Pressable>
                );
              }) : uniqueStores >= 2 ? (
                <Text style={styles.dataCollectionHint}>
                  Scan more receipts to unlock personalized{"\n"}
                  trip recommendations.
                </Text>
              ) : null}
            </View>
          </Animated.View>
        ) : realCount < 3 ? (
          <Animated.View entering={FadeInDown.duration(400).delay(150)} style={[styles.section, { marginHorizontal: 24 }]}>
            <Text style={styles.kicker}>DATA COLLECTION</Text>
            <View style={styles.dataCollectionCard}>
              <View style={styles.progressBarLarge}>
                <View style={[styles.progressFillLarge, { width: `${Math.min(100, (realCount / 3) * 100)}%` }]} />
              </View>
              <Text style={styles.dataCollectionText}>
                <Text style={styles.trustBold}>{realCount} of 3</Text> scans collected for strategy insights
              </Text>
              <Text style={styles.dataCollectionHint}>
                Scan more receipts to unlock personalized trip planning
              </Text>
            </View>
          </Animated.View>
        ) : null}

        {/* ===== HALL OF SHAME ===== */}
        {hallOfShame.length > 0 ? (
          <Animated.View entering={FadeInDown.duration(400).delay(220)} style={[styles.section, { marginHorizontal: 24 }]} accessibilityLabel="Inflation hall of shame">
            <View style={styles.rowBetween}>
              <Text style={styles.kicker}>INFLATION HALL OF SHAME</Text>
              <Pressable
                onPress={() => (subscribed ? router.push("/share-hall-of-shame") : setPaywall(true))}
                hitSlop={8}
                style={styles.shareLink}
              >
                {subscribed ? (
                  <Share2 size={13} color={Colors.accent} />
                ) : (
                  <Lock size={13} color={Colors.accent} />
                )}
                <Text style={styles.shareLinkText}>SHARE CARD</Text>
              </Pressable>
            </View>
            <View style={{ gap: 12, marginTop: 14 }}>
              {hallOfShame.map((it) => (
                <Pressable
                  key={it.key}
                  onPress={() => router.push(`/item/${it.key}`)}
                  style={({ pressed }) => [styles.hosRow, pressed && { backgroundColor: Colors.muted }]}
                  accessibilityRole="button"
                  accessibilityLabel={`${it.name}, ${fmtPct(it.pctChange)} increase`}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.hosName}>{it.name}</Text>
                    <Text style={styles.subtleSmall}>+{fmtUSD(it.cumulativeOverspend)} extra this month</Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={styles.hosPct}>{fmtPct(it.pctChange)}</Text>
                    <Text style={styles.hosVs}>
                      {it.firstFromBaseline ? "VS. BASELINE" : "VS. FIRST SCAN"}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>
          </Animated.View>
        ) : null}

        {/* ===== EXTRA SPEND STATEMENT ===== */}
        {totalDelta > 0 ? (
          <Animated.View entering={FadeInDown.duration(400).delay(280)} style={[styles.statement, { marginHorizontal: 24 }]} accessibilityLabel={`Inflation has cost you an extra ${fmtUSD(totalDelta)} this month`}>
            <Text style={styles.statementText}>
              Inflation has cost you an extra{" "}
              <Text style={styles.statementAccent}>{fmtUSD(totalDelta)}</Text> this month vs. your
              baseline.
            </Text>
          </Animated.View>
        ) : null}

        {/* ===== NEXT TRIP ESTIMATE (secondary) ===== */}
        {tripEstimate > 0 && avgBasket > 0 ? (
          <Animated.View entering={FadeInDown.duration(400).delay(320)} style={[styles.section, { marginHorizontal: 24 }]} accessibilityLabel={`Next trip estimated at ${fmtUSD(tripEstimate)}`}>
            <Text style={styles.kicker}>NEXT TRIP ESTIMATE</Text>
            <Text style={styles.estimateValue}>{fmtUSD(tripEstimate)}</Text>
            <Text style={styles.subtleSmall}>
              Avg basket ({fmtUSD(avgBasket)}) × personal inflation rate
            </Text>
          </Animated.View>
        ) : null}

        {/* ===== RECENT EVIDENCE BUTTON ===== */}
        <Animated.View entering={FadeInDown.duration(400).delay(380)} style={[styles.section, { marginHorizontal: 24 }]}>
          <Pressable
            onPress={() => setEvidenceOpen(true)}
            style={({ pressed }) => [styles.evidenceTrigger, pressed && { backgroundColor: Colors.muted }]}
            accessibilityRole="button"
            accessibilityLabel={`Recent evidence, ${recentItems.length} items`}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
              <Receipt size={15} color={Colors.accent} strokeWidth={1.8} />
              <Text style={styles.kicker}>RECENT EVIDENCE</Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Text style={styles.evidenceCount}>
                {recentItems.length} {recentItems.length === 1 ? "item" : "items"}
              </Text>
              <ChevronRight size={14} color={Colors.mutedForeground} />
            </View>
          </Pressable>
        </Animated.View>
      </ScrollView>

      <PaywallSheet open={paywall} onClose={() => setPaywall(false)} reason="Share unlocks with paid" totalExtra={totalDelta} />
      <RecentEvidenceModal visible={evidenceOpen} onClose={() => setEvidenceOpen(false)} items={recentItems} spikeItem={showPriceAlert ? spikeTarget : undefined} />
    </View>
  );
}

function RecentEvidenceModal({
  visible,
  onClose,
  items,
  spikeItem,
}: {
  visible: boolean;
  onClose: () => void;
  items: { name: string; price: number; store: string; scanDate: string; itemKey: string; rowKey?: string }[];
  spikeItem?: import("@/types").ItemStat;
}) {
  const insets = useSafeAreaInsets();

  // Find the two specific receipts that caused the biggest price spike.
  const spikePair = useMemo(() => {
    if (!spikeItem || spikeItem.history.length < 2) return null;
    let bestPair: { prev: (typeof spikeItem.history)[0]; cur: (typeof spikeItem.history)[0]; pct: number } | null = null;
    for (let i = 1; i < spikeItem.history.length; i++) {
      const prev = spikeItem.history[i - 1];
      const cur = spikeItem.history[i];
      if (prev.price <= 0) continue;
      const pct = ((cur.price - prev.price) / prev.price) * 100;
      if (pct > 0 && (!bestPair || pct > bestPair.pct)) {
        bestPair = { prev, cur, pct };
      }
    }
    return bestPair;
  }, [spikeItem]);

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} accessibilityViewIsModal={true}>
      <Animated.View entering={FadeIn.duration(180)} style={modalStyles.backdrop} accessibilityViewIsModal={true}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close modal" />
      </Animated.View>
      <View style={modalStyles.anchor} pointerEvents="box-none">
        <Animated.View entering={SlideInUp.springify().dampingRatio(0.7).stiffness(280)} style={[modalStyles.sheet, { paddingBottom: insets.bottom + 20 }]}>
          <View style={modalStyles.handle} />
          <View style={modalStyles.header}>
            <Text style={modalStyles.title}>
              {spikePair ? "Spike Evidence" : "Recent Evidence"}
            </Text>
            <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Close evidence modal" accessibilityRole="button">
              <X size={20} color={Colors.mutedForeground} />
            </Pressable>
          </View>

          {spikePair ? (
            <>
              <Text style={modalStyles.spikeIntro}>
                {spikeItem!.name} jumped {fmtPct(spikePair.pct)} between these two purchases:
              </Text>
              <View style={modalStyles.vsGrid}>
                <View style={modalStyles.vsCard}>
                  <Text style={modalStyles.vsLabel}>BEFORE</Text>
                  <Text style={modalStyles.vsDate}>{fmtDate(spikePair.prev.date)}</Text>
                  <Text style={modalStyles.vsStore}>{spikePair.prev.store}</Text>
                  <View style={modalStyles.vsDivider} />
                  <Text style={modalStyles.vsPrice}>{fmtUSD(spikePair.prev.price)}</Text>
                  {spikePair.prev.canonicalUnitPrice != null ? (
                    <Text style={modalStyles.vsUnit}>
                      {fmtUSD(spikePair.prev.canonicalUnitPrice)}/unit
                    </Text>
                  ) : null}
                </View>

                <View style={modalStyles.vsArrow}>
                  <TrendingUp size={28} color={Colors.accent} strokeWidth={2.5} />
                  <Text style={modalStyles.vsPct}>+{fmtPct(spikePair.pct, false)}</Text>
                </View>

                <View style={[modalStyles.vsCard, modalStyles.vsCardAfter]}>
                  <Text style={[modalStyles.vsLabel, { color: Colors.accent }]}>AFTER</Text>
                  <Text style={modalStyles.vsDate}>{fmtDate(spikePair.cur.date)}</Text>
                  <Text style={modalStyles.vsStore}>{spikePair.cur.store}</Text>
                  <View style={modalStyles.vsDivider} />
                  <Text style={[modalStyles.vsPrice, { color: Colors.accent }]}>{fmtUSD(spikePair.cur.price)}</Text>
                  {spikePair.cur.canonicalUnitPrice != null ? (
                    <Text style={[modalStyles.vsUnit, { color: Colors.accent }]}>
                      {fmtUSD(spikePair.cur.canonicalUnitPrice)}/unit
                    </Text>
                  ) : null}
                </View>
              </View>
            </>
          ) : items.length === 0 ? (
            <Text style={modalStyles.empty}>Scan a receipt to see your purchases.</Text>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 400 }}>
              {items.map((item, i) => {
                const RowContent = (
                  <View style={[modalStyles.row, i === items.length - 1 && { borderBottomWidth: 0 }]}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
                      <Receipt size={15} color={Colors.accent} strokeWidth={1.8} />
                      <View style={{ flex: 1 }}>
                        <Text style={modalStyles.itemName} numberOfLines={1}>{item.name}</Text>
                        <Text style={modalStyles.itemMeta}>
                          {item.store} • {fmtDate(item.scanDate)}
                        </Text>
                      </View>
                    </View>
                    <Text style={modalStyles.itemPrice}>{fmtUSD(item.price)}</Text>
                  </View>
                );
                return (
                  <View key={item.rowKey ?? `${item.itemKey}-${i}`} style={modalStyles.evidenceRow}>
                    {RowContent}
                  </View>
                );
              })}
            </ScrollView>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}

function Header() {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
      <Text style={styles.brand}>INFLATA</Text>
      <View style={{ flex: 1 }} />
      <Pressable
        onPress={() => {
          if (Platform.OS !== "web") Haptics.selectionAsync();
          router.push("/settings");
        }}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Settings"
        style={({ pressed }) => [
          styles.gearBtn,
          pressed && { opacity: 0.6 },
        ]}
      >
        <Settings size={18} color={Colors.mutedForeground} strokeWidth={1.8} />
      </Pressable>
    </View>
  );
}

function EmptyState() {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: 0, paddingTop: 40, paddingBottom: insets.bottom + 120 }}>
      <View style={{ paddingHorizontal: 24 }}>
        <Text style={styles.emptyTitle}>
          Your prices.{"\n"}Tracked. Quantified.
        </Text>
        <Text style={styles.emptyBody}>
          Scan any grocery receipt and we&apos;ll show you exactly which items have spiked — by
          percent and by dollar.
        </Text>
        <Pressable
          onPress={() => {
            if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            router.push("/scan");
          }}
          style={({ pressed }) => [styles.cta, pressed && { opacity: 0.9, transform: [{ scale: 0.97 }] }]}
          accessibilityRole="button"
          accessibilityLabel="Scan your first receipt"
        >
          <Text style={styles.ctaText}>SCAN YOUR FIRST RECEIPT</Text>
          <ArrowRight size={16} color={Colors.accentForeground} strokeWidth={2.5} />
        </Pressable>
      </View>

      <View style={styles.featureGrid}>
        {([
          ["Real Cost", "We track what it actually cost you.", () => <CircleDollarSign size={18} color={Colors.accent} strokeWidth={1.8} />],
          ["Real You", "Compared only to your own history.", () => <Hash size={18} color={Colors.accent} strokeWidth={1.8} />],
          ["On-Device", "Receipts never leave your phone.", () => <Lock size={18} color={Colors.accent} strokeWidth={1.8} />],
        ] as const).map(([title, body, renderIcon]) => {
          const cardContent = (
            <View style={styles.featureCard}>
              {renderIcon()}
              <Text style={styles.featureCardTitle}>{title}</Text>
              <Text style={styles.featureCardBody}>{body}</Text>
            </View>
          );
          return (
            <View key={title} style={styles.featureCardOuter}>
              {cardContent}
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    paddingHorizontal: 24,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  brand: { fontFamily: Fonts.mono, fontSize: 13, letterSpacing: 1, color: Colors.foreground },
  gearBtn: { padding: 4, borderRadius: Radius.full },

  /* ========== PERSONAL INFLATION RATE CARD ========== */
  inflationCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.xxl,
    borderWidth: 1,
    padding: 24,
    shadowOpacity: 0.08,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  inflationKicker: { fontFamily: Fonts.mono, fontSize: 11, letterSpacing: 1.5, color: Colors.accent },
  inflationValue: {
    marginTop: 10,
    fontFamily: Fonts.extrabold,
    fontSize: 52,
    lineHeight: 54,
    letterSpacing: -2,
    color: Colors.accent,
    fontVariant: ["tabular-nums"],
  },
  inflationHint: { marginTop: 8, fontFamily: Fonts.regular, fontSize: 12.5, lineHeight: 18, color: Colors.mutedForeground },
  inflationBar: {
    marginTop: 16,
    height: 4,
    borderRadius: 999,
    backgroundColor: Colors.muted,
    overflow: "hidden",
  },
  inflationBarFill: { height: "100%", borderRadius: 999 },

  /* ========== INFLATION ALERT TICKER ========== */
  tickerTrack: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.foreground,
    borderRadius: Radius.full,
    paddingLeft: 4,
    paddingRight: 4,
    paddingVertical: 4,
    overflow: "hidden",
  },
  tickerBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Colors.accent,
    borderRadius: Radius.full,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginRight: 4,
  },
  tickerBadgeText: { fontFamily: Fonts.bold, fontSize: 10, letterSpacing: 0.8, color: Colors.accentForeground },
  tickerItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 4,
  },
  tickerItemName: { fontFamily: Fonts.semibold, fontSize: 12, letterSpacing: -0.2, color: Colors.background, maxWidth: 100 },
  tickerItemPct: { fontFamily: Fonts.mono, fontSize: 10, letterSpacing: 0.3, color: Colors.accent },

  /* ========== HERO METRIC CARD ========== */
  heroCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.xxl,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 24,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  heroTopRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  heroKicker: { fontFamily: Fonts.mono, fontSize: 11, letterSpacing: 1.5, color: Colors.mutedForeground },
  heroDollar: {
    fontFamily: Fonts.extrabold,
    fontSize: 56,
    lineHeight: 58,
    letterSpacing: -2,
    color: Colors.accent,
    fontVariant: ["tabular-nums"],
  },
  heroMetaRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  heroSubPct: { fontFamily: Fonts.medium, fontSize: 13, color: Colors.mutedForeground, letterSpacing: -0.2 },
  heroDot: { width: 3, height: 3, borderRadius: 2, backgroundColor: Colors.borderStrong },
  heroDivider: { height: StyleSheet.hairlineWidth, backgroundColor: Colors.border, marginVertical: 16 },
  heroBottomRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" },
  savingsLabel: { fontFamily: Fonts.mono, fontSize: 10, letterSpacing: 1, color: Colors.mutedForeground },
  savingsValue: {
    marginTop: 2,
    fontFamily: Fonts.extrabold,
    fontSize: 22,
    letterSpacing: -0.6,
    color: Colors.foreground,
    fontVariant: ["tabular-nums"],
  },
  savingsHint: { marginTop: 2, fontFamily: Fonts.regular, fontSize: 11, color: Colors.mutedForeground },

  /* ========== TRUST BANNER (low confidence) ========== */
  trustTitle: {
    fontFamily: Fonts.extrabold,
    fontSize: 28,
    lineHeight: 34,
    letterSpacing: -0.8,
    color: Colors.foreground,
  },
  progressBar: {
    marginTop: 20,
    height: 6,
    borderRadius: 999,
    backgroundColor: Colors.muted,
    overflow: "hidden",
  },
  progressFill: { height: "100%", borderRadius: 999, backgroundColor: Colors.accent },
  trustSub: { marginTop: 12, fontFamily: Fonts.medium, fontSize: 13, color: Colors.mutedForeground, letterSpacing: -0.2 },
  trustBold: { fontFamily: Fonts.bold, color: Colors.foreground },

  /* ========== PRICE ALERT (replaces Worst Offender) ========== */
  priceAlert: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    borderWidth: 1.5,
    borderColor: Colors.accent,
    padding: 20,
    overflow: "hidden",
  },
  priceAlertBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Colors.accentSoft,
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginBottom: 12,
  },
  priceAlertBannerText: { fontFamily: Fonts.bold, fontSize: 10, letterSpacing: 0.6, color: Colors.accent },
  shrinkflationBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(230,53,53,0.12)",
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginBottom: 12,
  },
  shrinkflationBadgeText: { fontFamily: Fonts.bold, fontSize: 10, letterSpacing: 0.6, color: Colors.destructive },
  priceAlertName: {
    fontFamily: Fonts.extrabold,
    fontSize: 28,
    letterSpacing: -0.8,
    color: Colors.foreground,
  },
  priceAlertGrid: { marginTop: 18, flexDirection: "row", gap: 16 },
  priceAlertStatLabel: { fontFamily: Fonts.mono, fontSize: 10, letterSpacing: 0.5, color: Colors.mutedForeground },
  priceAlertStat: {
    marginTop: 3,
    fontFamily: Fonts.extrabold,
    fontSize: 20,
    letterSpacing: -0.5,
    color: Colors.accent,
    fontVariant: ["tabular-nums"],
  },
  priceAlertFooter: {
    marginTop: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
    paddingTop: 14,
  },
  priceAlertSince: { flex: 1, fontSize: 12, color: Colors.mutedForeground, fontFamily: Fonts.regular },

  /* ========== NEXT TRIP STRATEGY ========== */
  discoveryMission: {
    borderWidth: 1.5,
    borderColor: Colors.accent,
    backgroundColor: Colors.accentSoft,
    borderRadius: Radius.md,
    padding: 16,
  },
  discoveryTitle: { fontFamily: Fonts.extrabold, fontSize: 14, letterSpacing: -0.3, color: Colors.foreground },
  discoveryBody: { marginTop: 3, fontFamily: Fonts.regular, fontSize: 12.5, lineHeight: 18, color: Colors.mutedForeground },
  strategyRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: 14,
  },
  strategyName: { fontFamily: Fonts.bold, fontSize: 14, letterSpacing: -0.3, color: Colors.foreground },
  strategyVol: { marginTop: 2, fontFamily: Fonts.mono, fontSize: 10, letterSpacing: 0.3, color: Colors.mutedForeground },
  strategyAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: Colors.surface2,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  strategyActionText: { fontFamily: Fonts.bold, fontSize: 9, letterSpacing: 0.6, color: Colors.foreground },
  strategyActionStore: { fontFamily: Fonts.monoMedium, fontSize: 9, letterSpacing: 0.6, color: Colors.accent },

  /* ========== DATA COLLECTION ========== */
  dataCollectionCard: {
    marginTop: 14,
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 28,
    alignItems: "center",
  },
  progressBarLarge: {
    width: "100%",
    height: 10,
    borderRadius: 999,
    backgroundColor: Colors.muted,
    overflow: "hidden",
  },
  progressFillLarge: { height: "100%", borderRadius: 999, backgroundColor: Colors.accent },
  dataCollectionText: { marginTop: 16, fontFamily: Fonts.medium, fontSize: 15, color: Colors.foreground, letterSpacing: -0.3 },
  dataCollectionHint: { marginTop: 6, fontFamily: Fonts.regular, fontSize: 12, color: Colors.mutedForeground },

  /* ========== SHARED / LEGACY ========== */
  kicker: { fontFamily: Fonts.mono, fontSize: 11, letterSpacing: 1.5, color: Colors.mutedForeground },
  subtleSmall: { marginTop: 3, fontSize: 11.5, color: Colors.mutedForeground, fontFamily: Fonts.regular },
  section: { marginTop: 28, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border, paddingTop: 18 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  shareLink: { flexDirection: "row", alignItems: "center", gap: 5 },
  shareLinkText: { fontFamily: Fonts.bold, fontSize: 10, letterSpacing: 1, color: Colors.accent },
  hosRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: 16,
  },
  hosName: { fontFamily: Fonts.bold, fontSize: 15, letterSpacing: -0.3, color: Colors.foreground },
  hosPct: { fontFamily: Fonts.monoMedium, fontSize: 14, color: Colors.accent },
  hosVs: { marginTop: 3, fontFamily: Fonts.mono, fontSize: 9, letterSpacing: 0.5, color: Colors.mutedForeground },
  /* ========== STATEMENT ========== */
  statement: { marginTop: 36, backgroundColor: Colors.foreground, borderRadius: Radius.xl, padding: 24 },
  statementText: { fontFamily: Fonts.medium, fontSize: 20, lineHeight: 27, letterSpacing: -0.4, color: Colors.background },
  statementAccent: { fontFamily: Fonts.extrabold, color: Colors.accent },
  estimateValue: {
    marginTop: 4,
    fontFamily: Fonts.extrabold,
    fontSize: 28,
    letterSpacing: -1,
    color: Colors.foreground,
    fontVariant: ["tabular-nums"],
  },
  evidenceTrigger: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: 14,
  },
  evidenceCount: { fontFamily: Fonts.mono, fontSize: 10, letterSpacing: 0.5, color: Colors.mutedForeground },

  /* ========== EMPTY STATE ========== */
  emptyTitle: {
    fontFamily: Fonts.extrabold,
    fontSize: 42,
    lineHeight: 46,
    letterSpacing: -1.4,
    color: Colors.foreground,
  },
  emptyBody: { marginTop: 14, fontSize: 14.5, lineHeight: 21, color: Colors.mutedForeground, fontFamily: Fonts.regular },
  cta: {
    marginTop: 24,
    alignSelf: "stretch",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 56,
    paddingHorizontal: 28,
    borderRadius: 999,
    backgroundColor: Colors.accent,
    shadowColor: Colors.accent,
    shadowOpacity: 0.3,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  ctaText: { fontFamily: Fonts.bold, fontSize: 13, letterSpacing: 0.5, color: Colors.accentForeground },
  featureGrid: { marginTop: 18, flexDirection: "row", gap: 8, paddingHorizontal: 24 },
  featureCard: { padding: 13, overflow: "hidden" },
  featureCardOuter: { flex: 1, borderRadius: Radius.lg, overflow: "hidden", borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface },
  featureCardTitle: { marginTop: 10, fontFamily: Fonts.mono, fontSize: 10, letterSpacing: 1, color: Colors.accent },
  featureCardBody: { marginTop: 6, fontSize: 13, lineHeight: 18, color: Colors.mutedForeground, fontFamily: Fonts.regular },
});

const modalStyles = StyleSheet.create({
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
  },
  handle: { alignSelf: "center", width: 36, height: 5, borderRadius: 3, backgroundColor: Colors.borderStrong, marginBottom: 16 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  title: { fontFamily: Fonts.extrabold, fontSize: 20, letterSpacing: -0.5, color: Colors.foreground },
  empty: { fontFamily: Fonts.regular, fontSize: 14, color: Colors.mutedForeground, paddingVertical: 12 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  evidenceRow: { borderRadius: Radius.md, overflow: "hidden", marginBottom: 6, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface },
  itemName: { fontFamily: Fonts.semibold, fontSize: 14, color: Colors.foreground },
  itemMeta: { marginTop: 1, fontFamily: Fonts.mono, fontSize: 9.5, letterSpacing: 0.5, color: Colors.mutedForeground },
  itemPrice: { fontFamily: Fonts.bold, fontSize: 16, color: Colors.foreground, fontVariant: ["tabular-nums"] },

  /* ========== EVIDENCE MODAL SPIKE COMPARISON ========== */
  spikeIntro: { fontFamily: Fonts.medium, fontSize: 14, lineHeight: 20, color: Colors.mutedForeground, letterSpacing: -0.2, marginBottom: 20 },
  vsGrid: { flexDirection: "row", alignItems: "stretch", gap: 10, marginBottom: 8 },
  vsCard: {
    flex: 1,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    padding: 16,
    backgroundColor: Colors.surface,
    alignItems: "center",
  },
  vsCardAfter: { borderColor: Colors.accent, borderWidth: 1.5 },
  vsLabel: { fontFamily: Fonts.mono, fontSize: 10, letterSpacing: 0.8, color: Colors.mutedForeground, marginBottom: 6 },
  vsDate: { fontFamily: Fonts.semibold, fontSize: 13, color: Colors.foreground, marginBottom: 2 },
  vsStore: { fontFamily: Fonts.medium, fontSize: 12, color: Colors.mutedForeground, marginBottom: 10 },
  vsDivider: { width: "100%", height: StyleSheet.hairlineWidth, backgroundColor: Colors.border, marginBottom: 10 },
  vsPrice: { fontFamily: Fonts.extrabold, fontSize: 22, letterSpacing: -0.5, color: Colors.foreground, fontVariant: ["tabular-nums"] },
  vsUnit: { marginTop: 4, fontFamily: Fonts.mono, fontSize: 10, letterSpacing: 0.3, color: Colors.mutedForeground },
  vsArrow: { flex: 0, justifyContent: "center", alignItems: "center", paddingHorizontal: 2, minWidth: 56 },
  vsPct: { marginTop: 4, fontFamily: Fonts.bold, fontSize: 12, color: Colors.accent },
});
