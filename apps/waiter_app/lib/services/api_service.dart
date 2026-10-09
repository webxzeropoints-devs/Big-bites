import 'dart:async';
import 'dart:convert';
import 'dart:developer' as developer;
import 'dart:io';

import 'package:http/http.dart' as http;

class ApiService {
  static const String _defaultBaseUrl = 'http://localhost:3000';
  static const String _configuredBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: _defaultBaseUrl,
  );
  static const int _discoveryPort = 3001;
  static const String _discoveryRequest = 'BIGBITES_POS_DISCOVERY_V1';
  static String baseUrl = _configuredBaseUrl;

  static bool _isPrivateIPv4(String address) {
    final ip = InternetAddress.tryParse(address);
    if (ip == null || ip.type != InternetAddressType.IPv4) return false;
    final octets = ip.rawAddress;
    return octets[0] == 10 ||
        (octets[0] == 172 && octets[1] >= 16 && octets[1] <= 31) ||
        (octets[0] == 192 && octets[1] == 168);
  }

  static Future<String> discoverServer({
    Duration timeout = const Duration(seconds: 8),
  }) async {
    if (_configuredBaseUrl.isNotEmpty) {
      baseUrl = _configuredBaseUrl;
      try {
        await _checkHealth(baseUrl);
        return baseUrl;
      } catch (_) {
        // Fall back to local network discovery when the default local endpoint
        // is unavailable or when the app is running in a device/network setup.
      }
    }

    final socket = await RawDatagramSocket.bind(InternetAddress.anyIPv4, 0);
    final response = Completer<Map<String, dynamic>>();
    socket.broadcastEnabled = true;
    socket.listen((event) {
      if (event != RawSocketEvent.read) return;

      Datagram? datagram;
      while ((datagram = socket.receive()) != null) {
        try {
          final payload = jsonDecode(utf8.decode(datagram!.data));
          if (payload is Map<String, dynamic> &&
              payload['service'] == 'big-bites-pos') {
            final host = payload['host'];
            if (host is String &&
                payload['port'] == 3000 &&
                _isPrivateIPv4(host) &&
                !response.isCompleted) {
              response.complete({'host': host, 'port': 3000});
            }
          }
        } on FormatException {
          continue;
        }
      }
    });

    try {
      final broadcasts = <InternetAddress>{InternetAddress('255.255.255.255')};
      final message = utf8.encode(_discoveryRequest);
      for (final broadcast in broadcasts) {
        socket.send(message, broadcast, _discoveryPort);
      }

      final server = await response.future.timeout(timeout);
      final discoveredUrl = 'http://${server['host']}:${server['port']}';
      await _checkHealth(discoveredUrl);
      baseUrl = discoveredUrl;
      return baseUrl;
    } on TimeoutException {
      throw Exception(
        'Could not discover a BIG BITES POS server on this Wi-Fi network. '
        'Check that the POS PC is running and both devices use the same network.',
      );
    } finally {
      socket.close();
    }
  }

  static Future<void> _checkHealth(String url) async {
    final response = await http
        .get(Uri.parse('$url/health'))
        .timeout(const Duration(seconds: 5));
    dynamic data;
    try {
      data = jsonDecode(response.body);
    } on FormatException {
      throw Exception(
        'The discovered server returned an invalid health response.',
      );
    }
    if (response.statusCode != 200 ||
        data is! Map ||
        data['status'] != 'OK' ||
        data['database'] != 'Connected') {
      throw Exception(
        data is Map && data['database'] == 'Disconnected'
            ? 'The POS server was found, but its database is unavailable.'
            : 'The discovered server did not pass its health check.',
      );
    }
  }

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

  static Future<List<dynamic>> getCategories() async {
    final response = await http.get(
      Uri.parse('$baseUrl/api/products/categories'),
    );

    if (response.statusCode != 200) {
      throw Exception(
        'Failed to load menu categories '
        '(status ${response.statusCode})',
      );
    }

    final data = jsonDecode(response.body);
    if (data is! List) {
      throw Exception(
        'The server returned an invalid menu categories response',
      );
    }
    return data;
  }

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
    required List<Map<String, dynamic>> items,
    required String token,
  }) async {
    final response = await http.post(
      Uri.parse('$baseUrl/api/orders'),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer $token',
      },
      body: jsonEncode({'tableId': tableId, 'items': items}),
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
