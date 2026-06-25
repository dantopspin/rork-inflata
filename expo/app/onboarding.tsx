import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { ArrowRight, Bell, Check, ReceiptText, LineChart, ChevronLeft } from "lucide-react-native";
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Animated, { FadeInDown, FadeIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PaywallSheet } from "@/components/PaywallSheet";
import { Colors, Fonts, Radius } from "@/constants/theme";
import { fmtUSD } from "@/lib/format";
import { sendWalletAlertPreview, requestNotificationPermission } from "@/lib/notifications";
import { STAPLES, uuid } from "@/lib/seed";
import { useApp } from "@/providers/AppProvider";
import { Frequency, Scan } from "@/types";

const FREQS: { id: Frequency; label: string; sub: string }[] = [
  { id: "multi-week", label: "Multiple times per week", sub: "Grab-and-go shopper" },
  { id: "weekly", label: "About once a week", sub: "Standard cadence" },
  { id: "biweekly", label: "Every two weeks", sub: "Big-cart shopper" },
  { id: "monthly", label: "About once a month", sub: "Bulk shopper" },
];

// Sanitizes raw text input into a valid decimal string: single dot, max 2 decimal places.
function sanitizeDecimal(input: string): string {
  let cleaned = input.replace(/[^0-9.]/g, "");
  const firstDot = cleaned.indexOf(".");
  if (firstDot !== -1) {
    cleaned = cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, "");
  }
  const parts = cleaned.split(".");
  if (parts[1] && parts[1].length > 2) {
    cleaned = parts[0] + "." + parts[1].slice(0, 2);
  }
  return cleaned;
}

