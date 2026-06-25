// Normalize OCR'd item names to canonical product keys so the same product
// across receipts is recognized as one.
const ABBREV: Record<string, string> = {
  ORG: "ORGANIC",
  LG: "LARGE",
  WHL: "WHOLE",
  FF: "FAT FREE",
  GV: "",
  CHKN: "CHICKEN",
  GRK: "GREEK",
  OJ: "ORANGE JUICE",
};

const KEYWORDS: { key: string; canonical: string; match: RegExp }[] = [
  { key: "eggs", canonical: "Eggs", match: /\bEGG/ },
  { key: "milk", canonical: "Whole Milk", match: /\bMILK/ },
  { key: "butter", canonical: "Butter", match: /\bBUTTER/ },
  { key: "bread", canonical: "Bread", match: /\b(BREAD|LOAF|SOURDOUGH)/ },
  { key: "chicken-breast", canonical: "Chicken Breast", match: /CHICKEN.*BREAST|BREAST/ },
  { key: "ground-beef", canonical: "Ground Beef", match: /GROUND BEEF|BEEF/ },
  { key: "orange-juice", canonical: "Orange Juice", match: /ORANGE JUICE|\bOJ\b/ },
  { key: "bananas", canonical: "Bananas", match: /BANANA/ },
  { key: "cheddar", canonical: "Cheddar Cheese", match: /CHEDDAR|CHEESE/ },
  { key: "yogurt", canonical: "Greek Yogurt", match: /YOGURT/ },
];

export function normalize(raw: string): { key: string; canonical: string } {
  let s = raw.toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  s = s
    .split(" ")
    .map((w) => (w in ABBREV ? ABBREV[w] : w))
    .filter(Boolean)
    .join(" ");
  // Strip likely SKU codes (long digit runs)
  s = s.replace(/\b\d{4,}\b/g, "").trim();

  for (const k of KEYWORDS) {
    if (k.match.test(s)) return { key: k.key, canonical: k.canonical };
  }
  // Fallback: slug of normalized text
  const key = s.toLowerCase().replace(/\s+/g, "-").slice(0, 40) || "item";
  const canonical = s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  return { key, canonical };
}
