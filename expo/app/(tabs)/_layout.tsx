import * as Haptics from "expo-haptics";
import { Tabs, router } from "expo-router";
import { Camera, Eye, Home, Search } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GlassView } from "expo-glass-effect";

import { Colors, Fonts } from "@/constants/theme";
import { aggregateItems, realScans, savingsFound } from "@/lib/inflation";
import { useApp } from "@/providers/AppProvider";

/** Check if the user has any actionable price drops → monthly savings > 0 */
function useMonthlySavingsBadge(): string | undefined {
  const { scans, frequency } = useApp();
  return useMemo(() => {
    const stats = aggregateItems(scans);
    const weekly = savingsFound(stats, frequency);
    if (weekly <= 0) return undefined;
    const monthly = Math.round(weekly * 4.33);
    return `$${monthly}`;
  }, [scans, frequency]);
}

/** True if the user hasn't scanned a receipt in >7 days */
function useScanIdle(): boolean {
  const { scans } = useApp();
  return useMemo(() => {
    const real = realScans(scans);
    if (!real.length) return false;
    const lastDate = real.map((s) => s.date).sort().reverse()[0];
    if (!lastDate) return false;
    const daysSince = (Date.now() - new Date(lastDate).getTime()) / (1000 * 60 * 60 * 24);
    return daysSince > 7;
  }, [scans]);
}

function ScanButton() {
  const idle = useScanIdle();
  const ringOpacity = useSharedValue(0);
  const ringScale = useSharedValue(0.85);

  useEffect(() => {
    if (!idle) {
      ringOpacity.value = 0;
      ringScale.value = 0.85;
      return;
    }
    ringOpacity.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 600 }),
        withTiming(0.35, { duration: 600 }),
      ),
      -1,
      true,
    );
    ringScale.value = withRepeat(
      withSequence(
        withTiming(1.5, { duration: 1200 }),
        withTiming(0.85, { duration: 1200 }),
      ),
      -1,
      true,
    );
  }, [idle]);

  const ringStyle = useAnimatedStyle(() => ({
    opacity: ringOpacity.value,
    transform: [{ scale: ringScale.value }],
  }));

  return (
    <Pressable
      onPress={(e) => {
        if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        router.push("/scan");
      }}
      style={({ pressed }) => [
        styles.scanBtn,
        pressed && { transform: [{ scale: 0.92 }] },
      ]}
      accessibilityLabel="Scan receipt"
      accessibilityRole="tab"
    >
      {idle ? (
        <View style={styles.pulseContainer}>
          <Animated.View style={[styles.pulseRing, ringStyle]} />
          <View style={styles.scanBtnInner}>
            <Camera size={22} color={Colors.accentForeground} strokeWidth={2.2} />
          </View>
        </View>
      ) : (
        <View style={styles.scanBtnInner}>
          <Camera size={22} color={Colors.accentForeground} strokeWidth={2.2} />
        </View>
      )}
      <Text style={styles.scanLabel}>Scan</Text>
    </Pressable>
  );
}

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const savingsBadge = useMonthlySavingsBadge();

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: Colors.accent,
          tabBarInactiveTintColor: "rgba(18,18,18,0.45)",
          tabBarStyle: {
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: "rgba(0,0,0,0.06)",
            backgroundColor: Platform.OS === "ios" ? "transparent" : "rgba(250,249,245,0.96)",
            height: 60 + insets.bottom,
            paddingBottom: insets.bottom,
            paddingTop: 6,
            elevation: 0,
          },
          tabBarBackground: () =>
            Platform.OS === "ios" ? (
              <GlassView style={StyleSheet.absoluteFill} glassEffectStyle="regular" />
            ) : null,
          tabBarLabelStyle: {
            fontFamily: Fonts.bold,
            fontSize: 9.5,
            letterSpacing: 0.3,
            textTransform: "uppercase",
            marginTop: 2,
          },
          tabBarItemStyle: { marginHorizontal: 0 },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: "Home",
            tabBarIcon: ({ color }) => (
              <Home size={22} color={color} strokeWidth={2} />
            ),
          }}
          listeners={{
            tabPress: () => {
              if (Platform.OS !== "web") Haptics.selectionAsync();
            },
          }}
        />
        <Tabs.Screen
          name="watchlist"
          options={{
            title: "Watchlist",
            tabBarIcon: ({ color }) => (
              <Search size={22} color={color} strokeWidth={2} />
            ),
          }}
          listeners={{
            tabPress: () => {
              if (Platform.OS !== "web") Haptics.selectionAsync();
            },
          }}
        />
        <Tabs.Screen
          name="scan-tab"
          options={{
            title: "Scan",
            tabBarIcon: () => null,
            tabBarButton: () => <ScanButton />,
          }}
        />
        <Tabs.Screen
          name="insights"
          options={{
            title: "Insights",
            tabBarIcon: ({ color }) => (
              <Eye size={22} color={color} strokeWidth={2} />
            ),
            tabBarBadge: savingsBadge,
            tabBarBadgeStyle: savingsBadge
              ? {
                  backgroundColor: Colors.accent,
                  fontFamily: Fonts.bold,
                  fontSize: 10,
                  letterSpacing: 0.3,
                  minWidth: 18,
                  height: 18,
                  lineHeight: 18,
                }
              : undefined,
          }}
          listeners={{
            tabPress: () => {
              if (Platform.OS !== "web") Haptics.selectionAsync();
            },
          }}
        />
      </Tabs>
    </View>
  );
}

const styles = StyleSheet.create({
  scanBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    marginTop: -16,
  },
  pulseContainer: {
    alignItems: "center",
    justifyContent: "center",
  },
  pulseRing: {
    position: "absolute",
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: Colors.accent,
    opacity: 0.35,
  },
  scanBtnInner: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: Colors.accent,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: Colors.accent,
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  scanLabel: {
    fontFamily: Fonts.bold,
    fontSize: 9,
    letterSpacing: 0.5,
    color: Colors.accent,
    textTransform: "uppercase",
    marginTop: 3,
  },
});
