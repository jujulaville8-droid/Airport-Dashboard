import { describe, expect, it } from 'vitest';
import { summarizeImportHealth } from './import-health';

describe('summarizeImportHealth', () => {
  it('uses the latest success and latest failure independently', () => {
    const result = summarizeImportHealth([
      { source: 'sales', attemptedAt: '2026-07-30T19:00:00Z', status: 'success', message: null },
      { source: 'sales', attemptedAt: '2026-07-30T19:30:00Z', status: 'failed', message: 'Bad workbook' },
    ], new Date('2026-07-30T20:00:00Z'));

    expect(result.sales.lastSuccessAt).toBe('2026-07-30T19:00:00Z');
    expect(result.sales.lastAttemptAt).toBe('2026-07-30T19:30:00Z');
    expect(result.sales.status).toBe('failed');
    expect(result.sales.message).toBe('Bad workbook');
  });
});
