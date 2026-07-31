import { describe, expect, it } from 'vitest';
import {
  buildDepartureWindows,
  fetchAirportDepartures,
  normalizeDepartures,
} from './aerodatabox';

describe('buildDepartureWindows', () => {
  it('splits fourteen local days into twenty-eight twelve-hour windows', () => {
    const windows = buildDepartureWindows('2026-08-03', 14);

    expect(windows).toHaveLength(28);
    expect(windows[0]).toEqual({
      fromLocal: '2026-08-03T00:00',
      toLocal: '2026-08-03T12:00',
    });
    expect(windows[27]).toEqual({
      fromLocal: '2026-08-16T12:00',
      toLocal: '2026-08-17T00:00',
    });
  });

  it('rejects invalid start dates and non-positive planning periods', () => {
    expect(() => buildDepartureWindows('08/03/2026', 14)).toThrow(
      'startDate must use YYYY-MM-DD',
    );
    expect(() => buildDepartureWindows('2026-08-03', 0)).toThrow(
      'days must be a positive integer',
    );
  });
});

describe('fetchAirportDepartures', () => {
  it('requests only ANU commercial departures using the RapidAPI server headers', async () => {
    let requestedUrl = '';
    let requestedInit: RequestInit | undefined;
    const fetcher = async (input: string | URL, init?: RequestInit) => {
      requestedUrl = String(input);
      requestedInit = init;
      return new Response(JSON.stringify({ departures: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    const departures = await fetchAirportDepartures(
      {
        fromLocal: '2026-08-03T00:00',
        toLocal: '2026-08-03T12:00',
      },
      { apiKey: 'server-secret', fetcher },
    );

    expect(departures).toEqual([]);
    expect(requestedUrl).toBe(
      'https://aerodatabox.p.rapidapi.com/flights/airports/iata/ANU/2026-08-03T00%3A00/2026-08-03T12%3A00?direction=Departure&withLeg=true&withCancelled=true&withCodeshared=false&withCargo=false&withPrivate=false&withLocation=false',
    );
    expect(requestedInit).toMatchObject({
      headers: {
        'X-RapidAPI-Key': 'server-secret',
        'X-RapidAPI-Host': 'aerodatabox.p.rapidapi.com',
      },
    });
  });
});

describe('normalizeDepartures', () => {
  it('maps operating departures to the existing flight_data contract', () => {
    const normalized = normalizeDepartures([
      {
        number: 'AA 1136',
        status: 'Expected',
        codeshareStatus: 'IsOperator',
        isCargo: false,
        departure: {
          airport: { name: 'V.C. Bird International', iata: 'ANU', icao: 'TAPA' },
          scheduledTime: {
            utc: '2026-08-03T16:21:00Z',
            local: '2026-08-03T12:21:00-04:00',
          },
          terminal: 'Main',
          gate: '2',
          quality: ['Basic'],
        },
        arrival: {
          airport: {
            name: 'John F Kennedy International',
            iata: 'JFK',
            icao: 'KJFK',
          },
          scheduledTime: {
            utc: '2026-08-03T20:55:00Z',
            local: '2026-08-03T16:55:00-04:00',
          },
          quality: ['Basic'],
        },
        aircraft: { model: 'Boeing 737-800', reg: null, modeS: null },
        airline: { name: 'American Airlines', iata: 'AA', icao: 'AAL' },
      },
    ]);

    expect(normalized).toEqual([
      {
        flight_date: '2026-08-03',
        flight_num: 'AA1136',
        airline_code: 'AA',
        aircraft_type: 'Boeing 737-800',
        scheduled_time: '2026-08-03T12:21:00',
        flight_type: 'departure',
        origin_destination: 'John F Kennedy International',
        terminal: 'Main',
        gate: '2',
        status: 'scheduled',
        schedule_week_start: '2026-08-03',
        schedule_month: '2026-08',
      },
    ]);
  });

  it('drops codeshares, cargo, and malformed rows while retaining cancellations', () => {
    const base = {
      departure: {
        airport: { name: 'V.C. Bird International', iata: 'ANU', icao: 'TAPA' },
        scheduledTime: {
          utc: '2026-08-04T14:00:00Z',
          local: '2026-08-04T10:00:00-04:00',
        },
        quality: ['Live'],
      },
      arrival: {
        airport: { name: 'Grantley Adams International', iata: 'BGI', icao: 'TBPB' },
        quality: ['Basic'],
      },
      airline: { name: 'Caribbean Airlines', iata: 'BW', icao: 'BWA' },
    };

    const normalized = normalizeDepartures([
      {
        ...base,
        number: 'BW 419',
        status: 'Canceled',
        codeshareStatus: 'IsOperator',
        isCargo: false,
      },
      {
        ...base,
        number: 'QR 2914',
        status: 'Expected',
        codeshareStatus: 'IsCodeshared',
        isCargo: false,
      },
      {
        ...base,
        number: 'D0 2402',
        status: 'Expected',
        codeshareStatus: 'IsOperator',
        isCargo: true,
      },
      {
        ...base,
        status: 'Expected',
        codeshareStatus: 'IsOperator',
        isCargo: false,
      },
    ]);

    expect(normalized).toHaveLength(1);
    expect(normalized[0]).toMatchObject({
      flight_num: 'BW419',
      flight_type: 'departure',
      status: 'cancelled',
    });
  });
});
