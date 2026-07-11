module.exports = async function(db, mlekSecretHex) {
  const mlekSecret = Buffer.from(mlekSecretHex, 'hex');
  const crypto = require('crypto');

  function oldSig(entry, prevSig) {
    const entityId = entry.customer_id || entry.supplier_id || '';
    const dateStr = entry.date || '';
    const data = `${entry.id}-${entityId}-${entry.amount}-${entry.type}-${dateStr}-${prevSig}`;
    return crypto.createHmac('sha256', mlekSecret).update(data).digest('hex');
  }

  function newSig(entry, prevSig) {
    const entityId = entry.customer_id || entry.supplier_id || '';
    const dateStr = entry.date || '';
    const refId = entry.reference_id || '';
    const desc = entry.description || '';
    const cashier = entry.cashier_id || '';
    const data = `${entry.id}-${entityId}-${entry.amount}-${entry.type}-${dateStr}-${refId}-${desc}-${cashier}-${prevSig}`;
    return crypto.createHmac('sha256', mlekSecret).update(data).digest('hex');
  }

  // Update customer ledger
  const customers = db.prepare("SELECT id FROM customers").all();
  for (const cust of customers) {
    const rows = db.prepare("SELECT * FROM customer_ledger WHERE customer_id = ? ORDER BY date ASC").all(cust.id);
    let prevSig = "GENESIS";
    
    for (const row of rows) {
      const expectedOld = oldSig(row, prevSig);
      if (row.hmac_signature === expectedOld || prevSig === "GENESIS") {
        const upgradedSig = newSig(row, prevSig);
        db.prepare("UPDATE customer_ledger SET hmac_signature = ? WHERE id = ?").run(upgradedSig, row.id);
        prevSig = upgradedSig;
      } else {
        prevSig = row.hmac_signature;
      }
    }
  }

  // Update supplier ledger
  const suppliers = db.prepare("SELECT id FROM suppliers").all();
  for (const supp of suppliers) {
    const rows = db.prepare("SELECT * FROM supplier_ledger WHERE supplier_id = ? ORDER BY date ASC").all(supp.id);
    let prevSig = "GENESIS";

    for (const row of rows) {
      const expectedOld = oldSig(row, prevSig);
      if (row.hmac_signature === expectedOld || prevSig === "GENESIS") {
        const upgradedSig = newSig(row, prevSig);
        db.prepare("UPDATE supplier_ledger SET hmac_signature = ? WHERE id = ?").run(upgradedSig, row.id);
        prevSig = upgradedSig;
      } else {
        prevSig = row.hmac_signature;
      }
    }
  }
};
