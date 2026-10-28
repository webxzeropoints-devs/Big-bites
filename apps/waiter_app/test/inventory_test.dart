import 'package:flutter_test/flutter_test.dart';
import 'package:waiter_app/utils/inventory.dart';

void main() {
  test('uninitialized stock does not limit order quantity', () {
    expect(
      canAddInventoryQuantity(selectedQuantity: 100, availableStock: null),
      isTrue,
    );
  });

  test('initialized stock blocks zero and exhausted quantities', () {
    expect(
      canAddInventoryQuantity(selectedQuantity: 0, availableStock: 0),
      isFalse,
    );
    expect(
      canAddInventoryQuantity(selectedQuantity: 3, availableStock: 3),
      isFalse,
    );
  });

  test('initialized stock allows quantities below available count', () {
    expect(
      canAddInventoryQuantity(selectedQuantity: 2, availableStock: 3),
      isTrue,
    );
  });
}
