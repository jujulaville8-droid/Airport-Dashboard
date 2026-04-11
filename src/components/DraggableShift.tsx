'use client';

import { useRef, useCallback, useState } from 'react';

interface DraggableShiftProps {
  staffName: string;
  start: string; // "HH:MM"
  end: string;
  color: { bg: string; border: string; bar: string; text: string };
  timeToPercent: (time: string) => number;
  onUpdate: (newStart: string, newEnd: string) => void;
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// Snap to 30-min intervals
function snapTo30(mins: number): number {
  return Math.round(mins / 30) * 30;
}

const STORE_OPEN = 540;  // 9:00
const STORE_CLOSE = 1200; // 20:00
const MIN_SHIFT = 300;    // 5 hours minimum
const MAX_SHIFT = 480;    // 8 hours maximum

export default function DraggableShift({ start, end, color, timeToPercent, onUpdate }: DraggableShiftProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<'start' | 'end' | 'move' | null>(null);
  const [tempStart, setTempStart] = useState(start);
  const [tempEnd, setTempEnd] = useState(end);
  // Refs capture the latest temp values for the mouseup handler (state isn't guaranteed to be flushed)
  const latestStart = useRef(start);
  const latestEnd = useRef(end);

  const displayStart = dragging ? tempStart : start;
  const displayEnd = dragging ? tempEnd : end;
  const left = timeToPercent(displayStart);
  const right = timeToPercent(displayEnd);
  const width = right - left;
  const hours = Math.round((timeToMinutes(displayEnd) - timeToMinutes(displayStart)) / 60 * 10) / 10;

  const getMinutesFromMouseX = useCallback((clientX: number): number => {
    if (!containerRef.current) return 0;
    const rect = containerRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const totalMins = STORE_CLOSE - STORE_OPEN;
    return STORE_OPEN + pct * totalMins;
  }, []);

  const handleMouseDown = useCallback((edge: 'start' | 'end' | 'move') => (e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(edge);
    const startMins = timeToMinutes(start);
    const endMins = timeToMinutes(end);
    const initialOffset = getMinutesFromMouseX(e.clientX);
    latestStart.current = start;
    latestEnd.current = end;

    const commit = (s: string, ePrime: string) => {
      latestStart.current = s;
      latestEnd.current = ePrime;
      setTempStart(s);
      setTempEnd(ePrime);
    };

    const handleMove = (moveE: MouseEvent) => {
      const currentMins = getMinutesFromMouseX(moveE.clientX);

      if (edge === 'start') {
        let newStart = snapTo30(currentMins);
        newStart = Math.max(STORE_OPEN, newStart);
        newStart = Math.min(endMins - MIN_SHIFT, newStart);
        if (endMins - newStart > MAX_SHIFT) newStart = endMins - MAX_SHIFT;
        commit(minutesToTime(newStart), end);
      } else if (edge === 'end') {
        let newEnd = snapTo30(currentMins);
        newEnd = Math.min(STORE_CLOSE, newEnd);
        newEnd = Math.max(startMins + MIN_SHIFT, newEnd);
        if (newEnd - startMins > MAX_SHIFT) newEnd = startMins + MAX_SHIFT;
        commit(start, minutesToTime(newEnd));
      } else {
        // Move entire bar
        const delta = currentMins - initialOffset;
        const shiftLen = endMins - startMins;
        let newStart = snapTo30(startMins + delta);
        newStart = Math.max(STORE_OPEN, newStart);
        newStart = Math.min(STORE_CLOSE - shiftLen, newStart);
        const newEnd = newStart + shiftLen;
        commit(minutesToTime(newStart), minutesToTime(newEnd));
      }
    };

    const handleUp = () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
      setDragging(null);
      const finalStart = latestStart.current;
      const finalEnd = latestEnd.current;
      if (finalStart !== start || finalEnd !== end) {
        onUpdate(finalStart, finalEnd);
      }
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  }, [start, end, getMinutesFromMouseX, onUpdate]);

  return (
    <div ref={containerRef} className="flex-1 relative h-10">
      <div
        ref={barRef}
        data-temp-start={displayStart}
        data-temp-end={displayEnd}
        className={`absolute top-0 bottom-0 ${color.bg} border ${color.border} rounded-md flex items-center text-[11px] font-medium text-brand-black overflow-hidden ${
          dragging ? 'shadow-lg z-10' : ''
        }`}
        style={{ left: `${left}%`, width: `${Math.max(width, 5)}%`, cursor: dragging === 'move' ? 'grabbing' : 'grab' }}
      >
        {/* Left drag handle */}
        <div
          onMouseDown={handleMouseDown('start')}
          className={`absolute left-0 top-0 bottom-0 w-3 cursor-ew-resize z-10 flex items-center justify-center ${color.bar} rounded-l-md opacity-60 hover:opacity-100 transition-opacity`}
        >
          <div className="w-0.5 h-4 bg-white/60 rounded" />
        </div>

        {/* Middle — drag to move entire bar */}
        <div
          onMouseDown={handleMouseDown('move')}
          className="flex-1 px-4 cursor-grab active:cursor-grabbing select-none"
        >
          <span className="ml-2">{displayStart}–{displayEnd} ({hours}h)</span>
        </div>

        {/* Right drag handle */}
        <div
          onMouseDown={handleMouseDown('end')}
          className={`absolute right-0 top-0 bottom-0 w-3 cursor-ew-resize z-10 flex items-center justify-center ${color.bar} rounded-r-md opacity-60 hover:opacity-100 transition-opacity`}
        >
          <div className="w-0.5 h-4 bg-white/60 rounded" />
        </div>
      </div>
    </div>
  );
}
