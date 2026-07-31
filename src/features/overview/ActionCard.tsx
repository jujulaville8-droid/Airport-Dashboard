import Link from 'next/link';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import type { OverviewAction } from './types';

const LEVEL_PRESENTATION: Record<
  OverviewAction['level'],
  { label: string; tone: BadgeTone; border: string }
> = {
  'act-now': {
    label: 'Act now',
    tone: 'danger',
    border: 'border-l-danger',
  },
  watch: {
    label: 'Watch',
    tone: 'warning',
    border: 'border-l-accent',
  },
  'on-track': {
    label: 'On track',
    tone: 'positive',
    border: 'border-l-positive',
  },
};

export function ActionCard({ action }: { action: OverviewAction }) {
  const presentation = LEVEL_PRESENTATION[action.level];
  return (
    <li className="h-full">
      <Link
        className={[
          'terminal-focus group flex min-h-11 h-full flex-col rounded-lg border border-line border-l-4 bg-surface p-5 shadow-sm',
          'transition-colors duration-150 hover:border-nav hover:bg-app-bg',
          presentation.border,
        ].join(' ')}
        href={action.href}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Badge tone={presentation.tone}>{presentation.label}</Badge>
          <span
            aria-hidden="true"
            className="font-mono text-sm font-semibold text-muted transition-colors group-hover:text-ink"
          >
            →
          </span>
        </div>
        <h3 className="mt-4 font-display text-xl font-semibold leading-tight text-ink">
          {action.title}
        </h3>
        <p className="mt-2 text-sm leading-6 text-muted">{action.detail}</p>
      </Link>
    </li>
  );
}
