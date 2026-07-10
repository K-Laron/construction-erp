"use client";
import { SkeletonTable } from "@/components/ui/Skeleton";

import { useState, useEffect } from 'react';
import { logger } from "@/lib/logger";
import { toast } from "sonner";
import { BarChart3, TrendingUp, DollarSign, Users, Package, Loader2 } from 'lucide-react';
import { getTrialBalance, runHeavyAuditReport } from '@/app/actions/ledger';
import { getInventory } from '@/app/actions/inventory';
import { getCustomers } from '@/app/actions/customers';
import { formatCurrency } from '@/lib/format';
import { InventoryItem, Customer } from '@/types';

export default function ReportsPanel() {
  const [loading, setLoading] = useState(true);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [glAccounts, setGlAccounts] = useState<any[]>([]);
  
  // Dashboard aggregates
  const [totals, setTotals] = useState({
    todaySales: 0,
    cashCollections: 0,
    outstandingAR: 0,
    inventoryValue: 0
  });

  const [agingList, setAgingList] = useState<Customer[]>([]);
  const [margins, setMargins] = useState<any[]>([]);

  useEffect(() => {
    async function loadReports() {
      setLoading(true);
      try {
        const invData = await getInventory();
        const custData = await getCustomers();
        const glData = await getTrialBalance();
        
        setInventory(invData);
        setCustomers(custData);
        setGlAccounts(glData);

        // Calculate outstanding AR
        const arAcc = glData.find(a => a.code === '1110'); // Accounts Receivable
        const cashAcc = glData.find(a => a.code === '1010'); // Cash Drawer
        
        // Calculate total inventory cost value
        const totalInvCost = invData.reduce((sum, item) => sum + Math.round((item.stock_quantity * item.cost_price) / 1000), 0);

        // Fetch today's sales from ledger worker query
        const todaySalesRaw = await runHeavyAuditReport('TODAY_SALES');
        const todaySales = todaySalesRaw[0]?.total || 0;

        // Fetch today's cash collections
        const todayCollectionsRaw = await runHeavyAuditReport('TODAY_COLLECTIONS');
        const todayCollections = todayCollectionsRaw[0]?.total || 0;

        setTotals({
          todaySales,
          cashCollections: todayCollections,
          outstandingAR: arAcc?.balance || 0,
          inventoryValue: totalInvCost
        });

        // Set AR Aging (customers with positive balances, sorted desc)
        const sortedAging = [...custData]
          .filter(c => c.current_balance > 0)
          .sort((a, b) => b.current_balance - a.current_balance);
        setAgingList(sortedAging);

        // Margins analysis
        const calculatedMargins = invData.map(item => {
          const margin = item.selling_price - item.cost_price;
          const pct = item.selling_price > 0 ? (margin / item.selling_price) * 100 : 0;
          return {
            name: item.name,
            category: item.category,
            costPrice: item.cost_price,
            sellingPrice: item.selling_price,
            margin,
            marginPct: pct
          };
        }).sort((a, b) => b.marginPct - a.marginPct);
        setMargins(calculatedMargins);

      } catch (err) {
        logger.error(String(err), err);
        toast.error("Failed to load report data.");
      }
      setLoading(false);
    }
    loadReports();
  }, []);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center no-print">
        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex-1 p-6 space-y-6 overflow-y-auto no-print">
      <div className="border-b border-surface-800 pb-5">
        <h1 className="text-xl font-bold text-white">General Ledger Reports</h1>
        <p className="text-interactive-400 text-xs mt-1">Financial summaries, profitability margins, and A/R aging ledgers</p>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Today's Gross Sales", value: totals.todaySales, icon: TrendingUp, color: 'text-emerald-400' },
          { label: "Today's Cash Collections", value: totals.cashCollections, icon: DollarSign, color: 'text-indigo-400' },
          { label: "Total Outstanding A/R", value: totals.outstandingAR, icon: Users, color: 'text-amber-400' },
          { label: "Inventory Asset Value", value: totals.inventoryValue, icon: Package, color: 'text-interactive-500' }
        ].map((card, i) => {
          const Icon = card.icon;
          return (
            <div key={i} className="p-5 border border-surface-800 rounded-xl bg-surface-950/40 space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-interactive-400 text-xs font-semibold uppercase">{card.label}</span>
                <div className={`p-2 rounded-lg bg-surface-900 border border-surface-800 ${card.color}`}>
                  <Icon className="w-4 h-4" />
                </div>
              </div>
              <p className="text-xl font-extrabold text-white font-mono">{formatCurrency(card.value)}</p>
            </div>
          );
        })}
      </div>

      {/* A/R Aging List and Profit Margins Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Outstanding Receivables Aging */}
        <div className="p-5 border border-surface-800 rounded-xl bg-surface-950/40 space-y-4">
          <h3 className="font-bold text-white text-sm flex items-center gap-2">
            <Users className="w-4 h-4 text-amber-400" />
            Accounts Receivable Aging
          </h3>
          {agingList.length === 0 ? (
            <p className="text-interactive-400 text-xs py-6 text-center">No outstanding customer receivables.</p>
          ) : (
            <div className="border border-surface-800 rounded-lg overflow-hidden max-h-80 overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-surface-900 text-interactive-400 font-semibold border-b border-surface-800">
                  <tr>
                    <th className="py-2.5 px-3">Customer Account</th>
                    <th className="py-2.5 px-3">Price Tier</th>
                    <th className="py-2.5 px-3 text-right">Debit Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {agingList.map(c => (
                    <tr key={c.id} className="border-b border-surface-700 hover:bg-surface-900/30">
                      <td className="py-2.5 px-3 text-white font-bold">{c.name}</td>
                      <td className="py-2.5 px-3 text-slate-450">{c.price_tier}</td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-amber-400">
                        {formatCurrency(c.current_balance)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Product Profit Margins Analysis */}
        <div className="p-5 border border-surface-800 rounded-xl bg-surface-950/40 space-y-4">
          <h3 className="font-bold text-white text-sm flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-emerald-400" />
            Gross Profit Margins
          </h3>
          <div className="border border-surface-800 rounded-lg overflow-hidden max-h-80 overflow-y-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-surface-900 text-interactive-400 font-semibold border-b border-surface-800">
                <tr>
                  <th className="py-2.5 px-3">Product Name</th>
                  <th className="py-2.5 px-3 text-right">Cost</th>
                  <th className="py-2.5 px-3 text-right">Selling</th>
                  <th className="py-2.5 px-3 text-right">Margin (%)</th>
                </tr>
              </thead>
              <tbody>
                {margins.map((item, i) => (
                  <tr key={i} className="border-b border-surface-700 hover:bg-surface-900/30">
                    <td className="py-2.5 px-3 text-white font-bold">{item.name}</td>
                    <td className="py-2.5 px-3 text-right font-mono text-interactive-400">{formatCurrency(item.costPrice)}</td>
                    <td className="py-2.5 px-3 text-right font-mono text-interactive-500">{formatCurrency(item.sellingPrice)}</td>
                    <td className={`py-2.5 px-3 text-right font-mono font-bold ${
                      item.marginPct >= 20 ? 'text-emerald-400' : 'text-interactive-500'
                    }`}>
                      {item.marginPct.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
