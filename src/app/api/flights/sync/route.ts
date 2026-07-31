import { ensureDepartureDataFresh } from '@/lib/flight-sync';
import { NextRequest } from 'next/server';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const mode = body.mode;
    const startDate = body.startDate;
    const days = body.days;

    if (
      (mode !== 'live' && mode !== 'planning') ||
      typeof startDate !== 'string' ||
      !DATE_PATTERN.test(startDate) ||
      (days !== undefined &&
        (!Number.isInteger(days) || Number(days) < 1 || Number(days) > 14))
    ) {
      return Response.json({ error: 'Invalid departure sync request' }, { status: 400 });
    }

    const result = await ensureDepartureDataFresh({
      mode,
      startDate,
      ...(days === undefined ? {} : { days: Number(days) }),
    });
    return Response.json(result);
  } catch {
    return Response.json({ error: 'Departure sync failed' }, { status: 500 });
  }
}
