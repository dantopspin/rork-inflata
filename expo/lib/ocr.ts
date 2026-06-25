import { resizeForUpload } from "./resize-for-upload";

const TOOLKIT_URL = process.env.EXPO_PUBLIC_TOOLKIT_URL as string;
const SECRET_KEY = process.env.EXPO_PUBLIC_RORK_TOOLKIT_SECRET_KEY as string;

const MODEL = "google/gemini-3.1-flash-lite";

const SYSTEM_PROMPT = `You are a grocery receipt OCR engine. Extract the store name from the receipt header and every line item with its price. 

Return ONLY valid JSON — no markdown, no explanation:
{
  "store": "Store Name",
  "items": [
    { "name": "ITEM NAME", "price": 0.00 }
  ]
}

Rules:
- Store name: extract from the receipt header/logo. If unknown, use "Unknown Store".
- Items: every line that has a product name AND a price. Skip tax, totals, subtotals, discounts, and blank lines.
- Prices: numeric only, no currency symbols. For example 4.99 not "$4.99".
- Names: clean product names — strip store codes but keep size info (e.g. "Large Eggs 12ct").`;

export type OcrResult = {
  store: string;
  items: { name: string; price: number }[];
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
      max_tokens: 2000,
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

  // Parse the JSON — handle possible markdown wrapping
  let json: OcrResult;
  try {
    // Try direct parse first
    json = JSON.parse(content) as OcrResult;
  } catch {
    // Try extracting from markdown code block
    const match = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match?.[1]) {
      json = JSON.parse(match[1]) as OcrResult;
    } else {
      throw new Error(`Failed to parse OCR response: ${content.slice(0, 200)}`);
    }
  }

  if (!json.store || !Array.isArray(json.items)) {
    throw new Error("OCR response missing store or items");
  }

  // Validate and clean items
  const items = json.items
    .map((item) => ({
      name: String(item.name ?? "").trim(),
      price: typeof item.price === "string" ? Number.parseFloat(item.price) : Number(item.price ?? 0),
    }))
    .filter((item) => item.name && Number.isFinite(item.price) && item.price > 0);

  if (!items.length) throw new Error("No valid items found in receipt");

  return { store: json.store.trim() || "Unknown Store", items };
}
