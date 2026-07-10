"use client";

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { createCustomer } from '@/app/actions/customers';
import { parsePesoCentavos } from '@/lib/format';

interface CustomerFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function CustomerFormModal({ isOpen, onClose, onSuccess }: CustomerFormModalProps) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [creditLimitStr, setCreditLimitStr] = useState('0.00');
  const [priceTier, setPriceTier] = useState<'Retail' | 'Wholesale'>('Retail');
  const [isVatExempt, setIsVatExempt] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name) return;
    setError('');
    setLoading(true);

    try {
      const limitCentavos = parsePesoCentavos(creditLimitStr);
      await createCustomer(name, phone || null, address || null, limitCentavos, priceTier, isVatExempt ? 1 : 0);
      onSuccess();
      onClose();
      // Reset form
      setName('');
      setPhone('');
      setAddress('');
      setCreditLimitStr('0.00');
      setPriceTier('Retail');
      setIsVatExempt(false);
    } catch (err: any) {
      setError(err.message || 'Failed to create customer.');
    }
    setLoading(false);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add New Customer" size="md">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-rose-950/20 border border-rose-900/40 rounded-xl text-rose-300 text-xs">
            {error}
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase">Customer Name</label>
          <input
            type="text"
            required
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="John Doe Construction..."
            className="w-full px-3.5 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase">Phone Number</label>
            <input
              type="text"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="0917-XXX-XXXX"
              className="w-full px-3.5 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:border-indigo-500"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase">Credit Limit</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">₱</span>
              <input
                type="number"
                step="0.01"
                value={creditLimitStr}
                onChange={e => setCreditLimitStr(e.target.value)}
                className="w-full pl-6 pr-3.5 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:border-indigo-500 font-mono font-bold"
              />
            </div>
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase">Jobsite/Billing Address</label>
          <textarea
            value={address}
            onChange={e => setAddress(e.target.value)}
            placeholder="Enter full physical address..."
            rows={2}
            className="w-full px-3.5 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:border-indigo-500 resize-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase">Price Tier</label>
            <select
              value={priceTier}
              onChange={e => setPriceTier(e.target.value as 'Retail' | 'Wholesale')}
              className="w-full px-3.5 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:border-indigo-500"
            >
              <option value="Retail">Retail</option>
              <option value="Wholesale">Wholesale</option>
            </select>
          </div>
          <div className="flex items-center pt-5">
            <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-300 font-medium">
              <input
                type="checkbox"
                checked={isVatExempt}
                onChange={e => setIsVatExempt(e.target.checked)}
                className="w-4 h-4 accent-indigo-500"
              />
              VAT Exempt Account
            </label>
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
            disabled={loading}
            className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl text-sm transition-all flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Create Customer
          </button>
        </div>
      </form>
    </Modal>
  );
}
