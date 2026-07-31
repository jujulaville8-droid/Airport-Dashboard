// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const from = vi.hoisted(() => vi.fn(() => {
  throw new Error('database should not be accessed');
}));

vi.mock('@/lib/db', () => ({
  supabase: { from },
}));

import { PUT } from './route';

function jsonRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/inventory/rules', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('inventory rule route validation', () => {
  beforeEach(() => {
    from.mockClear();
  });

  it('rejects incompatible mutable fields before database access', async () => {
    const response = await PUT(jsonRequest({
      item_no: 'SKU-1',
      notes: { richText: true },
      lead_time_days: true,
    }));

    expect(response.status).toBe(400);
    expect(from).not.toHaveBeenCalled();
  });
});
