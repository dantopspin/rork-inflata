export const fmtUSD = (n: number): string =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

export const fmtPct = (n: number, withSign = true): string => {
  const sign = withSign && n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
};

export const fmtDate = (iso: string): string =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export const fmtDateLong = (iso: string): string =>
  new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
