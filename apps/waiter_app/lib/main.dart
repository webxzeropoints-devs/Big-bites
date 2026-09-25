import 'package:flutter/material.dart';

import 'services/api_service.dart';

void main() {
  runApp(const HotelPOSApp());
}

class HotelPOSApp extends StatelessWidget {
  const HotelPOSApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'BIG BITES',
      theme: ThemeData(
        primarySwatch: Colors.blue,
        scaffoldBackgroundColor: Colors.white,
      ),
      home: const LoginScreen(),
    );
  }
}

// ==================== LOGIN SCREEN ====================

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final usernameController = TextEditingController();
  final passwordController = TextEditingController();

  bool loading = false;
  String errorMessage = '';

  Future<void> login() async {
    setState(() {
      loading = true;
      errorMessage = '';
    });

    try {
      final result = await ApiService.login(
        usernameController.text.trim(),
        passwordController.text,
      );

      if (!mounted) return;

      final data = result['data'];

      if (data == null || data['user'] == null) {
        setState(() {
          errorMessage = 'Invalid login response.';
        });
        return;
      }

      final user = Map<String, dynamic>.from(data['user']);

      if (user['role'] == 'WAITER') {
        Navigator.pushReplacement(
          context,
          MaterialPageRoute(
            builder: (context) =>
                HomeScreen(user: user, token: data['token']?.toString() ?? ''),
          ),
        );
      } else {
        setState(() {
          errorMessage = 'Only waiter accounts can login here.';
        });
      }
    } catch (e) {
      if (!mounted) return;

      setState(() {
        final message = e.toString().replaceFirst('Exception: ', '');
        errorMessage = message == 'Failed host lookup: 10.0.2.2'
            ? 'Cannot reach the backend. Start the server and check the emulator connection.'
            : message;
      });
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
      appBar: AppBar(title: const Text('BIG BITES')),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Text(
              'Waiter Login',
              style: TextStyle(fontSize: 28, fontWeight: FontWeight.bold),
            ),

            const SizedBox(height: 30),

            TextField(
              controller: usernameController,
              decoration: const InputDecoration(
                labelText: 'Username',
                border: OutlineInputBorder(),
              ),
            ),

            const SizedBox(height: 16),

            TextField(
              controller: passwordController,
              obscureText: true,
              decoration: const InputDecoration(
                labelText: 'Password',
                border: OutlineInputBorder(),
              ),
            ),

            const SizedBox(height: 20),

            if (errorMessage.isNotEmpty)
              Text(errorMessage, style: const TextStyle(color: Colors.red)),

            const SizedBox(height: 10),

            SizedBox(
              width: double.infinity,
              height: 50,
              child: ElevatedButton(
                onPressed: loading ? null : login,
                child: loading
                    ? const CircularProgressIndicator()
                    : const Text('LOGIN', style: TextStyle(fontSize: 18)),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ==================== TABLE SCREEN ====================

class HomeScreen extends StatefulWidget {
  final Map<String, dynamic> user;
  final String token;

  const HomeScreen({super.key, required this.user, required this.token});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  List<dynamic> tables = [];
  bool loading = true;
  String errorMessage = '';

  @override
  void initState() {
    super.initState();
    loadTables();
  }

  Future<void> loadTables() async {
    setState(() {
      loading = true;
      errorMessage = '';
    });

    try {
      final result = await ApiService.getTables();

      if (!mounted) return;

      setState(() {
        tables = result;
        loading = false;
      });
    } catch (e) {
      if (!mounted) return;

      setState(() {
        loading = false;
        errorMessage = 'Unable to load tables.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Waiter Dashboard'),
        actions: [
          IconButton(onPressed: loadTables, icon: const Icon(Icons.refresh)),
        ],
      ),
      body: loading
          ? const Center(child: CircularProgressIndicator())
          : errorMessage.isNotEmpty
          ? Center(
              child: Text(
                errorMessage,
                style: const TextStyle(color: Colors.red, fontSize: 18),
              ),
            )
          : Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Welcome, ${widget.user['name'] ?? 'Waiter'}',
                    style: const TextStyle(
                      fontSize: 22,
                      fontWeight: FontWeight.bold,
                    ),
                  ),

                  const SizedBox(height: 5),

                  Text(
                    'Waiter ID: ${widget.user['id'] ?? '-'}',
                    style: const TextStyle(fontSize: 16),
                  ),

                  const SizedBox(height: 25),

                  const Text(
                    'Select Table',
                    style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
                  ),

                  const SizedBox(height: 15),

                  Expanded(
                    child: GridView.builder(
                      itemCount: tables.length,
                      gridDelegate:
                          const SliverGridDelegateWithFixedCrossAxisCount(
                            crossAxisCount: 2,
                            crossAxisSpacing: 15,
                            mainAxisSpacing: 15,
                            childAspectRatio: 1.2,
                          ),
                      itemBuilder: (context, index) {
                        final table = tables[index];

                        final int tableId = table['id'];

                        final String status = table['status'].toString();

                        final bool available = status == 'AVAILABLE';
                        final bool isParcel = table['isParcel'] == true;

                        return InkWell(
                          onTap: available
                              ? () async {
                                  await Navigator.push(
                                    context,
                                    MaterialPageRoute(
                                      builder: (context) => MenuScreen(
                                        tableId: tableId,
                                        waiterId: widget.user['id'],
                                        token: widget.token,
                                        isParcel: isParcel,
                                      ),
                                    ),
                                  );

                                  if (mounted) {
                                    await loadTables();
                                  }
                                }
                              : null,
                          borderRadius: BorderRadius.circular(16),
                          child: Container(
                            decoration: BoxDecoration(
                              borderRadius: BorderRadius.circular(16),
                              color: available
                                  ? Colors.green.withValues(alpha: 0.08)
                                  : Colors.red.withValues(alpha: 0.12),
                              border: Border.all(
                                width: 2,
                                color: available ? Colors.green : Colors.red,
                              ),
                            ),
                            child: Column(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                Icon(
                                  isParcel
                                      ? Icons.shopping_bag
                                      : Icons.table_restaurant,
                                  size: 45,
                                  color: available ? Colors.green : Colors.red,
                                ),

                                const SizedBox(height: 10),

                                Text(
                                  isParcel
                                      ? 'Parcel'
                                      : 'Table ${table['number']}',
                                  style: const TextStyle(
                                    fontSize: 22,
                                    fontWeight: FontWeight.bold,
                                  ),
                                ),

                                const SizedBox(height: 5),

                                Text(
                                  status,
                                  style: TextStyle(
                                    fontSize: 16,
                                    fontWeight: FontWeight.bold,
                                    color: available
                                        ? Colors.green
                                        : Colors.red,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        );
                      },
                    ),
                  ),
                ],
              ),
            ),
    );
  }
}

// ==================== MENU SCREEN ====================

class MenuScreen extends StatefulWidget {
  final int tableId;
  final int waiterId;
  final String token;
  final bool isParcel;

  const MenuScreen({
    super.key,
    required this.tableId,
    required this.waiterId,
    required this.token,
    required this.isParcel,
  });

  @override
  State<MenuScreen> createState() => _MenuScreenState();
}

class _MenuScreenState extends State<MenuScreen> {
  List<dynamic> products = [];

  // Product ID -> quantity
  final Map<int, int> quantities = {};

  bool loading = true;
  bool ordering = false;
  String errorMessage = '';

  @override
  void initState() {
    super.initState();
    loadProducts();
  }

  Future<void> loadProducts() async {
    try {
      final result = await ApiService.getProducts();

      if (!mounted) return;

      setState(() {
        products = result;
        loading = false;
      });
    } catch (e) {
      if (!mounted) return;

      setState(() {
        loading = false;
        errorMessage = 'Unable to load menu.';
      });
    }
  }

  void increaseQuantity(int productId) {
    setState(() {
      quantities[productId] = (quantities[productId] ?? 0) + 1;
    });
  }

  void decreaseQuantity(int productId) {
    setState(() {
      final current = quantities[productId] ?? 0;

      if (current > 0) {
        quantities[productId] = current - 1;
      }
    });
  }

  double get total {
    double amount = 0;

    for (final product in products) {
      final int id = product['id'];
      final int quantity = quantities[id] ?? 0;
      final double price = double.parse(product['price'].toString());

      amount += price * quantity;
    }

    return amount;
  }

  int get selectedItemCount {
    int count = 0;

    quantities.forEach((key, value) {
      count += value;
    });

    return count;
  }

  Future<void> confirmOrder() async {
    if (selectedItemCount == 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please select at least one item.')),
      );
      return;
    }

    setState(() {
      ordering = true;
    });

    final List<Map<String, dynamic>> items = [];

    quantities.forEach((productId, quantity) {
      if (quantity > 0) {
        items.add({'productId': productId, 'quantity': quantity});
      }
    });

    try {
      final result = await ApiService.createOrder(
        tableId: widget.tableId,
        waiterId: widget.waiterId,
        items: items,
        token: widget.token,
      );

      if (!mounted) return;

      final statusCode = result['statusCode'];

      if (statusCode >= 200 && statusCode < 300) {
        showDialog(
          context: context,
          barrierDismissible: false,
          builder: (context) {
            return AlertDialog(
              title: const Text('Order Confirmed'),
              content: Text(
                '${widget.isParcel ? 'Parcel' : 'Table ${widget.tableId}'}\n'
                'Items: $selectedItemCount\n'
                'Total: ₹${total.toStringAsFixed(0)}',
              ),
              actions: [
                TextButton(
                  onPressed: () {
                    Navigator.pop(context);
                    Navigator.pop(context);
                  },
                  child: const Text('DONE'),
                ),
              ],
            );
          },
        );
      } else {
        final data = result['data'];

        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(data?['message'] ?? 'Order failed.')),
        );
      }
    } catch (e) {
      if (!mounted) return;

      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Unable to create order.')));
    } finally {
      if (mounted) {
        setState(() {
          ordering = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(
          '${widget.isParcel ? 'Parcel' : 'Table ${widget.tableId}'} - Menu',
        ),
      ),

      body: loading
          ? const Center(child: CircularProgressIndicator())
          : errorMessage.isNotEmpty
          ? Center(
              child: Text(
                errorMessage,
                style: const TextStyle(color: Colors.red, fontSize: 18),
              ),
            )
          : Column(
              children: [
                Expanded(
                  child: ListView.builder(
                    padding: const EdgeInsets.all(12),
                    itemCount: products.length,
                    itemBuilder: (context, index) {
                      final product = products[index];

                      final int productId = product['id'];

                      final String name = product['name'].toString();

                      final double price = double.parse(
                        product['price'].toString(),
                      );

                      final int stock =
                          int.tryParse(product['stock'].toString()) ?? 0;

                      final int quantity = quantities[productId] ?? 0;

                      return Card(
                        margin: const EdgeInsets.only(bottom: 10),
                        child: Padding(
                          padding: const EdgeInsets.all(12),
                          child: Row(
                            children: [
                              const CircleAvatar(
                                radius: 25,
                                child: Icon(Icons.restaurant),
                              ),

                              const SizedBox(width: 12),

                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      name,
                                      style: const TextStyle(
                                        fontSize: 18,
                                        fontWeight: FontWeight.bold,
                                      ),
                                    ),

                                    const SizedBox(height: 4),

                                    Text(
                                      '₹${price.toStringAsFixed(0)}',
                                      style: const TextStyle(fontSize: 16),
                                    ),

                                    Text(
                                      'Stock: $stock',
                                      style: TextStyle(
                                        color: stock > 0
                                            ? Colors.green
                                            : Colors.red,
                                      ),
                                    ),
                                  ],
                                ),
                              ),

                              Row(
                                children: [
                                  IconButton(
                                    onPressed: quantity > 0
                                        ? () => decreaseQuantity(productId)
                                        : null,
                                    icon: const Icon(Icons.remove_circle),
                                  ),

                                  Text(
                                    '$quantity',
                                    style: const TextStyle(
                                      fontSize: 18,
                                      fontWeight: FontWeight.bold,
                                    ),
                                  ),

                                  IconButton(
                                    onPressed: quantity < stock
                                        ? () => increaseQuantity(productId)
                                        : null,
                                    icon: const Icon(Icons.add_circle),
                                  ),
                                ],
                              ),
                            ],
                          ),
                        ),
                      );
                    },
                  ),
                ),

                // ==================== CART SUMMARY ====================
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    border: Border(
                      top: BorderSide(color: Colors.grey.shade300),
                    ),
                  ),
                  child: Column(
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text(
                            '$selectedItemCount items',
                            style: const TextStyle(fontSize: 17),
                          ),

                          Text(
                            'Total: ₹${total.toStringAsFixed(0)}',
                            style: const TextStyle(
                              fontSize: 22,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ],
                      ),

                      const SizedBox(height: 12),

                      SizedBox(
                        width: double.infinity,
                        height: 50,
                        child: ElevatedButton(
                          onPressed: ordering ? null : confirmOrder,
                          child: ordering
                              ? const CircularProgressIndicator()
                              : const Text(
                                  'CONFIRM ORDER',
                                  style: TextStyle(
                                    fontSize: 18,
                                    fontWeight: FontWeight.bold,
                                  ),
                                ),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
    );
  }
}
