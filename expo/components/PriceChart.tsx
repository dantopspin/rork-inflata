import { memo } from "react";
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  Path,
  Polyline,
  Rect,
  Stop,
  Text as SvgText,
} from "react-native-svg";
import { Colors, Fonts } from "@/constants/theme";
import { fmtUSD } from "@/lib/format";

type ChartPoint = {
  date: string;
  price: number;
  fromBaseline: boolean;
};

/**
 * Full-featured line chart that plots price history data points over time.
 * Renders an area-fill gradient under the line, individual data-point dots
 * (baseline estimates dimmed), min/max axis labels, and abbreviated date
 * labels along the X axis. Falls back to a flat dash for single-point data.
 */
export const PriceChart = memo(function PriceChart({
  data,
  height = 160,
  stroke = Colors.accent,
}: {
  data: ChartPoint[];
  height?: number;
  stroke?: string;
}) {
  // Layout constants
  const W = 320;
  const H = 80;
  const padLeft = 6;
  const padRight = 6;
  const padTop = 8;
  const padBottom = 14;
  const plotW = W - padLeft - padRight;
  const plotH = H - padTop - padBottom;

  if (data.length < 2) {
    return (
      <Svg width="100%" height={height} viewBox="0 0 100 40">
        <Polyline
          points="35,20 65,20"
          fill="none"
          stroke={stroke}
          strokeWidth={2}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          opacity={0.25}
        />
      </Svg>
    );
  }

  const prices = data.map((d) => d.price);
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const range = Math.max(0.0001, maxP - minP);

  const points = data.map((d, i) => {
    const x = padLeft + (i / (data.length - 1)) * plotW;
    const y = padTop + (1 - (d.price - minP) / range) * plotH;
    return { x, y, ...d };
  });

  const linePoints = points.map((p) => `${p.x},${p.y}`).join(" ");

  // Area fill path (line + close to bottom)
  const areaPath =
    `M ${points[0].x},${padTop + plotH} ` +
    points.map((p) => `L ${p.x},${p.y}`).join(" ") +
    ` L ${points[points.length - 1].x},${padTop + plotH} Z`;

  // Find min and max point indices for axis labels
  const minIdx = prices.indexOf(minP);
  const maxIdx = prices.indexOf(maxP);

  // Pick date labels — show first, last, and 1-2 middle points depending on count
  const labelIndices: number[] = [];
  if (data.length <= 4) {
    labelIndices.push(...data.map((_, i) => i));
  } else {
    labelIndices.push(0, Math.floor(data.length / 2), data.length - 1);
  }

  const fmtShortDate = (iso: string): string => {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  const gradId = `priceChartGrad_${stroke.replace("#", "")}`;

  return (
    <Svg width="100%" height={height} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <Defs>
        <LinearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor={stroke} stopOpacity="0.18" />
          <Stop offset="100%" stopColor={stroke} stopOpacity="0.01" />
        </LinearGradient>
      </Defs>

      {/* Area fill under the line */}
      <Path d={areaPath} fill={`url(#${gradId})`} />

      {/* Horizontal grid lines (subtle) */}
      {[0.25, 0.5, 0.75].map((f) => {
        const y = padTop + f * plotH;
        return (
          <Rect
            key={f}
            x={padLeft}
            y={y - 0.25}
            width={plotW}
            height={0.5}
            fill={Colors.border}
            opacity={0.4}
          />
        );
      })}

      {/* The line itself */}
      <Polyline
        points={linePoints}
        fill="none"
        stroke={stroke}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />

      {/* Data point dots — baseline entries dimmed */}
      {points.map((p, i) => (
        <Circle
          key={i}
          cx={p.x}
          cy={p.y}
          r={p.fromBaseline ? 1.8 : 2.5}
          fill={p.fromBaseline ? Colors.mutedForeground : stroke}
          opacity={p.fromBaseline ? 0.4 : 1}
          stroke={Colors.surface}
          strokeWidth={0.8}
          vectorEffect="non-scaling-stroke"
        />
      ))}

      {/* Min label (left-aligned to its dot) */}
      <SvgText
        x={points[minIdx].x}
        y={points[minIdx].y - 4}
        fontSize="6.5"
        fontFamily={Fonts.bold}
        fill={Colors.success}
        textAnchor="middle"
      >
        {fmtUSD(minP)}
      </SvgText>

      {/* Max label (above its dot) */}
      {maxIdx !== minIdx && (
        <SvgText
          x={points[maxIdx].x}
          y={points[maxIdx].y - 4}
          fontSize="6.5"
          fontFamily={Fonts.bold}
          fill={Colors.accent}
          textAnchor="middle"
        >
          {fmtUSD(maxP)}
        </SvgText>
      )}

      {/* Date labels along X axis */}
      {labelIndices.map((idx) => {
        const p = points[idx];
        // Clamp label x so it doesn't overflow edges
        const labelX = Math.max(10, Math.min(W - 10, p.x));
        return (
          <SvgText
            key={idx}
            x={labelX}
            y={H - 2}
            fontSize="5.5"
            fontFamily={Fonts.mono}
            fill={Colors.mutedForeground}
            textAnchor="middle"
          >
            {fmtShortDate(p.date)}
          </SvgText>
        );
      })}
    </Svg>
  );
});
