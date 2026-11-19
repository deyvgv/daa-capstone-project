#!/usr/bin/env node
// Generates postman/Campus-Management-System.postman_collection.json
// Run: node scripts/generate-postman.js   (then import the file into Postman, or: npm run test:api)
const fs = require('fs');
const path = require('path');

const json = (o) => JSON.stringify(o, null, 2);

function req(name, method, url, { token, body, tests = [], pre = [], headers = [] } = {}) {
  const h = [...headers];
  if (body !== undefined) h.push({ key: 'Content-Type', value: 'application/json' });
  if (token) h.push({ key: 'Authorization', value: `Bearer {{${token}}}` });
  const [pathPart, queryPart] = url.split('?');
  const item = {
    name,
    request: {
      method,
      header: h,
      url: {
        raw: `{{baseUrl}}${url}`,
        host: ['{{baseUrl}}'],
        path: pathPart.split('/').filter(Boolean),
        ...(queryPart && {
          query: queryPart.split('&').map((kv) => {
            const [key, ...rest] = kv.split('=');
            return { key, value: rest.join('=') };
          }),
        }),
      },
    },
    event: [],
  };
  if (body !== undefined) item.request.body = { mode: 'raw', raw: typeof body === 'string' ? body : json(body) };
  if (pre.length) item.event.push({ listen: 'prerequest', script: { type: 'text/javascript', exec: pre } });
  if (tests.length) item.event.push({ listen: 'test', script: { type: 'text/javascript', exec: tests } });
  return item;
}

const status = (code, label) => [`pm.test('${label || 'Status is ' + code}', () => pm.response.to.have.status(${code}));`];
const ok = (code) => [...status(code), `pm.test('success flag is true', () => pm.expect(pm.response.json().success).to.eql(true));`];
const fail = (code, errCode) => [
  ...status(code),
  `pm.test('error response shape', () => { const b = pm.response.json(); pm.expect(b.success).to.eql(false); pm.expect(b.error).to.have.property('message'); ${errCode ? `pm.expect(b.error.code).to.eql('${errCode}');` : ''} });`,
];
const save = (variable, expr) => [`pm.environment.set('${variable}', ${expr});`];
const D = 'pm.response.json().data';

const folders = [];
const folder = (name, description, item) => folders.push({ name, description, item });

// ---------------------------------------------------------------------------
folder('00 Health', 'Server and database status', [req('Health check', 'GET', '/api/health', { tests: [...ok(200), `pm.test('db connected', () => pm.expect(${D}.db).to.eql('connected'));`] })]);

// ---------------------------------------------------------------------------
const login = (name, email, tokenVar, refreshVar) =>
  req(name, 'POST', '/api/auth/login', {
    body: { email, password: '{{password}}' },
    tests: [
      ...ok(200),
      `pm.test('returns access and refresh tokens', () => { pm.expect(${D}.accessToken).to.be.a('string'); pm.expect(${D}.refreshToken).to.be.a('string'); });`,
      `pm.test('password hash is never returned', () => pm.expect(${D}.user).to.not.have.property('password'));`,
      ...save(tokenVar, `${D}.accessToken`),
      ...(refreshVar ? save(refreshVar, `${D}.refreshToken`) : []),
    ],
  });

