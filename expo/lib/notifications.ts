import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

/**
 * Push / local notification helpers. Premium-only at the call site — every
 * consumer checks the RevenueCat entitlement before scheduling anything.
 */

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

export async function cancelAllScheduled(): Promise<void> {
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch {
    // ignore
  }
}
