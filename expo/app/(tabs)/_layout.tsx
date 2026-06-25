import * as Haptics from "expo-haptics";
import { Tabs, router } from "expo-router";
import { BarChart3, Camera, Home, Settings as SettingsIcon } from "lucide-react-native";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GlassView } from "expo-glass-effect";

import { Colors, Fonts } from "@/constants/theme";

export default function TabLayout() {
  const insets = useSafeAreaInsets();
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
        />
        <Tabs.Screen
          name="scan-tab"
          options={{
            title: "Scan",
            tabBarIcon: () => null,
            tabBarButton: ({ onPress, ...rest }) => (
              <Pressable
                onPress={(e) => {
                  onPress?.(e);
                  if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                }}
                style={({ pressed }) => [
                  styles.scanBtn,
                  pressed && { transform: [{ scale: 0.92 }] },
                ]}
                accessibilityLabel="Scan"
                accessibilityRole="tab"
              >
                <View style={styles.scanBtnInner}>
                  <Camera size={22} color={Colors.accentForeground} strokeWidth={2.2} />
                </View>
                <Text style={styles.scanLabel}>Scan</Text>
              </Pressable>
            ),
          }}
          listeners={{
            tabPress: (e) => {
              e.preventDefault();
              router.push("/scan");
            },
          }}
        />
        <Tabs.Screen
          name="trends"
          options={{
            title: "Trends",
            tabBarIcon: ({ color }) => (
              <BarChart3 size={22} color={color} strokeWidth={2} />
            ),
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            title: "Settings",
            tabBarIcon: ({ color }) => (
              <SettingsIcon size={22} color={color} strokeWidth={2} />
            ),
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
