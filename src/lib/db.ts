import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { logger } from '@/lib/logger';

const dbDir = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

declare global {
  var dbInstance: DatabaseType | undefined;
}

const dbPath = process.env.NODE_ENV === 'test' ? ':memory:' : path.join(dbDir, 'database.db');
let activeDb = globalThis.dbInstance || new Database(dbPath);

if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
  globalThis.dbInstance = activeDb;
}

// Configure WAL mode and concurrency locks
activeDb.pragma('journal_mode = WAL');
activeDb.pragma('synchronous = NORMAL');
activeDb.pragma('busy_timeout = 10000');
activeDb.pragma('foreign_keys = ON');

export function swapDatabase(tempRestorePath: string) {
  activeDb.close();
  if (dbPath !== ':memory:') {
    fs.copyFileSync(tempRestorePath, dbPath);
    activeDb = new Database(dbPath);
  } else {
    activeDb = new Database(tempRestorePath);
  }
  activeDb.pragma('journal_mode = WAL');
  activeDb.pragma('synchronous = NORMAL');
  activeDb.pragma('busy_timeout = 10000');
  activeDb.pragma('foreign_keys = ON');
  if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
    globalThis.dbInstance = activeDb;
  }
}

const dbProxy = new Proxy({} as DatabaseType, {
  get(target, prop, receiver) {
    const targetDb = activeDb;
    const value = Reflect.get(targetDb, prop);
    if (typeof value === 'function') {
      return value.bind(targetDb);
    }
    return value;
  },
  set(target, prop, value, receiver) {
    return Reflect.set(activeDb, prop, value);
  }
});

const db = dbProxy;

export async function runMigrations(mlekSecret?: string) {
  // Ensure migration tracker table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const migrationsDir = path.resolve(process.cwd(), 'migrations');
  if (!fs.existsSync(migrationsDir)) return;

  const files = fs.readdirSync(migrationsDir).sort();
  for (const file of files) {
    const match = file.match(/^(\d+)_.+\.(sql|js|ts)$/);
    if (!match) continue;

    const version = parseInt(match[1], 10);
    const row = db.prepare("SELECT 1 FROM schema_migrations WHERE version = ?").get(version);
    if (row) continue; // Already applied

    const ext = path.extname(file);
    if (ext === '.sql') {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      const runSql = db.transaction(() => {
        db.exec(sql);
        db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))").run(version);
      });
      runSql();
      logger.info(`Successfully applied SQL migration: ${file}`);
    } else if (ext === '.js' || ext === '.ts') {
      if (!mlekSecret) {
        logger.warn(`Programmatic migration ${file} requires unlocked MLEK. Skipping.`);
        continue;
      }
      const migrationPath = path.join(migrationsDir, file);
      // Run the JS/TS module migration function using manual transaction boundary for async support
      db.prepare('BEGIN').run();
      try {
        // @ts-expect-error dynamic require for migrations
        const requireFunc = typeof __webpack_require__ === "function" ? __non_webpack_require__ : require;
        const migration = requireFunc(migrationPath);
        const migrateFn = typeof migration === 'function' ? migration : migration.default;
        await migrateFn(db, mlekSecret);
        db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))").run(version);
        db.prepare('COMMIT').run();
        logger.info(`Successfully applied programmatic JS migration: ${file}`);
      } catch (err) {
        db.prepare('ROLLBACK').run();
        logger.error(`Failed to apply programmatic JS migration ${file}:`, err);
        throw err;
      }
    }
  }

  // Seed default systemic rows if they are missing
  seedSystemData();
}

function seedSystemData() {
  const insertUser = db.prepare(`
    INSERT OR IGNORE INTO users (id, username, name, role, passcode_hash, passcode_salt, is_active, is_system)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  // Seed SYSTEM daemon user
  insertUser.run(
    'system-daemon', 
    'SYSTEM', 
    'SYSTEM Daemon', 
    'Admin', 
    crypto.randomBytes(32).toString('hex'), 
    crypto.randomBytes(8).toString('hex'), 
    1, 
    1
  );

  // Seed chart of accounts
  const insertAccount = db.prepare(`
    INSERT OR IGNORE INTO accounts (id, code, name, category, balance)
    VALUES (?, ?, ?, ?, 0)
  `);

  insertAccount.run('acc-cash', '1010', 'Cash Drawer', 'Asset');
  insertAccount.run('acc-ar', '1110', 'Accounts Receivable', 'Asset');
  insertAccount.run('acc-inv', '1210', 'Inventory Asset', 'Asset');
  insertAccount.run('acc-ap', '2010', 'Accounts Payable', 'Liability');
  insertAccount.run('acc-vat-payable', '2020', 'VAT Payable', 'Liability');
  insertAccount.run('acc-equity', '3010', 'Owner Equity', 'Equity');
  insertAccount.run('acc-revenue', '4010', 'Sales Revenue', 'Revenue');
  insertAccount.run('acc-cost-of-sales', '5010', 'Cost of Sales', 'Expense');
  insertAccount.run('acc-freight', '5020', 'Freight/Delivery Fee Expense', 'Expense');
  insertAccount.run('acc-depreciation', '5030', 'Depreciation Expense', 'Expense');
  insertAccount.run('acc-accum-depr', '1810', 'Accumulated Depreciation', 'Asset');

  // Seed default items in inventory if empty
  const countItems = db.prepare("SELECT COUNT(*) as count FROM inventory").get() as { count: number };
  if (countItems.count === 0) {
    const insertItem = db.prepare(`
      INSERT INTO inventory (id, name, category, unit, stock_quantity, cost_price, selling_price, wholesale_price, reorder_level, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `);

    // Quantities in millicounts (1000 = 1.0 unit), Cost/Prices in centavos (100 = $1.00)
    insertItem.run('item-blocks-4', 'Hollow Block 4"', 'Masonry', 'pc', 1500000, 1500, 2000, 1800, 200000); // 1500 pcs, cost 15.00, sell 20.00
    insertItem.run('item-blocks-6', 'Hollow Block 6"', 'Masonry', 'pc', 800000, 2500, 3200, 2900, 100000);  // 800 pcs
    insertItem.run('item-sand', 'Screened Sand', 'Aggregates', 'cu.m', 50000, 350000, 420000, 400000, 10000); // 50 cu.m
    insertItem.run('item-gravel', 'Gravel 3/4', 'Aggregates', 'cu.m', 40000, 400000, 480000, 450000, 10000);  // 40 cu.m
    insertItem.run('item-cement', 'Portland Cement', 'Cement', 'bag', 300000, 22000, 27000, 25000, 50000);   // 300 bags
    insertItem.run('item-rebar', 'Deformed Rebar 10mm', 'Steel', 'pc', 400000, 12000, 15000, 13500, 50000);  // 400 pcs
  }
}

// Graceful shutdown: close DB on SIGTERM/SIGINT
function shutdown(signal: string) {
  logger.info(`Received ${signal}. Closing database...`);
  try { db.close(); } catch { /* already closed */ }
  logger.info('Database closed. Goodbye.');
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default db;
export { dbPath };
