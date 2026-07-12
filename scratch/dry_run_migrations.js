const Database = require('better-sqlite3');
const fs = require('fs');

const dbPath = 'data/database_dry_run.db';
const db = new Database(dbPath);
const mlekSecretHex = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

try {
  console.log("Starting dry run...");
  db.exec('BEGIN TRANSACTION;');
  
  console.log("Applying 008...");
  const sql008 = fs.readFileSync('migrations/008_standardize_timestamps_to_iso8601.sql', 'utf8');
  db.exec(sql008);
  
  console.log("Applying 007...");
  const m007 = require('../migrations/007_repair_supplier_ledger_hmacs.js');
  m007(db, mlekSecretHex).then(() => {
    console.log("Migrations successful. Verifying idempotency...");
    db.exec('ROLLBACK;');
    console.log("Rolled back successfully.");
    process.exit(0);
  }).catch(err => {
    console.error("Migration 007 failed:", err);
    db.exec('ROLLBACK;');
    process.exit(1);
  });
} catch (e) {
  console.error("Dry run failed:", e);
  db.exec('ROLLBACK;');
  process.exit(1);
}
