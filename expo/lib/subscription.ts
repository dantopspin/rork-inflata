import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import Purchases, { type CustomerInfo, type PurchasesOfferings } from "react-native-purchases";

// ── RevenueCat configuration ──────────────────────────────────────────────

function getRCToken(): string {
  // On native platforms always use the platform-specific key.
  // The test key is only for non-native environments (web/test harnesses).
  return Platform.select({
    ios: (process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY as string) ?? "",
    android: (process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY as string) ?? "",
    default: (process.env.EXPO_PUBLIC_REVENUECAT_TEST_API_KEY as string) ?? "",
  }) as string;
}

// ── Idempotent configure ──────────────────────────────────────────────────
// Configure at module-import time (before any React rendering) so the native
// singleton exists before any Purchases API is called. On web this is a no-op.

let _configured = false;
let _configureError: string | null = null;

(function initPurchases() {
  if (Platform.OS === "web") return;
  try {
    const key = getRCToken();
    if (!key) {
      _configureError = "RevenueCat API key is missing for this platform.";
      return;
    }
    Purchases.configure({ apiKey: key });
    _configured = true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    _configureError = msg;
    console.log("[subscription] Purchases.configure failed at init:", msg);
  }
})();

function ensureConfigured(): void {
  if (_configured) return;
  if (Platform.OS === "web") return;
  // Retry once in case a transient bridge issue blocked module-level init.
  try {
    const key = getRCToken();
    if (!key) throw new Error("RevenueCat API key is missing for this platform.");
    Purchases.configure({ apiKey: key });
    _configured = true;
    _configureError = null;
  } catch (e) {
    _configureError = e instanceof Error ? e.message : String(e);
    console.log("[subscription] Purchases.configure retry failed:", _configureError);
  }
}

// ── Types ──────────────────────────────────────────────────────────────────

export type PlanId = "monthly" | "annual";

export type Entitlement = {
  active: boolean;
  plan: PlanId | null;
  /** ISO expiry; null when not subscribed. */
  expiresAt: string | null;
  /** True when the last refresh failed and we are serving a cached value. */
  fromCache?: boolean;
};

// ── AsyncStorage cache ─────────────────────────────────────────────────────

const CACHE_KEY = "inflata:entitlement:v2";

const INACTIVE: Entitlement = { active: false, plan: null, expiresAt: null };

function mapCustomerInfo(info: CustomerInfo): Entitlement {
  const active = info.entitlements.active["premium"] !== undefined;
  if (!active) return INACTIVE;
  const expiresDate = info.entitlements.active["premium"]?.expirationDate;
  const subs = info.activeSubscriptions;
  return {
    active: true,
    plan: subs.some((s) => s.includes("monthly"))
      ? "monthly"
      : subs.some((s) => s.includes("annual"))
        ? "annual"
        : null,
    expiresAt: expiresDate ?? null,
  };
}

function normalize(e: Entitlement | null): Entitlement {
  if (!e || !e.active || !e.expiresAt) return INACTIVE;
  if (new Date(e.expiresAt).getTime() <= Date.now()) return INACTIVE;
  return e;
}

/** Cache the entitlement locally so we survive offline launches. */
async function cacheEntitlement(ent: Entitlement): Promise<void> {
  try {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(ent));
  } catch {
    // non-critical
  }
}

/** Read the authoritative entitlement. Tries RevenueCat first, falls back to cache. */
export async function getEntitlement(): Promise<Entitlement> {
  ensureConfigured();
  // Web has no configured Purchases — serve from cache only.
  if (Platform.OS === "web") {
    try {
      const raw = await AsyncStorage.getItem(CACHE_KEY);
      if (raw) return normalize(JSON.parse(raw) as Entitlement);
    } catch {
      // cache read failed
    }
    return INACTIVE;
  }

  try {
    const info = await Purchases.getCustomerInfo();
    const ent = mapCustomerInfo(info);
    await cacheEntitlement(ent);
    return ent;
  } catch {
    // Network or SDK error — serve cached value
    try {
      const raw = await AsyncStorage.getItem(CACHE_KEY);
      if (raw) return normalize(JSON.parse(raw) as Entitlement);
    } catch {
      // cache read failed
    }
    return { ...INACTIVE, fromCache: true };
  }
}

/** Purchase a subscription plan. */
export async function purchase(plan: PlanId): Promise<Entitlement> {
  ensureConfigured();
  // Web doesn't support real IAP — show a clear message.
  if (Platform.OS === "web") {
    throw new Error("In-app purchases require a real iOS or Android device. You won't be charged.");
  }
  if (!_configured) {
    throw new Error(
      _configureError
        ? `Purchase setup failed: ${_configureError}`
        : "Purchases not configured. Please restart the app.",
    );
  }

  const offerings = await Purchases.getOfferings();
  const offering = offerings.current;
  if (!offering) throw new Error("No current offering available");

  // Look up the package by its lookup key ("monthly" / "annual") — consistent across all stores.
  const pkg =
    plan === "monthly"
      ? offering.monthly ?? offering.availablePackages.find((p) => p.identifier === "monthly")
      : offering.annual ?? offering.availablePackages.find((p) => p.identifier === "annual");
  if (!pkg) throw new Error(`Package for plan "${plan}" not found`);

  const result = await Purchases.purchasePackage(pkg);
  const ent = mapCustomerInfo(result.customerInfo);
  await cacheEntitlement(ent);
  return ent;
}

/** Fetch current offering (for paywall pricing). Safe to call from UI. */
export async function getOfferingsForPaywall(): Promise<PurchasesOfferings | null> {
  ensureConfigured();
  if (Platform.OS === "web") return null;
  try {
    return await Purchases.getOfferings();
  } catch (e) {
    console.log("[subscription] getOfferingsForPaywall failed", e);
    return null;
  }
}

/** Restore purchases. */
export async function restore(): Promise<Entitlement | null> {
  ensureConfigured();
  const info = await Purchases.restorePurchases();
  const ent = mapCustomerInfo(info);
  await cacheEntitlement(ent);
  return ent.active ? ent : null;
}

/** Cancel / expire the current subscription. */
export async function cancel(): Promise<void> {
  await AsyncStorage.removeItem(CACHE_KEY);
}
