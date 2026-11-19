#!/usr/bin/env node
// Seeds the database with demo data.
//   node scripts/seed.js --fresh   -> drops existing data first (npm run seed)
//   node scripts/seed.js           -> refuses to run if data already exists
const mongoose = require('mongoose');
const config = require('../src/config/env');
const { User, Student, Faculty, Course, Section, Enrollment, Attendance, AttendanceAudit, Announcement, RefreshToken } = require('../src/models');

const fresh = process.argv.includes('--fresh');
const PASSWORD = 'Password@123';
const ACADEMIC_YEAR = '2025-26';

function utcDay(daysAgo) {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - daysAgo));
}

// Deterministic pseudo-random generator so every seed run produces the same data.
let seedValue = 42;
function rand() {
  seedValue = (seedValue * 16807) % 2147483647;
  return (seedValue - 1) / 2147483646;
}

async function main() {
  await mongoose.connect(config.mongoUri);
  console.log(`Connected to ${mongoose.connection.name}`);

  if (fresh) {
    await mongoose.connection.dropDatabase();
    console.log('Dropped existing database');
  } else if (await User.estimatedDocumentCount()) {
    console.error('Database already has data. Run with --fresh to reset it.');
    process.exit(1);
  }
  // Build all indexes before inserting (unique constraints, TTL, text indexes).
  await Promise.all([User, Student, Faculty, Course, Section, Enrollment, Attendance, AttendanceAudit, Announcement, RefreshToken].map((m) => m.syncIndexes()));

  // ---- Users ----
  const admin = await User.create({ name: 'Asha Admin', email: 'admin@campus.edu', password: PASSWORD, role: 'admin' });

  const facultyData = [
    { name: 'Dr. Ravi Kumar', email: 'ravi.kumar@campus.edu', employeeId: 'FAC-001', department: 'CSE', designation: 'Professor', specialization: 'Databases' },
    { name: 'Dr. Meera Iyer', email: 'meera.iyer@campus.edu', employeeId: 'FAC-002', department: 'CSE', designation: 'Associate Professor', specialization: 'Networks' },
    { name: 'Prof. Arjun Singh', email: 'arjun.singh@campus.edu', employeeId: 'FAC-003', department: 'MATH', designation: 'Assistant Professor', specialization: 'Discrete Mathematics' },
  ];
  const faculty = [];
  for (const f of facultyData) {
    const user = await User.create({ name: f.name, email: f.email, password: PASSWORD, role: 'faculty' });
    faculty.push(await Faculty.create({ user: user._id, employeeId: f.employeeId, department: f.department, designation: f.designation, specialization: f.specialization }));
  }

  const firstNames = ['Aarav', 'Diya', 'Kabir', 'Ananya', 'Rohan', 'Isha', 'Vivaan', 'Saanvi', 'Aditya', 'Meera', 'Arjun', 'Kavya'];
  const students = [];
  for (let i = 0; i < firstNames.length; i += 1) {
    const n = String(i + 1).padStart(3, '0');
    const user = await User.create({ name: `${firstNames[i]} Sharma`, email: `student${n}@campus.edu`, password: PASSWORD, role: 'student' });
    students.push(await Student.create({ user: user._id, rollNumber: `CSE23-${n}`, department: 'CSE', year: 2, batch: '2023-2027' }));
  }

  // ---- Courses & sections ----
  const courses = await Course.insertMany([
    { code: 'CS201', title: 'Database Management Systems', department: 'CSE', credits: 4, semester: 3, description: 'Relational and NoSQL databases, SQL, normalisation, transactions.' },
    { code: 'CS202', title: 'Computer Networks', department: 'CSE', credits: 3, semester: 3, description: 'OSI model, TCP/IP, routing, application protocols.' },
    { code: 'MA201', title: 'Discrete Mathematics', department: 'MATH', credits: 3, semester: 3, description: 'Logic, sets, relations, graph theory, combinatorics.' },
    { code: 'CS301', title: 'Backend Development', department: 'CSE', credits: 4, semester: 5, description: 'Node.js, Express, MongoDB, authentication and real-time APIs.' },
  ]);
  const [dbms, cn, dm, backend] = courses;

  const sections = await Section.insertMany([
    { course: dbms._id, name: 'A', academicYear: ACADEMIC_YEAR, faculty: faculty[0]._id, capacity: 60, room: 'LH-101' },
    { course: dbms._id, name: 'B', academicYear: ACADEMIC_YEAR, faculty: faculty[0]._id, capacity: 60, room: 'LH-102' },
    { course: cn._id, name: 'A', academicYear: ACADEMIC_YEAR, faculty: faculty[1]._id, capacity: 60, room: 'LH-201' },
    { course: dm._id, name: 'A', academicYear: ACADEMIC_YEAR, faculty: faculty[2]._id, capacity: 60, room: 'LH-301' },
    { course: backend._id, name: 'A', academicYear: ACADEMIC_YEAR, faculty: null, capacity: 40, room: 'LAB-2' },
  ]);
  const [dbmsA, dbmsB, cnA, dmA] = sections;

  // ---- Enrollments ----
  // Students 1-6 -> DBMS A, 7-12 -> DBMS B; everyone takes CN A and DM A. Student 12 is NOT in CN (for negative tests).
  const enrollments = [];
  students.forEach((s, i) => {
    enrollments.push({ student: s._id, course: dbms._id, section: i < 6 ? dbmsA._id : dbmsB._id, enrolledBy: admin._id });
    if (i < 11) enrollments.push({ student: s._id, course: cn._id, section: cnA._id, enrolledBy: admin._id });
    enrollments.push({ student: s._id, course: dm._id, section: dmA._id, enrolledBy: admin._id });
  });
  await Enrollment.insertMany(enrollments);

  // ---- Attendance: 10 past class days per section ----
  // Each student has a fixed "reliability"; students 3 and 9 are intentionally low (< 75%).
  const reliability = students.map((_, i) => (i === 2 || i === 8 ? 0.55 : 0.8 + rand() * 0.2));
  const attendance = [];
  const sectionStudents = new Map([
    [String(dbmsA._id), { section: dbmsA, list: students.slice(0, 6), facultyUser: faculty[0].user }],
    [String(dbmsB._id), { section: dbmsB, list: students.slice(6), facultyUser: faculty[0].user }],
    [String(cnA._id), { section: cnA, list: students.slice(0, 11), facultyUser: faculty[1].user }],
    [String(dmA._id), { section: dmA, list: students, facultyUser: faculty[2].user }],
  ]);
  for (const { section, list, facultyUser } of sectionStudents.values()) {
    for (let day = 14; day >= 1; day -= 1) {
      const date = utcDay(day);
      const dow = date.getUTCDay();
      if (dow === 0 || dow === 6) continue; // no classes on weekends
      for (const s of list) {
        const idx = students.indexOf(s);
        const r = rand();
        const status = r < reliability[idx] ? (r > reliability[idx] - 0.05 ? 'late' : 'present') : 'absent';
        attendance.push({ student: s._id, course: section.course, section: section._id, date, period: 1, status, markedBy: facultyUser });
      }
    }
  }
  const insertedAttendance = await Attendance.insertMany(attendance);

  // One corrected record with an audit entry, to demonstrate the audit trail.
  const sample = insertedAttendance.find((a) => a.status === 'absent');
  if (sample) {
    await AttendanceAudit.create({ attendance: sample._id, student: sample.student, changedBy: faculty[0].user, oldStatus: 'absent', newStatus: 'excused', reason: 'Medical certificate submitted' });
    sample.status = 'excused';
    sample.correctionCount = 1;
    sample.lastModifiedBy = faculty[0].user;
    await sample.save();
  }

  // ---- Announcements ----
  await Announcement.insertMany([
    { title: 'Mid-semester examinations schedule', body: 'Mid-semester exams start on the 1st of next month. Timetable is on the notice board.', scope: 'university', priority: 'high', createdBy: admin._id },
    { title: 'DBMS assignment 2 released', body: 'Submit the ER-diagram assignment by Friday.', scope: 'course', course: dbms._id, createdBy: faculty[0].user },
    { title: 'CN lab moved to LAB-3', body: 'This week the networks lab is in LAB-3.', scope: 'section', section: cnA._id, course: cn._id, createdBy: faculty[1].user },
  ]);

  console.log('\nSeed complete:');
  console.log(`  users:         ${await User.countDocuments()} (1 admin, ${faculty.length} faculty, ${students.length} students)`);
  console.log(`  courses:       ${courses.length}, sections: ${sections.length}`);
  console.log(`  enrollments:   ${enrollments.length}`);
  console.log(`  attendance:    ${insertedAttendance.length}`);
  console.log('\nLogin credentials (password for all accounts: ' + PASSWORD + ')');
  console.log('  admin    admin@campus.edu');
  console.log('  faculty  ravi.kumar@campus.edu  (DBMS A & B)');
  console.log('  faculty  meera.iyer@campus.edu  (CN A)');
  console.log('  faculty  arjun.singh@campus.edu (DM A)');
  console.log('  student  student001@campus.edu ... student012@campus.edu');

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('Seed failed:', err);
  await mongoose.disconnect();
  process.exit(1);
});
