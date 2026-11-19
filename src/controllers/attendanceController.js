const ApiError = require('../utils/ApiError');
const config = require('../config/env');
const { sendSuccess } = require('../utils/response');
const { getPagination, paginate } = require('../utils/pagination');
const { toUtcDay, daysBetween } = require('../utils/date');
const { Attendance, AttendanceAudit, Enrollment, Student } = require('../models');
const { ROLES } = require('../config/constants');
const { getSectionForStaff, facultySectionIds } = require('../services/accessService');
const { studentSummary, percentagesFor } = require('../services/attendanceService');
const { appEvents, EVENTS } = require('../events/appEvents');

// Minimum number of classes before low-attendance alerts are sent (avoids alerts after the first absence).
const MIN_CLASSES_FOR_ALERT = 3;

// POST /api/attendance  (faculty assigned to the section, or admin)
// Body: { section, date: "2025-08-14", period: 1, records: [{ student, status }] }
exports.mark = async (req, res) => {
  const section = await getSectionForStaff(req, req.body.section);
  const date = toUtcDay(req.body.date);
  const period = req.body.period || 1;
  if (date > toUtcDay(new Date())) throw ApiError.badRequest('Attendance cannot be marked for a future date');

  // 1. No student twice in the same request.
  const ids = req.body.records.map((r) => String(r.student));
  const dupes = ids.filter((v, i) => ids.indexOf(v) !== i);
  if (dupes.length) throw ApiError.badRequest('The same student appears more than once in records', { students: [...new Set(dupes)] });

  // 2. Every student must be actively enrolled in this section.
  const enrolled = new Set((await Enrollment.find({ section: section._id, status: 'active', student: { $in: ids } }).distinct('student')).map(String));
  const notEnrolled = ids.filter((s) => !enrolled.has(s));
  if (notEnrolled.length) throw ApiError.badRequest('Some students are not enrolled in this section', { students: notEnrolled });

  // 3. Attendance must not already exist for this class session.
  const already = await Attendance.find({ section: section._id, date, period, student: { $in: ids } }).distinct('student');
  if (already.length) {
    throw ApiError.conflict('Attendance already marked for this session. Use PATCH /api/attendance/:id to correct a record.', {
      students: already.map(String),
    });
  }

  const docs = req.body.records.map((r) => ({
    student: r.student,
    course: section.course,
    section: section._id,
    date,
    period,
    status: r.status,
    markedBy: req.user._id,
  }));
  // The unique index (student, section, date, period) is the final guard against concurrent duplicates.
  const created = await Attendance.insertMany(docs, { ordered: true });

  const summary = created.reduce((acc, a) => ({ ...acc, [a.status]: (acc[a.status] || 0) + 1 }), {});
  appEvents.emit(EVENTS.ATTENDANCE_MARKED, {
    sectionId: String(section._id),
    courseId: String(section.course),
    date,
    period,
    markedBy: String(req.user._id),
    records: created.map((a) => ({ attendanceId: String(a._id), studentId: String(a.student), status: a.status })),
  });
  await checkLowAttendance(section.course, created.filter((a) => a.status === 'absent').map((a) => a.student));

  sendSuccess(res, { status: 201, message: `Attendance marked for ${created.length} students`, data: { date, period, section: section._id, summary, records: created } });
};

// Emits an attendance.low event for every student who dropped below the threshold.
async function checkLowAttendance(courseId, studentIds) {
  if (!studentIds.length) return;
  const rows = await percentagesFor(courseId, studentIds);
  const low = rows.filter((r) => r.totalClasses >= MIN_CLASSES_FOR_ALERT && r.percentage < config.attendance.threshold);
  if (!low.length) return;
  const students = await Student.find({ _id: { $in: low.map((r) => r.student) } }).select('user rollNumber').lean();
  const byId = new Map(students.map((s) => [String(s._id), s]));
  low.forEach((r) => {
    const s = byId.get(String(r.student));
    appEvents.emit(EVENTS.ATTENDANCE_LOW, {
      studentId: String(r.student),
      userId: String(s.user),
      rollNumber: s.rollNumber,
      courseId: String(courseId),
      percentage: r.percentage,
      threshold: config.attendance.threshold,
    });
  });
}

