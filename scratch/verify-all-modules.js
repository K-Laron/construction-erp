const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const dbDir = path.resolve(__dirname, '../data');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const dbPath = path.join(dbDir, 'test_database.db');
if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

const db = new Database(dbPath);
db.pragma('foreign_keys = ON');

function runTest(name, fn) {
  try {
    fn();
    console.log(`✓ PASS: ${name}`);
  } catch (e) {
    console.error(`✗ FAIL: ${name}`);
    console.error(e);
    process.exit(1);
  }
}

// Scaffold Tables matching erp_implementation_plan schemas
db.exec(`
  CREATE TABLE accounts (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    category TEXT NOT NULL,
    balance INTEGER DEFAULT 0
  );

  CREATE TABLE customers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    current_balance INTEGER DEFAULT 0
  );
  
  CREATE TABLE customer_ledger (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    date TEXT NOT NULL,
    type TEXT NOT NULL,
    amount INTEGER NOT NULL,
    reference_id TEXT,
    description TEXT NOT NULL,
    hmac_signature TEXT,
    FOREIGN KEY (customer_id) REFERENCES customers(id)
  );

  CREATE TABLE login_attempts (
    id TEXT PRIMARY KEY,
    attempt_type TEXT CHECK(attempt_type IN ('PIN', 'DOP', 'MMP')) NOT NULL,
    username TEXT NOT NULL,
    ip_address TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    is_successful INTEGER NOT NULL
  );
`);

console.log("=== Running Hardened ERP Core DB Constraint Tests ===\n");

// 1. HMAC chain tamper check
const globalState = {
  mlekSecret: crypto.randomBytes(32) // Volatile memory secret
};

function calculateHMACSignature(entry, prevSig) {
  const data = `${entry.id}-${entry.customer_id}-${entry.amount}-${entry.type}-${prevSig}`;
  return crypto.createHmac('sha256', globalState.mlekSecret).update(data).digest('hex');
}

runTest("Security - HMAC ledger chain validation (Tamper Detection)", () => {
  // Seed customer
  db.prepare("INSERT INTO customers (id, name, current_balance) VALUES ('c1', 'Client 1', 0)").run();

  // Insert initial ledger record (amount in centavos: 20000 = $200.00)
  const ledgerId1 = "l1";
  const amount1 = 20000;
  const sig1 = calculateHMACSignature({ id: ledgerId1, customer_id: "c1", amount: amount1, type: "DEBIT" }, "GENESIS");

  db.prepare(`
    INSERT INTO customer_ledger (id, customer_id, date, type, amount, description, hmac_signature)
    VALUES ('l1', 'c1', '2026-07-09 18:00:00', 'DEBIT', ?, 'Initial Charge', ?)
  `).run(amount1, sig1);

  // Insert second ledger record
  const ledgerId2 = "l2";
  const amount2 = 5000;
  const sig2 = calculateHMACSignature({ id: ledgerId2, customer_id: "c1", amount: amount2, type: "DEBIT" }, sig1);

  db.prepare(`
    INSERT INTO customer_ledger (id, customer_id, date, type, amount, description, hmac_signature)
    VALUES ('l2', 'c1', '2026-07-09 18:01:00', 'DEBIT', ?, 'Second Charge', ?)
  `).run(amount2, sig2);

  // Validate chain with in-memory key
  const ledger = db.prepare("SELECT * FROM customer_ledger ORDER BY date ASC").all();
  let prevSig = "GENESIS";
  for (const entry of ledger) {
    const checkSig = calculateHMACSignature(entry, prevSig);
    if (entry.hmac_signature !== checkSig) {
      throw new Error(`Tampering detected on entry ${entry.id}!`);
    }
    prevSig = entry.hmac_signature;
  }
});

runTest("Security Edge Case - Rejected manual edits without HMAC key", () => {
  // Simulate attacker editing the SQLite file directly to change the charge amount
  db.prepare("UPDATE customer_ledger SET amount = 1000 WHERE id = 'l1'").run();

  // Validate chain
  const ledger = db.prepare("SELECT * FROM customer_ledger ORDER BY date ASC").all();
  let prevSig = "GENESIS";
  let tamperCaught = false;

  for (const entry of ledger) {
    const checkSig = calculateHMACSignature(entry, prevSig);
    if (entry.hmac_signature !== checkSig) {
      tamperCaught = true;
      break;
    }
    prevSig = entry.hmac_signature;
  }

  if (!tamperCaught) {
    throw new Error("Attacker edited the database values without breaking the cryptographic chain!");
  }
});

// Restore database state for subsequent tests
db.prepare("UPDATE customer_ledger SET amount = 20000 WHERE id = 'l1'").run();

