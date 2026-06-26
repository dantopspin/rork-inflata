export type ItemSource = "scan" | "baseline_estimate";

export type ScanItem = {
  itemKey: string; // canonical key
  name: string; // canonical display name
  rawName: string; // OCR raw
  price: number;
  originalStoreName?: string; // store this item was scanned at
  unitQuantity?: number; // parsed quantity (e.g. 12 for "12ct eggs")
  unitMeasure?: string; // parsed unit (e.g. "oz", "ct", "lb")
  category?: string; // AI-assigned category (Dairy, Meat, Produce, Pantry, Snacks)
  type?: "regular" | "promo" | "discount"; // item type — promo/discount items may have price 0
};

export type Scan = {
  id: string;
  date: string; // ISO
  store: string;
  items: ScanItem[];
  source: ItemSource;
};

export type Frequency = "multi-week" | "weekly" | "biweekly" | "monthly";

export type Confidence = {
  level: "low" | "medium" | "high";
  label: string;
};

export type ItemStat = {
  key: string;
  name: string;
  firstPrice: number;
  firstFromBaseline: boolean;
  firstDate: string;
  currentPrice: number;
  currentDate: string;
  pctChange: number;
  dollarChange: number;
  appearances: number;
  realAppearances: number;
  cumulativeOverspend: number;
  biggestJumpDate?: string;
  biggestJumpPct?: number;
  cheapestPrice?: number;
  cheapestStore?: string;
  volatility: number; // standard deviation of price across all scans
  lastSeenDays: number; // days since this item was last scanned
  canonicalUnitPrice?: number; // price per base unit when quantity is known (e.g. $/oz, $/ct)
  unitQuantity?: number; // most recent known quantity
  unitMeasure?: string; // most recent known unit of measure
  totalSpend: number; // total amount spent on this item across all real scans
  isSmartSave?: boolean; // user bought a cheaper brand/variant of a previously tracked item
  isOutlier?: boolean; // true when raw price change >100% — likely OCR/data error, not a real trend
  unitPriceChange?: number; // percentage change in canonical unit price (first→last entry with unit data)
  unitPriceConfidence?: "low" | "medium" | "high"; // reliability of unit-price trend data
  history: { date: string; price: number; fromBaseline: boolean; store: string; canonicalUnitPrice?: number }[];
};

export type TripStrategyItem = {
  key: string;
  name: string;
  pctChange: number;
  action: "buy_at" | "wait" | "stock_up" | "as_planned" | "substitution_suggested";
  store: string;
  volatility: number;
};
