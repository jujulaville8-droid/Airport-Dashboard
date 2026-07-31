import type React from 'react';
import type { DataStatus, Freshness } from '@/lib/ui/data-state';
import { Badge, type BadgeTone } from './Badge';
import { Button } from './Button';

type StateKind = Extract<
  DataStatus['kind'],
  'loading' | 'empty' | 'error'
>;

interface StateShellProps {
  kind: StateKind;
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

const stateClasses: Record<StateKind, string> = {
  loading: 'border-line bg-surface',
  empty: 'border-line bg-surface',
  error: 'border-danger bg-surface',
};

function StateShell({
  kind,
  title,
  message,
  actionLabel,
  onAction,
}: StateShellProps): React.ReactNode {
  const isError = kind === 'error';

  return (
    <section
      aria-live={isError ? 'assertive' : 'polite'}
      className={`rounded-lg border-l-4 p-5 sm:p-6 ${stateClasses[kind]}`}
      role={isError ? 'alert' : 'status'}
    >
      <div className="max-w-2xl">
        <p className="font-display text-xl font-semibold leading-tight text-ink">
          {title}
        </p>
        <p className="mt-1.5 text-sm leading-6 text-muted">{message}</p>
        {actionLabel && onAction ? (
          <Button
            className="mt-4"
            onClick={onAction}
            variant={isError ? 'danger' : 'secondary'}
          >
            {actionLabel}
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function formatAge(minutesOld: number): string {
  if (minutesOld < 1) return 'just now';
  if (minutesOld < 60) {
    return `${minutesOld} min ago`;
  }

  const hours = Math.floor(minutesOld / 60);
  const remainingMinutes = minutesOld % 60;
  if (remainingMinutes === 0) {
    return `${hours} hr ago`;
  }

  return `${hours} hr ${remainingMinutes} min ago`;
}

export function LoadingState(props: { label: string }): React.ReactNode {
  return (
    <section
      aria-live="polite"
      className="rounded-lg border border-line bg-surface p-5 sm:p-6"
      role="status"
    >
      <span className="sr-only">{props.label}</span>
      <div aria-hidden="true" className="space-y-3">
        <div className="h-3 w-28 animate-pulse rounded-sm bg-line" />
        <div className="h-7 w-3/4 animate-pulse rounded-sm bg-line" />
        <div className="h-3 w-1/2 animate-pulse rounded-sm bg-line" />
      </div>
    </section>
  );
}

export function EmptyState(props: {
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}): React.ReactNode {
  return <StateShell kind="empty" {...props} />;
}

export function ErrorState(props: {
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}): React.ReactNode {
  return <StateShell kind="error" {...props} />;
}

export function FreshnessIndicator(props: {
  freshness: Freshness;
}): React.ReactNode {
  const { freshness } = props;
  let label: string;
  let tone: BadgeTone;

  if (freshness.kind === 'missing') {
    label = 'Not received';
    tone = 'danger';
  } else if (freshness.kind === 'stale') {
    label = `Stale · ${formatAge(freshness.minutesOld)}`;
    tone = 'warning';
  } else {
    label = `Current · ${formatAge(freshness.minutesOld)}`;
    tone = 'positive';
  }

  return (
    <Badge
      aria-label={label}
      role="status"
      title={
        freshness.kind === 'missing'
          ? 'No successful update is available'
          : `Last updated ${freshness.updatedAt}`
      }
      tone={tone}
    >
      {freshness.kind === 'missing' ? (
        label
      ) : (
        <>
          {label.split(' · ')[0]} ·{' '}
          <time dateTime={freshness.updatedAt}>
            {formatAge(freshness.minutesOld)}
          </time>
        </>
      )}
    </Badge>
  );
}
