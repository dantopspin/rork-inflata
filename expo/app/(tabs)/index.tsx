import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { ArrowRight, ChevronRight, CircleDollarSign, Hash, Lock, Receipt, Share2, X } from "lucide-react-native";
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
  confidence,
  inflationScore,
  painIndex,
  painLabel,
  realScanCount,
  totalSpendBaselineVsCurrent,
  withOverspend,
} from "@/lib/inflation";
import { useApp } from "@/providers/AppProvider";

/** Returns a dynamic color for the pain index track: green → amber → red-orange */
function painColor(score: number): string {
  if (score <= 25) return "#22C55E";
  if (score <= 50) return "#EAB308";
  if (score <= 75) return "#F97316";
  return Colors.accent;
}

export default function Dashboard() {
  const insets = useSafeAreaInsets();
  const { hydrated, scans, frequency, subscribed } = useApp();

  const realCount = realScanCount(scans);
  const stats = useMemo(() => withOverspend(aggregateItems(scans), frequency), [scans, frequency]);
  const inflation = useMemo(() => inflationScore(stats), [stats]);
  const totalDelta = useMemo(() => totalSpendBaselineVsCurrent(stats), [stats]);
  const pain = useMemo(() => painIndex(stats, totalDelta), [stats, totalDelta]);
  const conf = useMemo(() => confidence(scans, stats), [scans, stats]);

  const worst = useMemo(() => [...stats].sort((a, b) => b.pctChange - a.pctChange)[0], [stats]);
  const hallOfShame = useMemo(
    () => [...stats].filter((s) => s.pctChange > 0).sort((a, b) => b.pctChange - a.pctChange).slice(0, 3),
    [stats],
  );
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
        s.items.map((it) => ({ ...it, scanDate: s.date, store: s.store })),
      ),
    [recentScans],
  );
  const firstScanDate = useMemo(() => {
    const real = scans.filter((s) => s.source === "scan").map((s) => s.date).sort();
    return real[0];
  }, [scans]);

  const [paywall, setPaywall] = useState<boolean>(false);
  const [evidenceOpen, setEvidenceOpen] = useState<boolean>(false);

  if (!hydrated) {
    return <View style={styles.screen}><Header /></View>;
  }

  if (scans.length === 0) {
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
        contentContainerStyle={{ paddingTop: 8, paddingBottom: insets.bottom + 120 }}
        showsVerticalScrollIndicator={false}
        accessibilityLabel="Dashboard"
      >
        {/* Inflation Score */}
        <Animated.View entering={FadeInDown.duration(400)} style={{ paddingHorizontal: 22 }} accessibilityLabel={`Your personal inflation rate is ${fmtPct(inflation)}`}>
          <Text style={styles.kicker}>YOUR INFLATION</Text>
          <Text style={styles.bigScore}>{fmtPct(inflation)}</Text>
          <View style={styles.confRow}>
            <ConfidenceBadge c={conf} />
          </View>
          <Text style={styles.subtle}>
            Based on {realCount} {realCount === 1 ? "scan" : "scans"}
            {firstScanDate ? ` since ${fmtDate(firstScanDate)}` : ""}.
          </Text>
        </Animated.View>

        {/* Pain Index */}
        <Animated.View entering={FadeInDown.duration(400).delay(80)} style={[styles.section, { marginHorizontal: 22 }]} accessibilityLabel={`Grocery pain index: ${pain} out of 100. ${painLabel(pain)}`}>
          <View style={styles.painHead}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={styles.kicker}>GROCERY PAIN INDEX</Text>
              <Text style={styles.painLabel}>{painLabel(pain)}</Text>
            </View>
            <Text style={styles.painValue}>
              {pain}
              <Text style={styles.painOutOf}>/100</Text>
            </Text>
          </View>
          <View style={styles.track}>
            <View style={[styles.trackFill, { width: `${pain}%`, backgroundColor: painColor(pain) }]} />
          </View>
          <View style={{ marginTop: 12 }}>
            <ConfidenceBadge c={conf} />
          </View>
        </Animated.View>

        {/* Worst Offender */}
        {worst && worst.pctChange > 0 ? (
          <Animated.View entering={FadeInDown.duration(400).delay(150)} style={{ marginTop: 28, paddingHorizontal: 24 }}>
            <Pressable
              onPress={() => router.push(`/item/${worst.key}`)}
              style={({ pressed }) => [styles.worst, pressed && { transform: [{ scale: 0.99 }] }]}
              accessibilityRole="button"
              accessibilityLabel={`Worst offender: ${worst.name}, price spike ${fmtPct(worst.pctChange)}`}
            >
              <Text style={styles.worstGhost}>GUILTY</Text>
              <Text style={styles.worstKicker}>WORST OFFENDER</Text>
              <Text style={styles.worstName}>{worst.name}</Text>
              <View style={styles.worstGrid}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.worstStatLabel}>PRICE SPIKE</Text>
                  <Text style={styles.worstStat}>{fmtPct(worst.pctChange)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.worstStatLabel}>OUT OF POCKET</Text>
                  <Text style={styles.worstStat}>+{fmtUSD(Math.max(0, worst.dollarChange))}</Text>
                </View>
              </View>
              <View style={styles.worstFooter}>
                <Text style={styles.worstSince}>
                  Killing your budget since {fmtDateLong(worst.firstDate)}
                </Text>
                <ArrowRight size={16} color="rgba(255,255,255,0.85)" />
              </View>
            </Pressable>
          </Animated.View>
        ) : null}

        {/* Hall of Shame */}
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
                    <Text style={styles.subtleSmall}>+{fmtUSD(it.cumulativeOverspend)} extra this year</Text>
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

        {/* Extra spend statement */}
        {totalDelta > 0 ? (
          <Animated.View entering={FadeInDown.duration(400).delay(280)} style={[styles.statement, { marginHorizontal: 24 }]} accessibilityLabel={`Inflation has cost you an extra ${fmtUSD(totalDelta)} this month`}>
            <Text style={styles.statementText}>
              Inflation has cost you an extra{" "}
              <Text style={styles.statementAccent}>{fmtUSD(totalDelta)}</Text> this month vs. your
              baseline.
            </Text>
          </Animated.View>
        ) : null}

        {/* Recent evidence — button to open modal */}
        <Animated.View entering={FadeInDown.duration(400).delay(320)} style={[styles.section, { marginHorizontal: 24 }]}>
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

      <PaywallSheet open={paywall} onClose={() => setPaywall(false)} reason="Share unlocks with paid" />
      <RecentEvidenceModal visible={evidenceOpen} onClose={() => setEvidenceOpen(false)} items={recentItems} />
    </View>
  );
}

