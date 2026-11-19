// Reusable authorization checks that depend on data (not just on the role).
const ApiError = require('../utils/ApiError');
const { Section, Enrollment } = require('../models');
const { ROLES } = require('../config/constants');

// Returns the section, or throws 404. Throws 403 if a faculty member is not assigned to it.
async function getSectionForStaff(req, sectionId) {
  const section = await Section.findById(sectionId);
  if (!section) throw ApiError.notFound('Section not found');
  if (req.user.role === ROLES.FACULTY) {
    if (!req.faculty || !section.faculty || !section.faculty.equals(req.faculty._id)) {
      throw ApiError.forbidden('You are not assigned to this section');
    }
  }
  return section;
}

// IDs of the sections a faculty member teaches.
async function facultySectionIds(facultyId) {
  return Section.find({ faculty: facultyId }).distinct('_id');
}

// Active enrollments of a student: used to decide which announcements / rooms they can see.
async function studentEnrollments(studentId) {
  return Enrollment.find({ student: studentId, status: 'active' }).select('course section').lean();
}

// Course + section IDs that a user "belongs to" (used for announcements and Socket.IO rooms).
async function audienceFor(user, { student, faculty } = {}) {
  if (user.role === ROLES.STUDENT && student) {
    const enrollments = await studentEnrollments(student._id);
    return {
      courseIds: [...new Set(enrollments.map((e) => String(e.course)))],
      sectionIds: enrollments.map((e) => String(e.section)),
    };
  }
  if (user.role === ROLES.FACULTY && faculty) {
    const sections = await Section.find({ faculty: faculty._id }).select('course').lean();
    return {
      courseIds: [...new Set(sections.map((s) => String(s.course)))],
      sectionIds: sections.map((s) => String(s._id)),
    };
  }
  return { courseIds: [], sectionIds: [] };
}

module.exports = { getSectionForStaff, facultySectionIds, studentEnrollments, audienceFor };
