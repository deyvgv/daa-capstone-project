// Reports built with MongoDB aggregation pipelines.
const ApiError = require('../utils/ApiError');
const config = require('../config/env');
const { sendSuccess } = require('../utils/response');
const { sendCsv } = require('../utils/csv');
const { toUtcDay } = require('../utils/date');
const { Attendance, Course, Section } = require('../models');
const { ROLES, ATTENDED_STATUSES } = require('../config/constants');
const { facultySectionIds } = require('../services/accessService');
const { summaryStages, toId } = require('../services/attendanceService');

// Builds the $match stage for attendance reports and applies faculty restrictions.
async function attendanceMatch(req) {
  const match = {};
  if (req.query.course) match.course = toId(req.query.course);
  if (req.query.from || req.query.to) {
    match.date = {};
    if (req.query.from) match.date.$gte = toUtcDay(req.query.from);
    if (req.query.to) match.date.$lte = toUtcDay(req.query.to);
  }
  if (req.user.role === ROLES.FACULTY) {
    const mine = (await facultySectionIds(req.faculty._id)).map(String);
    if (req.query.section && !mine.includes(req.query.section)) throw ApiError.forbidden('You are not assigned to this section');
    match.section = req.query.section ? toId(req.query.section) : { $in: mine.map(toId) };
  } else if (req.query.section) {
    match.section = toId(req.query.section);
  }
  return match;
}

// Joins student, user and course details onto summary rows.
const enrichStages = [
  { $lookup: { from: 'students', localField: '_id.student', foreignField: '_id', as: 'student' } },
  { $unwind: '$student' },
  { $lookup: { from: 'users', localField: 'student.user', foreignField: '_id', as: 'user' } },
  { $unwind: '$user' },
  { $lookup: { from: 'courses', localField: '_id.course', foreignField: '_id', as: 'course' } },
  { $unwind: '$course' },
  {
    $project: {
      _id: 0,
      studentId: '$student._id',
      rollNumber: '$student.rollNumber',
      name: '$user.name',
      email: '$user.email',
      courseId: '$course._id',
      courseCode: '$course.code',
      courseTitle: '$course.title',
      totalClasses: 1,
      attended: 1,
      absent: 1,
      late: 1,
      excused: 1,
      percentage: 1,
    },
  },
];

const csvColumns = [
  { label: 'Roll Number', value: 'rollNumber' },
  { label: 'Name', value: 'name' },
  { label: 'Course', value: 'courseCode' },
  { label: 'Total Classes', value: 'totalClasses' },
  { label: 'Attended', value: 'attended' },
  { label: 'Absent', value: 'absent' },
  { label: 'Percentage', value: 'percentage' },
];

// PIPELINE 1 - GET /api/reports/attendance-summary?course=&section=&from=&to=&format=csv
// Subject-wise attendance (total classes, attended, %) for every student.
exports.attendanceSummary = async (req, res) => {
  const pipeline = [{ $match: await attendanceMatch(req) }, ...summaryStages(), ...enrichStages, { $sort: { courseCode: 1, rollNumber: 1 } }];
  const rows = await Attendance.aggregate(pipeline);
  if (req.query.format === 'csv') return sendCsv(res, 'attendance-summary.csv', rows, csvColumns);
  return sendSuccess(res, { data: rows, meta: { total: rows.length } });
};

// PIPELINE 2 - GET /api/reports/low-attendance?threshold=75&course=&section=&format=csv
// Students whose attendance percentage is below a configurable threshold.
exports.lowAttendance = async (req, res) => {
  const threshold = req.query.threshold !== undefined ? Number(req.query.threshold) : config.attendance.threshold;
  const pipeline = [
    { $match: await attendanceMatch(req) },
    ...summaryStages(),
    { $match: { percentage: { $lt: threshold } } },
    ...enrichStages,
    { $sort: { percentage: 1, rollNumber: 1 } },
  ];
  const rows = await Attendance.aggregate(pipeline);
  if (req.query.format === 'csv') return sendCsv(res, `low-attendance-below-${threshold}.csv`, rows, csvColumns);
  return sendSuccess(res, { data: rows, meta: { threshold, total: rows.length } });
};

