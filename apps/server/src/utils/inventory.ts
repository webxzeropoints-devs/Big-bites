import { Prisma } from "@prisma/client";

export async function restoreOrderStock(
  tx: Prisma.TransactionClient,
  orderId: number,
) {
  const sales = await tx.productStockMovement.findMany({
    where: { orderId, movementType: "SALE" },
    orderBy: [{ productId: "asc" }, { id: "asc" }],
  });
  for (const sale of sales) {
    await tx.$queryRaw`
      SELECT "id" FROM "Product" WHERE "id" = ${sale.productId} FOR UPDATE
    `;
    const product = await tx.product.findUnique({
      where: { id: sale.productId },
      select: { id: true, stock: true },
    });
    if (!product) {
      throw new Error(`Stock movement ${sale.id} references a missing product`);
    }
    const previousStock = product.stock;
    const newStock = previousStock + sale.quantity;
    await tx.product.update({
      where: { id: sale.productId },
      data: { stock: newStock, lastStockUpdatedAt: new Date() },
    });
    await tx.productStockMovement.create({
      data: {
        productId: sale.productId,
        orderId,
        movementType: "CANCEL_RESTOCK",
        quantity: sale.quantity,
        previousStock,
        newStock,
        reason: `Cancelled order ${orderId}`,
      },
    });
  }
}
