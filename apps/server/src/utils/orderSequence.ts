import type { Prisma } from "@prisma/client";

const ORDER_SEQUENCE_LOCK_ID = 714203;

export async function lockOrderSequence(
  tx: Prisma.TransactionClient,
): Promise<void> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(${ORDER_SEQUENCE_LOCK_ID})`;
}

export async function resetOrderSequenceIfEmpty(
  tx: Prisma.TransactionClient,
): Promise<void> {
  if ((await tx.order.count()) !== 0) {
    return;
  }

  await tx.$queryRaw`
    SELECT setval(pg_get_serial_sequence('"Order"', 'id'), 1, false)
  `;
}
