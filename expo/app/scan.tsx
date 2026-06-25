import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import { Check, Image, Loader2, Trash2, X } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  SlideInUp,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PaywallSheet } from "@/components/PaywallSheet";
import { Colors, Fonts, Radius } from "@/constants/theme";
import { fmtUSD } from "@/lib/format";
import { normalize } from "@/lib/normalize";
import { scanReceipt } from "@/lib/ocr";
import { FREE_HARD_GATE_AT, STAPLES, uuid } from "@/lib/seed";
import { realScanCount } from "@/lib/inflation";
import { useApp } from "@/providers/AppProvider";
import { Scan } from "@/types";

type Stage = "permission" | "camera" | "scanning" | "review" | "saved" | "discovery" | "error";
type Editable = { id: string; rawName: string; name: string; priceStr: string; itemKey: string };

export default function ScanScreen() {
  const insets = useSafeAreaInsets();
  const { scans, subscribed, addScan, hasOnboarded } = useApp();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  const realCount = realScanCount(scans);
  const [stage, setStage] = useState<Stage>("camera");
  const [store, setStore] = useState<string>("");
  const [items, setItems] = useState<Editable[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [paywall, setPaywall] = useState<boolean>(false);
  const [savedSummary, setSavedSummary] = useState<{ spikes: number } | null>(null);
  const [capturedUri, setCapturedUri] = useState<string | null>(null);

  const hardGate = !subscribed && realCount + 1 > FREE_HARD_GATE_AT;

  // Prior price averages for rip-off guardrail (per itemKey)
  const priorAvgPrice = (() => {
    const m = new Map<string, { total: number; count: number }>();
    for (const s of scans) for (const it of s.items) {
      const e = m.get(it.itemKey) ?? { total: 0, count: 0 };
      e.total += it.price;
      e.count += 1;
      m.set(it.itemKey, e);
    }
    const avg = new Map<string, number>();
    for (const [k, v] of m) avg.set(k, v.total / v.count);
    return avg;
  })();

  // Best (cheapest) store per itemKey across all past scans
  const bestStoreMap = (() => {
    const m = new Map<string, { price: number; store: string }>();
    for (const s of scans) for (const it of s.items) {
      const existing = m.get(it.itemKey);
      if (!existing || it.price < existing.price) {
        m.set(it.itemKey, { price: it.price, store: s.store });
      }
    }
    return m;
  })();

  const pickFromGallery = async () => {
    if (hardGate) { setPaywall(true); return; }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 1,
        base64: false,
      });
      if (result.canceled || !result.assets[0]) return;
      const uri = result.assets[0].uri;
      setCapturedUri(uri);
      setStage("scanning");
      if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      const scanResult = await scanReceipt(uri);
      setStore(scanResult.store);
      setItems(
        scanResult.items.map((item) => {
          const n = normalize(item.name);
          return {
            id: uuid(),
            rawName: item.name.toUpperCase(),
            name: n.canonical,
            priceStr: item.price.toFixed(2),
            itemKey: n.key,
          };
        }),
      );
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setStage("review");
    } catch (err) {
      console.log("[scan] gallery OCR failed", err);
      setStage("error");
    }
  };

  // Determine initial stage based on permission
  const effectiveStage = ((): Stage => {
    if (stage === "camera" && !permission?.granted && permission?.canAskAgain !== false) {
      return "camera";
    }
    if (stage === "camera" && !permission?.granted) {
      return "camera"; // still show the camera UI with permission prompt
    }
    return stage;
  })();

  const handleCapture = async () => {
    if (!cameraRef.current) return;
    if (hardGate) { setPaywall(true); return; }
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      setStage("scanning");
      const photo = await cameraRef.current.takePictureAsync({ base64: false });
      if (!photo?.uri) throw new Error("No photo captured");
      setCapturedUri(photo.uri);

      // AI-powered OCR
      const result = await scanReceipt(photo.uri);
      setStore(result.store);
      setItems(
        result.items.map((item) => {
          const n = normalize(item.name);
          return {
            id: uuid(),
            rawName: item.name.toUpperCase(),
            name: n.canonical,
            priceStr: item.price.toFixed(2),
            itemKey: n.key,
          };
        }),
      );
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setStage("review");
    } catch (err) {
      console.log("[scan] AI OCR failed, using fallback", err);
      // Fallback: show error and allow retry
      setStage("error");
    }
  };

  const retryCapture = () => {
    setCapturedUri(null);
    setStage("camera");
  };

  const save = () => {
    const scanStore = store.trim() || "Unknown store";
    const cleaned = items
      .map((i) => ({
        rawName: i.rawName,
        name: i.name.trim(),
        price: Number.parseFloat(i.priceStr),
        itemKey: i.itemKey,
        originalStoreName: scanStore,
      }))
      .filter((i) => i.name && Number.isFinite(i.price) && i.price > 0);

    if (!cleaned.length) return;

    const wasFirstScan = realScanCount(scans) === 0;

    const priorPrice = new Map<string, number>();
    for (const s of scans) for (const it of s.items) priorPrice.set(it.itemKey, it.price);
    const spikes = cleaned.filter((c) => {
      const p = priorPrice.get(c.itemKey);
      return p && c.price > p * 1.05;
    }).length;

    const scan: Scan = {
      id: uuid(),
      date: new Date().toISOString(),
      store: scanStore,
      items: cleaned,
      source: "scan",
    };

    addScan(scan);
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    if (wasFirstScan) {
      setSavedSummary({ spikes });
      setStage("discovery");
    } else {
      setSavedSummary({ spikes });
      setStage("saved");
      setTimeout(() => {
        if (!hasOnboarded) router.replace("/onboarding");
        else router.replace("/(tabs)");
      }, 1500);
    }
  };

  const toggle = (id: string) =>
    setSelected((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const deleteSelected = () => {
    setItems((prev) => prev.filter((i) => !selected.has(i.id)));
    setSelected(new Set());
  };
  const deleteOne = (id: string) => setItems((prev) => prev.filter((i) => i.id !== id));

  return (
    <View style={styles.screen}>
      <View style={[styles.topbar, { paddingTop: insets.top + 8 }]}>
        <Pressable
          onPress={() => router.back()}
          accessibilityLabel="Cancel"
          style={styles.iconBtn}
          hitSlop={8}
        >
          <X size={20} color={Colors.white} />
        </Pressable>
        <Text style={styles.stageLabel}>
          {effectiveStage === "camera" && "AIM AT RECEIPT"}
          {effectiveStage === "scanning" && "READING…"}
          {effectiveStage === "review" && "CONFIRM ITEMS"}
          {effectiveStage === "saved" && "SAVED"}
          {effectiveStage === "discovery" && "INSIGHTS"}
          {effectiveStage === "error" && "SCAN FAILED"}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      {effectiveStage === "camera" ? (
        <Animated.View entering={FadeIn} exiting={FadeOut} style={{ flex: 1, paddingHorizontal: 20 }}>
          <View style={styles.viewfinder}>
            {permission?.granted ? (
              <CameraView
                ref={cameraRef}
                style={StyleSheet.absoluteFill}
                facing="back"
                mode="picture"
              />
            ) : null}
            <View style={styles.cropGuide} />
            <View style={styles.scanline} />
            {!permission?.granted ? (
              <View style={styles.demoNote}>
                <Text style={styles.demoNoteKicker}>CAMERA REQUIRED</Text>
                <Text style={styles.demoNoteText}>Allow camera access to scan receipts</Text>
                {permission?.canAskAgain !== false ? (
                  <Pressable
                    onPress={requestPermission}
                    style={styles.permissionBtn}
                    accessibilityRole="button"
                    accessibilityLabel="Enable camera permission"
                  >
                    <Text style={styles.permissionBtnText}>ENABLE CAMERA</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : (
              <View style={styles.demoNote}>
                <Text style={styles.demoNoteKicker}>POSITION RECEIPT</Text>
                <Text style={styles.demoNoteText}>Keep it flat and well-lit</Text>
              </View>
            )}
          </View>
          {permission?.granted ? (
            <View style={styles.captureRow}>
              <Pressable
                onPress={pickFromGallery}
                accessibilityLabel="Pick from gallery"
                style={({ pressed }) => [styles.galleryBtn, pressed && { transform: [{ scale: 0.93 }] }]}
              >
                <Image size={22} color={Colors.white} strokeWidth={2} />
              </Pressable>
              <Pressable
                onPress={handleCapture}
                accessibilityLabel="Capture"
                style={({ pressed }) => [styles.shutter, pressed && { transform: [{ scale: 0.93 }] }]}
              >
                <View style={styles.shutterInner} />
              </Pressable>
              <View style={{ width: 56 }} />
            </View>
          ) : null}
          <Text style={styles.shutterNote}>Images are processed securely via AI</Text>
        </Animated.View>
      ) : null}

      {effectiveStage === "scanning" ? (
        <Animated.View entering={FadeIn} exiting={FadeOut} style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.accent} />
          <Text style={styles.scanningKicker}>READING LINE ITEMS</Text>
          <Text style={styles.scanningTitle}>AI extracting prices…</Text>
          {capturedUri ? (
            <Text style={styles.scanningHint}>Analyzing your receipt</Text>
          ) : null}
        </Animated.View>
      ) : null}

      {effectiveStage === "error" ? (
        <Animated.View entering={FadeIn} exiting={FadeOut} style={styles.centered}>
          <View style={styles.errorCircle}>
            <X size={40} color={Colors.accentForeground} strokeWidth={3} />
          </View>
          <Text style={styles.scanningKicker}>SCAN FAILED</Text>
          <Text style={styles.scanningTitle}>Couldn't read this receipt.</Text>
          <Text style={styles.scanningHint}>Try again with better lighting</Text>
          <Pressable
            onPress={retryCapture}
            style={({ pressed }) => [styles.retryBtn, pressed && { transform: [{ scale: 0.97 }] }]}
          >
            <Text style={styles.retryBtnText}>TRY AGAIN</Text>
          </Pressable>
        </Animated.View>
      ) : null}

      {effectiveStage === "review" ? (
        <ReviewView
          insets={insets}
          store={store}
          setStore={setStore}
          items={items}
          setItems={setItems}
          selected={selected}
          toggle={toggle}
          deleteSelected={deleteSelected}
          deleteOne={deleteOne}
          onSave={save}
          gated={hardGate && !subscribed}
          onUpgrade={() => setPaywall(true)}
          priorAvgPrice={priorAvgPrice}
          bestStoreMap={bestStoreMap}
        />
      ) : null}

      {effectiveStage === "saved" ? (
        <Animated.View entering={FadeIn} style={styles.centered}>
          <View style={styles.savedCheck}>
            <Check size={40} color={Colors.accentForeground} strokeWidth={3} />
          </View>
          <Text style={styles.scanningKicker}>SCAN COMPLETE</Text>
          <Text style={styles.savedTitle}>
            {savedSummary && savedSummary.spikes > 0
              ? `${savedSummary.spikes} ${savedSummary.spikes === 1 ? "item" : "items"} spiked this trip.`
              : "Logged. No spikes this trip."}
          </Text>
        </Animated.View>
      ) : null}

      {effectiveStage === "discovery" ? (
        <InflationDiscovery
          insets={insets}
          items={items}
          onContinue={() => {
            if (!hasOnboarded) router.replace("/onboarding");
            else router.replace("/(tabs)");
          }}
        />
      ) : null}

      <PaywallSheet
        open={paywall}
        onClose={() => setPaywall(false)}
        reason={`Free limit: ${FREE_HARD_GATE_AT} scans`}
      />
    </View>
  );
}

function ReviewView({
  insets,
  store,
  setStore,
  items,
  setItems,
  selected,
  toggle,
  deleteSelected,
  deleteOne,
  onSave,
  gated,
  onUpgrade,
  priorAvgPrice,
  bestStoreMap,
}: {
  insets: { top: number; bottom: number };
  store: string;
  setStore: (s: string) => void;
  items: Editable[];
  setItems: (u: (prev: Editable[]) => Editable[]) => void;
  selected: Set<string>;
  toggle: (id: string) => void;
  deleteSelected: () => void;
  deleteOne: (id: string) => void;
  onSave: () => void;
  gated: boolean;
  onUpgrade: () => void;
  priorAvgPrice: Map<string, number>;
  bestStoreMap: Map<string, { price: number; store: string }>;
}) {
  // Haptic warning if any item has spiked >10% vs prior average
  useEffect(() => {
    const hasSpike = items.some((it) => {
      const price = Number.parseFloat(it.priceStr);
      const avg = priorAvgPrice.get(it.itemKey);
      return avg !== undefined && avg > 0 && price > avg * 1.1;
    });
    if (hasSpike && Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    }
  }, []);
  return (
    <Animated.View entering={SlideInUp.springify().stiffness(300).damping(20)} style={styles.reviewSheet}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 24, paddingBottom: 140 }}
          showsVerticalScrollIndicator={false}
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
            <View>
              <Text style={styles.fieldLabel}>STORE</Text>
              <TextInput
                value={store}
                onChangeText={setStore}
                placeholder="Where you shopped"
                placeholderTextColor={Colors.mutedForeground}
                returnKeyType="done"
                style={styles.storeInput}
              />

              <View style={styles.lineHead}>
                <Text style={styles.fieldLabel}>LINE ITEMS ({items.length})</Text>
                {selected.size > 0 ? (
                  <Pressable onPress={deleteSelected} style={styles.batchDelete} hitSlop={6}>
                    <Trash2 size={13} color={Colors.destructiveForeground} />
                    <Text style={styles.batchDeleteText}>Delete {selected.size}</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          </TouchableWithoutFeedback>

          <View style={{ marginTop: 8 }}>
            {items.map((it) => {
              const price = Number.parseFloat(it.priceStr);
              const avg = priorAvgPrice.get(it.itemKey);
              const best = bestStoreMap.get(it.itemKey);
              const isSpike = avg !== undefined && avg > 0 && price > avg * 1.1;
              return (
              <SwipeRow key={it.id} onDelete={() => deleteOne(it.id)}>
                <View style={styles.itemRow}>
                  <Pressable
                    onPress={() => toggle(it.id)}
                    accessibilityLabel="Select"
                    style={[styles.checkbox, selected.has(it.id) && styles.checkboxOn]}
                    hitSlop={8}
                  >
                    {selected.has(it.id) ? (
                      <Check size={13} color={Colors.accentForeground} strokeWidth={3} />
                    ) : null}
                  </Pressable>
                  <View style={{ flex: 1, gap: 4 }}>
                    <View style={styles.itemInputs}>
                      <TextInput
                        value={it.name}
                        onChangeText={(t) =>
                          setItems((prev) => prev.map((p) => (p.id === it.id ? { ...p, name: t } : p)))
                        }
                        placeholder="Item name"
                        placeholderTextColor={Colors.mutedForeground}
                        returnKeyType="done"
                        style={styles.nameInput}
                      />
                      <View style={styles.priceWrap}>
                        <TextInput
                          value={it.priceStr}
                          onChangeText={(t) =>
                            setItems((prev) =>
                              prev.map((p) =>
                                p.id === it.id ? { ...p, priceStr: t.replace(/[^0-9.]/g, "") } : p,
                              ),
                            )
                          }
                          keyboardType="decimal-pad"
                          returnKeyType="done"
                          style={[styles.priceInput, isSpike && styles.priceInputSpike]}
                        />
                        {isSpike ? (
                          <Text style={styles.spikeBadge}>SPIKE</Text>
                        ) : null}
                      </View>
                    </View>
                    {isSpike ? (
                      <Text style={styles.spikeWarn}>
                        {((price - avg!) / avg! * 100).toFixed(0)}% above your avg of ${avg!.toFixed(2)}
                      </Text>
                    ) : null}
                    {avg !== undefined ? (
                      <Text style={styles.storeHint}>
                        Avg: ${avg.toFixed(2)}{best ? ` | Best: $${best.price.toFixed(2)} at ${best.store}` : ""}
                      </Text>
                    ) : (
                      <Text style={styles.ocrLabel}>AI read: {it.rawName}</Text>
                    )}
                  </View>
                </View>
              </SwipeRow>
              );
            })}
          </View>
        </ScrollView>

        <View style={[styles.saveBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          {gated ? (
            <Pressable
              onPress={onUpgrade}
              style={({ pressed }) => [styles.saveBtnDark, pressed && { transform: [{ scale: 0.99 }] }]}
            >
              <Text style={styles.saveBtnDarkText}>UPGRADE TO SAVE SCAN</Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={onSave}
              style={({ pressed }) => [styles.saveBtn, pressed && { transform: [{ scale: 0.99 }] }]}
            >
              <Text style={styles.saveBtnText}>SAVE &amp; COMPARE</Text>
            </Pressable>
          )}
        </View>
      </KeyboardAvoidingView>
    </Animated.View>
  );
}

function InflationDiscovery({
  insets,
  items,
  onContinue,
}: {
  insets: { top: number; bottom: number };
  items: Editable[];
  onContinue: () => void;
}) {
  const matches = items
    .map((it) => {
      const staple = STAPLES.find(
        (s) => s.id === it.itemKey || s.name.toLowerCase() === it.name.toLowerCase(),
      );
      return staple
        ? { name: it.name, scanned: Number.parseFloat(it.priceStr), avg: staple.avgPrice, unit: staple.unit }
        : null;
    })
    .filter((m): m is NonNullable<typeof m> => !!m && Number.isFinite(m.scanned));

  const overspent = matches.filter((m) => m.scanned > m.avg);
  const totalOverspend = overspent.reduce((sum, m) => sum + (m.scanned - m.avg), 0);

  return (
    <Animated.View entering={SlideInUp.springify().stiffness(300).damping(20)} style={styles.reviewSheet}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 24, paddingBottom: insets.bottom + 120 }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.discoveryKicker}>INFLATION DISCOVERY</Text>
        <Text style={styles.discoveryTitle}>
          {totalOverspend > 0
            ? `You could save ${fmtUSD(totalOverspend)} right now.`
            : "Your prices beat the national average."}
        </Text>
        <Text style={styles.discoveryBody}>
          {totalOverspend > 0
            ? "Here's how your scanned prices compare to the US national average. The green numbers show what you'd pay at a budget store."
            : "Every item you scanned came in at or below the US national average. Nice work."}
        </Text>

        <View style={styles.discoveryCard}>
          {matches.map((m, i) => {
            const over = m.scanned > m.avg;
            return (
              <View
                key={m.name + i}
                style={[
                  styles.discoveryRow,
                  i === matches.length - 1 && { borderBottomWidth: 0 },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.discoveryItemName}>{m.name}</Text>
                  <Text style={styles.discoveryItemUnit}>{m.unit}</Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={[styles.discoveryPrice, over && styles.discoveryPriceHigh]}>
                    {fmtUSD(m.scanned)}
                  </Text>
                  <Text style={styles.discoveryAvg}>
                    Avg: {fmtUSD(m.avg)}
                  </Text>
                  {over ? (
                    <Text style={styles.discoveryDelta}>
                      +{fmtUSD(m.scanned - m.avg)} over
                    </Text>
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>

        {totalOverspend > 0 ? (
          <View style={styles.discoveryCallout}>
            <Text style={styles.discoveryCalloutText}>
              That's {fmtUSD(totalOverspend)} in <Text style={{ fontFamily: Fonts.extrabold }}>potential savings</Text> you'd
              pocket by switching to the store with the lowest price on each item.
            </Text>
          </View>
        ) : null}

        <Pressable
          onPress={onContinue}
          style={({ pressed }) => [styles.discoveryBtn, pressed && { transform: [{ scale: 0.99 }] }]}
        >
          <Text style={styles.discoveryBtnText}>GO TO DASHBOARD</Text>
        </Pressable>
      </ScrollView>
    </Animated.View>
  );
}

function SwipeRow({ children, onDelete }: { children: React.ReactNode; onDelete: () => void }) {
  const tx = useSharedValue<number>(0);
  const pan = Gesture.Pan()
    .activeOffsetX([-12, 12])
    .onUpdate((e) => {
      tx.value = Math.min(0, Math.max(-120, e.translationX));
    })
    .onEnd(() => {
      if (tx.value < -90) {
        tx.value = withSpring(-400, { damping: 30 });
        runOnJS(onDelete)();
      } else {
        tx.value = withSpring(0, { damping: 20 });
      }
    });

  const style = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }] }));

  return (
    <View style={styles.swipeWrap}>
      <View style={styles.swipeDeleteBg}>
        <View style={styles.swipeDeletePill}>
          <Text style={styles.swipeDeleteText}>DELETE</Text>
        </View>
      </View>
      <GestureDetector gesture={pan}>
        <Animated.View style={[styles.swipeContent, style]}>{children}</Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.foreground },
  topbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  stageLabel: { fontFamily: Fonts.mono, fontSize: 10, letterSpacing: 1.5, color: "rgba(255,255,255,0.7)" },
  viewfinder: {
    marginTop: 8,
    flex: 1,
    maxHeight: 520,
    borderRadius: Radius.xxl,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: "#0A0A0A",
    overflow: "hidden",
  },
  cropGuide: {
    position: "absolute",
    top: 24,
    left: 24,
    right: 24,
    bottom: 24,
    borderRadius: Radius.md,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.4)",
    borderStyle: "dashed",
    zIndex: 1,
  },
  scanline: {
    position: "absolute",
    left: 48,
    right: 48,
    top: 56,
    height: 3,
    backgroundColor: Colors.accent,
    shadowColor: Colors.accent,
    shadowOpacity: 0.9,
    shadowRadius: 12,
    zIndex: 1,
  },
  demoNote: { position: "absolute", bottom: 24, left: 0, right: 0, alignItems: "center", zIndex: 1 },
  demoNoteKicker: { fontFamily: Fonts.mono, fontSize: 10, letterSpacing: 1.5, color: "rgba(255,255,255,0.6)" },
  demoNoteText: { marginTop: 4, fontSize: 12, color: "rgba(255,255,255,0.8)", fontFamily: Fonts.regular },
  permissionBtn: {
    marginTop: 16,
    backgroundColor: Colors.accent,
    borderRadius: 999,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  permissionBtnText: { fontFamily: Fonts.bold, fontSize: 12, letterSpacing: 0.5, color: Colors.accentForeground },
  captureRow: { marginTop: 28, flexDirection: "row", alignItems: "center", justifyContent: "space-evenly" },
  galleryBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "rgba(255,255,255,0.15)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
    alignItems: "center",
    justifyContent: "center",
  },
  shutter: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.accent,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 4,
    borderColor: "rgba(255,255,255,0.2)",
    shadowColor: Colors.accent,
    shadowOpacity: 0.4,
    shadowRadius: 18,
    elevation: 8,
  },
  shutterInner: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 3,
    borderColor: Colors.white,
  },
  shutterNote: { marginTop: 16, textAlign: "center", fontSize: 12, color: "rgba(255,255,255,0.6)", fontFamily: Fonts.regular },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 40 },
  scanningKicker: { marginTop: 24, fontFamily: Fonts.mono, fontSize: 11, letterSpacing: 1.5, color: "rgba(255,255,255,0.7)" },
  scanningTitle: { marginTop: 8, fontFamily: Fonts.bold, fontSize: 18, color: Colors.white },
  scanningHint: { marginTop: 8, fontSize: 13, color: "rgba(255,255,255,0.6)", fontFamily: Fonts.regular },
  errorCircle: { width: 80, height: 80, borderRadius: 40, backgroundColor: Colors.destructive, alignItems: "center", justifyContent: "center" },
  retryBtn: {
    marginTop: 24,
    height: 48,
    borderRadius: 999,
    backgroundColor: Colors.accent,
    paddingHorizontal: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  retryBtnText: { fontFamily: Fonts.bold, fontSize: 13, letterSpacing: 0.5, color: Colors.accentForeground },
  savedCheck: { width: 80, height: 80, borderRadius: 40, backgroundColor: Colors.accent, alignItems: "center", justifyContent: "center" },
  savedTitle: { marginTop: 8, fontFamily: Fonts.extrabold, fontSize: 24, letterSpacing: -0.6, color: Colors.white, textAlign: "center" },
  reviewSheet: {
    flex: 1,
    marginTop: 8,
    backgroundColor: Colors.background,
    borderTopLeftRadius: Radius.xxl,
    borderTopRightRadius: Radius.xxl,
  },
  fieldLabel: { fontFamily: Fonts.mono, fontSize: 10, letterSpacing: 1.5, color: Colors.mutedForeground },
  storeInput: {
    marginTop: 4,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    paddingVertical: 8,
    fontSize: 18,
    fontFamily: Fonts.bold,
    letterSpacing: -0.4,
    color: Colors.foreground,
  },
  lineHead: { marginTop: 24, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  batchDelete: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Colors.destructive,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  batchDeleteText: { fontFamily: Fonts.bold, fontSize: 11, color: Colors.destructiveForeground },
  swipeWrap: { overflow: "hidden", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border },
  swipeDeleteBg: { ...StyleSheet.absoluteFillObject, alignItems: "flex-end", justifyContent: "center", paddingRight: 16 },
  swipeDeletePill: { backgroundColor: Colors.destructive, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  swipeDeleteText: { fontFamily: Fonts.bold, fontSize: 11, color: Colors.destructiveForeground, letterSpacing: 0.5 },
  swipeContent: { backgroundColor: Colors.background },
  itemRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingVertical: 12 },
  checkbox: {
    marginTop: 4,
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxOn: { borderColor: Colors.accent, backgroundColor: Colors.accent },
  itemInputs: { flexDirection: "row", gap: 12, alignItems: "center" },
  nameInput: { flex: 1, fontSize: 14, fontFamily: Fonts.semibold, letterSpacing: -0.3, color: Colors.foreground, paddingVertical: 4 },
  priceInput: {
    width: 88,
    backgroundColor: Colors.muted,
    borderRadius: Radius.sm,
    paddingVertical: 6,
    paddingHorizontal: 8,
    textAlign: "right",
    fontFamily: Fonts.mono,
    fontSize: 14,
    color: Colors.foreground,
  },
  priceInputSpike: {
    backgroundColor: "rgba(245,72,27,0.12)",
    color: Colors.accent,
  },
  priceWrap: { flexDirection: "row", alignItems: "center", gap: 4 },
  spikeBadge: {
    fontFamily: Fonts.mono,
    fontSize: 8,
    letterSpacing: 1,
    color: Colors.accentForeground,
    backgroundColor: Colors.accent,
    borderRadius: 3,
    paddingHorizontal: 4,
    paddingVertical: 1,
    overflow: "hidden",
  },
  spikeWarn: { fontFamily: Fonts.mono, fontSize: 9.5, letterSpacing: 0.3, color: Colors.accent },
  storeHint: { fontFamily: Fonts.mono, fontSize: 9.5, letterSpacing: 0.3, color: Colors.mutedForeground },
  ocrLabel: { fontFamily: Fonts.mono, fontSize: 9.5, letterSpacing: 0.3, color: "rgba(115,115,115,0.7)" },
  saveBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
    backgroundColor: "rgba(250,249,245,0.97)",
    paddingHorizontal: 20,
    paddingTop: 14,
  },
  saveBtn: {
    height: 56,
    borderRadius: 999,
    backgroundColor: Colors.accent,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: Colors.accent,
    shadowOpacity: 0.3,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  saveBtnText: { fontFamily: Fonts.bold, fontSize: 13, letterSpacing: 0.5, color: Colors.accentForeground },
  saveBtnDark: { height: 56, borderRadius: 999, backgroundColor: Colors.foreground, alignItems: "center", justifyContent: "center" },
  saveBtnDarkText: { fontFamily: Fonts.bold, fontSize: 13, letterSpacing: 0.5, color: Colors.background },

  // Inflation Discovery
  discoveryKicker: { fontFamily: Fonts.mono, fontSize: 11, letterSpacing: 1.5, color: Colors.accent },
  discoveryTitle: {
    marginTop: 8,
    fontFamily: Fonts.extrabold,
    fontSize: 28,
    lineHeight: 32,
    letterSpacing: -0.8,
    color: Colors.foreground,
  },
  discoveryBody: { marginTop: 8, fontSize: 14, lineHeight: 20, color: Colors.mutedForeground, fontFamily: Fonts.regular },
  discoveryCard: {
    marginTop: 24,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    overflow: "hidden",
  },
  discoveryRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  discoveryItemName: { fontFamily: Fonts.bold, fontSize: 14, letterSpacing: -0.3, color: Colors.foreground },
  discoveryItemUnit: { marginTop: 2, fontFamily: Fonts.mono, fontSize: 9.5, letterSpacing: 0.5, color: Colors.mutedForeground },
  discoveryPrice: { fontFamily: Fonts.bold, fontSize: 16, color: "#22a06b", fontVariant: ["tabular-nums"] },
  discoveryPriceHigh: { color: Colors.accent },
  discoveryAvg: { marginTop: 2, fontFamily: Fonts.mono, fontSize: 10, letterSpacing: 0.3, color: Colors.mutedForeground },
  discoveryDelta: { fontFamily: Fonts.mono, fontSize: 9, letterSpacing: 0.3, color: Colors.destructive },
  discoveryCallout: {
    marginTop: 20,
    backgroundColor: Colors.accentSoft,
    borderRadius: Radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  discoveryCalloutText: { fontSize: 14, lineHeight: 20, color: Colors.foreground, fontFamily: Fonts.regular },
  discoveryBtn: {
    marginTop: 32,
    height: 56,
    borderRadius: 999,
    backgroundColor: Colors.accent,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: Colors.accent,
    shadowOpacity: 0.3,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  discoveryBtnText: { fontFamily: Fonts.bold, fontSize: 13, letterSpacing: 0.5, color: Colors.accentForeground },
});
