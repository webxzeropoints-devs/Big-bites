bool canAddInventoryQuantity({
  required int selectedQuantity,
  required int? availableStock,
}) {
  return availableStock == null || selectedQuantity < availableStock;
}
