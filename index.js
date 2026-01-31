// server.js - Complete Backend with All Features (Including Old Endpoints)
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const midtransClient = require('midtrans-client');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// ============================================
// DATABASE CONNECTION
// ============================================
const pool = new Pool({
  host: process.env.DB_HOST || 'aws-1-ap-northeast-1.pooler.supabase.com',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'postgres',
  user: process.env.DB_USER || 'postgres.nzvkyxpgsegkpewhyqlc',
  pool_mode: 'session',
  password: process.env.DB_PASSWORD || 'PantangMenyerah123!',
});

pool.on('connect', () => {
  console.log('✅ Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('❌ Database error:', err);
});

// ============================================
// MIDDLEWARE
// ============================================
app.use(cors({
  origin: '*',
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// ============================================
// MIDTRANS CONFIGURATION
// ============================================
const snap = new midtransClient.Snap({
  isProduction: false,
  serverKey: process.env.MIDTRANS_SERVER_KEY || "Mid-server-nHcYPGzkb7oSKj1ObOJEqaFw",
  clientKey: process.env.MIDTRANS_CLIENT_KEY || "Mid-client-L-Vxrb7krYz-UD-w"
});

console.log(`✅ Midtrans configured in ${snap.isProduction ? 'PRODUCTION' : 'SANDBOX'} mode`);

// Store untuk menyimpan status transaksi sementara (untuk backward compatibility)
const transactionStore = new Map();

// ============================================
// AUTHENTICATION MIDDLEWARE
// ============================================
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Access token required'
    });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({
        success: false,
        message: 'Invalid or expired token'
      });
    }
    req.user = user;
    next();
  });
};

// ============================================
// 1. AUTH ENDPOINTS (Login/Register)
// ============================================

// Register new user
app.post('/api/auth/register', async (req, res) => {
  const client = await pool.connect();
  try {
    const { name, email, password, phone } = req.body;

    // Validasi input
    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Name, email, and password are required'
      });
    }

    // Cek apakah email sudah terdaftar
    const checkEmail = await client.query(
      'SELECT id FROM users WHERE email = $1',
      [email]
    );

    if (checkEmail.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Email already registered'
      });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Begin transaction
    await client.query('BEGIN');

    // Insert user
    const userResult = await client.query(
      `INSERT INTO users (name, email, password_hash, phone) 
       VALUES ($1, $2, $3, $4) 
       RETURNING id, name, email, phone, created_at`,
      [name, email, passwordHash, phone]
    );

    const newUser = userResult.rows[0];

    // Create wallet for user
    await client.query(
      'INSERT INTO wallets (user_id, balance) VALUES ($1, 0)',
      [newUser.id]
    );

    await client.query('COMMIT');

    // Generate JWT token
    const token = jwt.sign(
      { userId: newUser.id, email: newUser.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: {
        user: {
          id: newUser.id,
          name: newUser.name,
          email: newUser.email,
          phone: newUser.phone,
          createdAt: newUser.created_at
        },
        token
      }
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Register error:', error);
    res.status(500).json({
      success: false,
      message: 'Registration failed',
      error: error.message
    });
  } finally {
    client.release();
  }
});

// Login user
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }

    // Get user by email
    const result = await pool.query(
      'SELECT id, name, email, password_hash, phone FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    const user = result.rows[0];

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password_hash);

    if (!validPassword) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone
        },
        token
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Login failed',
      error: error.message
    });
  }
});

// Get user profile
app.get('/api/auth/profile', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.name, u.email, u.phone, u.created_at,
              w.balance as wallet_balance
       FROM users u
       LEFT JOIN wallets w ON u.id = w.user_id
       WHERE u.id = $1`,
      [req.user.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      data: result.rows[0]
    });

  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get profile',
      error: error.message
    });
  }
});

// ============================================
// 2. STORE ENDPOINTS
// ============================================

// Create store
app.post('/api/stores', authenticateToken, async (req, res) => {
  try {
    const { store_name, description, address, logo_url } = req.body;
    const userId = req.user.userId;

    if (!store_name) {
      return res.status(400).json({
        success: false,
        message: 'Store name is required'
      });
    }

    const result = await pool.query(
      `INSERT INTO stores (user_id, store_name, description, address, logo_url)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [userId, store_name, description, address, logo_url]
    );

    res.status(201).json({
      success: true,
      message: 'Store created successfully',
      data: result.rows[0]
    });

  } catch (error) {
    console.error('Create store error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create store',
      error: error.message
    });
  }
});

// Get user stores
app.get('/api/stores', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM stores WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.userId]
    );

    res.json({
      success: true,
      data: result.rows
    });

  } catch (error) {
    console.error('Get stores error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get stores',
      error: error.message
    });
  }
});

// Get store by ID
app.get('/api/stores/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'SELECT * FROM stores WHERE id = $1 AND user_id = $2',
      [id, req.user.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Store not found'
      });
    }

    res.json({
      success: true,
      data: result.rows[0]
    });

  } catch (error) {
    console.error('Get store error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get store',
      error: error.message
    });
  }
});

// Update store
app.put('/api/stores/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { store_name, description, address, logo_url } = req.body;

    const result = await pool.query(
      `UPDATE stores 
       SET store_name = COALESCE($1, store_name),
           description = COALESCE($2, description),
           address = COALESCE($3, address),
           logo_url = COALESCE($4, logo_url),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $5 AND user_id = $6
       RETURNING *`,
      [store_name, description, address, logo_url, id, req.user.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Store not found'
      });
    }

    res.json({
      success: true,
      message: 'Store updated successfully',
      data: result.rows[0]
    });

  } catch (error) {
    console.error('Update store error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update store',
      error: error.message
    });
  }
});

// Delete store
app.delete('/api/stores/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'DELETE FROM stores WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, req.user.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Store not found'
      });
    }

    res.json({
      success: true,
      message: 'Store deleted successfully'
    });

  } catch (error) {
    console.error('Delete store error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete store',
      error: error.message
    });
  }
});

// ============================================
// 3. PRODUCT ENDPOINTS
// ============================================

