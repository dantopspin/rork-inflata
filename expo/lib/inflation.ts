import { Scan, ItemStat, Confidence } from "@/types";

const FREQ_PER_MONTH: Record<string, number> = {
  "multi-week": 8,
  weekly: 4,
  biweekly: 2,
  monthly: 1,
};

export const realScans = (scans: Scan[]): Scan[] => scans.filter((s) => s.source === "scan");
export const realScanCount = (scans: Scan[]): number => realScans(scans).length;

export function freqPurchasesPerYear(f: string | null): number {
  if (!f) return 26;
  return (FREQ_PER_MONTH[f] ?? 4) * 12;
}

/** Compute trips per month from the user's declared shopping frequency. */
function tripsPerMonth(f: string | null): number {
  if (!f) return 4;
  return FREQ_PER_MONTH[f] ?? 4;
}

export function aggregateItems(scans: Scan[]): ItemStat[] {
  const byKey = new Map<
    string,
    { entries: { date: string; price: number; fromBaseline: boolean; name: string; store: string }[] }
  >();
  for (const s of scans) {
    for (const it of s.items) {
      if (!byKey.has(it.itemKey)) byKey.set(it.itemKey, { entries: [] });
      byKey.get(it.itemKey)!.entries.push({
        date: s.date,
        price: it.price,
        fromBaseline: s.source === "baseline_estimate",
        name: it.name,
        store: s.store,
      });
    }
  }

  const stats: ItemStat[] = [];
  for (const [key, { entries }] of byKey) {
    entries.sort((a, b) => a.date.localeCompare(b.date));
    const first = entries[0];
    const last = entries[entries.length - 1];
    const realApp = entries.filter((e) => !e.fromBaseline).length;

    let biggestJumpPct = 0;
    let biggestJumpDate: string | undefined;
    for (let i = 1; i < entries.length; i++) {
      const prev = entries[i - 1].price;
      const cur = entries[i].price;
      const pct = ((cur - prev) / prev) * 100;
      if (pct > biggestJumpPct) {
        biggestJumpPct = pct;
        biggestJumpDate = entries[i].date;
      }
    }
    const pct = ((last.price - first.price) / first.price) * 100;

    // Track cheapest price and store across all history (store-to-store arbitrage)
    let cheapestPrice = Infinity;
    let cheapestStore = "";
    for (const e of entries) {
      if (e.price < cheapestPrice) {
        cheapestPrice = e.price;
        cheapestStore = e.store;
      }
    }

    stats.push({
      key,
      name: last.name,
      firstPrice: first.price,
      firstFromBaseline: first.fromBaseline,
      firstDate: first.date,
      currentPrice: last.price,
      currentDate: last.date,
      pctChange: pct,
      dollarChange: last.price - first.price,
      appearances: entries.length,
      realAppearances: realApp,
      cumulativeOverspend: 0, // filled below
      biggestJumpDate,
      biggestJumpPct,
      cheapestPrice: cheapestPrice < Infinity ? cheapestPrice : undefined,
      cheapestStore: cheapestStore || undefined,
      history: entries.map((e) => ({
        date: e.date,
        price: e.price,
        fromBaseline: e.fromBaseline,
        store: e.store,
      })),
    });
  }
  return stats;
}

/**
 * 30-day "Tax on your Wallet" — based on the price delta between
 * the last two real scans for each item, projected to a 30-day window.
 * More believable than a 6-month straight-line extrapolation.
 */
export function withOverspend(stats: ItemStat[], frequency: string | null): ItemStat[] {
  const tpm = tripsPerMonth(frequency);
  // Average days between trips
  const avgDaysBetween = tpm > 0 ? 30 / tpm : 7;

  return stats.map((s) => {
    // Find the last two real-scan entries (non-baseline)
    const realEntries = s.history.filter((h) => !h.fromBaseline);
    if (realEntries.length < 2) {
      return { ...s, cumulativeOverspend: 0 };
    }

    const penultimate = realEntries[realEntries.length - 2];
    const latest = realEntries[realEntries.length - 1];

    const delta = latest.price - penultimate.price;
    if (delta <= 0) return { ...s, cumulativeOverspend: 0 };

    // Project the price increase to a 30-day window
    const daysBetween =
      (new Date(latest.date).getTime() - new Date(penultimate.date).getTime()) /
      (1000 * 60 * 60 * 24);
    const effectiveDays = Math.max(daysBetween, avgDaysBetween);

    const tax30 = delta * (30 / effectiveDays);
    return { ...s, cumulativeOverspend: Math.round(tax30 * 100) / 100 };
  });
}

export function inflationScore(stats: ItemStat[]): number {
  if (!stats.length) return 0;
  const weighted = stats.reduce((acc, s) => acc + s.pctChange * Math.max(1, s.appearances), 0);
  const weight = stats.reduce((acc, s) => acc + Math.max(1, s.appearances), 0);
  return weighted / weight;
}

export function painIndex(stats: ItemStat[], totalSpendDelta: number): number {
  if (!stats.length) return 0;
  const spendInc = Math.min(100, Math.max(0, totalSpendDelta * 2));
  const spikedShare = (stats.filter((s) => s.pctChange > 5).length / stats.length) * 100;
  const newSpikes = Math.min(100, stats.filter((s) => (s.biggestJumpPct ?? 0) > 5).length * 12);
  return Math.round(spendInc * 0.5 + spikedShare * 0.3 + newSpikes * 0.2);
}

export function painLabel(score: number): string {
  if (score <= 30) return "Prices are relatively stable for you";
  if (score <= 60) return "You're feeling the squeeze";
  if (score <= 80) return "Your grocery costs are taking a real hit";
  return "Grocery costs are rising sharply for you";
}

export function confidence(scans: Scan[], stats: ItemStat[]): Confidence {
  const real = realScans(scans).length;
  const tracked = stats.length;
  if (real >= 8 && tracked >= 30) return { level: "high", label: "High confidence" };
  if (real >= 3 && tracked >= 10)
    return { level: "medium", label: "Building confidence — keep scanning" };
  return { level: "low", label: "Preliminary — based on your baseline setup" };
}

export function itemConfidence(stat: ItemStat): Confidence {
  if (stat.realAppearances >= 4) return { level: "high", label: "High confidence" };
  if (stat.realAppearances >= 2) return { level: "medium", label: "Building confidence" };
  return { level: "low", label: "Preliminary — based on your baseline" };
}

export function totalSpendBaselineVsCurrent(stats: ItemStat[]): number {
  return stats.reduce((acc, s) => acc + Math.max(0, s.dollarChange), 0);
}

/** Average spend per trip across all real scans. */
export function averageBasketSize(scans: Scan[]): number {
  const real = realScans(scans);
  if (!real.length) return 0;
  const total = real.reduce((acc, s) => acc + s.items.reduce((sum, it) => sum + it.price, 0), 0);
  return total / real.length;
}

/** Predict the user's next trip cost: avg basket × (1 + personal inflation rate). */
export function nextTripEstimate(scans: Scan[], stats: ItemStat[]): number {
  const avg = averageBasketSize(scans);
  if (!avg) return 0;
  const infl = inflationScore(stats);
  return avg * (1 + Math.max(0, infl) / 100);
}
