# BIG BITES POS Windows deployment

The Windows NSIS installer bundles the compiled API server, Prisma migrations,
production server dependencies, a private signed Node.js 24.19.0 x64 runtime,
and setup scripts. The packaging build creates those dependencies from the
server lockfile in an isolated directory, then excludes only the Prisma Studio
UI/build metadata and local Prisma-dev database assets. The retained runtime
was checked by generating Prisma Client, importing the server dependencies,
and launching `migrate deploy` against an intentionally unreachable loopback
port; the installer does not remove these files from the developer dependency
tree. Its per-machine install mode requires administrator access; the
post-install hook runs local server setup before launching the desktop app. Use
a supported Windows 10/11 x64 POS PC. Node.js and `winget` are not required on
the client PC. Internet access is required on a fresh installation only when
PostgreSQL is absent; setup downloads PostgreSQL 17.11 from EnterpriseDB and
verifies its Authenticode signature before running it. The installer is not a
fully offline package.

During installation, the post-install setup:

1. Verifies the bundled Node.js runtime against its expected SHA-256, version,
   and x64 architecture, then installs it into the protected local server
   directory. If PostgreSQL is missing, downloads and verifies the official
   EnterpriseDB installer and creates a dedicated BIG BITES PostgreSQL service.
   Setup does not adopt an unrelated pre-existing PostgreSQL service for a
   fresh installation; a conflicting PostgreSQL service or occupied port 5432
   is left untouched and reported.
   The PostgreSQL package is streamed into a unique protected temporary
   directory, checked against the response byte count, then signature-verified
   before execution. Download and installer stages have time limits and log
   progress, verification status, and the installer exit code without logging
   database credentials. The download allows up to five minutes for response
   and network reads, retries transient network failures up to three times, and
   has a 60-minute overall download deadline. The setup process has a separate
   two-hour hard timeout to cover slow downloads and PostgreSQL installation.
   On upgrades, it stages and validates the complete versioned server payload
   before stopping the running server. It switches an active-payload pointer
   only after database checks and migrations succeed; the previous payload is
   retained for recovery.
2. Creates a new local PostgreSQL database and application role only when
   setup can prove that both are absent and owned by the current installation
   attempt. It writes generated credentials to
   `%ProgramData%\BIG BITES POS\server\.env`. Access is restricted to SYSTEM
   and local Administrators. The installer does not seed menu data or create
   application accounts automatically.
3. Adds TCP 3000 and UDP 3001 inbound firewall rules limited to the local
   subnet.
4. Configures the selected PostgreSQL service for automatic startup, then
   registers and starts the server at Windows startup through Task Scheduler.
5. Checks `http://127.0.0.1:3000/health` and creates a common desktop shortcut.

If setup, migration, health, or LAN discovery validation fails, the installer
reports the setup log and does not launch the desktop as though the local
server were ready. If an upgrade has not applied a migration that could make
the previous server incompatible, setup restores the previous payload and
attempts to restart its scheduled service. If database compatibility is
uncertain, the old payload remains available but automatic restart is withheld.

Fresh-install retries use the protected
`%ProgramData%\BIG BITES POS\installation-state.json` journal and the local
configuration to identify only the role/database created by that attempt.
Retries can resume when the ownership marker and local database state are
verified. A retry repairs the known malformed `=public` database URL only
after verifying both ownership markers; it does not drop, recreate, or reset
the database. Preflight parses each Prisma migration ledger name/checksum pair
before applying the retry gate, and normalizes only the verified stock-removal
migration identity; malformed, duplicate, or unknown entries are rejected.
Ambiguous or partially migrated databases are left untouched
and require the recovery instruction in the setup log. Do not manually delete
a role/database or reset the database to bypass this check.

**Stock-removal migration policy:** the verified historical migration
`20261020101500_remove_product_stock` drops stock columns and
`ProductStockMovement`. The installer verifies its exact historical SHA-256
(`98c0f088b6a25779eff60a5f618750ce8b2caee557334c316a68d41a1c9fa751`),
allowing only CRLF-to-LF line-ending normalization, but stages a comment-only
replacement under that migration identity so Prisma cannot execute its
destructive SQL. Fresh databases deploy the full ordered migration set,
including that safe replacement; setup does not mark the final migration
applied ahead of the initial schema migrations. Installer-created databases
can receive only an additive repair of missing stock metadata and the movement
table, and only after the ownership journal and the existing `Product.stock`
column are verified. That repair preserves stock quantities
and does not fabricate movement records. Its SQL explicitly targets the
`public` schema and runs transactionally, so an unexpected schema/search-path
state fails without leaving a partial repair. Existing databases are not
automatically repaired or migrated; unknown or pending migration history
fails closed. Do not rename or edit migration history to bypass these checks.

