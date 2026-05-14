import { format, parseISO } from 'date-fns';
import { useTranslation } from 'react-i18next';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { Card } from '@hourtrack/shared-types';

import type { ReportByDay } from './computeReport';

/**
 * Stacked bar chart: x = days that have at least one entry (req #12), y =
 * hours. Each card contributes a colored segment using `card.color`. Days
 * without activity are NOT plotted — that contract is honored by upstream
 * `computeReport` which only emits byDay rows for active days.
 *
 * `data` is reshaped so Recharts can consume it: each row becomes
 *   `{ date: "DD.MM", <cardId>: hours, ... }`
 * with one numeric series per card. Tooltip then maps cardId back to card name
 * for display.
 */

interface ReportsBarChartProps {
  byDay: ReportByDay[];
  cards: Card[];
}

interface ChartRow {
  date: string;
  // Cards' hours keyed by cardId.
  [cardId: string]: number | string;
}

export function ReportsBarChart({ byDay, cards }: ReportsBarChartProps) {
  const { t } = useTranslation();
  const cardsById = new Map(cards.map((c) => [c.id, c] as const));

  if (byDay.length === 0) {
    return (
      <div
        data-testid="bar-chart-empty"
        className="border-border bg-card text-muted-foreground rounded-md border p-6 text-center text-sm"
      >
        {t('reports.empty.title')}
      </div>
    );
  }

  // Determine which cards actually have data in this period — limits the
  // number of stacked series to what's meaningful and stops Recharts from
  // rendering empty legend entries.
  const presentCardIds = new Set<string>();
  for (const day of byDay) {
    for (const id of Object.keys(day.perCardDurationMin)) presentCardIds.add(id);
  }
  const presentCards = cards.filter((c) => presentCardIds.has(c.id));

  const data: ChartRow[] = byDay.map((day) => {
    const row: ChartRow = { date: format(parseISO(day.date), 'dd.MM') };
    for (const card of presentCards) {
      row[card.id] = (day.perCardDurationMin[card.id] ?? 0) / 60;
    }
    return row;
  });

  // CustomTooltip — looks up card name from id, formats hours to 2 decimals.
  interface TooltipPayload {
    dataKey: string;
    value: number;
    color: string;
  }
  function CustomTooltip(props: { active?: boolean; label?: string; payload?: TooltipPayload[] }) {
    if (!props.active || !props.payload || props.payload.length === 0) return null;
    return (
      <div className="border-border bg-popover text-popover-foreground rounded-md border px-3 py-2 text-xs shadow-md">
        <p className="font-medium">{props.label}</p>
        <ul className="mt-1 space-y-0.5">
          {props.payload.map((p) => {
            const card = cardsById.get(p.dataKey);
            return (
              <li key={p.dataKey} className="flex items-center gap-2">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: p.color }}
                />
                <span>{card?.name ?? p.dataKey}</span>
                <span className="text-muted-foreground ml-auto">{p.value.toFixed(2)}h</span>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  return (
    <div className="border-border bg-card rounded-md border p-3" data-testid="reports-bar-chart">
      <h3 className="text-sm font-medium">{t('reports.charts.hoursByDay')}</h3>
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 16, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="date" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              formatter={(value: string) => cardsById.get(value)?.name ?? value}
              wrapperStyle={{ fontSize: 12 }}
            />
            {presentCards.map((card) => (
              <Bar key={card.id} dataKey={card.id} stackId="a" fill={card.color} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
