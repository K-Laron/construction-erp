"use client";

import { useState, useEffect } from 'react';
import { Search, PlusCircle, AlertTriangle, Loader2 } from 'lucide-react';
import { getInventory } from '@/app/actions/inventory';
import { formatCurrency, formatQuantity } from '@/lib/format';
import { InventoryItem } from '@/types';
import ProductFormModal from './ProductFormModal';

export default function InventoryManager() {
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [showAddModal, setShowAddModal] = useState(false);

  const loadInventory = async () => {
    setLoading(true);
    try {
      const data = await getInventory();
      setInventory(data);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadInventory();
  }, []);

  const categories = ['All', ...Array.from(new Set(inventory.map(i => i.category)))];

  const filteredItems = inventory.filter(item => {
    const matchesSearch = item.name.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = selectedCategory === 'All' || item.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="flex-1 p-6 space-y-6 overflow-y-auto no-print">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-800 pb-5">
        <div>
          <h1 className="text-xl font-bold text-white">Stock Inventory</h1>
          <p className="text-slate-400 text-xs mt-1">Monitor quantities, unit conversions, and pricing</p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl text-xs flex items-center gap-2 transition-all shadow-lg hover:shadow-emerald-500/20"
        >
          <PlusCircle className="w-4 h-4" />
          Add Product
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search stock catalog..."
            className="w-full pl-10 pr-4 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 text-xs transition-all"
          />
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all border ${
                selectedCategory === cat
                  ? 'bg-emerald-600/10 border-emerald-500/40 text-emerald-400'
                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="border border-slate-800 rounded-xl p-12 text-center text-slate-500 text-sm">
          No inventory products found matching filters.
        </div>
      ) : (
        <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950/40">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-900 text-slate-400 font-semibold border-b border-slate-800 uppercase tracking-wider">
                <th className="py-3 px-4">Product Name</th>
                <th className="py-3 px-4">Category</th>
                <th className="py-3 px-4">Selling Unit</th>
                <th className="py-3 px-4 text-right">Available Stock</th>
                <th className="py-3 px-4 text-right">Cost Price</th>
                <th className="py-3 px-4 text-right">Retail Price</th>
                <th className="py-3 px-4 text-right">Wholesale Price</th>
                <th className="py-3 px-4 text-right">Reorder Limit</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map(item => {
                const lowStock = item.stock_quantity <= item.reorder_level;
                return (
                  <tr
                    key={item.id}
                    className={`border-b border-slate-850 hover:bg-slate-900/30 transition-colors ${
                      lowStock ? 'bg-rose-950/5' : ''
                    }`}
                  >
                    <td className="py-3.5 px-4 font-bold text-white flex items-center gap-2">
                      {lowStock && <AlertTriangle className="w-3.5 h-3.5 text-rose-500 animate-pulse" />}
                      {item.name}
                    </td>
                    <td className="py-3.5 px-4 text-slate-400">{item.category}</td>
                    <td className="py-3.5 px-4 text-slate-400">{item.unit}</td>
                    <td className={`py-3.5 px-4 text-right font-mono font-semibold ${lowStock ? 'text-rose-400 font-bold' : 'text-slate-200'}`}>
                      {formatQuantity(item.stock_quantity)}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono text-slate-400">{formatCurrency(item.cost_price)}</td>
                    <td className="py-3.5 px-4 text-right font-mono text-emerald-400 font-bold">{formatCurrency(item.selling_price)}</td>
                    <td className="py-3.5 px-4 text-right font-mono text-indigo-400 font-semibold">{formatCurrency(item.wholesale_price)}</td>
                    <td className="py-3.5 px-4 text-right font-mono text-slate-400">{formatQuantity(item.reorder_level)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <ProductFormModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSuccess={loadInventory}
      />
    </div>
  );
}
