import 'dart:convert';
import 'dart:developer' as developer;

import 'package:http/http.dart' as http;

class ApiService {
  static const String baseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'https://big-bites-server.onrender.com',
  );

  // ============================================================
  // LOGIN
  // ============================================================

  static Future<Map<String, dynamic>> login(
    String username,
    String password,
  ) async {
    final response = await http.post(
      Uri.parse('$baseUrl/api/auth/login'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'username': username, 'password': password}),
    );

    final data = jsonDecode(response.body);

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception(
        data is Map && data['message'] is String
            ? data['message']
            : 'Login failed with status ${response.statusCode}',
      );
    }

    return {'statusCode': response.statusCode, 'data': data};
  }

  // ============================================================
  // GET TABLES
  // ============================================================

  static Future<List<dynamic>> getTables() async {
    final response = await http.get(Uri.parse('$baseUrl/api/tables'));

    if (response.statusCode != 200) {
      throw Exception(
        'Failed to load table statuses '
        '(status ${response.statusCode})',
      );
    }

    final data = jsonDecode(response.body);

    if (data is! List) {
      throw Exception('The server returned an invalid table status response');
    }

    for (final table in data) {
      if (table is! Map ||
          table['id'] is! num ||
          table['status'] is! String ||
          !['AVAILABLE', 'OCCUPIED', 'RESERVED'].contains(table['status'])) {
        throw Exception('The server returned an invalid table status');
      }
    }

    return data;
  }

  // ============================================================
  // GET PRODUCTS
  // ============================================================

  static Future<List<dynamic>> getProducts() async {
    final response = await http.get(Uri.parse('$baseUrl/api/products'));

    if (response.statusCode != 200) {
      throw Exception(
        'Failed to load products '
        '(status ${response.statusCode})',
      );
    }

    final data = jsonDecode(response.body);

    if (data is! List) {
      throw Exception('The server returned an invalid products response');
    }

    return data;
  }

  // ============================================================
  // GET ACTIVE ORDER FOR A TABLE
  // ============================================================

  static Future<Map<String, dynamic>?> getActiveTableOrder({
    required int tableId,
    required String token,
  }) async {
    final requestUrl = '$baseUrl/api/orders/table/$tableId/active';
    final requestUri = Uri.parse(requestUrl);
    developer.log('GET ACTIVE ORDER request URL: $requestUrl');

    final response = await http.get(
      requestUri,
      headers: {'Authorization': 'Bearer $token'},
    );

    developer.log(
      'GET ACTIVE ORDER response.statusCode: ${response.statusCode}',
    );
    developer.log('GET ACTIVE ORDER response.body: ${response.body}');

    dynamic data;

    try {
      data = jsonDecode(response.body);
    } on FormatException {
      final contentType = response.headers['content-type'] ?? 'unknown';
      final bodyStartsWithHtml = response.body.trimLeft().startsWith('<');
      final responseType = bodyStartsWithHtml || contentType.contains('html')
          ? 'HTML'
          : 'non-JSON';
      throw Exception(
        'The active-order API returned $responseType '
        '(HTTP ${response.statusCode}, $contentType). '
        'Check that the latest backend is deployed.',
      );
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception(
        data is Map && data['message'] is String
            ? data['message']
            : 'Failed to load the active order',
      );
    }

    if (data == null) {
      return null;
    }

    if (data is! Map || data['id'] is! num) {
      throw Exception('The server returned an invalid active order response');
    }

    return Map<String, dynamic>.from(data);
  }

  // ============================================================
  // CREATE A BRAND-NEW ORDER
  // ============================================================

  static Future<Map<String, dynamic>> createOrder({
    required int tableId,
    required int waiterId,
    required List<Map<String, dynamic>> items,
    required String token,
  }) async {
    final response = await http.post(
      Uri.parse('$baseUrl/api/orders'),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer $token',
      },
      body: jsonEncode({
        'tableId': tableId,
        'waiterId': waiterId,
        'items': items,
      }),
    );

    dynamic decoded;

    try {
      decoded = jsonDecode(response.body);
    } catch (_) {
      decoded = {'message': 'Invalid server response'};
    }

    return {'statusCode': response.statusCode, 'data': decoded};
  }

  // ============================================================
  // ADD ITEMS TO AN EXISTING ORDER
  // ============================================================

  static Future<Map<String, dynamic>> addItemsToOrder({
    required int orderId,
    required List<Map<String, dynamic>> items,
    required String token,
  }) async {
    final response = await http.patch(
      Uri.parse('$baseUrl/api/orders/$orderId/add-items'),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer $token',
      },
      body: jsonEncode({'items': items}),
    );

    dynamic decoded;

    try {
      decoded = jsonDecode(response.body);
    } catch (_) {
      decoded = {'message': 'Invalid server response'};
    }

    return {'statusCode': response.statusCode, 'data': decoded};
  }

  // ============================================================
  // SEND AN ORDER TO CASHIER
  // ============================================================

  static Future<Map<String, dynamic>> sendOrderToCashier({
    required int orderId,
    required String token,
  }) async {
    final response = await http.patch(
      Uri.parse('$baseUrl/api/orders/$orderId/send-to-cashier'),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer $token',
      },
    );

    dynamic decoded;
    try {
      decoded = jsonDecode(response.body);
    } catch (_) {
      decoded = {'message': 'Invalid server response'};
    }

    return {'statusCode': response.statusCode, 'data': decoded};
  }
}
