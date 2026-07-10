"use client";
import { SkeletonTable } from "@/components/ui/Skeleton";

import { useState, useEffect } from 'react';
import { logger } from "@/lib/logger";
import { Search, UserPlus, CreditCard, ChevronDown, ChevronUp, ShieldAlert, ShieldCheck, Loader2 } from 'lucide-react';
import { getCustomers, getCustomerLedger } from '@/app/actions/customers';
import { formatCurrency, formatDate } from '@/lib/format';
import { Customer, CustomerLedgerEntry } from '@/types';
import CustomerFormModal from './CustomerFormModal';
import PaymentModal from './PaymentModal';

export default function CustomerManager() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  
  // Expanded customer state for ledger inspection
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [ledgerData, setLedgerData] = useState<CustomerLedgerEntry[]>([]);
  const [integrityViolated, setIntegrityViolated] = useState(false);
  const [ledgerLoading, setLedgerLoading] = useState(false);

  // Modals state
  const [showAddModal, setShowAddModal] = useState(false);
  const [paymentCustomer, setPaymentCustomer] = useState<Customer | null>(null);

  const loadCustomers = async () => {
    setLoading(true);
    try {
      const data = await getCustomers();
      setCustomers(data);
    } catch (err) {
      logger.error(String(err), err);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadCustomers();
  }, []);

  const handleRowExpand = async (customerId: string) => {
    if (expandedId === customerId) {
      setExpandedId(null);
      return;
    }

    setExpandedId(customerId);
    setLedgerLoading(true);
    try {
      const { ledger, isIntegrityViolated } = await getCustomerLedger(customerId);
      setLedgerData(ledger);
      setIntegrityViolated(isIntegrityViolated);
    } catch (err) {
      logger.error(String(err), err);
    }
    setLedgerLoading(false);
  };

  const filteredCustomers = customers.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex-1 p-6 space-y-6 overflow-y-auto no-print">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-surface-800 pb-5">
        <div>
          <h1 className="text-xl font-bold text-white">Customer CRM</h1>
          <p className="text-interactive-400 text-xs mt-1">Manage credit accounts, ledgers, and payments</p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl text-xs flex items-center gap-2 transition-all shadow-lg hover:shadow-emerald-500/20"
        >
          <UserPlus className="w-4 h-4" />
          Add Customer
        </button>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-interactive-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search customers by name..."
            className="w-full pl-10 pr-4 py-2 bg-surface-900 border border-surface-800 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 text-xs transition-all"
          />
        </div>
      </div>

      {loading ? (
        <SkeletonTable rows={5} cols={6} />
      ) : (
        <div className="border border-surface-800 rounded-xl overflow-hidden bg-surface-950/40">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-surface-900 text-interactive-400 font-semibold border-b border-surface-800 uppercase tracking-wider">
                <th className="py-3 px-4">Customer Name</th>
                <th className="py-3 px-4">Phone</th>
                <th className="py-3 px-4">Price Tier</th>
                <th className="py-3 px-4">Credit Limit</th>
                <th className="py-3 px-4 text-right">Balance</th>
                <th className="py-3 px-4 text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredCustomers.map(c => {
                const isOver = c.current_balance > c.credit_limit;
                const isExpanded = expandedId === c.id;
                return (
                  <>
                    <tr
                      key={c.id}
                      className={`border-b border-surface-700 hover:bg-surface-900/40 transition-colors ${
                        isOver ? 'bg-rose-950/5' : ''
                      }`}
                    >
                      <td className="py-3.5 px-4 font-bold text-white flex items-center gap-2">
                        <button
                          onClick={() => handleRowExpand(c.id)}
                          className="p-1 rounded bg-surface-900 hover:bg-surface-800 text-interactive-400 transition-all"
                        >
                          {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        </button>
                        {c.name}
                      </td>
                      <td className="py-3.5 px-4 text-interactive-400">{c.phone || 'N/A'}</td>
                      <td className="py-3.5 px-4">
                        <span className={`px-2 py-0.5 rounded-md font-semibold text-[10px] uppercase border ${
                          c.price_tier === 'Wholesale'
                            ? 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400'
                            : 'bg-zinc-500/10 border-zinc-500/20 text-zinc-400'
                        }`}>
                          {c.price_tier}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-interactive-500 font-mono font-medium">{formatCurrency(c.credit_limit)}</td>
                      <td className={`py-3.5 px-4 text-right font-mono font-bold ${
                        isOver ? 'text-rose-400' : c.current_balance > 0 ? 'text-amber-400' : 'text-emerald-400'
                      }`}>
                        {formatCurrency(c.current_balance)}
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <button
                          onClick={() => setPaymentCustomer(c)}
                          className="px-2.5 py-1.5 bg-emerald-600/15 hover:bg-emerald-600 text-emerald-400 hover:text-white border border-emerald-500/20 hover:border-transparent rounded-lg font-medium transition-all"
                        >
                          Receive Payment
                        </button>
                      </td>
                    </tr>

                    {/* Expandable Ledger Detail Panel */}
                    {isExpanded && (
                      <tr>
                        <td colSpan={6} className="bg-surface-900/60 p-4 border-b border-surface-800">
                          <div className="space-y-4">
                            <div className="flex justify-between items-center">
                              <h4 className="font-bold text-white text-xs">Customer Ledger & HMAC Integrity Logs</h4>
                              {ledgerLoading ? (
                                <span className="text-interactive-400 text-xs flex items-center gap-1.5">
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  Loading ledger...
                                </span>
                              ) : integrityViolated ? (
                                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 font-bold text-[10px] border border-rose-900/20 animate-pulse">
                                  <ShieldAlert className="w-3 h-3" />
                                  TAMPER DETECTION TRIGGERED: Signature Mismatch
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 font-bold text-[10px] border border-emerald-900/20">
                                  <ShieldCheck className="w-3 h-3" />
                                  Ledger Cryptographic Audit Verified
                                </span>
                              )}
                            </div>

                            {ledgerLoading ? null : ledgerData.length === 0 ? (
                              <p className="text-interactive-400 text-xs">No historical ledger transactions.</p>
                            ) : (
                              <div className="border border-surface-800 rounded-lg overflow-hidden">
                                <table className="w-full text-left text-[11px]">
                                  <thead>
                                    <tr className="bg-surface-950 text-interactive-400 font-semibold border-b border-surface-700">
                                      <th className="py-2 px-3">Date</th>
                                      <th className="py-2 px-3">Description</th>
                                      <th className="py-2 px-3 text-right">Debit (+)</th>
                                      <th className="py-2 px-3 text-right">Credit (-)</th>
                                      <th className="py-2 px-3 text-center">HMAC Signature</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {ledgerData.map(entry => (
                                      <tr key={entry.id} className="border-b border-surface-700 hover:bg-surface-950/20">
                                        <td className="py-2 px-3 text-interactive-400">{formatDate(entry.date)}</td>
                                        <td className="py-2 px-3 text-interactive-500">{entry.description}</td>
                                        <td className="py-2 px-3 text-right text-rose-400 font-mono font-medium">
                                          {entry.type === 'DEBIT' ? formatCurrency(entry.amount) : '-'}
                                        </td>
                                        <td className="py-2 px-3 text-right text-emerald-400 font-mono font-medium">
                                          {entry.type === 'CREDIT' ? formatCurrency(entry.amount) : '-'}
                                        </td>
                                        <td className="py-2 px-3 text-center text-interactive-400 font-mono text-[9px] truncate max-w-[120px]">
                                          {entry.hmac_signature ? entry.hmac_signature.slice(0, 16) + '...' : 'GENESIS'}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <CustomerFormModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSuccess={loadCustomers}
      />

      <PaymentModal
        isOpen={!!paymentCustomer}
        onClose={() => setPaymentCustomer(null)}
        customer={paymentCustomer}
        onSuccess={loadCustomers}
      />
    </div>
  );
}
