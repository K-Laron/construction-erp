const { parentPort, workerData } = require('worker_threads');
const Database = require('better-sqlite3');
const path = require('path');

try {
  const { query, params, dbPath } = workerData;
  
  // Establish read-only isolated database connection to free main thread loop
  const db = new Database(dbPath, { readonly: true });
  db.pragma('journal_mode = WAL');

  const rows = db.prepare(query).all(...(params || []));
  
  db.close();
  parentPort.postMessage({ success: true, rows });
} catch (error) {
  parentPort.postMessage({ success: false, error: error.message });
}
