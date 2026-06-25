import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { Check, TrendingDown, X } from "lucide-react-native";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated, { FadeIn, SlideInDown } from "react-native-reanimated";

import { Colors, Fonts, Radius } from "@/constants/theme";
import { getOfferingsForPaywall, PlanId } from "@/lib/subscription";
import { useApp } from "@/providers/AppProvider";

const FEATURES = [
  "Price Spike Alerts — catch hikes before checkout",
  "Store Comparison — see where each item is cheapest",
  "Unlimited receipt scans — track every trip",
  "Shareable Hall of Shame & spike cards",
  "Full Spending Trends & category breakdowns",
];

type PlanMeta = { price: string; cadence: string };

export function PaywallSheet({
  open,
  onClose,
  reason,
}: {
  open: boolean;
  onClose: () => void;
  reason?: string;
}) {
  const { subscribe, restorePurchases } = useApp();
  const [busy, setBusy] = useState<PlanId | "restore" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [planMeta, setPlanMeta] = useState<Record<PlanId, PlanMeta>>({
    monthly: { price: "$3.99", cadence: "/ month" },
    annual: { price: "$29.99", cadence: "/ year" },
  });

  useEffect(() => {
    if (!open) return;
    // Web doesn't configure Purchases — use fallback prices.
    if (Platform.OS === "web") return;
    (async () => {
      try {
        const offerings = await getOfferingsForPaywall();
        const offering = offerings?.current;
        if (!offering) return;
        const monthlyPkg = offering.monthly ?? offering.availablePackages.find((pkg) => pkg.identifier === "monthly");
        const annualPkg = offering.annual ?? offering.availablePackages.find((pkg) => pkg.identifier === "annual");
        const next: Record<PlanId, PlanMeta> = { ...planMeta };
        if (monthlyPkg?.product) {
          next.monthly = {
            price: monthlyPkg.product.priceString,
            cadence: "/ month",
          };
        }
        if (annualPkg?.product) {
          next.annual = {
            price: annualPkg.product.priceString,
            cadence: "/ year",
          };
        }
        setPlanMeta(next);
      } catch {
        // keep defaults
      }
    })();
  }, [open]);

  const handleSubscribe = async (plan: PlanId) => {
    setError(null);
    setBusy(plan);
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const result = await subscribe(plan);
    setBusy(null);
    if (result.ok) {
      if (Platform.OS !== "web")
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onClose();
    } else {
      setError(result.error ?? "Purchase couldn't be completed. You weren't charged.");
    }
  };

  const handleRestore = async () => {
    setError(null);
    setBusy("restore");
    const ok = await restorePurchases();
    setBusy(null);
    if (ok) {
      onClose();
    } else {
      setError("No active subscription found to restore.");
    }
  };

  return (
    <Modal visible={open} transparent animationType="none" onRequestClose={onClose}>
      <Animated.View entering={FadeIn.duration(180)} style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>

      <View style={[styles.anchor, { pointerEvents: "box-none" }]}>
        <Animated.View entering={SlideInDown.springify().dampingRatio(0.7).stiffness(280)} style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.kicker}>PREMIUM</Text>
            <Pressable
              onPress={onClose}
              hitSlop={12}
              style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.6 }]}
              accessibilityLabel="Close paywall"
              accessibilityRole="button"
            >
              <X size={20} color={Colors.mutedForeground} />
            </Pressable>
          </View>

          {reason ? <Text style={styles.reason}>{reason.toUpperCase()}</Text> : null}
          <Text style={styles.title}>
            Stop the overspend.{"\n"}
            <Text style={{ color: Colors.accent }}>Know every price before you pay.</Text>
          </Text>

          <View style={styles.plans}>
            <PlanCard
              title="Monthly"
              price={planMeta.monthly.price}
              cadence={planMeta.monthly.cadence}
              loading={busy === "monthly"}
              disabled={busy !== null}
              onPress={() => handleSubscribe("monthly")}
              accessibilityLabel={`Monthly plan: ${planMeta.monthly.price}${planMeta.monthly.cadence}`}
            />
            <PlanCard
              title="Annual"
              price={planMeta.annual.price}
              cadence={planMeta.annual.cadence}
              badge="Save 37%"
              primary
              loading={busy === "annual"}
              disabled={busy !== null}
              onPress={() => handleSubscribe("annual")}
              accessibilityLabel={`Annual plan: ${planMeta.annual.price}${planMeta.annual.cadence}. Save 37 percent`}
            />
          </View>

          <View style={styles.features}>
            {FEATURES.map((line) => (
              <View key={line} style={styles.featureRow}>
                <Check size={16} color={Colors.accent} strokeWidth={2.5} />
                <Text style={styles.featureText}>{line}</Text>
              </View>
            ))}
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <View style={styles.footer}>
            <Pressable onPress={handleRestore} disabled={busy !== null} hitSlop={8} accessibilityRole="button" accessibilityLabel="Restore purchases">
              <Text style={styles.footerLink}>
                {busy === "restore" ? "Restoring…" : "Restore purchases"}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => {
                onClose();
                router.push("/legal/privacy");
              }}
              hitSlop={8}
            >
              <Text style={styles.footerLink}>Privacy policy</Text>
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

