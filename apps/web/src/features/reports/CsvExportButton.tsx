import { Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { Card, Entry } from '@hourtrack/shared-types';

import { Button } from '@/components/ui/button';

import { buildReportCsv, downloadCsv } from './exportCsv';

/**
 * Button that downloads the current report as CSV. Filename includes the
 * date range so multiple exports for different periods don't collide.
 *
 * Disabled when there are no entries to export — the button still exists in
 * the DOM (avoids layout shift) but cannot be activated.
 */

interface CsvExportButtonProps {
  entries: Entry[];
  cards: Card[];
  start: string;
  end: string;
}

export function CsvExportButton({ entries, cards, start, end }: CsvExportButtonProps) {
  const { t } = useTranslation();
  const handleClick = () => {
    const csv = buildReportCsv(entries, cards);
    downloadCsv(`hourtrack-${start}_to_${end}.csv`, csv);
  };

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={handleClick}
      disabled={entries.length === 0}
      data-testid="csv-export-button"
    >
      <Download className="mr-2 h-4 w-4" aria-hidden="true" />
      {t('reports.export.csv')}
    </Button>
  );
}
