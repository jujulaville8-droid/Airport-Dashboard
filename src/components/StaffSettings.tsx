'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  UserPlus,
  Trash,
  PencilSimple,
  Check,
  X,
  CaretDown,
  CaretUp,
  GearSix,
} from '@phosphor-icons/react';
import { formatTime12 } from '@/lib/date-utils';

interface StaffMember {
  id: number;
  name: string;
  full_name: string;
  role: 'full-time' | 'part-time' | 'backup';
  max_hours_per_day: number;
  min_hours_per_day: number;
  weekly_hour_target: number | null;
  days_off_per_week: number | null;
  available_start: string;
  available_end: string;
  is_active: boolean;
}

const ROLE_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  'full-time': { label: 'Full-time', color: 'text-green-700', bg: 'bg-green-50 border-green-200' },
  'part-time': { label: 'Part-time', color: 'text-brand-gold', bg: 'bg-brand-gold/5 border-brand-gold/20' },
  'backup': { label: 'Backup', color: 'text-brand-wood/70', bg: 'bg-brand-wood/5 border-brand-wood/20' },
};

export default function StaffSettings() {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);

  const [editForm, setEditForm] = useState<Partial<StaffMember>>({});
  const [error, setError] = useState<string | null>(null);
  const [newForm, setNewForm] = useState({
    name: '', full_name: '', role: 'part-time' as string,
    max_hours_per_day: 8, min_hours_per_day: 5,
    weekly_hour_target: '', days_off_per_week: '',
    available_start: '09:00', available_end: '20:00',
  });

  // Read an error message out of a non-ok response without letting JSON parse failures crash us.
  const readError = async (res: Response, fallback: string): Promise<string> => {
    try {
      const data = await res.json();
      if (data?.error && typeof data.error === 'string') return data.error;
    } catch { /* non-JSON body */ }
    return `${fallback} (HTTP ${res.status})`;
  };

  const fetchStaff = useCallback(async () => {
    try {
      const res = await fetch('/api/staff');
      if (!res.ok) {
        console.error('[staff] fetch failed:', res.status);
        setError(await readError(res, 'Failed to load staff'));
        return;
      }
      const data = await res.json();
      setStaff(data.staff || []);
      setError(null);
    } catch (e) {
      console.error('[staff] fetch network error:', e);
      setError('Network error loading staff');
    }
  }, []);

  useEffect(() => { fetchStaff(); }, [fetchStaff]);

  const handleEdit = (s: StaffMember) => {
    setEditing(s.id);
    setEditForm({ ...s });
  };

  const handleSaveEdit = async () => {
    if (!editing || !editForm) return;
    setSaving(true);
    try {
      const res = await fetch('/api/staff', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editing, ...editForm }),
      });
      if (!res.ok) {
        console.error('[staff] save edit failed:', res.status);
        setError(await readError(res, 'Failed to save changes'));
        return;
      }
      await fetchStaff();
      setEditing(null);
    } catch (e) {
      console.error('[staff] save edit network error:', e);
      setError('Network error saving changes');
    } finally {
      setSaving(false);
    }
  };

  const handleAdd = async () => {
    if (!newForm.name || !newForm.full_name) return;
    setSaving(true);
    try {
      const res = await fetch('/api/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...newForm,
          weekly_hour_target: newForm.weekly_hour_target ? Number(newForm.weekly_hour_target) : null,
          days_off_per_week: newForm.days_off_per_week ? Number(newForm.days_off_per_week) : null,
        }),
      });
      if (!res.ok) {
        console.error('[staff] add failed:', res.status);
        setError(await readError(res, 'Failed to add staff member'));
        return;
      }
      await fetchStaff();
      setAdding(false);
      setNewForm({ name: '', full_name: '', role: 'part-time', max_hours_per_day: 8, min_hours_per_day: 5, weekly_hour_target: '', days_off_per_week: '', available_start: '09:00', available_end: '20:00' });
    } catch (e) {
      console.error('[staff] add network error:', e);
      setError('Network error adding staff member');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`Remove ${name} from staff? This cannot be undone.`)) return;
    try {
      const res = await fetch('/api/staff', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        console.error('[staff] delete failed:', res.status);
        setError(await readError(res, `Failed to remove ${name}`));
        return;
      }
      await fetchStaff();
    } catch (e) {
      console.error('[staff] delete network error:', e);
      setError(`Network error removing ${name}`);
    }
  };

  const handleToggleActive = async (s: StaffMember) => {
    try {
      const res = await fetch('/api/staff', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: s.id, is_active: !s.is_active }),
      });
      if (!res.ok) {
        console.error('[staff] toggle active failed:', res.status);
        setError(await readError(res, `Failed to ${s.is_active ? 'deactivate' : 'activate'} ${s.name}`));
        return;
      }
      await fetchStaff();
    } catch (e) {
      console.error('[staff] toggle active network error:', e);
      setError(`Network error updating ${s.name}`);
    }
  };

  const inputCls = "text-sm border border-brand-wood/20 rounded-lg px-3 py-2 bg-white focus:outline-none focus:border-brand-gold w-full";

  return (
    <div className="bg-white rounded-[20px] border border-brand-wood/15 shadow-[0_12px_40px_-12px_rgba(15,23,42,0.06)] overflow-hidden">
      {/* Header — click to expand */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-6 py-4 cursor-pointer hover:bg-brand-cream/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          <GearSix size={20} className="text-brand-wood/60" />
          <span className="font-serif text-lg text-brand-black">Staff Settings</span>
          <span className="text-xs text-brand-wood/50">{staff.length} members</span>
        </div>
        {expanded ? <CaretUp size={18} className="text-brand-wood/50" /> : <CaretDown size={18} className="text-brand-wood/50" />}
      </button>

      {expanded && (
        <div className="px-6 pb-6 flex flex-col gap-4 border-t border-brand-wood/10">

          {error && (
            <div className="mt-3 px-4 py-3 rounded-md bg-red-50 border border-red-200 text-sm text-red-800 flex items-center justify-between">
              <span>{error}</span>
              <button
                onClick={() => setError(null)}
                className="text-red-600 hover:text-red-800 font-medium ml-4"
                aria-label="Dismiss error"
              >
                ×
              </button>
            </div>
          )}

          {/* Staff list */}
          {staff.map(s => (
            <div key={s.id} className={`mt-3 p-4 rounded-xl border ${s.is_active ? 'border-brand-wood/15 bg-brand-cream/20' : 'border-brand-wood/10 bg-brand-wood/5 opacity-60'}`}>
              {editing === s.id ? (
                /* Edit mode */
                <div className="flex flex-col gap-3">
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="text-[10px] text-brand-wood/60 uppercase font-medium">Display Name</label>
                      <input value={editForm.name || ''} onChange={e => setEditForm({ ...editForm, name: e.target.value })} className={inputCls} />
                    </div>
                    <div>
                      <label className="text-[10px] text-brand-wood/60 uppercase font-medium">Full Name (export)</label>
                      <input value={editForm.full_name || ''} onChange={e => setEditForm({ ...editForm, full_name: e.target.value })} className={inputCls} />
                    </div>
                    <div>
                      <label className="text-[10px] text-brand-wood/60 uppercase font-medium">Role</label>
                      <select value={editForm.role || 'part-time'} onChange={e => setEditForm({ ...editForm, role: e.target.value as StaffMember['role'] })} className={inputCls}>
                        <option value="full-time">Full-time</option>
                        <option value="part-time">Part-time</option>
                        <option value="backup">Backup</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] text-brand-wood/60 uppercase font-medium">Max Hours/Day</label>
                      <input type="number" value={editForm.max_hours_per_day || 8} onChange={e => setEditForm({ ...editForm, max_hours_per_day: Number(e.target.value) })} className={inputCls} />
                    </div>
                    <div>
                      <label className="text-[10px] text-brand-wood/60 uppercase font-medium">Min Hours/Day</label>
                      <input type="number" value={editForm.min_hours_per_day || 5} onChange={e => setEditForm({ ...editForm, min_hours_per_day: Number(e.target.value) })} className={inputCls} />
                    </div>
                    <div>
                      <label className="text-[10px] text-brand-wood/60 uppercase font-medium">Weekly Target (hrs)</label>
                      <input type="number" value={editForm.weekly_hour_target ?? ''} onChange={e => setEditForm({ ...editForm, weekly_hour_target: e.target.value ? Number(e.target.value) : null })} placeholder="None" className={inputCls} />
                    </div>
                    <div>
                      <label className="text-[10px] text-brand-wood/60 uppercase font-medium">Days Off/Week</label>
                      <input type="number" value={editForm.days_off_per_week ?? ''} onChange={e => setEditForm({ ...editForm, days_off_per_week: e.target.value ? Number(e.target.value) : null })} placeholder="None" className={inputCls} />
                    </div>
                    <div>
                      <label className="text-[10px] text-brand-wood/60 uppercase font-medium">Earliest Start</label>
                      <input type="time" value={editForm.available_start || '09:00'} onChange={e => setEditForm({ ...editForm, available_start: e.target.value })} className={inputCls} />
                    </div>
                    <div>
                      <label className="text-[10px] text-brand-wood/60 uppercase font-medium">Latest End</label>
                      <input type="time" value={editForm.available_end || '20:00'} onChange={e => setEditForm({ ...editForm, available_end: e.target.value })} className={inputCls} />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={handleSaveEdit} disabled={saving} className="flex items-center gap-1 px-4 py-2 bg-brand-gold text-white rounded-lg text-sm font-medium cursor-pointer disabled:opacity-50">
                      <Check size={14} /> Save
                    </button>
                    <button onClick={() => setEditing(null)} className="flex items-center gap-1 px-4 py-2 bg-white border border-brand-wood/20 rounded-lg text-sm cursor-pointer">
                      <X size={14} /> Cancel
                    </button>
                  </div>
                </div>
              ) : (
                /* View mode */
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full flex items-center justify-center font-serif font-bold text-sm" style={{ backgroundColor: s.role === 'full-time' ? 'rgba(79,70,229,0.12)' : s.role === 'part-time' ? 'rgba(8,145,178,0.12)' : 'rgba(71,85,105,0.08)', color: s.role === 'full-time' ? '#4F46E5' : s.role === 'part-time' ? '#0891B2' : '#475569' }}>
                      {s.name[0]}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-brand-black">{s.name}</span>
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${ROLE_LABELS[s.role].bg} ${ROLE_LABELS[s.role].color}`}>
                          {ROLE_LABELS[s.role].label}
                        </span>
                        {!s.is_active && <span className="text-[10px] font-medium text-red-500 bg-red-50 px-2 py-0.5 rounded-full border border-red-200">Inactive</span>}
                      </div>
                      <div className="text-[11px] text-brand-wood/60 mt-0.5">
                        {formatTime12(s.available_start)}–{formatTime12(s.available_end)} · {s.min_hours_per_day}–{s.max_hours_per_day}h/day
                        {s.weekly_hour_target && ` · ${s.weekly_hour_target}h/week target`}
                        {s.days_off_per_week && ` · ${s.days_off_per_week} days off/week`}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => handleToggleActive(s)} className="text-xs px-3 py-1.5 rounded-lg border border-brand-wood/15 cursor-pointer hover:bg-brand-cream/50 transition-colors">
                      {s.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                    <button onClick={() => handleEdit(s)} className="p-2 rounded-lg hover:bg-brand-cream/50 text-brand-wood/50 hover:text-brand-black transition-colors cursor-pointer">
                      <PencilSimple size={16} />
                    </button>
                    <button onClick={() => handleDelete(s.id, s.name)} className="p-2 rounded-lg hover:bg-red-50 text-brand-wood/30 hover:text-red-500 transition-colors cursor-pointer">
                      <Trash size={16} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* Add new staff */}
          {adding ? (
            <div className="mt-2 p-4 rounded-xl border border-brand-gold/30 bg-brand-gold/5">
              <h4 className="text-sm font-semibold text-brand-black mb-3">Add Staff Member</h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-[10px] text-brand-wood/60 uppercase font-medium">Display Name</label>
                  <input value={newForm.name} onChange={e => setNewForm({ ...newForm, name: e.target.value })} placeholder="e.g. Sarah" className={inputCls} />
                </div>
                <div>
                  <label className="text-[10px] text-brand-wood/60 uppercase font-medium">Full Name (export)</label>
                  <input value={newForm.full_name} onChange={e => setNewForm({ ...newForm, full_name: e.target.value })} placeholder="e.g. Sarah Johnson" className={inputCls} />
                </div>
                <div>
                  <label className="text-[10px] text-brand-wood/60 uppercase font-medium">Role</label>
                  <select value={newForm.role} onChange={e => setNewForm({ ...newForm, role: e.target.value })} className={inputCls}>
                    <option value="full-time">Full-time</option>
                    <option value="part-time">Part-time</option>
                    <option value="backup">Backup</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-brand-wood/60 uppercase font-medium">Max Hours/Day</label>
                  <input type="number" value={newForm.max_hours_per_day} onChange={e => setNewForm({ ...newForm, max_hours_per_day: Number(e.target.value) })} className={inputCls} />
                </div>
                <div>
                  <label className="text-[10px] text-brand-wood/60 uppercase font-medium">Min Hours/Day</label>
                  <input type="number" value={newForm.min_hours_per_day} onChange={e => setNewForm({ ...newForm, min_hours_per_day: Number(e.target.value) })} className={inputCls} />
                </div>
                <div>
                  <label className="text-[10px] text-brand-wood/60 uppercase font-medium">Weekly Target (hrs)</label>
                  <input type="number" value={newForm.weekly_hour_target} onChange={e => setNewForm({ ...newForm, weekly_hour_target: e.target.value })} placeholder="None" className={inputCls} />
                </div>
                <div>
                  <label className="text-[10px] text-brand-wood/60 uppercase font-medium">Days Off/Week</label>
                  <input type="number" value={newForm.days_off_per_week} onChange={e => setNewForm({ ...newForm, days_off_per_week: e.target.value })} placeholder="None" className={inputCls} />
                </div>
                <div>
                  <label className="text-[10px] text-brand-wood/60 uppercase font-medium">Earliest Start</label>
                  <input type="time" value={newForm.available_start} onChange={e => setNewForm({ ...newForm, available_start: e.target.value })} className={inputCls} />
                </div>
                <div>
                  <label className="text-[10px] text-brand-wood/60 uppercase font-medium">Latest End</label>
                  <input type="time" value={newForm.available_end} onChange={e => setNewForm({ ...newForm, available_end: e.target.value })} className={inputCls} />
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                <button onClick={handleAdd} disabled={saving || !newForm.name || !newForm.full_name}
                  className="flex items-center gap-1 px-4 py-2 bg-brand-gold text-white rounded-lg text-sm font-medium cursor-pointer disabled:opacity-50">
                  <Check size={14} /> Add Staff
                </button>
                <button onClick={() => setAdding(false)} className="flex items-center gap-1 px-4 py-2 bg-white border border-brand-wood/20 rounded-lg text-sm cursor-pointer">
                  <X size={14} /> Cancel
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => setAdding(true)}
              className="mt-2 flex items-center gap-2 px-4 py-2.5 border border-dashed border-brand-wood/30 rounded-xl text-sm font-medium text-brand-wood/60 hover:text-brand-black hover:border-brand-gold transition-colors cursor-pointer w-full justify-center">
              <UserPlus size={16} /> Add Staff Member
            </button>
          )}
        </div>
      )}
    </div>
  );
}
