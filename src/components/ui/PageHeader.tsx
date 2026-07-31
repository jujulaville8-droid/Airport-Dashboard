import type { ReactNode } from 'react';

export interface PageHeaderProps {
  title: string;
  eyebrow?: string;
  description?: string;
  metadata?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  eyebrow,
  description,
  metadata,
  actions,
  className = '',
}: PageHeaderProps) {
  return (
    <header
      className={[
        'flex flex-col gap-5 border-b border-line pb-5 sm:gap-6 sm:pb-6',
        'lg:flex-row lg:items-end lg:justify-between',
        className,
      ].join(' ')}
    >
      <div className="min-w-0 max-w-3xl">
        {eyebrow ? (
          <p className="mb-2 flex items-center gap-2 font-mono text-[0.6875rem] font-semibold tracking-[0.08em] text-muted uppercase">
            <span aria-hidden="true" className="h-px w-5 bg-accent" />
            {eyebrow}
          </p>
        ) : null}
        <h1 className="font-display text-4xl font-semibold leading-[0.95] tracking-[-0.02em] text-ink sm:text-5xl">
          {title}
        </h1>
        {description ? (
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted sm:text-base">
            {description}
          </p>
        ) : null}
        {metadata ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted">
            {metadata}
          </div>
        ) : null}
      </div>
      {actions ? (
        <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto lg:justify-end">
          {actions}
        </div>
      ) : null}
    </header>
  );
}
