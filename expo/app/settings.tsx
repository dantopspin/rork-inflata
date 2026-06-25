import * as FileSystem from "expo-file-system/legacy";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import * as Sharing from "expo-sharing";
import {
  Bell,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  Lock,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react-native";
import React, { useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import Animated, { FadeIn, SlideInUp } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PaywallSheet } from "@/components/PaywallSheet";
import { Colors, Fonts, Radius } from "@/constants/theme";
import { cancelAllScheduled, requestNotificationPermission } from "@/lib/notifications";
import { useApp } from "@/providers/AppProvider";
import { Frequency } from "@/types";

const APP_NAME = "INFLATA";
const APP_VERSION = "1.0";

const FREQ_LABELS: Record<Frequency, string> = {
  "multi-week": "Multiple times per week",
  weekly: "Once a week",
  biweekly: "Every two weeks",
  monthly: "Once a month",
};

export default function Settings() {
  const insets = useSafeAreaInsets();
  const {
    frequency,
    setFrequency,
    notificationsEnabled: notifications,
    setNotifications,
    subscribed,
    entitlement,
    restorePurchases,
    cancelSubscription,
    scans,
    clearAll,
  } = useApp();

  const [paywall, setPaywall] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [restoreMsg, setRestoreMsg] = useState<string | null>(null);
  const [restoreOk, setRestoreOk] = useState(false);
  const [freqOpen, setFreqOpen] = useState(false);

  const rowCount = scans.flatMap((s) => s.items).length;

  const planLabel = subscribed
    ? entitlement.plan
      ? `Paid · ${entitlement.plan.charAt(0).toUpperCase() + entitlement.plan.slice(1)}`
      : "Paid"
    : "Free";

  const exportCsv = async () => {
    if (!subscribed) { setPaywall(true); return; }
    const rows: string[][] = [["date", "store", "item", "price", "source"]];
    for (const s of scans)
      for (const it of s.items)
        rows.push([s.date, s.store, it.name, String(it.price), s.source]);
    const csv = rows
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    try {
      const uri = `${FileSystem.cacheDirectory}receiptrage_export.csv`;
      await FileSystem.writeAsStringAsync(uri, csv);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: "text/csv",
          dialogTitle: `Export ${APP_NAME} data`,
        });
      }
    } catch (e) {
      console.log("[settings] csv export failed", e);
    }
  };

  // Guard the Switch: don't let it flip visually for unsubscribed users.
  const toggleNotifications = async (v: boolean) => {
    if (!subscribed) { setPaywall(true); return; }
    if (v) {
      const granted = await requestNotificationPermission();
      setNotifications(granted);
    } else {
      setNotifications(false);
      await cancelAllScheduled();
    }
  };

  const handleRestore = async () => {
    setRestoreMsg(null);
    setRestoreOk(false);
    const ok = await restorePurchases();
    setRestoreOk(ok);
    setRestoreMsg(ok ? "Subscription restored successfully." : "No active subscription found.");
  };

  const selectFrequency = (f: Frequency) => {
    setFrequency(f);
    setFreqOpen(false);
    if (Platform.OS !== "web") Haptics.selectionAsync();
  };

  return (
    <View style={styles.screen}>
      {/* Navigation Bar */}
      <View style={[styles.navBar, { paddingTop: insets.top }]}>
        <Pressable
          onPress={() => {
            if (Platform.OS !== "web") Haptics.selectionAsync();
            router.back();
          }}
          hitSlop={12}
          accessibilityLabel="Go back"
        >
          <ChevronLeft size={24} color={Colors.foreground} />
        </Pressable>
        <Text style={styles.navTitle}>Settings</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 24,
          paddingTop: 20,
          paddingBottom: insets.bottom + 120,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── PLAN ── */}
        <Section title={`PLAN  ·  ${planLabel.toUpperCase()}`} isFirst>
          {subscribed ? (
            <>
              {confirmCancel ? (
                <View style={styles.confirmBox}>
                  <Text style={styles.confirmTitle}>Cancel subscription?</Text>
                  <Text style={styles.confirmBody}>
                    You'll keep access until the end of your billing period. This action opens
                    the App Store — Apple manages all billing.
                  </Text>
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
                    <Pressable onPress={() => { cancelSubscription(); setConfirmCancel(false); }} style={styles.eraseBtn}>
                      <Text style={styles.eraseBtnText}>MANAGE IN APP STORE</Text>
                    </Pressable>
                    <Pressable onPress={() => setConfirmCancel(false)} style={styles.cancelBtn}>
                      <Text style={styles.cancelBtnText}>KEEP PLAN</Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <Row
                  label="Manage subscription"
                  hint="Renews automatically"
                  onPress={() => setConfirmCancel(true)}
                  chevron
                />
              )}
            </>
          ) : (
            <Row
              label={`Upgrade to ${APP_NAME}`}
              hint="Unlimited scans · share cards · alerts · CSV export"
              onPress={() => setPaywall(true)}
              accent
              chevron
            />
          )}
          <Row
            label="Restore purchases"
            icon={RotateCcw}
            onPress={handleRestore}
          />
          {restoreMsg ? (
            <Text style={[styles.inlineMsg, { color: restoreOk ? Colors.accent : Colors.destructive }]}>
              {restoreMsg}
            </Text>
          ) : null}
        </Section>

        {/* ── TRACKING ── */}
        <Section title="TRACKING">
          <Row
            label="Shopping frequency"
            hint={frequency ? FREQ_LABELS[frequency] : "Not set"}
            onPress={() => setFreqOpen(true)}
            chevron
          />
          {/* Switch row: for unsubscribed users the switch is visually locked — 
              value is always false, onValueChange shows paywall instead of toggling */}
          <View style={styles.toggleRow}>
            {subscribed
              ? <Bell size={20} color={Colors.accent} />
              : <Lock size={20} color={Colors.mutedForeground} />
            }
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>Push notifications</Text>
              <Text style={styles.rowHint}>
                {subscribed ? "Wallet alerts · milestones · weekly digest" : "Paid feature — upgrade to enable"}
              </Text>
            </View>
            <Switch
              value={subscribed ? notifications : false}
              onValueChange={toggleNotifications}
              trackColor={{ true: Colors.accent, false: Colors.muted }}
              thumbColor={Colors.white}
              disabled={false} // intercept at handler level, not here
            />
          </View>
        </Section>

        {/* ── DATA ── */}
        <Section title="DATA">
          <Row
            label="Export as CSV"
            hint={subscribed ? `${rowCount} price records` : "Paid feature — upgrade to export"}
            icon={subscribed ? Download : Lock}
            onPress={exportCsv}
          />
          {confirmClear ? (
            <View style={styles.confirmBox}>
              <Text style={styles.confirmTitle}>Erase all data?</Text>
              <Text style={styles.confirmBody}>
                Permanently deletes every receipt, scan, and price record stored on this device.
                There are no backups. This cannot be undone.
              </Text>
              <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
                <Pressable
                  onPress={async () => {
                    await clearAll();
                    setConfirmClear(false);
                    router.replace("/(tabs)");
                  }}
                  style={styles.eraseBtn}
                >
                  <Text style={styles.eraseBtnText}>ERASE EVERYTHING</Text>
                </Pressable>
                <Pressable onPress={() => setConfirmClear(false)} style={styles.cancelBtn}>
                  <Text style={styles.cancelBtnText}>CANCEL</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Row
              label="Clear all data"
              hint="Permanently erases everything on this device"
              icon={Trash2}
              onPress={() => setConfirmClear(true)}
              destructive
            />
          )}
        </Section>

        {/* ── ABOUT ── */}
        <Section title="ABOUT">
          <Row label={`About ${APP_NAME}`} onPress={() => router.push("/legal/about")} chevron />
          <Row label="Privacy Policy" onPress={() => router.push("/legal/privacy")} chevron />
          <Row label="Terms of Service" onPress={() => router.push("/legal/terms")} chevron />
        </Section>

        <Text style={styles.footer}>
          {APP_NAME.toUpperCase()} V{APP_VERSION} · ALL DATA LIVES ON THIS DEVICE
        </Text>
      </ScrollView>

      <PaywallSheet open={paywall} onClose={() => setPaywall(false)} reason="Paid feature" />

      <FrequencyModal
        visible={freqOpen}
        current={frequency}
        onSelect={selectFrequency}
        onClose={() => setFreqOpen(false)}
      />
    </View>
  );
}

