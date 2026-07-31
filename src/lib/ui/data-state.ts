export type Freshness =
  | { kind: 'current'; updatedAt: string; minutesOld: number }
  | { kind: 'stale'; updatedAt: string; minutesOld: number }
  | { kind: 'missing' };

export type DataStatus =
  | { kind: 'loading' }
  | { kind: 'empty' }
  | { kind: 'ready' }
  | { kind: 'stale' }
  | { kind: 'error-with-data'; message: string }
  | { kind: 'error'; message: string };

export function deriveFreshness(
  updatedAt: string | null,
  now = new Date(),
  staleAfterMinutes = 60,
): Freshness {
  if (!updatedAt) return { kind: 'missing' };
  const minutesOld = Math.max(0, Math.floor((now.getTime() - new Date(updatedAt).getTime()) / 60_000));
  return {
    kind: minutesOld > staleAfterMinutes ? 'stale' : 'current',
    updatedAt,
    minutesOld,
  };
}

export function getDataStatus(
  freshness: Freshness,
  error: string | null,
  hasData: boolean,
): DataStatus {
  if (error && hasData) return { kind: 'error-with-data', message: error };
  if (error) return { kind: 'error', message: error };
  if (!hasData) return { kind: 'empty' };
  if (freshness.kind === 'stale') return { kind: 'stale' };
  return { kind: 'ready' };
}
