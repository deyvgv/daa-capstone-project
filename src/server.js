// Entry point: creates the Node.js HTTP server, attaches Express and Socket.IO, connects to MongoDB.
const http = require('http');
const config = require('./config/env');
const app = require('./app');
const { connectDB, disconnectDB } = require('./config/db');
const { initSocket } = require('./socket');
const { registerListeners } = require('./events/listeners');

const server = http.createServer(app);

async function start() {
  await connectDB();
  initSocket(server);
  registerListeners();
  server.listen(config.port, () => {
    console.log(`Server running in ${config.env} mode on http://localhost:${config.port} (pid ${process.pid})`);
    console.log(`Socket.IO demo page: http://localhost:${config.port}/socket-demo.html`);
  });
}

// Graceful shutdown on Ctrl+C / container stop.
async function shutdown(signal) {
  console.log(`\n${signal} received, shutting down...`);
  server.close(async () => {
    await disconnectDB();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  process.exit(1);
});

start().catch((err) => {
  console.error('Failed to start server:', err.message);
  process.exit(1);
});
