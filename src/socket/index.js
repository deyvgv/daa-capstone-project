// Socket.IO server: authenticates every connection with the same JWT access token used by
// the REST API and places the socket into rooms based on the user's role and enrolments.
//
// Rooms:
//   user:<userId>        - private notifications (e.g. low-attendance alerts, attendance changes)
//   role:<role>          - all users of a role (e.g. role:admin)
//   university           - every connected user (university-wide announcements)
//   course:<courseId>    - students enrolled in / faculty teaching a course
//   section:<sectionId>  - students and faculty of one section
const { Server } = require('socket.io');
const config = require('../config/env');
const { verifyAccessToken } = require('../utils/tokens');
const { User, Student, Faculty } = require('../models');
const { ROLES } = require('../config/constants');
const { audienceFor } = require('../services/accessService');

let io = null;

async function socketAuth(socket, next) {
  try {
    const raw = socket.handshake.auth?.token || socket.handshake.headers?.authorization || '';
    const token = raw.startsWith('Bearer ') ? raw.slice(7) : raw;
    if (!token) return next(new Error('UNAUTHORIZED: token missing'));

    const payload = verifyAccessToken(token);
    const user = await User.findById(payload.sub).select('+tokenVersion');
    if (!user || !user.isActive || user.tokenVersion !== payload.tv) return next(new Error('UNAUTHORIZED: invalid session'));

    socket.data.user = { id: String(user._id), name: user.name, role: user.role };
    if (user.role === ROLES.STUDENT) socket.data.student = await Student.findOne({ user: user._id }).lean();
    if (user.role === ROLES.FACULTY) socket.data.faculty = await Faculty.findOne({ user: user._id }).lean();
    return next();
  } catch (err) {
    return next(new Error(`UNAUTHORIZED: ${err.message}`));
  }
}

async function joinRooms(socket) {
  const { user, student, faculty } = socket.data;
  const rooms = [`user:${user.id}`, `role:${user.role}`, 'university'];
  const { courseIds, sectionIds } = await audienceFor({ role: user.role }, { student, faculty });
  courseIds.forEach((id) => rooms.push(`course:${id}`));
  sectionIds.forEach((id) => rooms.push(`section:${id}`));
  await socket.join(rooms);
  return rooms;
}

function initSocket(httpServer) {
  io = new Server(httpServer, { cors: { origin: config.corsOrigin } });
  io.use(socketAuth);

  io.on('connection', async (socket) => {
    const { user } = socket.data;
    const rooms = await joinRooms(socket);
    if (!config.isTest) console.log(`[socket] connected ${user.role}:${user.id} (${socket.id}) rooms=${rooms.length}`);

    socket.emit('connected', { message: `Welcome ${user.name}`, user, rooms });

    // Client can ask for its rooms again, e.g. after a new enrolment.
    socket.on('rooms:refresh', async (ack) => {
      [...socket.rooms].filter((r) => r !== socket.id).forEach((r) => socket.leave(r));
      const updated = await joinRooms(socket);
      if (typeof ack === 'function') ack({ rooms: updated });
    });

    socket.on('disconnect', (reason) => {
      if (!config.isTest) console.log(`[socket] disconnected ${user.role}:${user.id} (${reason})`);
    });
  });

  return io;
}

function getIO() {
  return io;
}

module.exports = { initSocket, getIO };
