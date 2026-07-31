import type { NextRequest } from 'next/server';
import { ensureDepartureDataFresh } from '@/lib/flight-sync';

function todayInAntigua(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Antigua',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export async function GET(request: NextRequest) {
  const secret = process.env.FLIGHT_CRON_SECRET;
  if (!secret) {
    console.error('[api/cron/flights] FLIGHT_CRON_SECRET not set');
    return Response.json({ error: 'Server not configured' }, { status: 500 });
  }

  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const now = new Date();
    const result = await ensureDepartureDataFresh({
      mode: 'live',
      startDate: todayInAntigua(now),
      now,
    });
    const unavailable =
      result.status === 'failed' || result.status === 'not-configured';
    return Response.json({
      ok: !unavailable,
      status: result.status,
      records: result.records,
      lastSuccessAt: result.lastSuccessAt,
    }, { status: unavailable ? 503 : 200 });
  } catch {
    console.error('[api/cron/flights] refresh failed');
    return Response.json(
      { ok: false, error: 'Flight refresh failed' },
      { status: 500 },
    );
  }
}
