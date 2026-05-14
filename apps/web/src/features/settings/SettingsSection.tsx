import type { ReactNode } from 'react';

/**
 * Shared section wrapper for the Settings page. Renders a card-styled
 * container with a heading and optional subtitle so each section
 * (Profile, Interface, Data, Archive, Calendar, About) shares the same
 * vertical rhythm without each component re-implementing the layout.
 */
export interface SettingsSectionProps {
  title: string;
  subtitle?: string;
  /** Optional `data-testid` plumbed through for component tests. */
  testId?: string;
  /** Optional right-aligned slot rendered next to the heading (e.g. status). */
  trailing?: ReactNode;
  children: ReactNode;
}

export function SettingsSection({
  title,
  subtitle,
  testId,
  trailing,
  children,
}: SettingsSectionProps) {
  return (
    <section
      data-testid={testId}
      className="border-border bg-card text-card-foreground rounded-lg border p-4 shadow-sm"
    >
      <header className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          {subtitle && <p className="text-muted-foreground mt-1 text-sm">{subtitle}</p>}
        </div>
        {trailing}
      </header>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}
