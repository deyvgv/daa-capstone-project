const mongoose = require('mongoose');
const { DEPARTMENTS } = require('../config/constants');

// Academic profile of a student. 1:1 with a User whose role is "student".
const studentSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    rollNumber: {
      type: String,
      required: [true, 'Roll number is required'],
      unique: true,
      uppercase: true,
      trim: true,
      match: [/^[A-Z0-9-]{3,20}$/, 'Roll number must be 3-20 letters, digits or dashes'],
    },
    department: { type: String, required: true, enum: DEPARTMENTS },
    year: { type: Number, required: true, min: 1, max: 5 },
    batch: { type: String, trim: true }, // e.g. "2023-2027"
    guardianPhone: { type: String, trim: true },
  },
  { timestamps: true }
);

// Compound index used by the student list filter (department + year).
studentSchema.index({ department: 1, year: 1 });

studentSchema.set('toJSON', { versionKey: false });

module.exports = mongoose.model('Student', studentSchema);
