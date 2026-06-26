import { manipulateAsync, SaveFormat, type Action } from "expo-image-manipulator";
import { Image } from "react-native";

const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.82;
const RETRY_QUALITY = 0.7;
const MAX_BASE64_BYTES = 4_000_000; // 4 MB

/**
 * Resize an image URI into a raw-base64 JPEG optimized for receipt OCR.
 * - Longest edge capped at 1600px (no upscaling).
 * - Compressed to JPEG at quality 0.82.
 * - If the result exceeds 4 MB, retries once at quality 0.70.
 * - Throws IMAGE_TOO_LARGE if still too large after retry.
 */
export async function resizeForUpload(
  imageUri: string,
): Promise<{ base64: string; mimeType: "image/jpeg" }> {
  // Resize: scale longest edge to MAX_EDGE if the image is larger.
  const actions: Action[] = [];
  // expo-image-manipulator's resize action uses width; we'll compute it
  // below after detecting the aspect ratio. For now, set a safe width
  // that caps the longest edge.

  const resizeWithQuality = async (compress: number): Promise<{ base64: string; width: number; height: number } | null> => {
    const result = await manipulateAsync(imageUri, actions, {
      format: SaveFormat.JPEG,
      compress,
      base64: true,
    });

    if (result.base64) {
      // Strip data URI prefix if present
      const b64 = stripDataUriPrefix(result.base64);
      const byteLen = base64ByteLength(b64);
      if (byteLen <= MAX_BASE64_BYTES) {
        if (__DEV__) {
          console.log("[resize]", {
            width: result.width,
            height: result.height,
            base64Kb: byteLen / 1024,
          });
        }
        return { base64: b64, width: result.width, height: result.height };
      }
    }
    return null;
  };

  // Step 1: resize to cap longest edge at 1600px
  const size = await getImageSize(imageUri);
  const { width: origW, height: origH } = size;

  if (origW > MAX_EDGE || origH > MAX_EDGE) {
    const ratio = Math.min(MAX_EDGE / origW, MAX_EDGE / origH);
    if (ratio < 1) {
      actions.push({ resize: { width: Math.round(origW * ratio) } });
    }
  }

  // Attempt 1: quality 0.82
  let result = await resizeWithQuality(JPEG_QUALITY);
  if (result) {
    return { base64: result.base64, mimeType: "image/jpeg" };
  }

  // Attempt 2: quality 0.70
  result = await resizeWithQuality(RETRY_QUALITY);
  if (result) {
    return { base64: result.base64, mimeType: "image/jpeg" };
  }

  // Still too large — throw
  const err = new Error(
    "Receipt image is too large to process. Please try in better lighting or move closer.",
  );
  (err as any).code = "IMAGE_TOO_LARGE";
  throw err;
}

/** Resolve image dimensions so we can compute the correct resize ratio. */
function getImageSize(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    Image.getSize(
      uri,
      (width, height) => resolve({ width, height }),
      reject,
    );
  });
}

/** Calculate raw byte length of a base64 string. */
function base64ByteLength(b64: string): number {
  let padding = 0;
  if (b64.endsWith("==")) padding = 2;
  else if (b64.endsWith("=")) padding = 1;
  return (b64.length / 4) * 3 - padding;
}

/** Strip the data URI prefix (e.g. "data:image/jpeg;base64,") from a base64 string. */
function stripDataUriPrefix(b64: string): string {
  if (!b64.startsWith("data:")) return b64;
  const comma = b64.indexOf(",");
  return comma === -1 ? b64 : b64.slice(comma + 1);
}