folder('01 Authentication', 'Register, login, refresh-token rotation and validation failures', [
  login('Login - admin', 'admin@campus.edu', 'adminToken', 'adminRefresh'),
  login('Login - faculty Ravi (DBMS A, B)', 'ravi.kumar@campus.edu', 'facultyToken'),
  login('Login - faculty Meera (CN A)', 'meera.iyer@campus.edu', 'faculty2Token'),
  login('Login - student001', 'student001@campus.edu', 'studentToken', 'studentRefresh'),
  req('Login - wrong password (401)', 'POST', '/api/auth/login', { body: { email: 'admin@campus.edu', password: 'WrongPass1' }, tests: fail(401, 'UNAUTHORIZED') }),
  req('Login - missing fields (400)', 'POST', '/api/auth/login', { body: { password: 'x' }, tests: fail(400, 'VALIDATION_ERROR') }),
  req('Login - malformed JSON (400)', 'POST', '/api/auth/login', { body: '{"email": "admin@campus.edu",', tests: fail(400, 'INVALID_JSON') }),
  req('Register - new student (201)', 'POST', '/api/auth/register', {
    pre: [
      "const n = Date.now().toString().slice(-6);",
      "pm.environment.set('newEmail', `newstudent${n}@campus.edu`);",
      "pm.environment.set('newRoll', `CSE25-${n}`);",
    ],
    body: { name: 'Nikhil Verma', email: '{{newEmail}}', password: 'Secret123', rollNumber: '{{newRoll}}', department: 'CSE', year: 1, batch: '2025-2029' },
    tests: [
      ...ok(201),
      `pm.test('role is student', () => pm.expect(${D}.user.role).to.eql('student'));`,
      ...save('newStudentToken', `${D}.accessToken`),
      ...save('newStudentId', `${D}.profile._id`),
    ],
  }),
  req('Register - duplicate email (409)', 'POST', '/api/auth/register', {
    body: { name: 'Dup User', email: 'admin@campus.edu', password: 'Secret123', rollNumber: 'DUP-0001', department: 'CSE', year: 1 },
    tests: fail(409, 'CONFLICT'),
  }),
  req('Register - invalid fields (400)', 'POST', '/api/auth/register', {
    body: { name: 'X', email: 'not-an-email', password: 'short', rollNumber: '!', department: 'ART', year: 9 },
    tests: [...fail(400, 'VALIDATION_ERROR'), `pm.test('reports every invalid field', () => pm.expect(pm.response.json().error.details.length).to.be.at.least(5));`],
  }),
  req('Refresh - rotate tokens (200)', 'POST', '/api/auth/refresh', {
    pre: ["pm.environment.set('oldAdminRefresh', pm.environment.get('adminRefresh'));"],
    body: { refreshToken: '{{adminRefresh}}' },
    tests: [...ok(200), `pm.test('new refresh token differs', () => pm.expect(${D}.refreshToken).to.not.eql(pm.environment.get('oldAdminRefresh')));`, ...save('adminToken', `${D}.accessToken`), ...save('adminRefresh', `${D}.refreshToken`)],
  }),
  req('Refresh - reuse of rotated token (401)', 'POST', '/api/auth/refresh', { body: { refreshToken: '{{oldAdminRefresh}}' }, tests: fail(401) }),
  req('Refresh - garbage token (401)', 'POST', '/api/auth/refresh', { body: { refreshToken: 'not.a.jwt' }, tests: fail(401) }),
  login('Login - admin again (fresh refresh token)', 'admin@campus.edu', 'adminToken', 'adminRefresh'),
]);

// ---------------------------------------------------------------------------
folder('02 Users & profile', 'Own profile, permitted fields, admin user management', [
  req('Get my profile - student (200)', 'GET', '/api/users/me', {
    token: 'studentToken',
    tests: [...ok(200), `pm.test('has student profile', () => pm.expect(${D}.profile.rollNumber).to.eql('CSE23-001'));`, ...save('student1Id', `${D}.profile._id`)],
  }),
  req('Update my profile - name/phone (200)', 'PATCH', '/api/users/me', { token: 'studentToken', body: { name: 'Aarav Sharma', phone: '9876543210' }, tests: ok(200) }),
  req('Update my profile - forbidden field role (400)', 'PATCH', '/api/users/me', { token: 'studentToken', body: { role: 'admin' }, tests: fail(400, 'VALIDATION_ERROR') }),
  req('List users - no token (401)', 'GET', '/api/users', { tests: fail(401, 'UNAUTHORIZED') }),
  req('List users - invalid token (401)', 'GET', '/api/users', { headers: [{ key: 'Authorization', value: 'Bearer abc.def.ghi' }], tests: fail(401) }),
  req('List users - student role (403)', 'GET', '/api/users', { token: 'studentToken', tests: fail(403, 'FORBIDDEN') }),
  req('List users - admin, filter by role (200)', 'GET', '/api/users?role=faculty&limit=10', {
    token: 'adminToken',
    tests: [...ok(200), `pm.test('only faculty returned', () => ${D}.forEach(u => pm.expect(u.role).to.eql('faculty')));`, `pm.test('pagination meta', () => pm.expect(pm.response.json().meta).to.include.keys('page','limit','total','totalPages'));`],
  }),
  req('Get user - non-existent id (404)', 'GET', '/api/users/64b000000000000000000000', { token: 'adminToken', tests: fail(404, 'NOT_FOUND') }),
  req('Get user - invalid id (400)', 'GET', '/api/users/123', { token: 'adminToken', tests: fail(400, 'VALIDATION_ERROR') }),
]);

