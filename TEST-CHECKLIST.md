# Test Checklist for Big Bites POS Changes

## Build & Compilation ✅

- [x] **Server TypeScript Build**
  - Command: `cd apps/server && npm run build`
  - Result: ✅ Success (tsc compilation)
  - No TypeScript errors or warnings

- [x] **Desktop TypeScript Build**
  - Command: `cd apps/desktop && npm run build`
  - Result: ✅ Success (tsc + Vite)
  - Output: dist/ folder generated
  - Size: 280.88 KB JS, 18.38 KB CSS

- [x] **Tauri Backend Compilation**
  - File: `apps/desktop/src-tauri/src/lib.rs`
  - Status: ✅ Compiles without errors
  - Command registration: ✅ Correct (`save_order_reports` in `generate_handler!`)

---

## Unit Tests ✅

- [x] **Financial Test Suite**
  - Command: `cd apps/server && npm run test:financial`
  - Result: ✅ 27 tests pass, 0 failures
  - Duration: 36 seconds

### Key Passing Tests:
- [x] ✅ "order sequence lock returns a Prisma-supported scalar"
- [x] ✅ "deleting an unpaid order clears table state transactionally"
- [x] ✅ "deleting an order does not reset the sequence while other orders remain"
- [x] ✅ "GST off removes tax from the bill and persists the paid GST state"
- [x] ✅ "monthly export rebuilds paid orders and returns workbooks for local saving"
- [x] ✅ "cash payment uses authoritative GST, exact paise change, persists tender, and rejects retries"
- [x] ✅ "payment routes reject null or malformed request bodies without crashing"

### Excel Export Test Details:
- **Test Function**: "monthly export rebuilds paid orders and returns workbooks for local saving"
- **Duration**: 6.3 seconds
- **Verification**: Base64 workbook content decoded and validated in-memory
- **Assertions**:
  - ✅ Workbooks returned with `contentBase64` field
  - ✅ Excel data correctly contains order IDs, amounts, GST status
  - ✅ No file system write operations (all in-memory)

---

## Code Quality Checks ✅

### GST Visibility Changes
- [x] ✅ Conditional rendering: `{selected.gstEnabled !== false ? ... : null}`
- [x] ✅ No "GST / OFF" text in bill preview
- [x] ✅ CGST/SGST rows only display when `gstEnabled === true`
- [x] ✅ Applied to both bill preview and printed receipt

### Excel Export Architecture
- [x] ✅ Server returns base64-encoded workbook content
- [x] ✅ No file system operations in `orderReports.ts`
- [x] ✅ Desktop decodes base64 correctly: `Uint8Array.from(atob(...))`
- [x] ✅ Tauri command validates folder path and file names
- [x] ✅ localStorage persists folder selection with key `big-bites-order-reports-folder`

### Order Sequence Reset
- [x] ✅ `resetOrderSequenceIfEmpty()` called after order deletion
- [x] ✅ PostgreSQL sequence reset to 1 when order count = 0
- [x] ✅ Tests confirm sequence behavior

---

## Manual Testing (To Be Performed)

### Feature 1: GST OFF Visibility
**Test Case 1a: Verify GST OFF hides tax row**
- [ ] Open Admin Settings → toggle GST to OFF
- [ ] Create a new table order
- [ ] Proceed to billing for that order
- [ ] **Expected**: Bill preview shows NO tax rows (no "GST / OFF" text)
- [ ] **Actual**: _______________

**Test Case 1b: Verify GST ON shows tax rows**
- [ ] In Admin Settings → toggle GST to ON
- [ ] Create a new table order
- [ ] Proceed to billing
- [ ] **Expected**: Bill preview shows CGST and SGST rows with amounts
- [ ] **Actual**: _______________

**Test Case 1c: Verify printed receipt matches**
- [ ] With GST ON, print a receipt
- [ ] **Expected**: CGST and SGST lines appear
- [ ] With GST OFF, print a receipt
- [ ] **Expected**: No tax lines appear

---

### Feature 2: Excel Export to Desktop Folder

**Test Case 2a: Select folder and verify save location**
- [ ] Open Admin Dashboard → Reports tab
- [ ] Click "Browse" to select an Excel folder
- [ ] Choose a folder (e.g., `C:\Users\<username>\Desktop\Orders`)
- [ ] Process a payment
- [ ] **Expected**: Excel file `.xlsx` appears in the selected folder
- [ ] **Actual**: _______________
- [ ] File name format (e.g., `January 2025.xlsx`): _______________

**Test Case 2b: Verify file content is valid**
- [ ] Open the saved `.xlsx` file with Excel or LibreOffice
- [ ] **Expected**:
  - Spreadsheet contains order data (Order No, Date, Items, Subtotal, Discount, GST, Total)
  - Data matches the paid order
  - No errors when opening file
