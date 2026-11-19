const ApiError = require('../utils/ApiError');
const { sendSuccess } = require('../utils/response');
const { getPagination, buildMeta, escapeRegex } = require('../utils/pagination');
const { User, Student, Enrollment, Attendance, RefreshToken } = require('../models');
const { ROLES } = require('../config/constants');
const { facultySectionIds } = require('../services/accessService');

const PROFILE_FIELDS = ['rollNumber', 'department', 'year', 'batch', 'guardianPhone'];

// POST /api/students (admin) - creates the login account and the student profile together
exports.create = async (req, res) => {
  const { name, email, password, phone } = req.body;
  if (await User.exists({ email })) throw ApiError.conflict('Email is already registered');
  if (await Student.exists({ rollNumber: String(req.body.rollNumber).toUpperCase() })) throw ApiError.conflict('Roll number already exists');

  const user = await User.create({ name, email, password, phone, role: ROLES.STUDENT });
  try {
    const profile = {};
    PROFILE_FIELDS.forEach((f) => req.body[f] !== undefined && (profile[f] = req.body[f]));
    const student = await Student.create({ user: user._id, ...profile });
    await student.populate('user');
    sendSuccess(res, { status: 201, message: 'Student created', data: student });
  } catch (err) {
    await User.deleteOne({ _id: user._id });
    throw err;
  }
};

// GET /api/students?department=&year=&search=&page=&limit=  (admin, faculty)
// Faculty see only students enrolled in their own sections.
exports.list = async (req, res) => {
  const filter = {};
  if (req.query.department) filter.department = req.query.department;
  if (req.query.year) filter.year = Number(req.query.year);

  if (req.user.role === ROLES.FACULTY) {
    const sectionIds = await facultySectionIds(req.faculty._id);
    filter._id = { $in: await Enrollment.find({ section: { $in: sectionIds } }).distinct('student') };
  }

  if (req.query.search) {
    const rx = new RegExp(escapeRegex(req.query.search), 'i');
    const userIds = await User.find({ role: ROLES.STUDENT, $or: [{ name: rx }, { email: rx }] }).distinct('_id');
    filter.$or = [{ rollNumber: rx }, { user: { $in: userIds } }];
  }

  const pg = getPagination(req.query, { defaultSort: 'rollNumber', allowedSort: ['rollNumber', 'year', 'department', 'createdAt'] });
  const [items, total] = await Promise.all([
    Student.find(filter).populate('user', 'name email phone isActive').sort(pg.sort).skip(pg.skip).limit(pg.limit).lean(),
    Student.countDocuments(filter),
  ]);
  sendSuccess(res, { data: items, meta: buildMeta(pg, total) });
};

// GET /api/students/:id - admin, faculty of one of the student's sections, or the student themself
exports.getById = async (req, res) => {
  const student = await Student.findById(req.params.id).populate('user', 'name email phone isActive');
  if (!student) throw ApiError.notFound('Student not found');

  if (req.user.role === ROLES.STUDENT && !student._id.equals(req.student._id)) {
    throw ApiError.forbidden('Students can only view their own record');
  }
  if (req.user.role === ROLES.FACULTY) {
    const sectionIds = await facultySectionIds(req.faculty._id);
    const teaches = await Enrollment.exists({ student: student._id, section: { $in: sectionIds } });
    if (!teaches) throw ApiError.forbidden('This student is not enrolled in any of your sections');
  }

  const enrollments = await Enrollment.find({ student: student._id })
    .populate('course', 'code title credits')
    .populate('section', 'name academicYear')
    .lean();
  sendSuccess(res, { data: { ...student.toJSON(), enrollments } });
};

// PATCH /api/students/:id (admin)
exports.update = async (req, res) => {
  const student = await Student.findById(req.params.id);
  if (!student) throw ApiError.notFound('Student not found');

  PROFILE_FIELDS.forEach((f) => req.body[f] !== undefined && (student[f] = req.body[f]));
  await student.save();

  const userUpdate = {};
  ['name', 'phone'].forEach((f) => req.body[f] !== undefined && (userUpdate[f] = req.body[f]));
  if (Object.keys(userUpdate).length) await User.updateOne({ _id: student.user }, userUpdate, { runValidators: true });

  await student.populate('user', 'name email phone isActive');
  sendSuccess(res, { message: 'Student updated', data: student });
};

// DELETE /api/students/:id (admin)
// A student with attendance history cannot be hard-deleted; deactivate the account instead.
exports.remove = async (req, res) => {
  const student = await Student.findById(req.params.id);
  if (!student) throw ApiError.notFound('Student not found');
  if (await Attendance.exists({ student: student._id })) {
    throw ApiError.conflict('Student has attendance records. Deactivate the user account instead (DELETE /api/users/:id).');
  }
  await Promise.all([
    Enrollment.deleteMany({ student: student._id }),
    RefreshToken.deleteMany({ user: student.user }),
    User.deleteOne({ _id: student.user }),
    Student.deleteOne({ _id: student._id }),
  ]);
  sendSuccess(res, { message: 'Student deleted' });
};
