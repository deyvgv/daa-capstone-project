const mongoose = require('mongoose');
const { ANNOUNCEMENT_SCOPES, ANNOUNCEMENT_PRIORITIES } = require('../config/constants');

const announcementSchema = new mongoose.Schema(
  {
    title: { type: String, required: [true, 'Title is required'], trim: true, maxlength: 150 },
    body: { type: String, required: [true, 'Body is required'], trim: true, maxlength: 5000 },
    scope: { type: String, enum: ANNOUNCEMENT_SCOPES, required: true },
    // Required only for course / section scoped announcements.
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Course',
      required() {
        return this.scope === 'course';
      },
    },
    section: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Section',
      required() {
        return this.scope === 'section';
      },
    },
    priority: { type: String, enum: ANNOUNCEMENT_PRIORITIES, default: 'normal' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    expiresAt: Date,
  },
  { timestamps: true }
);

// Feed queries filter by scope/target and sort by newest first.
announcementSchema.index({ scope: 1, course: 1, section: 1, createdAt: -1 });
announcementSchema.index({ title: 'text', body: 'text' });

announcementSchema.set('toJSON', { versionKey: false });

module.exports = mongoose.model('Announcement', announcementSchema);
