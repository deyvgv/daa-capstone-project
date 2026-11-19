const mongoose = require('mongoose');
const { DEPARTMENTS } = require('../config/constants');

// Professional profile of a faculty member. 1:1 with a User whose role is "faculty".
const facultySchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    employeeId: {
      type: String,
      required: [true, 'Employee ID is required'],
      unique: true,
      uppercase: true,
      trim: true,
      match: [/^[A-Z0-9-]{3,20}$/, 'Employee ID must be 3-20 letters, digits or dashes'],
    },
    department: { type: String, required: true, enum: DEPARTMENTS, index: true },
    designation: {
      type: String,
      enum: ['Professor', 'Associate Professor', 'Assistant Professor', 'Lecturer'],
      default: 'Assistant Professor',
    },
    specialization: { type: String, trim: true },
  },
  { timestamps: true }
);

facultySchema.set('toJSON', { versionKey: false });

module.exports = mongoose.model('Faculty', facultySchema);
