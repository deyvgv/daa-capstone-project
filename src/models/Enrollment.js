const mongoose = require('mongoose');
const { ENROLLMENT_STATUS } = require('../config/constants');

// Links a student to a course through one specific section.
const enrollmentSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
    section: { type: mongoose.Schema.Types.ObjectId, ref: 'Section', required: true },
    status: { type: String, enum: ENROLLMENT_STATUS, default: 'active' },
    enrolledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// Business rule: a student can be enrolled in a course only once (prevents duplicate enrolments).
enrollmentSchema.index({ student: 1, course: 1 }, { unique: true });
// Fast lookup of the class list of a section.
enrollmentSchema.index({ section: 1, status: 1 });

enrollmentSchema.set('toJSON', { versionKey: false });

module.exports = mongoose.model('Enrollment', enrollmentSchema);
