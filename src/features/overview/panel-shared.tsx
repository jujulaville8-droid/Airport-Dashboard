import Link from 'next/link';
import { FreshnessIndicator } from '@/components/ui/DataState';
import { deriveFreshness } from '@/lib/ui/data-state';
import type { DomainResult, ErrorDomainResult } from './types';

const STALE_AFTER_MINUTES = 24 * 60;

export function formatCurrency(
  value: number,
  currency: 'USD' | 'ECD' = 'USD',
) {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatOverviewDate(date: string, includeWeekday = false) {
  const parsed = new Date(`${date}T12:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime())) return 'Date unavailable';
  return new Intl.DateTimeFormat('en-CA', {
    ...(includeWeekday ? { weekday: 'long' as const } : {}),
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(parsed);
}

export function formatTimestamp(value: string) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return 'Time unavailable';
  return new Intl.DateTimeFormat('en-CA', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(parsed);
}

export function DomainStatus<T>({
  label,
  result,
}: {
  label: string;
  result: DomainResult<T>;
}) {
  if (result.status === 'error') {
    if (result.data !== null) {
      return (
        <div
          className="mb-5 rounded-md border-l-4 border-accent bg-app-bg px-4 py-3 text-sm leading-6 text-ink"
          role="alert"
        >
          <p>{result.message}. Showing last valid data.</p>
          {result.updatedAt ? (
            <p className="mt-1 text-xs text-muted">
              Last valid update{' '}
              <time dateTime={result.updatedAt}>
                {formatTimestamp(result.updatedAt)}
              </time>
            </p>
          ) : null}
        </div>
      );
    }
    return (
      <div
        className="mb-5 rounded-md border-l-4 border-danger bg-app-bg px-4 py-3 text-sm leading-6 text-ink"
        role="alert"
      >
        <p className="font-semibold">{result.message}</p>
        <p className="mt-1 text-muted">
          {label} could not be included in this brief. Refresh or open the
          relevant detail page.
        </p>
      </div>
    );
  }

  if (!result.updatedAt) {
    return (
      <p className="mb-5 font-mono text-xs text-muted">
        Update time unavailable
      </p>
    );
  }
  return (
    <div className="mb-5">
      <FreshnessIndicator
        freshness={deriveFreshness(
          result.updatedAt,
          new Date(),
          STALE_AFTER_MINUTES,
        )}
      />
    </div>
  );
}

export function PanelLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      className="terminal-focus inline-flex min-h-11 items-center rounded-md border border-line bg-surface px-3.5 text-xs font-semibold text-ink transition-colors duration-150 hover:border-muted hover:bg-app-bg"
      href={href}
    >
      {children}
    </Link>
  );
}

export function ErrorData({
  result,
}: {
  result: ErrorDomainResult<unknown>;
}) {
  if (result.data !== null) return null;
  return (
    <p className="text-sm leading-6 text-muted">
      No last-valid result is available.
    </p>
  );
}
