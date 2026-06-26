import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { fmtPct, fmtUSD } from "@/lib/format";
import { ScanItem } from "@/types";

/**
 * Push / local notification helpers. Premium-only at the call site — every
 * consumer checks the RevenueCat entitlement before scheduling anything.
 *
 * TODO: Trip Strategy Price Spike Alerts
 * When a user's tracked items experience a recent price spike (>10% within 14 days,
 * as detected by hasRecentSpike() from lib/inflation), schedule a notification
 * warning them before their next trip. This is the backend of the "Price Spike
 * Alerts" feature promised on the paywall. The alert should:
 *   1. Fetch the latest aggregated ItemStats (via aggregateItems + withOverspend).
 *   2. For each item where hasRecentSpike(stat) returns true, schedule a local
 *      notification with the item name, spike percentage, and cheapest-store hint.
 *   3. Batch these into a single daily summary notification rather than one per item.
 *   4. Gate behind a RevenueCat entitlement check (premium only).
 *   5. Only trigger if notifications permission is granted.
 */

/**
 * Fire a local push notification for items that spiked >10% compared to prior purchases.
 * Called from AppProvider.addScan when a scan reveals price spikes against historical data.
 */
export async function sendSpikeAlert(spikeItems: ScanItem[]): Promise<void> {
  try {
    if (Platform.OS === "web") return;
    if (spikeItems.length === 0) return;

    if (spikeItems.length === 1) {
      const it = spikeItems[0];
      const title = `Price Spike: ${it.name}`;
      const body = `${it.name} is now ${fmtUSD(it.price)} — check your watchlist for the best store.`;
      await Notifications.scheduleNotificationAsync({
        content: { title, body, sound: "default" },
        trigger: { seconds: 1, type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL },
      });
    } else {
      const title = `${spikeItems.length} Items Spiked`;
      const names = spikeItems.map((i) => i.name).join(", ");
      const body = `${names} jumped in price this trip. Check your watchlist to shop at the cheapest store.`;
      await Notifications.scheduleNotificationAsync({
        content: { title, body, sound: "default" },
        trigger: { seconds: 1, type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL },
      });
    }
  } catch {
    // Notifications unavailable in this environment — non-fatal.
  }
}

export async function requestNotificationPermission(): Promise<boolean> {
  try {
    const settings = await Notifications.getPermissionsAsync();
    if (settings.granted || settings.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) {
      return true;
    }
    const req = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: true, allowSound: true },
    });
    return (
      req.granted || req.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL
    );
  } catch {
    return false;
  }
}

/** Fire a preview of a wallet-impact alert so users see the value immediately. */
export async function sendWalletAlertPreview(title: string, body: string): Promise<void> {
  try {
    if (Platform.OS === "web") return;
    await Notifications.scheduleNotificationAsync({
      content: { title, body },
      trigger: { seconds: 3, type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL },
    });
  } catch {
    // Notifications unavailable in this environment — non-fatal.
  }
}

/**
 * Schedule a recurring Price Spike Alert check.
 * Placeholder — implement the TODO above before wiring this to the paywall.
 */
export async function scheduleSpikeAlertCheck(): Promise<void> {
  // TODO: Implement Trip Strategy Price Spike Alerts (see module-level TODO above).
  // Once implemented, call this from the dashboard or AppProvider on premium activation.
}

export async function cancelAllScheduled(): Promise<void> {
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch {
    // ignore
  }
}
