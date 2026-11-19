const mongoose = require('mongoose');

// A section is one teaching group of a course (e.g. CS101 - Section A, 2025-26),
// taught by one assigned faculty member.
const sectionSchema = new mongoose.Schema(
  {
    course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
    name: {
      type: String,
      required: [true, 'Section name is required'],
      uppercase: true,
      trim: true,
      match: [/^[A-Z0-9]{1,5}$/, 'Section name must be 1-5 letters/digits, e.g. A'],
    },
    academicYear: {
      type: String,
      required: true,
      match: [/^\d{4}-\d{2}$/, 'Academic year must look like 2025-26'],
    },
    faculty: { type: mongoose.Schema.Types.ObjectId, ref: 'Faculty', default: null, index: true },
    capacity: { type: Number, default: 60, min: 1, max: 500 },
    room: { type: String, trim: true },
  },
  { timestamps: true }
);

// A course cannot have two sections with the same name in the same academic year.
sectionSchema.index({ course: 1, name: 1, academicYear: 1 }, { unique: true });

sectionSchema.set('toJSON', { versionKey: false });

module.exports = mongoose.model('Section', sectionSchema);