Read-only inspection of the configured loopback development database found a
successful `20261020101500_remove_product_stock` ledger entry, while the
repository contains `20261020100000_remove_product_stock` with a different
checksum. That database has no stock columns or movement table. It is named
`bigbites_neon_stage`, not the installer target `bigbites`; this evidence does
not establish production equivalence and no migration or data change was run.

The Tauri installer bundles the canonical `apps/server` build, schema, and
migrations. The checked-in `BIG-BITES-SERVER-CLIENT` runtime is a separate,
stale bundle: its schema and migration directory do not match canonical
source, and its compiled routes retain stock behavior not present in current
canonical routes. Do not launch or refresh that bundle as a release until its
schema, migrations, generated Prisma Client, and compiled routes have been
reconciled and validated together.
The canonical Prisma schema, server, and desktop UI include stock management
and stock-movement history. The historical removal migration is retained for
checksum verification but is never executed by the local installer.

## Explicit initialization of a new local database

After installation, an administrator may run
`<installation directory>\resources\windows\Initialize-BigBites.ps1` from an
interactive, elevated PowerShell session. Initialization requires typing
`INITIALIZE EMPTY POS`, separately confirming the initial menu with
`ADD INITIAL MENU`, and entering display names, usernames, and masked
passwords for the ADMIN, CASHIER, and WAITER accounts. Passwords must be at
least 12 characters; they are sent to the local setup process through stdin
and stored as scrypt hashes. They are not written to setup logs or displayed.

The initializer only accepts the installed local PostgreSQL endpoint. It
checks for existing users, menu/catalog entries, orders, payments,
non-default tables or settings, and unknown database tables inside
the same transaction as create-only initialization. If it finds any such
data, it aborts without changing the database. The normal installer never
invokes the initializer or the menu-update seed. This process does not access
or initialize Render or Neon.

## Sync the production menu to the local POS

The installed desktop POS and waiter app route their normal API requests to
the local server and PostgreSQL database, separate from production Neon. The
installer does not automatically populate this database. A full
network-disconnection acceptance test has not been performed, so this setup
does not claim that every application feature is verified to work offline.

Production menu sync is disabled in the standard local-only desktop build, so
clicking or invoking the sync action cannot contact Render or Neon. A
separately built desktop may enable the optional sync with
`VITE_ENABLE_PRODUCTION_CATALOG_SYNC=true`; the server must also be explicitly
configured with `BIGBITES_ENABLE_PRODUCTION_CATALOG_SYNC=true`. The local
server startup script explicitly disables that opt-in for the installed
client. Only enable both in a separately configured deployment where the
online catalog dependency is intended.

Catalog synchronization must preserve local stock and stock-movement history
when that schema is available. Local-only products, categories, and variants,
along with orders, users, and payments, are not removed or altered.
When enabled, the sync reads the Render menu API and does not write to
production. The installed server explicitly disables this optional,
internet-dependent feature. Health, menu, order, and billing requests use the
local API by default; offline operation still requires end-to-end acceptance
testing before it can be certified.

The installed Tauri desktop app always uses `http://127.0.0.1:3000`;
`VITE_API_URL` affects browser builds only. The desktop requires a successful
`/health` response with a connected database before login. Release waiter
builds discover the local server over the restaurant LAN and retry discovery
and health checks every 15 seconds so a temporary Wi-Fi interruption or server
address change can recover without manual IP entry. For server development, non-production processes refuse non-loopback
`DATABASE_URL` values. The installed local server sets
`BIGBITES_DEPLOYMENT_MODE=local`; source processes with a local `.env` file
are also treated as local. Both enforce a loopback PostgreSQL URL even with
`NODE_ENV=production`. The `npm start` lifecycle hook skips automatic
migrations in local environments. The hosted Render deployment has no local
`.env` file or local-mode marker and retains its existing production
migration behavior.

