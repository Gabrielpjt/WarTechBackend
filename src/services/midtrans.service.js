const midtransClient = require('midtrans-client');

// Snap API (untuk membuat transaction token)
const snap = new midtransClient.Snap({
    isProduction: false, // Sandbox mode
    serverKey: 'Mid-server-nHcYPGzkb7oSKj1ObOJEqaFw', // <-- ganti sesuai key
    clientKey: 'Mid-client-L-Vxrb7krYz-UD-w'
});

// Core API (untuk cek status & webhook)
const coreApi = new midtransClient.CoreApi({
    isProduction: false,
    serverKey: 'Mid-server-nHcYPGzkb7oSKj1ObOJEqaFw'
});

module.exports = {
    createTransaction: async (params) => {
        return await snap.createTransaction(params);
    },
    getTransactionStatus: async (orderId) => {
        return await coreApi.transaction.status(orderId);
    },
    handleNotification: async (notificationBody) => {
        return await coreApi.transaction.notification(notificationBody);
    }
};
