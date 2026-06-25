// Normalize OCR'd item names to canonical product keys.
// Strips weights, volumes, store prefixes, and modifiers so the same product
// across receipts is recognized as one.

const ABBREV: Record<string, string> = {
  ORG: "ORGANIC",
  LG: "LARGE",
  WHL: "WHOLE",
  FF: "FAT FREE",
  GV: "",
  WFM: "",
  CHKN: "CHICKEN",
  GRK: "GREEK",
  OJ: "ORANGE JUICE",
};

// Weights, volumes, package sizes — stripped because they don't affect product identity.
const STRIP_WORDS = new Set([
  "DOZEN", "CT", "LB", "LBS", "OZ", "ML", "GAL", "GALLON",
  "L", "KG", "G", "PK", "EA", "COUNT", "LOAF", "STICKS",
  "HALF", "QUART", "PINT", "BUNCH",
]);

// Core product roots — after stripping, remaining words are checked against these.
// Simple word matching replaces the old regex-based KEYWORDS list.
const PRODUCT_ROOTS: { roots: string[]; key: string; canonical: string }[] = [
  { roots: ["EGG", "EGGS"], key: "eggs", canonical: "Eggs" },
  { roots: ["MILK"], key: "milk", canonical: "Whole Milk" },
  { roots: ["BUTTER"], key: "butter", canonical: "Butter" },
  { roots: ["BREAD", "SOURDOUGH", "LOAF"], key: "bread", canonical: "Bread" },
  { roots: ["CHICKEN", "BREAST", "WING", "THIGH"], key: "chicken-breast", canonical: "Chicken Breast" },
  { roots: ["BEEF", "STEAK"], key: "ground-beef", canonical: "Ground Beef" },
  { roots: ["BANANA", "BANANAS"], key: "bananas", canonical: "Bananas" },
  { roots: ["CHEDDAR", "CHEESE"], key: "cheddar", canonical: "Cheddar Cheese" },
  { roots: ["YOGURT"], key: "yogurt", canonical: "Greek Yogurt" },
  { roots: ["JUICE"], key: "orange-juice", canonical: "Orange Juice" },
];

// Strip numeric+unit patterns: "12CT", "1LB", "750ML", "64OZ", "5.3OZ", "1 GAL", etc.
const RE_UNIT = /\b\d+(?:\.\d+)?\s*(?:CT|LB|LBS|OZ|ML|GAL|L|KG|G|PK|EA|COUNT)\b/gi;

export function normalize(raw: string): { key: string; canonical: string } {
  let s = raw.toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

  // Strip weight/volume patterns
  s = s.replace(RE_UNIT, " ").replace(/\s+/g, " ").trim();

  // Expand abbreviations and strip non-identity words
  s = s
    .split(" ")
    .map((w) => (w in ABBREV ? ABBREV[w] : w))
    .filter((w) => w.length > 0 && !STRIP_WORDS.has(w))
    .join(" ");

  // Strip likely SKU codes (long digit runs)
  s = s.replace(/\b\d{4,}\b/g, "").trim();

  if (!s) {
    return { key: "item", canonical: raw.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) };
  }

  // Check remaining words against product roots
  const words = s.split(" ");
  for (const w of words) {
    for (const pr of PRODUCT_ROOTS) {
      if (pr.roots.some((r) => w === r)) {
        return { key: pr.key, canonical: pr.canonical };
      }
    }
  }

  // Fallback: slug of remaining text
  const key = s.toLowerCase().replace(/\s+/g, "-").slice(0, 40);
  const canonical = s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  return { key, canonical };
}