// Create product
app.post('/api/products', authenticateToken, async (req, res) => {
  try {
    const { store_id, name, description, price, stock, is_active } = req.body;

    if (!store_id || !name || !price) {
      return res.status(400).json({
        success: false,
        message: 'Store ID, name, and price are required'
      });
    }

    // Verify store ownership
    const storeCheck = await pool.query(
      'SELECT id FROM stores WHERE id = $1 AND user_id = $2',
      [store_id, req.user.userId]
    );

    if (storeCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'Store not found or access denied'
      });
    }

    const result = await pool.query(
      `INSERT INTO products (store_id, name, description, price, stock, is_active)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [store_id, name, description, price, stock || 0, is_active !== false]
    );

    res.status(201).json({
      success: true,
      message: 'Product created successfully',
      data: result.rows[0]
    });

  } catch (error) {
    console.error('Create product error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create product',
      error: error.message
    });
  }
});

// Get products by store
app.get('/api/stores/:storeId/products', authenticateToken, async (req, res) => {
  try {
    const { storeId } = req.params;

    // Verify store ownership
    const storeCheck = await pool.query(
      'SELECT id FROM stores WHERE id = $1 AND user_id = $2',
      [storeId, req.user.userId]
    );

    if (storeCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'Store not found or access denied'
      });
    }

    const result = await pool.query(
      'SELECT * FROM products WHERE store_id = $1 ORDER BY created_at DESC',
      [storeId]
    );

    res.json({
      success: true,
      data: result.rows
    });

  } catch (error) {
    console.error('Get products error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get products',
      error: error.message
    });
  }
});

// Get product by ID
app.get('/api/products/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT p.*, s.user_id 
       FROM products p
       JOIN stores s ON p.store_id = s.id
       WHERE p.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    const product = result.rows[0];

    if (product.user_id !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    delete product.user_id;

    res.json({
      success: true,
      data: product
    });

  } catch (error) {
    console.error('Get product error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get product',
      error: error.message
    });
  }
});

// Update product
app.put('/api/products/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, price, stock, is_active } = req.body;

    // Verify ownership
    const ownerCheck = await pool.query(
      `SELECT p.id FROM products p
       JOIN stores s ON p.store_id = s.id
       WHERE p.id = $1 AND s.user_id = $2`,
      [id, req.user.userId]
    );

    if (ownerCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'Product not found or access denied'
      });
    }

    const result = await pool.query(
      `UPDATE products 
       SET name = COALESCE($1, name),
           description = COALESCE($2, description),
           price = COALESCE($3, price),
           stock = COALESCE($4, stock),
           is_active = COALESCE($5, is_active),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $6
       RETURNING *`,
      [name, description, price, stock, is_active, id]
    );

    res.json({
      success: true,
      message: 'Product updated successfully',
      data: result.rows[0]
    });

  } catch (error) {
    console.error('Update product error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update product',
      error: error.message
    });
  }
});

// Delete product
app.delete('/api/products/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Verify ownership
    const ownerCheck = await pool.query(
      `SELECT p.id FROM products p
       JOIN stores s ON p.store_id = s.id
       WHERE p.id = $1 AND s.user_id = $2`,
      [id, req.user.userId]
    );

    if (ownerCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'Product not found or access denied'
      });
    }

    await pool.query('DELETE FROM products WHERE id = $1', [id]);

    res.json({
      success: true,
      message: 'Product deleted successfully'
    });

  } catch (error) {
    console.error('Delete product error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete product',
      error: error.message
    });
  }
});

// ============================================
// 4. OLD MIDTRANS ENDPOINTS (Backward Compatibility)
// ============================================

// OLD ENDPOINT: Tokenizer (untuk kompatibilitas dengan kode lama)
app.post('/api/tokenizer', async (req, res) => {
  try {
    const { orderId, amount, customerName, customerEmail, customerPhone, items, discount } = req.body;

    console.log('Received transaction request (OLD API):', {
      orderId,
      amount,
      customerName,
      items: items?.length || 0,
      discount
    });

    // Validasi input
    if (!orderId || !amount || !customerName || !customerEmail || !items || items.length === 0) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'orderId, amount, customerName, customerEmail, and items are required'
      });
    }

    // Format item_details untuk Midtrans
    const itemDetails = items.map(item => ({
      id: item.id,
      price: item.price,
      quantity: item.quantity,
      name: item.productName
    }));

    // Tambahkan diskon sebagai item jika ada
    if (discount && discount > 0) {
      itemDetails.push({
        id: 'DISCOUNT',
        price: -discount,
        quantity: 1,
        name: 'Diskon Kupon'
      });
    }

    // Parameter transaksi dengan callback URLs yang mengarah ke backend
    const parameter = {
      transaction_details: {
        order_id: orderId,
        gross_amount: amount
      },
      credit_card: {
        secure: true
      },
      customer_details: {
        first_name: customerName,
        email: customerEmail,
        phone: customerPhone
      },
      item_details: itemDetails,
      callbacks: {
        finish: `http://192.168.100.15:${PORT}/api/payment/finish?order_id=${orderId}`,
        error: `http://192.168.100.15:${PORT}/api/payment/error?order_id=${orderId}`,
        pending: `http://192.168.100.15:${PORT}/api/payment/pending?order_id=${orderId}`
      }
    };

    console.log('Creating Midtrans transaction with params:', JSON.stringify(parameter, null, 2));

    // Buat transaksi menggunakan Midtrans Snap API
    const transaction = await snap.createTransaction(parameter);

    console.log('Transaction created successfully:', {
      token: transaction.token?.substring(0, 20) + '...',
      redirect_url: transaction.redirect_url
    });

    // Simpan ke store untuk backward compatibility
    transactionStore.set(orderId, {
      amount,
      customerName,
      createdAt: new Date(),
      status: 'pending'
    });

    // Return token dan redirect_url ke frontend
    res.json({
      success: true,
      token: transaction.token,
      redirect_url: transaction.redirect_url,
      order_id: orderId
    });

  } catch (error) {
    console.error('Error creating Midtrans transaction:', error);

    res.status(500).json({
      success: false,
      error: 'Failed to create transaction',
      message: error.message || 'Internal server error',
      details: error.ApiResponse?.error_messages || []
    });
  }
});

// OLD ENDPOINT: Transaction Create (untuk kompatibilitas dengan kode lama)
app.post('/api/transaction/create', async (req, res) => {
  try {
    const {
      orderId,
      amount,
      customerName,
      customerEmail,
      customerPhone,
      items,
      discount = 0
    } = req.body;

    console.log('=== CREATE TRANSACTION REQUEST (OLD API) ===');
    console.log('Order ID:', orderId);
    console.log('Amount:', amount);
    console.log('Items:', items?.length || 0);

    // Validasi input
    if (!orderId || !amount || !customerName || !customerEmail || !items || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid transaction data'
      });
    }

    // Mapping item_details
    const itemDetails = items.map(item => ({
      id: item.id,
      name: item.productName,
      price: item.price,
      quantity: item.quantity
    }));

    // Tambahkan diskon jika ada
    if (discount > 0) {
      itemDetails.push({
        id: 'DISCOUNT',
        name: 'Diskon',
        price: -discount,
        quantity: 1
      });
    }

    // Payload Midtrans dengan callback URLs yang benar
    const parameter = {
      transaction_details: {
        order_id: orderId,
        gross_amount: amount
      },
      customer_details: {
        first_name: customerName,
        email: customerEmail,
        phone: customerPhone
      },
      item_details: itemDetails,
      credit_card: {
        secure: true
      },
      callbacks: {
        finish: `http://192.168.100.15:${PORT}/api/payment/finish?order_id=${orderId}`,
        error: `http://192.168.100.15:${PORT}/api/payment/error?order_id=${orderId}`,
        pending: `http://192.168.100.15:${PORT}/api/payment/pending?order_id=${orderId}`
      }
    };

    console.log('Creating transaction with callbacks:', parameter.callbacks);

    // Create transaction ke Midtrans
    const transaction = await snap.createTransaction(parameter);

    console.log('✅ Transaction created successfully');
    console.log('Snap Token:', transaction.token?.substring(0, 20) + '...');

    // Simpan info transaksi sementara
    transactionStore.set(orderId, {
      amount,
      customerName,
      createdAt: new Date(),
      status: 'pending'
    });

    return res.status(201).json({
      success: true,
      message: 'Transaction created',
      data: {
        orderId,
        snapToken: transaction.token,
        redirectUrl: transaction.redirect_url
      }
    });

  } catch (error) {
    console.error('❌ Create transaction error:', error);

    return res.status(500).json({
      success: false,
      message: 'Failed to create transaction',
      error: error.message
    });
  }
});

