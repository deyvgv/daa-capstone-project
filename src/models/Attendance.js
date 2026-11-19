const mongoose = require('mongoose');
const { ATTENDANCE_STATUS } = require('../config/constants');

// One document = one student's attendance in one class session.
// A class session is identified by (section, date, period).
const attendanceSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
    section: { type: mongoose.Schema.Types.ObjectId, ref: 'Section', required: true },
    date: { type: Date, required: true }, // normalised to 00:00 UTC
    period: { type: Number, default: 1, min: 1, max: 12 },
    status: { type: String, enum: ATTENDANCE_STATUS, required: true },
    markedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    lastModifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    correctionCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Business rule: no duplicate attendance for the same student and class session.
attendanceSchema.index({ student: 1, section: 1, date: 1, period: 1 }, { unique: true });
// Used by student attendance views and aggregation reports.
attendanceSchema.index({ student: 1, course: 1, date: -1 });
attendanceSchema.index({ section: 1, date: -1 });

attendanceSchema.set('toJSON', { versionKey: false });

module.exports = mongoose.model('Attendance', attendanceSchema);
