// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const from = vi.hoisted(() => vi.fn(() => {
  throw new Error('database should not be accessed');
}));

vi.mock('@/lib/db', () => ({
  supabase: { from },
}));

import { POST, PUT } from './route';

function jsonRequest(method: 'POST' | 'PUT', body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/staff', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('staff route validation', () => {
  beforeEach(() => {
    from.mockClear();
  });

  it('rejects incompatible create fields before database access', async () => {
    const response = await POST(jsonRequest('POST', {
      name: 'alex',
      full_name: 'Alex Example',
      role: 'full-time',
      max_hours_per_day: { hours: 8 },
    }));

    expect(response.status).toBe(400);
    expect(from).not.toHaveBeenCalled();
  });

  it('rejects incompatible update fields before database access', async () => {
    const response = await PUT(jsonRequest('PUT', {
      id: '66c4bcf8-d9bb-4127-bb91-8df3993d6804',
      is_active: 'yes',
    }));

    expect(response.status).toBe(400);
    expect(from).not.toHaveBeenCalled();
  });
});