// ---------------------------------------------------------------------------
folder('03 Courses', 'Course CRUD with role checks', [
  req('List courses - student (200)', 'GET', '/api/courses?limit=50', {
    token: 'studentToken',
    tests: [
      ...ok(200),
      `const c = ${D}; pm.environment.set('dbmsCourseId', c.find(x => x.code === 'CS201')._id); pm.environment.set('cnCourseId', c.find(x => x.code === 'CS202')._id);`,
    ],
  }),
  req('Search courses - text search (200)', 'GET', '/api/courses?search=database', { token: 'studentToken', tests: [...ok(200), `pm.test('finds DBMS', () => pm.expect(${D}.map(c => c.code)).to.include('CS201'));`] }),
  req('Create course - admin (201)', 'POST', '/api/courses', {
    token: 'adminToken',
    pre: ["pm.environment.set('newCourseCode', 'CS' + (1000 + Math.floor(Math.random() * 8999)));"],
    body: { code: '{{newCourseCode}}', title: 'Cloud Computing', department: 'CSE', credits: 3, semester: 6, description: 'Virtualisation, containers, cloud services.' },
    tests: [...ok(201), ...save('newCourseId', `${D}._id`)],
  }),
  req('Create course - duplicate code (409)', 'POST', '/api/courses', { token: 'adminToken', body: { code: 'CS201', title: 'Duplicate', department: 'CSE', credits: 3, semester: 3 }, tests: fail(409, 'DUPLICATE') }),
  req('Create course - invalid fields (400)', 'POST', '/api/courses', { token: 'adminToken', body: { code: '101', title: 'X', department: 'CSE', credits: 10 }, tests: fail(400, 'VALIDATION_ERROR') }),
  req('Create course - faculty role (403)', 'POST', '/api/courses', { token: 'facultyToken', body: { code: 'CS999', title: 'Not allowed', department: 'CSE', credits: 3, semester: 3 }, tests: fail(403) }),
  req('Get course - by id (200)', 'GET', '/api/courses/{{dbmsCourseId}}', { token: 'studentToken', tests: [...ok(200), `pm.test('includes sections', () => pm.expect(${D}.sections.length).to.eql(2));`] }),
  req('Get course - non-existent (404)', 'GET', '/api/courses/64b000000000000000000000', { token: 'studentToken', tests: fail(404) }),
  req('Update course - admin (200)', 'PATCH', '/api/courses/{{newCourseId}}', { token: 'adminToken', body: { credits: 4 }, tests: [...ok(200), `pm.test('credits updated', () => pm.expect(${D}.credits).to.eql(4));`] }),
  req('Delete course - with enrolments (409)', 'DELETE', '/api/courses/{{dbmsCourseId}}', { token: 'adminToken', tests: fail(409) }),
]);

// ---------------------------------------------------------------------------
folder('04 Faculty', 'Faculty records (admin)', [
  req('List faculty - admin (200)', 'GET', '/api/faculty', { token: 'adminToken', tests: [...ok(200), `pm.environment.set('raviFacultyId', ${D}.find(f => f.employeeId === 'FAC-001')._id);`] }),
  req('Create faculty - admin (201)', 'POST', '/api/faculty', {
    token: 'adminToken',
    pre: ["const n = Date.now().toString().slice(-6); pm.environment.set('newFacEmail', `faculty${n}@campus.edu`); pm.environment.set('newEmpId', `FAC-${n}`);"],
    body: { name: 'Dr. Neha Gupta', email: '{{newFacEmail}}', password: 'Faculty123', employeeId: '{{newEmpId}}', department: 'CSE', designation: 'Assistant Professor' },
    tests: [...ok(201), ...save('newFacultyId', `${D}._id`)],
  }),
  req('Create faculty - duplicate employee ID (409)', 'POST', '/api/faculty', {
    token: 'adminToken',
    body: { name: 'Dup Faculty', email: 'dupfac@campus.edu', password: 'Faculty123', employeeId: 'FAC-001', department: 'CSE' },
    tests: fail(409),
  }),
  req('Get faculty - own record (200)', 'GET', '/api/faculty/{{raviFacultyId}}', { token: 'facultyToken', tests: [...ok(200), `pm.test('lists assigned sections', () => pm.expect(${D}.sections.length).to.eql(2));`] }),
  req('List faculty - student role (403)', 'GET', '/api/faculty', { token: 'studentToken', tests: fail(403) }),
]);