// ─────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────

function Section({ title, children, isFirst }: { title: string; children: React.ReactNode; isFirst?: boolean }) {
  const kids = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={{ marginTop: isFirst ? 0 : 24 }}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionDivider} />
      <View style={styles.sectionGroup}>
        {kids.map((child, i) => (
          <View key={i}>
            {child}
            {i < kids.length - 1 && <View style={styles.rowDivider} />}
          </View>
        ))}
      </View>
    </View>
  );
}

function Row({
  label,
  hint,
  onPress,
  icon: Icon,
  accent,
  destructive,
  chevron,
}: {
  label: string;
  hint?: string;
  onPress?: () => void;
  icon?: React.ComponentType<{ size: number; color: string }>;
  accent?: boolean;
  destructive?: boolean;
  chevron?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        destructive && styles.rowDestructive,
        pressed && { backgroundColor: Colors.muted },
      ]}
    >
      {Icon && (
        <Icon
          size={20}
          color={
            destructive ? Colors.destructive
            : accent ? Colors.accent
            : Colors.mutedForeground
          }
        />
      )}
      <View style={{ flex: 1 }}>
        <Text
          style={[
            styles.rowLabel,
            destructive && { color: Colors.destructive },
            accent && { color: Colors.accent },
          ]}
        >
          {label}
        </Text>
        {hint ? <Text style={styles.rowHint}>{hint}</Text> : null}
      </View>
      {/* Only show chevron when explicitly requested — not on every row */}
      {chevron && !destructive && (
        <ChevronRight size={16} color="rgba(115,115,115,0.5)" />
      )}
    </Pressable>
  );
}

