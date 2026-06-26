import { resizeForUpload } from "./resize-for-upload";

const TOOLKIT_URL = process.env.EXPO_PUBLIC_TOOLKIT_URL as string;

// IMPORTANT: EXPO_PUBLIC_ prefix is REQUIRED for client-bundle access in Expo.
// Without it, the variable is undefined at runtime and every scan fails with
// an auth error. To move this off the client, first set up a Rork Functions
// backend proxy at /api/ocr, then switch both env vars to server-only names.
// See: https://docs.expo.dev/build-reference/variables/
const SECRET_KEY = process.env.EXPO_PUBLIC_RORK_TOOLKIT_SECRET_KEY as string;

// TODO(security): Verify this model name against your specific Rork toolkit
// deployment docs. An incorrect identifier will cause 404/400 errors at runtime.
// If scans fail with "OCR request failed", check the model string first.
const MODEL = "google/gemini-3.1-flash-lite";

const SYSTEM_PROMPT = `You are a grocery receipt OCR engine. Your job is to determine if the image is a receipt and extract store + line items.

Return ONLY valid JSON — no markdown, no explanation, no conversational text:
{
  "is_receipt": true,
  "store": "Store Name",
  "items": [
    { "name": "ITEM NAME", "price": 0.00, "quantity": 12, "unit": "ct", "category": "Dairy", "type": "regular" }
  ]
}

Item type field: "regular" for normal purchases, "promo" for promotional/free items, "discount" for coupon/discount line items. Only use "promo" or "discount" when the receipt explicitly marks the item as free or promotional.

Rules:
- is_receipt: true if the image shows a grocery receipt or store receipt. false if it's anything else (person, landscape, screenshot, document, etc).
- Store name: extract from the receipt header/logo. If unknown, use "Unknown Store".
- Items: every line that has a product name AND a price.
- IGNORE: tax lines, totals, subtotals, discounts, coupons, bottle deposits, CRV, bag fees, membership savings, loyalty points, fuel rewards, gift card transactions, payment method lines (cash/card tender), balance due, change given, and blank lines. Do NOT include these as items.
- Prices: numeric only, no currency symbols. For example 4.99 not "$4.99". Round to 2 decimal places.
- Names: clean product names — strip store codes but keep size info (e.g. "Large Eggs 12ct").
- quantity: the numeric count or size (e.g. 12 for "12ct", 16 for "16oz", 1 for "1 gal", 2 for "2 lb"). Default to 1 if no quantity is visible on the line.
- unit: the unit label found on the line (e.g. "ct", "oz", "lb", "gal", "each"). Default to "ea" if no unit is visible.
- category: one of "Dairy", "Meat", "Produce", "Pantry", "Snacks" — based on what the product actually is. For example eggs→Dairy, chicken→Meat, lettuce→Produce, pasta→Pantry, chips→Snacks.`;

export type OcrResult = {
  is_receipt: boolean;
  store: string;
  items: { name: string; price: number; quantity?: number; unit?: string; category?: string; type?: "regular" | "promo" | "discount" }[];
};

/**
 * Send a receipt image to the AI vision model and extract store name + line items.
 * Returns the parsed result or throws on failure.
 */
