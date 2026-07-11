module.exports = async function(db, mlekSecretHex) {
  const mlekSecret = Buffer.from(mlekSecretHex, 'hex');
  const crypto = require('crypto');

  function calculateHMACSignature(entry, prevSig) {
    const entityId = entry.customer_id || entry.supplier_id || '';
    const dateStr = entry.date || '';
    const refId = entry.reference_id || '';
    const desc = entry.description || '';
    const cashier = entry.cashier_id || '';
    const data = `${entry.id}-${entityId}-${entry.amount}-${entry.type}-${dateStr}-${refId}-${desc}-${cashier}-${prevSig}`;
    return crypto.createHmac('sha256', mlekSecret).update(data).digest('hex');
  }

  // Recalculate all supplier ledger signatures correctly
  const suppliers = db.prepare("SELECT id FROM suppliers").all();
  for (const supp of suppliers) {
    const rows = db.prepare("SELECT * FROM supplier_ledger WHERE supplier_id = ? ORDER BY date ASC").all(supp.id);
    let prevSig = "GENESIS";

    for (const row of rows) {
      const correctSig = calculateHMACSignature(row, prevSig);
      db.prepare("UPDATE supplier_ledger SET hmac_signature = ? WHERE id = ?").run(correctSig, row.id);
      prevSig = correctSig;
    }
  }
};
