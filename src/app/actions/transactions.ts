"use server";

import db from '@/lib/db';
import crypto from 'crypto';
import { calculateHMACSignature } from '@/lib/ledger_crypto';
import { createBalancedJournalEntry } from './ledger';

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

function checkMlek(): void {
  if (!(global as any).mlekSecret) {
    throw new Error("DATABASE_LOCKED: Store is locked.");
  }
}

// Main checkout action
export async function processCheckout(payload: CheckoutPayload): Promise<{ transactionId: string; siNumber: number | null; orNumber: number | null }> {
  checkMlek();

  const {
    customerId, cashierId, items, subtotal, tax,
    deliveryFee, discount, totalAmount, amountPaid, paymentMethod
  } = payload;

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
  processedBy: string
): Promise<void> {
  checkMlek();

  db.transaction(() => {
    for (const item of itemsToReturn) {
      // Restock inventory
      db.prepare("UPDATE inventory SET stock_quantity = stock_quantity + ? WHERE id = ?").run(item.quantity, item.itemId);

      // Get original item cost for COGS reversal
      const origItem = db.prepare(`
        SELECT unit_price, unit_cost FROM transaction_items WHERE transaction_id = ? AND item_id = ?
      `).get(transactionId, item.itemId) as { unit_price: number; unit_cost: number };

      if (origItem) {
        const refundAmount = Math.round(origItem.unit_price * item.quantity / 1000);
        const costRefund = Math.round(origItem.unit_cost * item.quantity / 1000);

        // G/L reversal
        const glLines: { accountId: string; type: 'DEBIT' | 'CREDIT'; amount: number }[] = [];

        if (refundAmount > 0) {
          glLines.push({ accountId: 'acc-revenue', type: 'DEBIT', amount: refundAmount });
          glLines.push({ accountId: 'acc-cash', type: 'CREDIT', amount: refundAmount });
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
