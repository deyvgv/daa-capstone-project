const ApiError = require('../utils/ApiError');
const { sendSuccess } = require('../utils/response');
const { getPagination, paginate } = require('../utils/pagination');
const { Student, Section, Enrollment, Attendance, User } = require('../models');
const { appEvents, EVENTS } = require('../events/appEvents');

const populate = [
  { path: 'student', select: 'rollNumber department year', populate: { path: 'user', select: 'name email' } },
  { path: 'course', select: 'code title credits' },
  { path: 'section', select: 'name academicYear' },
];

// POST /api/enrollments { student, section } (admin)
// The course is taken from the section, so course and section can never disagree.
exports.create = async (req, res) => {
  const [student, section] = await Promise.all([Student.findById(req.body.student), Section.findById(req.body.section).populate('course')]);
  if (!student) throw ApiError.badRequest('Referenced student does not exist');
  if (!section) throw ApiError.badRequest('Referenced section does not exist');
  if (!section.course || !section.course.isActive) throw ApiError.badRequest('The course of this section is not active');

  const user = await User.findById(student.user).select('isActive');
  if (!user || !user.isActive) throw ApiError.badRequest('Student account is deactivated');

  const existing = await Enrollment.findOne({ student: student._id, course: section.course._id });
  if (existing) {
    throw ApiError.conflict('Student is already enrolled in this course', { enrollmentId: existing._id, section: existing.section });
  }

  const enrolled = await Enrollment.countDocuments({ section: section._id, status: 'active' });
  if (enrolled >= section.capacity) throw ApiError.conflict(`Section is full (capacity ${section.capacity})`);

  const enrollment = await Enrollment.create({ student: student._id, course: section.course._id, section: section._id, enrolledBy: req.user._id });
  await enrollment.populate(populate);

  appEvents.emit(EVENTS.ENROLLMENT_CREATED, { enrollment, userId: String(student.user) });
  sendSuccess(res, { status: 201, message: 'Student enrolled', data: enrollment });
};

// GET /api/enrollments?student=&course=&section=&status= (admin)
exports.list = async (req, res) => {
  const filter = {};
  ['student', 'course', 'section', 'status'].forEach((f) => req.query[f] && (filter[f] = req.query[f]));
  const pg = getPagination(req.query);
  const { items, meta } = await paginate(Enrollment, filter, pg, { populate });
  sendSuccess(res, { data: items, meta });
};

// GET /api/enrollments/me - the logged-in student's courses
exports.mine = async (req, res) => {
  const items = await Enrollment.find({ student: req.student._id })
    .populate('course', 'code title credits semester department')
    .populate({ path: 'section', select: 'name academicYear room faculty', populate: { path: 'faculty', select: 'employeeId', populate: { path: 'user', select: 'name email' } } })
    .sort('-createdAt')
    .lean();
  sendSuccess(res, { data: items, meta: { total: items.length } });
};

// PATCH /api/enrollments/:id { status } (admin) - e.g. mark as dropped / completed
exports.update = async (req, res) => {
  const enrollment = await Enrollment.findByIdAndUpdate(req.params.id, { status: req.body.status }, { returnDocument: 'after', runValidators: true }).populate(populate);
  if (!enrollment) throw ApiError.notFound('Enrollment not found');
  sendSuccess(res, { message: 'Enrollment updated', data: enrollment });
};

// DELETE /api/enrollments/:id (admin) - only when no attendance exists, otherwise mark it dropped
exports.remove = async (req, res) => {
  const enrollment = await Enrollment.findById(req.params.id);
  if (!enrollment) throw ApiError.notFound('Enrollment not found');
  if (await Attendance.exists({ student: enrollment.student, section: enrollment.section })) {
    throw ApiError.conflict('Attendance exists for this enrolment. Set status to "dropped" instead.');
  }
  await enrollment.deleteOne();
  sendSuccess(res, { message: 'Enrollment deleted' });
};
