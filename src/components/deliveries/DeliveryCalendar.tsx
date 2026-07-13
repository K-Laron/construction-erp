"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { ChevronLeft, ChevronRight, XCircle, Calendar, Truck } from 'lucide-react';
import { getDeliveryCalendarData, CalendarDelivery, UnscheduledTransaction } from '@/app/actions/deliveries';
import { SkeletonLine } from '@/components/ui/Skeleton';
import { formatDate, formatQuantity } from '@/lib/format';
import { toast } from 'sonner';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
type ViewMode = 'month' | 'week' | 'agenda';

export default function DeliveryCalendar() {
  const [viewDate, setViewDate] = useState(new Date());
  const [data, setData] = useState<{ byDate: Record<string, CalendarDelivery[]>; unscheduled: UnscheduledTransaction[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [weekIndex, setWeekIndex] = useState(0);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [focusedDay, setFocusedDay] = useState<number | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();

  // Calendar math
  const firstDayOfWeek = useMemo(() => new Date(year, month, 1).getDay(), [year, month]);
  const daysInMonth = useMemo(() => new Date(year, month + 1, 0).getDate(), [year, month]);
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  // Build grid: leading empty cells + days + trailing empty cells
  const grid = useMemo(() => {
    const totalCells = Math.ceil((firstDayOfWeek + daysInMonth) / 7) * 7;
    const cells: (number | null)[] = [];
    for (let i = 0; i < firstDayOfWeek; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    while (cells.length < totalCells) cells.push(null);
    return cells;
  }, [firstDayOfWeek, daysInMonth]);

  const numWeeks = Math.ceil(grid.length / 7);

  const loadData = useCallback(async () => {
    setLoading(true);
    const startOfMonth = new Date(year, month, 1).toISOString().slice(0, 10);
    const endOfMonth = new Date(year, month + 1, 0).toISOString().slice(0, 10);
    try {
      const result = await getDeliveryCalendarData(startOfMonth, endOfMonth);
      setData(result);
    } catch (err) {
      console.error(String(err), err);
      toast.error("Failed to load calendar data.");
    }
    setLoading(false);
  }, [year, month]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Init/reset keyboard focus when month changes
  useEffect(() => {
    const key = new Date(year, month, 1).toISOString().slice(0, 10);
    const isViewingToday = today.startsWith(key.slice(0, 7));
    setFocusedDay(isViewingToday ? parseInt(today.slice(8), 10) : 1);
    setSelectedDay(null);
  }, [year, month, today]);

  const monthLabel = useMemo(
    () => new Date(year, month).toLocaleDateString('en-PH', { month: 'long', year: 'numeric' }),
    [year, month]
  );

  const getDayKey = (day: number) => new Date(year, month, day).toISOString().slice(0, 10);
  const getDayData = (day: number) => data?.byDate[getDayKey(day)] || [];

  const navigatePrev = () => {
    setSelectedDay(null);
    if (viewMode === 'week') {
      if (weekIndex > 0) {
        setWeekIndex(weekIndex - 1);
      } else {
        setViewDate(new Date(year, month - 1, 1));
        setWeekIndex(numWeeks - 1);
      }
    } else {
      setViewDate(new Date(year, month - 1, 1));
    }
  };

  const navigateNext = () => {
    setSelectedDay(null);
    if (viewMode === 'week') {
      if (weekIndex < numWeeks - 1) {
        setWeekIndex(weekIndex + 1);
      } else {
        setViewDate(new Date(year, month + 1, 1));
        setWeekIndex(0);
      }
    } else {
      setViewDate(new Date(year, month + 1, 1));
    }
  };

  const goToday = () => {
    setViewDate(new Date());
    setWeekIndex(0);
    setSelectedDay(null);
  };

  // Week grid: compute the 7 days for current weekIndex
  const weekDays = useMemo(() => {
    const startCell = weekIndex * 7;
    const days: (number | null)[] = [];
    for (let i = 0; i < 7; i++) {
      days.push(grid[startCell + i] ?? null);
    }
    return days;
  }, [grid, weekIndex]);

  // Group grid into weeks for accessible row structure
  const rows = useMemo(() => {
    const result: (number | null)[][] = [];
    for (let i = 0; i < grid.length; i += 7) result.push(grid.slice(i, i + 7));
    return result;
  }, [grid]);

  const viewLabel = viewMode === 'month' ? monthLabel : `Week ${weekIndex + 1} of ${monthLabel}`;

  // Keyboard nav: arrow keys move focusedDay within the month grid
  const handleGridKeyDown = useCallback((e: React.KeyboardEvent) => {
    const cur = focusedDay ?? 1;
    let next: number | null = null;
    switch (e.key) {
      case 'ArrowLeft': next = cur > 1 ? cur - 1 : null; break;
      case 'ArrowRight': next = cur < daysInMonth ? cur + 1 : null; break;
      case 'ArrowUp': next = cur - 7 > 0 ? cur - 7 : null; break;
      case 'ArrowDown': next = cur + 7 <= daysInMonth ? cur + 7 : null; break;
      case 'Home': next = 1; break;
      case 'End': next = daysInMonth; break;
      case 'Enter': case ' ': {
        e.preventDefault();
        if (focusedDay) {
          const k = getDayKey(focusedDay);
          setSelectedDay(selectedDay === k ? null : k);
        }
        return;
      }
      default: return;
    }
    e.preventDefault();
    if (next !== null && next !== cur) {
      setFocusedDay(next);
      document.querySelector<HTMLElement>(`[data-cal-day="${next}"]`)?.focus();
    }
  }, [focusedDay, daysInMonth, selectedDay]);

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        {/* Skeleton: view toggle */}
        <div className="flex gap-1.5 p-1 bg-surface-900 rounded-xl w-fit">
          <div className="h-7 w-16 bg-surface-800 rounded-lg" />
          <div className="h-7 w-16 bg-surface-800 rounded-lg" />
          <div className="h-7 w-16 bg-surface-800 rounded-lg" />
        </div>
        {/* Skeleton: nav header */}
        <div className="flex items-center justify-between">
          <div className="h-8 w-8 bg-surface-800 rounded-lg" />
          <div className="h-6 w-48 bg-surface-800 rounded-md" />
          <div className="h-8 w-24 bg-surface-800 rounded-lg" />
        </div>
        {/* Skeleton: unscheduled panel */}
        <div className="h-16 bg-surface-900/50 border border-surface-800 rounded-xl" />
        {/* Skeleton: day names */}
        <div className="grid grid-cols-7 gap-1">
          {DAY_NAMES.map(n => <div key={n} className="h-4 bg-surface-800 rounded mx-2" />)}
        </div>
        {/* Skeleton: 6 rows × 7 columns */}
        <div className="space-y-1">
          {Array.from({ length: 6 }).map((_, ri) => (
            <div className="grid grid-cols-7 gap-1" key={ri}>
              {Array.from({ length: 7 }).map((_, ci) => (
                <div key={ci} className="h-[80px] bg-surface-900/60 border border-surface-800 rounded-xl" />
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* View mode toggle */}
      <div className="flex gap-1.5 p-1 bg-surface-900 rounded-xl border border-surface-800 w-fit" role="radiogroup" aria-label="Calendar view">
        {(['month', 'week', 'agenda'] as const).map(mode => (
          <button
            key={mode}
            onClick={() => { setViewMode(mode); setSelectedDay(null); }}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all capitalize ${
              viewMode === mode ? 'bg-indigo-600 text-white' : 'text-interactive-400 hover:text-interactive-500'
            }`}
          >
            {mode}
          </button>
        ))}
      </div>

      {/* Navigation header */}
      <div className="flex items-center justify-between">
        <button
          onClick={navigatePrev}
          className="p-2 rounded-lg bg-surface-800 hover:bg-surface-700 text-interactive-400 transition-all"
          aria-label="Previous"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <h2 className="text-lg font-bold text-white">{viewLabel}</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={goToday}
            className="px-3 py-1.5 text-xs font-semibold bg-surface-800 hover:bg-surface-700 text-interactive-400 rounded-lg transition-all"
            aria-label={`View ${viewMode} starting today`}
          >
            Today
          </button>
          <button
            onClick={navigateNext}
            className="p-2 rounded-lg bg-surface-800 hover:bg-surface-700 text-interactive-400 transition-all"
            aria-label="Next"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Unscheduled transactions panel */}
      {data?.unscheduled && data.unscheduled.length > 0 && (
        <div className="border border-amber-900/30 bg-amber-950/10 rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2 text-amber-400 text-xs font-semibold uppercase tracking-wider">
            <span className="w-2 h-2 rounded-full bg-amber-400" />
            Unscheduled — {data.unscheduled.length} pending transaction{data.unscheduled.length > 1 ? 's' : ''} with no dispatch yet
          </div>
          <div className="flex flex-wrap gap-2">
            {data.unscheduled.map(tx => (
              <div
                key={tx.transaction_id}
                className="flex items-center gap-3 px-3 py-2 bg-surface-950/60 border border-surface-800 rounded-lg text-xs"
              >
                <span className="font-bold text-white">{tx.customer_name || 'Walk-in'}</span>
                <span className="text-interactive-400">{tx.date.slice(0, 10)}</span>
                <span className="text-interactive-500">{tx.item_count} item{tx.item_count > 1 ? 's' : ''}</span>
                <span className="px-1.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 font-semibold text-[9px] uppercase">
                  {tx.delivery_status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ======= MONTH GRID ======= */}
      {viewMode === 'month' && (
        <>
          {/* Day names header */}
          <div className="grid grid-cols-7 gap-1" aria-hidden="true">
            {DAY_NAMES.map(name => (
              <div
                key={name}
                className="text-center text-[10px] font-semibold text-interactive-400 uppercase tracking-wider py-1"
              >
                {name}
              </div>
            ))}
          </div>

          {/* Month grid — ARIA editable grid pattern */}
          <div
            ref={gridRef}
            role="grid"
            aria-label={monthLabel}
            onKeyDown={handleGridKeyDown}
            className="space-y-1"
          >
            {rows.map((week, wi) => (
              <div role="row" className="grid grid-cols-7 gap-1" key={wi}>
                {week.map((day, di) => {
                  if (day === null) return <div role="gridcell" key={`e-${wi}-${di}`} className="p-2 min-h-[80px]" />;

                  const key = getDayKey(day);
                  const isToday = key === today;
                  const isFocused = focusedDay === day;
                  const dayDeliveries = getDayData(day);
                  const dispatched = dayDeliveries.filter(d => d.status === 'Dispatched').length;
                  const delivered = dayDeliveries.filter(d => d.status === 'Delivered').length;

                  return (
                    <div
                      role="gridcell"
                      key={key}
                      data-cal-day={day}
                      aria-selected={selectedDay === key || undefined}
                      aria-current={isToday ? 'date' : undefined}
                      tabIndex={isFocused ? 0 : -1}
                      onFocus={() => setFocusedDay(day)}
                      onClick={() => setSelectedDay(selectedDay === key ? null : key)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          e.stopPropagation();
                          setSelectedDay(selectedDay === key ? null : key);
                        }
                      }}
                      className={`p-2 rounded-xl border cursor-pointer transition-all min-h-[80px] ${
                        selectedDay === key
                          ? 'border-indigo-500 bg-surface-900/80'
                          : isToday
                            ? 'border-indigo-500/40 bg-surface-900/60'
                            : 'border-surface-800 bg-surface-950/40 hover:bg-surface-900/50'
                      } ${isFocused && !selectedDay ? 'ring-2 ring-indigo-400/60' : ''}`}
                    >
                      <span className={`text-xs font-semibold ${isToday ? 'text-indigo-400' : 'text-interactive-400'}`}>
                        {day}
                      </span>
                      {(dispatched > 0 || delivered > 0) && (
                        <div className="mt-1.5 space-y-1">
                          {dispatched > 0 && (
                            <span className="flex items-center gap-1 text-[10px] text-indigo-400">
                              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 shrink-0" />
                              {dispatched} disp.
                            </span>
                          )}
                          {delivered > 0 && (
                            <span className="flex items-center gap-1 text-[10px] text-emerald-400">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                              {delivered} done
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </>
      )}

      {/* ======= WEEK GRID ======= */}
      {viewMode === 'week' && (
        <>
          {/* Day names + content in one grid */}
          <div className="grid grid-cols-7 gap-1">
            {DAY_NAMES.map(name => (
              <div
                key={name}
                className="text-center text-[10px] font-semibold text-interactive-400 uppercase tracking-wider py-1"
              >
                {name}
              </div>
            ))}
            {weekDays.map((day, i) => {
              if (day === null) return <div key={`we-${i}`} className="p-2 min-h-[120px]" />;

              const key = getDayKey(day);
              const isToday = key === today;
              const dayDeliveries = getDayData(day);

              return (
                <button
                  key={key}
                  onClick={() => setSelectedDay(selectedDay === key ? null : key)}
                  className={`p-2 rounded-xl border text-left transition-all min-h-[120px] ${
                    selectedDay === key
                      ? 'border-indigo-500 bg-surface-900/80'
                      : isToday
                        ? 'border-indigo-500/40 bg-surface-900/60'
                        : 'border-surface-800 bg-surface-950/40 hover:bg-surface-900/50'
                  }`}
                >
                  <span className={`text-xs font-semibold ${isToday ? 'text-indigo-400' : 'text-interactive-400'}`}>
                    {day}
                  </span>
                  {dayDeliveries.length > 0 && (
                    <div className="mt-1.5 space-y-1.5">
                      {dayDeliveries.slice(0, 3).map(trip => (
                        <div
                          key={trip.id}
                          className={`text-[10px] px-1.5 py-0.5 rounded ${
                            trip.status === 'Delivered'
                              ? 'bg-emerald-500/10 text-emerald-400'
                              : 'bg-indigo-500/10 text-indigo-400'
                          }`}
                        >
                          {trip.driver_name}
                        </div>
                      ))}
                      {dayDeliveries.length > 3 && (
                        <span className="text-[10px] text-interactive-500">+{dayDeliveries.length - 3} more</span>
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* ======= AGENDA LIST ======= */}
      {viewMode === 'agenda' && (
        <div className="border border-surface-800 rounded-xl bg-surface-950/40 p-5">
          {data && Object.keys(data.byDate).length === 0 ? (
            <p className="text-interactive-400 text-xs text-center py-8">No deliveries this month.</p>
          ) : (
            <div className="space-y-6 max-h-[600px] overflow-y-auto pr-1">
              {data && Object.entries(data.byDate).sort().map(([dateKey, trips]) => (
                <div key={dateKey} className="space-y-3">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2 sticky top-0 bg-surface-950/40 py-1">
                    <Calendar className="w-4 h-4 text-indigo-400" />
                    {formatDate(dateKey)}
                    <span className="text-interactive-400 font-normal text-xs">
                      ({trips.length} trip{trips.length > 1 ? 's' : ''})
                    </span>
                  </h3>
                  <div className="grid grid-cols-1 gap-3">
                    {trips.map(trip => (
                      <div
                        key={trip.id}
                        className="p-3 bg-surface-950/60 border border-surface-800 rounded-xl space-y-3"
                      >
                        <div className="flex justify-between items-start">
                          <div className="flex items-center gap-2">
                            <Truck className="w-4 h-4 text-interactive-400" />
                            <span className="font-mono text-xs text-interactive-400">
                              {formatDate(trip.delivery_date)}
                            </span>
                          </div>
                          <span
                            className={`px-2 py-0.5 rounded-full font-bold text-[9px] uppercase border ${
                              trip.status === 'Delivered'
                                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                                : 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400'
                            }`}
                          >
                            {trip.status}
                          </span>
                        </div>
                        <div className="text-xs text-interactive-500">
                          <p><span className="text-interactive-400">Driver:</span> {trip.driver_name}</p>
                          <p><span className="text-interactive-400">Truck Plate:</span> {trip.truck_plate}</p>
                        </div>
                        {trip.items.length > 0 && (
                          <div className="border-t border-surface-700 pt-2">
                            <span className="text-[10px] text-interactive-400 font-semibold uppercase block mb-1">Loaded Items</span>
                            <div className="space-y-1">
                              {trip.items.map(it => (
                                <div key={it.id} className="flex justify-between text-[11px]">
                                  <span className="text-interactive-400">{it.item_name}</span>
                                  <span className="font-mono text-white">{formatQuantity(it.quantity_delivered)} {it.unit}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ======= DAY DETAIL PANEL (for month/week modes) ======= */}
      {selectedDay && data?.byDate[selectedDay] && data.byDate[selectedDay].length > 0 && viewMode !== 'agenda' && (
        <div className="border border-surface-800 rounded-xl bg-surface-950/40 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-white text-sm flex items-center gap-2">
              <Calendar className="w-4 h-4 text-indigo-400" />
              Deliveries on {formatDate(selectedDay)}
            </h3>
            <button
              onClick={() => setSelectedDay(null)}
              className="p-1 rounded-lg bg-surface-800 hover:bg-surface-700 text-interactive-400 transition-all"
              aria-label="Close detail panel"
            >
              <XCircle className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {data.byDate[selectedDay].map(trip => (
              <div key={trip.id} className="p-3 bg-surface-950/60 border border-surface-800 rounded-xl space-y-3">
                <div className="flex justify-between items-start">
                  <div className="flex items-center gap-2">
                    <Truck className="w-4 h-4 text-interactive-400" />
                    <span className="font-mono text-xs text-interactive-400">{formatDate(trip.delivery_date)}</span>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full font-bold text-[9px] uppercase border ${
                    trip.status === 'Delivered'
                      ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                      : 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400'
                  }`}>{trip.status}</span>
                </div>
                <div className="text-xs text-interactive-500">
                  <p><span className="text-interactive-400">Driver:</span> {trip.driver_name}</p>
                  <p><span className="text-interactive-400">Truck Plate:</span> {trip.truck_plate}</p>
                </div>
                {trip.items.length > 0 && (
                  <div className="border-t border-surface-700 pt-2">
                    <span className="text-[10px] text-interactive-400 font-semibold uppercase block mb-1">Loaded Items</span>
                    <div className="space-y-1">
                      {trip.items.map(it => (
                        <div key={it.id} className="flex justify-between text-[11px]">
                          <span className="text-interactive-400">{it.item_name}</span>
                          <span className="font-mono text-white">{formatQuantity(it.quantity_delivered)} {it.unit}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
