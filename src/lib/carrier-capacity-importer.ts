/**
 * Importer for parsed Carrier Passenger Summary data.
 *
 * Takes the output of parseCarrierCapacity and updates the flight_data
 * rows in Supabase, filling in actual_passengers (+ metadata columns from
 * migration 003_actual_passengers.sql).
 *
 * Match strategy:
 *   - Primary: (flight_num, flight_date, flight_type) — matches the UNIQUE
 *     constraint on flight_data. This is how rows should match if the
 *     schedule PDF was already imported for the day.
 *   - Missed match: we log a warning listing the flight — in practice this
 *     happens when the schedule PDF hasn't been uploaded yet for that day,
 *     or when the airport's passenger email mentions a flight that wasn't
 *     in the original schedule. We do NOT create new rows, because the
 *     email doesn't carry enough data (no aircraft_type, no full timestamp
 *     with timezone) to make a valid flight_data row.
 */

import { parseCarrierCapacity, type ParsedCarrierCapacity } from './carrier-capacity-parser';
import { supabase, logImport } from './db';

export interface CarrierCapacityImportResult {
  success: boolean;
  flight_date: string;
  flightsParsed: number;
  flightsMatched: number;
  flightsUnmatched: number;
  unmatchedFlights: string[];    // "AA3242", "BW268", ...
  warnings: string[];
  errors: string[];
}

export async function importCarrierCapacityEmail(
  subject: string,
  body: string,
  receivedDateIso?: string,
  sourceLabel = 'email'
): Promise<CarrierCapacityImportResult> {
  const errors: string[] = [];
  const unmatchedFlights: string[] = [];

  let parsed: ParsedCarrierCapacity;
  try {
    parsed = parseCarrierCapacity(subject, body, receivedDateIso);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await logImport({
      source_type: 'manual',
      file_name: `carrier-capacity:${subject}`,
      total_records: 0,
      successful_records: 0,
      failed_records: 0,
      error_messages: { errors: [`Parse exception: ${msg}`] },
      reconciliation_status: 'failed',
    });
    return {
      success: false,
      flight_date: '',
      flightsParsed: 0,
      flightsMatched: 0,
      flightsUnmatched: 0,
      unmatchedFlights: [],
      warnings: [],
      errors: [`Parse exception: ${msg}`],
    };
  }

  const { flight_date, flights, warnings } = parsed;

  if (flights.length === 0) {
    await logImport({
      source_type: 'manual',
      file_name: `carrier-capacity:${subject}`,
      total_records: 0,
      successful_records: 0,
      failed_records: 0,
      error_messages: { warnings },
      reconciliation_status: 'failed',
    });
    return {
      success: false,
      flight_date,
      flightsParsed: 0,
      flightsMatched: 0,
      flightsUnmatched: 0,
      unmatchedFlights: [],
      warnings,
      errors: ['No flights parsed from email body'],
    };
  }

  // Update each flight one at a time. At ~20 flights per email this is
  // fine — batching via upsert would require us to first SELECT the rows
  // to know which ones exist, which is the same number of roundtrips.
  const now = new Date().toISOString();
  let matched = 0;
  for (const f of flights) {
    if (f.actual_passengers === null) continue; // TBA — skip the write
    const { data, error } = await supabase
      .from('flight_data')
      .update({
        actual_passengers: f.actual_passengers,
        actual_passengers_source: sourceLabel,
        actual_passengers_updated_at: now,
      })
      .eq('flight_num', f.flight_num)
      .eq('flight_date', flight_date)
      .eq('flight_type', f.flight_type)
      .select('id');

    if (error) {
      errors.push(`Update failed for ${f.flight_num} ${f.flight_type}: ${error.message}`);
      continue;
    }
    if (!data || data.length === 0) {
      unmatchedFlights.push(`${f.flight_num} ${f.flight_type}`);
      continue;
    }
    matched += data.length;
  }

  await logImport({
    source_type: 'manual',
    file_name: `carrier-capacity:${flight_date}`,
    total_records: flights.length,
    successful_records: matched,
    failed_records: unmatchedFlights.length,
    error_messages:
      warnings.length > 0 || errors.length > 0 || unmatchedFlights.length > 0
        ? { warnings, errors, unmatched: unmatchedFlights }
        : null,
    reconciliation_status:
      matched > 0 && errors.length === 0 ? 'complete' : matched > 0 ? 'partial' : 'failed',
  });

  return {
    success: matched > 0 && errors.length === 0,
    flight_date,
    flightsParsed: flights.length,
    flightsMatched: matched,
    flightsUnmatched: unmatchedFlights.length,
    unmatchedFlights,
    warnings,
    errors,
  };
}
