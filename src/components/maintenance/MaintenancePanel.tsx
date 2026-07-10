"use client";

import { useState, useEffect } from 'react';
import { ShieldCheck, ShieldAlert, Key, Download, Plus, Loader2, RefreshCw, Search, RotateCcw } from 'lucide-react';
import { getUsers, createUser } from '@/app/actions/auth';
import { exportEncryptedBackup, getBackupLogs } from '@/app/actions/backup';
import { runDailyGLScan } from '@/app/actions/ledger';
import { getCustomers, getCustomerLedger } from '@/app/actions/customers';
import { formatCurrency, formatQuantity } from '@/lib/format';
import { toast } from 'sonner';

interface MaintenancePanelProps {
  currentUser: any;
}

export default function MaintenancePanel({ currentUser }: MaintenancePanelProps) {
  const [tab, setTab] = useState<'settings' | 'returns'>('settings');
  const [users, setUsers] = useState<any[]>([]);
  const [backupLogs, setBackupLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Ledger Integrity scan state
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<'clean' | 'violated' | null>(null);
  const [integrityDetails, setIntegrityDetails] = useState('');

  // Add User Form state
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'Cashier' | 'Manager' | 'Admin'>('Cashier');
  const [pin, setPin] = useState('');
  const [formError, setFormError] = useState('');
  const [formLoading, setFormLoading] = useState(false);

  // Returns tab states
  const [txnSearchId, setTxnSearchId] = useState('');
  const [searchingTxn, setSearchingTxn] = useState(false);
  const [activeTxnDetails, setActiveTxnDetails] = useState<any>(null);
  const [returnQtys, setReturnQtys] = useState<Record<string, string>>({});
  const [returnLoading, setReturnLoading] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const uData = await getUsers();
      setUsers(uData);
      
      const bLogs = await getBackupLogs();
      setBackupLogs(bLogs);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setFormLoading(true);
    try {
      await createUser(currentUser.id, username, name, role, pin);
      setUsername('');
      setName('');
      setRole('Cashier');
      setPin('');
      const uData = await getUsers();
      setUsers(uData);
      toast.success('Staff user created successfully!');
    } catch (err: any) {
      setFormError(err.message || 'Failed to create user.');
    }
    setFormLoading(false);
  };

  const handleExportBackup = async () => {
    try {
      const result = await exportEncryptedBackup();
      if (result.success && result.data && result.filename) {
        const binaryString = atob(result.data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: 'application/octet-stream' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = result.filename;
        a.click();
        window.URL.revokeObjectURL(url);
      } else {
        toast.error('Backup failed: ' + result.error);
      }
    } catch (err: any) {
      toast.error('Backup failed: ' + err.message);
    }
  };

  const handleScanIntegrity = async () => {
    setScanning(true);
    setScanResult(null);
    try {
      const glScan = await runDailyGLScan();
      const customers = await getCustomers();
      let customerTampered = false;
      const tamperedList: string[] = [];

      for (const cust of customers) {
        const { isIntegrityViolated } = await getCustomerLedger(cust.id);
        if (isIntegrityViolated) {
          customerTampered = true;
          tamperedList.push(cust.name);
        }
      }

      if (glScan.isCorrupt || customerTampered) {
        setScanResult('violated');
        let details = '';
        if (glScan.isCorrupt) {
          details += `General Ledger Trial Balance discrepancy found in journal entries: ${glScan.corruptEntries.join(', ')}. `;
        }
        if (customerTampered) {
          details += `HMAC signature mismatch in customer ledger chains for: ${tamperedList.join(', ')}.`;
        }
        setIntegrityDetails(details);
      } else {
        setScanResult('clean');
        setIntegrityDetails('All ledger accounts balanced. All customer ledger cryptographic signature chains verified intact.');
      }
    } catch (err: any) {
      setIntegrityDetails(err.message || 'Scan failed.');
    }
    setScanning(false);
  };

  // Search Transaction for Returns
  const handleSearchTxn = async () => {
    if (!txnSearchId) return;
    setSearchingTxn(true);
    setActiveTxnDetails(null);
    try {
      const { getTransactionDetails } = await import('@/app/actions/transactions');
      const details = await getTransactionDetails(txnSearchId);
      if (details && details.transaction) {
        setActiveTxnDetails(details);
        // Pre-populate return quantities to 0
        const initialQtys: Record<string, string> = {};
        details.items.forEach((item: any) => {
          initialQtys[item.item_id] = '0';
        });
        setReturnQtys(initialQtys);
      } else {
        toast.error('Transaction not found.');
      }
    } catch (err: any) {
      toast.error('Error finding transaction: ' + err.message);
    }
    setSearchingTxn(false);
  };

  // Submit Sales Return
  const handleSubmitReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTxnDetails) return;
    setReturnLoading(true);
    try {
      const { processReturn } = await import('@/app/actions/transactions');
      const itemsToReturn = Object.entries(returnQtys)
        .map(([itemId, qtyStr]) => ({
          itemId,
          quantity: Math.round(parseFloat(qtyStr) * 1000) // Convert back to millicounts
        }))
        .filter(item => item.quantity > 0);

      if (itemsToReturn.length === 0) {
        throw new Error('Please enter a return quantity greater than 0.');
      }

      await processReturn(activeTxnDetails.transaction.id, itemsToReturn);
      toast.success('Return processed and inventory restocked successfully!');
      setActiveTxnDetails(null);
      setTxnSearchId('');
    } catch (err: any) {
      toast.error('Failed to process return: ' + err.message);
    }
    setReturnLoading(false);
  };

  return (
    <div className="flex-1 p-6 space-y-6 overflow-y-auto no-print">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-800 pb-5">
        <div>
          <h1 className="text-xl font-bold text-white">System Maintenance</h1>
          <p className="text-slate-400 text-xs mt-1">Audit security logs, run database integrity scans, manage users, and export backups</p>
        </div>

        {/* Tab Buttons */}
        <div className="flex gap-1.5 p-1 bg-slate-900 rounded-xl border border-slate-800">
          <button
            onClick={() => setTab('settings')}
            className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
              tab === 'settings' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            System Settings
          </button>
          <button
            onClick={() => setTab('returns')}
            className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
              tab === 'returns' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Sales Returns & Voids
          </button>
        </div>
      </div>

      {tab === 'settings' ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* User Management */}
          <div className="p-5 border border-slate-800 rounded-xl bg-slate-950/40 space-y-4">
            <h3 className="font-bold text-white text-sm flex items-center gap-2">
              <Key className="w-4 h-4 text-indigo-400" />
              Staff Accounts
            </h3>

            <div className="border border-slate-800 rounded-lg overflow-hidden max-h-52 overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-900 text-slate-400 font-semibold border-b border-slate-800">
                  <tr>
                    <th className="py-2 px-3">Name</th>
                    <th className="py-2 px-3">Username</th>
                    <th className="py-2 px-3 text-right">Role</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id} className="border-b border-slate-850">
                      <td className="py-2 px-3 text-white font-bold">{u.name}</td>
                      <td className="py-2 px-3 text-slate-400 font-mono">{u.username}</td>
                      <td className="py-2 px-3 text-right">
                        <span className="px-2 py-0.5 rounded-full bg-indigo-500/10 border border-indigo-900/30 text-indigo-450 font-semibold text-[9px] uppercase">
                          {u.role}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Add User Form */}
            {currentUser.role === 'Admin' || currentUser.role === 'Manager' ? (
              <form onSubmit={handleAddUser} className="border-t border-slate-800/80 pt-4 space-y-3">
                <span className="text-slate-400 text-xs font-semibold uppercase block">Create Staff User</span>
                {formError && <p className="text-rose-400 text-xs">{formError}</p>}
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="text"
                    placeholder="Display Name"
                    required
                    value={name}
                    onChange={e => setName(e.target.value)}
                    className="px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white text-xs focus:outline-none focus:border-indigo-500"
                  />
                  <input
                    type="text"
                    placeholder="Username"
                    required
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    className="px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white text-xs focus:outline-none focus:border-indigo-500 font-mono"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <select
                    value={role}
                    onChange={e => setRole(e.target.value as 'Cashier' | 'Manager' | 'Admin')}
                    className="px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white text-xs focus:outline-none focus:border-indigo-500"
                  >
                    <option value="Cashier">Cashier</option>
                    <option value="Manager">Manager</option>
                    <option value="Admin">Admin</option>
                  </select>
                  <input
                    type="password"
                    placeholder="PIN code (numeric)"
                    required
                    value={pin}
                    onChange={e => setPin(e.target.value)}
                    className="px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white text-xs focus:outline-none focus:border-indigo-500 font-mono"
                  />
                </div>
                <button
                  type="submit"
                  disabled={formLoading}
                  className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-semibold rounded-xl text-xs transition-all flex items-center justify-center gap-1"
                >
                  {formLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  Register Account
                </button>
              </form>
            ) : null}
          </div>

          {/* Database backup & integrity */}
          <div className="space-y-6">
            {/* Backup Panel */}
            <div className="p-5 border border-slate-800 rounded-xl bg-slate-950/40 space-y-4">
              <h3 className="font-bold text-white text-sm flex items-center gap-2">
                <Download className="w-4 h-4 text-emerald-400" />
                Secure Data Backups
              </h3>
              <p className="text-slate-400 text-xs leading-relaxed">
                Export an encrypted archive of the database. Backup payloads use native SQLite WAL checkpointing and are AES-256-GCM encrypted via your MLEK.
              </p>
              <button
                onClick={handleExportBackup}
                className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl text-xs transition-all flex items-center justify-center gap-2 shadow-lg hover:shadow-emerald-500/10"
              >
                <Download className="w-4 h-4" />
                Export Encrypted Database Backup
              </button>

              {/* Backup status logs */}
              <div className="border-t border-slate-800/80 pt-4">
                <span className="text-slate-450 text-[10px] uppercase font-bold tracking-wider block mb-2">
                  Nightly Cron Backups (11:00 PM)
                </span>
                {backupLogs.length === 0 ? (
                  <p className="text-slate-550 text-xs italic">No historical backups logged.</p>
                ) : (
                  <div className="space-y-1 max-h-24 overflow-y-auto pr-1">
                    {backupLogs.map(log => (
                      <div key={log.id} className="flex justify-between text-[10px] font-mono text-slate-500">
                        <span>{log.timestamp}</span>
                        <span className="text-emerald-500 font-bold">✓ Complete</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Cryptographic Ledger Integrity Scan */}
            <div className="p-5 border border-slate-800 rounded-xl bg-slate-950/40 space-y-4">
              <h3 className="font-bold text-white text-sm flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                Cryptographic Audit Scanner
              </h3>
              <p className="text-slate-400 text-xs leading-relaxed">
                Run E2E validation. Computes double-entry General Ledger balances and walks the customer ledger HMAC signature chains to assert zero unauthorized database alterations.
              </p>

              <button
                onClick={handleScanIntegrity}
                disabled={scanning}
                className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-white border border-slate-700/60 rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-2"
              >
                {scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                {scanning ? 'Auditing Ledgers...' : 'Run Ledger Audit Scan'}
              </button>

              {scanResult && (
                <div className={`p-4 border rounded-xl flex items-start gap-3 animate-[fadeIn_0.2s_ease-out] ${
                  scanResult === 'clean'
                    ? 'bg-emerald-950/20 border-emerald-900/40 text-emerald-400'
                    : 'bg-rose-950/20 border-rose-900/40 text-rose-400'
                }`}>
                  {scanResult === 'clean' ? (
                    <>
                      <ShieldCheck className="w-5 h-5 shrink-0" />
                      <div>
                        <h4 className="font-bold text-sm text-white">Cryptographic Chain Verified</h4>
                        <p className="text-xs mt-1 text-slate-300">{integrityDetails}</p>
                      </div>
                    </>
                  ) : (
                    <>
                      <ShieldAlert className="w-5 h-5 shrink-0 animate-bounce" />
                      <div>
                        <h4 className="font-bold text-sm text-rose-350">INTEGRITY VIOLATION DETECTED</h4>
                        <p className="text-xs mt-1 text-rose-300">{integrityDetails}</p>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* Sales Returns Tab - Task 8.1 */
        <div className="max-w-2xl mx-auto border border-slate-800 rounded-xl bg-slate-950/40 p-6 space-y-6">
          <div className="space-y-1">
            <h3 className="font-bold text-white text-sm flex items-center gap-2">
              <RotateCcw className="w-4 h-4 text-indigo-400" />
              Process Sales Return / Void
            </h3>
            <p className="text-slate-400 text-xs leading-relaxed">
              Enter a valid transaction ID to pull invoice items, calculate vatable reversals, and restock inventory counts.
            </p>
          </div>

          <div className="flex gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="text"
                value={txnSearchId}
                onChange={e => setTxnSearchId(e.target.value)}
                placeholder="Enter Transaction UUID..."
                className="w-full pl-10 pr-4 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-white text-xs font-mono focus:outline-none focus:border-indigo-500"
              />
            </div>
            <button
              onClick={handleSearchTxn}
              disabled={searchingTxn || !txnSearchId}
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-semibold rounded-xl text-xs transition-all flex items-center gap-1.5"
            >
              {searchingTxn ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
              Find Invoice
            </button>
          </div>

          {activeTxnDetails && (
            <form onSubmit={handleSubmitReturn} className="border-t border-slate-800/80 pt-5 space-y-5 animate-[fadeIn_0.2s_ease-out]">
              <div className="grid grid-cols-2 gap-4 text-xs bg-slate-900/40 p-3.5 border border-slate-800 rounded-xl">
                <div>
                  <span className="text-slate-400 block mb-0.5">Original Sales Invoice:</span>
                  <span className="font-mono font-semibold text-white">#{activeTxnDetails.transaction.sales_invoice_number || 'N/A'}</span>
                </div>
                <div>
                  <span className="text-slate-400 block mb-0.5">Total Amount:</span>
                  <span className="font-mono font-semibold text-white">{formatCurrency(activeTxnDetails.transaction.total_amount)}</span>
                </div>
              </div>

              <div className="space-y-3">
                <span className="text-slate-450 text-[10px] uppercase font-bold tracking-wider block">Return Items Configuration</span>
                <div className="border border-slate-800 rounded-xl overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-900 text-slate-400 font-semibold border-b border-slate-800">
                      <tr>
                        <th className="py-2 px-3">Item Name</th>
                        <th className="py-2 px-3 text-center">Billed Qty</th>
                        <th className="py-2 px-3 text-right">Return Qty</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeTxnDetails.items.map((item: any) => (
                        <tr key={item.item_id} className="border-b border-slate-850">
                          <td className="py-2 px-3 text-white font-bold">{item.item_name}</td>
                          <td className="py-2 px-3 text-center text-slate-400 font-mono">
                            {formatQuantity(item.quantity)} {item.item_unit}
                          </td>
                          <td className="py-2 px-3 text-right">
                            <div className="inline-flex items-center gap-1.5 justify-end">
                              <input
                                type="number"
                                step="0.001"
                                min="0"
                                max={item.quantity / 1000}
                                value={returnQtys[item.item_id] || '0'}
                                onChange={e => {
                                  const updated = { ...returnQtys };
                                  updated[item.item_id] = e.target.value;
                                  setReturnQtys(updated);
                                }}
                                className="w-20 px-2 py-1 bg-slate-950 border border-slate-700 rounded-md text-right text-white font-mono"
                              />
                              <span className="text-slate-500 font-medium w-8 text-left">{item.item_unit}</span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setActiveTxnDetails(null)}
                  className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium rounded-xl text-sm transition-all"
                >
                  Clear search
                </button>
                <button
                  type="submit"
                  disabled={returnLoading}
                  className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-500 text-white font-semibold rounded-xl text-sm transition-all flex items-center justify-center gap-1.5"
                >
                  {returnLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                  Confirm Return & Restock
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
