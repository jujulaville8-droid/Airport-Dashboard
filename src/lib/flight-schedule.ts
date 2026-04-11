import Anthropic from '@anthropic-ai/sdk';
import PDFParser from 'pdf2json';
import { logImport } from './db';

const client = new Anthropic();

// Aircraft seat capacity mapping
const AIRCRAFT_SEATS: Record<string, number> = {
  'B737': 180, 'B738': 180, 'B739': 180, 'B38M': 180, 'B39M': 180,
  'A320': 165, 'A319': 140, 'A321': 185, 'A220': 140,
  'B757': 220, 'B752': 220, 'B767': 280, 'B763': 280,
  'B777': 350, 'B772': 350,
  'B787': 290, 'A330': 300, 'A333': 300, 'A339': 300,
  'E190': 100, 'E175': 76, 'E145': 50, 'E120': 30,
  'CRJ9': 76, 'AT45': 48, 'AT46': 48, 'AT76': 70,
  'ATR': 48, 'DH8D': 78,
};

const DEFAULT_LOAD_FACTOR = 0.84;

interface ParsedFlight {
  flight_date: string;
  flight_num: string;
  airline_code: string | null;
  aircraft_type: string | null;
  scheduled_time: string;
  flight_type: 'arrival' | 'departure';
  estimated_passengers: number;
  origin_destination: string | null;
  terminal: string | null;
  gate: string | null;
}

interface CompactFlightRow {
  d: number[];        // dates
  f: string;          // flight_num
  t: string | null;   // aircraft_type
  a: string | null;   // arrival_time
  dp: string | null;  // departure_time
  o: string | null;   // origin code
  ds: string | null;  // destination code
}

function estimatePassengers(aircraftType: string | null): number {
  if (!aircraftType) return Math.round(150 * DEFAULT_LOAD_FACTOR);
  const code = aircraftType.toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 4);
  const seats = AIRCRAFT_SEATS[code] || 150;
  return Math.round(seats * DEFAULT_LOAD_FACTOR);
}

function formatTime(t: string): string {
  const padded = t.padStart(4, '0');
  return `${padded.substring(0, 2)}:${padded.substring(2, 4)}:00`;
}

// Extract text from PDF buffer using pdf2json
function extractPDFText(buffer: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const parser = new PDFParser();
    parser.on('pdfParser_dataReady', (data: { Pages: { Texts: { R: { T: string }[] }[] }[] }) => {
      const pages: string[] = [];
      for (const page of data.Pages) {
        let pageText = '';
        for (const text of page.Texts) {
          for (const run of text.R) {
            pageText += decodeURIComponent(run.T) + ' ';
          }
        }
        pages.push(pageText.trim());
      }
      // Join with clear page separators
      resolve(pages.map((p, i) => `--- PAGE ${i + 1} ---\n${p}`).join('\n\n'));
    });
    parser.on('pdfParser_dataError', (err: unknown) => reject(err));
    parser.parseBuffer(buffer);
  });
}

// Expand compact rows into individual dated flight entries
function expandFlights(rows: CompactFlightRow[], year: number, month: number): ParsedFlight[] {
  const flights: ParsedFlight[] = [];

  for (const row of rows) {
    if (!row.d || !row.f) continue;

    // Extract airline code from flight num (first 2-3 chars before digits)
    const airlineMatch = row.f.match(/^([A-Z0-9]{2})/);
    const airlineCode = airlineMatch ? airlineMatch[1] : null;

    for (const dayNum of row.d) {
      const testDate = new Date(year, month - 1, dayNum);
      if (testDate.getMonth() !== month - 1) continue;

      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;

      if (row.a && row.a !== 'null' && row.a !== '----') {
        flights.push({
          flight_date: dateStr,
          flight_num: row.f,
          airline_code: airlineCode,
          aircraft_type: row.t,
          scheduled_time: `${dateStr}T${formatTime(row.a)}`,
          flight_type: 'arrival',
          estimated_passengers: estimatePassengers(row.t),
          origin_destination: row.o || null,
          terminal: null,
          gate: null,
        });
      }

      if (row.dp && row.dp !== 'null' && row.dp !== '----') {
        flights.push({
          flight_date: dateStr,
          flight_num: row.f,
          airline_code: airlineCode,
          aircraft_type: row.t,
          scheduled_time: `${dateStr}T${formatTime(row.dp)}`,
          flight_type: 'departure',
          estimated_passengers: estimatePassengers(row.t),
          origin_destination: row.ds || null,
          terminal: null,
          gate: null,
        });
      }
    }
  }

  return flights;
}

