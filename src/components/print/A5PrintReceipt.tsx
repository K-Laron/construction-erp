import { formatCurrency, formatQuantity, formatDate } from '@/lib/format';

interface A5PrintReceiptProps {
  transaction: any;
  items: any[];
  customerName?: string;
}

export default function A5PrintReceipt({ transaction, items, customerName }: A5PrintReceiptProps) {
  if (!transaction) return null;

  return (
    <div className="print-only w-[190mm] h-[125mm] p-6 bg-white text-black font-sans text-xs border border-transparent mx-auto flex flex-col justify-between">
      {/* Header */}
      <div className="border-b border-black pb-3">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-base font-bold uppercase tracking-wide">Construction Supply Yard</h1>
            <p className="text-[10px] text-zinc-600 mt-0.5">National Highway, Bayawan City, Negros Oriental</p>
            <p className="text-[10px] text-zinc-600">Tel: (035) 522-1234 | TIN: 123-456-789-000</p>
          </div>
          <div className="text-right">
            {transaction.sales_invoice_number && (
              <div className="mb-1">
                <span className="text-[10px] uppercase font-semibold text-zinc-500 block">Sales Invoice</span>
                <span className="font-mono font-bold text-sm">#{transaction.sales_invoice_number}</span>
              </div>
            )}
            {transaction.official_receipt_number && (
              <div>
                <span className="text-[10px] uppercase font-semibold text-zinc-500 block">Official Receipt</span>
                <span className="font-mono font-bold text-sm">#{transaction.official_receipt_number}</span>
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 mt-3 text-[10px] pt-2 border-t border-dashed border-zinc-300">
          <div>
            <p><span className="text-zinc-500 uppercase font-medium">Customer:</span> <span className="font-bold">{customerName || 'Walk-in Customer'}</span></p>
            <p><span className="text-zinc-500 uppercase font-medium">Payment Mode:</span> <span className="font-semibold uppercase">{transaction.payment_method}</span></p>
          </div>
          <div className="text-right">
            <p><span className="text-zinc-500 uppercase font-medium">Date:</span> {formatDate(transaction.date)}</p>
            <p><span className="text-zinc-500 uppercase font-medium">Cashier ID:</span> <span className="font-mono">{transaction.cashier_id.slice(0, 8)}</span></p>
          </div>
        </div>
      </div>

      {/* Items Table */}
      <div className="flex-1 my-3 overflow-hidden">
        <table className="w-full text-left text-[10px] border-collapse">
          <thead>
            <tr className="border-b border-black font-bold uppercase">
              <th className="py-1">Description</th>
              <th className="py-1 text-center">Qty</th>
              <th className="py-1 text-center">Unit</th>
              <th className="py-1 text-right">Unit Price</th>
              <th className="py-1 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => (
              <tr key={item.id || idx} className="border-b border-dashed border-zinc-200">
                <td className="py-1.5 font-semibold">{item.name || item.item_name}</td>
                <td className="py-1.5 text-center font-mono">{formatQuantity(item.quantity)}</td>
                <td className="py-1.5 text-center">{item.unitUsed || item.unit_used || item.item_unit}</td>
                <td className="py-1.5 text-right font-mono">{formatCurrency(item.unitPrice || item.unit_price)}</td>
                <td className="py-1.5 text-right font-mono font-bold">{formatCurrency(item.totalPrice || item.total_price)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer and Totals */}
      <div className="border-t border-black pt-3">
        <div className="flex justify-between items-start">
          <div className="text-[9px] text-zinc-500 italic max-w-[100mm]">
            <p>Thank you for your business!</p>
            <p className="mt-1">Returns must be processed within 7 days, accompanied by this document.</p>
          </div>
          
          <div className="w-[60mm] space-y-1 text-[11px] text-right">
            <div className="flex justify-between text-zinc-650">
              <span>Subtotal</span>
              <span className="font-mono">{formatCurrency(transaction.subtotal)}</span>
            </div>
            {transaction.tax > 0 && (
              <div className="flex justify-between text-zinc-650">
                <span>VAT (12%)</span>
                <span className="font-mono">{formatCurrency(transaction.tax)}</span>
              </div>
            )}
            {transaction.discount > 0 && (
              <div className="flex justify-between text-zinc-650">
                <span>Discount</span>
                <span className="font-mono">-{formatCurrency(transaction.discount)}</span>
              </div>
            )}
            {transaction.delivery_fee > 0 && (
              <div className="flex justify-between text-zinc-650">
                <span>Delivery Charge</span>
                <span className="font-mono">+{formatCurrency(transaction.delivery_fee)}</span>
              </div>
            )}
            <div className="flex justify-between items-end border-t border-zinc-300 pt-1 text-xs">
              <span className="font-bold">Grand Total</span>
              <span className="font-extrabold text-sm font-mono">{formatCurrency(transaction.total_amount)}</span>
            </div>
            {transaction.amount_paid > 0 && (
              <div className="flex justify-between text-[10px] text-zinc-650">
                <span>Amount Paid</span>
                <span className="font-mono">{formatCurrency(transaction.amount_paid)}</span>
              </div>
            )}
            {transaction.balance_due > 0 && (
              <div className="flex justify-between text-[10px] text-red-650 font-bold">
                <span>Balance Due</span>
                <span className="font-mono">{formatCurrency(transaction.balance_due)}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
