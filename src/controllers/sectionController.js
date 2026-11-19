const ApiError = require('../utils/ApiError');
const { sendSuccess } = require('../utils/response');
const { getPagination, paginate } = require('../utils/pagination');
const { Course, Section, Faculty, Enrollment, Attendance } = require('../models');
const { getSectionForStaff } = require('../services/accessService');

const facultyPopulate = { path: 'faculty', select: 'employeeId department', populate: { path: 'user', select: 'name email' } };

// GET /api/sections?course=&faculty=&academicYear=
exports.list = async (req, res) => {
  const filter = {};
  ['course', 'faculty', 'academicYear'].forEach((f) => req.query[f] && (filter[f] = req.query[f]));
  const pg = getPagination(req.query, { defaultSort: 'name', allowedSort: ['name', 'academicYear', 'createdAt'] });
  const { items, meta } = await paginate(Section, filter, pg, { populate: [{ path: 'course', select: 'code title' }, facultyPopulate] });
  sendSuccess(res, { data: items, meta });
};

// GET /api/sections/mine - sections assigned to the logged-in faculty member
exports.mine = async (req, res) => {
  const sections = await Section.find({ faculty: req.faculty._id }).populate('course', 'code title credits').sort('name').lean();
  sendSuccess(res, { data: sections });
};

exports.getById = async (req, res) => {
  const section = await Section.findById(req.params.id).populate('course').populate(facultyPopulate).lean();
  if (!section) throw ApiError.notFound('Section not found');
  const enrolledCount = await Enrollment.countDocuments({ section: section._id, status: 'active' });
  sendSuccess(res, { data: { ...section, enrolledCount } });
};

// GET /api/sections/:id/students - class list (admin, or the assigned faculty member)
exports.students = async (req, res) => {
  const section = await getSectionForStaff(req, req.params.id);
  const enrollments = await Enrollment.find({ section: section._id, status: 'active' })
    .populate({ path: 'student', select: 'rollNumber department year', populate: { path: 'user', select: 'name email' } })
    .lean();
  const students = enrollments.map((e) => e.student).sort((a, b) => a.rollNumber.localeCompare(b.rollNumber));
  sendSuccess(res, { data: students, meta: { total: students.length } });
};

async function assertFacultyExists(facultyId) {
  if (!facultyId) return;
  if (!(await Faculty.exists({ _id: facultyId }))) throw ApiError.badRequest('Referenced faculty does not exist');
}

exports.create = async (req, res) => {
  const { course, name, academicYear, faculty, capacity, room } = req.body;
  if (!(await Course.exists({ _id: course }))) throw ApiError.badRequest('Referenced course does not exist');
  await assertFacultyExists(faculty);
  const section = await Section.create({ course, name, academicYear, faculty: faculty || null, capacity, room });
  sendSuccess(res, { status: 201, message: 'Section created', data: section });
};

exports.update = async (req, res) => {
  const section = await Section.findById(req.params.id);
  if (!section) throw ApiError.notFound('Section not found');
  if (req.body.capacity !== undefined) {
    const enrolled = await Enrollment.countDocuments({ section: section._id, status: 'active' });
    if (req.body.capacity < enrolled) throw ApiError.conflict(`Capacity cannot be lower than the ${enrolled} students already enrolled`);
  }
  ['name', 'academicYear', 'capacity', 'room'].forEach((f) => req.body[f] !== undefined && (section[f] = req.body[f]));
  await section.save();
  sendSuccess(res, { message: 'Section updated', data: section });
};

// PATCH /api/sections/:id/faculty - assign a faculty member to a section (admin)
exports.assignFaculty = async (req, res) => {
  await assertFacultyExists(req.body.faculty);
  const section = await Section.findByIdAndUpdate(req.params.id, { faculty: req.body.faculty }, { returnDocument: 'after' }).populate(facultyPopulate);
  if (!section) throw ApiError.notFound('Section not found');
  sendSuccess(res, { message: 'Faculty assigned to section', data: section });
};

exports.remove = async (req, res) => {
  const section = await Section.findById(req.params.id);
  if (!section) throw ApiError.notFound('Section not found');
  if ((await Enrollment.exists({ section: section._id })) || (await Attendance.exists({ section: section._id }))) {
    throw ApiError.conflict('Section has enrolments or attendance records and cannot be deleted');
  }
  await section.deleteOne();
  sendSuccess(res, { message: 'Section deleted' });
};
