"use client";
import { toast } from "sonner";

import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { recordPayment } from '@/app/actions/customers';
import { parsePesoCentavos, formatCurrency } from '@/lib/format';
import { Customer } from '@/types/crm';

interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  customer: Customer | null;
  onSuccess: () => void;
}

export default function PaymentModal({ isOpen, onClose, customer, onSuccess }: PaymentModalProps) {
  const [amountStr, setAmountStr] = useState('');
  const [description, setDescription] = useState('Cash Payment');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setAmountStr('');
      setDescription('Cash Payment');
      setError('');
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customer || !amountStr) return;
    setError('');
    setLoading(true);

    try {
      const amountCentavos = parsePesoCentavos(amountStr);
      await recordPayment(customer.id, amountCentavos, description);
      onSuccess();
      toast.success("Payment recorded successfully!");
      onClose();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to record payment.';
      setError(message);
      toast.error(message);
    }
    setLoading(false);
  };

  if (!customer) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Receive Cash Payment" size="sm">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-rose-950/20 border border-rose-900/40 rounded-xl text-rose-300 text-xs" role="alert">
            {error}
          </div>
        )}

        <div className="p-3 bg-surface-900/40 border border-surface-800 rounded-xl text-xs space-y-1">
          <div className="flex justify-between">
            <span className="text-interactive-400">Customer:</span>
            <span className="font-bold text-white">{customer.name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-interactive-400">Outstanding Balance:</span>
            <span className="font-bold text-white">{formatCurrency(customer.current_balance)}</span>
          </div>
        </div>

        <div>
          <label htmlFor="payment-amount" className="block text-xs font-semibold text-interactive-400 mb-1.5 uppercase">Payment Amount</label>
          <div className="relative">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-interactive-400 font-bold">₱</span>
            <input
              id="payment-amount"
              type="number"
              step="0.01"
              required
              value={amountStr}
              onChange={e => setAmountStr(e.target.value)}
              placeholder="0.00"
              className="w-full pl-8 pr-3.5 py-2.5 bg-surface-950 border border-surface-700 rounded-xl text-white text-sm focus:outline-none focus:border-indigo-500 font-mono font-bold"
            />
          </div>
        </div>

        <div>
          <label htmlFor="payment-description" className="block text-xs font-semibold text-interactive-400 mb-1.5 uppercase">Reference / Description</label>
          <input
            id="payment-description"
            type="text"
            required
            value={description}
            onChange={e => setDescription(e.target.value)}
            className="w-full px-3.5 py-2 bg-surface-950 border border-surface-700 rounded-xl text-white text-sm focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div className="flex gap-3 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 bg-surface-800 hover:bg-surface-700 text-interactive-500 font-medium rounded-xl text-sm transition-all"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading || !amountStr}
            className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl text-sm transition-all flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Post Payment
          </button>
        </div>
      </form>
    </Modal>
  );
}
