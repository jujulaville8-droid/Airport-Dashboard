'use client';

import { useEffect, useRef, useState } from 'react';
import anime from 'animejs';
import DraggableShift from '@/components/DraggableShift';
import StaffSettings from '@/components/StaffSettings';
import { formatTime12 } from '@/lib/date-utils';
import {
  CalendarBlank,
  AirplaneTakeoff,
  Trash,
  FileArrowDown,
  X,
  Plus,
  CircleNotch,
  Envelope,
  CheckCircle,
  WarningCircle,
  Users,
  Clock,
  ShieldCheck,
} from '@phosphor-icons/react';

interface Shift {
  staffName: string;
  start: string;
  end: string;
  hours: number;
  coversPeaks: string[];
}

interface FlightDetail {
  flight_num: string;
  airline_code: string;
  scheduled_time: string;
  flight_type: string;
  estimated_passengers: number;
}

interface DaySchedule {
  date: string;
  shifts: Shift[];
  coverageScore: number;
  flightCount?: number;
  staffOnDuty?: string;
  dayOff?: string;
  flights?: FlightDetail[];
}

interface ScheduleData {
  success: boolean;
  scheduleDate: string;
  scheduleDateEnd?: string;
  // Single day response
  schedule?: Shift[];
  coverageScore?: number;
  totalHours?: number;
  peakPeriods?: string[];
  understaffedPeriods?: string[];
  // Multi-day response
  totalDays?: number;
  schedules?: DaySchedule[];
  averageCoverage?: number;
  nichelleDays?: number;
  bilianaDays?: number;
  staffHours?: Record<string, { totalHours: number; daysWorked: number }>;
  nichelleTarget?: number;
  nichelleOnTarget?: boolean;
  // Shared
  briefing: string;
}

