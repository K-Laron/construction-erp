"use client";
import { SkeletonLine } from "@/components/ui/Skeleton";
import { toast } from "sonner";

import { useState, useEffect, Fragment } from 'react';
import { Truck, CheckCircle2, ChevronDown, ChevronUp, Loader2, Calendar, LayoutGrid, Table2 } from 'lucide-react';
import { getPendingDeliveries, getDeliveryHistory, confirmDelivery } from '@/app/actions/deliveries';
import { formatCurrency, formatDate, formatQuantity } from '@/lib/format';
import Modal from '@/components/ui/Modal';
import DispatchModal from './DispatchModal';
import DeliveryCalendar from './DeliveryCalendar';

export default function DeliveryDispatch() {
  const [viewMode, setViewMode] = useState<'table' | 'calendar'>('table');
  const [deliveries, setDeliveries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmDeliveryId, setConfirmDeliveryId] = useState<string | null>(null);
  
  // Expandable row state
  const [expandedTxId, setExpandedTxId] = useState<string | null>(null);
  const [trips, setTrips] = useState<any[]>([]);
  const [tripsLoading, setTripsLoading] = useState(false);

  // Dispatch Modal state
  const [dispatchTxId, setDispatchTxId] = useState<string | null>(null);

  const loadPending = async () => {
    setLoading(true);
    try {
      const data = await getPendingDeliveries();
      setDeliveries(data);
    } catch (err) {
      console.error(String(err), err);
      toast.error("Failed to load pending deliveries.");
    }
    setLoading(false);
  };

  useEffect(() => {
    loadPending();
  }, []);

  const handleRowExpand = async (transactionId: string) => {
    if (expandedTxId === transactionId) {
      setExpandedTxId(null);
      return;
    }

    setExpandedTxId(transactionId);
    setTripsLoading(true);
    try {
      const data = await getDeliveryHistory(transactionId);
      setTrips(data);
    } catch (err) {
      console.error(String(err), err);
      toast.error("Failed to load delivery history.");
    }
    setTripsLoading(false);
  };

  const handleConfirmTrip = async (deliveryId: string) => {
    setConfirmDeliveryId(deliveryId);
  };

  const executeConfirmTrip = async () => {
    if (!confirmDeliveryId) return;
    try {
      await confirmDelivery(confirmDeliveryId);
      if (expandedTxId) {
        const data = await getDeliveryHistory(expandedTxId);
        setTrips(data);
      }
      loadPending();
      toast.success("Delivery confirmed successfully!");
    } catch (err) {
      console.error(String(err), err);
    } finally {
      setConfirmDeliveryId(null);
    }
  };

  return (
    <div className="flex-1 p-6 space-y-6 overflow-y-auto no-print">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-surface-800 pb-5">
        <div>
          <h1 className="text-xl font-bold text-white">Logistics & Dispatches</h1>
          <p className="text-interactive-400 text-xs mt-1">Manage delivery dispatches, track driver trips, and status logs</p>
        </div>
        {/* View toggle: table / calendar */}
        <div className="flex gap-1.5 p-1 bg-surface-900 rounded-xl border border-surface-800 w-fit">
          <button
            onClick={() => setViewMode('table')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
              viewMode === 'table' ? 'bg-indigo-600 text-white' : 'text-interactive-400 hover:text-interactive-500'
            }`}
          >
            <Table2 className="w-3.5 h-3.5" />
            Table
          </button>
          <button
            onClick={() => setViewMode('calendar')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
              viewMode === 'calendar' ? 'bg-indigo-600 text-white' : 'text-interactive-400 hover:text-interactive-500'
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            Calendar
          </button>
        </div>
      </div>

      {viewMode === 'calendar' ? (
        <DeliveryCalendar />
      ) : loading ? (
        <SkeletonLine className="w-full h-48" />
      ) : deliveries.length === 0 ? (
        <div className="border border-surface-800 rounded-xl p-12 text-center text-interactive-400 text-sm">
          No pending or partially completed deliveries found in queue.
        </div>
      ) : (
        <div className="border border-surface-800 rounded-xl overflow-hidden bg-surface-950/40">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-surface-900 text-interactive-400 font-semibold border-b border-surface-800 uppercase tracking-wider">
                <th className="py-3 px-4">Transaction Date</th>
                <th className="py-3 px-4">Customer Name</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Order Total</th>
                <th className="py-3 px-4 text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {deliveries.map(del => {
                const isExpanded = expandedTxId === del.transaction_id;
                const statusColor = del.delivery_status === 'Partially Delivered' 
                  ? 'bg-amber-500/10 border-amber-500/20 text-amber-400'
                  : 'bg-zinc-500/10 border-zinc-500/20 text-zinc-400';
                  
                return (
                  <Fragment key={del.transaction_id}>
                    <tr className="border-b border-surface-700 hover:bg-surface-900/30 transition-colors">
                      <td className="py-3.5 px-4 font-mono text-interactive-500 flex items-center gap-2">
                        <button
                          onClick={() => handleRowExpand(del.transaction_id)}
                          className="p-1 rounded bg-surface-900 hover:bg-surface-800 text-interactive-400 transition-all"
                        >
                          {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        </button>
                        {formatDate(del.date)}
                      </td>
                      <td className="py-3.5 px-4 font-bold text-white">{del.customer_name || 'Walk-in'}</td>
                      <td className="py-3.5 px-4">
                        <span className={`px-2 py-0.5 rounded-full font-semibold text-[10px] uppercase border ${statusColor}`}>
                          {del.delivery_status}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono text-interactive-500">{formatCurrency(del.total_amount)}</td>
                      <td className="py-3.5 px-4 text-center">
                        <button
                          onClick={() => setDispatchTxId(del.transaction_id)}
                          className="px-2.5 py-1.5 bg-indigo-600/15 hover:bg-indigo-600 text-indigo-400 hover:text-white border border-indigo-500/20 hover:border-transparent rounded-lg font-medium transition-all flex items-center gap-1 mx-auto"
                        >
                          <Truck className="w-3.5 h-3.5" />
                          Dispatch Trip
                        </button>
                      </td>
                    </tr>

                    {/* Expandable Trips Detail Panel */}
                    {isExpanded && (
                      <tr>
                        <td colSpan={5} className="bg-surface-900/60 p-4 border-b border-surface-800">
                          <div className="space-y-4">
                            <h4 className="font-bold text-white text-xs">Dispatch History & Driver Trip Logs</h4>
                            {tripsLoading ? (
                              <span className="text-interactive-400 text-xs flex items-center gap-1.5">
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                Loading trip logs...
                              </span>
                            ) : trips.length === 0 ? (
                              <p className="text-interactive-400 text-xs">No dispatch trips registered yet for this transaction.</p>
                            ) : (
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {trips.map(trip => (
                                  <div key={trip.id} className="p-3 bg-surface-950/60 border border-surface-800 rounded-xl space-y-3">
                                    <div className="flex justify-between items-start">
                                      <div className="flex items-center gap-2">
                                        <Calendar className="w-4 h-4 text-interactive-400" />
                                        <span className="font-mono text-xs text-interactive-400">{formatDate(trip.delivery_date)}</span>
                                      </div>
                                      <span className={`px-2 py-0.5 rounded-full font-bold text-[9px] uppercase border ${
                                        trip.status === 'Delivered'
                                          ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                                          : 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400'
                                      }`}>
                                        {trip.status}
                                      </span>
                                    </div>
                                    <div className="text-xs text-interactive-500">
                                      <p><span className="text-interactive-400">Driver:</span> {trip.driver_name}</p>
                                      <p><span className="text-interactive-400">Truck Plate:</span> {trip.truck_plate}</p>
                                    </div>
                                    <div className="border-t border-surface-700 pt-2">
                                      <span className="text-[10px] text-interactive-400 font-semibold uppercase block mb-1">Loaded Items</span>
                                      <div className="space-y-1">
                                        {trip.items.map((it: any) => (
                                          <div key={it.id} className="flex justify-between text-[11px]">
                                            <span className="text-interactive-400">{it.item_name}</span>
                                            <span className="font-mono text-white">{formatQuantity(it.quantity_delivered)} {it.unit}</span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                    {trip.status === 'Dispatched' && (
                                      <button
                                        onClick={() => handleConfirmTrip(trip.id)}
                                        className="w-full mt-2 py-2 bg-emerald-600/10 hover:bg-emerald-600 border border-emerald-500/20 hover:border-transparent text-emerald-400 hover:text-white rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5"
                                      >
                                        <CheckCircle2 className="w-3.5 h-3.5" />
                                        Confirm Handover (Delivered)
                                      </button>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {dispatchTxId && (
        <DispatchModal
          isOpen={!!dispatchTxId}
          onClose={() => setDispatchTxId(null)}
          transactionId={dispatchTxId}
          onSuccess={loadPending}
        />
      )}

      {/* Confirmation Modal */}
      <Modal isOpen={!!confirmDeliveryId} onClose={() => setConfirmDeliveryId(null)} title="Confirm Delivery" size="sm">
        <p className="text-interactive-500 mb-6">Are you sure you want to mark this trip as Fully Delivered?</p>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setConfirmDeliveryId(null)} className="px-4 py-2 bg-surface-800 hover:bg-surface-700 text-white rounded-lg text-sm transition-colors">Cancel</button>
          <button onClick={executeConfirmTrip} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm transition-colors">Confirm</button>
        </div>
      </Modal>
    </div>
  );
}
