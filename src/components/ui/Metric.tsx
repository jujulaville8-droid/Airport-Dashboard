import type { ReactNode } from 'react';

export type MetricTone = 'default' | 'positive' | 'warning' | 'danger';

export interface MetricProps {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  tone?: MetricTone;
  className?: string;
}

const toneClasses: Record<MetricTone, string> = {
  default: 'border-line',
  positive: 'border-positive',
  warning: 'border-accent',
  danger: 'border-danger',
};

export function Metric({
  label,
  value,
  detail,
  tone = 'default',
  className = '',
}: MetricProps) {
  return (
    <dl
      className={[
        'min-w-0 border-l-2 pl-4',
        toneClasses[tone],
        className,
      ].join(' ')}
    >
      <dt className="text-xs font-semibold tracking-[0.04em] text-muted uppercase">
        {label}
      </dt>
      <dd className="mt-2 font-mono text-2xl font-semibold leading-none tracking-[-0.035em] text-ink tabular-nums sm:text-3xl">
        {value}
      </dd>
      {detail ? (
        <dd className="mt-2 text-xs leading-5 text-muted">{detail}</dd>
      ) : null}
    </dl>
  );
}
