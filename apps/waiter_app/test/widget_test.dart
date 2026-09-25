import 'package:flutter_test/flutter_test.dart';
import 'package:waiter_app/main.dart';

void main() {
  testWidgets('BIG BITES login screen loads', (WidgetTester tester) async {
    await tester.pumpWidget(const HotelPOSApp());

    expect(find.text('BIG BITES'), findsOneWidget);
    expect(find.text('Waiter Login'), findsOneWidget);
    expect(find.text('LOGIN'), findsOneWidget);
  });
}