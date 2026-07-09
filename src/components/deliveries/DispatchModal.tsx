"use client";

import { useState, useEffect } from 'react';
import { Loader2, AlertTriangle, Truck } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { getDeliveryRemainingItems, dispatchDelivery } from '@/app/actions/deliveries';
import { formatQuantity, parseMillicounts } from '@/lib/format';

interface DispatchModalProps {
  isOpen: boolean;
  onClose: () => void;
  transactionId: string;
  onSuccess: () => void;
}

export default function DispatchModal({ isOpen, onClose, transactionId, onSuccess }: DispatchModalProps) {
  const [items, setItems] = useState<any[]>([]);
  const [driverName, setDriverName] = useState('');
  const [truckPlate, setTruckPlate] = useState('');
  const [dispatchQtys, setDispatchQtys] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen && transactionId) {
      setLoading(true);
      getDeliveryRemainingItems(transactionId)
        .then(data => {
          setItems(data);
          // Pre-populate with maximum remaining quantities
          const initialQtys: Record<string, string> = {};
          data.forEach(item => {
            initialQtys[item.item_id] = formatQuantity(item.remaining_qty);
          });
          setDispatchQtys(initialQtys);
        })
        .catch(console.error)
        .finally(() => setLoading(false));
      setError('');
      setDriverName('');
      setTruckPlate('');
    }
  }, [isOpen, transactionId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!driverName || !truckPlate) return;
    setError('');
    setLoading(true);

    try {
      const itemsPayload = items.map(item => {
        const inputQty = dispatchQtys[item.item_id] || '0';
        const qtyMillicounts = parseMillicounts(inputQty);
        
        if (qtyMillicounts > item.remaining_qty) {
          throw new Error(`Dispatch quantity for ${item.item_name} cannot exceed remaining balance.`);
        }
        
        return {
          itemId: item.item_id,
          quantityDelivered: qtyMillicounts
        };
      }).filter(item => item.quantityDelivered > 0);

      if (itemsPayload.length === 0) {
        throw new Error("You must dispatch at least one item with a valid quantity.");
      }

      await dispatchDelivery(transactionId, driverName, truckPlate, itemsPayload);
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to dispatch delivery.');
    }
    setLoading(false);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Dispatch Delivery Trip" size="md">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-rose-950/20 border border-rose-900/40 rounded-xl text-rose-300 text-xs">
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase">Driver Name</label>
            <input
              type="text"
              required
              value={driverName}
              onChange={e => setDriverName(e.target.value)}
              placeholder="e.g. Cardo Dalisay"
              className="w-full px-3.5 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:border-indigo-500"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase">Truck Plate Number</label>
            <input
              type="text"
              required
              value={truckPlate}
              onChange={e => setTruckPlate(e.target.value)}
              placeholder="e.g. NQR-1234"
              className="w-full px-3.5 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase">Items to Deliver</label>
          <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950/20 max-h-60 overflow-y-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-900 text-slate-400 font-semibold border-b border-slate-800">
                <tr>
                  <th className="py-2 px-3">Item Name</th>
                  <th className="py-2 px-3 text-center">Remaining</th>
                  <th className="py-2 px-3 text-right">Dispatch Qty</th>
                </tr>
              </thead>
              <tbody>
                {items.map(item => (
                  <tr key={item.item_id} className="border-b border-slate-850">
                    <td className="py-2 px-3 text-white font-bold">{item.item_name}</td>
                    <td className="py-2 px-3 text-center text-slate-400 font-mono">
                      {formatQuantity(item.remaining_qty)} {item.unit}
                    </td>
                    <td className="py-2 px-3 text-right">
                      <div className="inline-flex items-center gap-1.5 justify-end">
                        <input
                          type="number"
                          step="0.001"
                          max={formatQuantity(item.remaining_qty)}
                          value={dispatchQtys[item.item_id] || ''}
                          onChange={e => {
                            const updated = { ...dispatchQtys };
                            updated[item.item_id] = e.target.value;
                            setDispatchQtys(updated);
                          }}
                          className="w-20 px-2 py-1 bg-slate-950 border border-slate-700 rounded-md text-right text-white font-mono"
                        />
                        <span className="text-slate-500 font-medium w-8 text-left">{item.unit}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex gap-3 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium rounded-xl text-sm transition-all"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading || items.length === 0}
            className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl text-sm transition-all flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Truck className="w-4 h-4" />}
            Confirm Dispatch
          </button>
        </div>
      </form>
    </Modal>
  );
}
