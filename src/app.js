const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const mongoose = require('mongoose');
const config = require('./config/env');
const routes = require('./routes');
const { requestId, httpLogger } = require('./middleware/requestLogger');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const app = express();

// ---- Global middleware chain (order matters) ----
app.use(requestId); // 1. tag the request with an ID
if (!config.isTest) app.use(httpLogger); // 2. log method, URL, status, time, user
app.use(helmet({ contentSecurityPolicy: false })); // 3. security headers (CSP off so the socket demo page can load its script)
app.use(cors({ origin: config.corsOrigin })); // 4. CORS
app.use(express.json({ limit: '100kb' })); // 5. parse JSON bodies

// Static demo page for the real-time features (public/socket-demo.html).
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    data: {
      status: 'ok',
      uptimeSeconds: Math.round(process.uptime()),
      db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
      timestamp: new Date().toISOString(),
    },
  });
});

app.use('/api', routes);

// ---- Error handling (must be last) ----
app.use(notFound);
app.use(errorHandler);

module.exports = app;
