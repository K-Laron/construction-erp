# Construction Supply ERP — Deployment & Operations Manual

> **Document classification:** Internal Operations  
> **Audience:** System administrators, store managers, IT support personnel

---

## Table of Contents

1. [System Requirements](#1-system-requirements)
2. [Installation & Build](#2-installation--build)
3. [Launching the System](#3-launching-the-system)
4. [First-Boot Bootstrap](#4-first-boot-bootstrap)
5. [Daily Operations](#5-daily-operations)
6. [PWA & Offline Access](#6-pwa--offline-access)
7. [Backup & Disaster Recovery](#7-backup--disaster-recovery)
8. [Database Migrations](#8-database-migrations)
9. [Security Summary](#9-security-summary)

---

## 1. System Requirements

| Component | Requirement |
|-----------|-------------|
| **Operating System** | Linux (Ubuntu 22.04+ / Debian 12+ recommended) |
| **Runtime** | Node.js 18 or later |
| **Network** | Local Area Network (LAN) — **no internet access required** |
| **Storage** | Sufficient disk for the SQLite database and encrypted backups |

> [!NOTE]
> The system is designed to run entirely air-gapped on a private LAN. All dependencies are bundled at install time.

---

## 2. Installation & Build

### 2.1 Install Dependencies

```bash
npm install
```

### 2.2 Configure Environment

Create a `.env.local` file in the project root:

```env
SESSION_PASSWORD=your_secure_random_string_at_least_32_characters
# Optional: Set to 'false' if running on a local LAN over unencrypted HTTP (no SSL) in production mode
SESSION_SECURE=true
```

> [!CAUTION]
> **`SESSION_PASSWORD` is critical for production.** This value secures all `iron-session` cookies. If it is not set in production (`NODE_ENV=production`), the application will **refuse to start**. In development mode, a cryptographically random fallback is auto-generated per process — this is safe only for local development and must never be relied upon in production. An unset or weak session password means session cookies are trivially forgeable.
>
> **`SESSION_SECURE` settings:**
> By default, the application marks cookies as `secure: true` in production, forcing the browser to only transmit them over HTTPS. If you are deploying to a local LAN without HTTPS, you **MUST** set `SESSION_SECURE=false` in `.env.local`, or the browser will discard session cookies and logins will fail.

### 2.3 HTTPS on LAN (Optional)

For HTTPS within a trusted LAN, generate locally signed certificates with [`mkcert`](https://github.com/FiloSottile/mkcert):

```bash
# Install mkcert (once per machine)
sudo apt install libnss3-tools
curl -JLO "https://github.com/FiloSottile/mkcert/releases/latest/download/mkcert-v*-linux-amd64"
sudo install mkcert-v*-linux-amd64 /usr/local/bin/mkcert
mkcert -install

# Generate certs for your LAN hostname / IP
mkcert <hostname-or-ip>
```

Alternatively, place the server behind an NGINX reverse proxy with TLS termination.

### 2.4 Build for Production

```bash
npm run build
```

This produces the optimised Next.js production bundle in the `.next/` directory.

---

## 3. Launching the System

### Option A — Automated Launcher (recommended)

```bash
./run-app.sh
```

The launcher script will:
1. Detect if a production build exists; if not, run `npm run build` automatically.
2. Start the server in the background.
3. Wait up to 30 seconds for port 3000 to become available.
4. Open the default browser to `http://localhost:3000`.

### Option B — Manual Start

```bash
npm run start
```

The server binds to **`0.0.0.0:3000`** over HTTP by default. LAN clients (tablets, registers) access the system at:

```
http://<host-ip>:3000
```

---

## 4. First-Boot Bootstrap

On first launch, the system starts in a **LOCKED** state and requires a one-time bootstrap ceremony. No transactions can occur until this process is completed by the initial administrator.

### 4.1 Set the Daily Operational Passphrase (DOP)

The admin must create a DOP that meets the following requirements:

| Rule | Detail |
|------|--------|
| **Minimum length** | 14 characters |
| **Complexity** | Must include characters from at least 3 of 4 classes: uppercase, lowercase, digits, symbols |

The DOP is what managers will enter each day to unlock the store.

### 4.2 Record the Master Mnemonic Passphrase (MMP)

The system generates a **12-word Master Mnemonic Passphrase** during bootstrap. This is the disaster-recovery key.

> [!CAUTION]
> **Write the MMP down on paper and store it in a physically secure location** (e.g., a safe or lockbox). The MMP is the only way to recover the Master Ledger Encryption Key if the DOP is lost or forgotten. It is displayed once and cannot be retrieved later.

### 4.3 Record the Admin PIN

A **cryptographically random 6-digit PIN** is generated for the initial admin account and displayed **exactly once** on screen.

> [!WARNING]
> Record this PIN immediately. It cannot be displayed again. If lost before creating additional manager accounts, the only recovery path is via the MMP.

### 4.4 Master Ledger Encryption Key (MLEK) Generation

Behind the scenes, the bootstrap process:

1. Generates a high-entropy **Master Ledger Encryption Key (MLEK)**.
2. Encrypts the MLEK under both the **DOP** and the **MMP** (two independent wrapping keys).
3. Stores the encrypted key blobs in the database — the raw MLEK is never persisted to disk.

---

## 5. Daily Operations

### 5.1 Store Unlock Flow

```
┌─────────────────────────────────────────────────┐
│  System boots → Store is LOCKED                 │
│  Manager enters DOP on the main terminal        │
│  → MLEK decrypted into server memory            │
│  → Store is UNLOCKED — transactions enabled     │
│  Cashiers log in with their personal PIN        │
└─────────────────────────────────────────────────┘
```

- The store starts **locked** every time the server (re)starts.
- A Manager or Admin must enter the **DOP** on the primary terminal to decrypt the MLEK into server memory.
- Once unlocked, cashiers authenticate using their individual **PIN codes**.
- Sessions are managed via secure, `HttpOnly` cookies with automatic expiry and rotation.

### 5.2 Rate Limiting & Account Lockout

The system enforces progressive lockout to prevent brute-force attacks:

| Trigger | Threshold | Lockout Duration |
|---------|-----------|-----------------|
| **IP lock** | 3 failed attempts within 5 minutes | IP blocked for 5 minutes |
| **Account lock** | 5 failed attempts within 15 minutes | Account locked for 15 minutes |

> [!NOTE]
> Rate limiting state is held in-memory and resets on server restart. Persistent attackers on a LAN should be addressed at the network level.

---

## 6. PWA & Offline Access

The application is a fully installable **Progressive Web App (PWA)**, designed for use on tablets and dedicated POS devices.

| Feature | Implementation |
|---------|---------------|
| **Installability** | `manifest.json` with `"display": "standalone"`, app icons (192×192, 512×512) |
| **Offline caching** | Service worker (`public/sw.js`) with a network-first strategy — successful responses are cached; cached versions are served when the network is unavailable |
| **Cached resources** | Root page (`/`), manifest, and all subsequently fetched static assets |

### Installing on a Device

1. Open `http://<host-ip>:3000` in Chrome or Edge on the target device.
2. Tap the browser's **"Install App"** or **"Add to Home Screen"** prompt.
3. The app launches in standalone mode (no browser chrome) on subsequent opens.

---

## 7. Backup & Disaster Recovery

### 7.1 Database Location

| Item | Path / Mode |
|------|-------------|
| **Database file** | `data/database.db` |
| **Journal mode** | WAL (Write-Ahead Logging) — safe for concurrent reads during backup |

### 7.2 Encrypted Backup Process

Backups are created via the Maintenance Panel or scheduled cron jobs:

1. A WAL-safe snapshot is taken using SQLite's `VACUUM INTO` to a temporary file.
2. A **backup-specific encryption key** is derived from the MLEK using **PBKDF2-SHA256** with 100,000 iterations and a dedicated salt — the raw MLEK is never used directly as an AES key.
3. The snapshot is encrypted with **AES-256-GCM** (12-byte IV, 16-byte authentication tag).
4. The final payload is structured as: `IV (12 B) || Auth Tag (16 B) || Ciphertext`.
5. The payload is Base64-encoded and delivered to the client as `backup_YYYY-MM-DD.enc`.

> [!IMPORTANT]
> **Temporary file hygiene:** Unencrypted backup snapshots are written to `os.tmpdir()` with UUID-based filenames and are unconditionally deleted in a `finally` block, regardless of encryption success or failure. If cleanup fails, a `CRITICAL` log entry is emitted.

### 7.3 Disaster Recovery Procedure

In the event of host machine failure or data corruption:

1. **Provision a new host** meeting the system requirements (§1).
2. **Install the application** following the setup steps (§2).
3. **Place the encrypted backup** file in the `data/` directory.
4. **Start the server** and unlock the store using either:
   - The **Daily Operational Passphrase (DOP)**, or
   - The **12-word Master Mnemonic Passphrase (MMP)** if the DOP is unavailable.
5. The system will decrypt the backup and restore all ledger data.

---

## 8. Database Migrations

### SQL Schema Migrations

Schema migrations are **automatically applied on server boot** before the application accepts requests. The current migration set:

| Migration | Purpose |
|-----------|---------|
| `001_initial_schema.sql` | Core tables (users, inventory, transactions, ledger) |
| `002_indexes_and_constraints.sql` | Performance indexes and foreign key constraints |
| `003_add_vat_payable.sql` | VAT/tax tracking columns |
| `004_hmac_hardening.sql` | HMAC chain integrity columns |
| `005_add_cashier_id_to_customer_ledger.sql` | Cashier attribution for customer ledger entries |

### Programmatic (JS) Migrations

Some migrations require access to decrypted data (e.g., re-encrypting fields under a new schema). These run **only after the Manager unlocks the store with the DOP**, ensuring the MLEK is available in memory.

> [!NOTE]
> Migrations are idempotent. Re-running a migration that has already been applied is a safe no-op.

---

## 9. Security Summary

### 9.1 Credential Management

- **No hardcoded credentials** exist anywhere in the codebase.
- `SESSION_PASSWORD` is loaded exclusively from the environment; production enforces its presence at startup.
- Development mode auto-generates a random session secret per process lifecycle to prevent accidental credential leakage.

### 9.2 Cryptographic Primitives

| Purpose | Algorithm | Parameters |
|---------|-----------|------------|
| **Passphrase hashing** (DOP, PIN) | PBKDF2-SHA512 | 100,000 – 600,000 iterations (tuned per context) |
| **Data-at-rest encryption** (PII) | AES-256-GCM | 12-byte IV, 16-byte authentication tag |
| **Backup encryption** | AES-256-GCM | Key derived via PBKDF2-SHA256 from MLEK (not raw MLEK) |
| **Ledger integrity** | HMAC-SHA256 | Tamper-evident hash chains across ledger entries |

### 9.3 Application-Level Security

| Control | Detail |
|---------|--------|
| **Server-side price & tax validation** | All pricing and tax calculations are authoritative on the server; client values are never trusted |
| **Structured error handling** | Application errors use typed error classes — no raw `throw` of strings or unstructured objects |
| **UI crash isolation** | React `ErrorBoundary` wraps each view, preventing a component crash from taking down the entire interface |
| **Session security** | `HttpOnly`, `Secure`, `SameSite=Lax` cookies with automatic expiry and rotation (TTL: 8 hours) |
| **Role-based access control** | Server Actions enforce RBAC checks (Admin, Manager, Cashier) before executing privileged operations |
| **Inactivity Auto-Lock** | MLEK automatically zero-filled and evicted from server process memory after 30 minutes of inactivity |
| **Backup Integrity Verification** | Every backup checkpoint is verified using `PRAGMA integrity_check` prior to GCM encryption |
| **Zod Input Boundaries** | Mutating Server Actions strictly validate all parameters against schemas before database transactions |
| **Structured JSON Logging** | Production logging outputs single-line JSON with dynamic request context `x-trace-id` trace correlation |

---

> [!TIP]
> For questions about the security architecture in greater depth, refer to the audit report in `docs/AUDIT_FINAL.md`. For implementation details, see `docs/IMPLEMENTATION_PLAN.md`.