export async function scanReceipt(imageUri: string): Promise<OcrResult> {
  const { base64, mimeType } = await resizeForUpload(imageUri);

  const response = await fetch(`${TOOLKIT_URL}/v2/vercel/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SECRET_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        {
          role: "system",
          content: SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Extract the store name and all line items with prices from this grocery receipt.",
            },
            {
              type: "image_url",
              image_url: {
                url: `data:${mimeType};base64,${base64}`,
              },
            },
          ],
        },
      ],
      max_tokens: 4000,
      temperature: 0,
      // NOTE: response_format { type: "json_object" } is NOT sent here because
      // several model/gateway combinations (including google/gemini-* through
      // certain proxies) reject it or silently ignore it, causing empty/invalid
      // JSON. The system prompt already commands pure-JSON output, and the
      // multi-strategy extraction below handles any leftover prose.
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const detail = text.slice(0, 300);
    // Surface the HTTP status and detail so the scan screen can show a specific
    // recovery hint (e.g. 401 → check key, 404 → wrong model name, 413 → image
    // too large).
    const err = new Error(`OCR request failed (${response.status}): ${detail}`);
    (err as any).code = `HTTP_${response.status}`;
    throw err;
  }

  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };

  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("OCR returned empty response");

  // Robust JSON extraction with multiple fallback strategies.
  // Strategy 1: try direct parse first (response_format ensures clean JSON).
  let json: OcrResult | null = null;

  // Strategy 2: strip markdown code fences (```json ... ``` or ``` ... ```).
  const fenceMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  const fenceContent = fenceMatch ? fenceMatch[1].trim() : null;

  // Strategy 3: find the largest JSON object via brace matching.
  const firstBrace = content.indexOf("{");
  const lastBrace = content.lastIndexOf("}");
  const hasBraces = firstBrace !== -1 && lastBrace !== -1 && firstBrace < lastBrace;

  // Try each strategy in order: direct → fence → brace extraction
  for (const candidate of [
    content,                                  // Strategy 1: raw content
    fenceContent,                             // Strategy 2: markdown fence
    hasBraces ? content.slice(firstBrace, lastBrace + 1) : null, // Strategy 3: braces
  ]) {
    if (!candidate) continue;

    // For brace-extracted content, verify balanced braces.
    if (candidate === (hasBraces ? content.slice(firstBrace, lastBrace + 1) : null)) {
      let braceDepth = 0;
      for (const ch of candidate) {
        if (ch === "{") braceDepth++;
        else if (ch === "}") braceDepth--;
        if (braceDepth < 0) break;
      }
      if (braceDepth !== 0) continue; // unbalanced — skip this candidate
    }

    try {
      json = JSON.parse(candidate) as OcrResult;
      break;
    } catch {
      // This strategy failed; try the next one.
    }
  }

  if (!json) {
    throw new Error(`Failed to parse OCR response as JSON: ${content.slice(0, 200)}`);
  }

  // Strict receipt guard — reject unless the AI explicitly returns is_receipt: true.
  // Null, undefined, or missing values are treated as non-receipts to prevent
  // scans of non-receipt images from proceeding with garbage data.
  if (json.is_receipt !== true) {
    const err = new Error("Please scan a clear grocery receipt.");
    (err as any).code = "INVALID_IMAGE";
    throw err;
  }

  if (!Array.isArray(json.items)) {
    throw new Error("OCR response missing items array");
  }

  // Validate and clean items
  const VALID_CATEGORIES = new Set(["Dairy", "Meat", "Produce", "Pantry", "Snacks"]);
  const VALID_UNITS = new Set(["ct", "oz", "lb", "gal", "ea", "each", "fl oz", "pt", "qt", "dozen", "pack"]);
  const VALID_TYPES = new Set(["regular", "promo", "discount"]);
  const items = json.items
    .map((item) => {
      const rawPrice = typeof item.price === "string" ? Number.parseFloat(item.price) : Number(item.price ?? 0);
      // Normalize to 2 decimal places
      const price = Number.isFinite(rawPrice) ? Math.round(rawPrice * 100) / 100 : 0;

      // Quantity: default to 1 if missing or invalid
      const rawQty = item.quantity != null ? Number(item.quantity) : NaN;
      const quantity = Number.isFinite(rawQty) && rawQty > 0 ? rawQty : 1;

      // Unit: default to "ea" if missing, normalize known aliases
      const rawUnit = item.unit ? String(item.unit).trim().toLowerCase() : "";
      const unit = VALID_UNITS.has(rawUnit) ? rawUnit : "ea";

      // Category: validate against known set
      const rawCat = item.category ? String(item.category).trim() : "";
      const category = VALID_CATEGORIES.has(rawCat) ? rawCat : undefined;

      // Type: validate against known set, default to "regular"
      const rawType = item.type ? String(item.type).trim().toLowerCase() : "";
      const type = VALID_TYPES.has(rawType) ? (rawType as "regular" | "promo" | "discount") : "regular";

      return {
        name: String(item.name ?? "").trim(),
        price,
        quantity,
        unit,
        category,
        type,
      };
    })
    // Items with price 0 are kept ONLY when explicitly marked promo/discount.
    // All other zero-price items are filtered out as noise.
    .filter((item) => {
      if (!item.name) return false;
      if (!Number.isFinite(item.price)) return false;
      if (item.price <= 0 && item.type !== "promo" && item.type !== "discount") return false;
      return true;
    });

  if (!items.length) throw new Error("No valid items found in receipt");

  // Store: default to "Unknown Store" only when the AI returns null/empty.
  // Do NOT default on scan failure — the guard above handles that.
  const store = (json.store != null && String(json.store).trim()) ? String(json.store).trim() : "Unknown Store";

  return { is_receipt: true, store, items };
}
