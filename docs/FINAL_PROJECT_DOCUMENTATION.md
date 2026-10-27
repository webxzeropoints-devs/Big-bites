# HOTEL POS – BILLING AND ADMINISTRATION SYSTEM

## 1. Project Overview

Hotel POS is an installable restaurant billing system. The Flutter Android app is used by waiters to create orders. The React/Tauri desktop app is used for billing and administration. Express and Prisma provide the REST API and PostgreSQL stores the data.

The final order flow is:

`Waiter login -> table -> menu -> order -> billing -> payment -> completed -> table available`

The waiter table list includes a database-backed **Parcel** option. Orders created from that option are labeled Parcel in billing and administration, and follow the same payment flow as table orders.

There is no Kitchen application in the final system.

## 2. Users

- **Admin:** protected access to dashboard, products, tables, orders, payments, categories, and users APIs.
- **Cashier:** uses the authenticated desktop billing screen.
- **Waiter:** uses the Flutter application to create orders.

Admins can create staff users with the Admin, Cashier, or Waiter role from User management.

## 3. Technology Stack

| Technology | Purpose |
|---|---|
| Flutter/Dart | Android waiter application |
| React/TypeScript/Vite | Desktop user interface |
| Tauri | Installable desktop wrapper |
| Node.js/Express/TypeScript | Backend REST API |
| Prisma | Type-safe database access |
| PostgreSQL | Persistent application database |

## 4. Folder Structure

- `apps/server`: Express API, Prisma schema and migrations
- `apps/waiter_app`: Flutter Android waiter application
- `apps/desktop`: React/Tauri billing and admin application
- `docs`: project documentation

## 5. Waiter Application

The waiter logs in, selects an available table or the Parcel option, loads products from `GET /api/products`, selects quantities within the displayed on-hand stock, sees the total, and submits `POST /api/orders`. The backend validates available stock and deducts it in the order transaction. Stock is product-level and shared across variants. Cancellation restores stock and records a movement.

The Android emulator connects to the computer backend through `http://10.0.2.2:3000`.

## 6. Billing

The desktop Billing screen loads unpaid orders from `GET /api/billing/orders`. It displays order number, table or Parcel label, items, quantities, unit prices, subtotals, GST, and grand total. The configured restaurant address is shown on the bill and printed receipt. Cashier selects `CASH`, `UPI`, or `CARD` and calls `POST /api/billing/orders/:id/pay`.

Payment is recorded as `PAID`, the order becomes `COMPLETED`, and the table becomes `AVAILABLE`.

## 7. Administration

The desktop Admin Panel uses the protected `/api/admin` routes and displays live PostgreSQL data:

- Dashboard metrics
- Products, variants, stock counts, adjustments, and movement history
- Tables and statuses
- Order history
- Payment records
- GST rate and restaurant address settings for billing and printed receipts

The current desktop UI allows adding a table, viewing categories, editing product stock metadata, adjusting on-hand quantities, and reading movement history. The backend also provides protected CRUD endpoints for categories, products, and users.

## 8. Database Design

The Prisma schema contains `User`, `RestaurantTable`, `Category`, `Product`, `ProductStockMovement`, `ProductVariant`, `Order`, `OrderItem`, `Payment`, and `RestaurantSettings`.

- A user can create many orders.
- A table or Parcel option can have many orders.
- An order contains many order items.
- An order has at most one payment.
- A product belongs to a category and can appear in many order items.
- Product stock is shared across its variants; stock changes are recorded in `ProductStockMovement`.

No database reset or migration was run as part of this source audit. The configured loopback development database inspected separately has no stock columns or movement table; it is not verified as a customer or production target. Existing historical order statuses remain in the source enum. The `20261003130000_remove_manager_role` migration deletes `MANAGER` user rows; do not assume it converts them to another role or apply it without target-specific owner/DBA review.

## 9. API Endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/` | Server status |
| GET | `/health` | Database health check |
| POST | `/api/auth/login` | Login and bearer token |
| GET | `/api/products` | Active products |
| GET | `/api/tables` | Tables and the Parcel option |
| POST | `/api/orders` | Create waiter order |
| GET | `/api/orders` | Order list |
| GET | `/api/orders/:id` | Order details |
| GET | `/api/billing/orders` | Unpaid orders |
| GET | `/api/billing/orders/:id` | Bill details |
| POST | `/api/billing/orders/:id/pay` | Record payment |
| GET | `/api/admin/dashboard` | Admin metrics |
| GET/POST | `/api/admin/tables` | View/add tables |
| GET/PATCH | `/api/admin/products` | View/update products |
| PATCH | `/api/admin/products/:id/stock` | Record an on-hand stock adjustment |
| GET | `/api/admin/products/:id/stock-movements` | Read stock movement history |
| GET/POST/PATCH | `/api/admin/categories` | Category management |
| GET/POST/PATCH | `/api/admin/users` | Safe user management |
| GET | `/api/admin/orders` | Complete order history |
| GET | `/api/admin/payments` | Payment history |

