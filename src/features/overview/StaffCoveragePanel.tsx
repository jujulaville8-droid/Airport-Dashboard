import { Metric } from '@/components/ui/Metric';
import { Panel } from '@/components/ui/Panel';
import { DomainStatus, ErrorData, PanelLink } from './panel-shared';
import type { DomainResult, ScheduleOverview } from './types';

export function StaffCoveragePanel({ date, result }: { date: string; result: DomainResult<ScheduleOverview> }) {
  const gaps = result.data?.gaps ?? null;
  return (
    <Panel actions={<PanelLink href={`/dashboard/schedules?date=${date}`}>Open schedule</PanelLink>} description="People scheduled against high-value departures." title="Staff coverage">
      <DomainStatus label="Staff coverage" result={result} />
      {result.data?.hasData ? (
        <div className="grid gap-5 sm:grid-cols-3">
          <Metric detail="High-value departures" label="Coverage" tone={(result.data.coverageScore ?? 0) < 75 ? 'danger' : (result.data.coverageScore ?? 0) < 90 ? 'warning' : 'positive'} value={result.data.coverageScore === null ? '—' : `${result.data.coverageScore}%`} />
          <Metric detail="Scheduled today" label="Staff" value={result.data.staffOnDuty ?? '—'} />
          <Metric detail={gaps === null ? 'Coverage gaps unknown' : 'High-value windows'} label="Gaps" tone={gaps === null ? 'default' : gaps.length ? 'danger' : 'positive'} value={gaps === null ? '—' : gaps.length} />
        </div>
      ) : result.status === 'error' ? (
        <ErrorData result={result} />
      ) : (
        <p className="text-sm leading-6 text-muted">No current staff schedule is available. Review the scheduling workspace before the next passenger peak.</p>
      )}
    </Panel>
  );
}
