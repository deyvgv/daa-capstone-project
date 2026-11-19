# Project Report: University Campus Management System

> Draft that follows the report structure suggested in the assignment. Fill in the sections marked **[TEAM]** (names, contributions, screenshots) before you submit.

## 1. Cover Page and Team Details  **[TEAM]**

| | |
|---|---|
| Project | Capstone Project 1: University Campus Management System |
| Course | Backend Development |
| Technology | Node.js, Express.js, MongoDB, Mongoose, JWT, Socket.IO |
| Team members | Name, roll number, contribution (one row per member) |
| Faculty guide | |
| Submission date | |

## 2. Abstract

Universities often keep student, course, attendance and announcement data in separate spreadsheets and notice boards. This makes attendance tracking slow and makes it hard to spot students with low attendance early. This project is a centralised backend that exposes a secure REST API and a real-time channel for three roles: administrators, faculty and students. It uses Express in an MVC/layered structure, MongoDB through Mongoose with ten related collections, JWT authentication with rotating refresh tokens, role-based and ownership-based authorisation, aggregation pipelines for academic reports, and Socket.IO with a Node.js EventEmitter for live notifications. The API is tested with a Postman collection of 105 requests and 255 assertions covering success, validation, authentication, authorisation and business-rule cases.

## 3. Problem Statement

Build a backend through which:
- administrators manage users, courses, sections, faculty assignments and enrolments;
- faculty record and correct attendance for the sections they teach and publish announcements;
- students view their own courses, attendance percentages and announcements;

while making sure every user can reach only the data and operations their role and relationships allow.

## 4. Objectives

1. Build a centralised backend for core academic information.
2. Provide secure, role-specific access for administrators, faculty and students.
3. Model student, course and faculty relationships in MongoDB.
4. Record attendance and calculate subject-wise attendance percentages.
5. Produce academic summaries with MongoDB aggregation.
6. Deliver announcements and attendance updates in real time.

## 5. Scope and Limitations

**In scope:** authentication (register, login, refresh, logout), user profiles, CRUD for students, faculty, courses, sections and enrolments, attendance marking and correction with an audit trail, scoped announcements, four aggregation reports with CSV export, Socket.IO notifications, seed data, API documentation and a Postman test suite.

**Limitations:**
- Backend only. A small HTML page (`public/socket-demo.html`) exists just to demonstrate real-time events.
- Standalone MongoDB, so multi-document transactions are not used. Integrity relies on unique indexes and compensating deletes (see DATABASE.md).
- No timetable module. A class session is identified by section + date + period.
- Reports export to CSV only, not PDF.
- No email or SMS delivery; notifications are in-app over Socket.IO.

## 6. Requirements

### Functional
| ID | Requirement | Implementation |
|---|---|---|
| FR1 | Registration / admin account creation, login, logout and token invalidation | `/api/auth/*`, `/api/students`, `/api/faculty`, `/api/users` |
| FR2 | bcrypt password hashes, JWT-protected routes | `User` pre-save hook, `authenticate` middleware |
| FR3 | View and update permitted profile fields | `GET/PATCH /api/users/me` (name, phone only) |
| FR4 | CRUD for students, faculty, courses and sections subject to role | Respective routers with `authorize()` |
| FR5 | Assign faculty to courses and sections | `PATCH /api/sections/:id/faculty` |
| FR6 | Enrol students, prevent duplicate or invalid enrolments | `POST /api/enrollments` + unique index (student, course) |
| FR7 | Faculty mark attendance per course, section and date | `POST /api/attendance` |
| FR8 | Correct attendance under a rule with an audit record | `PATCH /api/attendance/:id`, 7-day window, `AttendanceAudit` |
| FR9 | Students view attendance by subject and date | `GET /api/attendance`, `GET /api/attendance/me/summary` |
| FR10 | Total classes, attended, percentage | Aggregation in `attendanceService` |
| FR11 | University, course and section announcements | `POST /api/announcements` |
| FR12 | Real-time announcements and attendance updates | Socket.IO events `announcement:new`, `attendance:*` |
| FR13 | Retrieve previous announcements over REST | `GET /api/announcements` |
| FR14 | Subject-wise summaries, students below a configurable threshold | `/api/reports/attendance-summary`, `/api/reports/low-attendance?threshold=` |
| FR15 | Enrolment counts and section-wise summaries | `/api/reports/enrollment-counts`, `/api/reports/section-summary` |