// Small dropdown to add a staff member to a specific day
function AddStaffToDay({ existingStaff, onAdd }: { date: string; existingStaff: string[]; onAdd: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const [allStaff, setAllStaff] = useState<{ name: string; role: string }[]>([]);

  const loadStaff = async () => {
    if (allStaff.length > 0) { setOpen(!open); return; }
    try {
      const res = await fetch('/api/staff');
      if (res.ok) {
        const data = await res.json();
        setAllStaff((data.staff || []).filter((s: { is_active: boolean }) => s.is_active));
        setOpen(true);
      }
    } catch { /* empty */ }
  };

  const available = allStaff.filter(s => !existingStaff.includes(s.name));

  return (
    <div className="relative">
      <button onClick={loadStaff} className="flex items-center gap-1 text-[10px] font-medium text-brand-wood/40 hover:text-brand-gold transition-colors cursor-pointer">
        <Plus size={12} /> Add staff
      </button>
      {open && available.length > 0 && (
        <div className="absolute top-6 left-0 z-30 bg-white border border-brand-wood/20 rounded-lg shadow-lg py-1 min-w-[140px]">
          {available.map(s => (
            <button key={s.name} onClick={() => { onAdd(s.name); setOpen(false); }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-brand-cream/50 transition-colors cursor-pointer flex items-center gap-2">
              <span className="font-medium text-brand-black">{s.name}</span>
              <span className="text-[10px] text-brand-wood/50">{s.role}</span>
            </button>
          ))}
        </div>
      )}
      {open && available.length === 0 && allStaff.length > 0 && (
        <div className="absolute top-6 left-0 z-30 bg-white border border-brand-wood/20 rounded-lg shadow-lg py-2 px-3 text-xs text-brand-wood/50 min-w-[140px]">
          All staff already assigned
        </div>
      )}
    </div>
  );
}

const STAFF_COLORS: Record<string, { bg: string; border: string; bar: string; text: string }> = {
  'Biliana': { bg: 'bg-brand-gold/10', border: 'border-brand-gold/30', bar: 'bg-brand-gold', text: 'text-brand-gold' },
  'Nichelle': { bg: 'bg-brand-teal/10', border: 'border-brand-teal/30', bar: 'bg-brand-teal', text: 'text-brand-teal' },
};
const DEFAULT_COLOR = { bg: 'bg-brand-wood/10', border: 'border-brand-wood/30', bar: 'bg-brand-wood', text: 'text-brand-wood' };

export default function SchedulesPage() {
  const headerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const [scheduleDate, setScheduleDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - d.getDay() + 1); // Next Monday
    return d.toISOString().split('T')[0];
  });
  // Always bi-weekly: auto-calculate end date as 13 days after start
  const scheduleDateEnd = (() => {
    const d = new Date(scheduleDate);
    d.setDate(d.getDate() + 13);
    return d.toISOString().split('T')[0];
  })();
  const [generating, setGenerating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [scheduleData, setScheduleData] = useState<ScheduleData | null>(null);
  const [emailing, setEmailing] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailAddress, setEmailAddress] = useState('');
  const [error, setError] = useState('');

  // Load saved schedule on mount
  useEffect(() => {
    async function loadSaved() {
      try {
        const res = await fetch(`/api/schedules/latest?startDate=${scheduleDate}&endDate=${scheduleDateEnd}`);
        if (res.ok) {
          const data = await res.json();
          if (data.exists) {
            setScheduleData(data);
          }
        }
      } catch { /* no saved schedule */ }
      finally { setLoading(false); }
    }
    loadSaved();
  }, [scheduleDate, scheduleDateEnd]);

  const animatedRef = useRef(false);
  const resultAnimatedRef = useRef(false);
  useEffect(() => {
    if (animatedRef.current) return;
    animatedRef.current = true;
    anime({ targets: headerRef.current, translateY: [-20, 0], opacity: [0, 1], easing: 'easeOutExpo', duration: 800 });
    if (contentRef.current) {
      anime({
        targets: contentRef.current.querySelectorAll('.anime-section'),
        translateY: [30, 0], opacity: [0, 1],
        delay: anime.stagger(150, { start: 400 }),
        easing: 'easeOutExpo', duration: 800,
      });
    }
  }, []);

  // Animate result sections once when schedule data first arrives
  useEffect(() => {
    if (resultAnimatedRef.current || !scheduleData || !contentRef.current) return;
    resultAnimatedRef.current = true;
    const sections = contentRef.current.querySelectorAll('.anime-result');
    if (sections.length > 0) {
      anime({
        targets: sections,
        translateY: [20, 0], opacity: [0, 1],
        delay: anime.stagger(100),
        easing: 'easeOutExpo', duration: 600,
      });
    }
  }, [scheduleData]);

  const clearSchedule = async () => {
    if (!confirm('Clear this schedule? You can regenerate it anytime.')) return;
    try {
      const res = await fetch('/api/schedules/clear', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startDate: scheduleDate, endDate: scheduleDateEnd }),
      });
      if (!res.ok) {
        console.error('[schedules] clear failed:', res.status);
        setError('Failed to clear schedule.');
        setTimeout(() => setError(''), 5000);
        return;
      }
      setScheduleData(null);
    } catch (e) {
      console.error('[schedules] clear network error:', e);
      setError('Network error clearing schedule.');
      setTimeout(() => setError(''), 5000);
    }
  };

  // Handle drag-edit of a shift bar
  const handleShiftUpdate = async (date: string, staffName: string, newStart: string, newEnd: string) => {
    if (!scheduleData?.schedules) return;

    // Snapshot previous state for rollback
    const previousSchedules = scheduleData.schedules;
    const previousStaffHours = scheduleData.staffHours;

    const [h1, m1] = newStart.split(':').map(Number);
    const [h2, m2] = newEnd.split(':').map(Number);
    const newHours = Math.round(((h2 * 60 + m2) - (h1 * 60 + m1)) / 60 * 10) / 10;

    // Update local state
    const updatedSchedules = scheduleData.schedules.map(day => {
      if (day.date !== date) return day;
      return {
        ...day,
        shifts: day.shifts.map(s => {
          if (s.staffName !== staffName) return s;
          return { ...s, start: newStart, end: newEnd, hours: newHours };
        }),
      };
    });

    // Recalculate staff hours
    const newStaffHours: Record<string, { totalHours: number; daysWorked: number }> = {};
    for (const day of updatedSchedules) {
      for (const shift of day.shifts) {
        if (!newStaffHours[shift.staffName]) newStaffHours[shift.staffName] = { totalHours: 0, daysWorked: 0 };
        newStaffHours[shift.staffName].totalHours += shift.hours;
        newStaffHours[shift.staffName].daysWorked += 1;
      }
    }
    for (const name of Object.keys(newStaffHours)) {
      newStaffHours[name].totalHours = Math.round(newStaffHours[name].totalHours * 10) / 10;
    }

    const totalWeeks = Math.ceil(updatedSchedules.length / 7);
    const nichelleTarget = totalWeeks * 40;

    setScheduleData({
      ...scheduleData,
      schedules: updatedSchedules,
      staffHours: newStaffHours,
      nichelleTarget,
      nichelleOnTarget: Math.abs((newStaffHours['Nichelle']?.totalHours || 0) - nichelleTarget) <= 2,
    });

    // Save to database via the server-side route (the service-role Supabase
    // client is server-only — the browser can't talk to it directly).
    try {
      const res = await fetch('/api/schedules/shift', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, staffName, start: newStart, end: newEnd }),
      });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          const data = await res.json();
          if (data?.error) msg = data.error;
        } catch { /* non-JSON */ }
        throw new Error(msg);
      }
    } catch (e) {
      console.error('Failed to save shift update:', e);
      // Roll back optimistic update
      setScheduleData({
        ...scheduleData,
        schedules: previousSchedules,
        staffHours: previousStaffHours,
      });
      setError('Failed to save shift change. Your edit was reverted.');
      setTimeout(() => setError(''), 5000);
    }
  };

  // Add a staff member to a specific day
  const handleAddStaffToDay = async (date: string, staffName: string) => {
    if (!scheduleData?.schedules) return;

    const defaultStart = '10:00';
    const defaultEnd = '15:00';
    const defaultHours = 5;

    // Update local state
    const updatedSchedules = scheduleData.schedules.map(day => {
      if (day.date !== date) return day;
      return {
        ...day,
        shifts: [...day.shifts, { staffName, start: defaultStart, end: defaultEnd, hours: defaultHours, coversPeaks: [] as string[] }],
      };
    });

    const previousSchedules = scheduleData.schedules;
    setScheduleData({ ...scheduleData, schedules: updatedSchedules });

    // Save to database via server route
    try {
      const res = await fetch('/api/schedules/shift', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date, staffName,
          start: defaultStart,
          end: defaultEnd,
        }),
      });
      if (!res.ok) {
        console.error('[schedules] add shift failed:', res.status);
        // Roll back so the UI matches the DB
        setScheduleData({ ...scheduleData, schedules: previousSchedules });
        setError('Failed to add shift. Your change was reverted.');
        setTimeout(() => setError(''), 5000);
      }
    } catch (e) {
      console.error('[schedules] add shift network error:', e);
      setScheduleData({ ...scheduleData, schedules: previousSchedules });
      setError('Network error adding shift. Your change was reverted.');
      setTimeout(() => setError(''), 5000);
    }
  };

  // Remove a staff member from a specific day
  const handleRemoveShift = async (date: string, staffName: string) => {
    if (!scheduleData?.schedules) return;

    const previousSchedules = scheduleData.schedules;
    const updatedSchedules = scheduleData.schedules.map(day => {
      if (day.date !== date) return day;
      return {
        ...day,
        shifts: day.shifts.filter(s => s.staffName !== staffName),
      };
    });

    setScheduleData({ ...scheduleData, schedules: updatedSchedules });

    // Remove from database via server route
    try {
      const res = await fetch('/api/schedules/shift', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, staffName }),
      });
      if (!res.ok) {
        console.error('[schedules] remove shift failed:', res.status);
        setScheduleData({ ...scheduleData, schedules: previousSchedules });
        setError('Failed to remove shift. Your change was reverted.');
        setTimeout(() => setError(''), 5000);
      }
    } catch (e) {
      console.error('[schedules] remove shift network error:', e);
      setScheduleData({ ...scheduleData, schedules: previousSchedules });
      setError('Network error removing shift. Your change was reverted.');
      setTimeout(() => setError(''), 5000);
    }
  };

  const generateSchedule = async () => {
    setGenerating(true);
    setError('');
    setScheduleData(null);

    try {
      const res = await fetch('/api/schedules/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheduleDate,
          scheduleDateEnd,
          staff: [
            { name: 'Biliana', availableStart: '09:00', availableEnd: '20:00', maxHours: 8 },
            { name: 'Nichelle', availableStart: '09:00', availableEnd: '20:00', maxHours: 8 },
          ],
        }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setScheduleData(data);
        // Animate results in
        setTimeout(() => {
          if (contentRef.current) {
            anime({
              targets: contentRef.current.querySelectorAll('.anime-result'),
              translateY: [20, 0], opacity: [0, 1],
              delay: anime.stagger(100),
              easing: 'easeOutExpo', duration: 600,
            });
          }
        }, 100);
      }
    } catch {
      setError('Failed to generate schedule. Please try again.');
    } finally {
      setGenerating(false);
    }
  };

  const sendEmail = async () => {
    if (!emailAddress || !scheduleData) return;
    setEmailing(true);
    setEmailSent(false);
    setEmailError(null);

    try {
      const res = await fetch('/api/schedules/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startDate: scheduleDate, endDate: scheduleDateEnd, recipientEmail: emailAddress }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setEmailSent(true);
        setTimeout(() => setEmailSent(false), 5000);
      } else {
        setEmailError(data.error || `Failed to send email (${res.status})`);
      }
    } catch (e) {
      setEmailError((e as Error).message || 'Network error — check your connection');
    } finally {
      setEmailing(false);
    }
  };

  const minutesToTime = (mins: number) => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };

  const timeToMinutes = (timeStr: string) => {
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
  };

  // Convert time string to percentage position on 9am-8pm timeline (11 hours)
  const timeToPercent = (timeStr: string) => {
    const [h, m] = timeStr.split(':').map(Number);
    const mins = h * 60 + m;
    const startMins = 9 * 60; // 9am
    const endMins = 20 * 60; // 8pm
    return Math.max(0, Math.min(100, ((mins - startMins) / (endMins - startMins)) * 100));
  };

  return (
    <div className="px-6 md:px-10 lg:px-14">
      {/* Header */}
      <div ref={headerRef} className="opacity-0 flex flex-col sm:flex-row sm:items-end justify-between pt-10 md:pt-14 pb-8 md:pb-12 gap-6">
        <div className="flex flex-col gap-1">
          <h2 className="font-serif text-[32px] md:text-[40px] leading-tight text-brand-black tracking-tight">Staff Scheduling</h2>
          <p className="text-sm font-medium text-brand-wood/80">AI-optimized shifts based on flight demand</p>
        </div>
      </div>

      <div ref={contentRef} className="flex flex-col gap-8 lg:gap-10 max-w-[1600px] mx-auto pb-10">

        {/* Staff Settings */}
        <div className="anime-section opacity-0">
          <StaffSettings />
        </div>

        {/* Generate Controls */}
        <div className="anime-section opacity-0 flex flex-col sm:flex-row items-start sm:items-center gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <CalendarBlank size={18} className="text-brand-wood/60" />
            <label className="text-sm text-brand-wood/70">Starting:</label>
            <input type="date" value={scheduleDate} onChange={e => setScheduleDate(e.target.value)}
              className="text-sm border border-brand-wood/20 rounded-lg px-3 py-2.5 bg-white focus:outline-none focus:border-brand-gold" />
          </div>
          <p className="text-xs text-brand-wood/50">
            Bi-weekly: {new Date(scheduleDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – {new Date(scheduleDateEnd + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} &middot; Store hours: 9 AM – 8 PM
          </p>
          <button onClick={generateSchedule} disabled={generating}
            className="flex items-center gap-2.5 px-6 py-3 bg-brand-gold text-white rounded-xl font-medium text-sm shadow-md cursor-pointer transition-colors hover:bg-brand-gold/90 disabled:opacity-50">
            {generating ? <CircleNotch size={18} className="animate-spin" /> : <Users size={18} />}
            {generating ? 'Generating...' : scheduleData ? 'Regenerate Schedule' : 'Generate Optimal Schedule'}
          </button>
          {scheduleData && (
            <button onClick={clearSchedule}
              className="flex items-center gap-2 px-5 py-3 bg-white border border-brand-wood/20 text-brand-wood/70 rounded-xl font-medium text-sm cursor-pointer transition-colors hover:border-red-300 hover:text-red-500">
              <Trash size={16} /> Clear Schedule
            </button>
          )}
        </div>

        {error && (
          <div className="p-4 rounded-xl border bg-amber-50 border-amber-200 flex items-center gap-3">
            <WarningCircle size={20} className="text-amber-600" />
            <span className="text-sm text-amber-700">{error}</span>
          </div>
        )}

        {/* Schedule Results */}
        {scheduleData && (() => {
          // Normalize: single-day has .schedule, multi-day has .schedules
          const isMultiDay = !!scheduleData.schedules;
          const allDays: DaySchedule[] = isMultiDay
            ? scheduleData.schedules!
            : scheduleData.schedule
              ? [{ date: scheduleData.scheduleDate, shifts: scheduleData.schedule, coverageScore: scheduleData.coverageScore || 0 }]
              : [];
          const avgCoverage = isMultiDay
            ? scheduleData.averageCoverage || 0
            : scheduleData.coverageScore || 0;

          return (
          <>
            {/* Coverage Metrics */}
            <div className="anime-result opacity-0 grid grid-cols-1 sm:grid-cols-3 gap-4 md:gap-6">
              <div className="bg-white rounded-[20px] p-6 border border-brand-wood/15 shadow-[0_12px_40px_-12px_rgba(15,23,42,0.06)] flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-brand-gold/10 flex items-center justify-center">
                  <ShieldCheck size={24} className="text-brand-gold" />
                </div>
                <div>
                  <p className="text-[11px] font-medium text-brand-wood/70 uppercase tracking-wide">{isMultiDay ? 'Avg Coverage' : 'Coverage'}</p>
                  <h3 className="font-serif text-3xl text-brand-black">{avgCoverage}%</h3>
                </div>
              </div>
              <div className="bg-white rounded-[20px] p-6 border border-brand-wood/15 shadow-[0_12px_40px_-12px_rgba(15,23,42,0.06)] flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-brand-teal/10 flex items-center justify-center">
                  <Clock size={24} className="text-brand-teal" />
                </div>
                <div>
                  <p className="text-[11px] font-medium text-brand-wood/70 uppercase tracking-wide">{isMultiDay ? 'Days Scheduled' : 'Total Hours'}</p>
                  <h3 className="font-serif text-3xl text-brand-black">{isMultiDay ? allDays.length : (scheduleData.totalHours || 0) + 'h'}</h3>
                </div>
              </div>
              <div className="bg-white rounded-[20px] p-6 border border-brand-wood/15 shadow-[0_12px_40px_-12px_rgba(15,23,42,0.06)] flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-brand-black/5 flex items-center justify-center">
                  <Users size={24} className="text-brand-black/80" />
                </div>
                <div>
                  <p className="text-[11px] font-medium text-brand-wood/70 uppercase tracking-wide">Nichelle / Biliana</p>
                  <h3 className="font-serif text-3xl text-brand-black">{scheduleData.nichelleDays || (allDays.length - (scheduleData.bilianaDays || 0))}d / {scheduleData.bilianaDays || 0}d</h3>
                </div>
              </div>
            </div>

            {/* Visual Timelines — one per day */}
            {allDays.map((day) => (
            <div key={day.date} className="anime-result opacity-0 flex flex-col gap-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-3">
                  <h3 className="font-serif text-lg text-brand-black tracking-tight">
                    {new Date(day.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                  </h3>
                  {day.dayOff && (
                    <span className="text-[10px] font-medium text-brand-wood/50 bg-brand-wood/5 px-2 py-0.5 rounded-full">
                      {day.dayOff} off
                    </span>
                  )}
                </div>
                <span className="text-xs font-medium text-brand-wood/60">
                  {day.flightCount ? `${day.flightCount} flights · ` : ''}Coverage: {day.coverageScore}%
                </span>
              </div>
              <div className="bg-white rounded-[16px] border border-brand-wood/15 p-5 shadow-[0_12px_40px_-12px_rgba(15,23,42,0.06)]">
                <div className="flex justify-between text-[10px] font-medium text-brand-wood/40 mb-3 ml-[120px]">
                  {['9am', '11am', '1pm', '3pm', '5pm', '8pm'].map(t => (
                    <span key={t}>{t}</span>
                  ))}
                </div>
                <div className="flex flex-col gap-2 border-t border-brand-wood/10 pt-3">
                  {/* Draggable staff shift bars */}
                  {day.shifts.map((shift, i) => {
                    const color = STAFF_COLORS[shift.staffName] || DEFAULT_COLOR;
                    return (
                      <div key={i} className="flex items-center group/shift">
                        <div className="w-[120px] flex items-center gap-1 shrink-0 pr-2">
                          <button
                            onClick={() => handleRemoveShift(day.date, shift.staffName)}
                            className="w-4 h-4 rounded-full flex items-center justify-center text-brand-wood/20 hover:text-red-500 hover:bg-red-50 transition-colors cursor-pointer opacity-0 group-hover/shift:opacity-100"
                            title="Remove from this day"
                          >
                            <X size={10} weight="bold" />
                          </button>
                          <div className={`w-6 h-6 rounded-full ${color.bg} flex items-center justify-center text-[8px] font-bold ${color.text}`}>
                            {shift.staffName.split(' ').map(n => n[0]).join('')}
                          </div>
                          <span className="text-[12px] font-semibold text-brand-black tracking-tight truncate">{shift.staffName}</span>
                        </div>
                        <DraggableShift
                          staffName={shift.staffName}
                          start={shift.start}
                          end={shift.end}
                          color={color}
                          timeToPercent={timeToPercent}
                          onUpdate={(newStart, newEnd) => handleShiftUpdate(day.date, shift.staffName, newStart, newEnd)}
                        />
                      </div>
                    );
                  })}

                  {/* Add staff to this day */}
                  <div className="flex items-center mt-1">
                    <div className="w-[120px] shrink-0 pr-2">
                      <AddStaffToDay
                        date={day.date}
                        existingStaff={day.shifts.map(s => s.staffName)}
                        onAdd={(staffName) => handleAddStaffToDay(day.date, staffName)}
                      />
                    </div>
                    <div className="flex-1" />
                  </div>

                  {/* Departure flight markers — shown at departure time minus 30 min (shopping window) */}
                  {day.flights && day.flights.filter(f => f.flight_type === 'departure').length > 0 && (
                    <div className="flex items-center mt-1">
                      <div className="w-[120px] flex items-center gap-2 shrink-0 pr-4">
                        <span className="text-[10px] font-medium text-brand-wood/50 uppercase tracking-wide">Departures</span>
                      </div>
                      <div className="flex-1 relative h-8">
                        {day.flights.filter(f => f.flight_type === 'departure').map((flight, fi) => {
                          const flightTime = flight.scheduled_time.substring(11, 16);
                          const [fh, fm] = flightTime.split(':').map(Number);
                          const flightMins = fh * 60 + fm;
                          const shopWindowStart = flightMins - 30; // 30 min before departure
                          const pos = timeToPercent(minutesToTime(shopWindowStart));
                          const isWithinStore = pos > 0 && pos < 100;

                          if (!isWithinStore) return null;

                          // Is this departure's shopping window covered by staff?
                          const isCovered = day.shifts.some(s => {
                            const sStart = timeToMinutes(s.start);
                            const sEnd = timeToMinutes(s.end);
                            return shopWindowStart >= sStart && shopWindowStart < sEnd;
                          });

                          return (
                            <div
                              key={fi}
                              className="absolute top-0 flex flex-col items-center group cursor-default"
                              style={{ left: `${pos}%`, transform: 'translateX(-50%)' }}
                            >
                              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[8px] border font-bold ${
                                isCovered
                                  ? 'bg-brand-gold/20 border-brand-gold/40 text-brand-gold'
                                  : 'bg-red-100 border-red-300 text-red-500'
                              }`}>
                                <AirplaneTakeoff size={11} weight="bold" />
                              </div>
                              {/* Tooltip */}
                              <div className="hidden group-hover:block absolute top-7 bg-brand-black text-white text-[9px] px-2.5 py-1.5 rounded-lg shadow-lg whitespace-nowrap z-30 leading-relaxed">
                                <span className="font-bold">{flight.flight_num}</span> departs {formatTime12(flightTime)}<br/>
                                Shop window: {formatTime12(minutesToTime(shopWindowStart))}<br/>
                                ~{flight.estimated_passengers} passengers
                                {!isCovered && <><br/><span className="text-red-300 font-bold">NOT COVERED</span></>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
            ))}

            {/* AI Briefing */}
            {scheduleData.briefing && (
              <div className="anime-result opacity-0 bg-gradient-to-br from-white to-brand-gold/[0.02] rounded-[20px] border border-brand-wood/15 border-l-[3px] border-l-brand-gold p-6 lg:p-8 shadow-[0_12px_40px_-12px_rgba(15,23,42,0.06)]">
                <h4 className="font-serif text-lg text-brand-black tracking-tight mb-3">AI Staff Briefing</h4>
                <div className="text-sm leading-relaxed text-brand-black/80 whitespace-pre-wrap">{scheduleData.briefing}</div>
              </div>
            )}

            {/* Staff Hours Summary */}
            {scheduleData.staffHours && (
              <div className="anime-result opacity-0 flex flex-col gap-4">
                <h3 className="font-serif text-[22px] text-brand-black tracking-tight">Staff Hours Summary</h3>
                <div className="bg-white rounded-[20px] border border-brand-wood/15 p-6 lg:p-8 shadow-[0_12px_40px_-12px_rgba(15,23,42,0.06)]">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    {Object.entries(scheduleData.staffHours).map(([name, data]) => {
                      const color = STAFF_COLORS[name] || DEFAULT_COLOR;
                      const isNichelle = name === 'Nichelle';
                      const target = isNichelle ? (scheduleData.nichelleTarget || 40) : null;
                      const onTarget = isNichelle ? scheduleData.nichelleOnTarget : true;

                      return (
                        <div key={name} className={`flex items-center gap-4 p-4 rounded-xl border ${color.border} ${color.bg}`}>
                          <div className={`w-12 h-12 rounded-full ${color.bg} border ${color.border} flex items-center justify-center font-serif font-bold text-lg ${color.text}`}>
                            {name[0]}
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-brand-black">{name}</span>
                              {isNichelle && (
                                <span className="text-[10px] font-medium text-brand-wood/50 bg-brand-wood/5 px-1.5 py-0.5 rounded">Full-time</span>
                              )}
                              {!isNichelle && name === 'Biliana' && (
                                <span className="text-[10px] font-medium text-brand-wood/50 bg-brand-wood/5 px-1.5 py-0.5 rounded">Part-time</span>
                              )}
                            </div>
                            <div className="flex items-baseline gap-3 mt-1">
                              <span className="font-serif text-2xl text-brand-black">{data.totalHours}h</span>
                              <span className="text-xs text-brand-wood/60">{data.daysWorked} days</span>
                              {target && (
                                <span className={`text-xs font-medium ${onTarget ? 'text-green-600' : 'text-red-500'}`}>
                                  {onTarget ? `Target: ${target}h` : `Target: ${target}h (${data.totalHours < target ? '-' : '+'}${Math.abs(data.totalHours - target).toFixed(1)}h)`}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Weekly breakdown */}
                  {scheduleData.nichelleTarget && scheduleData.nichelleTarget > 40 && (
                    <div className="mt-4 pt-4 border-t border-brand-wood/10 text-xs text-brand-wood/60">
                      <p>Bi-weekly target: Nichelle {scheduleData.nichelleTarget}h ({scheduleData.nichelleTarget / 2}h/week)</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Export & Email */}
            <div className="anime-result opacity-0 flex flex-col gap-4 bg-white rounded-[20px] border border-brand-wood/15 p-6 shadow-[0_12px_40px_-12px_rgba(15,23,42,0.06)]">
              {/* Download Excel */}
              <div className="flex items-center gap-4">
                <a href={`/api/schedules/export?startDate=${scheduleDate}&endDate=${scheduleDateEnd}`}
                  className="flex items-center gap-2 px-5 py-2.5 bg-brand-black text-white rounded-xl font-medium text-sm shadow-md cursor-pointer transition-colors hover:bg-brand-black/80">
                  <FileArrowDown size={16} /> Download Excel
                </a>
                <span className="text-xs text-brand-wood/50">Editable .xlsx file matching your bi-weekly format</span>
              </div>

              {/* Email */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 pt-4 border-t border-brand-wood/10">
                <Envelope size={20} className="text-brand-wood/60 shrink-0" />
                <input
                  type="email"
                  value={emailAddress}
                  onChange={e => setEmailAddress(e.target.value)}
                  placeholder="manager@example.com"
                  className="flex-1 text-sm border border-brand-wood/20 rounded-lg px-3 py-2.5 bg-white focus:outline-none focus:border-brand-gold w-full sm:w-auto"
                />
                <button onClick={sendEmail} disabled={emailing || !emailAddress}
                  className="flex items-center gap-2 px-5 py-2.5 bg-brand-gold text-white rounded-xl font-medium text-sm shadow-md cursor-pointer transition-colors hover:bg-brand-gold/90 disabled:opacity-50">
                  {emailing ? <CircleNotch size={16} className="animate-spin" /> : <Envelope size={16} />}
                  {emailing ? 'Sending...' : 'Email Schedule'}
                </button>
                {emailSent && (
                  <span className="flex items-center gap-1 text-green-600 text-sm font-medium">
                    <CheckCircle size={16} /> Sent!
                  </span>
                )}
                {emailError && (
                  <span className="text-red-600 text-xs font-medium max-w-xs">
                    {emailError}
                  </span>
                )}
              </div>
            </div>
          </>
          );
        })()}

        {/* Empty state */}
        {!scheduleData && !generating && !loading && (
          <div className="anime-section opacity-0 bg-white rounded-[20px] border border-brand-wood/15 p-12 shadow-[0_12px_40px_-12px_rgba(15,23,42,0.06)] flex flex-col items-center text-center gap-4">
            <Users size={48} className="text-brand-wood/30" />
            <p className="text-brand-wood/60 text-sm max-w-md">
              Select a date and click &quot;Generate Optimal Schedule&quot; to create an AI-optimized staff schedule based on flight demand data.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
