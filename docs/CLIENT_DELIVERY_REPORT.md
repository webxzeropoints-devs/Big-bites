# BIG BITES FAMILY RESTAURANT POS — Client Delivery Audit

**Audit date:** 2026-10-08  
**Result:** ❌ **NOT READY FOR CLIENT DELIVERY**

The desktop and waiter payloads align for the client-used API routes, and the
desktop, backend, and waiter checks pass. Delivery is blocked by destructive
re-seeding and fixed credentials, installer failures treated as success,
missing kitchen workflow support, and unverified/stale deployment artifacts.

## Scope and validation

Inspected the existing server, Prisma schema/migrations/seed, Tauri configuration
and Windows setup scripts, desktop screens/API calls, Flutter waiter flow/API
service, and the deployment guide. No database or schema changes were made.
Secret values in environment files were not read or contacted.

| Check | Result |
|---|---|
| `npm --prefix apps/server run test:financial` | Pass: TypeScript build and 27 backend tests |
| `npm --prefix apps/desktop run build` | Pass: TypeScript check and Vite production build |
| `flutter analyze` in `apps/waiter_app` | Pass: no issues |
| `flutter test` in `apps/waiter_app` | Pass: waiter currency tests |
| Tauri production installer | A configured NSIS setup executable exists in the generated target directory, but its bundled resources and provenance were not verified from a clean checkout. |
| Clean Windows install, live PostgreSQL/migration state, and Android-on-client-network flow | Not exercised; these require the actual client environment/device. |

## Priority findings

### CRITICAL

#### CD-01 — Installer reruns overwrite live restaurant data

- **Problem / root cause:** The installer always runs the seed after migrations.
  The seed upserts tables with `AVAILABLE` status, resets seeded products'
  stock/prices, and overwrites seeded account passwords. This is not a
  first-install-only operation.