// PIPELINE 3 - GET /api/reports/enrollment-counts?department=&semester=  (admin)
// Enrolment count per course plus department-level totals, using $lookup and $facet.
exports.enrollmentCounts = async (req, res) => {
  const match = {};
  if (req.query.department) match.department = req.query.department;
  if (req.query.semester) match.semester = Number(req.query.semester);

  const [result] = await Course.aggregate([
    { $match: match },
    {
      $lookup: {
        from: 'enrollments',
        let: { courseId: '$_id' },
        pipeline: [{ $match: { $expr: { $eq: ['$course', '$$courseId'] } } }, { $group: { _id: '$status', count: { $sum: 1 } } }],
        as: 'enrollmentsByStatus',
      },
    },
    { $lookup: { from: 'sections', localField: '_id', foreignField: 'course', as: 'sections' } },
    {
      $addFields: {
        activeEnrollments: {
          $sum: { $map: { input: { $filter: { input: '$enrollmentsByStatus', cond: { $eq: ['$$this._id', 'active'] } } }, in: '$$this.count' } },
        },
        totalEnrollments: { $sum: '$enrollmentsByStatus.count' },
        sectionCount: { $size: '$sections' },
        totalCapacity: { $sum: '$sections.capacity' },
      },
    },
    {
      $facet: {
        courses: [
          {
            $project: {
              _id: 0,
              courseId: '$_id',
              code: 1,
              title: 1,
              department: 1,
              semester: 1,
              sectionCount: 1,
              totalCapacity: 1,
              activeEnrollments: 1,
              totalEnrollments: 1,
              fillRate: {
                $cond: [{ $gt: ['$totalCapacity', 0] }, { $round: [{ $multiply: [{ $divide: ['$activeEnrollments', '$totalCapacity'] }, 100] }, 1] }, 0],
              },
            },
          },
          { $sort: { activeEnrollments: -1, code: 1 } },
        ],
        byDepartment: [
          { $group: { _id: '$department', courses: { $sum: 1 }, activeEnrollments: { $sum: '$activeEnrollments' } } },
          { $project: { _id: 0, department: '$_id', courses: 1, activeEnrollments: 1 } },
          { $sort: { activeEnrollments: -1 } },
        ],
        totals: [{ $group: { _id: null, courses: { $sum: 1 }, activeEnrollments: { $sum: '$activeEnrollments' } } }, { $project: { _id: 0 } }],
      },
    },
  ]);

  sendSuccess(res, { data: { ...result, totals: result.totals[0] || { courses: 0, activeEnrollments: 0 } } });
};

// PIPELINE 4 - GET /api/reports/section-summary?course=&academicYear=
// Per section: course, faculty, enrolled students, classes held and average attendance %.
exports.sectionSummary = async (req, res) => {
  const match = {};
  if (req.query.course) match.course = toId(req.query.course);
  if (req.query.academicYear) match.academicYear = req.query.academicYear;
  if (req.user.role === ROLES.FACULTY) match.faculty = req.faculty._id;

  const rows = await Section.aggregate([
    { $match: match },
    { $lookup: { from: 'courses', localField: 'course', foreignField: '_id', as: 'course' } },
    { $unwind: '$course' },
    { $lookup: { from: 'faculties', localField: 'faculty', foreignField: '_id', as: 'faculty' } },
    { $unwind: { path: '$faculty', preserveNullAndEmptyArrays: true } },
    { $lookup: { from: 'users', localField: 'faculty.user', foreignField: '_id', as: 'facultyUser' } },
    { $unwind: { path: '$facultyUser', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: 'enrollments',
        let: { sectionId: '$_id' },
        pipeline: [{ $match: { $expr: { $and: [{ $eq: ['$section', '$$sectionId'] }, { $eq: ['$status', 'active'] }] } } }, { $count: 'n' }],
        as: 'enrolled',
      },
    },
    {
      $lookup: {
        from: 'attendances',
        let: { sectionId: '$_id' },
        pipeline: [
          { $match: { $expr: { $eq: ['$section', '$$sectionId'] } } },
          {
            $group: {
              _id: null,
              sessions: { $addToSet: { date: '$date', period: '$period' } },
              records: { $sum: 1 },
              attended: { $sum: { $cond: [{ $in: ['$status', ATTENDED_STATUSES] }, 1, 0] } },
            },
          },
        ],
        as: 'att',
      },
    },
    { $unwind: { path: '$att', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        _id: 0,
        sectionId: '$_id',
        section: '$name',
        academicYear: 1,
        courseCode: '$course.code',
        courseTitle: '$course.title',
        faculty: { $ifNull: ['$facultyUser.name', 'Unassigned'] },
        capacity: 1,
        enrolled: { $ifNull: [{ $arrayElemAt: ['$enrolled.n', 0] }, 0] },
        classesHeld: { $size: { $ifNull: ['$att.sessions', []] } },
        averageAttendance: {
          $cond: [{ $gt: [{ $ifNull: ['$att.records', 0] }, 0] }, { $round: [{ $multiply: [{ $divide: ['$att.attended', '$att.records'] }, 100] }, 2] }, null],
        },
      },
    },
    { $sort: { courseCode: 1, section: 1 } },
  ]);

  sendSuccess(res, { data: rows, meta: { total: rows.length } });
};
