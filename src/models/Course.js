const mongoose = require('mongoose');
const { DEPARTMENTS } = require('../config/constants');

const courseSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: [true, 'Course code is required'],
      unique: true,
      uppercase: true,
      trim: true,
      match: [/^[A-Z]{2,5}[0-9]{3,4}$/, 'Course code must look like CS101 or MATH2001'],
    },
    title: { type: String, required: [true, 'Course title is required'], trim: true, maxlength: 150 },
    description: { type: String, trim: true, maxlength: 1000 },
    department: { type: String, required: true, enum: DEPARTMENTS },
    credits: { type: Number, required: true, min: 1, max: 6 },
    semester: { type: Number, required: true, min: 1, max: 10 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

courseSchema.index({ department: 1, semester: 1 });
// Text index for searching courses by title / description.
courseSchema.index({ title: 'text', description: 'text' });

courseSchema.set('toJSON', { versionKey: false });

module.exports = mongoose.model('Course', courseSchema);
