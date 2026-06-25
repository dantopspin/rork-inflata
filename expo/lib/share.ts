import { Platform, Share, type View } from "react-native";
import { captureRef } from "react-native-view-shot";
import type { RefObject } from "react";

/**
 * Capture a rendered card view as a real PNG and present the native share sheet.
 * Falls back to text sharing when image capture isn't available in the
 * current runtime (e.g. web preview).
 */
export async function captureAndShare(
  ref: RefObject<View | null>,
  fallbackText: string,
): Promise<void> {
  try {
    if (Platform.OS === "web" || !ref.current) {
      await Share.share({ message: fallbackText });
      return;
    }
    const uri = await captureRef(ref, { format: "png", quality: 1, result: "tmpfile" });
    await Share.share(
      Platform.OS === "ios"
        ? { url: uri, message: fallbackText }
        : { message: `${fallbackText}\n${uri}` },
    );
  } catch (e) {
    console.log("[share] capture failed, falling back to text", e);
    try {
      await Share.share({ message: fallbackText });
    } catch {
      // user cancelled
    }
  }
}
