# HOTEL POS – BILLING AND ADMINISTRATION SYSTEM

## 1. Project Overview

Hotel POS is an installable restaurant billing system. The Flutter Android app is used by waiters to create orders. The React/Tauri desktop app is used for billing and administration. Express and Prisma provide the REST API and PostgreSQL stores the data.

The final order flow is:

`Waiter login -> table -> menu -> order -> billing -> payment -> completed -> table available`

The waiter table list includes a database-backed **Parcel** option. Orders created from that option are labeled Parcel in billing and administration, and follow the same payment and inventory flow as table orders.

There is no Kitchen application in the final system.

## 2. Users

- **Admin/Manager:** protected access to dashboard, products, tables, orders, payments, categories, and users APIs.
- **Cashier:** uses the authenticated desktop billing screen.
- **Waiter:** uses the Flutter application to create orders.

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

The waiter logs in, selects an available table or the Parcel option, loads products from `GET /api/products`, selects quantities, sees the total, and submits `POST /api/orders`. The backend validates the table, waiter, product status, and stock. It creates the order, decreases inventory, and marks the selected table/Parcel option `OCCUPIED`.

The Android emulator connects to the computer backend through `http://10.0.2.2:3000`.

## 6. Billing

The desktop Billing screen loads unpaid orders from `GET /api/billing/orders`. It displays order number, table or Parcel label, items, quantities, unit prices, subtotals, and grand total. Cashier selects `CASH`, `UPI`, or `CARD` and calls `POST /api/billing/orders/:id/pay`.

Payment is recorded as `PAID`, the order becomes `COMPLETED`, and the table becomes `AVAILABLE`.

## 7. Administration

The desktop Admin Panel uses the protected `/api/admin` routes and displays live PostgreSQL data:

- Dashboard metrics
- Products and stock
- Tables and statuses
- Order history
- Payment records

The current desktop UI allows adding a table, viewing categories, and viewing live product/inventory data through the backend. The backend also provides protected CRUD endpoints for categories, products, and users.

## 8. Database Design

The Prisma schema contains `User`, `RestaurantTable`, `Category`, `Product`, `Order`, `OrderItem`, and `Payment`.

- A user can create many orders.
- A table or Parcel option can have many orders.
- An order contains many order items.
- An order has at most one payment.
- A product belongs to a category and can appear in many order items.

The existing schema and data were preserved. No database reset or destructive migration was used. Existing historical order statuses remain in the enum for compatibility, but the application no longer requires a Kitchen stage. During the role migration, any legacy `KITCHEN` user is safely converted to `WAITER` so historical orders and account records remain intact.

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
| GET/POST/PATCH | `/api/admin/categories` | Category management |
| GET/PATCH | `/api/admin/users` | Safe user management |
| GET | `/api/admin/orders` | Complete order history |
| GET | `/api/admin/payments` | Payment history |

Admin routes require a bearer token for an `ADMIN` or `MANAGER` user.

## 10. Authentication and Security

Login returns a signed bearer token and a safe user object. Password fields are not returned by authentication, billing, orders, or admin responses. Order creation requires an authenticated WAITER token matching the waiter ID, billing requires ADMIN, MANAGER, or CASHIER, and admin routes enforce ADMIN or MANAGER roles. The current project uses plain stored passwords from the existing schema; password hashing should be added before production deployment.

## 11. Demonstration Scenario

1. Login to the waiter app using the seeded waiter account.
2. Select Table 1 or Parcel.
3. Add Chicken Biryani x4 and Chicken Rice x4.
4. Confirm the order.
5. Verify stock decreases and Table 1 becomes occupied.
6. Open Billing on the desktop app.
7. Select the order and confirm the ₹1280 total.
8. Select CASH and pay.
9. Verify `PAID`, `COMPLETED`, and Table 1 `AVAILABLE`.
10. Open Admin and verify the order, payment, stock, and table data.

## 12. Installation and Testing

Backend:

```powershell
cd C:\Users\vjsan\hotel-pos\apps\server
npm install
npx prisma migrate deploy
npm run dev
```

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
server: npx prisma migrate deploy
desktop: npm run build
waiter: flutter analyze
waiter: flutter test
```

The Flutter widget test verifies that the waiter login screen renders its title, login heading, and login button. The server `npm test` command runs the backend TypeScript check. The project currently has no separate backend or desktop unit-test suite; backend and desktop correctness is verified by TypeScript compilation and the production desktop build.

The database migration status is currently clean: all three migrations, including the legacy Kitchen-role cleanup and Parcel table migration, are applied and the database schema is up to date.

## 13. Limitations and Future Enhancements

The current system does not include a real payment gateway, receipt printer integration, or password hashing. Future work can add those features, backend integration tests, audit logging, reports, and richer product/category editing screens.

## 14. Current Project Status

- Backend: **WORKING**
- Waiter App: **WORKING**
- Billing: **WORKING**
- Admin: **WORKING** — dashboard metrics, products, inventory, categories, tables, orders, payments, and add-table UI are available; category/user/product editing remains available through protected APIs.
- Database: **WORKING**
- Inventory: **WORKING**
- Table Management: **WORKING**
- Payment: **WORKING**
- Security: **PARTIALLY WORKING** — password fields are not exposed and role checks exist, but existing passwords are not hashed.
- Validation: **PASSING** — backend type-check, Prisma validation, desktop production build, Flutter analysis, and Flutter widget tests pass.

## 15. Presentation Summary

This project is a Hotel POS system. A waiter uses the Flutter Android app to log in, select a table, choose food, and submit an order. The backend validates the order, calculates the amount, decreases stock, and marks the table occupied. The cashier uses the Tauri desktop Billing screen to select the order and record cash, UPI, or card payment. After payment, the order is completed and the table becomes available. The Admin Panel reads real PostgreSQL data and shows dashboard metrics, tables, products, inventory, order history, and payments. Express provides the REST API and Prisma connects the TypeScript backend to PostgreSQL.
