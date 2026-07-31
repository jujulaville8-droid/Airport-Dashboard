// @vitest-environment node

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('004_schema_readiness ticket-count backfill', () => {
  it('guards the PostgreSQL integer range before casting numeric customer text', () => {
    const migrationPath = fileURLToPath(
      new URL('../../supabase/migrations/004_schema_readiness.sql', import.meta.url),
    );
    const migration = readFileSync(migrationPath, 'utf8');
    const backfill = migration.match(/SET ticket_count = CASE([\s\S]*?)END/)?.[1] ?? '';

    const rangeGuardIndex = backfill.indexOf('2147483647');
    const integerCastIndex = backfill.indexOf('cust_no::INTEGER');

    expect(rangeGuardIndex).toBeGreaterThanOrEqual(0);
    expect(integerCastIndex).toBeGreaterThan(rangeGuardIndex);
  });
});
