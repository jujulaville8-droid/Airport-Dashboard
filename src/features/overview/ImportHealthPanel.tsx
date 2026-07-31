import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Panel } from '@/components/ui/Panel';
import { DomainStatus, ErrorData, formatTimestamp, PanelLink } from './panel-shared';
import type { ConnectionsOverview, DomainResult } from './types';

function ImportSummary({ data }: { data: ConnectionsOverview }) {
  if (data.overall === 'healthy') {
    return <div className="flex flex-wrap items-center gap-3"><Badge tone="positive">Automatic imports healthy</Badge><p className="text-sm text-muted">All configured sources are current.</p></div>;
  }
  const tone: BadgeTone = data.overall === 'not-configured' ? 'danger' : 'warning';
  return (
    <div>
      <Badge tone={tone}>{data.overall === 'not-configured' ? 'Configuration required' : 'Imports need attention'}</Badge>
      <ul className="mt-4 space-y-3">
        {data.unhealthySources.map((source) => (
          <li className="border-l-2 border-accent pl-3 text-sm leading-6 text-ink" key={source.source}>
            <span className="font-semibold">{source.source.replaceAll('_', ' ')}</span> · {source.status}
            {source.lastSuccessAt ? <> · last valid <time dateTime={source.lastSuccessAt}>{formatTimestamp(source.lastSuccessAt)}</time></> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ImportHealthPanel({ result }: { result: DomainResult<ConnectionsOverview> }) {
  return (
    <Panel actions={<PanelLink href="/dashboard/connections">Open Data Connections</PanelLink>} description="Hourly ingestion remains the default; manual upload is recovery only." title="Automatic import health">
      <DomainStatus label="Automatic imports" result={result} />
      {result.data ? <ImportSummary data={result.data} /> : result.status === 'error' ? <ErrorData result={result} /> : null}
    </Panel>
  );
}
