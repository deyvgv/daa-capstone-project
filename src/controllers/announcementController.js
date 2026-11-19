const ApiError = require('../utils/ApiError');
const { sendSuccess } = require('../utils/response');
const { getPagination, paginate } = require('../utils/pagination');
const { Announcement, Course, Section } = require('../models');
const { ROLES } = require('../config/constants');
const { audienceFor } = require('../services/accessService');
const { appEvents, EVENTS } = require('../events/appEvents');

// Mongo filter of the announcements a user is allowed to see.
async function visibilityFilter(req) {
  if (req.user.role === ROLES.ADMIN) return {};
  const { courseIds, sectionIds } = await audienceFor(req.user, req);
  return {
    $or: [{ scope: 'university' }, { scope: 'course', course: { $in: courseIds } }, { scope: 'section', section: { $in: sectionIds } }],
  };
}

const notExpired = () => ({ $or: [{ expiresAt: null }, { expiresAt: { $exists: false } }, { expiresAt: { $gt: new Date() } }] });

// POST /api/announcements
// Admin: any scope. Faculty: only course/section announcements for what they teach.
exports.create = async (req, res) => {
  const { title, body, scope, priority, expiresAt } = req.body;
  const doc = { title, body, scope, priority, expiresAt, createdBy: req.user._id };

  if (scope === 'course') {
    if (!(await Course.exists({ _id: req.body.course }))) throw ApiError.badRequest('Referenced course does not exist');
    doc.course = req.body.course;
  }
  if (scope === 'section') {
    const section = await Section.findById(req.body.section);
    if (!section) throw ApiError.badRequest('Referenced section does not exist');
    doc.section = section._id;
    doc.course = section.course;
  }

  if (req.user.role === ROLES.FACULTY) {
    if (scope === 'university') throw ApiError.forbidden('Only administrators can publish university-wide announcements');
    const { courseIds, sectionIds } = await audienceFor(req.user, req);
    if (scope === 'course' && !courseIds.includes(String(doc.course))) throw ApiError.forbidden('You do not teach this course');
    if (scope === 'section' && !sectionIds.includes(String(doc.section))) throw ApiError.forbidden('You are not assigned to this section');
  }

  const announcement = await Announcement.create(doc);
  await announcement.populate('createdBy', 'name role');

  // Internal event -> Socket.IO listener pushes it to the right rooms in real time.
  appEvents.emit(EVENTS.ANNOUNCEMENT_CREATED, announcement.toJSON());
  sendSuccess(res, { status: 201, message: 'Announcement published', data: announcement });
};

// GET /api/announcements?scope=&course=&section=&search=  - previous announcements (REST history)
exports.list = async (req, res) => {
  const conditions = [await visibilityFilter(req), notExpired()];
  const extra = {};
  ['scope', 'course', 'section'].forEach((f) => req.query[f] && (extra[f] = req.query[f]));
  if (req.query.search) extra.$text = { $search: req.query.search };
  conditions.push(extra);

  const pg = getPagination(req.query, { allowedSort: ['createdAt', 'priority', 'title'] });
  const { items, meta } = await paginate(Announcement, { $and: conditions }, pg, {
    populate: [
      { path: 'createdBy', select: 'name role' },
      { path: 'course', select: 'code title' },
      { path: 'section', select: 'name' },
    ],
  });
  sendSuccess(res, { data: items, meta });
};

exports.getById = async (req, res) => {
  const announcement = await Announcement.findOne({ $and: [{ _id: req.params.id }, await visibilityFilter(req)] })
    .populate('createdBy', 'name role')
    .populate('course', 'code title')
    .populate('section', 'name');
  if (!announcement) throw ApiError.notFound('Announcement not found');
  sendSuccess(res, { data: announcement });
};

async function findOwned(req) {
  const announcement = await Announcement.findById(req.params.id);
  if (!announcement) throw ApiError.notFound('Announcement not found');
  if (req.user.role !== ROLES.ADMIN && !announcement.createdBy.equals(req.user._id)) {
    throw ApiError.forbidden('Only the author or an administrator can modify this announcement');
  }
  return announcement;
}

exports.update = async (req, res) => {
  const announcement = await findOwned(req);
  ['title', 'body', 'priority', 'expiresAt'].forEach((f) => req.body[f] !== undefined && (announcement[f] = req.body[f]));
  await announcement.save();
  sendSuccess(res, { message: 'Announcement updated', data: announcement });
};

exports.remove = async (req, res) => {
  const announcement = await findOwned(req);
  await announcement.deleteOne();
  sendSuccess(res, { message: 'Announcement deleted' });
};
