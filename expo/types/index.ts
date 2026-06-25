export type ItemSource = "scan" | "baseline_estimate";

export type ScanItem = {
  itemKey: string; // canonical key
  name: string; // canonical display name
  rawName: string; // OCR raw
  price: number;
  originalStoreName?: string; // store this item was scanned at
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
  history: { date: string; price: number; fromBaseline: boolean; store: string }[];
};

export type TripStrategyItem = {
  key: string;
  name: string;
  pctChange: number;
  action: "buy_at" | "wait" | "stock_up" | "as_planned" | "substitution_suggested";
  store: string;
  volatility: number;
};