// ============================================
// 5. NEW ORDER & PAYMENT ENDPOINTS (With Database)
// ============================================

// Create order and get Snap token (NEW - with database)
app.post('/api/orders/create', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const {
      store_id,
      items,
      customer_name,
      customer_email,
      customer_phone,
      discount = 0
    } = req.body;

    // Validasi
    if (!store_id || !items || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Store ID and items are required'
      });
    }

    // Verify store ownership
    const storeCheck = await client.query(
      'SELECT id FROM stores WHERE id = $1 AND user_id = $2',
      [store_id, req.user.userId]
    );

    if (storeCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'Store not found or access denied'
      });
    }

    await client.query('BEGIN');

    // Calculate total
    let totalAmount = 0;
    const orderItems = [];

    for (const item of items) {
      const productResult = await client.query(
        'SELECT id, name, price, stock FROM products WHERE id = $1 AND store_id = $2',
        [item.product_id, store_id]
      );

      if (productResult.rows.length === 0) {
        throw new Error(`Product ${item.product_id} not found`);
      }

      const product = productResult.rows[0];

      if (product.stock < item.quantity) {
        throw new Error(`Insufficient stock for ${product.name}`);
      }

      const itemTotal = product.price * item.quantity;
      totalAmount += itemTotal;

      orderItems.push({
        product_id: product.id,
        quantity: item.quantity,
        price: product.price,
        productName: product.name
      });

      // Update stock
      await client.query(
        'UPDATE products SET stock = stock - $1 WHERE id = $2',
        [item.quantity, product.id]
      );
    }

    // Apply discount
    totalAmount -= discount;

    // Generate unique order ID
    const orderId = `ORD-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

    // Create order in database
    const orderResult = await client.query(
      `INSERT INTO orders (store_id, total_amount, payment_status, midtrans_order_id)
       VALUES ($1, $2, 'pending', $3)
       RETURNING *`,
      [store_id, totalAmount, orderId]
    );

    const order = orderResult.rows[0];

    // Insert order items
    for (const item of orderItems) {
      await client.query(
        'INSERT INTO order_items (order_id, product_id, quantity, price) VALUES ($1, $2, $3, $4)',
        [order.id, item.product_id, item.quantity, item.price]
      );
    }

    // Prepare Midtrans parameters
    const itemDetails = orderItems.map(item => ({
      id: item.product_id,
      price: item.price,
      quantity: item.quantity,
      name: item.productName
    }));

    if (discount > 0) {
      itemDetails.push({
        id: 'DISCOUNT',
        price: -discount,
        quantity: 1,
        name: 'Discount'
      });
    }

    const midtransParams = {
      transaction_details: {
        order_id: orderId,
        gross_amount: totalAmount
      },
      credit_card: {
        secure: true
      },
      customer_details: {
        first_name: customer_name || 'Customer',
        email: customer_email || 'customer@example.com',
        phone: customer_phone || '08123456789'
      },
      item_details: itemDetails,
      callbacks: {
        finish: `http://192.168.100.15:${PORT}/api/payment/finish?order_id=${orderId}`,
        error: `http://192.168.100.15:${PORT}/api/payment/error?order_id=${orderId}`,
        pending: `http://192.168.100.15:${PORT}/api/payment/pending?order_id=${orderId}`
      }
    };

    // Create Midtrans transaction
    const transaction = await snap.createTransaction(midtransParams);

    await client.query('COMMIT');

    res.status(201).json({
      success: true,
      message: 'Order created successfully',
      data: {
        order_id: order.id,
        midtrans_order_id: orderId,
        total_amount: totalAmount,
        snap_token: transaction.token,
        redirect_url: transaction.redirect_url
      }
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Create order error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create order',
      error: error.message
    });
  } finally {
    client.release();
  }
});

// Get orders by store
app.get('/api/stores/:storeId/orders', authenticateToken, async (req, res) => {
  try {
    const { storeId } = req.params;

    // Verify store ownership
    const storeCheck = await pool.query(
      'SELECT id FROM stores WHERE id = $1 AND user_id = $2',
      [storeId, req.user.userId]
    );

    if (storeCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'Store not found or access denied'
      });
    }

    const result = await pool.query(
      `SELECT o.*, 
              COUNT(oi.id) as total_items
       FROM orders o
       LEFT JOIN order_items oi ON o.id = oi.order_id
       WHERE o.store_id = $1
       GROUP BY o.id
       ORDER BY o.created_at DESC`,
      [storeId]
    );

    res.json({
      success: true,
      data: result.rows
    });

  } catch (error) {
    console.error('Get orders error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get orders',
      error: error.message
    });
  }
});

// Get order details
app.get('/api/orders/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const orderResult = await pool.query(
      `SELECT o.*, s.user_id, s.store_name
       FROM orders o
       JOIN stores s ON o.store_id = s.id
       WHERE o.id = $1`,
      [id]
    );

    if (orderResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    const order = orderResult.rows[0];

    if (order.user_id !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Get order items
    const itemsResult = await pool.query(
      `SELECT oi.*, p.name as product_name
       FROM order_items oi
       JOIN products p ON oi.product_id = p.id
       WHERE oi.order_id = $1`,
      [id]
    );

    order.items = itemsResult.rows;
    delete order.user_id;

    res.json({
      success: true,
      data: order
    });

  } catch (error) {
    console.error('Get order error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get order',
      error: error.message
    });
  }
});

// ============================================
// 6. PAYMENT CALLBACK ENDPOINTS
// ============================================

