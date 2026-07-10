import { formatCurrency, formatQuantity, formatDate } from '@/lib/format';

interface A6PrintReceiptProps {
  transaction: any;
  items: any[];
  customerName?: string;
}

export default function A6PrintReceipt({ transaction, items, customerName }: A6PrintReceiptProps) {
  if (!transaction) return null;

  return (
    <div className="print-only w-[93mm] min-h-[136mm] p-[6mm] bg-white text-black font-sans flex flex-col text-[9px] leading-tight">
      {/* Section 1 — Header (business info) */}
      <div className="text-center mb-2">
        <h1 className="text-sm font-bold uppercase tracking-wide">[BUSINESS NAME]</h1>
        <p className="text-[8px] mt-0.5">[Business Address]</p>
        <p className="text-[8px] mt-0.5">Contact No.
          <span className="inline-block border-b border-black min-w-[40mm] mx-1">&nbsp;</span>
        </p>
      </div>

      {/* Section 2 — Transaction info */}
      <div className="mb-2 text-[8px] space-y-1">
        <div className="flex justify-between">
          <span>
            SOLD TO:
            <span className="inline-block border-b border-black min-w-[32mm] ml-1">&nbsp;</span>
          </span>
          <span>
            Date
            <span className="inline-block border-b border-black min-w-[18mm] ml-1">{formatDate(transaction.date)}</span>
          </span>
        </div>
        <div>
          ADDRESS:
          <span className="inline-block border-b border-black w-[76mm] ml-1">&nbsp;</span>
        </div>
      </div>

      {/* Section 3 — Line-item table */}
      <table className="w-full border-collapse border border-black text-[7.5px]">
        <thead>
          <tr className="border-b border-black font-bold text-center">
            <th className="border-r border-black py-1 w-[13%]">QUANTITY</th>
            <th className="border-r border-black py-1 w-[11%]">UNIT</th>
            <th className="border-r border-black py-1 w-[38%]">DESCRIPTION</th>
            <th className="border-r border-black py-1 w-[18%] leading-tight">
              UNIT<br />PRICE
            </th>
            <th className="py-1 w-[20%]">TOTAL</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, idx) => (
            <tr key={item.id || idx} className="border-b border-black">
              <td className="border-r border-black px-1 py-0.5 text-center font-mono">{formatQuantity(item.quantity)}</td>
              <td className="border-r border-black px-1 py-0.5 text-center">{item.unitUsed || item.unit_used || item.item_unit}</td>
              <td className="border-r border-black px-1 py-0.5">{item.name || item.item_name}</td>
              <td className="border-r border-black px-1 py-0.5 text-right font-mono">{formatCurrency(item.unitPrice || item.unit_price)}</td>
              <td className="px-1 py-0.5 text-right font-mono font-bold">{formatCurrency(item.totalPrice || item.total_price)}</td>
            </tr>
          ))}
          {/* Fill remaining rows (dynamically — at least 2 empty rows for small carts) */}
          {items.length < 4 && Array.from({ length: 4 - items.length }).map((_, i) => (
            <tr key={`empty-${i}`} className="border-b border-black">
              <td className="border-r border-black px-1 py-0.5">&nbsp;</td>
              <td className="border-r border-black px-1 py-0.5">&nbsp;</td>
              <td className="border-r border-black px-1 py-0.5">&nbsp;</td>
              <td className="border-r border-black px-1 py-0.5">&nbsp;</td>
              <td className="px-1 py-0.5">&nbsp;</td>
            </tr>
          ))}
          {/* TOTAL row */}
          <tr className="font-bold">
            <td colSpan={3} className="border-r border-black px-1 py-1 text-right text-[8px]">TOTAL</td>
            <td className="border-r border-black px-1 py-1">&nbsp;</td>
            <td className="px-1 py-1 text-right font-mono">{formatCurrency(transaction.total_amount)}</td>
          </tr>
        </tbody>
      </table>

      {/* Payment annotation line */}
      <div className="flex justify-end text-[8px] mt-0.5 gap-2">
        {transaction.amount_paid > 0 && (
          <span>
            PAID
            <span className="inline-block border-b border-black min-w-[10mm] ml-0.5 font-mono">{formatCurrency(transaction.amount_paid)}</span>
          </span>
        )}
        {transaction.balance_due > 0 && (
          <span className="font-bold">
            BALANCE
            <span className="inline-block border-b border-black min-w-[10mm] ml-0.5 font-mono">{formatCurrency(transaction.balance_due)}</span>
          </span>
        )}
      </div>

      {/* Section 4 — Footer (signatures) */}
      <div className="mt-auto pt-2 text-[8px] flex justify-between">
        <span>
          Prepared by:
          <span className="inline-block border-b border-black min-w-[20mm] ml-1">&nbsp;</span>
        </span>
        <span>
          Received by:
          <span className="inline-block border-b border-black min-w-[20mm] ml-1">&nbsp;</span>
        </span>
      </div>
    </div>
  );
}
