"use server";

import db from '@/lib/db';
import crypto from 'crypto';
import { calculateHMACSignature } from '@/lib/ledger_crypto';
import { createBalancedJournalEntry } from './ledger';
import { z } from 'zod';
import { getActiveUserId } from './auth';

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
  paymentMethod: z.enum(['Cash', 'Credit', 'Check'])
});

function checkMlek(): void {
  if (!(global as any).mlekSecret) {
    throw new Error("DATABASE_LOCKED: Store is locked.");
  }
}

// Main checkout action
export async function processCheckout(rawPayload: CheckoutPayload): Promise<{ transactionId: string; siNumber: number | null; orNumber: number | null }> {
  checkMlek();

  const payload = CheckoutPayloadSchema.parse(rawPayload);
  let {
    customerId, items, subtotal, tax,
    deliveryFee, discount, totalAmount, amountPaid, paymentMethod
  } = payload;
  
  const cashierId = await getActiveUserId();

  let computedSubtotal = 0;
  for (let i = 0; i < items.length; i++) {
    const invItem = db.prepare("SELECT cost_price FROM inventory WHERE id = ?").get(items[i].itemId) as { cost_price: number };
    if (!invItem) throw new Error(`Item ${items[i].itemId} not found.`);
    
    items[i].unitCost = invItem.cost_price;
    items[i].totalPrice = Math.round(items[i].unitPrice * items[i].quantity / 1000);
    computedSubtotal += items[i].totalPrice;
  }
  
  if (subtotal !== computedSubtotal) {
    throw new Error("MATH_TAMPERING_DETECTED: Submitted subtotal does not match calculated line items.");
  }
  
  const computedTotal = subtotal - discount + tax + deliveryFee;
  if (totalAmount !== computedTotal) {
    throw new Error("MATH_TAMPERING_DETECTED: Submitted total amount does not match calculated total.");
  }

  if (totalAmount < 0) throw new Error("Total amount cannot be negative.");

  // Credit limit enforcement
  if (paymentMethod === 'Credit' && customerId) {
    const customer = db.prepare("SELECT credit_limit, current_balance FROM customers WHERE id = ?").get(customerId) as {
      credit_limit: number;
      current_balance: number;
    };

    if (customer && (customer.current_balance + totalAmount - amountPaid) > customer.credit_limit) {
      throw new Error("CREDIT_LIMIT_EXCEEDED: Customer credit limit would be exceeded by this transaction.");
    }
  }

  const transactionId = crypto.randomUUID();
  const balanceDue = totalAmount - amountPaid;
  const paymentStatus = balanceDue <= 0 ? 'Paid' : 'Partial';
  const deliveryStatus = deliveryFee > 0 ? 'Pending' : 'N/A';

  let siNumber: number | null = null;
  let orNumber: number | null = null;

  db.transaction(() => {
    // 1. Insert transaction header
    db.prepare(`
      INSERT INTO transactions (id, customer_id, cashier_id, date, subtotal, tax, delivery_fee, discount, total_amount, amount_paid, balance_due, payment_status, payment_method, delivery_status)
      VALUES (?, ?, ?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

    // 4. Update shift expected_cash (only for Cash payments)
    if (paymentMethod === 'Cash') {
      const openShift = db.prepare("SELECT id FROM shifts WHERE cashier_id = ? AND status = 'Open' LIMIT 1").get(cashierId) as { id: string } | undefined;
      if (openShift) {
        db.prepare("UPDATE shifts SET expected_cash = COALESCE(expected_cash, 0) + ? WHERE id = ?").run(amountPaid, openShift.id);
      }
    }

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

      const signature = calculateHMACSignature(entryData, prevSig, (global as any).mlekSecret);

      db.prepare(`
        INSERT INTO customer_ledger (id, customer_id, date, type, amount, reference_id, description, hmac_signature)
        VALUES (?, ?, datetime('now'), 'DEBIT', ?, ?, ?, ?)
      `).run(ledgerId, customerId, balanceDue, transactionId, entryData.description, signature);
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
    if (paymentMethod === 'Cash' && amountPaid > 0 && balanceDue > 0) {
      glLines.push({ accountId: 'acc-ar', type: 'DEBIT', amount: balanceDue });
    }

    glLines.push({ accountId: 'acc-revenue', type: 'CREDIT', amount: totalAmount });

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
export async function getTransactions(startDate?: string, endDate?: string): Promise<any[]> {
  checkMlek();
  let query = "SELECT * FROM transactions";
  const params: string[] = [];

  if (startDate && endDate) {
    query += " WHERE date BETWEEN ? AND ?";
    params.push(startDate, endDate);
  }
  query += " ORDER BY date DESC";

  return db.prepare(query).all(...params);
}

// Fetch transaction details with items
export async function getTransactionDetails(transactionId: string): Promise<any> {
  checkMlek();
  const transaction = db.prepare("SELECT * FROM transactions WHERE id = ?").get(transactionId);
  const items = db.prepare(`
    SELECT ti.*, i.name as item_name, i.unit as item_unit
    FROM transaction_items ti 
    JOIN inventory i ON ti.item_id = i.id
    WHERE ti.transaction_id = ?
  `).all(transactionId);

  return { transaction, items };
}

// Process a return / void
export async function processReturn(
  transactionId: string,
  itemsToReturn: { itemId: string; quantity: number }[],
  _ignoredProcessedBy: string
): Promise<void> {
  checkMlek();
  const processedBy = await getActiveUserId();

  db.transaction(() => {
    const tx = db.prepare("SELECT payment_method, balance_due, customer_id FROM transactions WHERE id = ?").get(transactionId) as { payment_method: string; balance_due: number; customer_id: string | null };
    if (!tx) throw new Error("Transaction not found.");

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

      if (origItem) {
        const refundAmount = Math.round(origItem.unit_price * item.quantity / 1000);
        const costRefund = Math.round(origItem.unit_cost * item.quantity / 1000);

        // G/L reversal
        const glLines: { accountId: string; type: 'DEBIT' | 'CREDIT'; amount: number }[] = [];

        if (refundAmount > 0) {
          glLines.push({ accountId: 'acc-revenue', type: 'DEBIT', amount: refundAmount });
          if (tx.payment_method === 'Credit' && tx.balance_due > 0) {
            const actualCreditRefund = Math.min(refundAmount, tx.balance_due);
            const remainderCashRefund = refundAmount - actualCreditRefund;
            
            glLines.push({ accountId: 'acc-ar', type: 'CREDIT', amount: actualCreditRefund });
            if (remainderCashRefund > 0) {
              glLines.push({ accountId: 'acc-cash', type: 'CREDIT', amount: remainderCashRefund });
            }

            if (tx.customer_id) {
              db.prepare("UPDATE customers SET current_balance = MAX(0, current_balance - ?) WHERE id = ?").run(actualCreditRefund, tx.customer_id);
              db.prepare("UPDATE transactions SET balance_due = MAX(0, balance_due - ?) WHERE id = ?").run(actualCreditRefund, transactionId);
              tx.balance_due -= actualCreditRefund; // update local var for next loop iteration
              
              const lastLedger = db.prepare(`SELECT hmac_signature FROM customer_ledger WHERE customer_id = ? ORDER BY date DESC LIMIT 1`).get(tx.customer_id) as { hmac_signature: string } | undefined;
              const prevSig = lastLedger ? lastLedger.hmac_signature : "GENESIS";
              const ledgerId = crypto.randomUUID();
              const entryData = { id: ledgerId, customer_id: tx.customer_id, date: new Date().toISOString(), type: 'CREDIT' as const, amount: actualCreditRefund, reference_id: transactionId, description: `Return on Txn ${transactionId.slice(0, 8)}` };
              const signature = calculateHMACSignature(entryData, prevSig, (global as any).mlekSecret);
              db.prepare(`INSERT INTO customer_ledger (id, customer_id, date, type, amount, reference_id, description, hmac_signature) VALUES (?, ?, datetime('now'), 'CREDIT', ?, ?, ?, ?)`).run(ledgerId, tx.customer_id, actualCreditRefund, transactionId, entryData.description, signature);
            }
          } else {
            glLines.push({ accountId: 'acc-cash', type: 'CREDIT', amount: refundAmount });
          }
        }
        if (costRefund > 0) {
          glLines.push({ accountId: 'acc-inv', type: 'DEBIT', amount: costRefund });
          glLines.push({ accountId: 'acc-cost-of-sales', type: 'CREDIT', amount: costRefund });
        }

        const totalD = glLines.filter(l => l.type === 'DEBIT').reduce((s, l) => s + l.amount, 0);
        const totalC = glLines.filter(l => l.type === 'CREDIT').reduce((s, l) => s + l.amount, 0);
        if (totalD === totalC && totalD > 0) {
          createBalancedJournalEntry(`Return on Txn: ${transactionId.slice(0, 8)}`, glLines, processedBy);
        }
      }
    }

    // Audit log
    db.prepare(`
      INSERT INTO system_audit_logs (id, timestamp, user_id, action_type, reference_id, old_value, new_value)
      VALUES (?, datetime('now'), ?, 'SALE_RETURN', ?, NULL, ?)
    `).run(crypto.randomUUID(), processedBy, transactionId, `Returned ${itemsToReturn.length} line items`);
  })();
}
