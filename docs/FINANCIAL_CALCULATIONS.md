# Financial calculation policy

## Monetary representation and rounding

Money is represented internally as integer paise. The server parses monetary
inputs as non-negative decimal values with no more than two fractional digits,
and validates them against the Prisma `Decimal(10,2)` range. Quantities must be
non-negative safe integers. Persisted monetary values are written as decimal
strings with exactly two fractional digits.

Percentage rates are represented in hundredths of a percent (basis points).
GST and percentage discounts use round-half-up to the nearest paisa. An exact
half-paisa rounds upward. Line totals are unit price in paise multiplied by
integer quantity; no intermediate floating-point rounding is used.

## Tax and discounts

Menu prices are tax-exclusive; no tax-inclusive pricing mode is represented in
the current product schema. Discounts are applied to the subtotal before GST.
Fixed discounts cannot exceed the bill subtotal and percentage discounts are
limited to 100%.

GST is calculated once on the discounted taxable subtotal using the configured
order GST rate. The default remains 5%. The rounded total GST is split between
CGST and SGST; if total GST has an odd number of paise, the extra paisa is
assigned to CGST. At the default rate, the component rates remain 2.5% each.
The invoice total is taxable subtotal plus this once-rounded GST amount.

For bills grouping multiple orders, each order's invoice amounts are rounded
individually and then summed in paise. This preserves the amounts of the
underlying order invoices.

## Payments and cash

Cash received must be a valid amount in paise and cannot be less than the
amount due. Change is cash received minus amount due. For non-cash payments,
the amount received is the amount due; arbitrary client-submitted totals or
cash change are not accepted. For one cash payment covering a table group,
aggregate excess/change is recorded on the first payment row and the other
rows record their allocated due amounts, so persisted tender and change
reconcile to the aggregate payment.

The current schema and routes do not implement partial payments or refunds.
Paid/refunded orders cannot be paid again or deleted through the audited
administrative deletion path. These flows need explicit business rules before
being added.

## Persistence and deployment

Payment tender and change are nullable `Decimal(10,2)` fields added by the
`20261006150000_payment_tender_details` Prisma migration. The migration is
additive and must be applied through the project's normal deployment process
before deploying code that writes these fields. It was not applied as part of
the audit; no production database records, stock, orders, or payments were
modified.
