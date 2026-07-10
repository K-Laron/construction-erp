# Construction Supply ERP: Deployment & Operations Guide

## Production-Grade Standards Check
This document serves as the operational manual for deploying and maintaining the Construction Supply ERP system on a local network.

## 1. System Requirements
- OS: Linux (Ubuntu/Debian recommended for the host)
- Node.js 18+ installed
- Network: Local Area Network (LAN). No internet access is required.

## 2. Setup & Installation
1. Install dependencies:
   ```bash
   npm install
   ```
2. Generate locally trusted SSL certificates to allow Secure Contexts (Web Crypto API, secure cookies) over the LAN:
   ```bash
   ./scripts/setup-certs.sh
   ```
   *Note: This script will install mkcert and create key.pem and cert.pem in the `./certificates` directory.*
3. Build the application:
   ```bash
   npm run build
   ```

## 3. Launching the System
To start the ERP suite and broadcast over the LAN, run:
```bash
npm run start
```
By default, the server binds to `0.0.0.0:3000` over HTTPS.
Cashiers and managers can access the system from tablets or registers by navigating to `https://construction-erp.local:3000` or the host's IP address.

## 4. Daily Operations & Security
- **Store Unlock (Daily)**: The system starts in a "Locked" state. Cashiers cannot perform transactions until a Manager enters the Daily Operational Passphrase (DOP) on the main terminal to decrypt the Master Ledger Encryption Key (MLEK) into server memory.
- **Session Security**: The system relies on secure, HttpOnly session cookies for all data-mutating Server Actions. Sessions expire automatically and rotate strictly.

## 5. Backup & Disaster Recovery
- **Database Location**: The database is stored in `data/database.db` and operates in Write-Ahead Log (WAL) mode.
- **Encrypted Backups**: Nightly cron jobs or manual backups taken via the Maintenance Panel will package and encrypt the SQLite database using AES-256-GCM.
- **Disaster Recovery**: In case of a host machine failure, reinstall the system on a new host, place the encrypted backup in the `data/` directory, and unlock the store using either the DOP or the 12-word Master Mnemonic Passphrase (MMP).

## 6. Updates & Migrations
When upgrading the system, any new database schema changes will be automatically applied upon booting the server.
If programmatic migrations (requiring data decryption) are present, they will run *only after* the Manager unlocks the store with the DOP.
