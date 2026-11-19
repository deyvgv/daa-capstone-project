const { EventEmitter } = require('events');

// Application-wide event bus (Node.js core EventEmitter).
// Controllers emit domain events; listeners (Socket.IO notifier, console audit log) react to them.
// This decouples "what happened" from "who needs to know".
class AppEvents extends EventEmitter {}

// captureRejections routes errors thrown by async listeners to the 'error' event.
const appEvents = new AppEvents({ captureRejections: true });
appEvents.setMaxListeners(20);

const EVENTS = Object.freeze({
  ANNOUNCEMENT_CREATED: 'announcement.created',
  ATTENDANCE_MARKED: 'attendance.marked',
  ATTENDANCE_UPDATED: 'attendance.updated',
  ATTENDANCE_LOW: 'attendance.low',
  ENROLLMENT_CREATED: 'enrollment.created',
});

module.exports = { appEvents, EVENTS };
