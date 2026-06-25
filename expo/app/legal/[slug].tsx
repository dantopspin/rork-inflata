import { router, useLocalSearchParams } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Colors, Fonts } from "@/constants/theme";

type Block = { h?: string; p?: string };

const PAGES: Record<string, { title: string; body: Block[] }> = {
  privacy: {
    title: "Privacy Policy",
    body: [
      { p: "Inflata is built to be radically private. Every receipt you scan, every price you record, and every preference you set is stored only on this device." },
      { h: "What we collect" },
      { p: "Nothing. Inflata has no account system, no analytics service, and no server that receives your data. Receipt images are processed locally for line-item extraction and are not transmitted." },
      { h: "On-device storage" },
      { p: "Your scans, baseline estimates, shopping frequency, and notification preferences live in your phone's local storage. Clearing the app's data — either from Settings → Clear all data, or by uninstalling — permanently removes them." },
      { h: "Subscriptions" },
      { p: "Purchase verification is handled by the platform (Apple) and a third-party receipt manager (RevenueCat) so that subscriptions persist across devices and reinstalls. Only an anonymous app-installation identifier is sent. We never see your name, email, payment details, or receipts." },
      { h: "Children" },
      { p: "Inflata is not directed at children under 13 and we do not knowingly collect any data from them." },
      { h: "Contact" },
      { p: "Questions about this policy? Email privacy@inflata.app." },
    ],
  },
  terms: {
    title: "Terms of Service",
    body: [
      { p: "By using Inflata you agree to these terms." },
      { h: "Use of the app" },
      { p: "Inflata is provided as a personal informational tool. The price comparisons, inflation scores, and projections in the app are estimates based on the data you enter and are not financial advice." },
      { h: "Accuracy" },
      { p: "We try hard to extract line items accurately, but OCR is imperfect. You are responsible for confirming each scanned item before saving." },
      { h: "Subscriptions" },
      { p: "Paid plans renew automatically at the end of each billing period unless cancelled at least 24 hours before renewal in your App Store settings. Prices are shown at checkout in your local currency." },
      { h: "Termination" },
      { p: "You may stop using Inflata at any time. Cancellation in the App Store stops future renewals; the current period continues until expiry." },
      { h: "Liability" },
      { p: "To the maximum extent allowed by law, Inflata is provided as-is without warranty of any kind." },
    ],
  },
  about: {
    title: "About Inflata",
    body: [
      { p: "Inflata is an independent app built for everyday people who are watching their grocery bill creep up and want receipts — literal receipts — that prove it." },
      { h: "Why it exists" },
      { p: "National inflation numbers don't feel real. Your eggs, your milk, your weekly cart? Those feel real. Inflata tracks the prices you actually pay and shows you exactly how much they've moved." },
      { h: "How it works" },
      { p: "Scan a receipt. We extract line items and prices. Confirm. Repeat. Each new scan is compared to your own history — and we surface the spikes, the dollar damage, and the items quietly draining your wallet." },
      { h: "What it isn't" },
      { p: "It's not a budgeting app, not a coupon app, and not a finance tool. It is a receipt-bound record of what your groceries actually cost, kept entirely on your phone." },
    ],
  },
};

export default function Legal() {
  const insets = useSafeAreaInsets();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const page = slug ? PAGES[slug] : undefined;

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 24, paddingTop: insets.top + 8, paddingBottom: insets.bottom + 48 }}
        showsVerticalScrollIndicator={false}
      >
        <BackBtn />
        {page ? (
          <>
            <Text style={styles.title}>{page.title}</Text>
            <Text style={styles.updated}>LAST UPDATED JUNE 2026</Text>
            <View style={{ marginTop: 28, gap: 18 }}>
              {page.body.map((b, i) =>
                b.h ? (
                  <Text key={i} style={styles.h}>
                    {b.h}
                  </Text>
                ) : (
                  <Text key={i} style={styles.p}>
                    {b.p}
                  </Text>
                ),
              )}
            </View>
          </>
        ) : (
          <Text style={styles.title}>Page not found</Text>
        )}
      </ScrollView>
    </View>
  );
}

function BackBtn() {
  return (
    <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
      <ArrowLeft size={14} color={Colors.mutedForeground} />
      <Text style={styles.backText}>SETTINGS</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  backBtn: { flexDirection: "row", alignItems: "center", gap: 5 },
  backText: { fontFamily: Fonts.bold, fontSize: 10, letterSpacing: 1, color: Colors.mutedForeground },
  title: { marginTop: 24, fontFamily: Fonts.extrabold, fontSize: 30, lineHeight: 34, letterSpacing: -1, color: Colors.foreground },
  updated: { marginTop: 4, fontFamily: Fonts.mono, fontSize: 10, letterSpacing: 1, color: Colors.mutedForeground },
  h: { fontFamily: Fonts.extrabold, fontSize: 16, letterSpacing: -0.3, color: Colors.foreground },
  p: { fontSize: 15, lineHeight: 23, color: Colors.mutedForeground, fontFamily: Fonts.regular },
});
