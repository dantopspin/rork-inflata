import { router } from "expo-router";
import { ArrowLeft, Lock, Share2 } from "lucide-react-native";
import { useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { BlurView } from "expo-blur";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PaywallSheet } from "@/components/PaywallSheet";
import { HallOfShameCard } from "@/components/ShareCard";
import { Colors, Fonts } from "@/constants/theme";
import { aggregateItems, inflationScore, totalSpendBaselineVsCurrent, withOverspend } from "@/lib/inflation";
import { captureAndShare } from "@/lib/share";
import { fmtPct, fmtUSD } from "@/lib/format";
import { useApp } from "@/providers/AppProvider";

export default function ShareHallOfShame() {
  const insets = useSafeAreaInsets();
  const { width: screenW } = useWindowDimensions();
  const { scans, frequency, subscribed } = useApp();
  const [paywall, setPaywall] = useState<boolean>(false);
  const cardRef = useRef<View>(null);

  const stats = useMemo(() => aggregateItems(scans), [scans]);
  const overspent = useMemo(() => withOverspend(stats, frequency), [stats, frequency]);
  const totalExtra = useMemo(() => totalSpendBaselineVsCurrent(overspent), [overspent]);
  const top = useMemo(
    () => [...stats].filter((s) => s.pctChange > 0).sort((a, b) => b.pctChange - a.pctChange),
    [stats],
  );
  const inflation = useMemo(() => inflationScore(stats), [stats]);
  const hasShameToShow = top.length > 0 && Number.isFinite(inflation) && inflation > 0;
  const monthLabel = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });

  if (!subscribed) {
    return (
      <View
        style={[styles.screen, { paddingTop: insets.top + 24, paddingHorizontal: 24 }]}
        accessibilityLabel="Share cards require a subscription"
      >
        {/* Blurred / grayscale Hall of Shame card behind the lock */}
        {hasShameToShow ? (
          <View style={styles.lockedCardPreview}>
            <BlurView intensity={80} tint="light" style={StyleSheet.absoluteFill} />
            <View style={{ opacity: 0.35 }}>
              <HallOfShameCard items={top} inflation={inflation} monthLabel={monthLabel} />
            </View>
          </View>
        ) : null}

        <View style={{ alignItems: "center", marginTop: 16 }}>
          <Lock size={40} color={Colors.accent} />
          <Text style={styles.lockedKicker}>PAID FEATURE</Text>
          <Text style={styles.lockedTitle}>Share cards are locked.</Text>
          <Text style={styles.lockedBody}>
            Social proof is powerful. Unlock shareable Hall of Shame cards and show your friends what
            inflation is really doing.
          </Text>
          <Pressable
            onPress={() => setPaywall(true)}
            style={({ pressed }) => [styles.lockedBtn, pressed && { transform: [{ scale: 0.97 }] }]}
            accessibilityRole="button"
            accessibilityLabel="Unlock share cards"
          >
            <Text style={styles.lockedBtnText}>UNLOCK — FROM $3.99</Text>
          </Pressable>
          <Pressable
            onPress={() => router.replace("/(tabs)")}
            style={styles.lockedBack}
            hitSlop={8}
          >
            <Text style={styles.lockedBackText}>NOT NOW</Text>
          </Pressable>
        </View>

        <PaywallSheet
          open={paywall}
          onClose={() => setPaywall(false)}
          reason="Share cards are a paid feature"
          totalExtra={totalExtra}
        />
      </View>
    );
  }

  const shareCaption =
    totalExtra > 0
      ? `I'm paying ${fmtUSD(totalExtra)} extra this month for the same groceries. Tracked with Inflata.`
      : `My personal grocery inflation: ${fmtPct(inflation)}. Tracked with Inflata.`;

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 24, paddingTop: insets.top + 8, paddingBottom: insets.bottom + 48 }}
        showsVerticalScrollIndicator={false}
      >
        <Pressable
          onPress={() => router.back()}
          style={styles.backBtn}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ArrowLeft size={14} color={Colors.mutedForeground} />
          <Text style={styles.backText}>BACK</Text>
        </Pressable>

        {hasShameToShow ? (
          <>
            <Text style={styles.title}>Your share card</Text>
            <Text style={styles.body}>This is exactly how it will look when shared.</Text>

            <View style={{ marginTop: 24, alignItems: "center" }}>
              <View style={styles.previewFrame}>
                <View style={styles.previewTrim} />
                <View style={{ transform: [{ scale: Math.min(1, (screenW - 64) / 340) }] }}>
                  <HallOfShameCard ref={cardRef} items={top} inflation={inflation} monthLabel={monthLabel} />
                </View>
              </View>
            </View>

            <Pressable
              onPress={() => captureAndShare(cardRef, shareCaption)}
              style={({ pressed }) => [styles.shareBtn, pressed && { transform: [{ scale: 0.99 }] }]}
              accessibilityRole="button"
              accessibilityLabel="Share card as image"
            >
              <Share2 size={16} color={Colors.accentForeground} />
              <Text style={styles.shareBtnText}>EXPOSE THE SPIKES</Text>
            </Pressable>
          </>
        ) : (
          <View style={{ marginTop: 24 }}>
            <Text style={styles.title}>Your prices are stable. For now.</Text>
            <Text style={styles.body}>
              Keep scanning to catch the next spike before it hits your wallet. This card fills in
              the moment something surges.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  backBtn: { flexDirection: "row", alignItems: "center", gap: 5 },
  backText: { fontFamily: Fonts.bold, fontSize: 10, letterSpacing: 1, color: Colors.mutedForeground },
  title: { marginTop: 16, fontFamily: Fonts.extrabold, fontSize: 30, letterSpacing: -1, color: Colors.foreground },
  body: { marginTop: 8, fontSize: 14, color: Colors.mutedForeground, fontFamily: Fonts.regular },
  previewFrame: {
    backgroundColor: Colors.surface2,
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
    alignItems: "center",
    /* Drop shadow — makes the card look like a physical object sitting on the surface */
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  previewTrim: {
    position: "absolute",
    top: 0,
    right: 0,
    width: 48,
    height: 48,
    borderBottomLeftRadius: 20,
    backgroundColor: Colors.border,
    zIndex: 2,
  },
  shareBtn: {
    marginTop: 32,
    height: 56,
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
  /* Locked view — blurred card preview */
  lockedCardPreview: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  lockedKicker: { marginTop: 16, fontFamily: Fonts.mono, fontSize: 10, letterSpacing: 1.5, color: Colors.accent },
  lockedTitle: { marginTop: 8, fontFamily: Fonts.extrabold, fontSize: 24, letterSpacing: -0.6, color: Colors.foreground },
  lockedBody: { marginTop: 12, maxWidth: 300, textAlign: "center", fontSize: 14, lineHeight: 20, color: Colors.mutedForeground, fontFamily: Fonts.regular },
  lockedBtn: {
    marginTop: 28,
    height: 48,
    borderRadius: 999,
    backgroundColor: Colors.accent,
    paddingHorizontal: 28,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: Colors.accent,
    shadowOpacity: 0.3,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  lockedBtnText: { fontFamily: Fonts.bold, fontSize: 13, letterSpacing: 0.5, color: Colors.accentForeground },
  lockedBack: { marginTop: 12, height: 44, alignItems: "center", justifyContent: "center" },
  lockedBackText: { fontFamily: Fonts.bold, fontSize: 11, letterSpacing: 1, color: Colors.mutedForeground },
});