function RecentEvidenceModal({
  visible,
  onClose,
  items,
}: {
  visible: boolean;
  onClose: () => void;
  items: { name: string; price: number; store: string; scanDate: string; itemKey: string }[];
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <Animated.View entering={FadeIn.duration(180)} style={modalStyles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>
      <View style={modalStyles.anchor} pointerEvents="box-none">
        <Animated.View entering={SlideInUp.springify().dampingRatio(0.7).stiffness(280)} style={[modalStyles.sheet, { paddingBottom: insets.bottom + 20 }]}>
          <View style={modalStyles.handle} />
          <View style={modalStyles.header}>
            <Text style={modalStyles.title}>Recent Evidence</Text>
            <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Close evidence modal" accessibilityRole="button">
              <X size={20} color={Colors.mutedForeground} />
            </Pressable>
          </View>
          {items.length === 0 ? (
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
                  <View key={`${item.itemKey}-${i}`} style={modalStyles.evidenceRow}>
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
  kicker: { fontFamily: Fonts.mono, fontSize: 11, letterSpacing: 1.5, color: Colors.mutedForeground },
  bigScore: {
    marginTop: 4,
    fontFamily: Fonts.extrabold,
    fontSize: 64,
    lineHeight: 66,
    letterSpacing: -2.5,
    color: Colors.foreground,
    fontVariant: ["tabular-nums"],
  },
  confRow: { marginTop: 12 },
  subtle: { marginTop: 8, fontSize: 12.5, color: Colors.mutedForeground, fontFamily: Fonts.regular },
  subtleSmall: { marginTop: 3, fontSize: 11.5, color: Colors.mutedForeground, fontFamily: Fonts.regular },
  section: { marginTop: 28, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border, paddingTop: 18 },
  painHead: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" },
  painLabel: { marginTop: 6, fontFamily: Fonts.bold, fontSize: 18, letterSpacing: -0.4, color: Colors.foreground },
  painValue: {
    fontFamily: Fonts.extrabold,
    fontSize: 38,
    letterSpacing: -1.5,
    color: Colors.foreground,
    fontVariant: ["tabular-nums"],
  },
  painOutOf: { fontSize: 18, color: Colors.mutedForeground },
  track: { marginTop: 16, height: 8, borderRadius: 999, backgroundColor: Colors.muted, overflow: "hidden" },
  trackFill: { height: "100%", borderRadius: 999 },
  worst: {
    backgroundColor: Colors.accent,
    borderRadius: Radius.xl,
    padding: 24,
    overflow: "hidden",
    shadowColor: Colors.accent,
    shadowOpacity: 0.25,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  },
  worstGhost: {
    position: "absolute",
    right: -8,
    top: -14,
    fontFamily: Fonts.extrabold,
    fontSize: 88,
    color: "rgba(255,255,255,0.18)",
    transform: [{ rotate: "12deg" }],
  },
  worstKicker: { fontFamily: Fonts.mono, fontSize: 10, letterSpacing: 1.5, color: "rgba(255,255,255,0.8)" },
  worstName: {
    marginTop: 4,
    fontFamily: Fonts.extrabold,
    fontSize: 36,
    letterSpacing: -1,
    color: Colors.white,
  },
  worstGrid: { marginTop: 24, flexDirection: "row", gap: 16 },
  worstStatLabel: { fontFamily: Fonts.mono, fontSize: 10, letterSpacing: 0.5, color: "rgba(255,255,255,0.7)" },
  worstStat: {
    marginTop: 4,
    fontFamily: Fonts.extrabold,
    fontSize: 24,
    letterSpacing: -0.6,
    color: Colors.white,
    fontVariant: ["tabular-nums"],
  },
  worstFooter: {
    marginTop: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.25)",
    paddingTop: 16,
  },
  worstSince: { flex: 1, fontStyle: "italic", fontSize: 12, color: "rgba(255,255,255,0.9)", fontFamily: Fonts.medium },
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
  statement: { marginTop: 36, backgroundColor: Colors.foreground, borderRadius: Radius.xl, padding: 24 },
  statementText: { fontFamily: Fonts.medium, fontSize: 20, lineHeight: 27, letterSpacing: -0.4, color: Colors.background },
  statementAccent: { fontFamily: Fonts.extrabold, color: Colors.accent },
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
});
