const mongoose = require('mongoose');
const { Attendance } = require('../models');
const { ATTENDED_STATUSES } = require('../config/constants');

const toId = (v) => (v instanceof mongoose.Types.ObjectId ? v : new mongoose.Types.ObjectId(String(v)));

// Aggregation stages that turn attendance documents into
// { student, course, totalClasses, attended, absent, percentage } per student per course.
function summaryStages() {
  return [
    {
      $group: {
        _id: { student: '$student', course: '$course' },
        totalClasses: { $sum: 1 },
        attended: { $sum: { $cond: [{ $in: ['$status', ATTENDED_STATUSES] }, 1, 0] } },
        absent: { $sum: { $cond: [{ $eq: ['$status', 'absent'] }, 1, 0] } },
        late: { $sum: { $cond: [{ $eq: ['$status', 'late'] }, 1, 0] } },
        excused: { $sum: { $cond: [{ $eq: ['$status', 'excused'] }, 1, 0] } },
        lastClass: { $max: '$date' },
      },
    },
    {
      $addFields: {
        // Excused classes are not counted against the student.
        countedClasses: { $subtract: ['$totalClasses', '$excused'] },
      },
    },
    {
      $addFields: {
        percentage: {
          $cond: [{ $gt: ['$countedClasses', 0] }, { $round: [{ $multiply: [{ $divide: ['$attended', '$countedClasses'] }, 100] }, 2] }, 100],
        },
      },
    },
  ];
}

// Subject-wise summary for one student (used by GET /api/attendance/me/summary).
async function studentSummary(studentId) {
  return Attendance.aggregate([
    { $match: { student: toId(studentId) } },
    ...summaryStages(),
    { $lookup: { from: 'courses', localField: '_id.course', foreignField: '_id', as: 'course' } },
    { $unwind: '$course' },
    {
      $project: {
        _id: 0,
        courseId: '$course._id',
        courseCode: '$course.code',
        courseTitle: '$course.title',
        totalClasses: 1,
        attended: 1,
        absent: 1,
        late: 1,
        excused: 1,
        percentage: 1,
        lastClass: 1,
      },
    },
    { $sort: { courseCode: 1 } },
  ]);
}

// Attendance % of specific students in one course (used for low-attendance alerts after marking).
async function percentagesFor(courseId, studentIds) {
  const rows = await Attendance.aggregate([
    { $match: { course: toId(courseId), student: { $in: studentIds.map(toId) } } },
    ...summaryStages(),
    { $project: { _id: 0, student: '$_id.student', totalClasses: 1, attended: 1, percentage: 1 } },
  ]);
  return rows;
}

module.exports = { summaryStages, studentSummary, percentagesFor, toId };