function FrequencyModal({
  visible,
  current,
  onSelect,
  onClose,
}: {
  visible: boolean;
  current: Frequency | null;
  onSelect: (f: Frequency) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <Animated.View entering={FadeIn.duration(180)} style={freqStyles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>
      <View style={freqStyles.anchor} pointerEvents="box-none">
        <Animated.View
          entering={SlideInUp.springify().dampingRatio(0.7).stiffness(280)}
          style={freqStyles.sheet}
        >
          <View style={freqStyles.handle} />
          <View style={freqStyles.header}>
            <Text style={freqStyles.title}>Shopping frequency</Text>
            <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Close">
              <X size={20} color={Colors.mutedForeground} />
            </Pressable>
          </View>
          <Text style={freqStyles.subtitle}>
            Used to estimate real dollar damage and time notification cadence.
          </Text>
          <View style={freqStyles.options}>
            {(
              [
                ["multi-week", "Multiple times per week", "Grab-and-go shopper"],
                ["weekly", "Once a week", "Standard cadence"],
                ["biweekly", "Every two weeks", "Big-cart shopper"],
                ["monthly", "Once a month", "Bulk shopper"],
              ] as const
            ).map(([id, label, sub]) => (
              <Pressable
                key={id}
                onPress={() => onSelect(id)}
                style={({ pressed }) => [
                  freqStyles.option,
                  current === id && freqStyles.optionSelected,
                  pressed && { transform: [{ scale: 0.99 }] },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={freqStyles.optionLabel}>{label}</Text>
                  <Text style={freqStyles.optionSub}>{sub}</Text>
                </View>
                <View style={[freqStyles.radio, current === id && freqStyles.radioOn]}>
                  {current === id && (
                    <Check size={15} color={Colors.accentForeground} strokeWidth={3} />
                  )}
                </View>
              </Pressable>
            ))}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

// ─────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },

  kicker: {
    fontFamily: Fonts.mono,
    fontSize: 10,
    letterSpacing: 1.5,
    color: Colors.mutedForeground,
  },
  title: {
    marginTop: 6,
    fontFamily: Fonts.extrabold,
    fontSize: 30,
    letterSpacing: -1,
    color: Colors.foreground,
  },

  sectionTitle: {
    paddingHorizontal: 2,
    fontFamily: Fonts.mono,
    fontSize: 10,
    letterSpacing: 1.5,
    color: Colors.mutedForeground,
    marginBottom: 6,
  },
  sectionDivider: {
    height: 1,
    backgroundColor: Colors.border,
    marginBottom: 10,
  },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    padding: 16,
  },
  rowDestructive: {},
  rowLabel: {
    fontFamily: Fonts.bold,
    fontSize: 14,
    letterSpacing: -0.3,
    color: Colors.foreground,
  },
  rowHint: {
    marginTop: 2,
    fontSize: 12,
    color: Colors.mutedForeground,
    fontFamily: Fonts.regular,
  },

  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    padding: 16,
  },

  inlineMsg: {
    marginTop: 4,
    paddingHorizontal: 4,
    fontSize: 12,
    fontFamily: Fonts.medium,
  },

  confirmBox: {
    backgroundColor: "rgba(230,53,53,0.05)",
    padding: 16,
  },
  confirmTitle: {
    fontFamily: Fonts.bold,
    fontSize: 14,
    color: Colors.destructive,
  },
  confirmBody: {
    marginTop: 4,
    fontSize: 12,
    color: Colors.mutedForeground,
    fontFamily: Fonts.regular,
    lineHeight: 17,
  },
  eraseBtn: {
    flex: 1,
    backgroundColor: Colors.destructive,
    borderRadius: 999,
    paddingVertical: 11,
    alignItems: "center",
  },
  eraseBtnText: {
    fontFamily: Fonts.bold,
    fontSize: 11,
    letterSpacing: 0.5,
    color: Colors.destructiveForeground,
  },
  cancelBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 999,
    paddingVertical: 11,
    alignItems: "center",
  },
  cancelBtnText: {
    fontFamily: Fonts.bold,
    fontSize: 11,
    letterSpacing: 0.5,
    color: Colors.foreground,
  },

  sectionGroup: {
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
  },
  rowDivider: {
    height: 1,
    backgroundColor: Colors.border,
  },

  navBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.background,
  },
  navTitle: {
    fontFamily: Fonts.bold,
    fontSize: 17,
    letterSpacing: -0.3,
    color: Colors.foreground,
  },

  footer: {
    marginTop: 48,
    textAlign: "center",
    fontFamily: Fonts.mono,
    fontSize: 9.5,
    letterSpacing: 1,
    color: Colors.mutedForeground,
  },
});

const freqStyles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.overlay,
  },
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
});