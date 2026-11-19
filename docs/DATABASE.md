# Database Design

Database: MongoDB (`campus_management`), modelled with Mongoose. All schemas live in `src/models/`.

## Entity relationships

```
            ┌─────────┐ 1      1 ┌──────────┐
            │  User   │──────────│ Student  │──┐
            │ (role)  │──────────│ Faculty  │  │
            └─────────┘ 1      1 └──────────┘  │
                 │1                  │1        │1
                 │                   │         │
              n  │ RefreshToken      │ n       │ n
                                ┌─────────┐  ┌────────────┐ n   1 ┌────────┐
     Course 1 ──────────── n    │ Section │──│ Enrollment │───────│ Course │
                                └─────────┘1 n└────────────┘       └────────┘
                                     │1
                                     │n
                               ┌────────────┐ 1   n ┌─────────────────┐
                               │ Attendance │───────│ AttendanceAudit │
                               └────────────┘       └─────────────────┘
     Announcement ──(optional)── Course / Section,  createdBy ── User
```

References use `ObjectId` + `ref` (normalised design). Embedding was rejected because enrolments and attendance grow without bound and are queried on their own.

## Collections

### users
| Field | Type | Rules |
|---|---|---|
| name | String | required, 2–100 |
| email | String | required, **unique**, lowercase, email format |
| password | String | bcrypt hash, `select: false`, never returned in JSON |
| role | String | `admin`, `faculty` or `student`; indexed |
| phone | String | optional, format check |
| isActive | Boolean | default true (soft delete) |
| tokenVersion | Number | incremented on logout or password change to invalidate tokens |
| lastLoginAt | Date | |

### refreshtokens
`user` → User, `tokenHash` (SHA-256 of the token, **unique**), `expiresAt` (**TTL index**: Mongo deletes expired tokens automatically), `revokedAt`, `replacedByHash` (rotation chain), `createdByIp`.

### students
`user` → User (**unique**, 1:1), `rollNumber` (**unique**, uppercase), `department` (enum), `year` (1–5), `batch`, `guardianPhone`.

### faculties
`user` → User (**unique**, 1:1), `employeeId` (**unique**), `department`, `designation` (enum), `specialization`.

### courses
`code` (**unique**, e.g. `CS201`), `title`, `description`, `department`, `credits` (1–6), `semester` (1–10), `isActive`.

### sections
`course` → Course, `name` (`A`), `academicYear` (`2025-26`), `faculty` → Faculty (nullable), `capacity` (1–500), `room`.
Unique on **(course, name, academicYear)**.

### enrollments
`student` → Student, `course` → Course, `section` → Section, `status` (`active`, `dropped` or `completed`), `enrolledBy` → User.
Unique on **(student, course)**, so a student can never be enrolled twice in the same course (even in different sections).

### attendances
One document per student per class session.
`student`, `course`, `section`, `date` (normalised to 00:00 UTC), `period` (1–12), `status` (`present`, `absent`, `late` or `excused`), `markedBy`, `lastModifiedBy`, `correctionCount`.
Unique on **(student, section, date, period)**, so duplicate attendance for a session is impossible even under concurrent requests.

### attendanceaudits
Insert-only audit trail: `attendance`, `student`, `changedBy`, `oldStatus`, `newStatus`, `reason` (required), `changedAt`.

### announcements
`title`, `body`, `scope` (`university`, `course` or `section`), `course` (required if scope is course; also filled in for section scope), `section` (required if scope is section), `priority`, `createdBy` → User, `expiresAt`.

## Indexes

| Collection | Index | Type | Purpose |
|---|---|---|---|
| users | `{ email: 1 }` | unique | Login lookup, no duplicate accounts |
| users | `{ role: 1 }` | | Filter users by role |
| refreshtokens | `{ tokenHash: 1 }` | unique | Refresh lookup |
| refreshtokens | `{ expiresAt: 1 }` | **TTL** | Automatic cleanup of expired tokens |
| refreshtokens | `{ user: 1 }` | | Revoke all of a user's tokens on logout |
| students | `{ rollNumber: 1 }`, `{ user: 1 }` | unique | Identity |
| students | `{ department: 1, year: 1 }` | compound | Student list filter |
| faculties | `{ employeeId: 1 }`, `{ user: 1 }` | unique | Identity |
| courses | `{ code: 1 }` | unique | Identity |
| courses | `{ department: 1, semester: 1 }` | compound | Course list filter |
| courses | `{ title: 'text', description: 'text' }` | **text** | `?search=` |
| sections | `{ course: 1, name: 1, academicYear: 1 }` | unique compound | No duplicate sections |
| sections | `{ faculty: 1 }` | | "My sections" and faculty permission checks |
| enrollments | `{ student: 1, course: 1 }` | unique compound | Business rule: no duplicate enrolment |
| enrollments | `{ section: 1, status: 1 }` | compound | Class lists and capacity checks |
| attendances | `{ student: 1, section: 1, date: 1, period: 1 }` | unique compound | Business rule: no duplicate attendance |
| attendances | `{ student: 1, course: 1, date: -1 }` | compound | Student history and summary aggregation |
| attendances | `{ section: 1, date: -1 }` | compound | Faculty views and section reports |
| attendanceaudits | `{ attendance: 1 }` | | Audit history lookup |
| announcements | `{ scope: 1, course: 1, section: 1, createdAt: -1 }` | compound | Visibility filter plus newest-first feed |
| announcements | `{ title: 'text', body: 'text' }` | text | `?search=` |

## Aggregation pipelines

All of them are in `src/controllers/reportController.js` and `src/services/attendanceService.js`.

1. **Attendance summary** (`/reports/attendance-summary`, `/attendance/me/summary`)
   `$match` (course, section, date range, faculty scope) → `$group` by {student, course} with `$sum` + `$cond` for present, late, absent and excused → `$addFields` percentage (excused left out, `$round`) → `$lookup` students → users → courses → `$project` → `$sort`.
2. **Low-attendance list** (`/reports/low-attendance`)
   Same group stage, then `$match: { percentage: { $lt: threshold } }`. The threshold comes from the query string or `ATTENDANCE_THRESHOLD`.
3. **Course enrolment counts** (`/reports/enrollment-counts`)
   Starts from `courses` so courses with zero enrolments still appear. `$lookup` with a sub-pipeline groups enrolments by status, a second `$lookup` gets sections, `$addFields` computes active and total enrolments, capacity and fill rate, and `$facet` returns per-course rows, per-department totals and grand totals in one round trip.
4. **Section summary** (`/reports/section-summary`)
   `$lookup` course, faculty → user (`preserveNullAndEmptyArrays` for unassigned sections), a `$lookup` sub-pipeline `$count` of active enrolments, and a `$lookup` sub-pipeline over attendances using `$addToSet` of {date, period} to count distinct classes held and the average attendance.

## Data integrity without transactions

The project runs on a standalone MongoDB, so multi-document transactions are not used. Instead:
- Unique indexes enforce the critical invariants (duplicate enrolment, duplicate attendance, duplicate section).
- Creating a user and its profile is compensated: if the profile insert fails, the user is deleted.
- Deletes that would orphan history are refused with 409 (course with enrolments, student with attendance, faculty with sections). Users are soft-deleted (`isActive=false`).

## Seed data

`npm run seed` (`scripts/seed.js --fresh`) builds every index (`syncIndexes`) and inserts 1 admin, 3 faculty, 12 students, 4 courses, 5 sections, 35 enrolments, about 350 attendance records over the last 10 weekdays (students 003 and 009 deliberately below 75%), 1 audit entry and 3 announcements. The data is the same on every run because the random generator is seeded.
