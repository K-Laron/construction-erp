import db, { runMigrations } from '../src/lib/db';
import crypto from 'crypto';
import { lockStore } from '../src/lib/init';
import { unlockStore } from '../src/app/actions/unlock';
import { createCustomer, recordPayment } from '../src/app/actions/customers';
import { createPurchaseOrder, receiveGoods } from '../src/app/actions/inventory';
import { openShift, closeShift } from '../src/app/actions/shifts';

async function main() {
  console.log("Starting simulation with actual data...");
  // 1. Generate an MLEK
  const mlek = crypto.randomBytes(32);
  const mlekHex = mlek.toString('hex');
  
  // 2. Set up DB with migrations
  await runMigrations(mlekHex);
  console.log("Migrations applied.");

  // For testing, mock the auth function to return system-daemon
  jest = require('jest-mock');
  const auth = require('../src/app/actions/auth');
  auth.requireAuth = jest.fn().mockResolvedValue('system-daemon');

  // 3. Create a Customer
  const custRes = await createCustomer("Real Estate Corp", "555-0192", "123 Main St", 500000);
  if (!custRes.success) throw new Error(custRes.error);
  const customerId = custRes.data;
  console.log("Customer created:", customerId);

  // 4. Record Overpayment
  const payRes = await recordPayment(customerId, 1000, "Advance payment");
  if (!payRes.success) throw new Error(payRes.error);
  console.log("Payment recorded successfully (testing overpayment support).");

  // 5. Check balance
  const cust = db.prepare("SELECT current_balance FROM customers WHERE id = ?").get(customerId);
  console.log("Customer balance (should be -1000):", cust.current_balance);

  // 6. Test inventory supplier
  const suppId = crypto.randomUUID();
  db.prepare("INSERT INTO suppliers (id, name, current_balance, is_active) VALUES (?, 'Steel Mfg', 0, 1)").run(suppId);
  const poRes = await createPurchaseOrder(suppId, [{ itemId: 'item-rebar', quantity: 100000, unitCost: 12000 }], 'Credit');
  if (!poRes.success) throw new Error(poRes.error);
  const poId = poRes.data;
  console.log("Purchase Order created:", poId);

  const recRes = await receiveGoods(poId);
  if (!recRes.success) throw new Error(recRes.error);
  console.log("Goods received.");

  console.log("Simulation complete!");
}

main().catch(console.error);