export default function Onboarding() {
  const insets = useSafeAreaInsets();
  const { completeOnboarding, setNotifications, subscribed, postOnboardingPaywallShown, markPostOnboardingPaywallShown } = useApp();

  const [step, setStep] = useState<0 | 1 | 2 | 3>(0);
  const [freq, setFreq] = useState<Frequency | null>(null);
  const [prices, setPrices] = useState<Record<string, string>>(
    Object.fromEntries(STAPLES.map((s) => [s.id, s.avgPrice.toFixed(2)])),
  );
  const [paywall, setPaywall] = useState<boolean>(false);

  const goBack = () => {
    if (Platform.OS !== "web") Haptics.selectionAsync();
    setStep((s) => (s > 0 ? ((s - 1) as 0 | 1 | 2 | 3) : s));
  };

  const fillAverages = () => {
    setPrices((p) => {
      const next = { ...p };
      for (const s of STAPLES) {
        if (!next[s.id] || Number.isNaN(parseFloat(next[s.id]))) next[s.id] = s.avgPrice.toFixed(2);
      }
      return next;
    });
  };

  const saveBaseline = () => {
    if (!freq) return;
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const items = STAPLES.map((s) => {
      const v = parseFloat(prices[s.id]);
      if (!Number.isFinite(v) || v <= 0) return null;
      return { itemKey: s.id, name: s.name, rawName: s.name.toUpperCase(), price: v };
    }).filter((x): x is NonNullable<typeof x> => !!x);

    const baseline: Scan = {
      id: "baseline-" + uuid(),
      date: ninetyDaysAgo,
      store: "Baseline estimate",
      items,
      source: "baseline_estimate",
    };
    completeOnboarding(freq, baseline);
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setStep(3);
  };

  const finishOnboarding = () => {
    if (!subscribed && !postOnboardingPaywallShown) {
      setPaywall(true);
    } else {
      router.replace("/(tabs)");
    }
  };

  const allowNotifications = async () => {
    const granted = await requestNotificationPermission();
    setNotifications(granted);
    if (granted) {
      // Illustrative example only — no real history exists yet at onboarding time.
      // Do NOT assert a specific dollar figure as fact about the user's actual spending.
      sendWalletAlertPreview(
        "Wallet alert",
        "Example alert: \"Eggs are up 12% since your last scan.\" You'll get these once you start tracking.",
      );
    }
    finishOnboarding();
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 8 }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 24}
        style={{ flex: 1 }}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: insets.bottom + 40 }}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.topRow}>
            {step > 0 && step < 3 ? (
              <Pressable onPress={goBack} style={styles.backBtn} hitSlop={10}>
                <ChevronLeft size={20} color={Colors.foreground} strokeWidth={2.5} />
              </Pressable>
            ) : (
              <View style={styles.backBtnSpacer} />
            )}
            <View style={styles.progress}>
              {[1, 2, 3].map((n) => (
                <View key={n} style={[styles.progressSeg, n <= step && styles.progressSegOn]} />
              ))}
            </View>
          </View>

          {step === 0 ? (
            <Animated.View entering={FadeInDown.duration(350)} style={{ marginTop: 40, alignItems: "center" }}>
              <View style={styles.introIcon}>
                <ReceiptText size={48} color={Colors.accent} strokeWidth={1.5} />
              </View>
              <Text style={styles.introTitle}>See what inflation is actually costing you.</Text>
              <Text style={styles.introBody}>
                Inflata tracks your grocery prices across every trip, showing you exactly
                which items are spiking — and how much more you&apos;re paying.
              </Text>
              <View style={styles.introFeatures}>
                {["Scan any grocery receipt in seconds.", "Track price changes across every item.", "Get alerts before your wallet takes a hit."].map((text) => (
                  <View key={text} style={styles.introFeatureRow}>
                    <LineChart size={16} color={Colors.accent} strokeWidth={2} />
                    <Text style={styles.introFeatureText}>{text}</Text>
                  </View>
                ))}
              </View>
              <Pressable
                onPress={() => {
                  if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  setStep(1);
                }}
                style={({ pressed }) => [styles.accentBtn, { width: "100%" }, pressed && { opacity: 0.9, transform: [{ scale: 0.98 }] }]}
              >
                <Text style={styles.accentBtnText}>GET STARTED</Text>
                <ArrowRight size={16} color={Colors.accentForeground} />
              </Pressable>
            </Animated.View>
          ) : null}

          {step === 1 ? (
            <Animated.View entering={FadeInDown.duration(350)} style={{ marginTop: 24 }}>
              <Text style={styles.kicker}>STEP 1 OF 3</Text>
              <Text style={styles.title}>How often do you buy groceries?</Text>
              <Text style={styles.body}>
                We use this to estimate the real dollar damage over time.
              </Text>
              <View style={{ marginTop: 24, gap: 10 }}>
                {FREQS.map((f) => (
                  <Pressable
                    key={f.id}
                    onPress={() => {
                      setFreq(f.id);
                      if (Platform.OS !== "web") Haptics.selectionAsync();
                    }}
                    style={[styles.freqCard, freq === f.id && styles.freqCardOn]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.freqLabel}>{f.label}</Text>
                      <Text style={styles.freqSub}>{f.sub}</Text>
                    </View>
                    <View style={[styles.radio, freq === f.id && styles.radioOn]}>
                      {freq === f.id ? <Check size={15} color={Colors.accentForeground} strokeWidth={3} /> : null}
                    </View>
                  </Pressable>
                ))}
              </View>
              <Pressable
                onPress={() => freq && setStep(2)}
                disabled={!freq}
                style={({ pressed }) => [
                  styles.darkBtn,
                  !freq && { opacity: 0.3 },
                  pressed && freq && { transform: [{ scale: 0.99 }] },
                ]}
              >
                <Text style={styles.darkBtnText}>CONTINUE</Text>
                <ArrowRight size={16} color={Colors.background} />
              </Pressable>
            </Animated.View>
          ) : null}

          {step === 2 ? (
            <Animated.View entering={FadeInDown.duration(350)} style={{ marginTop: 24 }}>
              <Text style={styles.kicker}>STEP 2 OF 3</Text>
              <Text style={styles.title}>What do you usually pay?</Text>
              <Text style={styles.body}>
                Best guess is fine — skip anything you&apos;re not sure about. Pre-filled with US
                national averages.
              </Text>

              <View style={styles.staplesCard}>
                {STAPLES.map((s) => (
                  <View key={s.id} style={styles.stapleRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.stapleName}>{s.name}</Text>
                      <Text style={styles.stapleUnit}>{s.unit.toUpperCase()}</Text>
                    </View>
                    <View style={styles.priceWrap}>
                      <Text style={styles.dollar}>$</Text>
                      <TextInput
                        value={prices[s.id] ?? ""}
                        placeholder={s.avgPrice.toFixed(2)}
                        placeholderTextColor={Colors.mutedForeground}
                        onChangeText={(t) =>
                          setPrices((p) => ({ ...p, [s.id]: sanitizeDecimal(t) }))
                        }
                        keyboardType="decimal-pad"
                        returnKeyType="done"
                        style={styles.priceField}
                      />
                    </View>
                  </View>
                ))}
              </View>

              <Pressable onPress={fillAverages} style={styles.ghostBtn}>
                <Text style={styles.ghostBtnText}>USE NATIONAL AVERAGES FOR ANYTHING I SKIPPED</Text>
              </Pressable>

              <View style={styles.note}>
                <Text style={styles.noteText}>
                  Saved as <Text style={styles.noteMono}>estimated baseline</Text> dated 90 days ago.
                  You&apos;ll see clear labels until real scans replace these.
                </Text>
              </View>

              <Pressable
                onPress={saveBaseline}
                style={({ pressed }) => [styles.accentBtn, pressed && { transform: [{ scale: 0.99 }] }]}
              >
                <Text style={styles.accentBtnText}>SEE MY DASHBOARD</Text>
                <ArrowRight size={16} color={Colors.accentForeground} />
              </Pressable>
            </Animated.View>
          ) : null}

          {step === 3 ? (
            <Animated.View entering={FadeInDown.duration(350)} style={{ marginTop: 48, alignItems: "center" }}>
              <Bell size={48} color={Colors.accent} />
              <Text style={styles.notifTitle}>Get alerted when prices cross your limits.</Text>
              <Text style={[styles.body, { textAlign: "center" }]}>
                Push alerts are a paid feature. Preview the kind you&apos;d get:
              </Text>
              <View style={styles.alertPreview}>
                <Text style={styles.alertKicker}>WALLET ALERT — EXAMPLE</Text>
                <Text style={styles.alertText}>
                  &quot;Eggs are up 12% since your last scan.&quot;
                </Text>
              </View>
              <Pressable
                onPress={allowNotifications}
                style={({ pressed }) => [styles.darkBtn, { width: "100%" }, pressed && { transform: [{ scale: 0.99 }] }]}
              >
                <Text style={styles.darkBtnText}>ALLOW NOTIFICATIONS</Text>
              </Pressable>
              <Pressable onPress={finishOnboarding} style={styles.notNow}>
                <Text style={styles.notNowText}>NOT NOW</Text>
              </Pressable>
            </Animated.View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>

      <PaywallSheet
        open={paywall}
        onClose={() => {
          setPaywall(false);
          markPostOnboardingPaywallShown();
          router.replace("/(tabs)");
        }}
        reason="Your groceries are getting more expensive. Know exactly how much."
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  topRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  backBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "flex-start" },
  backBtnSpacer: { width: 32, height: 32 },
  progress: { flex: 1, flexDirection: "row", gap: 6 },
  progressSeg: { flex: 1, height: 4, borderRadius: 999, backgroundColor: Colors.muted },
  progressSegOn: { backgroundColor: Colors.accent },
  introIcon: { width: 88, height: 88, borderRadius: 44, backgroundColor: Colors.accentSoft, alignItems: "center", justifyContent: "center", marginBottom: 28 },
  introTitle: { fontFamily: Fonts.extrabold, fontSize: 28, lineHeight: 34, letterSpacing: -0.8, color: Colors.foreground, textAlign: "center" },
  introBody: { marginTop: 14, fontSize: 14.5, lineHeight: 21, color: Colors.mutedForeground, fontFamily: Fonts.regular, textAlign: "center", paddingHorizontal: 8 },
  introFeatures: { marginTop: 28, gap: 12, width: "100%" },
  introFeatureRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  introFeatureText: { flex: 1, fontSize: 14, color: Colors.foreground, fontFamily: Fonts.medium },
  kicker: { fontFamily: Fonts.mono, fontSize: 10, letterSpacing: 1.5, color: Colors.accent },
  title: {
    marginTop: 12,
    fontFamily: Fonts.extrabold,
    fontSize: 30,
    lineHeight: 34,
    letterSpacing: -1,
    color: Colors.foreground,
  },
  body: { marginTop: 8, fontSize: 14, lineHeight: 20, color: Colors.mutedForeground, fontFamily: Fonts.regular },
  freqCard: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: 16,
  },
  freqCardOn: { borderColor: Colors.accent, backgroundColor: Colors.accentSoft },
  freqLabel: { fontFamily: Fonts.bold, fontSize: 15, letterSpacing: -0.3, color: Colors.foreground },
  freqSub: { marginTop: 2, fontSize: 12, color: Colors.mutedForeground, fontFamily: Fonts.regular },
  radio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  radioOn: { borderColor: Colors.accent, backgroundColor: Colors.accent },
  darkBtn: {
    marginTop: 32,
    height: 56,
    borderRadius: 999,
    backgroundColor: Colors.foreground,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  darkBtnText: { fontFamily: Fonts.bold, fontSize: 13, letterSpacing: 0.5, color: Colors.background },
  staplesCard: {
    marginTop: 24,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: 8,
  },
  stapleRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingVertical: 8 },
  stapleName: { fontFamily: Fonts.bold, fontSize: 14, letterSpacing: -0.3, color: Colors.foreground },
  stapleUnit: { marginTop: 2, fontFamily: Fonts.mono, fontSize: 9.5, letterSpacing: 0.5, color: Colors.mutedForeground },
  priceWrap: { position: "relative", justifyContent: "center" },
  dollar: { position: "absolute", left: 10, fontSize: 14, color: Colors.mutedForeground, zIndex: 1, fontFamily: Fonts.regular },
  priceField: {
    width: 96,
    height: 40,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
    borderRadius: Radius.sm,
    paddingLeft: 22,
    paddingRight: 8,
    textAlign: "right",
    fontFamily: Fonts.mono,
    fontSize: 14,
    color: Colors.foreground,
  },
  ghostBtn: { marginTop: 12, borderWidth: 1, borderColor: Colors.border, borderRadius: 999, paddingVertical: 11, alignItems: "center" },
  ghostBtnText: { fontFamily: Fonts.bold, fontSize: 10.5, letterSpacing: 0.5, color: Colors.mutedForeground },
  note: { marginTop: 16, backgroundColor: Colors.muted, borderRadius: Radius.md, paddingHorizontal: 12, paddingVertical: 10 },
  noteText: { fontSize: 11.5, lineHeight: 17, color: Colors.mutedForeground, fontFamily: Fonts.regular },
  noteMono: { fontFamily: Fonts.mono, fontSize: 11 },
  accentBtn: {
    marginTop: 24,
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
  accentBtnText: { fontFamily: Fonts.bold, fontSize: 13, letterSpacing: 0.5, color: Colors.accentForeground },
  notifTitle: {
    marginTop: 24,
    fontFamily: Fonts.extrabold,
    fontSize: 24,
    lineHeight: 28,
    letterSpacing: -0.6,
    color: Colors.foreground,
    textAlign: "center",
  },
  alertPreview: {
    marginTop: 24,
    width: "100%",
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: 16,
  },
  alertKicker: { fontFamily: Fonts.mono, fontSize: 10, letterSpacing: 1.5, color: Colors.accent },
  alertText: { marginTop: 4, fontFamily: Fonts.bold, fontSize: 14, letterSpacing: -0.3, color: Colors.foreground, lineHeight: 19 },
  notNow: { marginTop: 8, height: 48, alignItems: "center", justifyContent: "center" },
  notNowText: { fontFamily: Fonts.bold, fontSize: 11, letterSpacing: 1, color: Colors.mutedForeground },
});