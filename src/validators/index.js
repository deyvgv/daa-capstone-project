// Request validation rules (express-validator). Each export is an array of chains
// passed to the validate() middleware in the route definitions.
const { body, param, query } = require('express-validator');
const { DEPARTMENTS, ROLES, ATTENDANCE_STATUS, ANNOUNCEMENT_SCOPES, ANNOUNCEMENT_PRIORITIES, ENROLLMENT_STATUS } = require('../config/constants');

const id = (name = 'id') => param(name).isMongoId().withMessage(`${name} must be a valid ObjectId`);
const refId = (name) => body(name).isMongoId().withMessage(`${name} must be a valid ObjectId`);

const password = (field = 'password') =>
  body(field)
    .isString()
    .isLength({ min: 8, max: 64 })
    .withMessage('Password must be 8-64 characters')
    .matches(/[A-Za-z]/)
    .withMessage('Password must contain a letter')
    .matches(/\d/)
    .withMessage('Password must contain a digit');

const userFields = [
  body('name').trim().isLength({ min: 2, max: 100 }).withMessage('Name must be 2-100 characters'),
  body('email').trim().isEmail().withMessage('A valid email is required').normalizeEmail({ gmail_remove_dots: false }),
  password(),
  body('phone').optional().matches(/^[0-9+\-\s]{7,15}$/).withMessage('Phone number is invalid'),
];

const studentProfileFields = (optional = false) => {
  const o = (chain) => (optional ? chain.optional() : chain);
  return [
    o(body('rollNumber')).trim().matches(/^[A-Za-z0-9-]{3,20}$/).withMessage('Roll number must be 3-20 letters, digits or dashes'),
    o(body('department')).isIn(DEPARTMENTS).withMessage(`Department must be one of: ${DEPARTMENTS.join(', ')}`),
    o(body('year')).isInt({ min: 1, max: 5 }).withMessage('Year must be between 1 and 5').toInt(),
    body('batch').optional().matches(/^\d{4}-\d{4}$/).withMessage('Batch must look like 2023-2027'),
  ];
};

const facultyProfileFields = (optional = false) => {
  const o = (chain) => (optional ? chain.optional() : chain);
  return [
    o(body('employeeId')).trim().matches(/^[A-Za-z0-9-]{3,20}$/).withMessage('Employee ID must be 3-20 letters, digits or dashes'),
    o(body('department')).isIn(DEPARTMENTS).withMessage(`Department must be one of: ${DEPARTMENTS.join(', ')}`),
    body('designation').optional().isIn(['Professor', 'Associate Professor', 'Assistant Professor', 'Lecturer']),
    body('specialization').optional().isString().isLength({ max: 100 }),
  ];
};

const pagination = [
  query('page').optional().isInt({ min: 1 }).withMessage('page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit must be between 1 and 100'),
];

