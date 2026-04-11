export interface StaffMember {
  name: string;
  availableStart: string; // "HH:MM"
  availableEnd: string;
  maxHours: number;
  preferredShift?: 'morning' | 'afternoon' | 'evening';
}

export interface FlightRecord {
  scheduled_time: string;
  flight_type: 'arrival' | 'departure';
  estimated_passengers: number;
}

export interface ShiftAssignment {
  staffName: string;
  start: string; // "HH:MM"
  end: string;
  hours: number;
  coversPeaks: string[]; // which peak periods this shift covers
}

export interface ScheduleResult {
  shifts: ShiftAssignment[];
  coverageScore: number; // 0-100
  totalHours: number;
  peakPeriods: string[];
  understaffedPeriods: string[];
  recommendation: string;
}

// Store hours: 9:00 AM – 8:00 PM
export const STORE_OPEN = '09:00';
export const STORE_CLOSE = '20:00';

// The Tailor's Daughter staff
// Nichelle: full-time, 5 days/week, max 40 hrs/week (8 hrs/day), exactly 2 days off/week
// Biliana: part-time, no day limit, min 5 hours when called in, max 8 hours
//   - Works Nichelle's 2 days off (solo)
//   - Also called in for overlap on busy days to cover uncovered high-value flights
// Devonte: sick cover only, not on regular schedule
export const NICHELLE: StaffMember = {
  name: 'Nichelle', availableStart: '09:00', availableEnd: '20:00', maxHours: 8,
};
export const BILIANA: StaffMember = {
  name: 'Biliana', availableStart: '09:00', availableEnd: '20:00', maxHours: 8,
};
export const BILIANA_MIN_HOURS = 3;
export const DEVONTE: StaffMember = {
  name: 'Devonte', availableStart: '09:00', availableEnd: '20:00', maxHours: 8,
};

export const DEFAULT_STAFF: StaffMember[] = [NICHELLE, BILIANA];
export const NICHELLE_DAYS_OFF_PER_WEEK = 2; // Nichelle gets exactly 2 days off per week
export const BILIANA_OVERLAP_THRESHOLD = 3; // Only call Biliana in for overlap if 3+ HV flights uncovered

