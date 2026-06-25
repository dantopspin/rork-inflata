// US national average prices (approx) used for baseline placeholders.
export type Staple = {
  id: string;
  name: string;
  unit: string;
  avgPrice: number;
};

export const STAPLES: Staple[] = [
  { id: "eggs", name: "Eggs", unit: "dozen", avgPrice: 3.34 },
  { id: "milk", name: "Whole Milk", unit: "gallon", avgPrice: 4.05 },
  { id: "bread", name: "Bread", unit: "loaf", avgPrice: 2.05 },
  { id: "butter", name: "Butter", unit: "1 lb", avgPrice: 4.85 },
  { id: "chicken-breast", name: "Chicken Breast", unit: "per lb", avgPrice: 4.2 },
  { id: "ground-beef", name: "Ground Beef", unit: "per lb", avgPrice: 5.5 },
  { id: "orange-juice", name: "Orange Juice", unit: "half gallon", avgPrice: 4.35 },
  { id: "bananas", name: "Bananas", unit: "per lb", avgPrice: 0.65 },
  { id: "cheddar", name: "Cheddar Cheese", unit: "8 oz", avgPrice: 3.45 },
  { id: "yogurt", name: "Greek Yogurt", unit: "single", avgPrice: 1.3 },
];

// Mocked OCR receipts — used by the simulated capture flow.
// Real device-camera + on-device OCR isn't available in the cloud preview; we
// simulate deterministic-but-varied receipts so users experience the full flow.
export type MockReceipt = {
  store: string;
  lines: { name: string; price: number }[];
};

export const MOCK_RECEIPTS: MockReceipt[] = [
  {
    store: "Whole Foods Market",
    lines: [
      { name: "ORG LG EGGS DOZEN", price: 6.49 },
      { name: "WHL MILK GAL", price: 5.29 },
      { name: "SALTED BUTTER 1LB", price: 6.99 },
      { name: "CHICKEN BREAST LB", price: 5.99 },
      { name: "BANANAS LB", price: 0.79 },
      { name: "GREEK YOGURT", price: 1.99 },
    ],
  },
  {
    store: "Kroger",
    lines: [
      { name: "LARGE EGGS 12CT", price: 4.79 },
      { name: "MILK 1 GAL", price: 4.49 },
      { name: "WHEAT BREAD", price: 2.99 },
      { name: "GROUND BEEF LB", price: 6.29 },
      { name: "ORANGE JUICE 64OZ", price: 5.49 },
      { name: "CHEDDAR 8OZ", price: 4.29 },
    ],
  },
  {
    store: "Trader Joe's",
    lines: [
      { name: "EGGS DOZEN", price: 3.99 },
      { name: "WHOLE MILK GAL", price: 4.19 },
      { name: "SOURDOUGH LOAF", price: 3.49 },
      { name: "GRK YOGURT 5.3OZ", price: 1.49 },
      { name: "BANANAS LB", price: 0.49 },
    ],
  },
  {
    store: "Target",
    lines: [
      { name: "GV LARGE EGGS", price: 5.29 },
      { name: "BUTTER STICKS 1LB", price: 5.99 },
      { name: "CHKN BREAST FF LB", price: 6.49 },
      { name: "OJ HALF GAL", price: 4.99 },
      { name: "CHEDDAR SHARP 8OZ", price: 3.99 },
    ],
  },
];

export const FREE_SOFT_PROMPT_AT = 2;
export const FREE_HARD_GATE_AT = 4;
export const FREE_SCAN_LIMIT = 10;

export function uuid(): string {
  // Cross-platform unique id.
  return (
    Date.now().toString(36) +
    "-" +
    Math.random().toString(36).slice(2, 10) +
    Math.random().toString(36).slice(2, 6)
  );
}
