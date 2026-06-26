import { resizeForUpload } from "./resize-for-upload";

const TOOLKIT_URL = process.env.EXPO_PUBLIC_TOOLKIT_URL as string;
const SECRET_KEY = process.env.EXPO_PUBLIC_RORK_TOOLKIT_SECRET_KEY as string;

// Verify this model name against toolkit docs
const MODEL = "google/gemini-3.1-flash-lite";

const SYSTEM_PROMPT = `You are a grocery receipt OCR engine. Your job is to determine if the image is a receipt and extract store + line items.

Return ONLY valid JSON — no markdown, no explanation, no conversational text:
{
  "is_receipt": true,
  "store": "Store Name",
  "items": [
    { "name": "ITEM NAME", "price": 0.00, "quantity": 12, "unit": "ct", "category": "Dairy" }
  ]
}

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
  items: { name: string; price: number; quantity?: number; unit?: string; category?: string }[];
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
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`OCR request failed (${response.status}): ${text.slice(0, 200)}`);
  }

  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };

  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("OCR returned empty response");

  // Robust JSON extraction — find the largest JSON object in the response
  // This handles AI conversational noise like markdown wrappers or trailing text
  const firstBrace = content.indexOf("{");
  const lastBrace = content.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || firstBrace >= lastBrace) {
    throw new Error(`No JSON object found in OCR response: ${content.slice(0, 200)}`);
  }
  const jsonSubstring = content.slice(firstBrace, lastBrace + 1);

  let json: OcrResult;
  try {
    json = JSON.parse(jsonSubstring) as OcrResult;
  } catch {
    throw new Error(`Failed to parse OCR response: ${jsonSubstring.slice(0, 200)}`);
  }

  // Receipt guard — reject non-receipt images early
  if (json.is_receipt === false) {
    const err = new Error("Please scan a clear grocery receipt.");
    (err as any).code = "INVALID_IMAGE";
    throw err;
  }

  if (!json.store || !Array.isArray(json.items)) {
    throw new Error("OCR response missing store or items");
  }

  // Validate and clean items
  const VALID_CATEGORIES = new Set(["Dairy", "Meat", "Produce", "Pantry", "Snacks"]);
  const VALID_UNITS = new Set(["ct", "oz", "lb", "gal", "ea", "each", "fl oz", "pt", "qt", "dozen", "pack"]);
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

      return {
        name: String(item.name ?? "").trim(),
        price,
        quantity,
        unit,
        category,
      };
    })
    .filter((item) => item.name && Number.isFinite(item.price) && item.price > 0);

  if (!items.length) throw new Error("No valid items found in receipt");

  return { is_receipt: true, store: json.store.trim() || "Unknown Store", items };
}
