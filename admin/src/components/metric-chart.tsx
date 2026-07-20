'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

// Palette per the dataviz skill's reference instance (references/palette.md): sequential
// blue for a single series, next categorical slot (aqua) when a second series shares the
// axis. One axis always — never a second, differently-scaled y-axis on the same chart.
const SERIES_COLORS = ['#2a78d6', '#1baf7a'];
const GRIDLINE = '#e1e0d9';
const MUTED = '#898781';

type Series = { key: string; label: string };

export function MetricChart({
  type,
  data,
  xKey,
  series,
  height = 220,
}: {
  type: 'line' | 'bar';
  data: Record<string, unknown>[];
  xKey: string;
  series: Series[];
  height?: number;
}) {
  const Chart = type === 'line' ? LineChart : BarChart;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <Chart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={GRIDLINE} vertical={false} />
        <XAxis
          dataKey={xKey}
          tick={{ fill: MUTED, fontSize: 11 }}
          axisLine={{ stroke: GRIDLINE }}
          tickLine={false}
        />
        <YAxis tick={{ fill: MUTED, fontSize: 11 }} axisLine={false} tickLine={false} width={36} />
        <Tooltip
          contentStyle={{ borderRadius: 8, borderColor: GRIDLINE, fontSize: 12 }}
          labelStyle={{ color: '#0b0b0b', fontWeight: 600 }}
        />
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
        {series.map((s, i) =>
          type === 'line' ? (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
              strokeWidth={2}
              dot={false}
            />
          ) : (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.label}
              fill={SERIES_COLORS[i % SERIES_COLORS.length]}
              radius={[4, 4, 0, 0]}
            />
          )
        )}
      </Chart>
    </ResponsiveContainer>
  );
}