// ---------------------------------------------------------------------------
folder('05 Sections & faculty assignment', 'Sections, faculty assignment and class lists', [
  req('List sections - admin (200)', 'GET', '/api/sections?limit=100', {
    token: 'adminToken',
    tests: [
      ...ok(200),
      `const s = ${D}; const f = (code, name) => s.find(x => x.course.code === code && x.name === name)._id;`,
      "pm.environment.set('dbmsSectionA', f('CS201','A')); pm.environment.set('dbmsSectionB', f('CS201','B')); pm.environment.set('cnSectionA', f('CS202','A'));",
    ],
  }),
  req('My sections - faculty (200)', 'GET', '/api/sections/mine', { token: 'facultyToken', tests: [...ok(200), `pm.test('Ravi teaches 2 sections', () => pm.expect(${D}.length).to.eql(2));`] }),
  req('Create section - admin (201)', 'POST', '/api/sections', { token: 'adminToken', body: { course: '{{newCourseId}}', name: 'A', academicYear: '2025-26', capacity: 2, room: 'LH-400' }, tests: [...ok(201), ...save('newSectionId', `${D}._id`)] }),
  req('Create section - duplicate (409)', 'POST', '/api/sections', { token: 'adminToken', body: { course: '{{newCourseId}}', name: 'A', academicYear: '2025-26' }, tests: fail(409) }),
  req('Create section - non-existent course (400)', 'POST', '/api/sections', { token: 'adminToken', body: { course: '64b000000000000000000000', name: 'Z', academicYear: '2025-26' }, tests: fail(400) }),
  req('Assign faculty to section - admin (200)', 'PATCH', '/api/sections/{{newSectionId}}/faculty', { token: 'adminToken', body: { faculty: '{{newFacultyId}}' }, tests: [...ok(200), `pm.test('faculty assigned', () => pm.expect(${D}.faculty._id).to.eql(pm.environment.get('newFacultyId')));`] }),
  req('Class list - assigned faculty (200)', 'GET', '/api/sections/{{dbmsSectionA}}/students', {
    token: 'facultyToken',
    tests: [...ok(200), `const s = ${D}; pm.environment.set('student2Id', s[1]._id); pm.environment.set('student3Id', s[2]._id); pm.test('6 students', () => pm.expect(s.length).to.eql(6));`],
  }),
  req('Class list - section not assigned to faculty (403)', 'GET', '/api/sections/{{cnSectionA}}/students', { token: 'facultyToken', tests: fail(403) }),
]);