Before building or distributing an installer, obtain owner-approved evidence
for each target's migration ledger, exact schema, and verified backup restore.
Repository migration files and database row counts alone do not establish
compatibility or data equivalence. Do not run installer tests against an
active restaurant installation or a populated database.

Order numbers are generated by the server and displayed by both the desktop
and waiter apps. After the final order is deleted, the next order starts at
number 1 again.

## Monthly Excel reports

In desktop **Order History & Monthly Excel Reports**, choose the destination
folder on the POS computer. Use **Export YYYY-MM** beside a month to save that
reporting period only, or **Update Monthly Workbooks** to save every available
paid-order month. The app reports the saved path and does not claim success if
the selected folder is unavailable or the workbook cannot be verified.

## Waiter API configuration

The standard waiter build automatically discovers the local desktop server
over UDP port 3001, then checks the server at HTTP port 3000 before enabling
login. After selecting a table, the waiter explicitly selects **All** or a
category before menu items are shown; category labels come from the local
catalog. It does not require a manually entered IP address. Do not set
`API_BASE_URL` for the standard local/offline release; a deliberate build-time
override (`--dart-define=API_BASE_URL=...`) bypasses LAN discovery and routes
all waiter API actions to the selected backend.

## Build the Windows installer and Android app

From the repository root:

```powershell
npm --prefix apps/server run build
npm --prefix apps/desktop run tauri -- build --bundles nsis
cd apps/waiter_app
flutter pub get
flutter build apk --release
```

The Tauri build command runs the desktop build and backend TypeScript build
before bundling. The generated NSIS installer is under
`apps/desktop/src-tauri/target/release/bundle/nsis/`.

## Update an existing standalone server bundle

The standalone `BIG-BITES-SERVER-CLIENT` runtime contains compiled server
output, not editable TypeScript source. Update it from the canonical server
source and deploy the compiler output; do not edit files under `dist` by hand:

**Do not run the update commands below for the current tree.** Canonical and
standalone migration histories conflict, and both contain the stock-removal
migration. Resolve the migration history and runtime/schema mismatch first;
the startup guard intentionally blocks automatic migration deployment.

```powershell
npm --prefix apps/server test
npm --prefix apps/server run build
Copy-Item -Path apps/server/dist/* `
  -Destination BIG-BITES-SERVER-CLIENT/dist -Recurse -Force
Copy-Item -LiteralPath apps/server/prisma/schema.prisma `
  -Destination BIG-BITES-SERVER-CLIENT/prisma/schema.prisma -Force
Copy-Item -Path apps/server/prisma/migrations/* `
  -Destination BIG-BITES-SERVER-CLIENT/prisma/migrations -Recurse -Force
Push-Location BIG-BITES-SERVER-CLIENT
npx prisma generate --schema prisma/schema.prisma
Pop-Location
```

When a schema migration is included, plan and apply it to the target database
through the approved migration process before starting code that requires its
new columns. For an existing database, the installer refuses pending
migrations unless explicitly enabled and interactively confirmed; before
applying them it creates and validates a custom-format backup under
`%ProgramData%\BIG BITES POS\backups`. The startup launcher does not apply
migrations. Do not stop or
replace the running service until the compiled output, generated Prisma client,
schema, and migrations have all been verified. Then stop only the Node.js
process confirmed to own port 3000, and use
`BIG-BITES-SERVER-CLIENT/START-BIG-BITES-SERVER.bat` to start the updated
server. The launcher does not replace a running process.

## Operational checks

On the POS PC:

```powershell
Invoke-RestMethod http://127.0.0.1:3000/health
Get-ScheduledTask -TaskName BigBitesPosServer
Get-NetFirewallRule -DisplayName "BIG BITES POS API TCP 3000"
Get-NetFirewallRule -DisplayName "BIG BITES POS Discovery UDP 3001"
```

On an Android device connected to the same Wi-Fi, open BIG BITES Waiter and
confirm its login screen reports the detected server URL before logging in.
Then check tables/products, create an order, and verify it appears on the POS
before exercising billing and payment.

## Existing PostgreSQL installations

The setup deliberately stops if PostgreSQL is already installed rather than
guessing an administrator password, changing an existing instance, or risking
client data. For such PCs, an administrator must plan the existing database
credentials and migrate/backup process with support before installation.
