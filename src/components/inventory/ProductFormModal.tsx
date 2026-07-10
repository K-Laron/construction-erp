"use client";

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { createProduct } from '@/app/actions/inventory';
import { parsePesoCentavos, parseMillicounts } from '@/lib/format';

interface ProductFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function ProductFormModal({ isOpen, onClose, onSuccess }: ProductFormModalProps) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('Masonry');
  const [unit, setUnit] = useState('pc');
  const [stockQtyStr, setStockQtyStr] = useState('0');
  const [costPriceStr, setCostPriceStr] = useState('0.00');
  const [sellingPriceStr, setSellingPriceStr] = useState('0.00');
  const [wholesalePriceStr, setWholesalePriceStr] = useState('0.00');
  const [reorderLevelStr, setReorderLevelStr] = useState('0');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name) return;
    setError('');
    setLoading(true);

    try {
      const stockQtyMillicounts = parseMillicounts(stockQtyStr);
      const reorderLevelMillicounts = parseMillicounts(reorderLevelStr);
      const costCentavos = parsePesoCentavos(costPriceStr);
      const sellingCentavos = parsePesoCentavos(sellingPriceStr);
      const wholesaleCentavos = parsePesoCentavos(wholesalePriceStr);

      const result = await createProduct(
        name, category, unit,
        stockQtyMillicounts, costCentavos,
        sellingCentavos, wholesaleCentavos,
        reorderLevelMillicounts
      );
      if (!result.success) throw new Error(result.error);
      if (!result.success) throw new Error(result.error);

      onSuccess();
      onClose();
      // Reset form
      setName('');
      setCategory('Masonry');
      setUnit('pc');
      setStockQtyStr('0');
      setCostPriceStr('0.00');
      setSellingPriceStr('0.00');
      setWholesalePriceStr('0.00');
      setReorderLevelStr('0');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create product.');
    }
    setLoading(false);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add New Inventory Product" size="md">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-rose-950/20 border border-rose-900/40 rounded-xl text-rose-300 text-xs">
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label htmlFor="product-name" className="block text-xs font-semibold text-interactive-400 mb-1.5 uppercase">Product Name</label>
            <input
              id="product-name"
              type="text"
              required
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g., Gravel 3/4, Portland Cement..."
              className="w-full px-3.5 py-2 bg-surface-950 border border-surface-700 rounded-xl text-interactive-500 text-sm focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="product-category" className="block text-xs font-semibold text-interactive-400 mb-1.5 uppercase">Category</label>
            <select
              id="product-category"
              value={category}
              onChange={e => setCategory(e.target.value)}
              className="w-full px-3.5 py-2 bg-surface-950 border border-surface-700 rounded-xl text-interactive-500 text-sm focus:outline-none focus:border-indigo-500"
            >
              <option value="Masonry">Masonry</option>
              <option value="Aggregates">Aggregates</option>
              <option value="Cement">Cement</option>
              <option value="Steel">Steel</option>
              <option value="Others">Others</option>
            </select>
          </div>
          <div>
            <label htmlFor="product-unit" className="block text-xs font-semibold text-interactive-400 mb-1.5 uppercase">Selling Unit</label>
            <input
              id="product-unit"
              type="text"
              required
              value={unit}
              onChange={e => setUnit(e.target.value)}
              placeholder="e.g., pc, bag, cu.m"
              className="w-full px-3.5 py-2 bg-surface-950 border border-surface-700 rounded-xl text-interactive-500 text-sm focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="product-stock" className="block text-xs font-semibold text-interactive-400 mb-1.5 uppercase">Initial Stock</label>
            <input
              id="product-stock"
              type="number"
              step="0.001"
              required
              value={stockQtyStr}
              onChange={e => setStockQtyStr(e.target.value)}
              className="w-full px-3.5 py-2 bg-surface-950 border border-surface-700 rounded-xl text-interactive-500 text-sm focus:outline-none focus:border-indigo-500 font-mono font-bold"
            />
          </div>
          <div>
            <label htmlFor="product-reorder" className="block text-xs font-semibold text-interactive-400 mb-1.5 uppercase">Reorder Level Alert</label>
            <input
              id="product-reorder"
              type="number"
              step="0.001"
              required
              value={reorderLevelStr}
              onChange={e => setReorderLevelStr(e.target.value)}
              className="w-full px-3.5 py-2 bg-surface-950 border border-surface-700 rounded-xl text-interactive-500 text-sm focus:outline-none focus:border-indigo-500 font-mono font-bold"
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label htmlFor="product-cost-price" className="block text-[10px] font-semibold text-interactive-400 mb-1.5 uppercase">Cost Price</label>
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-interactive-400 text-xs">₱</span>
              <input
                id="product-cost-price"
                type="number"
                step="0.01"
                required
                value={costPriceStr}
                onChange={e => setCostPriceStr(e.target.value)}
                className="w-full pl-5 pr-2 py-2 bg-surface-950 border border-surface-700 rounded-xl text-interactive-500 text-xs focus:outline-none focus:border-indigo-500 font-mono"
              />
            </div>
          </div>
          <div>
            <label htmlFor="product-retail-price" className="block text-[10px] font-semibold text-interactive-400 mb-1.5 uppercase">Retail Price</label>
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-interactive-400 text-xs">₱</span>
              <input
                id="product-retail-price"
                type="number"
                step="0.01"
                required
                value={sellingPriceStr}
                onChange={e => setSellingPriceStr(e.target.value)}
                className="w-full pl-5 pr-2 py-2 bg-surface-950 border border-surface-700 rounded-xl text-interactive-500 text-xs focus:outline-none focus:border-indigo-500 font-mono"
              />
            </div>
          </div>
          <div>
            <label htmlFor="product-wholesale-price" className="block text-[10px] font-semibold text-interactive-400 mb-1.5 uppercase">Wholesale Price</label>
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-interactive-400 text-xs">₱</span>
              <input
                id="product-wholesale-price"
                type="number"
                step="0.01"
                required
                value={wholesalePriceStr}
                onChange={e => setWholesalePriceStr(e.target.value)}
                className="w-full pl-5 pr-2 py-2 bg-surface-950 border border-surface-700 rounded-xl text-interactive-500 text-xs focus:outline-none focus:border-indigo-500 font-mono"
              />
            </div>
          </div>
        </div>

        <div className="flex gap-3 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 bg-surface-800 hover:bg-surface-700 text-interactive-400 font-medium rounded-xl text-sm transition-all"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-interactive-500 font-semibold rounded-xl text-sm transition-all flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Add Product
          </button>
        </div>
      </form>
    </Modal>
  );
}
