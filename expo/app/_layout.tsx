import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
} from "@expo-google-fonts/inter";
import {
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
} from "@expo-google-fonts/jetbrains-mono";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useFonts } from "expo-font";
import { Stack, router, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { Colors } from "@/constants/theme";
import { AppProvider, useApp } from "@/providers/AppProvider";

const queryClient = new QueryClient();

function OnboardingGuard() {
  const { hydrated, hasOnboarded } = useApp();
  const segments = useSegments();

  useEffect(() => {
    if (!hydrated) return;
    const inOnboarding = segments[0] === "onboarding";
    if (!hasOnboarded && !inOnboarding) {
      router.replace("/onboarding");
    }
  }, [hydrated, hasOnboarded, segments]);

  return null;
}

function RootLayoutNav() {
  return (
    <>
      <OnboardingGuard />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: Colors.background },
          animation: "slide_from_right",
          animationDuration: 250,
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="scan" options={{ animation: "slide_from_bottom", presentation: "fullScreenModal", animationDuration: 300 }} />
        <Stack.Screen name="onboarding" options={{ animation: "fade", gestureEnabled: false, animationDuration: 200 }} />
        <Stack.Screen name="item/[id]" options={{ animationDuration: 220 }} />
        <Stack.Screen name="legal/[slug]" options={{ animationDuration: 220 }} />
        <Stack.Screen name="share-hall-of-shame" options={{ animation: "slide_from_bottom", animationDuration: 280 }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const [loaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
  });

  return (
    <QueryClientProvider client={queryClient}>
      <AppProvider>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <StatusBar style="dark" />
          <RootLayoutNav />
        </GestureHandlerRootView>
      </AppProvider>
    </QueryClientProvider>
  );
}