- **Affected files:** [`Install-BigBites.ps1`](../apps/desktop/src-tauri/windows/Install-BigBites.ps1#L774),
  [`seed.ts`](../apps/server/prisma/seed/seed.ts#L42),
  [`seed.ts`](../apps/server/prisma/seed/seed.ts#L154),
  [`seed.ts`](../apps/server/prisma/seed/seed.ts#L207).
- **Exact fix:** Run initial demo/bootstrap seeding only when provisioning a
  newly created, empty database. Do not invoke the demo seed during upgrades,
  repair installs, or restarts. Keep production inventory, table state, and
  user credentials out of update-time seed `update` clauses.
- **Risk if not fixed:** A reinstall or upgrade can erase inventory counts,
  mark occupied/reserved tables available, and reset staff passwords. This can
  cause order/inventory loss or disrupt service.

### HIGH

#### CD-02 — Installer continues after backend setup fails

- **Problem / root cause:** The NSIS hook logs a missing setup script, missing
  server resources, missing PowerShell, or nonzero setup exit as a warning and
  then reaches `ExecShell` to launch the desktop anyway. The desktop can appear
  installed while its database/server was never provisioned.
- **Affected file:** [`installer.nsh`](../apps/desktop/src-tauri/windows/installer.nsh#L1).
- **Exact fix:** Make required server setup failures fail the installation
  (propagate a nonzero installer result), do not create/launch the desktop
  shortcut on failure, and display the setup-log location with a retry path.
  Only make server setup optional if the product explicitly supports an
  external backend and provides its configuration flow.
- **Risk if not fixed:** The customer can finish setup, open a login screen, and
  have no working backend or database, with the actual setup failure hidden in
  installer details/logs.

#### CD-03 — Fixed shared default credentials are installed and reused

- **Problem / root cause:** The installer assigns literal passwords to the
  default admin, cashier, and waiter accounts, then the seed upserts those
  passwords on every run. The deployment guide instead says generated
  passwords are shown once; the setup code does not generate or display these
  login passwords.
- **Affected files:** [`Install-BigBites.ps1`](../apps/desktop/src-tauri/windows/Install-BigBites.ps1#L776),
  [`seed.ts`](../apps/server/prisma/seed/seed.ts#L207),
  [`WINDOWS_CLIENT_DEPLOYMENT.md`](./WINDOWS_CLIENT_DEPLOYMENT.md#L14).
- **Exact fix:** Generate unique credentials for each initial installation or
  require the administrator to set them, deliver them through a one-time
  controlled setup screen/channel, and require password change on first login.
  Never reset user passwords during a routine installer rerun.
- **Risk if not fixed:** A known shared credential can grant admin access to
  the POS; staff credential changes can also be silently undone by setup.

#### CD-04 — Existing PostgreSQL handling contradicts the deployment guide

- **Problem / root cause:** The guide says setup stops when PostgreSQL is
  already installed, but the installer detects it and proceeds to configure
  local access, create or alter the application role, reuse the `bigbites`
  database if it exists, migrate it, and run the seed.
- **Affected files:** [`Install-BigBites.ps1`](../apps/desktop/src-tauri/windows/Install-BigBites.ps1#L424),
  [`Install-BigBites.ps1`](../apps/desktop/src-tauri/windows/Install-BigBites.ps1#L698),
  [`migration.sql`](../apps/server/prisma/migrations/20261003130000_remove_manager_role/migration.sql#L2),
  [`WINDOWS_CLIENT_DEPLOYMENT.md`](./WINDOWS_CLIENT_DEPLOYMENT.md#L106).
- **Exact fix:** Either fail closed before changing any existing PostgreSQL
  instance (matching the documented policy), or implement an explicit,
  administrator-approved database selection/backup/restore workflow that
  cannot reuse an unrelated `bigbites` database. Do not temporarily alter
  authentication or run migrations/seeds against an unconfirmed instance.
  For a confirmed upgrade, resolve `MANAGER` users with order history before
  applying the role-removal migration; it intentionally aborts otherwise.
- **Risk if not fixed:** Installing on a machine with PostgreSQL can modify
  that server or attach BIG BITES to existing data; combined with CD-01 this
  risks data corruption/reset.

#### CD-05 — Release bundle cannot be certified from the current tree

- **Problem / root cause:** Tauri is configured to build NSIS and bundle the
  installer scripts, server output, and Prisma migrations. An NSIS executable
  exists locally, but the installer scripts and three current migrations are
  untracked, so they will not be present in a clean checkout. The local
  executable's bundled resources and relationship to the current source have
  not been established.
- **Affected files:** [`tauri.conf.json`](../apps/desktop/src-tauri/tauri.conf.json#L29),
  [`tauri.conf.json`](../apps/desktop/src-tauri/tauri.conf.json#L31),
  [`windows/`](../apps/desktop/src-tauri/windows/),
  [`20261003130000_remove_manager_role/`](../apps/server/prisma/migrations/20261003130000_remove_manager_role/),
  [`20261006150000_payment_tender_details/`](../apps/server/prisma/migrations/20261006150000_payment_tender_details/),
  [`20261006220000_add_gst_toggle_and_order_reports/`](../apps/server/prisma/migrations/20261006220000_add_gst_toggle_and_order_reports/).
- **Exact fix:** Track all required installer scripts and migrations, build the
  configured NSIS installer from a clean checkout, inspect its bundled
  resources/migrations, and install that exact artifact on a clean Windows
  10/11 x64 machine before release.
- **Risk if not fixed:** A clean release build may fail to package the backend
  or omit required migrations. The local NSIS executable and checked-in APK
  do not prove that the current source and schema will be delivered together.

#### CD-11 — No kitchen workflow or status transition is implemented

- **Problem / root cause:** Order creation writes `CONFIRMED` and waiter
  handoff writes `READY_FOR_BILLING`. The schema contains kitchen-related
  statuses, but no API route or shipped desktop/waiter screen changes an order
  to `PREPARING`, `READY`, or `SERVED`, and no kitchen client is present.
- **Affected files:** [`orders.ts`](../apps/server/src/routes/orders.ts#L244),
  [`orders.ts`](../apps/server/src/routes/orders.ts#L619),
  [`App.tsx`](../apps/desktop/src/App.tsx#L2596),
  [`api_service.dart`](../apps/waiter_app/lib/services/api_service.dart#L316).
- **Exact fix:** Implement and test the kitchen handoff/status transitions and
  intended kitchen display or print surface using the existing workflow,
  without bypassing waiter confirmation or billing authorization.
- **Risk if not fixed:** Kitchen staff cannot receive/manage orders through
  this project; the requested order-to-kitchen-to-billing workflow cannot be
  completed as requested.

#### CD-12 — Admin can permanently delete paid order and payment history

- **Problem / root cause:** The admin delete route removes the payment and
  order even when the order is paid, refunded, or completed. The desktop UI
  confirms this irreversible action, but the database has no retained audit
  record and rebuilt paid-order reports will no longer include the deleted sale.
- **Affected files:** [`admin.ts`](../apps/server/src/routes/admin.ts#L470),
  [`admin.ts`](../apps/server/src/routes/admin.ts#L511),
  [`App.tsx`](../apps/desktop/src/App.tsx#L1634).
- **Exact fix:** Prevent hard deletion of paid/refunded/completed orders in
  production. Use an auditable void/refund or soft-delete record that retains
  the original order, tender, and reason.
- **Risk if not fixed:** A mistaken or malicious admin action can erase
  financial history and alter sales/report totals without a recoverable trail.

#### CD-13 — Standalone server bundle has an older Prisma schema and migrations

- **Problem / root cause:** `BIG-BITES-SERVER-CLIENT/dist` contains current
  settings code that reads `gstEnabled` and `orderReportsPath`, but its bundled
  Prisma schema/generated client omit those fields and its migrations omit
  `20261006220000_add_gst_toggle_and_order_reports`. Its startup launcher runs
  the compiled server directly and does not deploy migrations. The standalone
  environment/startup configuration also does not explicitly provide
  `AUTH_SECRET` or `NODE_ENV`: production startup fails without the secret,
  while a non-production start falls back to a process-local secret that
  changes on restart.
- **Affected files:** [`schema.prisma`](../BIG-BITES-SERVER-CLIENT/prisma/schema.prisma#L117),
  [`admin.js`](../BIG-BITES-SERVER-CLIENT/dist/routes/admin.js#L49),
  [`Start-BigBitesServer.ps1`](../BIG-BITES-SERVER-CLIENT/Start-BigBitesServer.ps1#L1),
  [`migration.sql`](../apps/server/prisma/migrations/20261006220000_add_gst_toggle_and_order_reports/migration.sql#L1),
  `BIG-BITES-SERVER-CLIENT/.env`,
  [`auth.ts`](../apps/server/src/middleware/auth.ts#L13).
- **Exact fix:** Do not deploy this standalone bundle as-is. Regenerate its
  compiled server and Prisma client from the current source, copy the complete
  migration chain and schema, then apply migrations through an approved
  backup-and-upgrade procedure and verify settings and billing against the
  upgraded database.
- **Risk if not fixed:** Settings and billing operations can fail against a
  database without the new columns; the standalone launcher does not repair
  that schema mismatch.

#### CD-17 — No production backup and restore process is provisioned

- **Problem / root cause:** The installer runs database migrations and the
  seed without first creating a database backup. The installer and startup
  task do not provision recurring backups or test restoration; manual dump
  files in the worktree do not establish a client-side recovery process.
- **Affected files:** [`Install-BigBites.ps1`](../apps/desktop/src-tauri/windows/Install-BigBites.ps1#L731),
  [`Install-BigBites.ps1`](../apps/desktop/src-tauri/windows/Install-BigBites.ps1#L771),
  [`WINDOWS_CLIENT_DEPLOYMENT.md`](./WINDOWS_CLIENT_DEPLOYMENT.md#L111).
- **Exact fix:** Define and verify a client backup schedule, encrypted off-PC
  retention, pre-upgrade backup, and documented restore drill before storing
  live orders or payments.
- **Risk if not fixed:** Disk failure, accidental data modification, or a
  failed migration can permanently remove restaurant order and payment history.

#### CD-18 — Local environment and database backup files are present in the worktree

- **Problem / root cause:** An ignored `.env` exists inside the standalone
  server bundle and includes a `DATABASE_URL` setting; separate untracked
  database dump files are also present. Their values and contents were not
  inspected. Git ignore rules do not prevent these files from being included
  when someone copies or archives the entire worktree.
- **Affected files:** `BIG-BITES-SERVER-CLIENT/.env`,
  [`.gitignore`](../.gitignore#L7), and `database-backups/`.
- **Exact fix:** Use an explicit release allowlist; do not ship local `.env`,
  logs, or backup dumps. Generate client-specific credentials during
  installation, and securely retain backups outside the delivery package.
  Rotate any credential if the local environment file has already been shared.
- **Risk if not fixed:** A copied release archive could disclose database
  credentials or restaurant data to unintended recipients.

### MEDIUM

#### CD-06 — Server process is not supervised after it starts

- **Problem / root cause:** The scheduled task launches a PowerShell script;
  that script starts `node.exe` as a child process and exits successfully.
  The task's restart settings therefore supervise the launcher, not the
  long-running Node server. A later server crash is not reliably restarted.
- **Affected files:** [`Start-BigBitesServer.ps1`](../apps/desktop/src-tauri/windows/Start-BigBitesServer.ps1#L33),
  [`Start-BigBitesServer.ps1`](../apps/desktop/src-tauri/windows/Start-BigBitesServer.ps1#L46),
  [`Install-BigBites.ps1`](../apps/desktop/src-tauri/windows/Install-BigBites.ps1#L920).
- **Exact fix:** Run the API under a Windows service manager with restart-on-
  failure, or keep a supervised task alive for the server lifetime and verify
  process/health recovery after termination.
- **Risk if not fixed:** After a backend crash or reboot race, the desktop and
  waiter app can lose the service until an operator manually restarts it.

#### CD-07 — Reports need first-run folder configuration and service-account access

- **Problem / root cause:** `orderReportsPath` defaults to an empty string.
  Excel export requires a configured writable directory; the server runs as
  `SYSTEM`, so a folder selected in the desktop UI must also be writable by
  that account. Payment succeeds if export fails, but returns an export error.
- **Affected files:** [`schema.prisma`](../apps/server/prisma/schema.prisma#L122),
  [`orderReports.ts`](../apps/server/src/utils/orderReports.ts#L63),
  [`billing.ts`](../apps/server/src/routes/billing.ts#L652),
  [`App.tsx`](../apps/desktop/src/App.tsx#L1367).
- **Exact fix:** Add this to the go-live checklist or first-run setup: save a
  reports directory that exists and is writable by the server service identity,
  then perform a test export and verify the workbook on disk.
- **Risk if not fixed:** Billing/payment remains available, but Excel
  order-history reports fail after payment until the path and permissions are
  corrected.

#### CD-08 — Desktop and waiter API calls have no request timeout

- **Problem / root cause:** Waiter discovery and `/health` have timeouts, but
  waiter login, table/product loads, order mutations, and desktop API requests
  have no request timeout. Error handlers cannot recover while a request remains
  pending indefinitely.
- **Affected files:** [`api_service.dart`](../apps/waiter_app/lib/services/api_service.dart#L114),
  [`App.tsx`](../apps/desktop/src/App.tsx#L209).
- **Exact fix:** Apply a consistent bounded timeout to every API request and
  show a retryable network-timeout message without discarding the current
  selection/cart.
- **Risk if not fixed:** Backend outages and interrupted LAN connections can
  leave login, billing, or order actions spinning with no clear recovery.

#### CD-09 — Waiter traffic uses cleartext HTTP and bearer tokens have no expiry

- **Problem / root cause:** The waiter app discovers an `http://` endpoint and
  enables Android cleartext traffic. The signed token payload has no expiry
  claim or expiry check; role/account changes do not invalidate already-issued
  tokens on most protected routes.
- **Affected files:** [`api_service.dart`](../apps/waiter_app/lib/services/api_service.dart#L70),
  [`AndroidManifest.xml`](../apps/waiter_app/android/app/src/main/AndroidManifest.xml#L7),
  [`auth.ts`](../apps/server/src/middleware/auth.ts#L25),
  [`auth.ts`](../apps/server/src/middleware/auth.ts#L45).
- **Exact fix:** Use authenticated TLS for the LAN API and issue tokens with a
  finite lifetime that the server validates; also invalidate tokens when
  credentials/roles are changed or an account is deleted. If the deployment
  intentionally relies on a physically isolated trusted LAN instead, document
  and obtain client acceptance of that limitation before delivery.
- **Risk if not fixed:** Credentials and bearer tokens can be observed on an
  untrusted/shared Wi-Fi network; captured tokens remain usable until the
  signing secret changes, and former privileged users may retain access.

#### CD-14 — Waiter app accepts cashier credentials it cannot use

- **Problem / root cause:** The waiter login screen navigates to the tables
  screen for any successful login and does not check the returned role.
  Order lookup and creation allow only `WAITER` or `ADMIN`, so a cashier can
  log in successfully but cannot perform the waiter workflow.
- **Affected files:** [`main.dart`](../apps/waiter_app/lib/main.dart#L82),
  [`orders.ts`](../apps/server/src/routes/orders.ts#L40).
- **Exact fix:** Validate the returned role before navigating; allow only the
  roles the waiter app supports and display a clear role-specific error.
- **Risk if not fixed:** Staff can mistake successful authentication for a
  working waiter session, then be blocked on table/order actions.

#### CD-15 — Waiter discovery rejects non-default configured API ports

- **Problem / root cause:** The server advertises its configurable `PORT`,
  while the waiter client accepts discovery replies only when the port is
  exactly 3000. The current installer uses 3000, but any supported port
  override makes discovery time out or reject the server.
- **Affected files:** [`server.ts`](../apps/server/src/server.ts#L19),
  [`api_service.dart`](../apps/waiter_app/lib/services/api_service.dart#L48).
- **Exact fix:** Accept and validate the advertised port, or make the port a
  single shared deployment setting and reject unsupported overrides during
  setup.
- **Risk if not fixed:** A correctly running server on a non-default port is
  unreachable from the waiter app.

#### CD-16 — Login has no brute-force throttling

- **Problem / root cause:** `POST /api/auth/login` verifies credentials but
  applies no attempt throttling or temporary lockout. The API listens on all
  interfaces and the installer allows connections from the local subnet.
- **Affected files:** [`auth.ts`](../apps/server/src/routes/auth.ts#L13),
  [`server.ts`](../apps/server/src/server.ts#L20).
- **Exact fix:** Add bounded per-IP and per-account login throttling, with
  operationally visible logs and a recovery path that does not lock out the
  whole restaurant.
- **Risk if not fixed:** A device on the restaurant LAN can make unlimited
  password guesses against staff accounts.

### LOW

#### CD-10 — No explicit secondary indexes for common order lookups

- **Problem / root cause:** The Prisma models define primary/unique keys and
  foreign keys, but no explicit secondary indexes for frequent filtering and
  ordering by order status, table, or creation time.
- **Affected file:** [`schema.prisma`](../apps/server/prisma/schema.prisma#L96).
- **Exact fix:** Measure query plans with representative production data. Add
  indexes only for demonstrated slow filters/orderings (for example status,
  table plus status, and creation time) in a reviewed migration.
- **Risk if not fixed:** This is not a fresh-install blocker for a small
  restaurant, but billing/order/report queries may slow as history grows.

## API contract mismatch report

**Result: no payload/path mismatch found in the client-used endpoints inspected.**
The `Authorization` headers carry bearer tokens. The waiter API correctly omits
`waiterId`: the server derives the order owner from the authenticated user, which
prevents clients from choosing another waiter identity.

| Client flow | Client request | Backend contract | Result |
|---|---|---|---|
| Login | `POST /api/auth/login` with `username`, `password` | Validates both strings and returns `token`/`user` | Aligned |
| Tables / products | `GET /api/tables`, `GET /api/products` | Returns table/product lists; these read endpoints are public | Aligned |
| Find active order | `GET /api/orders/table/:tableId/active` with bearer token | Waiter/admin role and table ID in path | Aligned |
| Create order | `POST /api/orders` with `tableId` and non-empty `items: [{ productId, quantity }]` | Validates table and each item; sets `waiterId` from authenticated user | Aligned |
| Add items | `PATCH /api/orders/:id/add-items` with `items` | Validates order ID and non-empty item list | Aligned |
| Send to cashier | `PATCH /api/orders/:id/send-to-cashier`, no body | Uses authenticated waiter/admin and order ID in path | Aligned |
| Desktop billing | Discount uses `discountType`/`discountValue`; payment uses `method` and optional cash `amountReceived` | Billing routes validate the same fields and payment methods | Aligned |
| Desktop settings/reports | Settings sends GST/address/identifier fields and `orderReportsPath`; reports use GET/POST export routes | Admin routes validate settings fields and expose the corresponding reports routes | Aligned |
| Desktop admin CRUD | User, product, table, order, and payment paths/fields | Matching `/api/admin/*` routes exist; admin router enforces ADMIN role | Aligned |

The Flutter app does not call billing, settings, or reports endpoints; those are
desktop/admin workflows, not missing mobile payloads. This is a source-level
contract comparison, not a live end-to-end test against a client server.

One configuration caveat is not a payload mismatch: the server's `PORT` is
configurable, while the waiter discovery client accepts only port 3000. The
installer currently sets port 3000, but a non-default port override will make
discovery reject the server response.

### Backend endpoint inventory

This inventory distinguishes client-used flows from available routes with no
direct waiter-app call. Admin routes are protected by the admin router.

| Route group | Available server endpoints | Client coverage |
|---|---|---|
| Auth | `POST /api/auth/login` | Desktop and waiter login |
| Tables | `GET /api/tables`, `GET /api/tables/:id`; admin `GET/POST/PATCH /api/admin/tables` | Waiter uses list; desktop admin reads list and creates a table. ID lookup and admin status patch have no direct client call identified. |
| Products | `GET /api/products`, `GET /api/products/:id`; admin `GET/POST/PATCH/DELETE /api/admin/products` | Waiter uses list; desktop admin uses list/create/update/delete. Public ID lookup has no direct client call identified. |
| Orders | `POST /api/orders`; `GET /api/orders`, `GET /api/orders/:id`, `GET /api/orders/table/:tableId`, `GET /api/orders/table/:tableId/active`, `PATCH /api/orders/:id/add-items`, `PATCH /api/orders/:id/send-to-cashier` | Waiter uses create, active lookup, add items, send to cashier. Admin order management uses `/api/admin/orders`; the other order reads have no direct client call identified. |
| Billing | `GET /api/billing/orders`, `GET /api/billing/completed`, `GET /api/billing/orders/:id`, `PATCH /api/billing/orders/:id/discount`, `POST /api/billing/orders/:id/pay`, `GET /api/billing/tables/:tableId`, `POST /api/billing/tables/:tableId/pay` | Desktop uses order list/completed/detail/discount/pay. Combined-table bill/pay routes have no direct client call identified. |
| Admin | `GET /api/admin/dashboard`; `GET/POST/PATCH/DELETE /api/admin/users`; `GET/POST/PATCH /api/admin/categories`; `GET/POST/PATCH/DELETE /api/admin/products`; `GET/POST/PATCH /api/admin/tables`; `GET/DELETE /api/admin/orders`; `GET /api/admin/payments`; `GET /api/admin/settings`, `PATCH /api/admin/settings`; `GET /api/admin/order-reports`, `POST /api/admin/order-reports/export` | Desktop calls the dashboard, user/product/table/order/payment views, settings, and report flows. Category/table endpoints not called directly are not Flutter contract mismatches. |

## Restaurant workflow trace

| Stage | Observed behavior | Production result |
|---|---|---|
| Login | `POST /api/auth/login` validates username/password and returns a signed bearer token. | Invalid credentials return 401. The waiter app does not reject a successful cashier login, and tokens have no expiry. |
| Tables | The waiter app loads `GET /api/tables`; opening a table looks up its active order. | Table listing is public; order lookup requires WAITER or ADMIN. Network requests can wait indefinitely after discovery. |
| New order / add items | `POST /api/orders` validates product IDs/quantities and stock in a transaction, decrements stock, creates a `CONFIRMED` order, and marks the table occupied. Additional items are accepted only while status is `CONFIRMED`. | Payloads match the server contract. The transaction guards stock/table state. |
| Kitchen | No shipped kitchen screen/client or API transition to `PREPARING`, `READY`, or `SERVED` exists. | **Blocked.** The order can skip directly from `CONFIRMED` to waiter handoff; no kitchen processing gate exists. See CD-11. |
| Ready for billing | Waiter calls `PATCH /api/orders/:id/send-to-cashier`, which sets `READY_FOR_BILLING`. | The cashier can then see it in `GET /api/billing/orders`. There is no kitchen status prerequisite. |
| Billing / payment | Desktop loads bill details, optionally saves a discount, then posts the tender. Payment/order/table updates are transactional. A monthly report export is attempted after payment. | Amount/tender payloads align. If report export fails, the payment has already committed; a report error is returned. Configure and test the report folder before go-live. |
| Print receipt | Desktop renders a receipt and invokes `window.print()`. | Source path exists; actual printer selection, paper width, and physical print output were not tested on a client device. |
| Close table | Successful payment sets the order `COMPLETED`; the table becomes `AVAILABLE` if no other active order remains. | Implemented for the single-order flow; live database/network execution was not tested. |

## Failure-test results and limits

These are source-path checks, not simulated production outages:

| Scenario | Observed handling |
|---|---|
| Invalid login | Server returns 401; both clients surface the login failure. |
| Backend unavailable | Waiter discovery times out and offers retry; desktop health check reports unavailable. Subsequent waiter/desktop API requests have no timeout (CD-08). |
| PostgreSQL unavailable | `/health` returns 500; waiter health validation reports the database unavailable. A live PostgreSQL shutdown/recovery test was not performed. |
| Expired/revoked token | Tokens have no expiry and no general revocation check; this scenario cannot be exercised as an expiration case (CD-09). |
| Empty database | Tables/products remain empty and no account can log in until the seed is run. The installer does seed, but also runs it on retries/upgrades (CD-01). |
| Missing configuration | Production startup fails if `AUTH_SECRET` is absent. The installer writes it; a live missing-config start was not run. |
| Network disconnected / reboot | No live device/reboot test was performed. Waiter discovery has a timeout, but established-session API calls do not; server supervision after child-process exit is not reliable (CD-06/CD-08). |

## Database and startup audit

- Prisma models define required foreign keys for order table/waiter and order
  item order/product. Order items cascade on order deletion; payment is one per
  order. Product/category and table/order references remain constrained.
- Defaults exist for table/order/payment state, stock, totals, GST settings,
  and restaurant settings. Nullable payment method/tender and discount fields
  are intentional for unpaid/no-discount states; the inspected billing UI
  handles nullable payment tender/tender amounts.
- Migration SQL is present in the working tree and the Windows installer runs
  `prisma migrate deploy`. The live client database's migration status and
  actual table existence were not queried.
- `DATABASE_URL` is required by the Prisma adapter; production startup also
  requires `AUTH_SECRET`. The installer writes both. The health endpoint
  checks the database and the installer checks health and test logins before
  creating the shortcut.
- The configured new-machine path requires an elevated Windows 10/11 x64
  install, internet access, and `winget`; it installs Node/PostgreSQL, writes
  a local environment file, migrates/seeds, opens local-subnet TCP/UDP
  firewall rules, and registers a startup task. Waiter discovery requires the
  phone and POS PC to share a LAN that allows UDP broadcast and the API ports.
- The installer does not make a database backup before running migrations or
  the seed. Existing local backup dumps are not a verified scheduled backup
  and restore process.
- Server startup has no graceful shutdown/drain handler; the installer stops
  an existing Node process forcibly. Add controlled shutdown and verify
  in-flight request behavior before using upgrades on a live restaurant.

## Error handling and screen checks

- Desktop login checks `/health`, displays server/login errors, and React has
  an error boundary. Billing, admin settings, exports, and waiter-console
  requests have UI error states/catches.
- Waiter login, discovery, table loading, product loading, order submission,
  and cashier handoff catch failures and display errors. The identified
  network issue is the lack of timeouts, not a missing payload or unchecked
  null field in those request bodies. No live offline/database-failure,
  expired-token, reboot, or Android-on-client-LAN simulation was performed.
- Desktop uses local loopback API configuration for the packaged POS;
  `VITE_API_URL` is present in the local desktop environment and classified as
  loopback without exposing its value. The waiter app uses a build-time
  override only when configured; otherwise it discovers the server. No
  restaurant-specific IP is hard-coded in the waiter source.
- The referenced desktop logo, Tauri icons, and waiter logo asset declaration
  are present. No broken import or route was found by the desktop build.

## Security observations

| Area | Evidence and result |
|---|---|
| Password storage | New passwords use salted `scrypt` hashes; successful login upgrades legacy plaintext values. |
| Signing secret | The installer generates an `AUTH_SECRET` and restricts the server directory to SYSTEM/Administrators. Production server startup rejects a missing secret. The standalone bundle is not configured equivalently (CD-13). |
| Token lifetime/revocation | HMAC signatures are checked, but tokens do not expire and most protected routes trust their embedded role without checking whether the user still exists or retains that role (CD-09). |
| LAN exposure | The server binds to `0.0.0.0`; the installer opens TCP 3000 and UDP 3001 to the local subnet. CORS uses its default unrestricted origin policy. Mobile API traffic is cleartext HTTP (CD-09). |
| Guessing protection | Login has no rate limit or temporary lockout (CD-16). |
| Delivery files | An ignored local environment file and untracked database dumps are present in the worktree; contents were not inspected and must be excluded from any release archive (CD-18). |

## Go-live blockers

Do not mark this build safe for client delivery until all of the following are
closed:

1. Make seed/bootstrap non-destructive on upgrades and retries.
2. Replace fixed credentials with per-install secure setup and first-login
   credential change; correct the deployment guide.
3. Make backend setup failure abort the installer instead of continuing to
   launch the desktop.
4. Reconcile PostgreSQL existing-instance behavior with the documented policy;
   protect existing databases with an explicit isolation/backup plan.
5. Track all required installer scripts/migrations and produce the configured
   NSIS installer from a clean checkout.
6. Run and record a clean Windows install test, reboot/recovery test, database
   migration check, desktop billing/receipt/admin-report smoke test, and
   Android waiter discovery/order-to-cashier test on the intended client LAN.

Until then: ❌ **Not ready for client delivery.**
