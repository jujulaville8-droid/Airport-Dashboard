import {
  ensureDepartureDataFresh,
  ensureDeparturePlanningHorizonFresh,
} from '@/lib/flight-sync';
import { NextRequest } from 'next/server';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isIsoDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function todayInAntigua(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Antigua',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const mode = body.mode;
    const startDate = body.startDate;
    const days = body.days;

    if (
      (mode !== 'live' && mode !== 'planning') ||
      typeof startDate !== 'string' ||
      !isIsoDate(startDate) ||
      (days !== undefined &&
        (!Number.isInteger(days) || Number(days) < 1 || Number(days) > 14))
    ) {
      return Response.json({ error: 'Invalid departure sync request' }, { status: 400 });
    }

    const today = todayInAntigua();
    if (
      startDate !== today ||
      (mode === 'live' && days !== undefined && days !== 1) ||
      (mode === 'planning' && days !== 14)
    ) {
      return Response.json(
        { error: 'Sync supports today live or the canonical 14-day planning window' },
        { status: 400 },
      );
    }

    const result = mode === 'planning'
      ? await ensureDeparturePlanningHorizonFresh(startDate)
      : await ensureDepartureDataFresh({ mode, startDate });
    return Response.json(result);
  } catch {
    return Response.json({ error: 'Departure sync failed' }, { status: 500 });
  }
}
