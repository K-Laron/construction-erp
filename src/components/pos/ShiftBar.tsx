"use client";

import { useState, useEffect } from 'react';
import { Play, Square, AlertCircle, Loader2 } from 'lucide-react';
import { getCurrentShift, openShift, closeShift } from '@/app/actions/shifts';
import { formatCurrency, parsePesoCentavos } from '@/lib/format';
import { toast } from 'sonner';
import { logger } from "@/lib/logger";
import Modal from '@/components/ui/Modal';

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

  const [showFloatModal, setShowFloatModal] = useState(false);
  const [openingFloatStr, setOpeningFloatStr] = useState('1000.00');

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
      } catch (err: unknown) {
        logger.error(String(err), err);
        toast.error("Failed to load shift data.");
      }
    }
    loadShift();
  }, [cashierId, onShiftChange]);

  const handleOpenShift = async () => {
    setError('');
    setLoading(true);
    try {
      const floatCentavos = parsePesoCentavos(openingFloatStr);
      const result = await openShift(cashierId, floatCentavos);
      if (!result.success) throw new Error(result.error);
      const shiftId = result.data!;
      setCurrentShiftId(shiftId);
      setOpenTime(new Date().toISOString());
      onShiftChange(shiftId);
      setShowFloatModal(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to open shift.');
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
      if (!result.success) throw new Error(result.error);
      setCurrentShiftId(null);
      setOpenTime(null);
      onShiftChange(null);
      setShowCloseModal(false);
      toast.success(`Shift closed successfully! Discrepancy: ${formatCurrency(result.data!.discrepancy)}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to close shift.');
    }
    setLoading(false);
  };

  return (
    <div className="bg-surface-900/80 border-t border-surface-700 px-6 py-4 flex items-center justify-between no-print">
      <div className="flex items-center gap-4 text-sm">
        <span className="text-interactive-400">Cashier:</span>
        <span className="font-semibold text-interactive-500">{cashierName}</span>

        {currentShiftId ? (
          <>
            <span className="h-4 w-px bg-surface-700" />
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 font-medium text-xs">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Active Shift
            </span>
            <span className="text-interactive-400 text-xs">
              Opened: {openTime ? new Date(openTime).toLocaleTimeString() : ''}
            </span>
          </>
        ) : (
          <>
            <span className="h-4 w-px bg-surface-700" />
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 font-medium text-xs">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
              No Active Shift
            </span>
          </>
        )}
      </div>

      <div className="flex items-center gap-3">
        {error && (
          <div className="text-error-500 text-xs flex items-center gap-1.5 max-w-md bg-error-500/10 px-3 py-1.5 rounded-lg border border-error-500/30" role="alert">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        {currentShiftId ? (
          <button
            onClick={() => setShowCloseModal(true)}
            className="px-4 py-2 bg-rose-600/90 hover:bg-rose-600 text-white font-medium rounded-xl text-xs flex items-center gap-2 transition-all cursor-pointer"
          >
            <Square className="w-3.5 h-3.5" />
            Close Shift (Z-Reading)
          </button>
        ) : (
          <button
            onClick={() => setShowFloatModal(true)}
            className="px-4 py-2 bg-emerald-600/90 hover:bg-emerald-600 text-white font-medium rounded-xl text-xs flex items-center gap-2 transition-all cursor-pointer"
          >
            <Play className="w-3.5 h-3.5" />
            Open Cashier Shift
          </button>
        )}
      </div>

      <Modal isOpen={showFloatModal} onClose={() => setShowFloatModal(false)} title="Open Shift - Cash Drawer Float" size="sm">
        <div className="space-y-4">
          <div>
            <label htmlFor="shift-float" className="block text-sm text-interactive-400 mb-1.5">Opening Drawer Cash (Float)</label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-interactive-400 font-medium">₱</span>
              <input
                id="shift-float"
                type="number"
                step="0.01"
                value={openingFloatStr}
                onChange={e => setOpeningFloatStr(e.target.value)}
                className="w-full pl-8 pr-4 py-2.5 bg-surface-950 border border-surface-700 rounded-xl text-interactive-500 focus:outline-none focus:border-accent-500 transition-all font-semibold"
              />
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setShowFloatModal(false)}
              className="flex-1 py-2.5 bg-surface-800 hover:bg-surface-700 text-interactive-400 font-medium rounded-xl transition-all text-sm cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={handleOpenShift}
              disabled={loading}
              className="flex-1 py-2.5 bg-accent-600 hover:bg-accent-500 text-white font-semibold rounded-xl transition-all text-sm flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Start Shift'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={showCloseModal} onClose={() => setShowCloseModal(false)} title="Close Shift (Z-Reading)" size="sm">
        <div className="space-y-4">
          <p className="text-xs text-interactive-400 mb-4">
            Enter the actual counted physical cash in the drawer to reconcile the shift.
          </p>
          <div>
            <label htmlFor="shift-counted-cash" className="block text-sm text-interactive-400 mb-1.5">Counted Drawer Cash</label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-interactive-400 font-medium">₱</span>
              <input
                id="shift-counted-cash"
                type="number"
                step="0.01"
                value={actualCashStr}
                onChange={e => setActualCashStr(e.target.value)}
                placeholder="0.00"
                className="w-full pl-8 pr-4 py-2.5 bg-surface-950 border border-surface-700 rounded-xl text-interactive-500 focus:outline-none focus:border-rose-500 transition-all font-semibold"
              />
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setShowCloseModal(false)}
              className="flex-1 py-2.5 bg-surface-800 hover:bg-surface-700 text-interactive-400 font-medium rounded-xl transition-all text-sm cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={handleCloseShift}
              disabled={loading}
              className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-500 text-white font-semibold rounded-xl transition-all text-sm flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Confirm & Print Z-Reading'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
