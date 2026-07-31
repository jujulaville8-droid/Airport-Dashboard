import type { HTMLAttributes, ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'positive' | 'warning' | 'danger' | 'nav';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode;
  tone?: BadgeTone;
  showDot?: boolean;
}

const toneClasses: Record<BadgeTone, string> = {
  neutral: 'border-line bg-app-bg text-ink',
  positive: 'border-positive/30 bg-positive/10 text-ink',
  warning: 'border-accent/50 bg-accent/15 text-ink',
  danger: 'border-danger/30 bg-danger/10 text-ink',
  nav: 'border-nav bg-nav text-surface',
};

const dotClasses: Record<BadgeTone, string> = {
  neutral: 'bg-muted',
  positive: 'bg-positive',
  warning: 'bg-accent',
  danger: 'bg-danger',
  nav: 'bg-accent',
};

export function Badge({
  children,
  className = '',
  tone = 'neutral',
  showDot = true,
  ...props
}: BadgeProps) {
  return (
    <span
      className={[
        'inline-flex min-h-6 items-center gap-1.5 rounded-full border px-2 py-0.5',
        'font-mono text-[0.6875rem] font-semibold leading-4 tracking-[0.04em] uppercase',
        toneClasses[tone],
        className,
      ].join(' ')}
      {...props}
    >
      {showDot ? (
        <span
          aria-hidden="true"
          className={`size-1.5 shrink-0 rounded-full ${dotClasses[tone]}`}
        />
      ) : null}
      {children}
    </span>
  );
}
