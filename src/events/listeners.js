// Subscribers of the application EventEmitter.
// 1. Socket.IO notifier - forwards domain events to the right rooms in real time.
// 2. Audit logger       - writes a one-line log for every domain event.
const { appEvents, EVENTS } = require('./appEvents');
const { getIO } = require('../socket');
const { Student } = require('../models');
const config = require('../config/env');

const log = (...args) => !config.isTest && console.log('[event]', ...args);

function registerListeners() {
  // New announcement -> push to the audience of the announcement.
  appEvents.on(EVENTS.ANNOUNCEMENT_CREATED, (announcement) => {
    log(EVENTS.ANNOUNCEMENT_CREATED, String(announcement._id), announcement.scope);
    const io = getIO();
    if (!io) return;
    const room =
      announcement.scope === 'university'
        ? 'university'
        : announcement.scope === 'course'
          ? `course:${announcement.course}`
          : `section:${announcement.section}`;
    // Admins always receive every announcement.
    io.to(room).to('role:admin').emit('announcement:new', announcement);
  });

  // Attendance marked -> tell the section (faculty dashboard) and each student their own status.
  appEvents.on(EVENTS.ATTENDANCE_MARKED, async (payload) => {
    log(EVENTS.ATTENDANCE_MARKED, `section=${payload.sectionId}`, `records=${payload.records.length}`);
    const io = getIO();
    if (!io) return;
    const students = await Student.find({ _id: { $in: payload.records.map((r) => r.studentId) } }).select('user').lean();
    const userByStudent = new Map(students.map((s) => [String(s._id), String(s.user)]));
    payload.records.forEach((r) => {
      io.to(`user:${userByStudent.get(r.studentId)}`).emit('attendance:marked', {
        attendanceId: r.attendanceId,
        courseId: payload.courseId,
        sectionId: payload.sectionId,
        date: payload.date,
        period: payload.period,
        status: r.status,
      });
    });
    io.to('role:admin').emit('attendance:session-recorded', {
      sectionId: payload.sectionId,
      courseId: payload.courseId,
      date: payload.date,
      period: payload.period,
      count: payload.records.length,
    });
  });

  // Attendance corrected -> notify the affected student.
  appEvents.on(EVENTS.ATTENDANCE_UPDATED, async (payload) => {
    log(EVENTS.ATTENDANCE_UPDATED, payload.attendanceId, `${payload.oldStatus} -> ${payload.newStatus}`);
    const io = getIO();
    if (!io) return;
    const student = await Student.findById(payload.studentId).select('user').lean();
    if (student) io.to(`user:${student.user}`).emit('attendance:updated', payload);
  });

  // Low attendance -> alert the student privately.
  appEvents.on(EVENTS.ATTENDANCE_LOW, (payload) => {
    log(EVENTS.ATTENDANCE_LOW, payload.rollNumber, `${payload.percentage}% < ${payload.threshold}%`);
    const io = getIO();
    if (io) io.to(`user:${payload.userId}`).emit('attendance:low', payload);
  });

  appEvents.on(EVENTS.ENROLLMENT_CREATED, ({ enrollment, userId }) => {
    log(EVENTS.ENROLLMENT_CREATED, enrollment._id);
    const io = getIO();
    if (!io) return;
    // Add the student's open sockets to the new course/section rooms immediately.
    io.in(`user:${userId}`).socketsJoin([`course:${enrollment.course._id}`, `section:${enrollment.section._id}`]);
    io.to(`user:${userId}`).emit('enrollment:created', { enrollmentId: enrollment._id, course: enrollment.course, section: enrollment.section });
  });

  // An async listener that throws would otherwise produce an unhandled rejection.
  appEvents.on('error', (err) => console.error('[event] listener error:', err));
}

module.exports = { registerListeners };