### Non-functional
- **Security:** bcrypt, short-lived access tokens, hashed and rotating refresh tokens with reuse detection, `tokenVersion` revocation, Helmet headers, secrets in `.env`, password hash never serialised, consistent "invalid email or password" message.
- **Maintainability:** MVC layering (routes → middleware → controllers → services → models), shared validators, one central error handler.
- **Performance:** indexes on every query path, pagination with a 100-item limit, `lean()` reads, `$facet` to return several report sections in one query.
- **Observability:** request ID on every request and error, morgan access log with the user, event log for domain events, graceful shutdown.

## 7. System Architecture and Module Description

```
Client (Postman / browser)
   │ HTTP (JSON)                       │ WebSocket (Socket.IO, JWT handshake)
   ▼                                   ▼
http.createServer ── Express app ──────┴── Socket.IO server (rooms by user/role/course/section)
   │  requestId → morgan → helmet → cors → express.json
   │  /api router → authenticate → authorize(role) → validate(rules)
   ▼
Controllers ──▶ Services (auth, access rules, attendance maths) ──▶ Mongoose models ──▶ MongoDB
   │
   └─ appEvents.emit(...) ──▶ listeners ──▶ io.to(room).emit(...)
   errors ──▶ central errorHandler ──▶ { success:false, error:{code,message,details}, requestId }
```

| Module | Files | Responsibility |
|---|---|---|
| Config | `src/config/*` | dotenv loading and validation, DB connection, enums |
| Models | `src/models/*` | Schemas, validation, indexes, bcrypt hook |
| Routes | `src/routes/index.js` | Endpoint → middleware chain → controller |
| Middleware | `src/middleware/*` | Authentication, RBAC, validation, logging, error handling |
| Controllers | `src/controllers/*` | HTTP handling per resource |
| Services | `src/services/*` | Token issuing and rotation, data-based permission checks, attendance aggregation |
| Events | `src/events/*` | EventEmitter bus and listeners |
| Socket | `src/socket/index.js` | Socket authentication and room membership |

**Example request flow** (`POST /api/attendance`): route → `authenticate` (verify JWT, load user, check `tokenVersion`, attach faculty profile) → `authorize('faculty','admin')` → `validate(attendance.mark)` → `attendanceController.mark` → `getSectionForStaff` (403 if not assigned) → duplicate-student, enrolment and existing-session checks → `Attendance.insertMany` → `appEvents.emit('attendance.marked')` → low-attendance aggregation → 201 JSON. The listener then pushes `attendance:marked` and `attendance:low` to the students' private rooms.

## 8. Database Design

See [DATABASE.md](DATABASE.md) for the ER diagram, all ten collections, 24 indexes (unique, compound, text, TTL) and the four aggregation pipelines.

## 9. REST API Documentation

See [API.md](API.md) (endpoints, auth, parameters, samples, errors) and [SOCKET_EVENTS.md](SOCKET_EVENTS.md) (real-time events, payloads, rooms, authentication).

## 10. Authentication and Authorization Design

