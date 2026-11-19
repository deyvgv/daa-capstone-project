const ApiError = require('../utils/ApiError');
const { sendSuccess } = require('../utils/response');
const { getPagination, paginate } = require('../utils/pagination');
const { Course, Section, Enrollment } = require('../models');
const { ROLES } = require('../config/constants');

const FIELDS = ['code', 'title', 'description', 'department', 'credits', 'semester', 'isActive'];
const pick = (body) => FIELDS.reduce((acc, f) => (body[f] !== undefined ? { ...acc, [f]: body[f] } : acc), {});

// GET /api/courses?department=&semester=&search=  (all authenticated users)
exports.list = async (req, res) => {
  const filter = {};
  if (req.query.department) filter.department = req.query.department;
  if (req.query.semester) filter.semester = Number(req.query.semester);
  if (req.query.search) filter.$text = { $search: req.query.search };
  // Non-admins only see active courses.
  if (req.user.role !== ROLES.ADMIN) filter.isActive = true;

  const pg = getPagination(req.query, { defaultSort: 'code', allowedSort: ['code', 'title', 'semester', 'credits', 'createdAt'] });
  const { items, meta } = await paginate(Course, filter, pg);
  sendSuccess(res, { data: items, meta });
};

exports.getById = async (req, res) => {
  const course = await Course.findById(req.params.id).lean();
  if (!course) throw ApiError.notFound('Course not found');
  const sections = await Section.find({ course: course._id })
    .populate({ path: 'faculty', select: 'employeeId', populate: { path: 'user', select: 'name' } })
    .lean();
  sendSuccess(res, { data: { ...course, sections } });
};

exports.create = async (req, res) => {
  const course = await Course.create(pick(req.body));
  sendSuccess(res, { status: 201, message: 'Course created', data: course });
};

exports.update = async (req, res) => {
  const course = await Course.findByIdAndUpdate(req.params.id, pick(req.body), { returnDocument: 'after', runValidators: true });
  if (!course) throw ApiError.notFound('Course not found');
  sendSuccess(res, { message: 'Course updated', data: course });
};

// Deleting a course that has enrolments would orphan attendance data -> 409.
exports.remove = async (req, res) => {
  const course = await Course.findById(req.params.id);
  if (!course) throw ApiError.notFound('Course not found');
  if (await Enrollment.exists({ course: course._id })) {
    throw ApiError.conflict('Course has enrolments. Set isActive=false instead of deleting it.');
  }
  await Section.deleteMany({ course: course._id });
  await course.deleteOne();
  sendSuccess(res, { message: 'Course and its sections deleted' });
};
