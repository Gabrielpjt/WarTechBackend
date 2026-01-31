const express = require('express');
const cors = require('cors');
require('dotenv').config();

const transactionRoutes = require('./routes/transaction.routes');

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api', transactionRoutes);

module.exports = app;
