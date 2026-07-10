"use client";

import { useState, useEffect } from 'react';
import { ShieldAlert, CreditCard, Banknote, UserCheck, CheckCircle2, Printer, Loader2 } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { getCustomers } from '@/app/actions/customers';
import { processCheckout, CartItem } from '@/app/actions/transactions';
import { formatCurrency } from '@/lib/format';
import { Customer } from '@/types';

interface CheckoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  cartItems: CartItem[];
  totals: {
    subtotal: number;
    tax: number;
    deliveryFee: number;
    discount: number;
    totalAmount: number;
  };
  onSuccess: (txn: { transactionId: string; siNumber: number | null; orNumber: number | null; payload: any }) => void;
  cashierId: string;
}

export default function CheckoutModal({ isOpen, onClose, cartItems, totals, onSuccess, cashierId }: CheckoutModalProps) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<'Cash' | 'Credit' | 'Check'>('Cash');
  const [amountPaidStr, setAmountPaidStr] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [overridePin, setOverridePin] = useState<string>('');
  const [successData, setSuccessData] = useState<{ transactionId: string; siNumber: number | null; orNumber: number | null } | null>(null);

  useEffect(() => {
    if (isOpen) {
      getCustomers()
        .then(setCustomers)
        .catch(console.error);
      setSuccessData(null);
      setError('');
      setAmountPaidStr('');
    }
  }, [isOpen]);

  const selectedCustomer = customers.find(c => c.id === selectedCustomerId);
  
  // Calculate due & change
  const totalAmount = totals.totalAmount;
  const parsedAmountPaid = amountPaidStr ? Math.round(parseFloat(amountPaidStr) * 100) : 0;
  const balanceDue = Math.max(0, totalAmount - parsedAmountPaid);
  const changeDue = Math.max(0, parsedAmountPaid - totalAmount);

  // Credit warnings
  const willExceedCredit = paymentMethod === 'Credit' && selectedCustomer && 
    (selectedCustomer.current_balance + totalAmount - parsedAmountPaid) > selectedCustomer.credit_limit;

  const handleSubmit = async () => {
    setError('');
    setLoading(true);

    try {
      if (paymentMethod === 'Credit' && !selectedCustomerId) {
        throw new Error("Customer selection is required for Credit transactions.");
      }

      if (paymentMethod === 'Credit' && willExceedCredit && !overridePin) {
        throw new Error("Credit Limit Exceeded: Exceeds customer credit limit allowance. Manager Override required.");
      }

      const payload = {
        customerId: selectedCustomerId || null,
        cashierId,
        items: cartItems,
        subtotal: totals.subtotal,
        tax: totals.tax,
        deliveryFee: totals.deliveryFee,
        discount: totals.discount,
        totalAmount,
        amountPaid: paymentMethod === 'Credit' ? parsedAmountPaid : Math.min(totalAmount, parsedAmountPaid || totalAmount),
        paymentMethod,
        overridePin: overridePin || undefined
      };

      const result = await processCheckout(payload);
      setSuccessData(result);
      onSuccess({ ...result, payload });
    } catch (err: any) {
      setError(err.message || 'Checkout failed.');
    }
    setLoading(false);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Complete Transaction" size="md">
      {!successData ? (
        <div className="space-y-5">
          {error && (
            <div className="p-3 bg-rose-950/40 border border-rose-800/60 rounded-xl text-rose-300 text-xs flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}

          {/* Customer Mapping */}
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">
              Customer Account
            </label>
            <select
              value={selectedCustomerId}
              onChange={e => setSelectedCustomerId(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-white focus:outline-none focus:border-indigo-500 text-sm"
            >
              <option value="">Anonymous Walk-in Customer</option>
              {customers.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.price_tier})
                </option>
              ))}
            </select>
          </div>

          {/* Customer Credit Info */}
          {selectedCustomer && (
            <div className="p-3 bg-slate-900/60 border border-slate-800 rounded-xl grid grid-cols-2 gap-4 text-xs">
              <div>
                <span className="text-slate-400 block mb-0.5">Current Balance:</span>
                <span className="font-semibold text-white">{formatCurrency(selectedCustomer.current_balance)}</span>
              </div>
              <div>
                <span className="text-slate-400 block mb-0.5">Credit Limit:</span>
                <span className="font-semibold text-white">{formatCurrency(selectedCustomer.credit_limit)}</span>
              </div>
            </div>
          )}

          {/* Payment Method Selector */}
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">
              Payment Method
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'Cash', label: 'Cash', icon: Banknote },
                { id: 'Credit', label: 'Credit Account', icon: UserCheck },
                { id: 'Check', label: 'Check (PDC)', icon: CreditCard }
              ].map(method => {
                const Icon = method.icon;
                const active = paymentMethod === method.id;
                return (
                  <button
                    key={method.id}
                    type="button"
                    onClick={() => {
                      setPaymentMethod(method.id as any);
                      if (method.id === 'Credit') {
                        setAmountPaidStr('0');
                      } else {
                        setAmountPaidStr('');
                      }
                    }}
                    className={`p-3 border rounded-xl flex flex-col items-center gap-1.5 transition-all text-xs font-semibold ${
                      active
                        ? 'border-indigo-500 bg-indigo-500/10 text-white'
                        : 'border-slate-800 bg-slate-900/40 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Icon className="w-5 h-5" />
                    {method.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Will Exceed Credit Banner */}
          {willExceedCredit && (
            <div className="p-3 bg-rose-950/20 border border-rose-900/40 rounded-xl flex flex-col gap-3">
              <div className="text-rose-300 text-xs flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 shrink-0 text-rose-400 animate-pulse" />
                <span>Credit Limit exceeded. This transaction requires manager approval.</span>
              </div>
              <input
                type="password"
                placeholder="Manager PIN"
                value={overridePin}
                onChange={e => setOverridePin(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-rose-900 rounded-lg text-white focus:outline-none focus:border-rose-500 font-semibold text-sm"
              />
            </div>
          )}

          {/* Cash Payment Details */}
          {paymentMethod !== 'Credit' ? (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">
                  Amount Received
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 font-semibold text-sm">₱</span>
                  <input
                    type="number"
                    step="0.01"
                    value={amountPaidStr}
                    onChange={e => setAmountPaidStr(e.target.value)}
                    placeholder="Enter cash received..."
                    className="w-full pl-8 pr-4 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-white focus:outline-none focus:border-indigo-500 font-semibold"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm p-3 bg-slate-900/40 border border-slate-800/80 rounded-xl">
                <div>
                  <span className="text-slate-400 block text-xs">Change Due:</span>
                  <span className="text-lg font-bold text-white">{formatCurrency(changeDue)}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-xs">Balance Owed:</span>
                  <span className="text-lg font-bold text-white">{formatCurrency(balanceDue)}</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-4 bg-slate-900/30 border border-slate-800 rounded-xl flex justify-between items-center text-sm">
              <span className="text-slate-400 font-medium">To be Charged to Credit Ledger:</span>
              <span className="text-lg font-extrabold text-indigo-400">{formatCurrency(totalAmount)}</span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-3 pt-2">
            <button
              onClick={onClose}
              type="button"
              className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium rounded-xl text-sm transition-all"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={loading || (willExceedCredit && !overridePin) || (paymentMethod !== 'Credit' && !amountPaidStr)}
              type="button"
              className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold rounded-xl text-sm transition-all flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Process Transaction
            </button>
          </div>
        </div>
      ) : (
        <div className="text-center py-6 space-y-6">
          <div className="inline-flex p-4 rounded-full bg-emerald-500/10 text-emerald-400">
            <CheckCircle2 className="w-12 h-12" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-white">Payment Successful!</h3>
            <p className="text-slate-400 text-sm mt-1">Transaction recorded in general ledger.</p>
          </div>

          <div className="p-4 bg-slate-900/50 border border-slate-800 rounded-2xl max-w-xs mx-auto text-sm space-y-2">
            {successData.siNumber && (
              <div className="flex justify-between">
                <span className="text-slate-400">Sales Invoice:</span>
                <span className="font-mono font-bold text-white">#{successData.siNumber}</span>
              </div>
            )}
            {successData.orNumber && (
              <div className="flex justify-between">
                <span className="text-slate-400">Official Receipt:</span>
                <span className="font-mono font-bold text-white">#{successData.orNumber}</span>
              </div>
            )}
          </div>

          <div className="flex gap-3 max-w-xs mx-auto pt-2">
            <button
              onClick={() => {
                window.print();
              }}
              className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl text-sm transition-all flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/25"
            >
              <Printer className="w-4 h-4" />
              Print Receipt
            </button>
            <button
              onClick={onClose}
              className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-xl text-sm transition-all"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