// Callback: Payment Finished (Success)
app.get('/api/payment/finish', async (req, res) => {
  const { order_id, transaction_status, status_code } = req.query;

  console.log('🎉 Payment FINISH callback received');
  console.log('Order ID:', order_id);
  console.log('Transaction Status:', transaction_status);
  console.log('Status Code:', status_code);

  try {
    // Update order status in database
    await pool.query(
      `UPDATE orders 
       SET payment_status = 'paid'
       WHERE midtrans_order_id = $1`,
      [order_id]
    );

    // Get order details untuk activity log
    const orderResult = await pool.query(
      `SELECT o.id, o.total_amount, s.user_id
       FROM orders o
       JOIN stores s ON o.store_id = s.id
       WHERE o.midtrans_order_id = $1`,
      [order_id]
    );

    if (orderResult.rows.length > 0) {
      const order = orderResult.rows[0];

      // Record financial record
      await pool.query(
        `INSERT INTO financial_records (user_id, type, amount, description, reference_id)
         VALUES ($1, 'income', $2, $3, $4)`,
        [order.user_id, order.total_amount, `Payment for order ${order_id}`, order.id]
      );

      // Log activity
      await pool.query(
        `INSERT INTO activity_logs (user_id, activity_type, amount, description)
         VALUES ($1, 'payment', $2, $3)`,
        [order.user_id, order.total_amount, `Payment received for order ${order_id}`]
      );
    }

    // Update status di store (backward compatibility)
    if (order_id && transactionStore.has(order_id)) {
      const txData = transactionStore.get(order_id);
      txData.status = 'success';
      txData.completedAt = new Date();
      transactionStore.set(order_id, txData);
    }

  } catch (error) {
    console.error('Error updating payment status:', error);
  }

  // Return HTML yang akan di-detect oleh WebView
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Payment Success</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 100vh;
          margin: 0;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        }
        .container {
          background: white;
          padding: 40px;
          border-radius: 20px;
          box-shadow: 0 20px 60px rgba(0,0,0,0.3);
          text-align: center;
          max-width: 400px;
        }
        .success-icon {
          width: 80px;
          height: 80px;
          background: #10B981;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 20px;
        }
        .checkmark {
          width: 40px;
          height: 40px;
          border: 4px solid white;
          border-radius: 50%;
          position: relative;
        }
        .checkmark:after {
          content: '';
          position: absolute;
          left: 8px;
          top: 12px;
          width: 10px;
          height: 18px;
          border: solid white;
          border-width: 0 4px 4px 0;
          transform: rotate(45deg);
        }
        h1 {
          color: #10B981;
          margin: 0 0 10px 0;
          font-size: 28px;
        }
        p {
          color: #6B7280;
          margin: 10px 0;
          font-size: 16px;
        }
        .order-id {
          background: #F3F4F6;
          padding: 10px;
          border-radius: 8px;
          font-family: monospace;
          margin: 20px 0;
          color: #374151;
        }
        .loading {
          margin-top: 20px;
          color: #9CA3AF;
          font-size: 14px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="success-icon">
          <div class="checkmark"></div>
        </div>
        <h1>Pembayaran Berhasil!</h1>
        <p>Terima kasih atas pembayaran Anda</p>
        ${order_id ? `<div class="order-id">Order ID: ${order_id}</div>` : ''}
        <p class="loading">Mengarahkan kembali ke aplikasi...</p>
      </div>
      <script>
        // Kirim message ke React Native WebView
        setTimeout(() => {
          if (window.ReactNativeWebView) {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'payment_complete',
              status: 'settlement',
              orderId: '${order_id}',
              transactionStatus: '${transaction_status}',
              statusCode: '${status_code}'
            }));
          }
        }, 1500);
      </script>
    </body>
    </html>
  `);
});

// Callback: Payment Error
app.get('/api/payment/error', async (req, res) => {
  const { order_id, transaction_status, status_code } = req.query;

  console.log('❌ Payment ERROR callback received');
  console.log('Order ID:', order_id);
  console.log('Transaction Status:', transaction_status);
  console.log('Status Code:', status_code);

  try {
    await pool.query(
      `UPDATE orders 
       SET payment_status = 'failed'
       WHERE midtrans_order_id = $1`,
      [order_id]
    );

    // Update status di store (backward compatibility)
    if (order_id && transactionStore.has(order_id)) {
      const txData = transactionStore.get(order_id);
      txData.status = 'error';
      txData.errorAt = new Date();
      transactionStore.set(order_id, txData);
    }
  } catch (error) {
    console.error('Error updating payment status:', error);
  }

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Payment Error</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 100vh;
          margin: 0;
          background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
        }
        .container {
          background: white;
          padding: 40px;
          border-radius: 20px;
          box-shadow: 0 20px 60px rgba(0,0,0,0.3);
          text-align: center;
          max-width: 400px;
        }
        .error-icon {
          width: 80px;
          height: 80px;
          background: #EF4444;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 20px;
        }
        .cross {
          width: 40px;
          height: 40px;
          position: relative;
        }
        .cross:before, .cross:after {
          content: '';
          position: absolute;
          width: 4px;
          height: 40px;
          background: white;
          left: 18px;
        }
        .cross:before {
          transform: rotate(45deg);
        }
        .cross:after {
          transform: rotate(-45deg);
        }
        h1 {
          color: #EF4444;
          margin: 0 0 10px 0;
          font-size: 28px;
        }
        p {
          color: #6B7280;
          margin: 10px 0;
          font-size: 16px;
        }
        .order-id {
          background: #FEE2E2;
          padding: 10px;
          border-radius: 8px;
          font-family: monospace;
          margin: 20px 0;
          color: #991B1B;
        }
        .loading {
          margin-top: 20px;
          color: #9CA3AF;
          font-size: 14px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="error-icon">
          <div class="cross"></div>
        </div>
        <h1>Pembayaran Gagal</h1>
        <p>Terjadi kesalahan saat memproses pembayaran</p>
        ${order_id ? `<div class="order-id">Order ID: ${order_id}</div>` : ''}
        <p class="loading">Mengarahkan kembali ke aplikasi...</p>
      </div>
      <script>
        setTimeout(() => {
          if (window.ReactNativeWebView) {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'payment_complete',
              status: 'error',
              orderId: '${order_id}',
              transactionStatus: '${transaction_status}',
              statusCode: '${status_code}'
            }));
          }
        }, 1500);
      </script>
    </body>
    </html>
  `);
});

