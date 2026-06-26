import { manipulateAsync, SaveFormat, type Action } from "expo-image-manipulator";
import { Image } from "react-native";

const DEFAULT_MAX_BYTES = 3_000_000;

type LadderStep = { width: number; compress: number };

// Standard ladder for regular receipts and images.
const LADDER: LadderStep[] = [
  { width: 1280, compress: 0.82 },
  { width: 1024, compress: 0.78 },
  { width: 832, compress: 0.74 },
  { width: 640, compress: 0.7 },
  { width: 512, compress: 0.65 },
];

// Long-receipt ladder: uses larger widths to preserve text legibility
// when the image is very tall (height > 2× width).
const LONG_RECEIPT_LADDER: LadderStep[] = [
  { width: 1600, compress: 0.85 },
  { width: 1400, compress: 0.82 },
  { width: 1200, compress: 0.78 },
  { width: 1024, compress: 0.74 },
  { width: 832, compress: 0.7 },
];

/** Resolve image dimensions so we can detect long receipts before resizing. */
function getImageSize(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    Image.getSize(
      uri,
      (width, height) => resolve({ width, height }),
      reject,
    );
  });
}

/** Calculate raw byte length of a base64 string without the Buffer polyfill. */
function base64ByteLength(b64: string): number {
  let padding = 0;
  if (b64.endsWith("==")) padding = 2;
  else if (b64.endsWith("=")) padding = 1;
  return (b64.length / 4) * 3 - padding;
}

const stripDataUriPrefix = (b64: string): string => {
  if (!b64.startsWith("data:")) return b64;
  const comma = b64.indexOf(",");
  return comma === -1 ? b64 : b64.slice(comma + 1);
};

/**
 * Resize an Expo image URI into a raw-base64 JPEG that fits inside the Vercel
 * request-body limit for image input requests.
 */
export async function resizeForUpload(
  imageUri: string,
  maxBytes: number = DEFAULT_MAX_BYTES,
): Promise<{ base64: string; mimeType: "image/jpeg" }> {
  // Detect long receipts (height > 2× width) and use a wider ladder to
  // preserve text legibility. A narrow resize on a tall receipt makes
  // OCR unreadable.
  let ladder = LADDER;
  try {
    const size = await getImageSize(imageUri);
    if (size.height > size.width * 2) {
      ladder = LONG_RECEIPT_LADDER;
    }
  } catch {
    // Image.getSize failed — fall back to the standard ladder.
  }

  for (const step of ladder) {
    const actions: Action[] = [{ resize: { width: step.width } }];

    const result = await manipulateAsync(imageUri, actions, {
      format: SaveFormat.JPEG,
      compress: step.compress,
      base64: true,
    });

    if (result.base64 && base64ByteLength(result.base64) <= maxBytes) {
      return {
        base64: stripDataUriPrefix(result.base64),
        mimeType: "image/jpeg" as const,
      };
    }
  }

  const err = new Error("Image too large. Try cropping to just the receipt area.");
  (err as any).code = "IMAGE_TOO_LARGE";
  throw err;
}
