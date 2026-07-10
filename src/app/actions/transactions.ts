"use server";

import db from '@/lib/db';
import crypto from 'crypto';
import { Transaction, TransactionItem } from '@/types';
import { calculateHMACSignature } from '@/lib/ledger_crypto';
import { createBalancedJournalEntry, JournalLineInput } from '@/lib/ledger_helpers';
import { z } from 'zod';
import { getActiveUserId } from './auth';
import { getMlekSecret, checkMlek, setMlekSecret, isMlekUnlocked } from "@/lib/mlek";

export interface CartItem {
  itemId: string;
  name: string;
  quantity: number; // Millicounts
  unitUsed: string;
  unitPrice: number; // Centavos
  unitCost: number; // Centavos
  totalPrice: number; // Centavos
}

export interface CheckoutPayload {
  customerId: string | null;
  cashierId: string;
  items: CartItem[];
  subtotal: number; // Centavos
  tax: number;
  deliveryFee: number;
  discount: number;
  totalAmount: number;
  amountPaid: number;
  paymentMethod: 'Cash' | 'Credit' | 'Check';
  overridePin?: string;
}

const CartItemSchema = z.object({
  itemId: z.string(),
  name: z.string(),
  quantity: z.number().int().positive(),
  unitUsed: z.string(),
  unitPrice: z.number().int().nonnegative(),
  unitCost: z.number().int().nonnegative(),
  totalPrice: z.number().int().nonnegative()
});

export const CheckoutPayloadSchema = z.object({
  customerId: z.string().nullable(),
  items: z.array(CartItemSchema).min(1, "Cart cannot be empty"),
  subtotal: z.number().int().nonnegative(),
  tax: z.number().int().nonnegative(),
  deliveryFee: z.number().int().nonnegative(),
  discount: z.number().int().nonnegative(),
  totalAmount: z.number().int().nonnegative(),
  amountPaid: z.number().int().nonnegative(),
  paymentMethod: z.enum(['Cash', 'Credit', 'Check']),
  overridePin: z.string().optional()
});


