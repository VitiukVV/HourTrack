import { useTranslation } from 'react-i18next';
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

import type { ReportByCard } from './computeReport';

/**
 * Earnings-by-card pie chart. Slices are colored by `card.color`. Labels show
 * the card name + the slice's EUR amount (NOT percentage, because the user is
 * already looking at the table that breaks down rates — knowing exact EUR per
 * card next to the slice is more useful).
 */

interface ReportsPieChartProps {
  byCard: ReportByCard[];
}

export function ReportsPieChart({ byCard }: ReportsPieChartProps) {
  const { t } = useTranslation();
  // Filter cards with non-trivial earnings — zero-slice cards would draw an
  // invisible 0% wedge and bloat the legend.
  const data = byCard.filter((row) => row.earnings > 0);

  if (data.length === 0) {
    return (
      <div
        data-testid="pie-chart-empty"
        className="border-border bg-card text-muted-foreground rounded-md border p-6 text-center text-sm"
      >
        {t('reports.empty.title')}
      </div>
    );
  }

  interface TooltipPayload {
    name: string;
    value: number;
    payload?: { color?: string };
  }
  function CustomTooltip(props: { active?: boolean; payload?: TooltipPayload[] }) {
    if (!props.active || !props.payload || props.payload.length === 0) return null;
    const first = props.payload[0]!;
    return (
      <div className="border-border bg-popover text-popover-foreground rounded-md border px-3 py-2 text-xs shadow-md">
        <p className="font-medium">{first.name}</p>
        <p className="text-muted-foreground">{first.value.toFixed(2)} EUR</p>
      </div>
    );
  }

  return (
    <div className="border-border bg-card rounded-md border p-3" data-testid="reports-pie-chart">
      <h3 className="text-sm font-medium">{t('reports.charts.earningsByCard')}</h3>
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data.map((row) => ({
                name: row.card.name,
                value: row.earnings,
                color: row.card.color,
              }))}
              dataKey="value"
              nameKey="name"
              innerRadius={50}
              outerRadius={100}
              label={({ name, value }: { name?: string; value?: number }) =>
                `${name ?? ''} • ${(value ?? 0).toFixed(0)} EUR`
              }
            >
              {data.map((row) => (
                <Cell key={row.card.id} fill={row.card.color} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