// Callback: Payment Pending
app.get('/api/payment/pending', (req, res) => {
  const { order_id, transaction_status, status_code } = req.query;

  console.log('⏳ Payment PENDING callback received');
  console.log('Order ID:', order_id);
  console.log('Transaction Status:', transaction_status);
  console.log('Status Code:', status_code);

  // Update status di store (backward compatibility)
  if (order_id && transactionStore.has(order_id)) {
    const txData = transactionStore.get(order_id);
    txData.status = 'pending';
    txData.pendingAt = new Date();
    transactionStore.set(order_id, txData);
  }

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Payment Pending</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 100vh;
          margin: 0;
          background: linear-gradient(135deg, #f6d365 0%, #fda085 100%);
        }
        .container {
          background: white;
          padding: 40px;
          border-radius: 20px;
          box-shadow: 0 20px 60px rgba(0,0,0,0.3);
          text-align: center;
          max-width: 400px;
        }
        .pending-icon {
          width: 80px;
          height: 80px;
          background: #F59E0B;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 20px;
        }
        .clock {
          width: 40px;
          height: 40px;
          border: 4px solid white;
          border-radius: 50%;
          position: relative;
        }
        .clock:before {
          content: '';
          position: absolute;
          width: 2px;
          height: 12px;
          background: white;
          left: 17px;
          top: 8px;
        }
        .clock:after {
          content: '';
          position: absolute;
          width: 8px;
          height: 2px;
          background: white;
          left: 17px;
          top: 17px;
        }
        h1 {
          color: #F59E0B;
          margin: 0 0 10px 0;
          font-size: 28px;
        }
        p {
          color: #6B7280;
          margin: 10px 0;
          font-size: 16px;
        }
        .order-id {
          background: #FEF3C7;
          padding: 10px;
          border-radius: 8px;
          font-family: monospace;
          margin: 20px 0;
          color: #92400E;
        }
        .loading {
          margin-top: 20px;
          color: #9CA3AF;
          font-size: 14px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="pending-icon">
          <div class="clock"></div>
        </div>
        <h1>Pembayaran Tertunda</h1>
        <p>Pembayaran Anda sedang diproses</p>
        ${order_id ? `<div class="order-id">Order ID: ${order_id}</div>` : ''}
        <p class="loading">Mengarahkan kembali ke aplikasi...</p>
      </div>
      <script>
        setTimeout(() => {
          if (window.ReactNativeWebView) {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'payment_complete',
              status: 'pending',
              orderId: '${order_id}',
              transactionStatus: '${transaction_status}',
              statusCode: '${status_code}'
            }));
          }
        }, 1500);
      </script>
    </body>
    </html>
  `);
});

// Midtrans notification handler
app.post('/api/notification', async (req, res) => {
  try {
    const notification = req.body;
    console.log('📬 Received notification from Midtrans:', notification);

    // Verifikasi signature notification
    const statusResponse = await snap.transaction.notification(notification);

    const orderId = statusResponse.order_id;
    const transactionStatus = statusResponse.transaction_status;
    const fraudStatus = statusResponse.fraud_status;

    console.log(`Transaction notification: Order ID: ${orderId}, Status: ${transactionStatus}, Fraud: ${fraudStatus}`);

    let paymentStatus = 'pending';
    if (transactionStatus === 'capture' || transactionStatus === 'settlement') {
      paymentStatus = 'paid';
    } else if (transactionStatus === 'deny' || transactionStatus === 'expire' || transactionStatus === 'cancel') {
      paymentStatus = 'failed';
    }

    await pool.query(
      'UPDATE orders SET payment_status = $1 WHERE midtrans_order_id = $2',
      [paymentStatus, orderId]
    );

    // Update status di store (backward compatibility)
    if (transactionStore.has(orderId)) {
      const txData = transactionStore.get(orderId);
      txData.status = transactionStatus;
      txData.notifiedAt = new Date();
      transactionStore.set(orderId, txData);
    }

    // Handle status transaksi
    if (transactionStatus === 'capture') {
      if (fraudStatus === 'accept') {
        console.log(`✅ Transaction ${orderId} captured and accepted`);
      }
    } else if (transactionStatus === 'settlement') {
      console.log(`✅ Transaction ${orderId} settled`);
    } else if (transactionStatus === 'pending') {
      console.log(`⏳ Transaction ${orderId} is pending`);
    } else if (transactionStatus === 'deny') {
      console.log(`❌ Transaction ${orderId} denied`);
    } else if (transactionStatus === 'expire') {
      console.log(`⏰ Transaction ${orderId} expired`);
    } else if (transactionStatus === 'cancel') {
      console.log(`🚫 Transaction ${orderId} cancelled`);
    }

    res.status(200).json({ status: 'ok' });
  } catch (error) {
    console.error('Error handling notification:', error);
    res.status(500).json({ error: 'Failed to process notification' });
  }
});

// Check transaction status
app.get('/api/transaction/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;

    // Cek di store lokal dulu (backward compatibility)
    if (transactionStore.has(orderId)) {
      const localData = transactionStore.get(orderId);
      console.log(`📊 Local transaction data for ${orderId}:`, localData);
    }

    // Query ke Midtrans untuk data real-time
    const statusResponse = await snap.transaction.status(orderId);

    res.json({
      success: true,
      data: statusResponse
    });
  } catch (error) {
    console.error('Error checking transaction status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check transaction status',
      message: error.message
    });
  }
});

// ============================================
// 7. WALLET ENDPOINTS
// ============================================

// Get wallet balance
app.get('/api/wallet', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM wallets WHERE user_id = $1',
      [req.user.userId]
    );

    if (result.rows.length === 0) {
      // Create wallet if not exists
      const newWallet = await pool.query(
        'INSERT INTO wallets (user_id, balance) VALUES ($1, 0) RETURNING *',
        [req.user.userId]
      );
      return res.json({
        success: true,
        data: newWallet.rows[0]
      });
    }

    res.json({
      success: true,
      data: result.rows[0]
    });

  } catch (error) {
    console.error('Get wallet error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get wallet',
      error: error.message
    });
  }
});

// Top up wallet
app.post('/api/wallet/topup', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const { amount } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid amount'
      });
    }

    await client.query('BEGIN');

    // Update wallet balance
    const result = await client.query(
      `UPDATE wallets 
       SET balance = balance + $1, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $2
       RETURNING *`,
      [amount, req.user.userId]
    );

    // Record financial record
    await client.query(
      `INSERT INTO financial_records (user_id, type, amount, description)
       VALUES ($1, 'income', $2, 'Wallet top-up')`,
      [req.user.userId, amount]
    );

    // Log activity
    await client.query(
      `INSERT INTO activity_logs (user_id, activity_type, amount, description)
       VALUES ($1, 'topup', $2, 'Wallet top-up')`,
      [req.user.userId, amount]
    );

    await client.query('COMMIT');

    res.json({
      success: true,
      message: 'Wallet topped up successfully',
      data: result.rows[0]
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Top up error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to top up wallet',
      error: error.message
    });
  } finally {
    client.release();
  }
});

// Withdraw from wallet
app.post('/api/wallet/withdraw', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const { amount } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid amount'
      });
    }

    // Check balance
    const walletCheck = await client.query(
      'SELECT balance FROM wallets WHERE user_id = $1',
      [req.user.userId]
    );

    if (walletCheck.rows.length === 0 || walletCheck.rows[0].balance < amount) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient balance'
      });
    }

    await client.query('BEGIN');

    // Update wallet balance
    const result = await client.query(
      `UPDATE wallets 
       SET balance = balance - $1, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $2
       RETURNING *`,
      [amount, req.user.userId]
    );

    // Record financial record
    await client.query(
      `INSERT INTO financial_records (user_id, type, amount, description)
       VALUES ($1, 'expense', $2, 'Wallet withdrawal')`,
      [req.user.userId, amount]
    );

    // Log activity
    await client.query(
      `INSERT INTO activity_logs (user_id, activity_type, amount, description)
       VALUES ($1, 'withdraw', $2, 'Wallet withdrawal')`,
      [req.user.userId, amount]
    );

    await client.query('COMMIT');

    res.json({
      success: true,
      message: 'Withdrawal successful',
      data: result.rows[0]
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Withdraw error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to withdraw',
      error: error.message
    });
  } finally {
    client.release();
  }
});

// ============================================
// 8. INVESTMENT ENDPOINTS (Metamask)
// ============================================

// Create investment
app.post('/api/investments', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const { wallet_address, amount, asset } = req.body;

    if (!wallet_address || !amount || !asset) {
      return res.status(400).json({
        success: false,
        message: 'Wallet address, amount, and asset are required'
      });
    }

    if (amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid amount'
      });
    }

    // Check wallet balance
    const walletCheck = await client.query(
      'SELECT balance FROM wallets WHERE user_id = $1',
      [req.user.userId]
    );

    if (walletCheck.rows.length === 0 || walletCheck.rows[0].balance < amount) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient balance'
      });
    }

    await client.query('BEGIN');

    // Create investment record
    const result = await client.query(
      `INSERT INTO investments (user_id, wallet_address, amount, asset, status)
       VALUES ($1, $2, $3, $4, 'active')
       RETURNING *`,
      [req.user.userId, wallet_address, amount, asset]
    );

    // Deduct from wallet
    await client.query(
      'UPDATE wallets SET balance = balance - $1 WHERE user_id = $2',
      [amount, req.user.userId]
    );

    // Record financial record
    await client.query(
      `INSERT INTO financial_records (user_id, type, amount, description, reference_id)
       VALUES ($1, 'investment', $2, $3, $4)`,
      [req.user.userId, amount, `Investment in ${asset}`, result.rows[0].id]
    );

    // Log activity
    await client.query(
      `INSERT INTO activity_logs (user_id, activity_type, amount, description)
       VALUES ($1, 'invest_buy', $2, $3)`,
      [req.user.userId, amount, `Invested ${amount} in ${asset}`]
    );

    await client.query('COMMIT');

    res.status(201).json({
      success: true,
      message: 'Investment created successfully',
      data: result.rows[0]
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Create investment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create investment',
      error: error.message
    });
  } finally {
    client.release();
  }
});

// Get user investments
app.get('/api/investments', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM investments WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.userId]
    );

    res.json({
      success: true,
      data: result.rows
    });

  } catch (error) {
    console.error('Get investments error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get investments',
      error: error.message
    });
  }
});

// Sell investment
app.post('/api/investments/:id/sell', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { sell_amount } = req.body;

    if (!sell_amount || sell_amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid sell amount'
      });
    }

    // Get investment
    const investmentCheck = await client.query(
      'SELECT * FROM investments WHERE id = $1 AND user_id = $2 AND status = $3',
      [id, req.user.userId, 'active']
    );

    if (investmentCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Investment not found or already sold'
      });
    }

    const investment = investmentCheck.rows[0];
    const gain = sell_amount - investment.amount;

    await client.query('BEGIN');

    // Update investment status
    await client.query(
      `UPDATE investments 
       SET status = 'sold', sold_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [id]
    );

    // Add to wallet
    await client.query(
      'UPDATE wallets SET balance = balance + $1 WHERE user_id = $2',
      [sell_amount, req.user.userId]
    );

    // Record gain/loss
    await client.query(
      `INSERT INTO financial_records (user_id, type, amount, description, reference_id)
       VALUES ($1, 'gain', $2, $3, $4)`,
      [req.user.userId, gain, `${gain >= 0 ? 'Gain' : 'Loss'} from ${investment.asset}`, id]
    );

    // Log activity
    await client.query(
      `INSERT INTO activity_logs (user_id, activity_type, amount, description)
       VALUES ($1, 'invest_sell', $2, $3)`,
      [req.user.userId, sell_amount, `Sold ${investment.asset} for ${sell_amount}`]
    );

    await client.query('COMMIT');

    res.json({
      success: true,
      message: 'Investment sold successfully',
      data: {
        investment_id: id,
        original_amount: investment.amount,
        sell_amount: sell_amount,
        gain: gain
      }
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Sell investment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to sell investment',
      error: error.message
    });
  } finally {
    client.release();
  }
});