// Main checkout action
export async function processCheckout(rawPayload: CheckoutPayload): Promise<{ transactionId: string; siNumber: number | null; orNumber: number | null }> {
  checkMlek();

  const payload = CheckoutPayloadSchema.parse(rawPayload);
  let {
    customerId, items, subtotal, tax,
    deliveryFee, discount, totalAmount, amountPaid, paymentMethod
  } = payload;
  
  const cashierId = await getActiveUserId();

  let customerPriceTier = 'Retail';
  let isVatExempt = false;
  if (customerId) {
    const cust = db.prepare("SELECT price_tier, is_vat_exempt FROM customers WHERE id = ?").get(customerId) as { price_tier: string; is_vat_exempt: number } | undefined;
    if (cust) {
      if (cust.price_tier) customerPriceTier = cust.price_tier;
      if (cust.is_vat_exempt) isVatExempt = true;
    }
  }

  let computedSubtotal = 0;
  for (let i = 0; i < items.length; i++) {
    const invItem = db.prepare("SELECT cost_price, selling_price, wholesale_price FROM inventory WHERE id = ?").get(items[i].itemId) as { cost_price: number, selling_price: number, wholesale_price: number };
    if (!invItem) throw new Error(`Item ${items[i].itemId} not found.`);
    
    // C1 + H3: Enforce proper price tier server-side
    const expectedPrice = customerPriceTier === 'Wholesale' ? invItem.wholesale_price : invItem.selling_price;
    if (items[i].unitPrice !== expectedPrice) {
      throw new Error(`PRICE_TAMPERING_DETECTED: Item ${items[i].itemId} expected price ${expectedPrice} but got ${items[i].unitPrice}`);
    }
    
    items[i].unitCost = invItem.cost_price;
    items[i].totalPrice = Math.round(items[i].unitPrice * items[i].quantity / 1000);
    computedSubtotal += items[i].totalPrice;
  }
  
  if (subtotal !== computedSubtotal) {
    throw new Error("MATH_TAMPERING_DETECTED: Submitted subtotal does not match calculated line items.");
  }
  
  const computedTotal = subtotal - discount + deliveryFee;
  if (totalAmount !== computedTotal) {
    throw new Error("MATH_TAMPERING_DETECTED: Submitted total amount does not match calculated total.");
  }

  if (totalAmount < 0) throw new Error("Total amount cannot be negative.");

  // C2 & N1: Force server-side tax recalculation, respecting VAT exemption
  tax = isVatExempt ? 0 : Math.round(((computedSubtotal - discount) / 1.12) * 0.12);

  // Manager Override Helper
  const verifyOverride = (pin: string | undefined, errorMsg: string) => {
    if (!pin) throw new Error(errorMsg);
    const managers = db.prepare("SELECT passcode_hash, passcode_salt FROM users WHERE role IN ('Admin', 'Manager') AND is_active = 1").all() as { passcode_hash: string, passcode_salt: string }[];
    let valid = false;
    for (const mgr of managers) {
      const hash = crypto.pbkdf2Sync(pin, mgr.passcode_salt, 600000, 32, 'sha512').toString('hex');
      if (hash === mgr.passcode_hash) {
        valid = true;
        break;
      }
    }
    if (!valid) throw new Error("Invalid Manager Override PIN.");
  };

  // Discount enforcement
  if (discount > 0) {
    verifyOverride(payload.overridePin, "DISCOUNT_OVERRIDE_REQUIRED: Manager override required for discounts.");
  }

  // Credit limit enforcement
  if (paymentMethod === 'Credit' && customerId) {
    const customer = db.prepare("SELECT credit_limit, current_balance FROM customers WHERE id = ?").get(customerId) as {
      credit_limit: number;
      current_balance: number;
    };

    if (customer && (customer.current_balance + totalAmount - amountPaid) > customer.credit_limit) {
      verifyOverride(payload.overridePin, "CREDIT_LIMIT_EXCEEDED: Customer credit limit would be exceeded by this transaction.");
    }
  }

  const transactionId = crypto.randomUUID();
  const balanceDue = totalAmount - amountPaid;
  const paymentStatus = balanceDue <= 0 ? 'Paid' : (amountPaid === 0 ? 'Unpaid' : 'Partial');
  const deliveryStatus = deliveryFee > 0 ? 'Pending' : 'N/A';

  let siNumber: number | null = null;
  let orNumber: number | null = null;

  db.transaction(() => {
    // 1. Insert transaction header
    db.prepare(`
      INSERT INTO transactions (id, customer_id, cashier_id, date, subtotal, tax, delivery_fee, discount, total_amount, amount_paid, balance_due, payment_status, payment_method, delivery_status)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      transactionId, customerId, cashierId,
      subtotal, tax, deliveryFee, discount,
      totalAmount, amountPaid, balanceDue,
      paymentStatus, paymentMethod, deliveryStatus
    );

    // 2. Insert transaction line items & deduct stock
    const insertItem = db.prepare(`
      INSERT INTO transaction_items (id, transaction_id, item_id, quantity, unit_used, unit_price, unit_cost, total_price)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const deductStock = db.prepare("UPDATE inventory SET stock_quantity = stock_quantity - ? WHERE id = ?");

    for (const item of items) {
      insertItem.run(
        crypto.randomUUID(), transactionId, item.itemId,
        item.quantity, item.unitUsed, item.unitPrice, item.unitCost, item.totalPrice
      );
      deductStock.run(item.quantity, item.itemId);
    }

    // 3. Retrieve assigned doc numbers from trigger
    const txRow = db.prepare("SELECT sales_invoice_number, official_receipt_number FROM transactions WHERE id = ?").get(transactionId) as any;
    siNumber = txRow?.sales_invoice_number || null;
    orNumber = txRow?.official_receipt_number || null;

    // 4. Removed expected_cash update (computed dynamically at closing)

    // 5. Customer ledger debit if on credit
    if (paymentMethod === 'Credit' && customerId && balanceDue > 0) {
      db.prepare("UPDATE customers SET current_balance = current_balance + ? WHERE id = ?").run(balanceDue, customerId);

      const lastLedger = db.prepare(`
        SELECT hmac_signature FROM customer_ledger WHERE customer_id = ? ORDER BY date DESC LIMIT 1
      `).get(customerId) as { hmac_signature: string } | undefined;

      const prevSig = lastLedger ? lastLedger.hmac_signature : "GENESIS";
      const ledgerId = crypto.randomUUID();

      const entryData = {
        id: ledgerId,
        customer_id: customerId,
        date: new Date().toISOString(),
        type: 'DEBIT' as const,
        amount: balanceDue,
        reference_id: transactionId,
        description: `Sales Invoice charge - Txn ${transactionId.slice(0, 8)}`
      };

      const signature = calculateHMACSignature(entryData, prevSig, getMlekSecret());

      db.prepare(`
        INSERT INTO customer_ledger (id, customer_id, date, type, amount, reference_id, description, hmac_signature, cashier_id)
        VALUES (?, ?, ?, 'DEBIT', ?, ?, ?, ?, ?)
      `).run(ledgerId, customerId, entryData.date, entryData.amount, transactionId, entryData.description, signature, cashierId);
    }

    // 6. G/L Journal Entries
    const costOfGoods = items.reduce((sum, i) => sum + Math.round(i.unitCost * i.quantity / 1000), 0);
    const glLines: { accountId: string; type: 'DEBIT' | 'CREDIT'; amount: number }[] = [];

    if (paymentMethod === 'Cash' && amountPaid > 0) {
      glLines.push({ accountId: 'acc-cash', type: 'DEBIT', amount: amountPaid });
    }
    if ((paymentMethod === 'Credit' || paymentMethod === 'Check') && balanceDue > 0) {
      glLines.push({ accountId: 'acc-ar', type: 'DEBIT', amount: balanceDue });
    }
    // For POS combo payments (e.g. paying part in cash, remainder goes to credit)
    if (paymentMethod === 'Cash' && amountPaid > 0 && balanceDue > 0) {
      glLines.push({ accountId: 'acc-ar', type: 'DEBIT', amount: balanceDue });
    }

    const revenueAmount = totalAmount - tax;
    glLines.push({ accountId: 'acc-revenue', type: 'CREDIT', amount: revenueAmount });
    if (tax > 0) {
      glLines.push({ accountId: 'acc-vat-payable', type: 'CREDIT', amount: tax });
    }

    // COGS entry
    if (costOfGoods > 0) {
      glLines.push({ accountId: 'acc-cost-of-sales', type: 'DEBIT', amount: costOfGoods });
      glLines.push({ accountId: 'acc-inv', type: 'CREDIT', amount: costOfGoods });
    }

    // Balance check before posting GL
    const totalDebits = glLines.filter(l => l.type === 'DEBIT').reduce((s, l) => s + l.amount, 0);
    const totalCredits = glLines.filter(l => l.type === 'CREDIT').reduce((s, l) => s + l.amount, 0);

    if (totalDebits === totalCredits && totalDebits > 0) {
      createBalancedJournalEntry(`POS Sale: ${transactionId.slice(0, 8)}`, glLines, cashierId);
    }
  })();

  return { transactionId, siNumber, orNumber };
}

// Fetch all transactions for a date range
export async function getTransactions(startDate?: string, endDate?: string): Promise<Transaction[]> {
  checkMlek();
  let query = "SELECT * FROM transactions";
  const params: string[] = [];

  if (startDate && endDate) {
    query += " WHERE date BETWEEN ? AND ?";
    params.push(startDate, endDate);
  }
  query += " ORDER BY date DESC";

  return db.prepare(query).all(...params) as Transaction[];
}

// Fetch transaction details with items
export async function getTransactionDetails(transactionId: string): Promise<{ transaction: Transaction; items: (TransactionItem & { item_name: string; item_unit: string })[] }> {
  getMlekSecret(); // Ensure unlocked
  const transaction = db.prepare("SELECT * FROM transactions WHERE id = ?").get(transactionId) as Transaction;
  const items = db.prepare(`
    SELECT ti.*, i.name as item_name, i.unit as item_unit
    FROM transaction_items ti 
    JOIN inventory i ON ti.item_id = i.id
    WHERE ti.transaction_id = ?
  `).all(transactionId) as (TransactionItem & { item_name: string; item_unit: string })[];

  return { transaction, items };
}

// Process a return / void
export async function processReturn(
  transactionId: string,
  itemsToReturn: { itemId: string; quantity: number }[]
): Promise<void> {
  getMlekSecret(); // Ensure unlocked
  const processedBy = await getActiveUserId();

  db.transaction(() => {
    const tx = db.prepare("SELECT payment_method, balance_due, customer_id, tax, total_amount FROM transactions WHERE id = ?").get(transactionId) as { payment_method: string; balance_due: number; customer_id: string | null; tax: number; total_amount: number };
    if (!tx) throw new Error("Transaction not found.");

    let totalRefundAmount = 0;
    let totalCostRefund = 0;

    for (const item of itemsToReturn) {
      const origItem = db.prepare(`
        SELECT quantity, quantity_returned, unit_price, unit_cost FROM transaction_items WHERE transaction_id = ? AND item_id = ?
      `).get(transactionId, item.itemId) as { quantity: number; quantity_returned: number | null; unit_price: number; unit_cost: number };

      if (!origItem) throw new Error("Item not found in transaction.");
      const returnedSoFar = origItem.quantity_returned || 0;
      if (returnedSoFar + item.quantity > origItem.quantity) {
        throw new Error("Cannot return more than originally purchased or already returned.");
      }

      db.prepare("UPDATE transaction_items SET quantity_returned = ? WHERE transaction_id = ? AND item_id = ?").run(returnedSoFar + item.quantity, transactionId, item.itemId);

      // Restock inventory
      db.prepare("UPDATE inventory SET stock_quantity = stock_quantity + ? WHERE id = ?").run(item.quantity, item.itemId);

      totalRefundAmount += Math.round(origItem.unit_price * item.quantity / 1000);
      totalCostRefund += Math.round(origItem.unit_cost * item.quantity / 1000);
    }

    if (totalRefundAmount > 0) {
      const refundVat = tx.tax > 0 && tx.total_amount > 0 ? Math.round(totalRefundAmount * tx.tax / tx.total_amount) : 0;
      const refundRevenue = totalRefundAmount - refundVat;

      // G/L reversal
      const glLines: { accountId: string; type: 'DEBIT' | 'CREDIT'; amount: number }[] = [];
      glLines.push({ accountId: 'acc-revenue', type: 'DEBIT', amount: refundRevenue });
      if (refundVat > 0) {
        glLines.push({ accountId: 'acc-vat-payable', type: 'DEBIT', amount: refundVat });
      }

      if (tx.payment_method === 'Credit' && tx.balance_due > 0) {
        const actualCreditRefund = Math.min(totalRefundAmount, tx.balance_due);
        const remainderCashRefund = totalRefundAmount - actualCreditRefund;
        
        glLines.push({ accountId: 'acc-ar', type: 'CREDIT', amount: actualCreditRefund });
        if (remainderCashRefund > 0) {
          glLines.push({ accountId: 'acc-cash', type: 'CREDIT', amount: remainderCashRefund });
        }
        
        // Update balance due on the transaction
        db.prepare("UPDATE transactions SET balance_due = balance_due - ? WHERE id = ?").run(actualCreditRefund, transactionId);

        // Reverse customer ledger
        if (tx.customer_id) {
          db.prepare("UPDATE customers SET current_balance = current_balance - ? WHERE id = ?").run(actualCreditRefund, tx.customer_id);
          const lastLedger = db.prepare(`SELECT hmac_signature FROM customer_ledger WHERE customer_id = ? ORDER BY date DESC LIMIT 1`).get(tx.customer_id) as { hmac_signature: string } | undefined;
          const prevSig = lastLedger ? lastLedger.hmac_signature : "GENESIS";
          const ledgerId = crypto.randomUUID();
          
          const signature = crypto.createHmac('sha256', getMlekSecret() || process.env.MLEK_SECRET || 'fallback_secret')
            .update(`${ledgerId}:${tx.customer_id}:CREDIT:${actualCreditRefund}:${prevSig}`)
            .digest('hex');

          db.prepare(`
            INSERT INTO customer_ledger (id, customer_id, date, type, amount, reference_id, cashier_id, hmac_signature)
            VALUES (?, ?, CURRENT_TIMESTAMP, 'CREDIT', ?, ?, ?, ?)
          `).run(ledgerId, tx.customer_id, actualCreditRefund, transactionId, processedBy, signature);
        }
      } else {
        glLines.push({ accountId: 'acc-cash', type: 'CREDIT', amount: totalRefundAmount });
      }

      // Cost of Sales reversal
      if (totalCostRefund > 0) {
        glLines.push({ accountId: 'acc-cost-of-sales', type: 'CREDIT', amount: totalCostRefund });
        glLines.push({ accountId: 'acc-inv', type: 'DEBIT', amount: totalCostRefund });
      }

      const totalD = glLines.filter(l => l.type === 'DEBIT').reduce((s, l) => s + l.amount, 0);
      const totalC = glLines.filter(l => l.type === 'CREDIT').reduce((s, l) => s + l.amount, 0);
      if (totalD === totalC && totalD > 0) {
        createBalancedJournalEntry(`Return: ${transactionId.slice(0, 8)}`, glLines, processedBy);
      }
    }

    // Audit log
    db.prepare(`
      INSERT INTO system_audit_logs (id, timestamp, user_id, action_type, reference_id, old_value, new_value)
      VALUES (?, CURRENT_TIMESTAMP, ?, 'SALE_RETURN', ?, NULL, ?)
    `).run(crypto.randomUUID(), processedBy, transactionId, `Returned ${itemsToReturn.length} line items`);
  })();
}
