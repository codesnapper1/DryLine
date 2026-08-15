import {
  Area, CartesianGrid, ComposedChart, Line,
  ReferenceLine, ResponsiveContainer, XAxis, YAxis, Tooltip,
} from "recharts";
import type { DecisionFrame } from "../types";
import { COLOR_LINE, COLOR_OFF_LINE } from "../theme";

const LEVEL_LINES: [number, string][] = [
  [0.15, "dry/damp"],
  [0.4, "damp/wet"],
  [0.7, "wet/standing"],
];

export default function TrendChart({
  frames,
  lapTimeS,
  naiveMode,
}: {
  frames: DecisionFrame[];
  lapTimeS: number;
  naiveMode: boolean;
}) {
  const data = frames.map((f) => {
    const bandWidth = f.confidence_ok ? 0.015 : 0.12;
    return {
      t: f.t,
      minutes: +(f.t / 60).toFixed(2),
      laps: +(f.t / lapTimeS).toFixed(2),
      line: naiveMode ? f.raw_w_line : f.w_line,
      offLine: naiveMode ? f.raw_w_off_line : f.w_off_line,
      band: naiveMode ? undefined : [Math.max(0, f.w_line - bandWidth), Math.min(1, f.w_line + bandWidth)],
    };
  });

  return (
    <div style={{ width: "100%", height: "100%", padding: "8px 4px 4px 0" }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 16, right: 32, bottom: 20, left: 0 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.04)" strokeDasharray="3 3" vertical={false} />

          <XAxis
            xAxisId="minutes"
            dataKey="minutes"
            type="number"
            domain={["dataMin", "dataMax"]}
            orientation="bottom"
            stroke="rgba(255,255,255,0.1)"
            tick={{ fontSize: 9, fill: "rgba(255,255,255,0.25)", fontFamily: "JetBrains Mono, monospace" }}
            tickLine={false}
            axisLine={{ stroke: "rgba(255,255,255,0.06)" }}
            label={{ value: "minutes", position: "insideBottomRight", offset: -4, fill: "rgba(255,255,255,0.15)", fontSize: 8 }}
          />
          <XAxis
            xAxisId="laps"
            dataKey="laps"
            type="number"
            domain={["dataMin", "dataMax"]}
            orientation="top"
            stroke="rgba(255,255,255,0.05)"
            tick={{ fontSize: 9, fill: "rgba(255,255,255,0.2)", fontFamily: "JetBrains Mono, monospace" }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            domain={[0, 1]}
            stroke="rgba(255,255,255,0.05)"
            tick={{ fontSize: 9, fill: "rgba(255,255,255,0.2)", fontFamily: "JetBrains Mono, monospace" }}
            width={28}
            tickLine={false}
            axisLine={false}
          />

          {LEVEL_LINES.map(([y, label]) => (
            <ReferenceLine
              key={y}
              xAxisId="minutes"
              y={y}
              stroke="rgba(255,255,255,0.06)"
              strokeDasharray="2 5"
              label={{ value: label, position: "insideRight", fill: "rgba(255,255,255,0.2)", fontSize: 8 }}
            />
          ))}

          {!naiveMode && (
            <Area
              xAxisId="minutes"
              dataKey="band"
              stroke="none"
              fill="rgba(0,229,255,0.06)"
              fillOpacity={1}
              isAnimationActive={false}
            />
          )}

          <Line
            xAxisId="minutes"
            type="monotone"
            dataKey="offLine"
            stroke={COLOR_OFF_LINE}
            strokeWidth={1.5}
            strokeDasharray="4 3"
            dot={false}
            isAnimationActive={false}
          />
          <Line
            xAxisId="minutes"
            type="monotone"
            dataKey="line"
            stroke={COLOR_LINE}
            strokeWidth={2.5}
            dot={false}
            isAnimationActive={false}
            style={{ filter: `drop-shadow(0 0 4px ${COLOR_LINE}88)` }}
          />

          <Tooltip
            contentStyle={{
              background: "#0f1115",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 4,
              fontSize: 10,
              fontFamily: "JetBrains Mono, monospace",
              color: "rgba(255,255,255,0.7)",
            }}
            labelStyle={{ color: "rgba(255,255,255,0.4)", marginBottom: 4 }}
            labelFormatter={(v) => `t = ${typeof v === "number" ? v.toFixed(2) : v} min`}
            formatter={(v: unknown, name: string) => {
              const num = typeof v === "number" ? v : (Array.isArray(v) ? v[0] : NaN);
              const display = typeof num === "number" && !isNaN(num) ? num.toFixed(3) : "—";
              return [display, name === "line" ? "on-line" : "off-line"];
            }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
