import type { HTMLAttributes, ReactNode } from 'react';

export interface PanelProps extends HTMLAttributes<HTMLElement> {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  flush?: boolean;
}

export function Panel({
  title,
  description,
  actions,
  children,
  className = '',
  flush = false,
  ...props
}: PanelProps) {
  return (
    <section
      aria-label={title}
      className={[
        'overflow-hidden rounded-lg border border-line bg-surface shadow-sm',
        className,
      ].join(' ')}
      {...props}
    >
      <header className="flex flex-col gap-3 border-b border-line px-5 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-6">
        <div className="min-w-0">
          <h2 className="font-display text-xl font-semibold leading-tight text-ink">
            {title}
          </h2>
          {description ? (
            <p className="mt-1 text-sm leading-5 text-muted">{description}</p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {actions}
          </div>
        ) : null}
      </header>
      <div className={flush ? '' : 'p-5 sm:p-6'}>{children}</div>
    </section>
  );
}