function PlanCard({
  title,
  price,
  cadence,
  badge,
  primary,
  loading,
  disabled,
  onPress,
}: {
  title: string;
  price: string;
  cadence: string;
  badge?: string;
  primary?: boolean;
  loading?: boolean;
  disabled?: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.planCard,
        primary ? styles.planPrimary : styles.planSecondary,
        pressed && { transform: [{ scale: 0.98 }] },
      ]}
    >
      {badge ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge}</Text>
        </View>
      ) : null}
      <Text style={[styles.planTitle, primary && { color: "rgba(255,255,255,0.7)" }]}>
        {title.toUpperCase()}
      </Text>
      <Text style={[styles.planPrice, primary && { color: Colors.white }]}>{price}</Text>
      <Text style={[styles.planCadence, primary && { color: "rgba(255,255,255,0.7)" }]}>
        {cadence}
      </Text>
      <View style={styles.planCta}>
        {loading ? (
          <ActivityIndicator size="small" color={primary ? Colors.accent : Colors.accent} />
        ) : (
          <>
            <TrendingDown size={14} color={Colors.accent} />
            <Text style={styles.planCtaText}>Stop the Overspend</Text>
          </>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: Colors.overlay },
  anchor: { flex: 1, justifyContent: "flex-end" },
  sheet: {
    backgroundColor: Colors.background,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 32,
  },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  kicker: {
    fontFamily: Fonts.mono,
    fontSize: 10,
    letterSpacing: 1.5,
    color: Colors.mutedForeground,
  },
  closeBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  reason: {
    marginTop: 8,
    fontFamily: Fonts.mono,
    fontSize: 10,
    letterSpacing: 1.5,
    color: Colors.accent,
  },
  title: {
    marginTop: 8,
    fontFamily: Fonts.extrabold,
    fontSize: 28,
    lineHeight: 32,
    letterSpacing: -0.8,
    color: Colors.foreground,
  },
  plans: { marginTop: 24, flexDirection: "row", gap: 12 },
  planCard: { flex: 1, borderRadius: Radius.lg, padding: 16, overflow: "hidden" },
  planSecondary: { borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface },
  planPrimary: { backgroundColor: Colors.foreground },
  badge: {
    position: "absolute",
    right: 10,
    top: 10,
    backgroundColor: Colors.accent,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeText: {
    fontFamily: Fonts.mono,
    fontSize: 9,
    letterSpacing: 0.5,
    color: Colors.accentForeground,
  },
  planTitle: {
    fontFamily: Fonts.mono,
    fontSize: 10,
    letterSpacing: 1.5,
    color: Colors.mutedForeground,
  },
  planPrice: {
    marginTop: 12,
    fontFamily: Fonts.extrabold,
    fontSize: 24,
    letterSpacing: -0.6,
    color: Colors.foreground,
    fontVariant: ["tabular-nums"],
  },
  planCadence: { fontSize: 12, color: Colors.mutedForeground, fontFamily: Fonts.regular },
  planCta: { marginTop: 16, flexDirection: "row", alignItems: "center", gap: 6, minHeight: 18 },
  planCtaText: {
    fontFamily: Fonts.bold,
    fontSize: 11,
    letterSpacing: 0.3,
    color: Colors.accent,
    textTransform: "uppercase",
  },
  features: {
    marginTop: 24,
    borderTopWidth: 1,
    borderColor: Colors.border,
    paddingTop: 20,
    gap: 10,
  },
  featureRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  featureText: { flex: 1, fontSize: 14, color: Colors.foreground, fontFamily: Fonts.regular },
  error: {
    marginTop: 16,
    fontSize: 12.5,
    color: Colors.destructive,
    fontFamily: Fonts.medium,
    lineHeight: 18,
  },
  footer: {
    marginTop: 20,
    borderTopWidth: 1,
    borderColor: Colors.border,
    paddingTop: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  footerLink: { fontSize: 11.5, color: Colors.mutedForeground, fontFamily: Fonts.medium },
});