// ---------------------------------------------------------------------------
folder('06 Students', 'Student CRUD, pagination/filtering and privacy', [
  req('List students - admin, filter + paginate (200)', 'GET', '/api/students?department=CSE&year=2&page=1&limit=5&sort=rollNumber', {
    token: 'adminToken',
    tests: [...ok(200), `pm.test('page size respected', () => pm.expect(${D}.length).to.eql(5));`, `pm.test('total is 12', () => pm.expect(pm.response.json().meta.total).to.eql(12));`],
  }),
  req('List students - faculty sees only own sections (200)', 'GET', '/api/students?limit=100', { token: 'faculty2Token', tests: [...ok(200), `pm.test('Meera sees 11 CN students', () => pm.expect(pm.response.json().meta.total).to.eql(11));`] }),
  req('Create student - admin (201)', 'POST', '/api/students', {
    token: 'adminToken',
    pre: ["const n = Date.now().toString().slice(-6); pm.environment.set('s2Email', `admstudent${n}@campus.edu`); pm.environment.set('s2Roll', `ECE25-${n}`);"],
    body: { name: 'Pooja Nair', email: '{{s2Email}}', password: 'Student123', rollNumber: '{{s2Roll}}', department: 'ECE', year: 1 },
    tests: [...ok(201), ...save('tempStudentId', `${D}._id`)],
  }),
  req('Create student - duplicate roll number (409)', 'POST', '/api/students', {
    token: 'adminToken',
    body: { name: 'Dup Roll', email: 'duproll@campus.edu', password: 'Student123', rollNumber: 'CSE23-001', department: 'CSE', year: 2 },
    tests: fail(409),
  }),
  req('Get student - own record (200)', 'GET', '/api/students/{{student1Id}}', { token: 'studentToken', tests: [...ok(200), `pm.test('includes enrolments', () => pm.expect(${D}.enrollments.length).to.eql(3));`] }),
  req("Get student - another student's record (403)", 'GET', '/api/students/{{student2Id}}', { token: 'studentToken', tests: fail(403) }),
  req('Update student - admin (200)', 'PATCH', '/api/students/{{tempStudentId}}', { token: 'adminToken', body: { year: 2, name: 'Pooja R. Nair' }, tests: [...ok(200), `pm.test('year updated', () => pm.expect(${D}.year).to.eql(2));`] }),
  req('Delete student - admin (200)', 'DELETE', '/api/students/{{tempStudentId}}', { token: 'adminToken', tests: ok(200) }),
  req('Get student - deleted (404)', 'GET', '/api/students/{{tempStudentId}}', { token: 'adminToken', tests: fail(404) }),
  req('Delete student - has attendance (409)', 'DELETE', '/api/students/{{student1Id}}', { token: 'adminToken', tests: fail(409) }),
]);

// ---------------------------------------------------------------------------
folder('07 Enrollments', 'Enrolment with duplicate / invalid / capacity checks', [
  req('Enroll student - admin (201)', 'POST', '/api/enrollments', { token: 'adminToken', body: { student: '{{newStudentId}}', section: '{{newSectionId}}' }, tests: [...ok(201), ...save('newEnrollmentId', `${D}._id`)] }),
  req('Enroll student - duplicate course (409)', 'POST', '/api/enrollments', { token: 'adminToken', body: { student: '{{newStudentId}}', section: '{{newSectionId}}' }, tests: fail(409) }),
  req('Enroll student - already in course via other section (409)', 'POST', '/api/enrollments', { token: 'adminToken', body: { student: '{{student1Id}}', section: '{{dbmsSectionB}}' }, tests: fail(409) }),
  req('Enroll student - non-existent section (400)', 'POST', '/api/enrollments', { token: 'adminToken', body: { student: '{{newStudentId}}', section: '64b000000000000000000000' }, tests: fail(400) }),
  req('Enroll student - invalid ids (400)', 'POST', '/api/enrollments', { token: 'adminToken', body: { student: 'abc', section: 'xyz' }, tests: fail(400, 'VALIDATION_ERROR') }),
  req('Enroll student - student role (403)', 'POST', '/api/enrollments', { token: 'studentToken', body: { student: '{{student1Id}}', section: '{{newSectionId}}' }, tests: fail(403) }),
  req('My enrolments - student (200)', 'GET', '/api/enrollments/me', { token: 'studentToken', tests: [...ok(200), `pm.test('3 courses', () => pm.expect(${D}.length).to.eql(3));`] }),
]);

