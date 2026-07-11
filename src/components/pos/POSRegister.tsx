"use client";


import { useState, useEffect } from 'react';
import { logger } from "@/lib/logger";
import { toast } from "sonner";
import { Search, ShoppingCart, Trash2, Plus, Minus, Tag, Truck, Receipt, Loader2, AlertTriangle } from 'lucide-react';
import { getInventory } from '@/app/actions/inventory';
import { formatCurrency, formatQuantity } from '@/lib/format';
import { InventoryItem } from '@/types';
import { CartItem } from '@/app/actions/transactions';
import CheckoutModal from './CheckoutModal';

interface POSRegisterProps {
  cashierId: string;
  onCheckoutSuccess: (txn: any) => void;
}

export default function POSRegister({ cashierId, onCheckoutSuccess }: POSRegisterProps) {
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  
  // Cart state
  const [cart, setCart] = useState<CartItem[]>([]);
  const [discountStr, setDiscountStr] = useState('');
  const [deliveryFeeStr, setDeliveryFeeStr] = useState('');
  const [taxEnabled, setTaxEnabled] = useState(true);
  
  // Checkout Modal state
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  const loadInventory = async () => {
    setLoading(true);
    try {
      const data = await getInventory();
      setInventory(data);
    } catch (err) {
      logger.error(String(err), err);
      toast.error("Failed to load inventory.");
    }
    setLoading(false);
  };

  useEffect(() => {
    loadInventory();
  }, []);

  const categories = ['All', ...Array.from(new Set(inventory.map(i => i.category)))];

  const filteredItems = inventory.filter(item => {
    const matchesSearch = item.name.toLowerCase().includes(search.toLowerCase()) || 
                          item.category.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = selectedCategory === 'All' || item.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const handleAddToCart = (item: InventoryItem) => {
    // If quantity is too low, alert but allow
    const existing = cart.find(c => c.itemId === item.id);
    const addedQty = item.category === 'Aggregates' ? 500 : 1000; // 0.5 or 1.0 units (millicounts)

    if (existing) {
      setCart(cart.map(c => c.itemId === item.id 
        ? { ...c, quantity: c.quantity + addedQty, totalPrice: Math.round(((c.quantity + addedQty) * c.unitPrice) / 1000) } 
        : c
      ));
    } else {
      setCart([...cart, {
        itemId: item.id,
        name: item.name,
        quantity: addedQty,
        unitUsed: item.unit,
        unitPrice: item.selling_price,
        unitCost: item.cost_price,
        totalPrice: item.selling_price
      }]);
    }
  };

  const updateCartQty = (itemId: string, increment: boolean) => {
    setCart(cart.map(c => {
      if (c.itemId !== itemId) return c;
      const step = c.unitUsed === 'cu.m' ? 500 : 1000; // 0.5 for cubic meters, 1.0 for pieces
      const newQty = increment ? c.quantity + step : Math.max(step, c.quantity - step);
      return {
        ...c,
        quantity: newQty,
        totalPrice: Math.round((newQty * c.unitPrice) / 1000)
      };
    }));
  };

  const removeFromCart = (itemId: string) => {
    setCart(cart.filter(c => c.itemId !== itemId));
  };

  // Cart calculations (in centavos)
  const subtotal = cart.reduce((sum, item) => sum + item.totalPrice, 0);
  const discount = discountStr ? Math.round(parseFloat(discountStr) * 100) : 0;
  const deliveryFee = deliveryFeeStr ? Math.round(parseFloat(deliveryFeeStr) * 100) : 0;
  
  // Tax calculation (12% VAT is included in subtotal and deliveryFee if toggled)
  // VAT = Vatable Sales * 12% -> Extract VAT from inclusive subtotal + deliveryFee
  const tax = taxEnabled ? Math.round(((subtotal - discount + deliveryFee) / 1.12) * 0.12) : 0;
  const totalAmount = Math.max(0, subtotal - discount + deliveryFee);

  const getCategoryColor = (cat: string) => {
    switch (cat.toLowerCase()) {
      case 'masonry': return 'bg-amber-500/10 border-amber-500/30 text-amber-300';
      case 'aggregates': return 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300';
      case 'cement': return 'bg-slate-500/10 border-slate-500/30 text-interactive-500';
      case 'steel': return 'bg-indigo-500/10 border-indigo-500/30 text-indigo-300';
      default: return 'bg-zinc-500/10 border-zinc-500/30 text-zinc-300';
    }
  };

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden no-print">
      {/* Product Catalog */}
      <div className="flex-[3] flex flex-col p-6 overflow-y-auto">
        {/* Filter bar */}
        <div className="flex flex-col sm:flex-row gap-4 mb-6">
          <div className="relative flex-1 group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-interactive-400 group-focus-within:text-accent-500 transition-colors" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search products by name or category..."
              className="w-full pl-12 pr-4 py-3 bg-white border border-surface-800 rounded-xl text-interactive-600 placeholder-slate-400 focus-ring focus:ring-accent-500/40 focus:border-accent-500 transition-smooth text-sm shadow-sm"
            />
          </div>
          <button
            onClick={loadInventory}
            disabled={loading}
            className="px-4 py-3 bg-white border border-surface-800 rounded-xl text-interactive-400 hover:text-interactive-600 transition-smooth flex items-center gap-2 shadow-sm whitespace-nowrap"
          >
            <Loader2 className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span className="text-sm font-semibold">Refresh</span>
          </button>
          <div className="flex gap-2 overflow-x-auto pb-1 sm:pb-0 items-center">
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-4 py-2.5 rounded-xl text-xs font-semibold tracking-wide whitespace-nowrap transition-smooth btn-hover-fx border ${
                  selectedCategory === cat
                    ? 'bg-interactive-600 text-white shadow-md border-transparent'
                    : 'bg-white text-interactive-400 hover:text-interactive-600 border-surface-800'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Product Grid */}
        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-8 h-8 text-accent-500 animate-spin" />
          </div>
        ) : inventory.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-interactive-400">
            <p>No products available.</p>
            <p className="text-sm">Please add items to the inventory.</p>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-interactive-400 gap-2">
            <AlertTriangle className="w-10 h-10 text-interactive-400" />
            <span>No products matching your filters.</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredItems.map(item => {
              const lowStock = item.stock_quantity <= item.reorder_level;
              return (
                <div
                  key={item.id}
                  onClick={() => handleAddToCart(item)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleAddToCart(item);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  className={`p-5 rounded-2xl glass-panel-dense cursor-pointer btn-hover-fx flex flex-col justify-between group ${
                    lowStock ? 'border-error-500/30 hover:border-error-400/50 shadow-[0_0_15px_rgba(255,59,48,0.05)]' : 'hover:border-interactive-600/30'
                  }`}
                >
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <span className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider mb-2 border ${getCategoryColor(item.category)}`}>
                        {item.category}
                      </span>
                      <h3 className="font-bold text-interactive-600 group-hover:text-accent-500 transition-colors">{item.name}</h3>
                      <span className="text-interactive-400 text-xs mt-0.5 block">Selling Unit: {item.unit}</span>
                    </div>
                  </div>
                  
                  <div className="flex justify-between items-end mt-5 pt-4 border-t border-surface-800">
                    <div>
                      <span className="text-[10px] text-interactive-400 uppercase font-bold tracking-wider block mb-1">Stock Level</span>
                      <span className={`font-mono text-sm font-semibold flex items-center gap-1.5 ${lowStock ? 'text-error-600' : 'text-interactive-400'}`}>
                        {formatQuantity(item.stock_quantity)} {item.unit}
                        {lowStock && <span className="px-1.5 py-0.5 rounded-md bg-error-500/10 text-[10px] text-error-600 font-bold border border-error-500/20">LOW</span>}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] text-interactive-400 uppercase font-bold tracking-wider block mb-1">Retail Price</span>
                      <span className="text-lg font-bold text-interactive-600 font-mono">{formatCurrency(item.selling_price)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Cart Drawer */}
      <div className="flex-[2] bg-white border-l border-surface-800 flex flex-col justify-between relative z-10 shadow-[-8px_0_32px_rgba(0,0,0,0.03)]">
        <div className="p-6 border-b border-surface-800 flex items-center justify-between bg-surface-900/50">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-surface-800">
              <ShoppingCart className="w-5 h-5 text-interactive-600" />
            </div>
            <h2 className="text-lg font-bold text-interactive-600 tracking-tight">Current Cart</h2>
          </div>
          <span className="px-3 py-1 rounded-full bg-white border border-surface-800 text-interactive-600 font-bold text-xs shadow-sm">
            {cart.length} items
          </span>
        </div>

        {/* Cart List */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-surface-900/30">
          {cart.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-interactive-400 gap-2">
              <ShoppingCart className="w-10 h-10 text-interactive-500" />
              <span className="text-xs">Your shopping cart is empty.</span>
            </div>
          ) : (
            cart.map(item => (
              <div key={item.itemId} className="p-3.5 bg-white border border-surface-800 rounded-xl flex items-center justify-between gap-4 animate-[slideUp_0.2s_ease-out] shadow-sm">
                <div className="flex-1 min-w-0">
                  <h4 className="font-semibold text-interactive-600 text-sm truncate">{item.name}</h4>
                  <span className="text-interactive-400 text-xs font-mono">
                    {formatCurrency(item.unitPrice)} / {item.unitUsed}
                  </span>
                </div>
                
                {/* Quantity Controls */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => updateCartQty(item.itemId, false)}
                    className="p-1 rounded-lg bg-surface-900 hover:bg-surface-800 text-interactive-600 transition-all border border-surface-800"
                  >
                    <Minus className="w-3.5 h-3.5" />
                  </button>
                  <span className="font-mono text-sm text-interactive-600 font-semibold w-12 text-center">
                    {formatQuantity(item.quantity)}
                  </span>
                  <button
                    onClick={() => updateCartQty(item.itemId, true)}
                    className="p-1 rounded-lg bg-surface-900 hover:bg-surface-800 text-interactive-600 transition-all border border-surface-800"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Price & Delete */}
                <div className="flex items-center gap-3">
                  <span className="font-mono font-bold text-interactive-600 text-base">
                    {formatCurrency(item.totalPrice)}
                  </span>
                  <button
                    onClick={() => removeFromCart(item.itemId)}
                    className="p-2 rounded-xl bg-surface-900 hover:bg-error-500/10 text-interactive-400 hover:text-error-500 border border-surface-800 hover:border-error-500/20 transition-smooth group"
                  >
                    <Trash2 className="w-4 h-4 group-hover:scale-110 transition-transform" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Calculations and Actions */}
        <div className="p-6 border-t border-surface-800 bg-white space-y-5">
          <div className="space-y-3 text-xs">
            {/* Delivery fee Input */}
            <div className="flex justify-between items-center">
              <span className="text-interactive-400 flex items-center gap-1.5">
                <Truck className="w-3.5 h-3.5 text-interactive-400" />
                Delivery Fee
              </span>
              <div className="relative w-28">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-interactive-400 font-medium">₱</span>
                <input
                  type="number"
                  placeholder="0.00"
                  value={deliveryFeeStr}
                  onChange={e => setDeliveryFeeStr(e.target.value)}
                  className="w-full pl-6 pr-2 py-1.5 bg-surface-900 border border-surface-800 rounded-lg text-interactive-600 font-mono text-right focus-ring focus:border-accent-500"
                />
              </div>
            </div>

            {/* Discount Input */}
            <div className="flex justify-between items-center">
              <span className="text-interactive-400 flex items-center gap-1.5">
                <Tag className="w-3.5 h-3.5 text-interactive-400" />
                Discount
              </span>
              <div className="relative w-28">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-interactive-400 font-medium">₱</span>
                <input
                  type="number"
                  placeholder="0.00"
                  value={discountStr}
                  onChange={e => setDiscountStr(e.target.value)}
                  className="w-full pl-6 pr-2 py-1.5 bg-surface-900 border border-surface-800 rounded-lg text-interactive-600 font-mono text-right focus-ring focus:border-accent-500"
                />
              </div>
            </div>

            {/* Tax Toggle */}
            <div className="flex justify-between items-center">
              <span className="text-interactive-400 flex items-center gap-1.5">
                <Receipt className="w-3.5 h-3.5 text-interactive-400" />
                VAT Tax (12%)
              </span>
              <button
                onClick={() => setTaxEnabled(!taxEnabled)}
                className={`px-3 py-1.5 rounded-lg border font-semibold transition-all ${
                  taxEnabled
                    ? 'bg-accent-500/10 border-accent-500/20 text-accent-600'
                    : 'bg-surface-900 border-surface-800 text-interactive-400'
                }`}
              >
                {taxEnabled ? 'Enabled' : 'Disabled'}
              </button>
            </div>
            {!taxEnabled && (
              <div className="text-[10px] text-amber-500/80 leading-tight">
                Note: Prices remain VAT-inclusive. Disabling VAT reports the sale as zero-rated to the BIR but does not automatically discount the customer total.
              </div>
            )}
          </div>

          <div className="h-px bg-surface-800 my-3" />

          {/* Totals Summary */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-interactive-400">
              <span>Subtotal</span>
              <span className="font-mono text-interactive-600">{formatCurrency(subtotal)}</span>
            </div>
            {taxEnabled && (
              <div className="flex justify-between text-xs text-interactive-400">
                <span>VAT Collected (12%)</span>
                <span className="font-mono text-interactive-600">{formatCurrency(tax)}</span>
              </div>
            )}
            {discount > 0 && (
              <div className="flex justify-between text-xs text-error-500">
                <span>Discount</span>
                <span className="font-mono">-{formatCurrency(discount)}</span>
              </div>
            )}
            {deliveryFee > 0 && (
              <div className="flex justify-between text-xs text-interactive-400">
                <span>Delivery Charge</span>
                <span className="font-mono text-interactive-600">+{formatCurrency(deliveryFee)}</span>
              </div>
            )}
            <div className="flex justify-between items-end pt-2 pb-1">
              <span className="text-sm font-bold text-interactive-600 tracking-wide">Grand Total</span>
              <span className="text-2xl font-bold text-interactive-600 font-mono">
                {formatCurrency(totalAmount)}
              </span>
            </div>
          </div>

          {/* Checkout Button */}
          <button
            onClick={() => setCheckoutOpen(true)}
            disabled={cart.length === 0}
            className="w-full py-4 bg-interactive-600 hover:bg-interactive-500 disabled:bg-surface-800 disabled:text-interactive-400 text-white font-bold rounded-xl text-base btn-hover-fx flex items-center justify-center gap-2"
          >
            <ShoppingCart className="w-5 h-5" />
            Go to Checkout
          </button>
        </div>
      </div>

      <CheckoutModal
        isOpen={checkoutOpen}
        onClose={() => setCheckoutOpen(false)}
        cartItems={cart}
        totals={{ subtotal, tax, deliveryFee, discount, totalAmount }}
        onSuccess={txn => {
          setCart([]);
          setDiscountStr('');
          setDeliveryFeeStr('');
          loadInventory();
          onCheckoutSuccess(txn);
        }}
        cashierId={cashierId}
      />
    </div>
  );
}
