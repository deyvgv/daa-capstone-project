#!/usr/bin/env node
// Command-line Socket.IO client for demonstrating real-time events.
//   node scripts/socket-client.js student001@campus.edu Password@123
// Logs in through the REST API, connects with the access token and prints every event received.
const { io } = require('socket.io-client');

const [, , email = 'student001@campus.edu', password = 'Password@123', base = 'http://localhost:5000'] = process.argv;

async function main() {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  if (!res.ok) {
    console.error('Login failed:', body.error?.message);
    process.exit(1);
  }
  console.log(`Logged in as ${body.data.user.name} (${body.data.user.role})`);

  const socket = io(base, { auth: { token: body.data.accessToken } });
  socket.on('connect_error', (err) => console.error('Connection refused:', err.message));
  socket.onAny((event, payload) => {
    console.log(`\n[${new Date().toLocaleTimeString()}] ${event}`);
    console.log(JSON.stringify(payload, null, 2));
  });
  console.log('Listening for events... (Ctrl+C to quit)');
}

main();