// ---------------------------------------------------------------------------
const today = "pm.environment.set('today', new Date().toISOString().slice(0,10)); pm.environment.set('period', String(2 + Math.floor(Math.random() * 11)));";
folder('08 Attendance', 'Marking, duplicate prevention, ownership rules, corrections with audit trail and summaries', [
  req('Mark attendance - assigned faculty (201)', 'POST', '/api/attendance', {
    token: 'facultyToken',
    pre: [today],
    body: '{\n  "section": "{{dbmsSectionA}}",\n  "date": "{{today}}",\n  "period": {{period}},\n  "records": [\n    { "student": "{{student1Id}}", "status": "present" },\n    { "student": "{{student2Id}}", "status": "absent" },\n    { "student": "{{student3Id}}", "status": "absent" }\n  ]\n}',
    tests: [...ok(201), `pm.test('3 records', () => pm.expect(${D}.records.length).to.eql(3));`, `pm.environment.set('attendanceId', ${D}.records.find(r => r.status === 'absent')._id);`],
  }),
  req('Mark attendance - duplicate session (409)', 'POST', '/api/attendance', {
    token: 'facultyToken',
    body: '{ "section": "{{dbmsSectionA}}", "date": "{{today}}", "period": {{period}}, "records": [{ "student": "{{student1Id}}", "status": "present" }] }',
    tests: fail(409),
  }),
  req('Mark attendance - section not assigned (403)', 'POST', '/api/attendance', {
    token: 'facultyToken',
    body: '{ "section": "{{cnSectionA}}", "date": "{{today}}", "records": [{ "student": "{{student1Id}}", "status": "present" }] }',
    tests: fail(403),
  }),
  req('Mark attendance - student not enrolled in section (400)', 'POST', '/api/attendance', {
    token: 'facultyToken',
    body: '{ "section": "{{dbmsSectionA}}", "date": "{{today}}", "period": 12, "records": [{ "student": "{{newStudentId}}", "status": "present" }] }',
    tests: fail(400),
  }),
  req('Mark attendance - same student twice (400)', 'POST', '/api/attendance', {
    token: 'facultyToken',
    body: '{ "section": "{{dbmsSectionA}}", "date": "{{today}}", "period": 12, "records": [{ "student": "{{student1Id}}", "status": "present" }, { "student": "{{student1Id}}", "status": "absent" }] }',
    tests: fail(400),
  }),
  req('Mark attendance - future date (400)', 'POST', '/api/attendance', {
    token: 'facultyToken',
    body: '{ "section": "{{dbmsSectionA}}", "date": "2099-01-01", "records": [{ "student": "{{student1Id}}", "status": "present" }] }',
    tests: fail(400),
  }),
  req('Mark attendance - invalid status (400)', 'POST', '/api/attendance', {
    token: 'facultyToken',
    body: '{ "section": "{{dbmsSectionA}}", "date": "{{today}}", "records": [{ "student": "{{student1Id}}", "status": "sleeping" }] }',
    tests: fail(400, 'VALIDATION_ERROR'),
  }),
  req('Mark attendance - student role (403)', 'POST', '/api/attendance', {
    token: 'studentToken',
    body: '{ "section": "{{dbmsSectionA}}", "date": "{{today}}", "records": [{ "student": "{{student1Id}}", "status": "present" }] }',
    tests: fail(403),
  }),
  req('Correct attendance - with reason (200)', 'PATCH', '/api/attendance/{{attendanceId}}', { token: 'facultyToken', body: { status: 'present', reason: 'Student was present, marked absent by mistake' }, tests: [...ok(200), `pm.test('status changed', () => pm.expect(${D}.status).to.eql('present'));`] }),
  req('Correct attendance - missing reason (400)', 'PATCH', '/api/attendance/{{attendanceId}}', { token: 'facultyToken', body: { status: 'absent' }, tests: fail(400, 'VALIDATION_ERROR') }),
  req('Correct attendance - same status (400)', 'PATCH', '/api/attendance/{{attendanceId}}', { token: 'facultyToken', body: { status: 'present', reason: 'No real change here' }, tests: fail(400) }),
  req('Correct attendance - other faculty (403)', 'PATCH', '/api/attendance/{{attendanceId}}', { token: 'faculty2Token', body: { status: 'late', reason: 'Trying to edit another section' }, tests: fail(403) }),
  req('Attendance audit trail (200)', 'GET', '/api/attendance/{{attendanceId}}/audit', { token: 'facultyToken', tests: [...ok(200), `pm.test('one audit entry', () => pm.expect(${D}.history.length).to.eql(1));`, `pm.test('records old/new status', () => { const h = ${D}.history[0]; pm.expect(h.oldStatus).to.eql('absent'); pm.expect(h.newStatus).to.eql('present'); });`] }),
  req("Student list - ignores other student's id (200)", 'GET', '/api/attendance?student={{student2Id}}&limit=100', {
    token: 'studentToken',
    tests: [...ok(200), `pm.test('only own records returned', () => ${D}.forEach(a => pm.expect(a.student._id).to.eql(pm.environment.get('student1Id'))));`],
  }),
  req('Student attendance summary (200)', 'GET', '/api/attendance/me/summary', {
    token: 'studentToken',
    tests: [...ok(200), `pm.test('subject-wise rows with percentage', () => { const s = ${D}.subjects; pm.expect(s.length).to.eql(3); s.forEach(r => pm.expect(r).to.include.keys('totalClasses','attended','percentage')); });`],
  }),
  req('Faculty list - other section (403)', 'GET', '/api/attendance?section={{cnSectionA}}', { token: 'facultyToken', tests: fail(403) }),
  req('Faculty list - own section by date (200)', 'GET', '/api/attendance?section={{dbmsSectionA}}&date={{today}}', { token: 'facultyToken', tests: ok(200) }),
]);

