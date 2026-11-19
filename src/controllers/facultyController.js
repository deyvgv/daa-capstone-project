const ApiError = require('../utils/ApiError');
const { sendSuccess } = require('../utils/response');
const { getPagination, buildMeta, escapeRegex } = require('../utils/pagination');
const { User, Faculty, Section, RefreshToken } = require('../models');
const { ROLES } = require('../config/constants');

const PROFILE_FIELDS = ['employeeId', 'department', 'designation', 'specialization'];

// POST /api/faculty (admin)
exports.create = async (req, res) => {
  const { name, email, password, phone } = req.body;
  if (await User.exists({ email })) throw ApiError.conflict('Email is already registered');
  if (await Faculty.exists({ employeeId: String(req.body.employeeId).toUpperCase() })) throw ApiError.conflict('Employee ID already exists');

  const user = await User.create({ name, email, password, phone, role: ROLES.FACULTY });
  try {
    const profile = {};
    PROFILE_FIELDS.forEach((f) => req.body[f] !== undefined && (profile[f] = req.body[f]));
    const faculty = await Faculty.create({ user: user._id, ...profile });
    await faculty.populate('user');
    sendSuccess(res, { status: 201, message: 'Faculty member created', data: faculty });
  } catch (err) {
    await User.deleteOne({ _id: user._id });
    throw err;
  }
};

// GET /api/faculty?department=&search= (admin)
exports.list = async (req, res) => {
  const filter = {};
  if (req.query.department) filter.department = req.query.department;
  if (req.query.search) {
    const rx = new RegExp(escapeRegex(req.query.search), 'i');
    const userIds = await User.find({ role: ROLES.FACULTY, $or: [{ name: rx }, { email: rx }] }).distinct('_id');
    filter.$or = [{ employeeId: rx }, { user: { $in: userIds } }];
  }
  const pg = getPagination(req.query, { defaultSort: 'employeeId', allowedSort: ['employeeId', 'department', 'createdAt'] });
  const [items, total] = await Promise.all([
    Faculty.find(filter).populate('user', 'name email phone isActive').sort(pg.sort).skip(pg.skip).limit(pg.limit).lean(),
    Faculty.countDocuments(filter),
  ]);
  sendSuccess(res, { data: items, meta: buildMeta(pg, total) });
};

// GET /api/faculty/:id (admin, or the faculty member themself)
exports.getById = async (req, res) => {
  const faculty = await Faculty.findById(req.params.id).populate('user', 'name email phone isActive');
  if (!faculty) throw ApiError.notFound('Faculty member not found');
  if (req.user.role === ROLES.FACULTY && !faculty._id.equals(req.faculty._id)) throw ApiError.forbidden('You can only view your own record');

  const sections = await Section.find({ faculty: faculty._id }).populate('course', 'code title').lean();
  sendSuccess(res, { data: { ...faculty.toJSON(), sections } });
};

// PATCH /api/faculty/:id (admin)
exports.update = async (req, res) => {
  const faculty = await Faculty.findById(req.params.id);
  if (!faculty) throw ApiError.notFound('Faculty member not found');
  PROFILE_FIELDS.forEach((f) => req.body[f] !== undefined && (faculty[f] = req.body[f]));
  await faculty.save();

  const userUpdate = {};
  ['name', 'phone'].forEach((f) => req.body[f] !== undefined && (userUpdate[f] = req.body[f]));
  if (Object.keys(userUpdate).length) await User.updateOne({ _id: faculty.user }, userUpdate, { runValidators: true });

  await faculty.populate('user', 'name email phone isActive');
  sendSuccess(res, { message: 'Faculty member updated', data: faculty });
};

// DELETE /api/faculty/:id (admin) - blocked while the faculty member still teaches sections
exports.remove = async (req, res) => {
  const faculty = await Faculty.findById(req.params.id);
  if (!faculty) throw ApiError.notFound('Faculty member not found');
  const count = await Section.countDocuments({ faculty: faculty._id });
  if (count) throw ApiError.conflict(`Faculty member is assigned to ${count} section(s). Reassign them first.`);

  await Promise.all([RefreshToken.deleteMany({ user: faculty.user }), User.deleteOne({ _id: faculty.user }), Faculty.deleteOne({ _id: faculty._id })]);
  sendSuccess(res, { message: 'Faculty member deleted' });
};