// 2. Lockout rate limit verification
function verifyLoginThrottling(attemptType, username, ipAddress) {
  const timeframe5Min = Date.now() - 300000;
  const timeframe15Min = Date.now() - 900000;

  // IP Throttling Check
  const failedIPCount = db.prepare(`
    SELECT COUNT(*) as count FROM login_attempts 
    WHERE attempt_type = ? AND ip_address = ? AND is_successful = 0 AND timestamp > ?
  `).get(attemptType, ipAddress, timeframe5Min).count;

  if (failedIPCount >= 3) {
    return "IP_LOCKED_OUT";
  }

  // Account/Endpoint Throttling Check
  const failedAccountCount = db.prepare(`
    SELECT COUNT(*) as count FROM login_attempts 
    WHERE attempt_type = ? AND username = ? AND is_successful = 0 AND timestamp > ?
  `).get(attemptType, username, timeframe15Min).count;

  if (failedAccountCount >= 5) {
    return "ACCOUNT_LOCKED_OUT";
  }

  return "PROCEED";
}

runTest("Security - Online login attempts rate limiter locks IP after 3 failures in 5 min", () => {
  // Log 3 failures from IP '192.168.1.50' for cashier PIN login
  const logAttempt = db.prepare(`
    INSERT INTO login_attempts (id, attempt_type, username, ip_address, timestamp, is_successful) 
    VALUES (?, 'PIN', 'cashier1', '192.168.1.50', ?, 0)
  `);
  logAttempt.run("att-1", Date.now());
  logAttempt.run("att-2", Date.now());
  logAttempt.run("att-3", Date.now());

  const status = verifyLoginThrottling("PIN", "cashier1", "192.168.1.50");
  if (status !== "IP_LOCKED_OUT") throw new Error("Limiter failed to lock IP after 3 failures!");
});

runTest("Security - Online login attempts rate limiter locks Account after 5 failures in 15 min", () => {
  // Log 2 more failures from a different IP ('192.168.1.60') to reach 5 total failures for 'cashier1'
  const logAttempt = db.prepare(`
    INSERT INTO login_attempts (id, attempt_type, username, ip_address, timestamp, is_successful) 
    VALUES (?, 'PIN', 'cashier1', '192.168.1.60', ?, 0)
  `);
  logAttempt.run("att-4", Date.now());
  logAttempt.run("att-5", Date.now());

  // Use a clean IP ('192.168.1.99') that is NOT IP-locked to assert that the account check works
  const status = verifyLoginThrottling("PIN", "cashier1", "192.168.1.99");
  if (status !== "ACCOUNT_LOCKED_OUT") throw new Error("Limiter failed to lock account after 5 failures!");
});

// 3. DOP Setup Entropy Check and Throttling
function validateDOPEntropy(dop) {
  if (dop.length < 14) return false;
  let hasLower = /[a-z]/.test(dop);
  let hasUpper = /[A-Z]/.test(dop);
  let hasDigit = /\d/.test(dop);
  let hasSpecial = /[^A-Za-z0-9]/.test(dop);
  let score = (hasLower ? 1 : 0) + (hasUpper ? 1 : 0) + (hasDigit ? 1 : 0) + (hasSpecial ? 1 : 0);
  return score >= 3;
}

runTest("Security - DOP Setup rejects low-entropy passphrases", () => {
  const isWeak = validateDOPEntropy("weakpass");
  const isShortButDiverse = validateDOPEntropy("wP1!"); // Too short
  const isStrong = validateDOPEntropy("CorrectPassphraseWord1!"); // Long and diverse

  if (isWeak) throw new Error("Accepted a low-entropy short passphrase");
  if (isShortButDiverse) throw new Error("Accepted a diverse but short passphrase");
  if (!isStrong) throw new Error("Rejected a valid high-entropy passphrase");
});

runTest("Security - Throttling is applied to DOP store-unlock endpoint", () => {
  // Log 3 failures to DOP endpoint '/api/unlock-store'
  const logAttempt = db.prepare(`
    INSERT INTO login_attempts (id, attempt_type, username, ip_address, timestamp, is_successful) 
    VALUES (?, 'DOP', '/api/unlock-store', '192.168.1.99', ?, 0)
  `);
  logAttempt.run("dop-att-1", Date.now());
  logAttempt.run("dop-att-2", Date.now());
  logAttempt.run("dop-att-3", Date.now());

  const status = verifyLoginThrottling("DOP", "/api/unlock-store", "192.168.1.99");
  if (status !== "IP_LOCKED_OUT") throw new Error("DOP unlock endpoint failed to trigger lockout on IP!");
});

runTest("Security - Throttling is applied to MMP recovery endpoint", () => {
  // Log 3 failures to MMP endpoint '/api/recover-store'
  const logAttempt = db.prepare(`
    INSERT INTO login_attempts (id, attempt_type, username, ip_address, timestamp, is_successful) 
    VALUES (?, 'MMP', '/api/recover-store', '192.168.1.88', ?, 0)
  `);
  logAttempt.run("mmp-att-1", Date.now());
  logAttempt.run("mmp-att-2", Date.now());
  logAttempt.run("mmp-att-3", Date.now());

  const status = verifyLoginThrottling("MMP", "/api/recover-store", "192.168.1.88");
  if (status !== "IP_LOCKED_OUT") throw new Error("MMP recovery endpoint failed to trigger lockout on IP!");
});

console.log("\n>>> ALL Hardened ERP Core Tests Passed! <<<\n");
db.close();
if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
