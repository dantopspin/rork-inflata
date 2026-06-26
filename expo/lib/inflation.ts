import { Scan, ItemStat, Confidence, TripStrategyItem } from "@/types";

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
  type AgrEntry = {
    date: string;
    price: number;
    fromBaseline: boolean;
    name: string;
    store: string;
    unitQuantity?: number;
    unitMeasure?: string;
    canonicalUnitPrice?: number;
  };

  const byKey = new Map<string, { entries: AgrEntry[] }>();
  for (const s of scans) {
    for (const it of s.items) {
      if (!byKey.has(it.itemKey)) byKey.set(it.itemKey, { entries: [] });

      // Compute canonical unit price when both price and quantity are known.
      // Guard against zero quantity to prevent NaN / Infinity crashes.
      let cup: number | undefined;
      if (
        it.unitQuantity != null &&
        Number.isFinite(it.unitQuantity) &&
        it.unitQuantity > 0 &&
        Number.isFinite(it.price)
      ) {
        cup = it.price / it.unitQuantity;
      }

      byKey.get(it.itemKey)!.entries.push({
        date: s.date,
        price: it.price,
        fromBaseline: s.source === "baseline_estimate",
        name: it.name,
        store: s.store,
        unitQuantity: it.unitQuantity,
        unitMeasure: it.unitMeasure,
        canonicalUnitPrice: cup,
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
      // Skip transitions that start from a baseline estimate — the gap
      // between a 90-day-old national-average guess and a real store price
      // is not a real spike and misleads the Price Alert card.
      if (entries[i - 1].fromBaseline) continue;
      const prev = entries[i - 1].price;
      const cur = entries[i].price;
      const pct = ((cur - prev) / prev) * 100;
      if (pct > biggestJumpPct) {
        biggestJumpPct = pct;
        biggestJumpDate = entries[i].date;
      }
    }
    // Use first REAL (non-baseline) entry as baseline so synthetic estimates
    // don't dominate the inflation percentage when real scan data exists.
    const firstReal = entries.find((e) => !e.fromBaseline);
    const baseEntry = firstReal ?? first;
    const pct = ((last.price - baseEntry.price) / baseEntry.price) * 100;

    // Track cheapest price and store — exclude baseline entries so
    // "Baseline estimate" never appears as a store in Watchlist or savings.
    let cheapestPrice = Infinity;
    let cheapestStore = "";
    for (const e of entries) {
      if (!e.fromBaseline && e.price < cheapestPrice) {
        cheapestPrice = e.price;
        cheapestStore = e.store;
      }
    }

    // Standard deviation of price (volatility)
    const mean = entries.reduce((sum, e) => sum + e.price, 0) / entries.length;
    const variance = entries.reduce((sum, e) => sum + (e.price - mean) ** 2, 0) / entries.length;
    const volatility = Math.sqrt(variance);

    // Days since this item was last seen
    const lastDate = new Date(last.date).getTime();
    const lastSeenDays = (Date.now() - lastDate) / (1000 * 60 * 60 * 24);

    // Total amount spent on this item across all real (non-baseline) scans
    const totalSpend = entries
      .filter((e) => !e.fromBaseline)
      .reduce((sum, e) => sum + e.price, 0);

    // Most recent entry that has a canonical unit price
    const lastUnitEntry = [...entries].reverse().find((e) => e.canonicalUnitPrice != null);

    // --- Smart Save detection ---
    // Flag when the user bought a cheaper version of an item they've purchased before.
    // Criteria: (1) at least 2 real scans of this item, (2) latest price is below the
    // average of prior prices, (3) latest store differs from the most common prior store.
    let isSmartSave = false;
    const realOnly = entries.filter((e) => !e.fromBaseline);
    if (realOnly.length >= 2) {
      const latest = realOnly[realOnly.length - 1];
      const priors = realOnly.slice(0, -1);
      const priorAvg = priors.reduce((s, e) => s + e.price, 0) / priors.length;
      if (latest.price < priorAvg * 0.95) {
        // Count store frequencies among priors to find the "usual" store
        const storeCount = new Map<string, number>();
        for (const p of priors) storeCount.set(p.store, (storeCount.get(p.store) ?? 0) + 1);
        let usualStore = "";
        let maxCount = 0;
        for (const [st, c] of storeCount) {
          if (c > maxCount) { maxCount = c; usualStore = st; }
        }
        // Smart save: cheaper AND from a different store than usual
        if (latest.store && usualStore && latest.store !== usualStore) {
          isSmartSave = true;
        }
      }
    }

    // --- Unit-price confidence ---
    const unitEntries = entries.filter((e) => e.canonicalUnitPrice != null);
    let unitPriceConfidence: "low" | "medium" | "high" = "low";
    let unitPriceChange: number | undefined;
    if (unitEntries.length >= 2) {
      // Anchor to the first REAL unit entry — same pattern as pctChange.
      // Baseline estimates never carry quantity data, so they're absent from
      // unitEntries in practice, but we filter defensively in case the data
      // model evolves.
      const firstRealUnit = unitEntries.find((e) => !e.fromBaseline);
      const anchorUnit = firstRealUnit ?? unitEntries[0];
      const firstUP = anchorUnit.canonicalUnitPrice!;
      const lastUP = unitEntries[unitEntries.length - 1].canonicalUnitPrice!;
      if (firstUP > 0) unitPriceChange = ((lastUP - firstUP) / firstUP) * 100;
      const totalEntries = entries.length;
      const unitRatio = unitEntries.length / totalEntries;
      if (unitRatio >= 0.8) unitPriceConfidence = "high";
      else if (unitRatio >= 0.4) unitPriceConfidence = "medium";
      // stays "low" otherwise
    }

    // --- Sanity filter: flag outlier price changes (>100%) as likely data errors ---
    const isOutlier = Math.abs(pct) > 100;

    stats.push({
      key,
      name: last.name,
      firstPrice: baseEntry.price,
      firstFromBaseline: baseEntry.fromBaseline,
      firstDate: baseEntry.date,
      currentPrice: last.price,
      currentDate: last.date,
      pctChange: pct,
      dollarChange: last.price - baseEntry.price,
      appearances: entries.length,
      realAppearances: realApp,
      cumulativeOverspend: 0, // filled below
      biggestJumpDate,
      biggestJumpPct,
      cheapestPrice: cheapestPrice < Infinity ? cheapestPrice : undefined,
      cheapestStore: cheapestStore || undefined,
      volatility,
      lastSeenDays,
      canonicalUnitPrice: lastUnitEntry?.canonicalUnitPrice,
      unitQuantity: lastUnitEntry?.unitQuantity,
      unitMeasure: lastUnitEntry?.unitMeasure,
      totalSpend,
      isSmartSave: isSmartSave || undefined,
      isOutlier: isOutlier || undefined,
      unitPriceChange,
      unitPriceConfidence: unitEntries.length >= 2 ? unitPriceConfidence : undefined,
      history: entries.map((e) => ({
        date: e.date,
        price: e.price,
        fromBaseline: e.fromBaseline,
        store: e.store,
        canonicalUnitPrice: e.canonicalUnitPrice,
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

    // Project the price increase to a 30-day window.
    // Math.max(1, daysBetween) prevents divide-by-zero and Infinity when
    // the user scans two receipts on the same day.
    const rawDaysBetween =
      (new Date(latest.date).getTime() - new Date(penultimate.date).getTime()) /
      (1000 * 60 * 60 * 24);
    const daysBetween = Math.max(1, rawDaysBetween);
    const effectiveDays = Math.max(daysBetween, avgDaysBetween);

    const tax30 = delta * (30 / effectiveDays);
    return { ...s, cumulativeOverspend: Math.round(tax30 * 100) / 100 };
  });
}

/**
 * Best available price-change percentage for a stat: unit-price when known,
 * falling back to raw-price change. Unit-price is the truth — raw price
 * misleads when package sizes vary (e.g. 6ct vs 12ct eggs).
 */
export function effectivePriceChange(stat: ItemStat): number {
  if (stat.unitPriceChange != null && Number.isFinite(stat.unitPriceChange)) {
    return stat.unitPriceChange;
  }
  return stat.pctChange;
}

/**
 * Spend-weighted personal inflation rate.
 * Each item's impact on the total is proportional to its share of the user's
 * total real spend — steak at $50/mo matters 10x more than apples at $5/mo.
 * Uses unit-price change when available, falling back to raw-price change.
 * Falls back to appearance-weighted when there is no real spend data.
 */
export function inflationScore(stats: ItemStat[]): number {
  if (!stats.length) return 0;
  const totalSpend = stats.reduce((acc, s) => acc + s.totalSpend, 0);
  if (totalSpend > 0) {
    const weighted = stats.reduce((acc, s) => acc + effectivePriceChange(s) * s.totalSpend, 0);
    return weighted / totalSpend;
  }
  // Fallback: appearance-weighted for baseline-only items
  const weighted = stats.reduce((acc, s) => acc + effectivePriceChange(s) * Math.max(1, s.appearances), 0);
  const weight = stats.reduce((acc, s) => acc + Math.max(1, s.appearances), 0);
  return weight ? weighted / weight : 0;
}

export function painIndex(stats: ItemStat[], totalSpendDelta: number): number {
  if (!stats.length) return 0;
  // Normalize as percentage of baseline spend rather than raw dollars —
  // $40 of inflation on a $400 basket is 10%, not 80/100 severe pain.
  const baselineTotal = stats.reduce((acc, s) => acc + s.firstPrice, 0);
  const spendInc = baselineTotal > 0
    ? Math.min(100, Math.max(0, (totalSpendDelta / baselineTotal) * 100))
    : 0;
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
  if (real >= 8 && tracked >= 30) return { level: "high", label: "VERIFIED DATA" };
  if (real >= 3 && tracked >= 10)
    return { level: "medium", label: "BUILDING INSIGHTS" };
  return { level: "low", label: "GATHERING INTELLIGENCE" };
}

export function itemConfidence(stat: ItemStat): Confidence {
  if (stat.realAppearances >= 4) return { level: "high", label: "VERIFIED DATA" };
  if (stat.realAppearances >= 2) return { level: "medium", label: "BUILDING INSIGHTS" };
  return { level: "low", label: "GATHERING INTELLIGENCE" };
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

/** Weekly burn rate: total 30-day tax projection scaled to 7 days. */
export function weeklyBurnRate(stats: ItemStat[]): number {
  const total30 = stats.reduce((acc, s) => acc + s.cumulativeOverspend, 0);
  return total30 * (7 / 30);
}

/** Weekly savings if every Hall-of-Shame item were bought at its cheapest store. */
export function savingsFound(stats: ItemStat[], frequency: string | null): number {
  return stats
    .filter((s) => s.pctChange > 0 && s.cheapestPrice != null && s.cheapestPrice < s.currentPrice)
    .reduce((acc, s) => {
      const perItem = s.currentPrice - s.cheapestPrice!;
      const yearlyFreq = freqPurchasesPerYear(frequency);
      return acc + (perItem * yearlyFreq) / 52;
    }, 0);
}

/**
 * Next Trip Strategy: top 3 items with the highest frequency×volatility score.
 * Items with rising prices are flagged as "buy_at" (if a cheaper store exists) or
 * "wait" (if no cheaper alternative). Dropping items get "stock_up".
 */
export function nextTripStrategyItems(stats: ItemStat[]): TripStrategyItem[] {
  if (!stats.length) return [];

  return stats
    .filter((s) => s.appearances >= 2)
    .sort((a, b) => {
      const scoreA = a.appearances * Math.abs(effectivePriceChange(a));
      const scoreB = b.appearances * Math.abs(effectivePriceChange(b));
      return scoreB - scoreA;
    })
    .slice(0, 3)
    .map((s): TripStrategyItem => {
      const change = effectivePriceChange(s);
      let action: TripStrategyItem["action"] = "as_planned";
      let store = "";

      if (change > 20) {
        // Extreme spike — suggest switching to an alternative product
        action = "substitution_suggested";
      } else if (change > 5) {
        if (s.cheapestStore && s.cheapestPrice != null && s.cheapestPrice < s.currentPrice) {
          action = "buy_at";
          store = s.cheapestStore;
        } else {
          action = "wait";
        }
      } else if (change < -5) {
        action = "stock_up";
        store = s.history[s.history.length - 1]?.store ?? "";
      }

      return { key: s.key, name: s.name, pctChange: change, action, store, volatility: s.volatility };
    });
}

/**
 * Detect shrinkflation: the raw price stayed flat (within 2%) while the
 * unit price rose more than 5%. This means you're paying the same for less.
 */
export function detectShrinkflation(stat: ItemStat): boolean {
  const unitEntries = stat.history.filter((h) => h.canonicalUnitPrice != null);
  if (unitEntries.length < 2) return false;
  // Anchor to the first REAL unit entry so a synthetic baseline estimate
  // (with its 90-day-old user-entered price) doesn't produce a false
  // positive when compared against a real scan.
  const firstRealUnit = unitEntries.find((e) => !e.fromBaseline);
  if (!firstRealUnit) return false;
  const firstUnit = firstRealUnit;
  const last = unitEntries[unitEntries.length - 1];
  if (firstUnit.price <= 0 || firstUnit.canonicalUnitPrice! <= 0) return false;
  const rawChange = (last.price - firstUnit.price) / firstUnit.price;
  const unitChange = (last.canonicalUnitPrice! - firstUnit.canonicalUnitPrice!) / firstUnit.canonicalUnitPrice!;
  return Math.abs(rawChange) < 0.02 && unitChange > 0.05;
}

/** Check whether an item had a price spike >10% within the last 14 days. */
export function hasRecentSpike(stat: ItemStat): boolean {
  const now = Date.now();
  const fourteenDaysAgo = now - 14 * 24 * 60 * 60 * 1000;

  for (let i = 1; i < stat.history.length; i++) {
    // Skip transitions that start from a baseline estimate — the gap
    // between a 90-day-old national-average guess and a real store price
    // is not a real spike and misleads the Price Alert card.
    if (stat.history[i - 1].fromBaseline) continue;
    const entryMs = new Date(stat.history[i].date).getTime();
    if (entryMs >= fourteenDaysAgo) {
      const prev = stat.history[i - 1].price;
      const cur = stat.history[i].price;
      if (prev > 0 && ((cur - prev) / prev) * 100 > 10) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Top N items by unit-price spike magnitude for the Inflation Alert ticker.
 * Returns items with known unit-price trends, sorted by highest unit-price increase.
 */
export function topSpikingItems(stats: ItemStat[], limit: number = 3): ItemStat[] {
  return stats
    .filter((s) => s.unitPriceChange != null && s.unitPriceChange > 0)
    .sort((a, b) => (b.unitPriceChange ?? 0) - (a.unitPriceChange ?? 0))
    .slice(0, limit);
}
