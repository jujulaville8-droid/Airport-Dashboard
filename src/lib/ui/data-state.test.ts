import { describe, expect, it } from 'vitest';
import { deriveFreshness, getDataStatus } from './data-state';

describe('deriveFreshness', () => {
  const now = new Date('2026-07-30T20:00:00Z');

  it('marks a recent source as current', () => {
    expect(deriveFreshness('2026-07-30T19:52:00Z', now, 60)).toEqual({
      kind: 'current',
      minutesOld: 8,
      updatedAt: '2026-07-30T19:52:00Z',
    });
  });

  it('marks an old source as stale without discarding its timestamp', () => {
    expect(deriveFreshness('2026-07-30T17:00:00Z', now, 60).kind).toBe('stale');
  });

  it('returns missing when no successful timestamp exists', () => {
    expect(deriveFreshness(null, now, 60)).toEqual({ kind: 'missing' });
  });
});

describe('getDataStatus', () => {
  it('keeps stale data visible when refresh fails', () => {
    expect(getDataStatus({ kind: 'stale', minutesOld: 180, updatedAt: 'x' }, 'Sync failed', true))
      .toEqual({ kind: 'error-with-data', message: 'Sync failed' });
  });
});
