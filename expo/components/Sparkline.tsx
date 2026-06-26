import Svg, { Polyline } from "react-native-svg";

import { Colors } from "@/constants/theme";

export function Sparkline({
  prices,
  height = 64,
  stroke = Colors.accent,
  strokeWidth = 2,
}: {
  prices: number[];
  height?: number;
  stroke?: string;
  strokeWidth?: number;
}) {
  if (prices.length < 2) {
    // Single data point — draw a faint flat dash so the card area isn't empty.
    return (
      <Svg width="100%" height={height} viewBox="0 0 100 40">
        <Polyline
          points="35,20 65,20"
          fill="none"
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          opacity={0.25}
        />
      </Svg>
    );
  }
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const range = Math.max(0.0001, maxP - minP);
  const points = prices
    .map((p, i) => {
      const x = (i / (prices.length - 1)) * 100;
      const y = 40 - ((p - minP) / range) * 40;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <Svg width="100%" height={height} viewBox="0 0 100 40" preserveAspectRatio="none">
      <Polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </Svg>
  );
}