- **Passwords:** hashed with bcrypt (`BCRYPT_SALT_ROUNDS`, default 10) in a Mongoose `pre('save')` hook. The field has `select: false` and is removed in `toJSON`.
- **Access token:** JWT (HS256), 15-minute lifetime, payload `{ sub, role, tv, type:'access' }`.
- **Refresh token:** JWT signed with a separate secret, 7-day lifetime, unique `jti`. Only its SHA-256 hash is stored in `refreshtokens`. Every refresh revokes the presented token and issues a new pair (rotation). Reusing a revoked token revokes all of the user's sessions.
- **Revocation:** `tokenVersion` (`tv`) on the user. Logout, password change and deactivation increment it, so outstanding access tokens fail at once.
- **RBAC:** `authorize(...roles)` middleware on each route.
- **Ownership rules (backend enforced):** faculty act only on assigned sections; students only read their own student record, attendance and audit (a `?student=` from a student is ignored); announcements can be edited only by their author or an admin; faculty cannot post university-wide.
- **Sockets:** the same access token is verified in `io.use()` before a connection is accepted.

## 11. Implementation Details

- **Node.js core modules used:** `http` (server), `events` (EventEmitter), `crypto` (UUID request IDs, token hashing), `path`, and `process` (env, signals for graceful shutdown, `argv` for the seed CLI flag `--fresh`, `uncaughtException`/`unhandledRejection` handlers).
- **Express 5** passes rejected promises from async handlers to the error middleware automatically, so the controllers need no try/catch.
- **Validation** happens at two layers: express-validator at the request boundary (400 with per-field details) and Mongoose schema validation as the last line of defence (mapped to 400 by the error handler; duplicate-key `11000` mapped to 409).
- **Pagination helper** (`utils/pagination.js`) sanitises `page`, `limit` and `sort`, with a whitelist of sortable fields.
- **Attendance dates** are normalised to UTC midnight so that one "day" is the same whatever the client's time zone.
- **CSV export** uses a small built-in serializer (`utils/csv.js`).

## 12. Testing Strategy and Test Cases

Tool: Postman collection `postman/Campus-Management-System.postman_collection.json`, also run from the CLI with Newman (`npm run test:api`). Requests chain IDs and tokens through environment variables. Result of the last run: **105 requests, 255 assertions, 0 failures**.

| Category (assignment requirement) | Examples |
|---|---|
| Successful request | Login, create course, mark attendance, reports |
| Validation failure | Register with 5 invalid fields, invalid attendance status, malformed JSON, threshold of 150 |
| Resource not found | Unknown user ID, deleted student, deleted announcement, unknown route |
| No valid token | No header, garbage token, token used after logout, refresh after logout |
| Insufficient role | Student lists users, faculty creates a course, student posts an announcement, faculty asks for enrolment counts |
| Duplicate / conflict | Duplicate email, roll number, course code, section, enrolment, attendance session; delete a course with enrolments |
| Business rules | Faculty marks another faculty's section, student not enrolled, future date, same student twice, correction without reason, student reads another student's record, refresh-token reuse, faculty edits another author's announcement |

Real-time features were checked with a script that connects as a student and an admin, marks attendance and publishes an announcement. It confirmed that `attendance:marked`, `attendance:low`, `attendance:session-recorded` and `announcement:new` reached the right rooms and that unauthenticated sockets were refused.

## 13. Screenshots / Demonstration Evidence  **[TEAM]**

Add: Postman runner summary, a 401 and a 403 response, the low-attendance report, the CSV download, the socket demo page receiving `attendance:low`, and MongoDB Compass showing the indexes.

## 14. Conclusion and Future Enhancements

The system meets every core requirement of Project 1. It provides secure multi-role access, a normalised data model protected by unique indexes, attendance with an audit trail, aggregation-based analytics and real-time notifications.

Future enhancements: a timetable and class-session module, PDF reports, scheduled low-attendance digests, MongoDB transactions on a replica set, rate limiting on the auth endpoints, automated Jest/Supertest integration tests in CI, and a frontend dashboard.

## 15. References

- Node.js documentation: https://nodejs.org/docs
- Express 5 documentation: https://expressjs.com
- Mongoose documentation: https://mongoosejs.com/docs
- MongoDB aggregation and indexes: https://www.mongodb.com/docs/manual/aggregation/
- Socket.IO documentation: https://socket.io/docs/v4/
- RFC 7519, JSON Web Token
- OWASP Authentication Cheat Sheet