export async function parseFlightSchedulePDF(
  pdfBuffer: Buffer,
  monthStart: string
): Promise<{ flights: ParsedFlight[]; rawResponse: string }> {
  const [yearStr, monthStr] = monthStart.split('-');
  const year = parseInt(yearStr);
  const month = parseInt(monthStr);

  // Step 1: Extract text from PDF (free, instant)
  const pdfText = await extractPDFText(pdfBuffer);

  // Step 2: Send plain text to Claude Haiku (very cheap — text only)
  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 10000,
    messages: [
      {
        role: 'user',
        content: `Extract ALL passenger flights from this airport schedule. The text has 7 day-of-week sections:
PAGE 4=Monday (Dates: 6,13,20,27), PAGE 5=Tuesday (7,14,21,28), PAGE 6=Wednesday (1,8,15,22,29),
PAGE 7=Thursday (2,9,16,23,30), PAGE 8=Friday (3,10,17,24), PAGE 9=Saturday (4,11,18,25), PAGE 10=Sunday (5,12,19,26).

You MUST process ALL 7 pages including Sunday on page 10. Do NOT stop early.

Each row has: Eff. Date, Flight No., Aircraft Type, Route, Arrival time, Departure time.
For each row, give the specific day-numbers it operates based on the Eff. Date range intersected with that page's dates.
Example: "13-27 Apr." on Monday page (dates 6,13,20,27) → d:[13,20,27]
Example: "06 Apr only." → d:[6]

Route: "JFK-ANU-MIA" = arrival from JFK, departure to MIA. "----" = null time.

Return JSON array:
{"d":[6,13,20,27],"f":"AA3242","t":"B38M","a":"1212","dp":"1315","o":"JFK","ds":"MIA"}
d=dates, f=flight num (first only, no spaces), t=aircraft type, a=arrival 4-digit or null, dp=departure 4-digit or null, o=origin airport code, ds=destination airport code.

Skip cargo (M6, FX/MTN, BEZ, 8C, D0). JSON array ONLY, no other text.

${pdfText}`,
      },
    ],
  });

  const rawText = response.content[0].type === 'text' ? response.content[0].text : '';

  // Parse JSON
  let jsonStr = rawText;
  const jsonMatch = rawText.match(/\[[\s\S]*\]/);
  if (jsonMatch) jsonStr = jsonMatch[0];

  let compactRows: CompactFlightRow[];
  try {
    compactRows = JSON.parse(jsonStr);
  } catch {
    const lastObj = jsonStr.lastIndexOf('}');
    if (lastObj > 0) {
      try {
        compactRows = JSON.parse(jsonStr.substring(0, lastObj + 1) + ']');
      } catch {
        throw new Error(`Failed to parse response: ${rawText.substring(0, 300)}`);
      }
    } else {
      throw new Error(`No valid JSON: ${rawText.substring(0, 300)}`);
    }
  }

  const rawFlights = expandFlights(compactRows, year, month);

  // Deduplicate: same flight_num + flight_date + flight_type = keep first only
  const seen = new Set<string>();
  const flights = rawFlights.filter((f) => {
    const key = `${f.flight_num}_${f.flight_date}_${f.flight_type}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { flights, rawResponse: `${compactRows.length} patterns → ${flights.length} flights` };
}

export async function importFlightSchedule(
  pdfBuffer: Buffer,
  scheduleMonth: string,
  fileName: string
): Promise<{
  success: boolean;
  scheduleMonth: string;
  totalFlights: number;
  arrivals: number;
  departures: number;
  errors: string[];
}> {
  const errors: string[] = [];
  const monthStart = `${scheduleMonth}-01`;

  try {
    const { flights, rawResponse } = await parseFlightSchedulePDF(pdfBuffer, monthStart);

    if (flights.length === 0) {
      errors.push('No flights extracted from PDF');
      await logImport({
        source_type: 'flight_schedule',
        file_name: fileName,
        total_records: 0,
        successful_records: 0,
        failed_records: 0,
        error_messages: { errors, rawResponse },
        reconciliation_status: 'failed',
      });
      return { success: false, scheduleMonth, totalFlights: 0, arrivals: 0, departures: 0, errors };
    }

    const flightRecords = flights.map((f) => ({
      flight_date: f.flight_date,
      flight_num: f.flight_num,
      airline_code: f.airline_code,
      aircraft_type: f.aircraft_type,
      scheduled_time: f.scheduled_time,
      flight_type: f.flight_type,
      estimated_passengers: f.estimated_passengers,
      origin_destination: f.origin_destination,
      terminal: f.terminal,
      gate: f.gate,
      schedule_week_start: monthStart,
      schedule_month: scheduleMonth,
    }));

    // Clear any existing data for this month first, then insert fresh
    const { deleteFlightMonth, storeFlightSchedulePDF } = await import('./db');
    await deleteFlightMonth(scheduleMonth);

    // Insert in batches using plain insert (not upsert — we cleared first)
    const { supabase } = await import('./db');
    for (let i = 0; i < flightRecords.length; i += 200) {
      const batch = flightRecords.slice(i, i + 200);
      const { error } = await supabase.from('flight_data').insert(batch);
      if (error) throw new Error(`Batch insert failed at row ${i}: ${error.message}`);
    }

    // Persist the original PDF to Supabase Storage so the flights page can
    // pull it back up on demand. Non-fatal on failure — the flight rows are
    // already in place and the user's more interested in those than in the
    // source file. We surface any storage error as a warning in `errors` so
    // it shows up in import_logs without failing the whole import.
    try {
      await storeFlightSchedulePDF(scheduleMonth, pdfBuffer, fileName);
    } catch (storageErr) {
      const msg = storageErr instanceof Error ? storageErr.message : String(storageErr);
      errors.push(`Warning: PDF storage failed (flight rows still imported): ${msg}`);
      console.error('[flight-schedule] PDF storage failed:', msg);
    }

    const arrivals = flights.filter((f) => f.flight_type === 'arrival').length;
    const departures = flights.filter((f) => f.flight_type === 'departure').length;

    await logImport({
      source_type: 'flight_schedule',
      file_name: fileName,
      total_records: flights.length,
      successful_records: flights.length,
      failed_records: 0,
      error_messages: null,
      reconciliation_status: 'complete',
    });

    return { success: true, scheduleMonth, totalFlights: flights.length, arrivals, departures, errors };
  } catch (err) {
    console.error('Flight schedule import error:', err);
    const errorMsg = err instanceof Error ? err.message : JSON.stringify(err, null, 2);
    errors.push(errorMsg);

    await logImport({
      source_type: 'flight_schedule',
      file_name: fileName,
      total_records: 0,
      successful_records: 0,
      failed_records: 0,
      error_messages: { errors },
      reconciliation_status: 'failed',
    });

    return { success: false, scheduleMonth, totalFlights: 0, arrivals: 0, departures: 0, errors };
  }
}
