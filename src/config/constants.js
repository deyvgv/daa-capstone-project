// Shared enums used by models, validators and controllers.
const ROLES = Object.freeze({
  ADMIN: 'admin',
  FACULTY: 'faculty',
  STUDENT: 'student',
});

const ATTENDANCE_STATUS = Object.freeze(['present', 'absent', 'late', 'excused']);
// Statuses that count as "attended" when calculating attendance percentage.
const ATTENDED_STATUSES = Object.freeze(['present', 'late']);

const ANNOUNCEMENT_SCOPES = Object.freeze(['university', 'course', 'section']);
const ANNOUNCEMENT_PRIORITIES = Object.freeze(['low', 'normal', 'high']);

const ENROLLMENT_STATUS = Object.freeze(['active', 'dropped', 'completed']);

const DEPARTMENTS = Object.freeze(['CSE', 'ECE', 'ME', 'CE', 'EEE', 'IT', 'MBA', 'MATH', 'PHY']);

module.exports = {
  ROLES,
  ATTENDANCE_STATUS,
  ATTENDED_STATUSES,
  ANNOUNCEMENT_SCOPES,
  ANNOUNCEMENT_PRIORITIES,
  ENROLLMENT_STATUS,
  DEPARTMENTS,
};
