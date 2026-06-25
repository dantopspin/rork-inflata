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

export function aggregateItems(scans: Scan[]): ItemStat[] {
  const byKey = new Map<
    string,
    { entries: { date: string; price: number; fromBaseline: boolean; name: string }[] }
  >();
  for (const s of scans) {
    for (const it of s.items) {
      if (!byKey.has(it.itemKey)) byKey.set(it.itemKey, { entries: [] });
      byKey.get(it.itemKey)!.entries.push({
        date: s.date,
        price: it.price,
        fromBaseline: s.source === "baseline_estimate",
        name: it.name,
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
      history: entries.map((e) => ({ date: e.date, price: e.price, fromBaseline: e.fromBaseline })),
    });
  }
  return stats;
}

export function withOverspend(stats: ItemStat[], frequency: string | null): ItemStat[] {
  const perYear = freqPurchasesPerYear(frequency);
  return stats.map((s) => {
    // Heuristic: an item's purchase frequency ≈ trips/year × (its appearance rate)
    const overspendPerYear = Math.max(0, s.dollarChange) * (perYear / Math.max(4, perYear / 2));
    return { ...s, cumulativeOverspend: (overspendPerYear / 12) * 6 }; // approx 6-month projection
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