Admin routes require a bearer token for an `ADMIN` user.

## 10. Authentication and Security

Login returns a signed bearer token and a safe user object. Passwords are stored as scrypt hashes; existing plaintext passwords are upgraded after a successful login. Password fields are not returned by authentication, billing, orders, or admin responses. Order creation requires an authenticated WAITER token matching the waiter ID, billing requires ADMIN or CASHIER, and admin routes enforce ADMIN roles. Configure `AUTH_SECRET` in the production environment; the server fails at startup if it is missing. Database seeding requires `SEED_ADMIN_PASSWORD`, `SEED_CASHIER_PASSWORD`, and `SEED_WAITER_PASSWORD`; provide them through environment configuration and never commit them.

## 11. Demonstration Scenario

1. Login to the waiter app using the seeded waiter account.
2. Select Table 1 or Parcel.
3. Add Chicken Biryani x4 and Chicken Rice x4.
4. Confirm the order.
5. Verify the order stays within displayed stock and Table 1 becomes occupied.
6. Open Billing on the desktop app.
7. Select the order and confirm the ₹1280 total.
8. Select CASH and pay.
9. Verify `PAID`, `COMPLETED`, and Table 1 `AVAILABLE`.
10. Open Admin and verify the order, payment, and table data.

## 12. Installation and Testing

Backend:

```powershell
cd C:\Users\vjsan\hotel-pos\apps\server
npm install
npm run dev
```

Production requires `AUTH_SECRET`. When creating seeded staff accounts, configure
`SEED_ADMIN_PASSWORD`, `SEED_CASHIER_PASSWORD`, and `SEED_WAITER_PASSWORD`
without placing their values in source control.

Production startup via `npm start` runs `prisma migrate deploy` before starting
the server, so pending schema migrations are applied before API routes serve
requests.

Desktop:

```powershell
cd C:\Users\vjsan\hotel-pos\apps\desktop
npm install
npm run tauri dev
```

Waiter:

```powershell
cd C:\Users\vjsan\hotel-pos\apps\waiter_app
flutter pub get
flutter run
```

Validation commands completed:

```text
server: npx tsc --noEmit
server: npm test
server: npx prisma validate
desktop: npm run build
waiter: flutter analyze
waiter: flutter test
```

Do not run `npx prisma migrate deploy` directly. Direct Prisma CLI migration
commands bypass the application's migration safety preflight. The checked-in
`20261020100000_remove_product_stock` migration drops product stock columns and
the `ProductStockMovement` table; its status on any target database is unknown.
Do not apply migrations until an authorized database owner/DBA provides
target-specific migration-history and schema evidence and approves a
history-preserving migration plan.

Flutter tests cover currency parsing/formatting and invalid precision. The server `npm test` command runs the backend TypeScript check; `npm run test:financial` builds the server and runs mocked route, migration-safety, and financial tests. These mocks do not establish PostgreSQL transaction/concurrency behavior or customer database compatibility.

Migration status is not established for any target by this document. Any
read-only status check requires explicit authorization and confirmed target
identity. Production startup's guarded `npm start` preflight blocks the known
destructive and unreviewed migration set; it does not establish target
compatibility or authorize migrations.

## 13. Limitations and Future Enhancements

The current system does not include a real payment gateway or receipt printer integration. Future work can add backend integration tests, audit logging, reports, and richer product/category editing screens.

## 14. Current Project Status

- Backend: **WORKING**
- Waiter App: **WORKING**
- Billing: **WORKING**
- Admin: **WORKING** — dashboard metrics, products, categories, tables, orders, payments, and add-table UI are available; category/user/product editing remains available through protected APIs.
- Database: **NOT RELEASE-VERIFIED** — the inspected loopback development database lacks inventory columns and the stock-movement table, and its migration history does not match the repository. No customer or production database was changed.
- Product stock tracking: **RESTORED IN SOURCE** — order limits, stock adjustments, movement history, cancellation restoration, and client stock displays are covered by mocked/source tests; target schema and stored inventory remain unverified.
- Table Management: **WORKING**
- Payment: **WORKING**
- Security: **PARTIALLY WORKING** — password fields are not exposed and role checks exist, but existing passwords are not hashed.
- Validation: **SOURCE CHECKS PASSING; RELEASE BLOCKED** — backend type-check and mocked suites, desktop frontend build, Flutter analysis, and Flutter tests pass. Installer/APK packaging and target database compatibility are not verified customer deliverables.

## 15. Presentation Summary

This project is a Hotel POS system. A waiter uses the Flutter Android app to log in, select a table, choose food within the product-level stock limit, and submit an order. The backend validates the order, deducts stock, calculates the amount, and marks the table occupied. The cashier uses the Tauri desktop Billing screen to select the order and record cash, UPI, or card payment. After payment, the order is completed and the table becomes available. The Admin Panel includes stock adjustment and movement history alongside dashboard metrics, tables, products, order history, and payments. The source-level inventory workflow is restored, but customer database compatibility and stored inventory are not verified; release remains blocked pending target-specific migration and backup evidence.