// ============================================
// 9. FINANCIAL RECORDS ENDPOINTS
// ============================================

// Get financial summary
app.get('/api/financial/summary', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
         type,
         SUM(amount) as total_amount,
         COUNT(*) as count
       FROM financial_records
       WHERE user_id = $1
       GROUP BY type`,
      [req.user.userId]
    );

    const summary = {
      income: 0,
      expense: 0,
      investment: 0,
      gain: 0
    };

    result.rows.forEach(row => {
      summary[row.type] = parseFloat(row.total_amount);
    });

    // Get wallet balance
    const walletResult = await pool.query(
      'SELECT balance FROM wallets WHERE user_id = $1',
      [req.user.userId]
    );

    summary.wallet_balance = walletResult.rows.length > 0
      ? parseFloat(walletResult.rows[0].balance)
      : 0;

    summary.net_balance = summary.income - summary.expense + summary.gain;

    res.json({
      success: true,
      data: summary
    });

  } catch (error) {
    console.error('Get financial summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get financial summary',
      error: error.message
    });
  }
});

// Get financial records
app.get('/api/financial/records', authenticateToken, async (req, res) => {
  try {
    const { type, limit = 50, offset = 0 } = req.query;

    let query = 'SELECT * FROM financial_records WHERE user_id = $1';
    const params = [req.user.userId];

    if (type) {
      query += ' AND type = $2';
      params.push(type);
    }

    query += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(limit, offset);

    const result = await pool.query(query, params);

    res.json({
      success: true,
      data: result.rows
    });

  } catch (error) {
    console.error('Get financial records error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get financial records',
      error: error.message
    });
  }
});

// ============================================
// 10. ACTIVITY LOGS ENDPOINTS
// ============================================

// Get activity logs
app.get('/api/activities', authenticateToken, async (req, res) => {
  try {
    const { activity_type, limit = 50, offset = 0 } = req.query;

    let query = 'SELECT * FROM activity_logs WHERE user_id = $1';
    const params = [req.user.userId];

    if (activity_type) {
      query += ' AND activity_type = $2';
      params.push(activity_type);
    }

    query += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(limit, offset);

    const result = await pool.query(query, params);

    res.json({
      success: true,
      data: result.rows
    });

  } catch (error) {
    console.error('Get activities error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get activities',
      error: error.message
    });
  }
});

// ============================================
// 11. CHATBOT ENDPOINTS
// ============================================

// Create chatbot history
app.post('/api/chatbot/history', authenticateToken, async (req, res) => {
  try {
    const { command, input_text, response_text, action_result, related_entity } = req.body;

    if (!command) {
      return res.status(400).json({
        success: false,
        message: 'Command is required'
      });
    }

    const result = await pool.query(
      `INSERT INTO chatbot_histories 
       (user_id, command, input_text, response_text, action_result, related_entity)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [req.user.userId, command, input_text, response_text, action_result, related_entity]
    );

    res.status(201).json({
      success: true,
      message: 'Chatbot history recorded',
      data: result.rows[0]
    });

  } catch (error) {
    console.error('Create chatbot history error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to record chatbot history',
      error: error.message
    });
  }
});