function timeToMinutes(timeStr: string): number {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// Generate 30-minute time slots for store hours (9:00 AM – 8:00 PM)
function generateTimeSlots(): string[] {
  const slots: string[] = [];
  for (let mins = 540; mins < 1200; mins += 30) { // 9:00 to 19:30
    slots.push(minutesToTime(mins));
  }
  return slots;
}

// Build demand curve from flight data
// Arriving passengers reach the shop 20-50min after landing
// Departing passengers shop 60-120min before departure
export function buildDemandCurve(flights: FlightRecord[]): Record<string, number> {
  const slots = generateTimeSlots();
  const curve: Record<string, number> = {};

  // Base demand: at least some foot traffic every slot
  for (const slot of slots) {
    curve[slot] = 5; // baseline foot traffic
  }

  for (const flight of flights) {
    const flightTime = timeToMinutes(flight.scheduled_time.substring(11, 16));
    const pax = flight.estimated_passengers;

    if (flight.flight_type === 'arrival') {
      // Arriving passengers reach retail 20-50min after landing
      // ~70% conversion rate for arrivals
      for (let offset = 20; offset <= 50; offset += 10) {
        const shopTime = flightTime + offset;
        const slotMins = Math.floor(shopTime / 30) * 30;
        const slotKey = minutesToTime(slotMins);
        if (curve[slotKey] !== undefined) {
          curve[slotKey] += Math.round((pax * 0.7) / 4); // spread across 4 sub-intervals
        }
      }
    } else {
      // Departing passengers shop 60-120min before departure
      // ~60% conversion rate for departures
      for (let offset = 60; offset <= 120; offset += 20) {
        const shopTime = flightTime - offset;
        if (shopTime < 540) continue; // before 9am (store opens at 9)
        const slotMins = Math.floor(shopTime / 30) * 30;
        const slotKey = minutesToTime(slotMins);
        if (curve[slotKey] !== undefined) {
          curve[slotKey] += Math.round((pax * 0.6) / 4);
        }
      }
    }
  }

  return curve;
}

// Calculate how many staff are needed per 30-min slot
// Rule of thumb: 1 staff per 45 customers in a 30-min window
function staffNeededPerSlot(customers: number): number {
  return Math.max(1, Math.ceil(customers / 45));
}

// Find peak periods (slots needing 2+ staff)
function findPeakPeriods(demandCurve: Record<string, number>): string[] {
  return Object.entries(demandCurve)
    .filter(([, demand]) => staffNeededPerSlot(demand) >= 2)
    .map(([slot]) => slot);
}

// Calculate total demand score for a day's flights
export function getDayDemandScore(flights: FlightRecord[]): number {
  const curve = buildDemandCurve(flights);
  return Object.values(curve).reduce((sum, d) => sum + d, 0);
}

// Check if a day needs two staff (high-value flights span > 8 hours)
function dayNeedsTwoStaff(flights: FlightRecord[]): boolean {
  const storeOpen = 540;
  const storeClose = 1200;
  const maxShiftMins = 480;

  const hvWindows: number[] = [];
  for (const f of flights) {
    if (f.flight_type !== 'departure') continue;
    const flightTime = timeToMinutes(f.scheduled_time.substring(11, 16));
    const shopWindow = flightTime - 30;
    if (shopWindow >= storeOpen && shopWindow < storeClose && f.estimated_passengers >= HIGH_VALUE_FLIGHT_THRESHOLD) {
      hvWindows.push(shopWindow);
    }
  }
  if (hvWindows.length < 2) return false;
  const span = Math.max(...hvWindows) - Math.min(...hvWindows);
  return span > maxShiftMins;
}

// Count HV departures Nichelle's standard 8h shift would miss
function countMissedHVForNichelle(flights: FlightRecord[]): number {
  const storeOpen = 540;
  const maxShiftMins = 480;

  const hvWindows: number[] = [];
  for (const f of flights) {
    if (f.flight_type !== 'departure') continue;
    if (f.estimated_passengers < HIGH_VALUE_FLIGHT_THRESHOLD) continue;
    const flightTime = timeToMinutes(f.scheduled_time.substring(11, 16));
    const shopWindow = flightTime - 30;
    if (shopWindow >= storeOpen && shopWindow < 1200) {
      hvWindows.push(shopWindow);
    }
  }
  if (hvWindows.length === 0) return 0;

  // Find the best 8-hour window covering most HV flights
  let bestCovered = 0;
  for (let s = storeOpen; s <= 1200 - maxShiftMins; s += 30) {
    const e = s + maxShiftMins;
    const covered = hvWindows.filter(w => w >= s && w < e).length;
    if (covered > bestCovered) bestCovered = covered;
  }
  return hvWindows.length - bestCovered;
}

// Plan a full week:
// 1. Nichelle gets 2 days off per week (Biliana works those solo at 5h each = 10h)
// 2. Biliana has ~10 more hours/week budget for overlap on busiest days
// 3. Total Biliana cap: 20h/week
export const BILIANA_WEEKLY_HOURS_CAP = 20;
export const BILIANA_SOLO_HOURS_ESTIMATE = 7; // budgeting estimate (actual varies 3-8h)
export const BILIANA_OVERLAP_HOURS = 5; // each overlap shift is 5h

export function planWeek(
  dailyFlights: { date: string; flights: FlightRecord[] }[]
): { date: string; isBilianaDay: boolean; needsTwoStaff: boolean; needsOverlap: boolean; demandScore: number }[] {
  const scored = dailyFlights.map(d => ({
    date: d.date,
    demandScore: getDayDemandScore(d.flights),
    flights: d.flights,
    missedHV: countMissedHVForNichelle(d.flights),
    needsTwoStaff: dayNeedsTwoStaff(d.flights),
  }));

  // Pick Nichelle's 2 days off — lightest days that don't need 2 staff
  const candidates = [...scored].sort((a, b) => {
    if (a.needsTwoStaff !== b.needsTwoStaff) return a.needsTwoStaff ? 1 : -1;
    return a.demandScore - b.demandScore;
  });
  const bilianaSoloDays = new Set(candidates.slice(0, NICHELLE_DAYS_OFF_PER_WEEK).map(d => d.date));

  // Calculate remaining hour budget for Biliana overlap shifts
  const usedHours = bilianaSoloDays.size * BILIANA_SOLO_HOURS_ESTIMATE;
  const remainingHours = Math.max(0, BILIANA_WEEKLY_HOURS_CAP - usedHours);
  const maxOverlapDays = Math.floor(remainingHours / BILIANA_OVERLAP_HOURS);

  // Pick busiest days for Biliana overlap (not based on missed flights — just demand)
  // She gives Nichelle support on the highest-volume days
  const overlapCandidates = scored
    .filter(d => !bilianaSoloDays.has(d.date))
    .sort((a, b) => b.demandScore - a.demandScore); // busiest first

  const overlapDays = new Set(overlapCandidates.slice(0, maxOverlapDays).map(d => d.date));

  return scored.map(d => ({
    date: d.date,
    isBilianaDay: bilianaSoloDays.has(d.date),
    needsTwoStaff: d.needsTwoStaff && !bilianaSoloDays.has(d.date),
    needsOverlap: overlapDays.has(d.date),
    demandScore: d.demandScore,
  }));
}

// Minimum passenger threshold — flights at or above this MUST be covered
export const HIGH_VALUE_FLIGHT_THRESHOLD = 100;

// Find the optimal 8-hour window that covers the most high-value departures
// High-value = 150+ passengers. Shopping window = 30 min before departure.
function findOptimalShiftWindow(
  flights: FlightRecord[],
  storeOpen: number,
  storeClose: number,
  maxShiftMins: number
): { start: number; end: number; coveredHighValue: number; missedHighValue: number; totalHighValue: number } {
  // Get departure shopping windows (30 min before departure) for high-value flights
  const highValueWindows: number[] = [];
  const allDepWindows: number[] = [];

  for (const f of flights) {
    if (f.flight_type !== 'departure') continue;
    const flightTime = timeToMinutes(f.scheduled_time.substring(11, 16));
    const shopWindow = flightTime - 30; // 30 min before departure

    if (shopWindow >= storeOpen && shopWindow < storeClose) {
      allDepWindows.push(shopWindow);
      if (f.estimated_passengers >= HIGH_VALUE_FLIGHT_THRESHOLD) {
        highValueWindows.push(shopWindow);
      }
    }
  }

  // If no high-value flights, center shift around the busiest departure cluster
  if (highValueWindows.length === 0) {
    if (allDepWindows.length > 0) {
      // Center on median departure time
      allDepWindows.sort((a, b) => a - b);
      const median = allDepWindows[Math.floor(allDepWindows.length / 2)];
      const idealStart = median - Math.floor(maxShiftMins / 2);
      const start = Math.max(storeOpen, Math.min(idealStart, storeClose - maxShiftMins));
      return {
        start,
        end: Math.min(start + maxShiftMins, storeClose),
        coveredHighValue: 0,
        missedHighValue: 0,
        totalHighValue: 0,
      };
    }
    return {
      start: storeOpen,
      end: Math.min(storeOpen + maxShiftMins, storeClose),
      coveredHighValue: 0,
      missedHighValue: 0,
      totalHighValue: 0,
    };
  }

  // Find the tightest window around the HV flights
  // Start just before the earliest HV flight, end just after the latest
  const earliestHV = Math.min(...highValueWindows);
  const latestHV = Math.max(...highValueWindows);
  const hvSpan = latestHV - earliestHV;

  let bestStart: number;

  if (hvSpan <= maxShiftMins) {
    // All HV flights fit in 8 hours — center the shift around them
    // But bias LATE: start as late as possible while covering the earliest HV flight
    // This avoids wasting morning hours when flights are in the afternoon
    bestStart = latestHV + 30 - maxShiftMins; // end 30 min after last HV flight
    bestStart = Math.max(bestStart, storeOpen);
    // Make sure we still cover the earliest
    if (bestStart > earliestHV) bestStart = earliestHV;
    bestStart = Math.max(bestStart, storeOpen);
  } else {
    // HV flights span more than 8 hours — cover as many as possible
    // Slide window and find max coverage
    bestStart = storeOpen;
    let bestCovered = 0;
    for (let start = storeOpen; start <= storeClose - maxShiftMins; start += 30) {
      const end = start + maxShiftMins;
      const covered = highValueWindows.filter(w => w >= start && w < end).length;
      if (covered > bestCovered) {
        bestCovered = covered;
        bestStart = start;
      }
    }
  }

  // Snap to 30 min boundary
  bestStart = Math.round(bestStart / 30) * 30;
  const bestCovered = highValueWindows.filter(w => w >= bestStart && w < bestStart + maxShiftMins).length;

  const bestEnd = Math.min(bestStart + maxShiftMins, storeClose);
  const missed = highValueWindows.filter(w => w < bestStart || w >= bestEnd).length;

  return {
    start: bestStart,
    end: bestEnd,
    coveredHighValue: bestCovered,
    missedHighValue: missed,
    totalHighValue: highValueWindows.length,
  };
}

// Generate schedule for a single day
// Logic:
// 1. Find all high-value departure windows (150+ pax, 30 min before departure)
// 2. Try to cover them all with one 8-hour Nichelle shift
// 3. If one shift can't cover all — split: Nichelle takes one chunk, Biliana takes the other
// isBilianaDay = this is Nichelle's day off, Biliana works solo
export function optimizeSchedule(
  _staff: StaffMember[],
  flights: FlightRecord[],
  _dayIndex: number = 0,
  isBilianaDay: boolean = false,
  needsOverlap: boolean = false
): ScheduleResult {
  const demandCurve = buildDemandCurve(flights);
  const slots = generateTimeSlots();
  const peakPeriods = findPeakPeriods(demandCurve);

  const storeOpen = 540;  // 9:00 AM
  const storeClose = 1200; // 8:00 PM
  const maxShiftMins = 480; // 8 hours

  const shifts: ShiftAssignment[] = [];

  // Get all high-value departure shopping windows
  const highValueWindows: { time: number; flight: FlightRecord }[] = [];
  for (const f of flights) {
    if (f.flight_type !== 'departure') continue;
    const flightTime = timeToMinutes(f.scheduled_time.substring(11, 16));
    const shopWindow = flightTime - 30;
    if (shopWindow >= storeOpen && shopWindow < storeClose && f.estimated_passengers >= HIGH_VALUE_FLIGHT_THRESHOLD) {
      highValueWindows.push({ time: shopWindow, flight: f });
    }
  }
  highValueWindows.sort((a, b) => a.time - b.time);

  const bilianaMinMins = BILIANA_MIN_HOURS * 60; // 300 mins = 5 hours

  // Last 100+ pax departure shopping window = 30 min before that flight
  // That's when the last passengers are shopping. After that, close up.
  const hvDepartureTimes = flights
    .filter(f => f.flight_type === 'departure' && f.estimated_passengers >= HIGH_VALUE_FLIGHT_THRESHOLD)
    .map(f => timeToMinutes(f.scheduled_time.substring(11, 16)));
  const lastHVDeparture = hvDepartureTimes.length > 0 ? Math.max(...hvDepartureTimes) : storeClose;
  const latestShiftEnd = Math.min(lastHVDeparture, storeClose); // end at departure time, not after

  // RULE: Must be open 3 hours before the first 100+ pax departure
  const firstHVDeparture = highValueWindows.length > 0 ? highValueWindows[0].time + 30 : null; // +30 to get actual dep time (we stored shopWindow which is -30)
  const mustOpenBy = firstHVDeparture !== null
    ? Math.max(storeOpen, firstHVDeparture - 180) // 3 hours before first HV departure
    : storeOpen;

  if (isBilianaDay) {
    // Nichelle's day off — Biliana works solo
    // Aim for 8 hours but only what flights need:
    // Start: 3 hours before first HV departure (or store open)
    // End: at last HV departure (or store close)
    // If span < 8h, that's the natural shift. Cap at 8h max.
    let start: number;
    let end: number;

    if (highValueWindows.length > 0) {
      start = mustOpenBy;
      end = latestShiftEnd;

      // Cap at 8 hours max
      if (end - start > maxShiftMins) {
        end = start + maxShiftMins;
      }

      // Ensure minimum 3 hours
      if (end - start < bilianaMinMins) {
        end = start + bilianaMinMins;
      }
    } else {
      // No HV flights — minimum 3 hours starting at store open
      start = storeOpen;
      end = start + bilianaMinMins;
    }

    // Clamp to store hours
    end = Math.min(end, latestShiftEnd);
    start = Math.max(storeOpen, start);
    if (end - start < bilianaMinMins) {
      end = start + bilianaMinMins;
    }
    // Snap to 30 min
    start = Math.round(start / 30) * 30;
    end = Math.round(end / 30) * 30;

    shifts.push({
      staffName: 'Biliana',
      start: minutesToTime(start),
      end: minutesToTime(end),
      hours: Math.round((end - start) / 60 * 10) / 10,
      coversPeaks: peakPeriods.filter(p => {
        const m = timeToMinutes(p);
        return m >= start && m < end;
      }),
    });
  } else {
    // STEP 1: Place Nichelle's 8-hour shift
    // She must be there 2 hours before the first big flight
    const optimal = findOptimalShiftWindow(flights, storeOpen, storeClose, maxShiftMins);
    let nichelleStart = Math.min(optimal.start, mustOpenBy);
    nichelleStart = Math.max(storeOpen, nichelleStart);
    let nichelleEnd = nichelleStart + maxShiftMins;

    // Clamp: no later than 30 min after last departure
    if (nichelleEnd > latestShiftEnd) {
      nichelleEnd = latestShiftEnd;
      nichelleStart = Math.max(storeOpen, nichelleEnd - maxShiftMins);
    }

    // Snap to 15 min boundaries
    nichelleStart = Math.floor(nichelleStart / 30) * 30;
    nichelleEnd = Math.floor(nichelleEnd / 30) * 30;

    shifts.push({
      staffName: 'Nichelle',
      start: minutesToTime(nichelleStart),
      end: minutesToTime(nichelleEnd),
      hours: Math.round((nichelleEnd - nichelleStart) / 60 * 10) / 10,
      coversPeaks: peakPeriods.filter(p => {
        const m = timeToMinutes(p);
        return m >= nichelleStart && m < nichelleEnd;
      }),
    });

    // STEP 2: Bring Biliana in for overlap on busiest days (planWeek decides which)
    if (needsOverlap) {
      // Cap overlap at 5 hours (budgeted from weekly cap)
      const overlapMins = BILIANA_OVERLAP_HOURS * 60;

      // Place during peak HV cluster — center around the densest hour
      const allHVTimes = highValueWindows.map(w => w.time).sort((a, b) => a - b);
      let bilianaEnd: number;
      let bilianaStart: number;

      if (allHVTimes.length > 0) {
        // End: 30 min after the last HV flight Nichelle covers, OR last HV flight overall
        const lastHV = allHVTimes[allHVTimes.length - 1];
        bilianaEnd = Math.min(lastHV, latestShiftEnd);
        bilianaStart = bilianaEnd - overlapMins;
      } else {
        // Default: afternoon overlap
        bilianaStart = 720; // noon
        bilianaEnd = bilianaStart + overlapMins;
      }

      // Clamp to store hours
      bilianaStart = Math.max(storeOpen, bilianaStart);
      bilianaEnd = Math.min(latestShiftEnd, bilianaEnd);
      // Re-anchor to maintain 5h shift if clamping shrunk it
      if (bilianaEnd - bilianaStart < overlapMins) {
        if (bilianaEnd === latestShiftEnd) {
          bilianaStart = Math.max(storeOpen, bilianaEnd - overlapMins);
        } else {
          bilianaEnd = Math.min(latestShiftEnd, bilianaStart + overlapMins);
        }
      }

      // Snap to 15 min boundaries (start rounds down, end rounds down — don't extend past last flight)
      bilianaStart = Math.floor(bilianaStart / 30) * 30;
      bilianaEnd = Math.floor(bilianaEnd / 30) * 30;

      shifts.push({
        staffName: 'Biliana',
        start: minutesToTime(bilianaStart),
        end: minutesToTime(bilianaEnd),
        hours: Math.round((bilianaEnd - bilianaStart) / 60 * 10) / 10,
        coversPeaks: peakPeriods.filter(p => {
          const m = timeToMinutes(p);
          return m >= bilianaStart && m < bilianaEnd;
        }),
      });
    }
  }

  // Calculate coverage score
  const coverageScore = calculateCoverageScore(shifts, demandCurve, slots, flights);

  // Find understaffed periods
  const understaffedPeriods = findUnderstaffedPeriods(shifts, demandCurve, slots);

  // Check high-value flight coverage
  const coveredHV = highValueWindows.filter(w =>
    shifts.some(s => {
      const start = timeToMinutes(s.start);
      const end = timeToMinutes(s.end);
      return w.time >= start && w.time < end;
    })
  ).length;
  const missedHV = highValueWindows.length - coveredHV;

  // Generate recommendation text
  const totalHours = shifts.reduce((sum, s) => sum + s.hours, 0);
  let recommendation = '';
  if (highValueWindows.length > 0) {
    recommendation += `High-value flights (150+ pax): ${coveredHV}/${highValueWindows.length} covered`;
    if (missedHV > 0) recommendation += ` — ${missedHV} MISSED`;
    recommendation += '\n';
  }
  if (shifts.length > 1) {
    recommendation += `Split shift day: ${shifts[0].staffName} ${shifts[0].start}–${shifts[0].end}, ${shifts[1].staffName} ${shifts[1].start}–${shifts[1].end}\n`;
  }
  recommendation += generateRecommendation(shifts, peakPeriods, understaffedPeriods, coverageScore);

  return {
    shifts,
    coverageScore,
    totalHours: Math.round(totalHours * 10) / 10,
    peakPeriods,
    understaffedPeriods,
    recommendation,
  };
}

// Coverage = what % of 100+ pax departures are covered by staff
function calculateCoverageScore(
  shifts: ShiftAssignment[],
  _demandCurve: Record<string, number>,
  _slots: string[],
  flights?: FlightRecord[]
): number {
  if (!flights || flights.length === 0) return 100;

  // Get all departure shopping windows for 100+ pax flights
  const hvDepartures = flights.filter(
    f => f.flight_type === 'departure' && f.estimated_passengers >= HIGH_VALUE_FLIGHT_THRESHOLD
  );

  if (hvDepartures.length === 0) return 100;

  let covered = 0;
  for (const f of hvDepartures) {
    const flightTime = timeToMinutes(f.scheduled_time.substring(11, 16));
    const shopWindow = flightTime - 30;

    const isCovered = shifts.some(s => {
      const start = timeToMinutes(s.start);
      const end = timeToMinutes(s.end);
      return shopWindow >= start && shopWindow < end;
    });

    if (isCovered) covered++;
  }

  return Math.round((covered / hvDepartures.length) * 100);
}

function findUnderstaffedPeriods(
  shifts: ShiftAssignment[],
  demandCurve: Record<string, number>,
  slots: string[]
): string[] {
  const understaffed: string[] = [];

  for (const slot of slots) {
    const demand = staffNeededPerSlot(demandCurve[slot] || 0);
    const staffed = shifts.filter((s) => {
      const start = timeToMinutes(s.start);
      const end = timeToMinutes(s.end);
      const slotMin = timeToMinutes(slot);
      return slotMin >= start && slotMin < end;
    }).length;

    if (staffed < demand) {
      understaffed.push(slot);
    }
  }

  return understaffed;
}

function generateRecommendation(
  shifts: ShiftAssignment[],
  peakPeriods: string[],
  understaffedPeriods: string[],
  coverageScore: number
): string {
  const lines: string[] = [];

  if (coverageScore >= 90) {
    lines.push('Coverage is excellent. All major peaks are well-staffed.');
  } else if (coverageScore >= 75) {
    lines.push('Coverage is good with minor gaps.');
  } else {
    lines.push('Coverage needs attention — several peak periods are understaffed.');
  }

  if (understaffedPeriods.length > 0) {
    const grouped = groupConsecutiveSlots(understaffedPeriods);
    lines.push(`Understaffed windows: ${grouped.join(', ')}`);
  }

  // Overlap periods (2+ staff)
  const overlapStart = shifts.reduce((latest, s) => {
    const start = timeToMinutes(s.start);
    return start > latest ? start : latest;
  }, 0);
  const overlapEnd = shifts.reduce((earliest, s) => {
    const end = timeToMinutes(s.end);
    return end < earliest ? end : earliest;
  }, 1440);

  if (overlapStart < overlapEnd) {
    lines.push(`Shift overlap (2+ staff): not detected in a simple window — check visual schedule.`);
  }

  // Break recommendations
  for (const shift of shifts) {
    if (shift.hours >= 6) {
      const shiftMid = timeToMinutes(shift.start) + Math.floor((shift.hours * 60) / 2);
      // Find a non-peak slot near mid-shift
      const breakTime = minutesToTime(Math.round(shiftMid / 30) * 30);
      lines.push(`${shift.staffName}: recommend break around ${breakTime}`);
    }
  }

  return lines.join('\n');
}

function groupConsecutiveSlots(slots: string[]): string[] {
  if (slots.length === 0) return [];

  const sorted = [...slots].sort((a, b) => timeToMinutes(a) - timeToMinutes(b));
  const groups: string[] = [];
  let rangeStart = sorted[0];
  let prev = sorted[0];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    if (timeToMinutes(current) - timeToMinutes(prev) <= 30) {
      prev = current;
    } else {
      groups.push(rangeStart === prev ? rangeStart : `${rangeStart}–${prev}`);
      rangeStart = current;
      prev = current;
    }
  }
  groups.push(rangeStart === prev ? rangeStart : `${rangeStart}–${prev}`);

  return groups;
}
