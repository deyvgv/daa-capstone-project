const mongoose = require('mongoose');
const { ATTENDANCE_STATUS } = require('../config/constants');

// Audit trail: every correction of an attendance record is logged here and never edited.
const attendanceAuditSchema = new mongoose.Schema(
  {
    attendance: { type: mongoose.Schema.Types.ObjectId, ref: 'Attendance', required: true, index: true },
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    oldStatus: { type: String, enum: ATTENDANCE_STATUS, required: true },
    newStatus: { type: String, enum: ATTENDANCE_STATUS, required: true },
    reason: { type: String, required: true, trim: true, minlength: 5, maxlength: 300 },
  },
  { timestamps: { createdAt: 'changedAt', updatedAt: false } }
);

attendanceAuditSchema.set('toJSON', { versionKey: false });

module.exports = mongoose.model('AttendanceAudit', attendanceAuditSchema);
