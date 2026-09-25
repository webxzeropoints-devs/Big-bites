import 'dart:convert';

import 'package:http/http.dart' as http;

class ApiService {
  static String get baseUrl => 'https://big-bites-server.onrender.com';

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

  static Future<List<dynamic>> getTables() async {
    final response = await http.get(Uri.parse('$baseUrl/api/tables'));

    if (response.statusCode != 200) {
      throw Exception(
        'Failed to load table statuses (status ${response.statusCode})',
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

  static Future<List<dynamic>> getProducts() async {
    final response = await http.get(Uri.parse('$baseUrl/api/products'));

    if (response.statusCode != 200) {
      throw Exception('Failed to load products');
    }

    return jsonDecode(response.body);
  }

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

    return {
      'statusCode': response.statusCode,
      'data': jsonDecode(response.body),
    };
  }
}
