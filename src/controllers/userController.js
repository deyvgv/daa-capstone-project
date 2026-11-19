const ApiError = require('../utils/ApiError');
const { sendSuccess } = require('../utils/response');
const { getPagination, paginate, escapeRegex } = require('../utils/pagination');
const { User, Student, Faculty, RefreshToken } = require('../models');
const { ROLES } = require('../config/constants');

// GET /api/users/me - own account + role profile
exports.getMe = async (req, res) => {
  const profile = req.student || req.faculty || null;
  sendSuccess(res, { data: { user: req.user, profile } });
};

// PATCH /api/users/me - only name and phone may be changed by the user
exports.updateMe = async (req, res) => {
  const { name, phone } = req.body;
  if (name !== undefined) req.user.name = name;
  if (phone !== undefined) req.user.phone = phone;
  await req.user.save();
  sendSuccess(res, { message: 'Profile updated', data: { user: req.user } });
};

// PATCH /api/users/me/password - change password and revoke all existing tokens
exports.changePassword = async (req, res) => {
  const user = await User.findById(req.user._id).select('+password +tokenVersion');
  if (!(await user.comparePassword(req.body.currentPassword))) throw ApiError.badRequest('Current password is incorrect');
  user.password = req.body.newPassword;
  user.tokenVersion += 1;
  await user.save();
  await RefreshToken.updateMany({ user: user._id, revokedAt: null }, { revokedAt: new Date() });
  sendSuccess(res, { message: 'Password changed. Please log in again.' });
};

// ---------- Administrator routes ----------

// GET /api/users?role=&isActive=&search=&page=&limit=
exports.list = async (req, res) => {
  const filter = {};
  if (req.query.role) filter.role = req.query.role;
  if (req.query.isActive !== undefined) filter.isActive = req.query.isActive === 'true';
  if (req.query.search) {
    const rx = new RegExp(escapeRegex(req.query.search), 'i');
    filter.$or = [{ name: rx }, { email: rx }];
  }
  const pg = getPagination(req.query, { allowedSort: ['name', 'email', 'createdAt', 'role'] });
  const { items, meta } = await paginate(User, filter, pg, { select: '-password -tokenVersion -__v' });
  sendSuccess(res, { data: items, meta });
};

exports.getById = async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw ApiError.notFound('User not found');
  let profile = null;
  if (user.role === ROLES.STUDENT) profile = await Student.findOne({ user: user._id });
  if (user.role === ROLES.FACULTY) profile = await Faculty.findOne({ user: user._id });
  sendSuccess(res, { data: { user, profile } });
};

// POST /api/users - create another administrator (students/faculty have their own endpoints)
exports.createAdmin = async (req, res) => {
  const { name, email, password, phone } = req.body;
  if (await User.exists({ email })) throw ApiError.conflict('Email is already registered');
  const user = await User.create({ name, email, password, phone, role: ROLES.ADMIN });
  sendSuccess(res, { status: 201, message: 'Administrator created', data: user });
};

// PATCH /api/users/:id - update name/phone or activate/deactivate an account
exports.update = async (req, res) => {
  const user = await User.findById(req.params.id).select('+tokenVersion');
  if (!user) throw ApiError.notFound('User not found');
  if (user._id.equals(req.user._id) && req.body.isActive === false) throw ApiError.badRequest('You cannot deactivate your own account');

  ['name', 'phone', 'isActive'].forEach((f) => {
    if (req.body[f] !== undefined) user[f] = req.body[f];
  });
  if (req.body.isActive === false) user.tokenVersion += 1; // force sign-out
  await user.save();
  sendSuccess(res, { message: 'User updated', data: user });
};

// DELETE /api/users/:id - soft delete (deactivate) to preserve attendance history
exports.remove = async (req, res) => {
  if (req.params.id === String(req.user._id)) throw ApiError.badRequest('You cannot delete your own account');
  const user = await User.findByIdAndUpdate(req.params.id, { isActive: false, $inc: { tokenVersion: 1 } }, { returnDocument: 'after' });
  if (!user) throw ApiError.notFound('User not found');
  await RefreshToken.updateMany({ user: user._id, revokedAt: null }, { revokedAt: new Date() });
  sendSuccess(res, { message: 'User deactivated', data: user });
};
