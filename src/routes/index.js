// All REST routes. Request flow: Route -> Middleware (auth, RBAC, validation) -> Controller -> Model -> MongoDB -> Response
const { Router } = require('express');
const validate = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth');
const v = require('../validators');
const { ROLES } = require('../config/constants');

const auth = require('../controllers/authController');
const users = require('../controllers/userController');
const students = require('../controllers/studentController');
const faculty = require('../controllers/facultyController');
const courses = require('../controllers/courseController');
const sections = require('../controllers/sectionController');
const enrollments = require('../controllers/enrollmentController');
const attendance = require('../controllers/attendanceController');
const announcements = require('../controllers/announcementController');
const reports = require('../controllers/reportController');

const { ADMIN, FACULTY, STUDENT } = ROLES;
const router = Router();

// ---------- Auth (public except logout) ----------
const authRouter = Router();
authRouter.post('/register', validate(v.auth.register), auth.register);
authRouter.post('/login', validate(v.auth.login), auth.login);
authRouter.post('/refresh', validate(v.auth.refresh), auth.refresh);
authRouter.post('/logout', authenticate, auth.logout);
router.use('/auth', authRouter);

// Everything below requires a valid access token.
router.use(authenticate);

// ---------- Users ----------
const userRouter = Router();
userRouter.get('/me', users.getMe);
userRouter.patch('/me', validate(v.users.updateMe), users.updateMe);
userRouter.patch('/me/password', validate(v.users.changePassword), users.changePassword);
userRouter.get('/', authorize(ADMIN), validate(v.users.list), users.list);
userRouter.post('/', authorize(ADMIN), validate(v.users.createAdmin), users.createAdmin);
userRouter.get('/:id', authorize(ADMIN), validate([v.id()]), users.getById);
userRouter.patch('/:id', authorize(ADMIN), validate(v.users.adminUpdate), users.update);
userRouter.delete('/:id', authorize(ADMIN), validate([v.id()]), users.remove);
router.use('/users', userRouter);

// ---------- Students ----------
const studentRouter = Router();
studentRouter.get('/', authorize(ADMIN, FACULTY), validate(v.students.list), students.list);
studentRouter.post('/', authorize(ADMIN), validate(v.students.create), students.create);
studentRouter.get('/:id', validate([v.id()]), students.getById);
studentRouter.patch('/:id', authorize(ADMIN), validate(v.students.update), students.update);
studentRouter.delete('/:id', authorize(ADMIN), validate([v.id()]), students.remove);
router.use('/students', studentRouter);

// ---------- Faculty ----------
const facultyRouter = Router();
facultyRouter.get('/', authorize(ADMIN), validate(v.faculty.list), faculty.list);
facultyRouter.post('/', authorize(ADMIN), validate(v.faculty.create), faculty.create);
facultyRouter.get('/:id', authorize(ADMIN, FACULTY), validate([v.id()]), faculty.getById);
facultyRouter.patch('/:id', authorize(ADMIN), validate(v.faculty.update), faculty.update);
facultyRouter.delete('/:id', authorize(ADMIN), validate([v.id()]), faculty.remove);
router.use('/faculty', facultyRouter);

// ---------- Courses ----------
const courseRouter = Router();
courseRouter.get('/', validate(v.courses.list), courses.list);
courseRouter.post('/', authorize(ADMIN), validate(v.courses.create), courses.create);
courseRouter.get('/:id', validate([v.id()]), courses.getById);
courseRouter.patch('/:id', authorize(ADMIN), validate(v.courses.update), courses.update);
courseRouter.delete('/:id', authorize(ADMIN), validate([v.id()]), courses.remove);
router.use('/courses', courseRouter);

// ---------- Sections ----------
const sectionRouter = Router();
sectionRouter.get('/', authorize(ADMIN, FACULTY), validate(v.sections.list), sections.list);
sectionRouter.get('/mine', authorize(FACULTY), sections.mine);
sectionRouter.post('/', authorize(ADMIN), validate(v.sections.create), sections.create);
sectionRouter.get('/:id', validate([v.id()]), sections.getById);
sectionRouter.get('/:id/students', authorize(ADMIN, FACULTY), validate([v.id()]), sections.students);
sectionRouter.patch('/:id', authorize(ADMIN), validate(v.sections.update), sections.update);
sectionRouter.patch('/:id/faculty', authorize(ADMIN), validate(v.sections.assignFaculty), sections.assignFaculty);
sectionRouter.delete('/:id', authorize(ADMIN), validate([v.id()]), sections.remove);
router.use('/sections', sectionRouter);

// ---------- Enrollments ----------
const enrollmentRouter = Router();
enrollmentRouter.get('/me', authorize(STUDENT), enrollments.mine);
enrollmentRouter.get('/', authorize(ADMIN), validate(v.enrollments.list), enrollments.list);
enrollmentRouter.post('/', authorize(ADMIN), validate(v.enrollments.create), enrollments.create);
enrollmentRouter.patch('/:id', authorize(ADMIN), validate(v.enrollments.update), enrollments.update);
enrollmentRouter.delete('/:id', authorize(ADMIN), validate([v.id()]), enrollments.remove);
router.use('/enrollments', enrollmentRouter);

// ---------- Attendance ----------
const attendanceRouter = Router();
attendanceRouter.get('/me/summary', authorize(STUDENT), attendance.mySummary);
attendanceRouter.get('/', validate(v.attendance.list), attendance.list);
attendanceRouter.post('/', authorize(FACULTY, ADMIN), validate(v.attendance.mark), attendance.mark);
attendanceRouter.patch('/:id', authorize(FACULTY, ADMIN), validate(v.attendance.correct), attendance.correct);
attendanceRouter.get('/:id/audit', validate([v.id()]), attendance.audit);
router.use('/attendance', attendanceRouter);

// ---------- Announcements ----------
const announcementRouter = Router();
announcementRouter.get('/', validate(v.announcements.list), announcements.list);
announcementRouter.post('/', authorize(ADMIN, FACULTY), validate(v.announcements.create), announcements.create);
announcementRouter.get('/:id', validate([v.id()]), announcements.getById);
announcementRouter.patch('/:id', authorize(ADMIN, FACULTY), validate(v.announcements.update), announcements.update);
announcementRouter.delete('/:id', authorize(ADMIN, FACULTY), validate([v.id()]), announcements.remove);
router.use('/announcements', announcementRouter);

// ---------- Reports ----------
const reportRouter = Router();
reportRouter.use(authorize(ADMIN, FACULTY));
reportRouter.get('/attendance-summary', validate(v.reports.attendance), reports.attendanceSummary);
reportRouter.get('/low-attendance', validate(v.reports.lowAttendance), reports.lowAttendance);
reportRouter.get('/enrollment-counts', authorize(ADMIN), validate(v.reports.enrollment), reports.enrollmentCounts);
reportRouter.get('/section-summary', validate(v.reports.sections), reports.sectionSummary);
router.use('/reports', reportRouter);

module.exports = router;
