import 'package:flutter_test/flutter_test.dart';
import 'package:waiter_app/utils/currency.dart';

void main() {
  test('parses and formats amounts exactly in paise', () {
    expect(parseMinorUnits('0.10') * 3, 30);
    expect(parseMinorUnits('19.99') * 4, 7996);
    expect(parseMinorUnits('12'), 1200);
    expect(formatMinorUnits(7996), '₹79.96');
  });

  test('rejects invalid or over-precision amounts', () {
    expect(() => parseMinorUnits('1.001'), throwsFormatException);
    expect(() => parseMinorUnits('-0.01'), throwsFormatException);
    expect(() => parseMinorUnits('Infinity'), throwsFormatException);
  });
}