module.exports = {
  id,
  pagination,

  auth: {
    register: [...userFields, ...studentProfileFields()],
    login: [body('email').trim().isEmail().withMessage('A valid email is required'), body('password').notEmpty().withMessage('Password is required')],
    refresh: [body('refreshToken').isString().notEmpty().withMessage('refreshToken is required')],
  },

  users: {
    updateMe: [
      body('name').optional().trim().isLength({ min: 2, max: 100 }),
      body('phone').optional().matches(/^[0-9+\-\s]{7,15}$/).withMessage('Phone number is invalid'),
      // Fields a user must NOT change on their own profile.
      body(['email', 'role', 'password', 'isActive', 'tokenVersion']).not().exists().withMessage('This field cannot be updated here'),
    ],
    changePassword: [body('currentPassword').notEmpty().withMessage('currentPassword is required'), password('newPassword')],
    createAdmin: [...userFields],
    adminUpdate: [
      id(),
      body('name').optional().trim().isLength({ min: 2, max: 100 }),
      body('phone').optional().matches(/^[0-9+\-\s]{7,15}$/),
      body('isActive').optional().isBoolean().toBoolean(),
      body(['role', 'password', 'email']).not().exists().withMessage('This field cannot be changed via this endpoint'),
    ],
    list: [...pagination, query('role').optional().isIn(Object.values(ROLES)), query('isActive').optional().isBoolean()],
  },

  students: {
    create: [...userFields, ...studentProfileFields()],
    update: [id(), body('name').optional().trim().isLength({ min: 2, max: 100 }), body('phone').optional().matches(/^[0-9+\-\s]{7,15}$/), ...studentProfileFields(true)],
    list: [...pagination, query('department').optional().isIn(DEPARTMENTS), query('year').optional().isInt({ min: 1, max: 5 })],
  },

  faculty: {
    create: [...userFields, ...facultyProfileFields()],
    update: [id(), body('name').optional().trim().isLength({ min: 2, max: 100 }), body('phone').optional().matches(/^[0-9+\-\s]{7,15}$/), ...facultyProfileFields(true)],
    list: [...pagination, query('department').optional().isIn(DEPARTMENTS)],
  },

  courses: {
    create: [
      body('code').trim().matches(/^[A-Za-z]{2,5}[0-9]{3,4}$/).withMessage('Course code must look like CS101'),
      body('title').trim().isLength({ min: 3, max: 150 }).withMessage('Title must be 3-150 characters'),
      body('description').optional().isString().isLength({ max: 1000 }),
      body('department').isIn(DEPARTMENTS).withMessage(`Department must be one of: ${DEPARTMENTS.join(', ')}`),
      body('credits').isInt({ min: 1, max: 6 }).withMessage('Credits must be 1-6').toInt(),
      body('semester').isInt({ min: 1, max: 10 }).withMessage('Semester must be 1-10').toInt(),
    ],
    update: [
      id(),
      body('code').optional().trim().matches(/^[A-Za-z]{2,5}[0-9]{3,4}$/),
      body('title').optional().trim().isLength({ min: 3, max: 150 }),
      body('description').optional().isString().isLength({ max: 1000 }),
      body('department').optional().isIn(DEPARTMENTS),
      body('credits').optional().isInt({ min: 1, max: 6 }).toInt(),
      body('semester').optional().isInt({ min: 1, max: 10 }).toInt(),
      body('isActive').optional().isBoolean().toBoolean(),
    ],
    list: [...pagination, query('department').optional().isIn(DEPARTMENTS), query('semester').optional().isInt({ min: 1, max: 10 })],
  },

  sections: {
    create: [
      refId('course'),
      body('name').trim().matches(/^[A-Za-z0-9]{1,5}$/).withMessage('Section name must be 1-5 letters/digits'),
      body('academicYear').matches(/^\d{4}-\d{2}$/).withMessage('Academic year must look like 2025-26'),
      body('faculty').optional({ values: 'null' }).isMongoId().withMessage('faculty must be a valid ObjectId'),
      body('capacity').optional().isInt({ min: 1, max: 500 }).toInt(),
      body('room').optional().isString().isLength({ max: 30 }),
    ],
    update: [
      id(),
      body('name').optional().trim().matches(/^[A-Za-z0-9]{1,5}$/),
      body('academicYear').optional().matches(/^\d{4}-\d{2}$/),
      body('capacity').optional().isInt({ min: 1, max: 500 }).toInt(),
      body('room').optional().isString().isLength({ max: 30 }),
      body(['course', 'faculty']).not().exists().withMessage('Use the dedicated endpoint to change course/faculty'),
    ],
    assignFaculty: [id(), body('faculty').isMongoId().withMessage('faculty must be a valid ObjectId')],
    list: [...pagination, query('course').optional().isMongoId(), query('faculty').optional().isMongoId(), query('academicYear').optional().matches(/^\d{4}-\d{2}$/)],
  },

  enrollments: {
    create: [refId('student'), refId('section')],
    update: [id(), body('status').isIn(ENROLLMENT_STATUS).withMessage(`status must be one of: ${ENROLLMENT_STATUS.join(', ')}`)],
    list: [...pagination, query('student').optional().isMongoId(), query('course').optional().isMongoId(), query('section').optional().isMongoId(), query('status').optional().isIn(ENROLLMENT_STATUS)],
  },

  attendance: {
    mark: [
      refId('section'),
      body('date').isISO8601({ strict: true }).withMessage('date must be an ISO date, e.g. 2025-08-14'),
      body('period').optional().isInt({ min: 1, max: 12 }).toInt(),
      body('records').isArray({ min: 1, max: 500 }).withMessage('records must be a non-empty array'),
      body('records.*.student').isMongoId().withMessage('records[].student must be a valid ObjectId'),
      body('records.*.status').isIn(ATTENDANCE_STATUS).withMessage(`records[].status must be one of: ${ATTENDANCE_STATUS.join(', ')}`),
    ],
    correct: [
      id(),
      body('status').isIn(ATTENDANCE_STATUS).withMessage(`status must be one of: ${ATTENDANCE_STATUS.join(', ')}`),
      body('reason').trim().isLength({ min: 5, max: 300 }).withMessage('A reason of 5-300 characters is required for corrections'),
    ],
    list: [
      ...pagination,
      query('section').optional().isMongoId(),
      query('course').optional().isMongoId(),
      query('student').optional().isMongoId(),
      query('from').optional().isISO8601(),
      query('to').optional().isISO8601(),
      query('date').optional().isISO8601(),
      query('status').optional().isIn(ATTENDANCE_STATUS),
    ],
  },

  announcements: {
    create: [
      body('title').trim().isLength({ min: 3, max: 150 }).withMessage('Title must be 3-150 characters'),
      body('body').trim().isLength({ min: 1, max: 5000 }).withMessage('Body is required (max 5000 characters)'),
      body('scope').isIn(ANNOUNCEMENT_SCOPES).withMessage(`scope must be one of: ${ANNOUNCEMENT_SCOPES.join(', ')}`),
      body('course').if(body('scope').equals('course')).isMongoId().withMessage('course is required for course announcements'),
      body('section').if(body('scope').equals('section')).isMongoId().withMessage('section is required for section announcements'),
      body('priority').optional().isIn(ANNOUNCEMENT_PRIORITIES),
      body('expiresAt').optional().isISO8601(),
    ],
    update: [
      id(),
      body('title').optional().trim().isLength({ min: 3, max: 150 }),
      body('body').optional().trim().isLength({ min: 1, max: 5000 }),
      body('priority').optional().isIn(ANNOUNCEMENT_PRIORITIES),
      body('expiresAt').optional().isISO8601(),
      body(['scope', 'course', 'section', 'createdBy']).not().exists().withMessage('The audience of an announcement cannot be changed'),
    ],
    list: [...pagination, query('scope').optional().isIn(ANNOUNCEMENT_SCOPES), query('course').optional().isMongoId(), query('section').optional().isMongoId()],
  },

  reports: {
    attendance: [query('course').optional().isMongoId(), query('section').optional().isMongoId(), query('from').optional().isISO8601(), query('to').optional().isISO8601(), query('format').optional().isIn(['json', 'csv'])],
    lowAttendance: [
      query('threshold').optional().isFloat({ min: 0, max: 100 }).withMessage('threshold must be between 0 and 100'),
      query('course').optional().isMongoId(),
      query('section').optional().isMongoId(),
      query('format').optional().isIn(['json', 'csv']),
    ],
    enrollment: [query('department').optional().isIn(DEPARTMENTS), query('semester').optional().isInt({ min: 1, max: 10 })],
    sections: [query('course').optional().isMongoId(), query('academicYear').optional().matches(/^\d{4}-\d{2}$/)],
  },
};