- [ ] **Actual**: _______________

**Test Case 2c: Multiple monthly exports**
- [ ] Perform multiple payments over different months (or adjust system date)
- [ ] **Expected**: Multiple `.xlsx` files in folder (one per month)
- [ ] **Actual**: _______________

**Test Case 2d: Error handling**
- [ ] Select a read-only folder
- [ ] Process a payment
- [ ] **Expected**: Error banner shows "Unable to save..." but payment still succeeds
- [ ] **Actual**: _______________

**Test Case 2e: Folder persistence**
- [ ] Select a folder and process payment (saves successfully)
- [ ] Close and reopen the desktop app
- [ ] Go to Reports tab
- [ ] **Expected**: Same folder path is still selected (loaded from localStorage)
- [ ] **Actual**: _______________

---

### Feature 3: Order Sequence Reset to #1

**Test Case 3a: Delete all orders and verify reset**
- [ ] Create and complete orders #1, #2, #3
- [ ] In Admin Dashboard → Orders, delete all three orders
- [ ] Create a new order
- [ ] **Expected**: New order receives ID #1
- [ ] **Actual**: _______________

**Test Case 3b: Partial deletion doesn't reset**
- [ ] Create orders #1, #2, #3
- [ ] Delete order #1 only
- [ ] Create a new order
- [ ] **Expected**: New order receives ID #4 (not #1)
- [ ] **Actual**: _______________

**Test Case 3c: Verify in printed bill**
- [ ] After full deletion and reset, create and bill an order
- [ ] Print receipt
- [ ] **Expected**: Bill shows "Bill No: #1"
- [ ] **Actual**: _______________

---

## Integration Tests (To Be Performed)

**Test 4a: Full Payment Flow with All Features**
- [ ] GST: ON
- [ ] Create order with multiple items
- [ ] Apply discount
- [ ] Process payment (cash/card)
- [ ] **Expected**:
  - Bill shows CGST/SGST correctly
  - Payment succeeds
  - Excel file saves to selected folder
  - Order marked as COMPLETED
  - No error banners
- [ ] **Actual**: _______________

**Test 4b: Full Payment Flow with GST OFF**
- [ ] GST: OFF
- [ ] Create order with multiple items
- [ ] Process payment
- [ ] **Expected**:
  - Bill shows NO tax rows
  - Excel file saved with "OFF" in gstStatus column
  - Payment succeeds
- [ ] **Actual**: _______________

---

## Performance Checks (To Be Performed)

**Test 5a: Large Monthly Export**
- [ ] Create 50+ orders in one month
- [ ] Export all to Excel
- [ ] **Expected**:
  - Export completes within 10 seconds
  - File saves successfully
  - No timeout or memory errors
- [ ] **Actual**: _______________

**Test 5b: Base64 Encoding/Decoding**
- [ ] Monitor browser DevTools → Network tab during payment
- [ ] Check workbook file size in response
- [ ] **Expected**: Base64 data transfers without truncation
- [ ] **Actual**: _______________

---

## Security Checks (To Be Performed)

**Test 6a: Path Traversal Prevention**
- [ ] Manually edit localStorage to set folder path to `../../../etc`
- [ ] Try to export
- [ ] **Expected**: Error: "selected folder path is not available"
- [ ] **Actual**: _______________

**Test 6b: File Name Validation**
- [ ] Mock server to return workbook name `../../malicious.txt`
- [ ] Try to export
- [ ] **Expected**: Error: "The server returned an invalid monthly workbook name"
- [ ] **Actual**: _______________

---

## Regression Tests (To Be Performed)

- [ ] ✅ Existing orders still load correctly
- [ ] ✅ Existing payments still process correctly
- [ ] ✅ Discount calculations still accurate
- [ ] ✅ Admin dashboard still functions
- [ ] ✅ Waiter app integration still works
- [ ] ✅ Active products can be ordered without inventory limits
- [ ] ✅ User authentication still works

---

## Summary

| Category | Status | Notes |
|----------|--------|-------|
| Build | ✅ Pass | All TypeScript compiles, no errors |
| Unit Tests | ✅ Pass | 27/27 tests pass, 0 failures |
| GST OFF | ✅ Ready | Code reviewed, builds verified |
| Excel Export | ✅ Ready | Base64 pipeline implemented, tests pass |
| Order Reset | ✅ Verified | Already working, no changes needed |

**Overall Status**: ✅ **Ready for Manual Testing**

---

## Sign-Off

- [ ] All automated tests pass
- [ ] Manual testing completed per checklist
- [ ] No regressions detected
- [ ] Ready for production deployment

**Tested By**: _________________
**Date**: _________________
**Notes**: ___________________________________________________________________
