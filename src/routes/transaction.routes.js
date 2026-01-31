const express = require('express');
const router = express.Router();
const controller = require('../controllers/transaction.controller');

router.post('/create-transaction', controller.createTransaction);
router.get('/transaction-status/:orderId', controller.checkStatus);
router.post('/midtrans-webhook', controller.webhook);

module.exports = router;
