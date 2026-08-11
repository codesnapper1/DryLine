import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, XAxis, YAxis, Tooltip } from "recharts";
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
    <div className="flex h-full flex-col gap-1">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-400">Wetness Trend</h2>
        <div className="flex gap-4 text-xs">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: COLOR_LINE }} />
            on-line
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-3 border-t-2 border-dashed" style={{ borderColor: COLOR_OFF_LINE }} />
            off-line
          </span>
          {!naiveMode && (
            <span className="flex items-center gap-1.5 text-neutral-500">
              <span className="inline-block h-2 w-3 rounded bg-neutral-600/50" />
              confidence band
            </span>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 rounded-lg border border-neutral-800 bg-neutral-950/40 p-2">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 18, right: 16, bottom: 4, left: -12 }}>
            <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />

            <XAxis
              xAxisId="minutes"
              dataKey="minutes"
              type="number"
              domain={["dataMin", "dataMax"]}
              orientation="bottom"
              stroke="#71717a"
              tick={{ fontSize: 11, fill: "#a1a1aa" }}
              label={{ value: "minutes", position: "insideBottom", offset: -2, fill: "#71717a", fontSize: 10 }}
            />
            <XAxis
              xAxisId="laps"
              dataKey="laps"
              type="number"
              domain={["dataMin", "dataMax"]}
              orientation="top"
              stroke="#52525b"
              tick={{ fontSize: 11, fill: "#71717a" }}
              label={{ value: "laps", position: "insideTop", offset: -6, fill: "#52525b", fontSize: 10 }}
            />
            <YAxis
              domain={[0, 1]}
              stroke="#71717a"
              tick={{ fontSize: 11, fill: "#a1a1aa" }}
              width={36}
              label={{ value: "Ŵ", angle: -90, position: "insideLeft", fill: "#71717a", fontSize: 11 }}
            />

            {LEVEL_LINES.map(([y, label]) => (
              <ReferenceLine
                key={y}
                xAxisId="minutes"
                y={y}
                stroke="#3f3f46"
                strokeDasharray="2 4"
                label={{ value: label, position: "right", fill: "#52525b", fontSize: 9 }}
              />
            ))}

            {!naiveMode && (
              <Area
                xAxisId="minutes"
                dataKey="band"
                stroke="none"
                fill="#71717a"
                fillOpacity={0.18}
                isAnimationActive={false}
              />
            )}

            <Line
              xAxisId="minutes"
              type="monotone"
              dataKey="offLine"
              stroke={COLOR_OFF_LINE}
              strokeWidth={2}
              strokeDasharray="5 4"
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
            />

            <Tooltip
              contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", fontSize: 12 }}
              labelFormatter={(v) => `t=${v}min`}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