// PATCH /api/attendance/:id { status, reason }
// Rule: faculty may correct records of their own sections within ATTENDANCE_EDIT_WINDOW_DAYS days
// of the class; administrators may correct at any time. Every change is written to the audit trail.
exports.correct = async (req, res) => {
  const record = await Attendance.findById(req.params.id);
  if (!record) throw ApiError.notFound('Attendance record not found');
  await getSectionForStaff(req, record.section);

  if (req.user.role === ROLES.FACULTY) {
    const age = daysBetween(record.date, new Date());
    if (age > config.attendance.editWindowDays) {
      throw ApiError.forbidden(`Faculty can only correct attendance within ${config.attendance.editWindowDays} days of the class. Contact an administrator.`);
    }
  }
  if (record.status === req.body.status) throw ApiError.badRequest(`Status is already "${record.status}"`);

  const oldStatus = record.status;
  record.status = req.body.status;
  record.lastModifiedBy = req.user._id;
  record.correctionCount += 1;
  await record.save();
  await AttendanceAudit.create({ attendance: record._id, student: record.student, changedBy: req.user._id, oldStatus, newStatus: record.status, reason: req.body.reason });

  appEvents.emit(EVENTS.ATTENDANCE_UPDATED, {
    attendanceId: String(record._id),
    studentId: String(record.student),
    sectionId: String(record.section),
    courseId: String(record.course),
    date: record.date,
    oldStatus,
    newStatus: record.status,
    changedBy: String(req.user._id),
  });
  if (record.status === 'absent') await checkLowAttendance(record.course, [record.student]);

  sendSuccess(res, { message: 'Attendance corrected', data: record });
};

// GET /api/attendance?section=&course=&student=&date=&from=&to=&status=
// Students always see only their own records; faculty only records of their sections.
exports.list = async (req, res) => {
  const filter = {};
  ['course', 'status'].forEach((f) => req.query[f] && (filter[f] = req.query[f]));

  if (req.user.role === ROLES.STUDENT) {
    filter.student = req.student._id; // ignore any ?student= sent by a student
  } else if (req.query.student) {
    filter.student = req.query.student;
  }

  if (req.user.role === ROLES.FACULTY) {
    const mine = (await facultySectionIds(req.faculty._id)).map(String);
    if (req.query.section && !mine.includes(req.query.section)) throw ApiError.forbidden('You are not assigned to this section');
    filter.section = req.query.section ? req.query.section : { $in: mine };
  } else if (req.query.section) {
    filter.section = req.query.section;
  }

  if (req.query.date) filter.date = toUtcDay(req.query.date);
  else if (req.query.from || req.query.to) {
    filter.date = {};
    if (req.query.from) filter.date.$gte = toUtcDay(req.query.from);
    if (req.query.to) filter.date.$lte = toUtcDay(req.query.to);
  }

  const pg = getPagination(req.query, { defaultSort: '-date,period', allowedSort: ['date', 'period', 'status', 'createdAt'] });
  const { items, meta } = await paginate(Attendance, filter, pg, {
    populate: [
      { path: 'student', select: 'rollNumber', populate: { path: 'user', select: 'name' } },
      { path: 'course', select: 'code title' },
      { path: 'section', select: 'name' },
    ],
  });
  sendSuccess(res, { data: items, meta });
};

// GET /api/attendance/me/summary - subject-wise totals and percentage for the logged-in student
exports.mySummary = async (req, res) => {
  const subjects = await studentSummary(req.student._id);
  const threshold = config.attendance.threshold;
  const data = subjects.map((s) => ({ ...s, belowThreshold: s.percentage < threshold }));
  const totals = data.reduce((acc, s) => ({ totalClasses: acc.totalClasses + s.totalClasses, attended: acc.attended + s.attended }), { totalClasses: 0, attended: 0 });
  sendSuccess(res, { data: { threshold, overall: totals, subjects: data } });
};

// GET /api/attendance/:id/audit - correction history of one record
exports.audit = async (req, res) => {
  const record = await Attendance.findById(req.params.id);
  if (!record) throw ApiError.notFound('Attendance record not found');
  if (req.user.role === ROLES.STUDENT) {
    if (!record.student.equals(req.student._id)) throw ApiError.forbidden('You can only view your own attendance');
  } else {
    await getSectionForStaff(req, record.section);
  }
  const history = await AttendanceAudit.find({ attendance: record._id }).populate('changedBy', 'name role').sort('-changedAt').lean();
  sendSuccess(res, { data: { record, history } });
};
