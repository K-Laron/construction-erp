"use server";

import db from '@/lib/db';
import crypto from 'crypto';
import { Transaction, TransactionItem } from '@/types';
import { calculateHMACSignature } from '@/lib/ledger_helpers';
import { createBalancedJournalEntry } from '@/lib/ledger_helpers';
import { z } from 'zod';
import { getActiveUserId, requireAuth } from './auth';
import { getMlekSecret } from "@/lib/mlek";

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
  overrideUsername?: string;
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
  overridePin: z.string().optional(),
  overrideUsername: z.string().optional()
});

export const ProcessReturnSchema = z.object({
  transactionId: z.string().uuid(),
  itemsToReturn: z.array(z.object({
    itemId: z.string().uuid(),
    quantity: z.number().int().positive()
  })).min(1)
});


// Main checkout action
export async function processCheckout(rawPayload: CheckoutPayload): Promise<{ success: boolean; data?: { transactionId: string; siNumber: number | null; orNumber: number | null }; error?: string }> {
  try {
  getMlekSecret();

  const payload = CheckoutPayloadSchema.parse(rawPayload);
  const {
    customerId, items, subtotal,
    deliveryFee, discount, totalAmount, amountPaid, paymentMethod,
    overridePin, overrideUsername
  } = payload;
  let { tax } = payload;

  if (paymentMethod === 'Credit' && !customerId) {
    throw new Error("CREDIT_CUSTOMER_REQUIRED: Credit checkout requires a valid customer ID.");
  }
  
  const cashierId = await requireAuth();

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
  if (amountPaid > totalAmount) {
    throw new Error('OVERPAYMENT_NOT_ALLOWED: amountPaid cannot exceed totalAmount.');
  }

  // C2 & N1: Force server-side tax recalculation, respecting VAT exemption (Option A: delivery charge is vatable)
  tax = isVatExempt ? 0 : Math.round(((computedSubtotal - discount + deliveryFee) / 1.12) * 0.12);

  // Manager Override Helper
  const verifyOverride = (pin: string | undefined, managerUsername: string | undefined, errorMsg: string) => {
    if (!pin) throw new Error(errorMsg);
    
    if (managerUsername) {
      const mgr = db.prepare("SELECT passcode_hash, passcode_salt FROM users WHERE username = ? AND role IN ('Admin', 'Manager') AND is_active = 1").get(managerUsername) as { passcode_hash: string, passcode_salt: string } | undefined;
      if (!mgr) throw new Error("Invalid Manager Username.");
      const hash = crypto.pbkdf2Sync(pin, mgr.passcode_salt, 600000, 32, 'sha512').toString('hex');
      if (hash !== mgr.passcode_hash) throw new Error("Invalid Manager Override PIN.");
      return;
    }

    const managers = db.prepare("SELECT passcode_hash, passcode_salt FROM users WHERE role IN ('Admin', 'Manager') AND is_active = 1").all() as { passcode_hash: string, passcode_salt: string }[];
    let valid = false;
    // Fallback: search all but limit loop length to prevent DoS (max 3 managers checked)
    for (const mgr of managers.slice(0, 3)) {
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
    verifyOverride(overridePin, overrideUsername, "DISCOUNT_OVERRIDE_REQUIRED: Manager override required for discounts.");
  }

  // Credit limit enforcement
  if (paymentMethod === 'Credit' && customerId) {
    const customer = db.prepare("SELECT credit_limit, current_balance FROM customers WHERE id = ?").get(customerId) as {
      credit_limit: number;
      current_balance: number;
    };

    if (customer && (customer.current_balance + totalAmount - amountPaid) > customer.credit_limit) {
      verifyOverride(overridePin, overrideUsername, "CREDIT_LIMIT_EXCEEDED: Customer credit limit would be exceeded by this transaction.");
    }
  }

  const transactionId = crypto.randomUUID();
  const balanceDue = totalAmount - amountPaid;
  if (balanceDue > 0 && !customerId) {
    throw new Error('CUSTOMER_REQUIRED_FOR_BALANCE: Partial payment requires a customer to hold AR.');
  }
  const paymentStatus = balanceDue <= 0 ? 'Paid' : (amountPaid === 0 ? 'Unpaid' : 'Partial');
  const deliveryStatus = deliveryFee > 0 ? 'Pending' : 'N/A';

  let siNumber: number | null = null;
  let orNumber: number | null = null;

  const result = db.transaction(() => {
    const txDate = new Date().toISOString();
    // 1. Insert transaction header
    db.prepare(`
      INSERT INTO transactions (id, customer_id, cashier_id, date, subtotal, tax, delivery_fee, discount, total_amount, amount_paid, balance_due, payment_status, payment_method, delivery_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      transactionId, customerId, cashierId, txDate,
      subtotal, tax, deliveryFee, discount,
      totalAmount, amountPaid, balanceDue,
      paymentStatus, paymentMethod, deliveryStatus
    );

    // 2. Insert transaction line items & deduct stock
    const insertItem = db.prepare(`
      INSERT INTO transaction_items (id, transaction_id, item_id, quantity, unit_used, unit_price, unit_cost, total_price)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const deductStockAtomic = db.prepare(
      "UPDATE inventory SET stock_quantity = stock_quantity - ? WHERE id = ? AND stock_quantity >= ?"
    );

    for (const item of items) {
      insertItem.run(
        crypto.randomUUID(), transactionId, item.itemId,
        item.quantity, item.unitUsed, item.unitPrice, item.unitCost, item.totalPrice
      );
      
      const invItem = db.prepare("SELECT stock_quantity, name FROM inventory WHERE id = ?").get(item.itemId) as { stock_quantity: number; name: string } | undefined;
      if (!invItem) throw new Error(`Item not found: ${item.itemId}`);
      if (invItem.stock_quantity < item.quantity) {
        throw new Error(
          `INSUFFICIENT_STOCK: ${invItem.name} has ${invItem.stock_quantity} millicounts, need ${item.quantity}`
        );
      }
      const result = deductStockAtomic.run(item.quantity, item.itemId, item.quantity);
      if (result.changes === 0) {
        throw new Error(
          `INSUFFICIENT_STOCK: ${invItem.name} — concurrent stock change prevented deduction.`
        );
      }
      const newStock = invItem.stock_quantity - item.quantity;

      // L5: Stock audit trail (direction OUT)
      db.prepare(`
        INSERT INTO system_audit_logs (id, timestamp, user_id, action_type, reference_id, old_value, new_value)
        VALUES (?, ?, ?, 'STOCK_OUT', ?, ?, ?)
      `).run(crypto.randomUUID(), txDate, cashierId, item.itemId, invItem.stock_quantity.toString(), newStock.toString());
    }

    // 3. Retrieve assigned doc numbers from trigger
    const txRow = db.prepare("SELECT sales_invoice_number, official_receipt_number FROM transactions WHERE id = ?").get(transactionId) as { sales_invoice_number?: number; official_receipt_number?: number } | undefined;
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
        description: `Sales Invoice charge - Txn ${transactionId.slice(0, 8)}`,
        cashier_id: cashierId
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

    if (amountPaid > 0) {
      glLines.push({ accountId: 'acc-cash', type: 'DEBIT', amount: amountPaid });
    }
    if (balanceDue > 0) {
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

    // Balance check before posting GL — fail-closed
    const totalDebits = glLines.filter(l => l.type === 'DEBIT').reduce((s, l) => s + l.amount, 0);
    const totalCredits = glLines.filter(l => l.type === 'CREDIT').reduce((s, l) => s + l.amount, 0);

    if (totalDebits !== totalCredits || totalDebits === 0) {
      throw new Error(
        `GL_UNBALANCED: debits=${totalDebits} credits=${totalCredits} txn=${transactionId}`
      );
    }
    createBalancedJournalEntry(`POS Sale: ${transactionId.slice(0, 8)}`, glLines, cashierId);

    return { transactionId, siNumber, orNumber };
  })();

  return { success: true, data: result };
} catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Checkout failed' };
  }
}

// Fetch all transactions for a date range
export async function getTransactions(startDate?: string, endDate?: string): Promise<Transaction[]> {
  await requireAuth();
  getMlekSecret(false);
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
  await requireAuth();
  getMlekSecret(false); // Ensure unlocked
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
): Promise<{ success: boolean; data?: void; error?: string }> {
  try {
    const parsed = ProcessReturnSchema.parse({ transactionId, itemsToReturn });
    const processedBy = await requireAuth();
    getMlekSecret(); // Ensure unlocked

    const returnDate = new Date().toISOString();
    db.transaction(() => {
      const tx = db.prepare("SELECT payment_method, balance_due, customer_id, tax, total_amount FROM transactions WHERE id = ?").get(parsed.transactionId) as { payment_method: string; balance_due: number; customer_id: string | null; tax: number; total_amount: number };
      if (!tx) throw new Error("Transaction not found.");

      let totalRefundAmount = 0;
      let totalCostRefund = 0;

      for (const item of parsed.itemsToReturn) {
        const origItem = db.prepare(`
          SELECT quantity, quantity_returned, unit_price, unit_cost FROM transaction_items WHERE transaction_id = ? AND item_id = ?
        `).get(parsed.transactionId, item.itemId) as { quantity: number; quantity_returned: number | null; unit_price: number; unit_cost: number };

      if (!origItem) throw new Error("Item not found in transaction.");
      const returnedSoFar = origItem.quantity_returned || 0;
      if (returnedSoFar + item.quantity > origItem.quantity) {
        throw new Error("Cannot return more than originally purchased or already returned.");
      }

      db.prepare("UPDATE transaction_items SET quantity_returned = ? WHERE transaction_id = ? AND item_id = ?").run(returnedSoFar + item.quantity, parsed.transactionId, item.itemId);

      // Restock inventory and log audit trail
      const invItem = db.prepare("SELECT stock_quantity FROM inventory WHERE id = ?").get(item.itemId) as { stock_quantity: number };
      const newStock = invItem.stock_quantity + item.quantity;
      db.prepare("UPDATE inventory SET stock_quantity = ? WHERE id = ?").run(newStock, item.itemId);

      // L5: Stock audit trail (direction IN)
      db.prepare(`
        INSERT INTO system_audit_logs (id, timestamp, user_id, action_type, reference_id, old_value, new_value)
        VALUES (?, ?, ?, 'STOCK_IN', ?, ?, ?)
      `).run(crypto.randomUUID(), returnDate, processedBy, item.itemId, invItem.stock_quantity.toString(), newStock.toString());

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

      let txnCreditRefund = 0;
      let overallCreditRefund = 0;
      let cashRefund = 0;

      if (tx.payment_method === 'Credit') {
        txnCreditRefund = Math.min(totalRefundAmount, tx.balance_due);
      }
      const remainingRefund = totalRefundAmount - txnCreditRefund;

      if (remainingRefund > 0 && tx.customer_id) {
        const cust = db.prepare("SELECT current_balance FROM customers WHERE id = ?").get(tx.customer_id) as { current_balance: number } | undefined;
        const currentBalance = cust ? cust.current_balance : 0;
        const otherOutstanding = Math.max(0, currentBalance - txnCreditRefund);
        overallCreditRefund = Math.min(remainingRefund, otherOutstanding);
      }

      cashRefund = totalRefundAmount - txnCreditRefund - overallCreditRefund;

      const totalArRefund = txnCreditRefund + overallCreditRefund;
      if (totalArRefund > 0) {
        glLines.push({ accountId: 'acc-ar', type: 'CREDIT', amount: totalArRefund });
      }
      if (cashRefund > 0) {
        glLines.push({ accountId: 'acc-cash', type: 'CREDIT', amount: cashRefund });
      }

      // Update balance due on the transaction
      if (txnCreditRefund > 0) {
        db.prepare("UPDATE transactions SET balance_due = balance_due - ? WHERE id = ?").run(txnCreditRefund, parsed.transactionId);
      }

      // Reconcile other outstanding invoices' balance_due (FIFO order)
      if (overallCreditRefund > 0 && tx.customer_id) {
        const otherTxns = db.prepare(`
          SELECT id, balance_due FROM transactions
          WHERE customer_id = ? AND balance_due > 0 AND id != ?
          ORDER BY date ASC
        `).all(tx.customer_id, parsed.transactionId) as { id: string; balance_due: number }[];

        let remainingOverall = overallCreditRefund;
        const updateTxnBalance = db.prepare("UPDATE transactions SET balance_due = balance_due - ? WHERE id = ?");

        for (const oTx of otherTxns) {
          if (remainingOverall <= 0) break;
          const toReduce = Math.min(remainingOverall, oTx.balance_due);
          updateTxnBalance.run(toReduce, oTx.id);
          remainingOverall -= toReduce;
        }
      }

      // Update customer balance and ledger
      if (totalArRefund > 0 && tx.customer_id) {
        db.prepare("UPDATE customers SET current_balance = current_balance - ? WHERE id = ?").run(totalArRefund, tx.customer_id);
        
        const lastLedger = db.prepare(`SELECT hmac_signature FROM customer_ledger WHERE customer_id = ? ORDER BY date DESC LIMIT 1`).get(tx.customer_id) as { hmac_signature: string } | undefined;
        const prevSig = lastLedger ? lastLedger.hmac_signature : "GENESIS";
        const ledgerId = crypto.randomUUID();
        
        const entryData = {
          id: ledgerId,
          customer_id: tx.customer_id,
          date: new Date().toISOString(),
          type: 'CREDIT' as const,
          amount: totalArRefund,
          reference_id: parsed.transactionId,
          description: `Return reversal (AR) - Txn ${parsed.transactionId.slice(0, 8)}`,
          cashier_id: processedBy
        };

        const signature = calculateHMACSignature(entryData, prevSig, getMlekSecret());

        db.prepare(`
          INSERT INTO customer_ledger (id, customer_id, date, type, amount, reference_id, description, hmac_signature, cashier_id)
          VALUES (?, ?, ?, 'CREDIT', ?, ?, ?, ?, ?)
        `).run(ledgerId, tx.customer_id, entryData.date, totalArRefund, parsed.transactionId, entryData.description, signature, processedBy);
      }

      // Cost of Sales reversal
      if (totalCostRefund > 0) {
        glLines.push({ accountId: 'acc-cost-of-sales', type: 'CREDIT', amount: totalCostRefund });
        glLines.push({ accountId: 'acc-inv', type: 'DEBIT', amount: totalCostRefund });
      }

      const totalD = glLines.filter(l => l.type === 'DEBIT').reduce((s, l) => s + l.amount, 0);
      const totalC = glLines.filter(l => l.type === 'CREDIT').reduce((s, l) => s + l.amount, 0);
      if (totalD === totalC && totalD > 0) {
        createBalancedJournalEntry(`Return: ${parsed.transactionId.slice(0, 8)}`, glLines, processedBy);
      }
    }

    // Audit log
    db.prepare(`
      INSERT INTO system_audit_logs (id, timestamp, user_id, action_type, reference_id, old_value, new_value)
      VALUES (?, ?, ?, 'SALE_RETURN', ?, NULL, ?)
    `).run(crypto.randomUUID(), returnDate, processedBy, parsed.transactionId, `Returned ${parsed.itemsToReturn.length} line items`);
  })();

    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Return failed' };
  }
}
