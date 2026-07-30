import createContextHook from "@nkzw/create-context-hook";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useMemo, useState } from "react";

import { runMigrations } from "@/lib/migration";
import { sendSpikeAlert } from "@/lib/notifications";
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
  watchlist: string[];
};

const STORAGE_KEY = "inflata:state:v1";

const INACTIVE_ENT: Entitlement = { active: false, plan: null, expiresAt: null };

/**
 * Determine whether a scan contains at least one item with usable price data.
 * Scans with zero items or only items whose price is missing/invalid are
 * considered empty and are pruned on app load to keep the database clean.
 */
function scanHasPriceData(scan: Scan): boolean {
  if (!scan.items || scan.items.length === 0) return false;
  return scan.items.some((it) => {
    if (!Number.isFinite(it.price) || it.price < 0) return false;
    // Regular items must have a positive price; promo/discount may be 0.
    if (it.price === 0 && it.type !== "promo" && it.type !== "discount") return false;
    return true;
  });
}

export const [AppProvider, useApp] = createContextHook(() => {
  const [hydrated, setHydrated] = useState<boolean>(false);
  const [hasOnboarded, setHasOnboarded] = useState<boolean>(false);
  const [frequency, setFrequencyState] = useState<Frequency | null>(null);
  const [scans, setScans] = useState<Scan[]>([]);
  const [notificationsEnabled, setNotificationsEnabled] = useState<boolean>(false);
  const [firstLaunchAt, setFirstLaunchAt] = useState<string>(() => new Date().toISOString());
  const [postOnboardingPaywallShown, setPostOnboardingPaywallShown] = useState<boolean>(false);

  const [watchlist, setWatchlist] = useState<string[]>([]);

  const [entitlement, setEntitlement] = useState<Entitlement>(INACTIVE_ENT);

  // Run schema migration before any data is read.
  // Hydrate persisted state + entitlement on mount.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        // Schema migration — backfills missing fields on existing scans.
        // Must run BEFORE hydration so the state picks up migrated data.
        await runMigrations();

        const [raw, ent] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEY),
          getEntitlement(),
        ]);
        if (!active) return;
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<PersistShape>;
          setHasOnboarded(parsed.hasOnboarded ?? false);
          setFrequencyState(parsed.frequency ?? null);
          // Auto-prune scan entries that contain no usable price data so the
          // database stays clean on every app load (corrupted/empty/aborted scans).
          const loadedScans = Array.isArray(parsed.scans) ? parsed.scans : [];
          const cleanScans = loadedScans.filter(scanHasPriceData);
          if (cleanScans.length !== loadedScans.length) {
            console.log(
              `[AppProvider] auto-pruned ${loadedScans.length - cleanScans.length} scan(s) with no price data`,
            );
          }
          setScans(cleanScans);
          setNotificationsEnabled(parsed.notificationsEnabled ?? false);
          setFirstLaunchAt(parsed.firstLaunchAt ?? new Date().toISOString());
          setPostOnboardingPaywallShown(parsed.postOnboardingPaywallShown ?? false);
          setWatchlist(Array.isArray(parsed.watchlist) ? parsed.watchlist : []);
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
      watchlist,
    };
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload)).catch((e) =>
      console.log("[AppProvider] persist failed", e),
    );
  }, [hydrated, hasOnboarded, frequency, scans, notificationsEnabled, firstLaunchAt, postOnboardingPaywallShown, watchlist]);

  const completeOnboarding = useCallback((freq: Frequency, baseline: Scan) => {
    setFrequencyState(freq);
    setHasOnboarded(true);
    setScans((prev) => [...prev, baseline]);
  }, []);

  const addScan = useCallback((scan: Scan) => {
    // Detect >10% price spikes vs prior history for push notification.
    const priorPrice = new Map<string, number>();
    for (const s of scans) {
      // Skip baseline estimates so spike alerts compare real store prices
      // to real history, not to synthetic 90-day-old estimates.
      if (s.source !== "scan") continue;
      for (const it of s.items) {
        priorPrice.set(it.itemKey, it.price);
      }
    }

    const spikeItems = scan.items.filter((it) => {
      const prev = priorPrice.get(it.itemKey);
      return (
        prev !== undefined &&
        prev > 0 &&
        Number.isFinite(it.price) &&
        it.price > prev * 1.1
      );
    });

    // The "Price Spike" push notification is a premium feature. Gate it on
    // an active entitlement AND the user's notification opt-in so free users
    // never receive the paid alert (honors the paywall promise + no revenue leak).
    if (spikeItems.length > 0 && entitlement.active && notificationsEnabled) {
      sendSpikeAlert(spikeItems);
    }

    setScans((prev) => [...prev, scan]);
  }, [scans, entitlement, notificationsEnabled]);

  const toggleWatchlist = useCallback((key: string) => {
    setWatchlist((prev) => {
      if (prev.includes(key)) return prev.filter((k) => k !== key);
      return [...prev, key];
    });
  }, []);

  const deleteScan = useCallback((id: string) => {
    setScans((prev) => prev.filter((s) => s.id !== id));
  }, []);

  // Remove every occurrence of an item (by itemKey) from all scans.
  // Scans that end up with zero items after removal are pruned.
  // Also removes the item from the watchlist if pinned.
  const deleteItem = useCallback((itemKey: string) => {
    setScans((prev) =>
      prev
        .map((s) => ({ ...s, items: s.items.filter((it) => it.itemKey !== itemKey) }))
        .filter((s) => s.items.length > 0),
    );
    setWatchlist((prev) => prev.filter((k) => k !== itemKey));
  }, []);

  // Clear all scan sessions while keeping onboarding, frequency, and
  // watchlist intact — used by the "Clear History" button in the scan
  // logs (Recent Evidence) modal so users can remove outdated/empty
  // scan sessions with one tap.
  const clearScans = useCallback(() => {
    setScans([]);
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
    setWatchlist([]);
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
      watchlist,
      completeOnboarding,
      addScan,
      deleteScan,
      deleteItem,
      clearScans,
      toggleWatchlist,
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
      watchlist,
      completeOnboarding,
      addScan,
      deleteScan,
      deleteItem,
      clearScans,
      toggleWatchlist,
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