// ---------------------------------------------------------------------------
folder('09 Announcements', 'Scoped announcements, RBAC and ownership', [
  req('Create - admin, university-wide (201)', 'POST', '/api/announcements', { token: 'adminToken', body: { title: 'Campus closed on Friday', body: 'The campus will be closed for the festival.', scope: 'university', priority: 'high' }, tests: [...ok(201), ...save('uniAnnouncementId', `${D}._id`)] }),
  req('Create - faculty, own course (201)', 'POST', '/api/announcements', { token: 'facultyToken', body: { title: 'DBMS quiz next week', body: 'Quiz on normalisation next Tuesday.', scope: 'course', course: '{{dbmsCourseId}}' }, tests: [...ok(201), ...save('courseAnnouncementId', `${D}._id`)] }),
  req('Create - faculty, university-wide (403)', 'POST', '/api/announcements', { token: 'facultyToken', body: { title: 'Not allowed', body: 'Faculty cannot do this.', scope: 'university' }, tests: fail(403) }),
  req('Create - faculty, section not assigned (403)', 'POST', '/api/announcements', { token: 'facultyToken', body: { title: 'Not my section', body: 'Should fail.', scope: 'section', section: '{{cnSectionA}}' }, tests: fail(403) }),
  req('Create - course scope without course (400)', 'POST', '/api/announcements', { token: 'facultyToken', body: { title: 'Missing course', body: 'Should fail.', scope: 'course' }, tests: fail(400, 'VALIDATION_ERROR') }),
  req('Create - student role (403)', 'POST', '/api/announcements', { token: 'studentToken', body: { title: 'Hello', body: 'Students cannot post.', scope: 'university' }, tests: fail(403) }),
  req('List - student sees only relevant (200)', 'GET', '/api/announcements?limit=50', {
    token: 'studentToken',
    tests: [...ok(200), `pm.test('only university / own course / own section', () => ${D}.forEach(a => pm.expect(['university','course','section']).to.include(a.scope)));`, `pm.test('sees the new course announcement', () => pm.expect(${D}.map(a => a._id)).to.include(pm.environment.get('courseAnnouncementId')));`],
  }),
  req('Update - not the author (403)', 'PATCH', '/api/announcements/{{courseAnnouncementId}}', { token: 'faculty2Token', body: { title: 'Hijacked' }, tests: fail(403) }),
  req('Update - author (200)', 'PATCH', '/api/announcements/{{courseAnnouncementId}}', { token: 'facultyToken', body: { title: 'DBMS quiz moved to Wednesday' }, tests: ok(200) }),
  req('Update - change scope (400)', 'PATCH', '/api/announcements/{{courseAnnouncementId}}', { token: 'facultyToken', body: { scope: 'university' }, tests: fail(400) }),
  req('Delete - admin (200)', 'DELETE', '/api/announcements/{{uniAnnouncementId}}', { token: 'adminToken', tests: ok(200) }),
  req('Get - deleted (404)', 'GET', '/api/announcements/{{uniAnnouncementId}}', { token: 'adminToken', tests: fail(404) }),
]);

