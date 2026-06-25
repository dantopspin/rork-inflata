import createContextHook from "@nkzw/create-context-hook";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Scan, Frequency } from "@/types";
import {
  Entitlement,
  PlanId,
  cancel as cancelSub,
  getEntitlement,
  purchase as purchaseSub,
  restore as restoreSub,
} from "@/lib/subscription";

type PersistShape = {
  hasOnboarded: boolean;
  frequency: Frequency | null;
  scans: Scan[];
  notificationsEnabled: boolean;
  firstLaunchAt: string;
  postOnboardingPaywallShown: boolean;
};

const STORAGE_KEY = "inflata:state:v1";

const INACTIVE_ENT: Entitlement = { active: false, plan: null, expiresAt: null };

export const [AppProvider, useApp] = createContextHook(() => {
  const [hydrated, setHydrated] = useState<boolean>(false);
  const [hasOnboarded, setHasOnboarded] = useState<boolean>(false);
  const [frequency, setFrequencyState] = useState<Frequency | null>(null);
  const [scans, setScans] = useState<Scan[]>([]);
  const [notificationsEnabled, setNotificationsEnabled] = useState<boolean>(false);
  const [firstLaunchAt, setFirstLaunchAt] = useState<string>(() => new Date().toISOString());
  const [postOnboardingPaywallShown, setPostOnboardingPaywallShown] = useState<boolean>(false);

  const [entitlement, setEntitlement] = useState<Entitlement>(INACTIVE_ENT);

  // Hydrate persisted state + entitlement on mount.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [raw, ent] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEY),
          getEntitlement(),
        ]);
        if (!active) return;
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<PersistShape>;
          setHasOnboarded(parsed.hasOnboarded ?? false);
          setFrequencyState(parsed.frequency ?? null);
          setScans(Array.isArray(parsed.scans) ? parsed.scans : []);
          setNotificationsEnabled(parsed.notificationsEnabled ?? false);
          setFirstLaunchAt(parsed.firstLaunchAt ?? new Date().toISOString());
          setPostOnboardingPaywallShown(parsed.postOnboardingPaywallShown ?? false);
        }
        setEntitlement(ent);
      } catch (e) {
        console.log("[AppProvider] hydration failed", e);
      } finally {
        if (active) setHydrated(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Persist whenever core state changes (after hydration).
  useEffect(() => {
    if (!hydrated) return;
    const payload: PersistShape = {
      hasOnboarded,
      frequency,
      scans,
      notificationsEnabled,
      firstLaunchAt,
      postOnboardingPaywallShown,
    };
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload)).catch((e) =>
      console.log("[AppProvider] persist failed", e),
    );
  }, [hydrated, hasOnboarded, frequency, scans, notificationsEnabled, firstLaunchAt, postOnboardingPaywallShown]);

  const completeOnboarding = useCallback((freq: Frequency, baseline: Scan) => {
    setFrequencyState(freq);
    setHasOnboarded(true);
    setScans((prev) => [...prev, baseline]);
  }, []);

  const addScan = useCallback((scan: Scan) => {
    setScans((prev) => [...prev, scan]);
  }, []);

  const deleteScan = useCallback((id: string) => {
    setScans((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const setFrequency = useCallback((f: Frequency) => setFrequencyState(f), []);

  const setNotifications = useCallback((v: boolean) => setNotificationsEnabled(v), []);

  const markPostOnboardingPaywallShown = useCallback(() => setPostOnboardingPaywallShown(true), []);

  const clearAll = useCallback(async () => {
    setHasOnboarded(false);
    setFrequencyState(null);
    setScans([]);
    setNotificationsEnabled(false);
    setFirstLaunchAt(new Date().toISOString());
    setPostOnboardingPaywallShown(false);
    try {
      await AsyncStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      console.log("[AppProvider] clearAll failed", e);
    }
  }, []);

  const subscribe = useCallback(
    async (plan: PlanId): Promise<{ ok: boolean; error?: string }> => {
      try {
        const ent = await purchaseSub(plan);
        setEntitlement(ent);
        return { ok: ent.active };
      } catch (e) {
        const message =
          e instanceof Error ? e.message : "Something went wrong. You weren't charged.";
        console.log("[AppProvider] purchase failed", e);
        return { ok: false, error: message };
      }
    },
    [],
  );

  const restorePurchases = useCallback(async (): Promise<boolean> => {
    try {
      const ent = await restoreSub();
      if (ent) {
        setEntitlement(ent);
        return true;
      }
      return false;
    } catch (e) {
      console.log("[AppProvider] restore failed", e);
      return false;
    }
  }, []);

  const cancelSubscription = useCallback(async () => {
    try {
      await cancelSub();
      setEntitlement(INACTIVE_ENT);
      setNotificationsEnabled(false);
    } catch (e) {
      console.log("[AppProvider] cancel failed", e);
    }
  }, []);

  const subscribed = entitlement.active;

  return useMemo(
    () => ({
      hydrated,
      hasOnboarded,
      frequency,
      scans,
      notificationsEnabled,
      firstLaunchAt,
      postOnboardingPaywallShown,
      entitlement,
      subscribed,
      completeOnboarding,
      addScan,
      deleteScan,
      setFrequency,
      setNotifications,
      clearAll,
      markPostOnboardingPaywallShown,
      subscribe,
      restorePurchases,
      cancelSubscription,
    }),
    [
      hydrated,
      hasOnboarded,
      frequency,
      scans,
      notificationsEnabled,
      firstLaunchAt,
      postOnboardingPaywallShown,
      entitlement,
      subscribed,
      completeOnboarding,
      addScan,
      deleteScan,
      setFrequency,
      setNotifications,
      clearAll,
      markPostOnboardingPaywallShown,
      subscribe,
      restorePurchases,
      cancelSubscription,
    ],
  );
});