// Get chatbot history
app.get('/api/chatbot/history', authenticateToken, async (req, res) => {
  try {
    const { limit = 50, offset = 0 } = req.query;

    const result = await pool.query(
      `SELECT * FROM chatbot_histories 
       WHERE user_id = $1 
       ORDER BY created_at DESC 
       LIMIT $2 OFFSET $3`,
      [req.user.userId, limit, offset]
    );

    res.json({
      success: true,
      data: result.rows
    });

  } catch (error) {
    console.error('Get chatbot history error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get chatbot history',
      error: error.message
    });
  }
});

// Process chatbot command (example automation)
app.post('/api/chatbot/process', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const { command, params } = req.body;

    let response = {
      success: false,
      message: 'Unknown command',
      action_result: 'failed'
    };

    await client.query('BEGIN');

    // Example: Create promo command
    if (command === 'create_promo') {
      const { store_id, discount_percentage, promo_code } = params;

      // Logic untuk membuat promo bisa ditambahkan di sini
      response = {
        success: true,
        message: `Promo ${promo_code} created with ${discount_percentage}% discount`,
        action_result: 'success',
        related_entity: 'promo'
      };
    }

    // Example: Make payment command
    else if (command === 'make_payment') {
      const { order_id } = params;

      // Logic pembayaran otomatis
      response = {
        success: true,
        message: `Payment processed for order ${order_id}`,
        action_result: 'success',
        related_entity: 'order'
      };
    }

    // Example: Check balance command
    else if (command === 'check_balance') {
      const walletResult = await client.query(
        'SELECT balance FROM wallets WHERE user_id = $1',
        [req.user.userId]
      );

      const balance = walletResult.rows.length > 0
        ? walletResult.rows[0].balance
        : 0;

      response = {
        success: true,
        message: `Your current balance is ${balance}`,
        action_result: 'success',
        related_entity: 'wallet',
        data: { balance }
      };
    }

    // Record chatbot history
    await client.query(
      `INSERT INTO chatbot_histories 
       (user_id, command, input_text, response_text, action_result, related_entity)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        req.user.userId,
        command,
        JSON.stringify(params),
        response.message,
        response.action_result,
        response.related_entity
      ]
    );

    await client.query('COMMIT');

    res.json(response);

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Process chatbot command error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process command',
      error: error.message
    });
  } finally {
    client.release();
  }
});

// ============================================
// 12. TRANSACTION HISTORY ENDPOINTS
// ============================================

// Create transaction history with coupon data
app.post('/api/transaction-history', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const {
      order_id,
      midtrans_order_id,
      total_amount,
      discount_amount = 0,
      coupons_used = [],
      payment_method = 'midtrans',
      items = [],
      status = 'completed' // ✅ Add default status
    } = req.body;

    if (!order_id || !total_amount) {
      return res.status(400).json({
        success: false,
        message: 'Order ID and total amount are required'
      });
    }

    await client.query('BEGIN');

    // Insert transaction history
    const historyResult = await client.query(
      `INSERT INTO transaction_histories 
       (user_id, order_id, midtrans_order_id, total_amount, discount_amount, 
        payment_method, coupons_used, items_data, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
       RETURNING *`,
      [
        req.user.userId,
        order_id,
        midtrans_order_id,
        total_amount,
        discount_amount,
        payment_method,
        JSON.stringify(coupons_used),
        JSON.stringify(items),
        status // ✅ Include status in insert
      ]
    );

    // Update financial records only for completed transactions
    if (status === 'completed') {
      await client.query(
        `INSERT INTO financial_records (user_id, type, amount, description, reference_id)
         VALUES ($1, 'income', $2, $3, $4)`,
        [
          req.user.userId,
          total_amount,
          `Transaction completed: ${order_id}`,
          historyResult.rows[0].id
        ]
      );

      // Log activity
      await client.query(
        `INSERT INTO activity_logs (user_id, activity_type, amount, description)
         VALUES ($1, 'transaction_completed', $2, $3)`,
        [
          req.user.userId,
          total_amount,
          `Transaction ${order_id} completed with ${coupons_used.length} coupons`
        ]
      );
    }

    await client.query('COMMIT');

    res.status(201).json({
      success: true,
      message: 'Transaction history recorded successfully',
      data: historyResult.rows[0]
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Create transaction history error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to record transaction history',
      error: error.message
    });
  } finally {
    client.release();
  }
});

// Get transaction history
app.get('/api/transaction-history', authenticateToken, async (req, res) => {
  try {
    const { limit = 20, offset = 0, status } = req.query;

    let query = `
      SELECT th.*, 
             COUNT(*) OVER() as total_count
      FROM transaction_histories th
      WHERE th.user_id = $1
    `;
    const params = [req.user.userId];

    if (status) {
      query += ' AND th.status = $2';
      params.push(status);
    }

    query += ' ORDER BY th.created_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(limit, offset);

    const result = await pool.query(query, params);

    // Parse JSON fields
    const transactions = result.rows.map(row => ({
      ...row,
      coupons_used: typeof row.coupons_used === 'string' ? JSON.parse(row.coupons_used) : row.coupons_used,
      items_data: typeof row.items_data === 'string' ? JSON.parse(row.items_data) : row.items_data
    }));

    res.json({
      success: true,
      data: {
        transactions,
        pagination: {
          total: result.rows.length > 0 ? parseInt(result.rows[0].total_count) : 0,
          limit: parseInt(limit),
          offset: parseInt(offset)
        }
      }
    });

  } catch (error) {
    console.error('Get transaction history error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get transaction history',
      error: error.message
    });
  }
});

// ============================================
// 13. DASHBOARD & STATISTICS
// ============================================

// Get dashboard statistics
app.get('/api/dashboard/stats', authenticateToken, async (req, res) => {
  try {
    // Total stores
    const storesResult = await pool.query(
      'SELECT COUNT(*) as total FROM stores WHERE user_id = $1',
      [req.user.userId]
    );

    // Total products
    const productsResult = await pool.query(
      `SELECT COUNT(*) as total FROM products p
       JOIN stores s ON p.store_id = s.id
       WHERE s.user_id = $1`,
      [req.user.userId]
    );

    // Total orders & revenue
    const ordersResult = await pool.query(
      `SELECT 
         COUNT(*) as total_orders,
         SUM(CASE WHEN payment_status = 'paid' THEN total_amount ELSE 0 END) as total_revenue
       FROM orders o
       JOIN stores s ON o.store_id = s.id
       WHERE s.user_id = $1`,
      [req.user.userId]
    );

    // Transaction history stats
    const transactionHistoryResult = await pool.query(
      `SELECT 
         COUNT(*) as total_transactions,
         SUM(total_amount) as total_transaction_amount,
         SUM(discount_amount) as total_savings,
         COUNT(CASE WHEN coupons_used != '[]' AND coupons_used IS NOT NULL THEN 1 END) as transactions_with_coupons
       FROM transaction_histories
       WHERE user_id = $1 AND status = 'completed'`,
      [req.user.userId]
    );

    // Recent transactions
    const recentTransactionsResult = await pool.query(
      `SELECT order_id, total_amount, discount_amount, created_at, coupons_used
       FROM transaction_histories
       WHERE user_id = $1 AND status = 'completed'
       ORDER BY created_at DESC
       LIMIT 5`,
      [req.user.userId]
    );

    // Wallet balance
    const walletResult = await pool.query(
      'SELECT balance FROM wallets WHERE user_id = $1',
      [req.user.userId]
    );

    // Active investments
    const investmentsResult = await pool.query(
      `SELECT COUNT(*) as total, SUM(amount) as total_invested
       FROM investments
       WHERE user_id = $1 AND status = 'active'`,
      [req.user.userId]
    );

    // Parse recent transactions
    const recentTransactions = recentTransactionsResult.rows.map(row => ({
      ...row,
      coupons_used: typeof row.coupons_used === 'string' ? JSON.parse(row.coupons_used) : row.coupons_used
    }));

    const transactionStats = transactionHistoryResult.rows[0];

    res.json({
      success: true,
      data: {
        // Store & Product Stats
        total_stores: parseInt(storesResult.rows[0].total),
        total_products: parseInt(productsResult.rows[0].total),
        total_orders: parseInt(ordersResult.rows[0].total_orders),
        total_revenue: parseFloat(ordersResult.rows[0].total_revenue || 0),

        // Transaction History Stats
        total_transactions: parseInt(transactionStats.total_transactions || 0),
        total_transaction_amount: parseFloat(transactionStats.total_transaction_amount || 0),
        total_savings: parseFloat(transactionStats.total_savings || 0),
        transactions_with_coupons: parseInt(transactionStats.transactions_with_coupons || 0),

        // Financial Stats
        wallet_balance: parseFloat(walletResult.rows[0]?.balance || 0),
        active_investments: parseInt(investmentsResult.rows[0].total),
        total_invested: parseFloat(investmentsResult.rows[0].total_invested || 0),

        // Recent Activity
        recent_transactions: recentTransactions
      }
    });

  } catch (error) {
    console.error('Get dashboard stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get dashboard statistics',
      error: error.message
    });
  }
});

// ============================================
// HEALTH CHECK
// ============================================

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Store Management API is running',
    timestamp: new Date().toISOString(),
    services: {
      database: 'connected',
      midtrans: snap.isProduction ? 'production' : 'sandbox'
    },
    activeTransactions: transactionStore.size
  });
});

// ============================================
// ERROR HANDLER
// ============================================

app.use((err, req, res, next) => {
  console.error('Global error handler:', err);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: err.message
  });
});

// ============================================
// START SERVER
// ============================================

app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔═══════════════════════════════════════════════════════════════════════╗
║       Complete Store Management API with Midtrans Integration        ║
║                Running on: http://192.168.100.15:${PORT}              ║
║                                                                       ║
║   🔐 Authentication Endpoints:                                        ║
║      POST /api/auth/register                                          ║
║      POST /api/auth/login                                             ║
║      GET  /api/auth/profile                                           ║
║                                                                       ║
║   🏪 Store Management:                                                ║
║      POST   /api/stores                                               ║
║      GET    /api/stores                                               ║
║      GET    /api/stores/:id                                           ║
║      PUT    /api/stores/:id                                           ║
║      DELETE /api/stores/:id                                           ║
║                                                                       ║
║   📦 Product Management:                                              ║
║      POST   /api/products                                             ║
║      GET    /api/stores/:storeId/products                             ║
║      GET    /api/products/:id                                         ║
║      PUT    /api/products/:id                                         ║
║      DELETE /api/products/:id                                         ║
║                                                                       ║
║   💰 Payment & Orders (NEW - with Database):                          ║
║      POST /api/orders/create                                          ║
║      GET  /api/stores/:storeId/orders                                 ║
║      GET  /api/orders/:id                                             ║
║                                                                       ║
║   💰 Payment & Orders (OLD - Backward Compatible):                    ║
║      POST /api/tokenizer                                              ║
║      POST /api/transaction/create                                     ║
║      GET  /api/transaction/:orderId                                   ║
║                                                                       ║
║   🔄 Payment Callbacks:                                               ║
║      GET  /api/payment/finish                                         ║
║      GET  /api/payment/error                                          ║
║      GET  /api/payment/pending                                        ║
║      POST /api/notification                                           ║
║                                                                       ║
║   💼 Wallet Management:                                               ║
║      GET  /api/wallet                                                 ║
║      POST /api/wallet/topup                                           ║
║      POST /api/wallet/withdraw                                        ║
║                                                                       ║
║   📈 Investment Management:                                           ║
║      POST /api/investments                                            ║
║      GET  /api/investments                                            ║
║      POST /api/investments/:id/sell                                   ║
║                                                                       ║
║   📊 Financial Records:                                               ║
║      GET /api/financial/summary                                       ║
║      GET /api/financial/records                                       ║
║                                                                       ║
║   📝 Activity Logs:                                                   ║
║      GET /api/activities                                              ║
║                                                                       ║
║   🤖 Chatbot:                                                         ║
║      POST /api/chatbot/history                                        ║
║      GET  /api/chatbot/history                                        ║
║      POST /api/chatbot/process                                        ║
║                                                                       ║
║   📊 Dashboard:                                                       ║
║      GET /api/dashboard/stats                                         ║
║                                                                       ║
║   🏥 Health Check:                                                    ║
║      GET /api/health                                                  ║
╚═══════════════════════════════════════════════════════════════════════╝
  `);

  console.log('\n✅ All endpoints are ready!');
  console.log('✅ Old Midtrans endpoints maintained for backward compatibility');
  console.log('✅ New endpoints with database integration available');
  console.log('📱 WebView payment callbacks configured');
  console.log('\n⚠️  Production Checklist:');
  console.log('☐ Update environment variables');
  console.log('☐ Enable HTTPS');
  console.log('☐ Set strong JWT_SECRET');
  console.log('☐ Configure proper CORS');
  console.log('☐ Enable rate limiting');
  console.log('☐ Set up monitoring\n');
});

module.exports = app;