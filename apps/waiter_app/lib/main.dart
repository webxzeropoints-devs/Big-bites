import 'package:flutter/material.dart';

import 'services/api_service.dart';
import 'utils/currency.dart';

void main() {
  runApp(const HotelWaiterApp());
}

// ============================================================
// APP
// ============================================================

class HotelWaiterApp extends StatelessWidget {
  const HotelWaiterApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'BB Waiter',
      theme: ThemeData(useMaterial3: true, colorSchemeSeed: Colors.deepOrange),
      home: const LoginScreen(),
    );
  }
}

// ============================================================
// LOGIN SCREEN
// ============================================================

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final usernameController = TextEditingController();
  final passwordController = TextEditingController();

  bool loading = false;
  bool obscurePassword = true;
  bool discoveringServer = true;
  bool serverReady = false;
  String serverStatus = 'Searching for the POS server on this Wi-Fi...';

  @override
  void initState() {
    super.initState();
    discoverServer();
  }

  Future<void> discoverServer() async {
    setState(() {
      discoveringServer = true;
      serverReady = false;
      serverStatus = 'Searching for the POS server on this Wi-Fi...';
    });
    try {
      final serverUrl = await ApiService.discoverServer();
      if (!mounted) return;
      setState(() {
        serverReady = true;
        serverStatus = 'POS server ready at $serverUrl';
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        serverStatus = error.toString().replaceFirst('Exception: ', '');
      });
    } finally {
      if (mounted) {
        setState(() {
          discoveringServer = false;
        });
      }
    }
  }

  Future<void> login() async {
    if (!serverReady) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Wait for POS server discovery to finish'),
        ),
      );
      return;
    }

    final username = usernameController.text.trim();
    final password = passwordController.text;

    if (username.isEmpty || password.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Enter username and password')),
      );
      return;
    }

    setState(() {
      loading = true;
    });

    try {
      final result = await ApiService.login(username, password);

      final data = result['data'];

      if (!mounted) return;

      Navigator.pushReplacement(
        context,
        MaterialPageRoute(
          builder: (_) => TableScreen(
            user: Map<String, dynamic>.from(data['user']),
            token: data['token'].toString(),
          ),
        ),
      );
    } catch (e) {
      if (!mounted) return;

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.toString().replaceFirst('Exception: ', ''))),
      );
    } finally {
      if (mounted) {
        setState(() {
          loading = false;
        });
      }
    }
  }

  @override
  void dispose() {
    usernameController.dispose();
    passwordController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: Card(
              elevation: 5,
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  children: [
                    Image.asset(
                      'assets/big-bites-logo.png',
                      height: 100,
                      fit: BoxFit.contain,
                    ),
                    const SizedBox(height: 16),
                    const Text(
                      'BIG BITES',
                      style: TextStyle(
                        fontSize: 30,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 6),
                    const Text(
                      'BB Waiter',
                      style: TextStyle(fontSize: 16, color: Colors.grey),
                    ),
                    const SizedBox(height: 12),
                    Text(
                      serverStatus,
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: serverReady
                            ? Colors.green.shade700
                            : Colors.grey,
                      ),
                    ),
                    if (!serverReady && !discoveringServer)
                      TextButton(
                        onPressed: discoverServer,
                        child: const Text('Retry server discovery'),
                      ),
                    const SizedBox(height: 30),
                    TextField(
                      controller: usernameController,
                      decoration: const InputDecoration(
                        labelText: 'Username',
                        prefixIcon: Icon(Icons.person),
                        border: OutlineInputBorder(),
                      ),
                    ),
                    const SizedBox(height: 16),
                    TextField(
                      controller: passwordController,
                      obscureText: obscurePassword,
                      onSubmitted: (_) => login(),
                      decoration: InputDecoration(
                        labelText: 'Password',
                        prefixIcon: const Icon(Icons.lock),
                        border: const OutlineInputBorder(),
                        suffixIcon: IconButton(
                          onPressed: () {
                            setState(() {
                              obscurePassword = !obscurePassword;
                            });
                          },
                          icon: Icon(
                            obscurePassword
                                ? Icons.visibility
                                : Icons.visibility_off,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(height: 22),
                    SizedBox(
                      width: double.infinity,
                      height: 52,
                      child: FilledButton(
                        onPressed: loading || !serverReady ? null : login,
                        child: loading
                            ? const SizedBox(
                                width: 24,
                                height: 24,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                  color: Colors.white,
                                ),
                              )
                            : const Text(
                                'LOGIN',
                                style: TextStyle(fontWeight: FontWeight.bold),
                              ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

// ============================================================
// TABLE SCREEN
// ============================================================

class TableScreen extends StatefulWidget {
  final Map<String, dynamic> user;
  final String token;

  const TableScreen({super.key, required this.user, required this.token});

  @override
  State<TableScreen> createState() => _TableScreenState();
}

class _TableScreenState extends State<TableScreen> {
  List<dynamic> tables = [];

  bool loading = true;

  String? error;

  @override
  void initState() {
    super.initState();
    loadTables();
  }

  Future<void> loadTables() async {
    try {
      setState(() {
        loading = true;
        error = null;
      });

      final data = await ApiService.getTables();

      if (!mounted) return;

      setState(() {
        tables = data;
        loading = false;
      });
    } catch (e) {
      if (!mounted) return;

      setState(() {
        loading = false;
        error = e.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  Future<void> openTable(Map<String, dynamic> table) async {
    final status = table['status']?.toString() ?? 'AVAILABLE';

    if (status == 'RESERVED') {
      return;
    }

    final tableId = (table['id'] as num).toInt();
    final tableNumber = (table['number'] as num).toInt();
    final isParcel = table['isParcel'] == true;

    try {
      final activeOrder = await ApiService.getActiveTableOrder(
        tableId: tableId,
        token: widget.token,
      );

      if (!mounted) return;

      await Navigator.push(
        context,
        MaterialPageRoute(
          builder: (_) => MenuScreen(
            tableId: tableId,
            tableNumber: tableNumber,
            token: widget.token,
            isParcel: isParcel,
            existingOrder: activeOrder != null,
            existingOrderId: activeOrder == null
                ? null
                : (activeOrder['id'] as num).toInt(),
            existingOrderStatus: activeOrder?['status']?.toString(),
            existingOrderTotalMinor: parseMinorUnits(
              activeOrder?['total']?.toString() ?? '0',
            ),
          ),
        ),
      );

      if (mounted) {
        await loadTables();
      }
    } catch (e) {
      if (!mounted) return;

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.toString().replaceFirst('Exception: ', ''))),
      );
    }
  }

  Color tableColor(String status) {
    switch (status) {
      case 'OCCUPIED':
        return Colors.red.shade100;

      case 'RESERVED':
        return Colors.orange.shade100;

      default:
        return Colors.green.shade100;
    }
  }

  Color statusColor(String status) {
    switch (status) {
      case 'OCCUPIED':
        return Colors.red;

      case 'RESERVED':
        return Colors.orange;

      default:
        return Colors.green;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text(
          'Tables',
          style: TextStyle(fontWeight: FontWeight.bold),
        ),
        actions: [
          IconButton(
            onPressed: loadTables,
            icon: const Icon(Icons.refresh),
            tooltip: 'Refresh',
          ),
          IconButton(
            onPressed: () {
              Navigator.pushReplacement(
                context,
                MaterialPageRoute(builder: (_) => const LoginScreen()),
              );
            },
            icon: const Icon(Icons.logout),
            tooltip: 'Logout',
          ),
        ],
      ),
      body: loading
          ? const Center(child: CircularProgressIndicator())
          : error != null
          ? Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(error!, textAlign: TextAlign.center),
                  const SizedBox(height: 16),
                  FilledButton(
                    onPressed: loadTables,
                    child: const Text('RETRY'),
                  ),
                ],
              ),
            )
          : RefreshIndicator(
              onRefresh: loadTables,
              child: GridView.builder(
                padding: const EdgeInsets.all(16),
                itemCount: tables.length,
                gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                  crossAxisCount: 2,
                  crossAxisSpacing: 14,
                  mainAxisSpacing: 14,
                  childAspectRatio: 0.70,
                ),
                itemBuilder: (context, index) {
                  final table = Map<String, dynamic>.from(tables[index]);

                  final status = table['status']?.toString() ?? 'AVAILABLE';

                  final number = (table['number'] as num).toInt();

                  final isParcel = table['isParcel'] == true;

                  return InkWell(
                    borderRadius: BorderRadius.circular(18),
                    onTap: status == 'RESERVED' ? null : () => openTable(table),
                    child: Card(
                      color: tableColor(status),
                      elevation: 3,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(18),
                      ),
                      child: Padding(
                        padding: const EdgeInsets.all(14),
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(
                              isParcel
                                  ? Icons.shopping_bag
                                  : Icons.table_restaurant,
                              size: 48,
                              color: statusColor(status),
                            ),
                            const SizedBox(height: 8),
                            Text(
                              isParcel ? 'PARCEL' : 'TABLE $number',
                              style: const TextStyle(
                                fontSize: 20,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                            const SizedBox(height: 6),
                            Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 12,
                                vertical: 6,
                              ),
                              decoration: BoxDecoration(
                                color: statusColor(status),
                                borderRadius: BorderRadius.circular(20),
                              ),
                              child: Text(
                                status,
                                style: const TextStyle(
                                  color: Colors.white,
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                            ),
                            if (status == 'OCCUPIED') ...[
                              const SizedBox(height: 8),
                              const Text(
                                'Tap to view order',
                                style: TextStyle(
                                  fontSize: 10,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ],
                            if (status == 'AVAILABLE') ...[
                              const SizedBox(height: 8),
                              const Text(
                                'Tap to take order',
                                style: TextStyle(
                                  fontSize: 10,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ],
                          ],
                        ),
                      ),
                    ),
                  );
                },
              ),
            ),
    );
  }
}

// ============================================================
// MENU SCREEN
// ============================================================

class MenuScreen extends StatefulWidget {
  final int tableId;
  final int tableNumber;
  final String token;
  final bool isParcel;
  final bool existingOrder;
  final int? existingOrderId;
  final String? existingOrderStatus;
  final int existingOrderTotalMinor;

  const MenuScreen({
    super.key,
    required this.tableId,
    required this.tableNumber,
    required this.token,
    required this.isParcel,
    required this.existingOrder,
    required this.existingOrderId,
    required this.existingOrderStatus,
    required this.existingOrderTotalMinor,
  });

  @override
  State<MenuScreen> createState() => _MenuScreenState();
}

class _MenuScreenState extends State<MenuScreen> {
  List<dynamic> products = [];
  List<dynamic> categories = [];

  final Map<String, int> quantities = {};
  final Map<int, int> selectedVariants = {};
  final TextEditingController searchController = TextEditingController();
  int? selectedCategoryId;

  bool loading = true;
  bool submitting = false;
  bool sendingToCashier = false;

  String? error;

  @override
  void initState() {
    super.initState();
    loadProducts();
  }

  Future<void> loadProducts() async {
    try {
      setState(() {
        loading = true;
        error = null;
      });

      final results = await Future.wait([
        ApiService.getCategories(),
        ApiService.getProducts(),
      ]);

      if (!mounted) return;

      setState(() {
        categories = results[0];
        products = results[1];
        for (final rawProduct in products) {
          final product = Map<String, dynamic>.from(rawProduct);
          final variants = product['variants'];
          if (variants is List && variants.isNotEmpty) {
            final firstVariant = Map<String, dynamic>.from(variants.first);
            final currentVariantId = selectedVariants[product['id']];
            final variantIds = variants
                .map((variant) => (variant['id'] as num).toInt())
                .toList();
            if (currentVariantId == null ||
                !variantIds.contains(currentVariantId)) {
              selectedVariants[(product['id'] as num).toInt()] =
                  (firstVariant['id'] as num).toInt();
            }
          }
        }
        loading = false;
      });
    } catch (e) {
      if (!mounted) return;

      setState(() {
        loading = false;
        error = e.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  @override
  void dispose() {
    searchController.dispose();
    super.dispose();
  }

  String quantityKey(int productId, int? variantId) =>
      '$productId:${variantId ?? ''}';

  int productQuantity(int productId) {
    return quantities.entries
        .where((entry) => entry.key.startsWith('$productId:'))
        .fold(0, (sum, entry) => sum + entry.value);
  }

  void increaseQuantity(int productId, int? variantId, int stock) {
    final key = quantityKey(productId, variantId);
    final current = quantities[key] ?? 0;

    if (productQuantity(productId) >= stock) {
      return;
    }

    setState(() {
      quantities[key] = current + 1;
    });
  }

  void decreaseQuantity(int productId, int? variantId) {
    final key = quantityKey(productId, variantId);
    final current = quantities[key] ?? 0;

    if (current <= 1) {
      setState(() {
        quantities.remove(key);
      });
    } else {
      setState(() {
        quantities[key] = current - 1;
      });
    }
  }

  int get selectedTotalMinor {
    var totalMinor = 0;

    for (final entry in quantities.entries) {
      final keyParts = entry.key.split(':');
      final productId = int.parse(keyParts.first);
      final variantId = keyParts.length > 1 && keyParts[1].isNotEmpty
          ? int.parse(keyParts[1])
          : null;
      final product = products
          .map((rawProduct) => Map<String, dynamic>.from(rawProduct))
          .firstWhere((item) => (item['id'] as num).toInt() == productId);
      final variants = product['variants'] is List
          ? product['variants'] as List
          : const [];
      final variant = variantId == null
          ? null
          : variants
                .map((rawVariant) => Map<String, dynamic>.from(rawVariant))
                .firstWhere((item) => (item['id'] as num).toInt() == variantId);
      final priceMinor = parseMinorUnits(variant?['price'] ?? product['price']);
      totalMinor += priceMinor * entry.value;
    }

    return totalMinor;
  }

  List<Map<String, dynamic>> get selectedItems {
    final List<Map<String, dynamic>> items = [];

    for (final entry in quantities.entries) {
      if (entry.value <= 0) continue;
      final parts = entry.key.split(':');
      final productId = int.parse(parts.first);
      final variantId = parts.length > 1 && parts[1].isNotEmpty
          ? int.parse(parts[1])
          : null;
      items.add({
        'productId': productId,
        'variantId': variantId,
        'quantity': entry.value,
      });
    }

    return items;
  }

  Future<void> sendToCashier() async {
    final orderId = widget.existingOrderId;
    if (orderId == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Unable to identify the active order')),
      );
      return;
    }

    setState(() {
      sendingToCashier = true;
    });

    try {
      final items = selectedItems;
      if (items.isNotEmpty) {
        final addItemsResult = await ApiService.addItemsToOrder(
          orderId: orderId,
          items: items,
          token: widget.token,
        );
        final addItemsStatusCode = addItemsResult['statusCode'] as int;
        final addItemsData = addItemsResult['data'];

        if (addItemsStatusCode < 200 || addItemsStatusCode >= 300) {
          throw Exception(
            addItemsData is Map && addItemsData['message'] is String
                ? addItemsData['message']
                : 'Failed to add selected items to the order',
          );
        }
      }

      final result = await ApiService.sendOrderToCashier(
        orderId: orderId,
        token: widget.token,
      );
      final statusCode = result['statusCode'] as int;
      final data = result['data'];

      if (statusCode < 200 || statusCode >= 300) {
        throw Exception(
          data is Map && data['message'] is String
              ? data['message']
              : 'Failed to send order to cashier',
        );
      }

      if (!mounted) return;

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            'Order #$orderId sent to cashier · Total ${formatMinorUnits(orderTotal)}',
          ),
          backgroundColor: Colors.green,
        ),
      );
      Navigator.pop(context);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(e.toString().replaceFirst('Exception: ', '')),
          backgroundColor: Colors.red,
        ),
      );
    } finally {
      if (mounted) {
        setState(() {
          sendingToCashier = false;
        });
      }
    }
  }

  Future<void> submitOrder() async {
    final items = selectedItems;

    if (items.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Select at least one food item')),
      );
      return;
    }

    setState(() {
      submitting = true;
    });

    try {
      if (widget.existingOrder && widget.existingOrderId == null) {
        throw Exception('Unable to identify the active order');
      }

      final result = widget.existingOrder
          ? await ApiService.addItemsToOrder(
              orderId: widget.existingOrderId!,
              items: items,
              token: widget.token,
            )
          : await ApiService.createOrder(
              tableId: widget.tableId,
              items: items,
              token: widget.token,
            );

      final statusCode = result['statusCode'];

      final data = result['data'];

      if (statusCode < 200 || statusCode >= 300) {
        throw Exception(
          data is Map && data['message'] is String
              ? data['message']
              : 'Failed to submit order',
        );
      }

      if (!mounted) return;

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            data['message']?.toString() ??
                (widget.existingOrder
                    ? 'Items added to order successfully'
                    : 'Order created successfully'),
          ),
          backgroundColor: Colors.green,
        ),
      );

      Navigator.pop(context);
    } catch (e) {
      if (!mounted) return;

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(e.toString().replaceFirst('Exception: ', '')),
          backgroundColor: Colors.red,
        ),
      );
    } finally {
      if (mounted) {
        setState(() {
          submitting = false;
        });
      }
    }
  }

  Widget productCard(Map<String, dynamic> product) {
    final productId = (product['id'] as num).toInt();

    final name = product['name']?.toString() ?? 'Unknown';

    final stock = (product['stock'] as num?)?.toInt() ?? 0;

    final variants = product['variants'] is List
        ? (product['variants'] as List)
              .map((variant) => Map<String, dynamic>.from(variant))
              .toList()
        : <Map<String, dynamic>>[];
    final selectedVariantId = selectedVariants[productId];
    final selectedVariant = variants.where(
      (variant) => (variant['id'] as num).toInt() == selectedVariantId,
    );
    final variant = selectedVariant.isEmpty ? null : selectedVariant.first;
    final quantity = quantities[quantityKey(productId, selectedVariantId)] ?? 0;
    final price = parseMinorUnits(variant?['price'] ?? product['price']);
    final classification =
        product['classification']?.toString() ??
        (product['isVegetarian'] == true ? 'VEG' : 'NON_VEG');

    final isOutOfStock = stock <= 0;

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    name,
                    style: const TextStyle(
                      fontSize: 17,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  if (product['subcategory'] is String &&
                      (product['subcategory'] as String).isNotEmpty)
                    Text(
                      product['subcategory'] as String,
                      style: TextStyle(color: Colors.grey.shade600),
                    ),
                  Text(
                    '${classification == 'NOT_APPLICABLE'
                        ? 'Not Applicable'
                        : classification == 'VEG'
                        ? 'Vegetarian'
                        : 'Non Vegetarian'}'
                    '${product['isSignature'] == true ? ' · SIGNATURE' : ''}',
                    style: const TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  if (variants.isNotEmpty)
                    DropdownButton<int>(
                      value: selectedVariantId,
                      isExpanded: true,
                      items: variants.map((variant) {
                        final id = (variant['id'] as num).toInt();
                        return DropdownMenuItem<int>(
                          value: id,
                          child: Text(
                            '${variant['name']} · ${formatMinorUnits(parseMinorUnits(variant['price']))}',
                          ),
                        );
                      }).toList(),
                      onChanged: (variantId) {
                        if (variantId == null) return;
                        setState(() {
                          selectedVariants[productId] = variantId;
                        });
                      },
                    ),
                  const SizedBox(height: 5),
                  Text(
                    formatMinorUnits(price),
                    style: TextStyle(fontSize: 15, color: Colors.grey.shade700),
                  ),
                  const SizedBox(height: 3),
                  Text(
                    isOutOfStock ? 'OUT OF STOCK' : 'Stock: $stock',
                    style: TextStyle(
                      fontSize: 10,
                      color: isOutOfStock ? Colors.red : Colors.grey.shade600,
                    ),
                  ),
                ],
              ),
            ),
            Row(
              children: [
                IconButton(
                  onPressed: quantity > 0
                      ? () => decreaseQuantity(productId, selectedVariantId)
                      : null,
                  icon: const Icon(Icons.remove_circle_outline),
                ),
                SizedBox(
                  width: 28,
                  child: Text(
                    '$quantity',
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      fontSize: 17,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
                IconButton(
                  onPressed: isOutOfStock || productQuantity(productId) >= stock
                      ? null
                      : () => increaseQuantity(
                          productId,
                          selectedVariantId,
                          stock,
                        ),
                  icon: const Icon(Icons.add_circle_outline),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  int get orderTotal => widget.existingOrderTotalMinor + selectedTotalMinor;

  @override
  Widget build(BuildContext context) {
    final title = widget.existingOrder ? 'Add More Food' : 'New Order';
    final query = searchController.text.trim().toLowerCase();
    final visibleProducts = products.where((rawProduct) {
      final product = Map<String, dynamic>.from(rawProduct);
      final category = Map<String, dynamic>.from(
        product['category'] as Map? ?? const {},
      );
      if (selectedCategoryId != null &&
          (category['id'] as num?)?.toInt() != selectedCategoryId) {
        return false;
      }
      if (query.isEmpty) return true;
      return [
        product['name']?.toString() ?? '',
        product['subcategory']?.toString() ?? '',
        category['name']?.toString() ?? '',
      ].join(' ').toLowerCase().contains(query);
    }).toList();
    final orderSentToCashier =
        widget.existingOrder && widget.existingOrderStatus != 'CONFIRMED';

    return Scaffold(
      appBar: AppBar(
        title: Text(
          widget.isParcel
              ? 'Parcel - $title'
              : 'Table ${widget.tableNumber} - $title',
          style: const TextStyle(fontWeight: FontWeight.bold),
        ),
      ),
      body: orderSentToCashier
          ? Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(
                      Icons.receipt_long,
                      size: 56,
                      color: Colors.deepOrange,
                    ),
                    const SizedBox(height: 12),
                    Text(
                      'Order #${widget.existingOrderId} sent to cashier',
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      'Order total: ${formatMinorUnits(orderTotal)}',
                      style: const TextStyle(
                        fontSize: 24,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 8),
                    const Text(
                      'This order can no longer be changed. The table will be available after payment.',
                      textAlign: TextAlign.center,
                    ),
                  ],
                ),
              ),
            )
          : loading
          ? const Center(child: CircularProgressIndicator())
          : error != null
          ? Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(error!, textAlign: TextAlign.center),
                  const SizedBox(height: 16),
                  FilledButton(
                    onPressed: loadProducts,
                    child: const Text('RETRY'),
                  ),
                ],
              ),
            )
          : Column(
              children: [
                Expanded(
                  child: RefreshIndicator(
                    onRefresh: loadProducts,
                    child: ListView.builder(
                      padding: const EdgeInsets.all(16),
                      itemCount: visibleProducts.length + 2,
                      itemBuilder: (context, index) {
                        if (index == 0) {
                          return Padding(
                            padding: const EdgeInsets.only(bottom: 12),
                            child: TextField(
                              controller: searchController,
                              onChanged: (_) => setState(() {}),
                              decoration: const InputDecoration(
                                labelText: 'Search menu',
                                prefixIcon: Icon(Icons.search),
                                border: OutlineInputBorder(),
                              ),
                            ),
                          );
                        }
                        if (index == 1) {
                          return SizedBox(
                            height: 48,
                            child: ListView(
                              scrollDirection: Axis.horizontal,
                              children: [
                                Padding(
                                  padding: const EdgeInsets.only(right: 8),
                                  child: ChoiceChip(
                                    label: const Text('All'),
                                    selected: selectedCategoryId == null,
                                    onSelected: (_) => setState(
                                      () => selectedCategoryId = null,
                                    ),
                                  ),
                                ),
                                ...categories.map((rawCategory) {
                                  final category = Map<String, dynamic>.from(
                                    rawCategory,
                                  );
                                  final id = (category['id'] as num).toInt();
                                  return Padding(
                                    padding: const EdgeInsets.only(right: 8),
                                    child: ChoiceChip(
                                      label: Text(category['name'].toString()),
                                      selected: selectedCategoryId == id,
                                      onSelected: (_) => setState(
                                        () => selectedCategoryId = id,
                                      ),
                                    ),
                                  );
                                }),
                              ],
                            ),
                          );
                        }
                        if (visibleProducts.isEmpty) {
                          return const Padding(
                            padding: EdgeInsets.all(24),
                            child: Center(
                              child: Text('No menu items match this filter'),
                            ),
                          );
                        }
                        return productCard(
                          Map<String, dynamic>.from(visibleProducts[index - 2]),
                        );
                      },
                    ),
                  ),
                ),
              ],
            ),
      bottomNavigationBar: orderSentToCashier
          ? null
          : SafeArea(
              child: Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: Theme.of(context).colorScheme.surface,
                  boxShadow: const [
                    BoxShadow(blurRadius: 8, offset: Offset(0, -2)),
                  ],
                ),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            widget.existingOrder ? 'ORDER TOTAL' : 'TOTAL',
                            style: const TextStyle(fontSize: 12),
                          ),
                          Text(
                            formatMinorUnits(orderTotal),
                            style: const TextStyle(
                              fontSize: 22,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ],
                      ),
                    ),
                    if (widget.existingOrder)
                      Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          FilledButton(
                            onPressed: submitting || sendingToCashier
                                ? null
                                : submitOrder,
                            child: const Text('ADD FOOD'),
                          ),
                          const SizedBox(height: 6),
                          OutlinedButton(
                            onPressed: submitting || sendingToCashier
                                ? null
                                : sendToCashier,
                            child: sendingToCashier
                                ? const SizedBox(
                                    width: 18,
                                    height: 18,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                    ),
                                  )
                                : const Text('SEND TO CASHIER'),
                          ),
                        ],
                      )
                    else
                      FilledButton.icon(
                        onPressed: submitting ? null : submitOrder,
                        icon: submitting
                            ? const SizedBox(
                                width: 18,
                                height: 18,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                  color: Colors.white,
                                ),
                              )
                            : const Icon(Icons.check),
                        label: const Text('CONFIRM ORDER'),
                      ),
                  ],
                ),
              ),
            ),
    );
  }
}