// ---------------------------------------------------------------------------
folder('10 Reports (aggregation)', 'Aggregation-pipeline reports', [
  req('Attendance summary - admin (200)', 'GET', '/api/reports/attendance-summary?course={{dbmsCourseId}}', {
    token: 'adminToken',
    tests: [...ok(200), `pm.test('one row per student (12)', () => pm.expect(${D}.length).to.eql(12));`, `pm.test('percentage between 0 and 100', () => ${D}.forEach(r => pm.expect(r.percentage).to.be.within(0, 100)));`],
  }),
  req('Low attendance - threshold 75 (200)', 'GET', '/api/reports/low-attendance?threshold=75', {
    token: 'adminToken',
    tests: [...ok(200), `pm.test('all rows below threshold', () => ${D}.forEach(r => pm.expect(r.percentage).to.be.below(75)));`, `pm.test('includes seeded low student', () => pm.expect(${D}.map(r => r.rollNumber)).to.include('CSE23-003'));`],
  }),
  req('Low attendance - invalid threshold (400)', 'GET', '/api/reports/low-attendance?threshold=150', { token: 'adminToken', tests: fail(400, 'VALIDATION_ERROR') }),
  req('Low attendance - CSV download (200)', 'GET', '/api/reports/low-attendance?format=csv', {
    token: 'adminToken',
    tests: [...status(200), "pm.test('is CSV', () => pm.expect(pm.response.headers.get('Content-Type')).to.include('text/csv'));", "pm.test('has header row', () => pm.expect(pm.response.text().split('\\r\\n')[0]).to.include('Roll Number'));"],
  }),
  req('Enrollment counts - admin (200)', 'GET', '/api/reports/enrollment-counts', { token: 'adminToken', tests: [...ok(200), `pm.test('has courses, byDepartment, totals', () => pm.expect(${D}).to.include.keys('courses','byDepartment','totals'));`] }),
  req('Enrollment counts - faculty (403)', 'GET', '/api/reports/enrollment-counts', { token: 'facultyToken', tests: fail(403) }),
  req('Section summary - faculty sees own sections (200)', 'GET', '/api/reports/section-summary', { token: 'facultyToken', tests: [...ok(200), `pm.test('2 sections, both taught by Ravi', () => { pm.expect(${D}.length).to.eql(2); ${D}.forEach(s => pm.expect(s.faculty).to.eql('Dr. Ravi Kumar')); });`] }),
  req('Reports - student role (403)', 'GET', '/api/reports/attendance-summary', { token: 'studentToken', tests: fail(403) }),
]);

// ---------------------------------------------------------------------------
folder('11 Logout & token revocation', 'Logout revokes refresh tokens and invalidates outstanding access tokens', [
  req('Logout - student (200)', 'POST', '/api/auth/logout', { token: 'studentToken', tests: ok(200) }),
  req('Use access token after logout (401)', 'GET', '/api/users/me', { token: 'studentToken', tests: fail(401) }),
  req('Refresh after logout (401)', 'POST', '/api/auth/refresh', { body: { refreshToken: '{{studentRefresh}}' }, tests: fail(401) }),
  req('Unknown route (404)', 'GET', '/api/does-not-exist', { token: 'adminToken', tests: fail(404) }),
]);

const collection = {
  info: {
    name: 'Campus Management System API',
    description:
      'University Campus Management System - REST API tests.\n\nRun `npm run seed` first, then run the whole collection in order (Collection Runner or `npm run test:api`). Requests save IDs and tokens into the environment for later requests.',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  item: folders,
};

const environment = {
  name: 'Campus Management - Local',
  values: [
    { key: 'baseUrl', value: 'http://localhost:5000', enabled: true },
    { key: 'password', value: 'Password@123', enabled: true },
  ],
};

const outDir = path.join(__dirname, '..', 'postman');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'Campus-Management-System.postman_collection.json'), json(collection));
fs.writeFileSync(path.join(outDir, 'local.postman_environment.json'), json(environment));
const count = folders.reduce((n, f) => n + f.item.length, 0);
console.log(`Wrote ${count} requests in ${folders.length} folders to postman/`);
