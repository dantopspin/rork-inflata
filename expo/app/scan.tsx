import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import { AlertTriangle, Check, Image, Loader2, Trash2, X } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
import { FREE_HARD_GATE_AT, STAPLES, uuid, type Staple } from "@/lib/seed";
import { realScanCount } from "@/lib/inflation";
import { useApp } from "@/providers/AppProvider";
import { Scan } from "@/types";

type Stage = "permission" | "camera" | "scanning" | "review" | "saved" | "discovery" | "error";
type Editable = { id: string; rawName: string; name: string; priceStr: string; itemKey: string; unitQuantity?: number; unitMeasure?: string; category?: string; type?: "regular" | "promo" | "discount" };

export default function ScanScreen() {
  const insets = useSafeAreaInsets();
  const { scans, subscribed, addScan, hasOnboarded } = useApp();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  const realCount = realScanCount(scans);
  const [stage, setStage] = useState<Stage>("camera");
  const [errorMessage, setErrorMessage] = useState<string>("");
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
            unitQuantity: item.quantity,
            unitMeasure: item.unit,
            category: item.category,
            type: item.type,
          };
        }),
      );
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setStage("review");
    } catch (err) {
      console.log("[scan] gallery OCR failed", err);
      const code = (err as any).code as string | undefined;
      // Pass the error code as a prefix so the error screen can pattern-match.
      // Format: "CODE: human message" when a code exists; raw message otherwise.
      const prefix = code ? `${code}: ` : "";
      const body = err instanceof Error ? err.message : String(err ?? "");
      setErrorMessage(prefix + body);
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
            unitQuantity: item.quantity,
            unitMeasure: item.unit,
            category: item.category,
            type: item.type,
          };
        }),
      );
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setStage("review");
    } catch (err) {
      console.log("[scan] AI OCR failed, using fallback", err);
      const code = (err as any).code as string | undefined;
      const prefix = code ? `${code}: ` : "";
      const body = err instanceof Error ? err.message : String(err ?? "");
      setErrorMessage(prefix + body);
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
        unitQuantity: i.unitQuantity,
        unitMeasure: i.unitMeasure,
        category: i.category,
        type: i.type,
      }))
      .filter((i) => {
        if (!i.name) return false;
        if (!Number.isFinite(i.price)) return false;
        // Allow price 0 only for promo/discount items
        if (i.price <= 0 && i.type !== "promo" && i.type !== "discount") return false;
        return true;
      });

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
          <Text style={styles.scanningTitle}>
            {errorMessage.includes("OFFLINE")
              ? "No internet connection."
              : errorMessage.includes("INVALID_IMAGE")
                ? "Please scan a clear receipt."
                : errorMessage.includes("TIMEOUT")
                  ? "Request timed out. Check your connection."
                  : errorMessage.includes("HTTP_401") || errorMessage.includes("HTTP_403")
                    ? "Authentication error. Check app configuration."
                    : errorMessage.includes("HTTP_404")
                      ? "OCR model not found. Check model configuration."
                      : errorMessage.includes("HTTP_413") || errorMessage.includes("IMAGE_TOO_LARGE")
                        ? "Image too large. Try a smaller receipt."
                        : "Couldn't read this receipt."}
          </Text>
          <Text style={styles.scanningHint}>
            {errorMessage.includes("OFFLINE")
              ? "Scanning requires a connection to process your receipt. Please connect to Wi-Fi or mobile data and try again."
              : errorMessage.includes("INVALID_IMAGE")
                ? "This doesn't look like a grocery receipt. Try a different image."
                : errorMessage.includes("TIMEOUT")
                  ? "The server took too long to respond. Please try again."
                  : errorMessage.includes("HTTP_401") || errorMessage.includes("HTTP_403")
                    ? "The app is missing a valid API key. Please contact support."
                    : errorMessage.includes("HTTP_404")
                      ? "The AI model is misconfigured. Please contact support."
                      : errorMessage.includes("HTTP_413") || errorMessage.includes("IMAGE_TOO_LARGE")
                        ? "Try cropping to just the receipt area."
                        : "Try again with better lighting and a flat surface."}
          </Text>
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
          isFirstScan={realScanCount(scans) === 0}
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
  isFirstScan,
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
  isFirstScan: boolean;
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

  // Cross-Store Price Check: compute total potential savings vs cheapest store
  const crossStoreSavings = (() => {
    let totalSaved = 0;
    const storeSavings = new Map<string, number>();
    for (const it of items) {
      const price = Number.parseFloat(it.priceStr);
      if (!Number.isFinite(price)) continue;
      const best = bestStoreMap.get(it.itemKey);
      if (best && best.price < price) {
        const diff = price - best.price;
        totalSaved += diff;
        storeSavings.set(best.store, (storeSavings.get(best.store) ?? 0) + diff);
      }
    }
    let topStore = "";
    let topStoreSaved = 0;
    for (const [st, saved] of storeSavings) {
      if (saved > topStoreSaved) { topStoreSaved = saved; topStore = st; }
    }
    const hasSavings = totalSaved > 0 && items.some((it) => bestStoreMap.has(it.itemKey));
    return { totalSaved, topStore, topStoreSaved, hasSavings };
  })();

  // First-scan National Average Comparison
  const nationalComparison = (() => {
    if (!isFirstScan) return null;
    const matches: { name: string; scanned: number; avg: number; over: boolean }[] = [];
    for (const it of items) {
      const staple = STAPLES.find((s) => s.id === it.itemKey);
      if (!staple) continue;
      const scanned = Number.parseFloat(it.priceStr);
      if (!Number.isFinite(scanned)) continue;
      const normalized = normalizeToStapleUnit(it.rawName, staple, scanned);
      if (normalized === null) continue;
      matches.push({ name: it.name, scanned: normalized, avg: staple.avgPrice, over: normalized > staple.avgPrice });
    }
    if (!matches.length) return null;
    const totalOver = matches.filter((m) => m.over).reduce((s, m) => s + (m.scanned - m.avg), 0);
    return { matches, totalOver };
  })();

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

          {/* Cross-Store Price Check — savings summary */}
          {crossStoreSavings.hasSavings ? (
            <View style={styles.savingsSummary}>
              <Text style={styles.savingsSummaryKicker}>CROSS-STORE PRICE CHECK</Text>
              <Text style={styles.savingsSummaryValue}>
                You could save {fmtUSD(crossStoreSavings.totalSaved)}
              </Text>
              <Text style={styles.savingsSummaryHint}>
                by shopping at {crossStoreSavings.topStore || "another store"} for these items
              </Text>
            </View>
          ) : null}

          {/* First-Scan National Average Comparison */}
          {nationalComparison ? (
            <View style={styles.nationalCard}>
              <Text style={styles.savingsSummaryKicker}>NATIONAL AVERAGE COMPARISON</Text>
              {nationalComparison.totalOver > 0 ? (
                <Text style={styles.nationalTitle}>
                  {fmtUSD(nationalComparison.totalOver)} above national avg
                </Text>
              ) : (
                <Text style={[styles.nationalTitle, { color: Colors.success }]}>
                  At or below national averages
                </Text>
              )}
              <View style={{ gap: 6, marginTop: 12 }}>
                {nationalComparison.matches.slice(0, 4).map((m) => (
                  <View key={m.name} style={styles.nationalRow}>
                    <Text style={styles.nationalItemName}>{m.name}</Text>
                    <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
                      <Text style={[styles.nationalItemPrice, m.over && { color: Colors.accent }]}>
                        {fmtUSD(m.scanned)}
                      </Text>
                      <Text style={styles.nationalItemAvg}>Avg {fmtUSD(m.avg)}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

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
                    {/* Inline quantity & unit editors */}
                    <View style={styles.unitInputsRow}>
                      <TextInput
                        value={it.unitQuantity != null ? String(it.unitQuantity) : ""}
                        onChangeText={(t) => {
                          const n = Number.parseFloat(t);
                          setItems((prev) => prev.map((p) => (p.id === it.id ? { ...p, unitQuantity: Number.isFinite(n) ? n : undefined } : p)));
                        }}
                        placeholder="Qty"
                        placeholderTextColor={Colors.mutedForeground}
                        keyboardType="decimal-pad"
                        returnKeyType="done"
                        style={styles.unitInput}
                      />
                      <TextInput
                        value={it.unitMeasure ?? ""}
                        onChangeText={(t) =>
                          setItems((prev) => prev.map((p) => (p.id === it.id ? { ...p, unitMeasure: t || undefined } : p)))
                        }
                        placeholder="oz / ct / lb"
                        placeholderTextColor={Colors.mutedForeground}
                        returnKeyType="done"
                        style={styles.unitMeasureInput}
                      />
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

        {/* Report Data Error — user flags OCR mistakes */}
        <View style={{ paddingHorizontal: 20, paddingBottom: 8 }}>
          <Pressable
            onPress={() => {
              Alert.alert(
                "Report Data Error",
                "Flag this scan's items as having incorrect units or prices? We'll use your correction to improve future readings.",
                [
                  { text: "Cancel", style: "cancel" },
                  { text: "Report", style: "destructive", onPress: () => {
                    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                    Alert.alert("Reported", "Thank you — this helps us fix unit errors.");
                  }},
                ],
              );
            }}
            style={({ pressed }) => [styles.reportErrorBtn, pressed && { opacity: 0.7 }]}
            accessibilityRole="button"
            accessibilityLabel="Report a data error in this scan"
          >
            <AlertTriangle size={12} color={Colors.amber} strokeWidth={2} />
            <Text style={styles.reportErrorText}>REPORT DATA ERROR</Text>
          </Pressable>
        </View>

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

/**
 * Normalize a scanned price to the staple's reference unit for fair
 * apples-to-apples comparison. Returns the adjusted price per staple
 * unit, or null when the scanned quantity cannot be determined from
 * the OCR raw text — those items are skipped to avoid fake savings.
 */
function normalizeToStapleUnit(
  rawName: string,
  staple: Staple,
  scannedPrice: number,
): number | null {
  const upper = rawName.toUpperCase();

  switch (staple.id) {
    // --- dozen (12 eggs) ---
    case "eggs": {
      const ct = upper.match(/(\d+)\s*CT/);
      if (ct) {
        const count = Number.parseInt(ct[1]);
        if (count > 0) return scannedPrice * (12 / count);
      }
      if (/\bDOZEN\b|\bDZ\b/.test(upper)) return scannedPrice;
      if (/HALF\s*DOZEN/.test(upper)) return scannedPrice * 2;
      return null; // can't tell — skip
    }

    // --- gallon ---
    case "milk": {
      if (/\bGAL\b|\bGALLON\b/i.test(upper)) {
        if (/HALF\s*GAL/.test(upper)) return scannedPrice * 2;
        if (/\bQUART\b/i.test(upper)) return scannedPrice * 4;
        if (/\bPINT\b/i.test(upper)) return scannedPrice * 8;
        return scannedPrice;
      }
      return null;
    }

    // --- loaf ---
    case "bread":
      return scannedPrice;

    // --- 1 lb ---
    case "butter": {
      const lb = upper.match(/(\d+(?:\.\d+)?)\s*LB/);
      if (lb) {
        const lbs = Number.parseFloat(lb[1]);
        if (lbs > 0) return scannedPrice / lbs;
      }
      if (/\bLB\b/.test(upper)) return scannedPrice;
      return null;
    }

    // --- per lb ---
    case "chicken-breast":
    case "ground-beef":
    case "bananas": {
      const lb = upper.match(/(\d+(?:\.\d+)?)\s*LB/);
      if (lb) {
        const lbs = Number.parseFloat(lb[1]);
        if (lbs > 0) return scannedPrice / lbs;
      }
      if (/\bLB\b/.test(upper)) return scannedPrice;
      return null;
    }

    // --- half gallon (64 oz) ---
    case "orange-juice": {
      const oz = upper.match(/(\d+)\s*OZ/);
      if (oz) {
        const ounces = Number.parseInt(oz[1]);
        return scannedPrice * (64 / ounces);
      }
      if (/\bHALF\s*GAL\b/.test(upper)) return scannedPrice;
      if (/\bGAL\b/.test(upper)) return scannedPrice * 0.5;
      return null;
    }

    // --- 8 oz ---
    case "cheddar": {
      const oz = upper.match(/(\d+(?:\.\d+)?)\s*OZ/);
      if (oz) {
        const ounces = Number.parseFloat(oz[1]);
        if (ounces > 0) return scannedPrice * (8 / ounces);
      }
      return null;
    }

    // --- single serving ---
    case "yogurt":
      return scannedPrice;

    default:
      return scannedPrice;
  }
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
      if (!staple) return null;
      const scannedPrice = Number.parseFloat(it.priceStr);
      if (!Number.isFinite(scannedPrice)) return null;
      const normalized = normalizeToStapleUnit(it.rawName, staple, scannedPrice);
      if (normalized === null) return null; // quantity unknown — skip
      return { name: it.name, scanned: normalized, avg: staple.avgPrice, unit: staple.unit };
    })
    .filter((m): m is NonNullable<typeof m> => !!m);

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
          <Text style={styles.discoveryBtnText}>SEE MY NEW SCORE</Text>
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
  unitInputsRow: { flexDirection: "row", gap: 8, marginTop: 2 },
  unitInput: {
    width: 60,
    backgroundColor: Colors.muted,
    borderRadius: Radius.sm,
    paddingVertical: 4,
    paddingHorizontal: 8,
    textAlign: "center",
    fontFamily: Fonts.mono,
    fontSize: 12,
    color: Colors.foreground,
  },
  unitMeasureInput: {
    width: 80,
    backgroundColor: Colors.muted,
    borderRadius: Radius.sm,
    paddingVertical: 4,
    paddingHorizontal: 8,
    textAlign: "center",
    fontFamily: Fonts.mono,
    fontSize: 12,
    color: Colors.foreground,
  },
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
  reportErrorBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 8,
    borderRadius: Radius.full,
  },
  reportErrorText: {
    fontFamily: Fonts.mono,
    fontSize: 10,
    letterSpacing: 1,
    color: Colors.amber,
  },

  /* Cross-Store Savings Summary */
  savingsSummary: {
    marginTop: 16,
    marginHorizontal: 4,
    backgroundColor: Colors.accentSoft,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.accent,
    padding: 16,
  },
  savingsSummaryKicker: { fontFamily: Fonts.mono, fontSize: 10, letterSpacing: 1.2, color: Colors.accent },
  savingsSummaryValue: {
    marginTop: 6,
    fontFamily: Fonts.extrabold,
    fontSize: 22,
    letterSpacing: -0.6,
    color: Colors.accent,
    fontVariant: ["tabular-nums"] as const,
  },
  savingsSummaryHint: { marginTop: 4, fontFamily: Fonts.regular, fontSize: 13, color: Colors.foreground, lineHeight: 18 },

  /* National Average Comparison Card */
  nationalCard: {
    marginTop: 12,
    marginHorizontal: 4,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
  },
  nationalTitle: {
    marginTop: 4,
    fontFamily: Fonts.extrabold,
    fontSize: 18,
    letterSpacing: -0.5,
    color: Colors.accent,
  },
  nationalRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 6,
  },
  nationalItemName: { fontFamily: Fonts.semibold, fontSize: 13, letterSpacing: -0.2, color: Colors.foreground, flex: 1 },
  nationalItemPrice: { fontFamily: Fonts.bold, fontSize: 14, color: Colors.success, fontVariant: ["tabular-nums"] as const, minWidth: 60, textAlign: "right" as const },
  nationalItemAvg: { fontFamily: Fonts.mono, fontSize: 10, color: Colors.mutedForeground, minWidth: 56, textAlign: "right" as const },

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
  discoveryPrice: { fontFamily: Fonts.bold, fontSize: 16, color: Colors.success, fontVariant: ["tabular-nums"] },
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
