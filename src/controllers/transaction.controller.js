const midtransService = require('../services/midtrans.service');

exports.createTransaction = async (req, res) => {
  try {
    const { orderId, customerName, items, discount } = req.body;

    if (!orderId || !items || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request data'
      });
    }

    // 1️⃣ Normalisasi item (WAJIB INTEGER)
    const processedItems = items.map(item => ({
      id: String(item.id),
      name: String(item.name).substring(0, 50),
      price: Math.round(item.price),
      quantity: item.quantity
    }));

    // 2️⃣ Diskon HARUS jadi item negatif
    if (discount && discount > 0) {
      processedItems.push({
        id: 'DISCOUNT',
        name: 'Diskon',
        price: -Math.round(discount),
        quantity: 1
      });
    }

    // 3️⃣ Hitung gross_amount dari item_details
    const grossAmount = processedItems.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    );

    if (grossAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid gross amount'
      });
    }

    const parameter = {
      transaction_details: {
        order_id: orderId,
        gross_amount: grossAmount
      },
      customer_details: {
        first_name: customerName || 'Customer',
        email: 'customer@warungtech.com',
        phone: '081234567890'
      },
      item_details: processedItems,
      enabled_payments: ['qris', 'gopay', 'shopeepay']
    };

    const result = await midtransService.createTransaction(parameter);

    res.json({
      success: true,
      token: result.token,
      redirect_url: result.redirect_url
    });

  } catch (err) {
    console.error('CREATE TRANSACTION ERROR:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
};

exports.checkStatus = async (req, res) => {
  try {
    const status = await midtransService.getTransactionStatus(req.params.orderId);
    res.json({ success: true, data: status });
  } catch (err) {
    console.error('CHECK STATUS ERROR:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.webhook = async (req, res) => {
  try {
    const notification = await midtransService.handleNotification(req.body);

    console.log(
      `Order ${notification.order_id} - Status: ${notification.transaction_status}`
    );

    // TODO: simpan ke database jika perlu

    res.json({ success: true });
  } catch (err) {
    console.error('WEBHOOK ERROR:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};
