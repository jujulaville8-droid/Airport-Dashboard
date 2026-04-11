/**
 * Parser for ABAA "Carrier Passenger Summary" emails.
 *
 * The Antigua & Barbuda Airport Authority operations team emails a
 * per-flight passenger-count summary to carriers the day before, formatted
 * as plain text in the email body. We parse those counts and merge them
 * into flight_data.actual_passengers so the dashboard can compare scheduled
 * estimates against actual booked loads.
 *
 * Sample body (flights only):
 *   AA 3242 JFK – ANU: 155 passengers.
 *   AA 3039 ANU – MIA: 162 passengers.
 *   Scheduled Time of Arrival: 12:12LT
 *   Scheduled Time of Departure: 13:15LT
 *
 * Quirks observed across multiple samples:
 *   - Flight numbers are space-separated ("AA 3242"), but flight_data stores
 *     them concatenated ("AA3242"). The parser normalizes by stripping.
 *   - Both en-dash and hyphen appear as the origin→dest separator.
 *   - Passenger counts are sometimes zero-padded ("041"), sometimes with
 *     missing whitespace before "passengers" ("027passengers").
 *   - "TBA passengers" means unknown — treated as null.
 *   - Schedule times are always local ("LT" suffix).
 *   - Subject carries the date, not the body.
 *
 * The email may have been forwarded one or more hops, so we don't rely on
 * the sender header — we match on subject ("Carrier Passenger Summary")
 * and trust the body content.
 */

export interface ParsedFlightCapacity {
  flight_num: string;
  flight_type: 'arrival' | 'departure';
  actual_passengers: number | null;
  origin: string;
  destination: string;
  scheduled_time_local: string | null;
}

export interface ParsedCarrierCapacity {
  flight_date: string;
  flights: ParsedFlightCapacity[];
  warnings: string[];
}

const MONTH_NAMES: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8,
  sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Extract a YYYY-MM-DD from a subject line. Handles all observed shapes:
 *   "Carrier Passenger Summary - Friday10th April 2026"
 *   "Carrier Passenger Summary -  Thursday, 09th April 2026:"
 *   "Carriers Passenger Summary - Saturday, 11th April, 2026"
 */
export function extractDateFromSubject(subject: string): string | null {
  // Pre-clean:
  //   1. Strip "th"/"st"/"nd"/"rd" day suffixes: "10th" → "10"
  //   2. Insert a space at any letter-digit boundary: "Friday10" → "Friday 10".
  //      Needed because Gmail strips spaces in some forwarded subject lines
  //      and \b in the main regex doesn't match between a letter and a digit.
  const cleaned = subject
    .replace(/(\d{1,2})(st|nd|rd|th)/gi, '$1')
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .replace(/(\d)([A-Za-z])/g, '$1 $2');
  const re = /\b(\d{1,2})\b[^\w]*?([A-Za-z]+)[^\w]*?(20\d{2})\b/;
  const m = cleaned.match(re);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const monthName = m[2].toLowerCase();
  const year = parseInt(m[3], 10);
  const month = MONTH_NAMES[monthName];
  if (!month || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// Flight line regex — tolerates multiple space styles, en-dash or hyphen,
// zero-padded counts, missing space before "passengers", and "TBA".
const FLIGHT_LINE_RE =
  /\b([A-Z]{2,3})\s*(\d{1,4})\s+([A-Z]{3})\s*[\u2013\-]\s*([A-Z]{3})\s*:?\s*(\d{1,4}|TBA)\s*(?:passengers?)?/gi;

// "Scheduled time of Arrival: 12:12LT" or "...Departure: 13:15LT"
const SCHEDULED_TIME_RE =
  /scheduled\s+time\s+of\s+(arrival|departure)\s*:?\s*(\d{1,2}):(\d{2})\s*lt/gi;

const ANU = 'ANU'; // V.C. Bird International — the home airport

/**
 * Parse an ABAA Carrier Passenger Summary email body + subject into
 * structured flight records. Pure string work, no I/O.
 *
 * Returns an empty `flights` array if nothing parseable was found, rather
 * than throwing. The caller logs warnings and decides the import outcome.
 */
export function parseCarrierCapacity(
  subject: string,
  body: string,
  receivedDateIso?: string
): ParsedCarrierCapacity {
  const warnings: string[] = [];

  let flight_date = extractDateFromSubject(subject);
  if (!flight_date) {
    warnings.push(`Could not parse date from subject "${subject}"; falling back to received date`);
    if (receivedDateIso) {
      flight_date = receivedDateIso.substring(0, 10);
    } else {
      flight_date = new Date().toISOString().substring(0, 10);
      warnings.push('No received date available; using today');
    }
  }

  type FlightTok = {
    kind: 'flight';
    at: number;
    airline: string;
    num: string;
    origin: string;
    destination: string;
    pax: number | null;
  };
  type TimeTok = {
    kind: 'time';
    at: number;
    direction: 'arrival' | 'departure';
    hhmm: string;
  };
  const tokens: Array<FlightTok | TimeTok> = [];

  FLIGHT_LINE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FLIGHT_LINE_RE.exec(body)) !== null) {
    const airline = m[1].toUpperCase();
    const num = m[2];
    const origin = m[3].toUpperCase();
    const destination = m[4].toUpperCase();
    const paxRaw = m[5].toUpperCase();
    const pax = paxRaw === 'TBA' ? null : parseInt(paxRaw, 10);
    if (pax !== null && (!Number.isFinite(pax) || pax < 0 || pax > 9999)) {
      warnings.push(`Invalid passenger count ${paxRaw} for ${airline}${num}; skipping`);
      continue;
    }
    tokens.push({ kind: 'flight', at: m.index, airline, num, origin, destination, pax });
  }

  SCHEDULED_TIME_RE.lastIndex = 0;
  while ((m = SCHEDULED_TIME_RE.exec(body)) !== null) {
    tokens.push({
      kind: 'time',
      at: m.index,
      direction: m[1].toLowerCase() as 'arrival' | 'departure',
      hhmm: `${m[2].padStart(2, '0')}:${m[3]}`,
    });
  }

  tokens.sort((a, b) => a.at - b.at);

  const flights: ParsedFlightCapacity[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind !== 'flight') continue;
    const isArrival = t.destination === ANU;
    const isDeparture = t.origin === ANU;
    if (!isArrival && !isDeparture) {
      warnings.push(
        `Flight ${t.airline}${t.num} ${t.origin}-${t.destination} ` +
        `doesn't touch ${ANU}; skipping`
      );
      continue;
    }

    const direction: 'arrival' | 'departure' = isArrival ? 'arrival' : 'departure';
    let matchedTime: string | null = null;
    for (let j = i + 1; j < tokens.length; j++) {
      const c = tokens[j];
      if (c.kind === 'time' && c.direction === direction) {
        matchedTime = c.hhmm;
        break;
      }
    }

    flights.push({
      flight_num: `${t.airline}${t.num}`,
      flight_type: direction,
      actual_passengers: t.pax,
      origin: t.origin,
      destination: t.destination,
      scheduled_time_local: matchedTime,
    });
  }

  if (flights.length === 0) {
    warnings.push('No flights matched the Carrier Passenger Summary format');
  }

  return { flight_date, flights, warnings };
}
