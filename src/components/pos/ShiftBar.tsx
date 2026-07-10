"use client";

import { useState, useEffect } from 'react';
import { Play, Square, AlertCircle, Loader2 } from 'lucide-react';
import { getCurrentShift, openShift, closeShift } from '@/app/actions/shifts';
import { formatCurrency, parsePesoCentavos } from '@/lib/format';

interface ShiftBarProps {
  cashierId: string;
  cashierName: string;
  onShiftChange: (shiftId: string | null) => void;
}

export default function ShiftBar({ cashierId, cashierName, onShiftChange }: ShiftBarProps) {
  const [currentShiftId, setCurrentShiftId] = useState<string | null>(null);
  const [openTime, setOpenTime] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  // Float modal state
  const [showFloatModal, setShowFloatModal] = useState(false);
  const [openingFloatStr, setOpeningFloatStr] = useState('1000.00');

  // Close shift modal state
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [actualCashStr, setActualCashStr] = useState('');

  useEffect(() => {
    async function loadShift() {
      try {
        const shift = await getCurrentShift(cashierId);
        if (shift) {
          setCurrentShiftId(shift.id);
          setOpenTime(shift.opened_at);
          onShiftChange(shift.id);
        }
      } catch (err: any) {
        console.error(err);
      }
    }
    loadShift();
  }, [cashierId, onShiftChange]);

  const handleOpenShift = async () => {
    setError('');
    setLoading(true);
    try {
      const floatCentavos = parsePesoCentavos(openingFloatStr);
      const shiftId = await openShift(cashierId, floatCentavos);
      setCurrentShiftId(shiftId);
      setOpenTime(new Date().toISOString());
      onShiftChange(shiftId);
      setShowFloatModal(false);
    } catch (err: any) {
      setError(err.message || 'Failed to open shift.');
    }
    setLoading(false);
  };

  const handleCloseShift = async () => {
    if (!currentShiftId) return;
    setError('');
    setLoading(true);
    try {
      const actualCashCentavos = parsePesoCentavos(actualCashStr);
      const result = await closeShift(currentShiftId, actualCashCentavos);
      setCurrentShiftId(null);
      setOpenTime(null);
      onShiftChange(null);
      setShowCloseModal(false);
      alert(`Shift closed successfully!\nDiscrepancy: ${formatCurrency(result.discrepancy)}`);
    } catch (err: any) {
      setError(err.message || 'Failed to close shift.');
    }
    setLoading(false);
  };

  return (
    <div className="bg-slate-900/80 border-t border-slate-800 px-6 py-4 flex items-center justify-between no-print">
      <div className="flex items-center gap-4 text-sm">
        <span className="text-slate-400">Cashier:</span>
        <span className="font-semibold text-white">{cashierName}</span>
        
        {currentShiftId ? (
          <>
            <span className="h-4 w-px bg-slate-800" />
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 font-medium text-xs">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Active Shift
            </span>
            <span className="text-slate-400 text-xs">
              Opened: {openTime ? new Date(openTime).toLocaleTimeString() : ''}
            </span>
          </>
        ) : (
          <>
            <span className="h-4 w-px bg-slate-800" />
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 font-medium text-xs">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
              No Active Shift
            </span>
          </>
        )}
      </div>

      <div className="flex items-center gap-3">
        {error && (
          <div className="text-rose-400 text-xs flex items-center gap-1.5 max-w-md bg-rose-950/20 px-3 py-1.5 rounded-lg border border-rose-900/30">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        {currentShiftId ? (
          <button
            onClick={() => setShowCloseModal(true)}
            className="px-4 py-2 bg-rose-600/90 hover:bg-rose-600 text-white font-medium rounded-xl text-xs flex items-center gap-2 transition-all"
          >
            <Square className="w-3.5 h-3.5" />
            Close Shift (Z-Reading)
          </button>
        ) : (
          <button
            onClick={() => setShowFloatModal(true)}
            className="px-4 py-2 bg-emerald-600/90 hover:bg-emerald-600 text-white font-medium rounded-xl text-xs flex items-center gap-2 transition-all"
          >
            <Play className="w-3.5 h-3.5" />
            Open Cashier Shift
          </button>
        )}
      </div>

      {/* Opening Float Modal */}
      {showFloatModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-sm glass-panel rounded-2xl p-6 border border-slate-700/50 shadow-2xl animate-[fadeIn_0.2s_ease-out]">
            <h2 className="text-lg font-bold text-white mb-4">Open Shift - Cash Drawer Float</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-slate-300 mb-1.5">Opening Drawer Cash (Float)</label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 font-medium">₱</span>
                  <input
                    type="number"
                    step="0.01"
                    value={openingFloatStr}
                    onChange={e => setOpeningFloatStr(e.target.value)}
                    className="w-full pl-8 pr-4 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-white focus:outline-none focus:border-emerald-500 transition-all font-semibold"
                  />
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setShowFloatModal(false)}
                  className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium rounded-xl transition-all text-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={handleOpenShift}
                  disabled={loading}
                  className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl transition-all text-sm flex items-center justify-center gap-2"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Start Shift'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Close Shift Modal */}
      {showCloseModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-sm glass-panel rounded-2xl p-6 border border-slate-700/50 shadow-2xl animate-[fadeIn_0.2s_ease-out]">
            <h2 className="text-lg font-bold text-white mb-2">Close Shift (Z-Reading)</h2>
            <p className="text-xs text-slate-400 mb-4">
              Enter the actual counted physical cash in the drawer to reconcile the shift.
            </p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-slate-300 mb-1.5">Counted Drawer Cash</label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 font-medium">₱</span>
                  <input
                    type="number"
                    step="0.01"
                    value={actualCashStr}
                    onChange={e => setActualCashStr(e.target.value)}
                    placeholder="0.00"
                    className="w-full pl-8 pr-4 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-white focus:outline-none focus:border-rose-500 transition-all font-semibold"
                  />
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setShowCloseModal(false)}
                  className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium rounded-xl transition-all text-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCloseShift}
                  disabled={loading}
                  className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-500 text-white font-semibold rounded-xl transition-all text-sm flex items-center justify-center gap-2"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Confirm & Print Z-Reading'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
