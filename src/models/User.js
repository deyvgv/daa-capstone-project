const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const config = require('../config/env');
const { ROLES } = require('../config/constants');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, 'Name is required'], trim: true, minlength: 2, maxlength: 100 },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true, // creates a unique index
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Email is invalid'],
    },
    password: { type: String, required: true, minlength: 8, select: false },
    role: { type: String, enum: Object.values(ROLES), default: ROLES.STUDENT, index: true },
    phone: { type: String, trim: true, match: [/^[0-9+\-\s]{7,15}$/, 'Phone number is invalid'] },
    isActive: { type: Boolean, default: true },
    // Incremented on logout / password change. Access tokens carry this value, so bumping it
    // immediately invalidates every token issued before.
    tokenVersion: { type: Number, default: 0, select: false },
    lastLoginAt: Date,
  },
  { timestamps: true }
);

// Hash the password with bcrypt whenever it is created or changed.
userSchema.pre('save', async function hashPassword() {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, config.bcryptRounds);
});

userSchema.methods.comparePassword = function comparePassword(candidate) {
  return bcrypt.compare(candidate, this.password);
};

// Never leak secrets in JSON responses.
userSchema.set('toJSON', {
  transform(doc, ret) {
    delete ret.password;
    delete ret.tokenVersion;
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model('User', userSchema);
