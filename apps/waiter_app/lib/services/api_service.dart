import 'dart:async';
import 'dart:convert';
import 'dart:developer' as developer;
import 'dart:io';

import 'package:http/http.dart' as http;

class ApiService {
  static const String _explicitBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: '',
  );
  static String baseUrl = _explicitBaseUrl;

  static const String _discoveryRequest = 'BIGBITES_POS_DISCOVERY_V1';
  static const int _discoveryPort = 3001;
  static const int _serverPort = 3000;
  static const Duration _discoveryTimeout = Duration(seconds: 5);
  static const Duration _healthTimeout = Duration(seconds: 8);
  static const Duration _reconnectInterval = Duration(seconds: 15);

  static const String _localServerUnavailable =
      'Unable to find the BIG BITES POS server. Connect to the restaurant '
      'Wi-Fi/LAN and ensure the desktop POS is running.';
  static Timer? _reconnectTimer;
  static Future<String>? _backendCheck;

  static Future<String> checkBackend() {
    final currentCheck = _backendCheck;
    if (currentCheck != null) return currentCheck;

    final check = _checkBackend();
    _backendCheck = check;
    return check.whenComplete(() {
      if (identical(_backendCheck, check)) _backendCheck = null;
    });
  }

  static void startReconnectMonitor() {
    _reconnectTimer ??= Timer.periodic(_reconnectInterval, (_) {
      checkBackend().catchError((Object _) => baseUrl);
    });
  }

  static Future<String> _checkBackend() async {
    if (_explicitBaseUrl.isNotEmpty) {
      await _checkHealth(_explicitBaseUrl);
      baseUrl = _explicitBaseUrl;
      return baseUrl;
    }

    try {
      final host = await _discoverServer();
      if (host == null) {
        throw Exception(_localServerUnavailable);
      }

      final discoveredUrl = 'http://$host:$_serverPort';
      await _checkHealth(discoveredUrl);
      baseUrl = discoveredUrl;
      return baseUrl;
    } on SocketException {
      throw Exception(_localServerUnavailable);
    } on TimeoutException {
      throw Exception(_localServerUnavailable);
    } on http.ClientException {
      throw Exception(_localServerUnavailable);
    } on FormatException {
      throw Exception(_localServerUnavailable);
    } on Exception {
      throw Exception(_localServerUnavailable);
    }
  }

  static Future<String?> _discoverServer() async {
    final socket = await RawDatagramSocket.bind(InternetAddress.anyIPv4, 0);
    StreamSubscription<RawSocketEvent>? subscription;
    try {
      socket.broadcastEnabled = true;
      final response = Completer<String?>();
      subscription = socket.listen(
        (event) {
          if (event != RawSocketEvent.read) return;

          Datagram? datagram;
          while ((datagram = socket.receive()) != null) {
            try {
              final decoded = jsonDecode(
                utf8.decode(datagram!.data, allowMalformed: false),
              );
              if (decoded is! Map ||
                  decoded['service'] != 'big-bites-pos' ||
                  decoded['port'] is! int ||
                  decoded['port'] != _serverPort ||
                  decoded['host'] is! String) {
                continue;
              }

              final address = InternetAddress.tryParse(
                decoded['host'] as String,
              );
              if (address == null ||
                  address.type != InternetAddressType.IPv4 ||
                  !_isPrivateIPv4(address.address)) {
                continue;
              }

              if (!response.isCompleted) {
                response.complete(address.address);
              }
            } on FormatException {
              // Ignore malformed packets and continue listening.
            }
          }
        },
        onError: (Object error, StackTrace stackTrace) {
          if (!response.isCompleted) {
            response.completeError(error, stackTrace);
          }
        },
        onDone: () {
          if (!response.isCompleted) response.complete(null);
        },
      );
      socket.send(
        utf8.encode(_discoveryRequest),
        InternetAddress('255.255.255.255'),
        _discoveryPort,
      );
      return await response.future.timeout(
        _discoveryTimeout,
        onTimeout: () => null,
      );
    } finally {
      try {
        await subscription?.cancel();
      } finally {
        socket.close();
      }
    }
  }

  static bool _isPrivateIPv4(String address) {
    final octets = address.split('.').map(int.tryParse).toList();
    if (octets.length != 4 || octets.any((octet) => octet == null)) {
      return false;
    }
    final first = octets[0]!;
    final second = octets[1]!;
    return first == 10 ||
        (first == 172 && second >= 16 && second <= 31) ||
        (first == 192 && second == 168);
  }

  static Future<void> _checkHealth(String url) async {
    final response = await http
        .get(Uri.parse('$url/health'))
        .timeout(_healthTimeout);
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
            ? 'The BIG BITES server is online, but its database is unavailable.'
            : 'The BIG BITES server health check failed (HTTP ${response.statusCode}).',
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

  static Future<Map<String, dynamic>> cancelOrder({
    required int orderId,
    required String token,
  }) async {
    final response = await http.patch(
      Uri.parse('$baseUrl/api/orders/$orderId/cancel'),
      headers: {'Authorization': 'Bearer $token'},
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
