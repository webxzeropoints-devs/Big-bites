int parseMinorUnits(Object? value) {
  final match = RegExp(
    r'^(0|[1-9]\d*)(?:\.(\d{1,2}))?$',
  ).firstMatch(value.toString().trim());
  if (match == null) {
    throw FormatException('Invalid currency amount');
  }
  final fraction = (match.group(2) ?? '').padRight(2, '0');
  return int.parse(match.group(1)!) * 100 +
      (fraction.isEmpty ? 0 : int.parse(fraction));
}

String formatMinorUnits(int value) =>
    '₹${value ~/ 100}.${(value % 100).toString().padLeft(2, '0')}';
