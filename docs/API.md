# API Reference

Base URL: `http://localhost:5000/api`

## Conventions

**Authentication.** Every endpoint except `/health`, `/auth/register`, `/auth/login` and `/auth/refresh` needs an access token:

```
Authorization: Bearer <accessToken>
```

**Success response**
```json
{ "success": true, "message": "optional", "data": { }, "meta": { "page": 1, "limit": 20, "total": 42, "totalPages": 3 } }
```

**Error response** (always produced by the central error handler)
```json
{
  "success": false,
  "error": { "code": "VALIDATION_ERROR", "message": "Validation failed",
             "details": [{ "field": "email", "location": "body", "message": "A valid email is required" }] },
  "requestId": "6c1c4c0e-..."
}
```

| Status | `error.code` | When |
|---|---|---|
| 400 | `VALIDATION_ERROR`, `INVALID_ID`, `INVALID_JSON`, `BAD_REQUEST` | Invalid input or a broken business rule |
| 401 | `UNAUTHORIZED` | Missing, invalid, expired or revoked token |
| 403 | `FORBIDDEN` | Wrong role, or the resource does not belong to you |
| 404 | `NOT_FOUND` | Resource or route does not exist |
| 409 | `CONFLICT`, `DUPLICATE` | Duplicate value or conflicting state |
| 500 | `INTERNAL_ERROR` | Unexpected server error (logged with the requestId) |

**List endpoints** accept `page` (default 1), `limit` (default 20, max 100) and `sort` (for example `sort=-createdAt,name`), and return `meta`.

Role abbreviations used below: **A** = admin, **F** = faculty, **S** = student, **Any** = any logged-in user.

---

## Health

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | none | Server uptime and DB connection state |

## Auth

| Method | Path | Auth | Body | Success | Errors |
|---|---|---|---|---|---|
| POST | `/auth/register` | none | `name, email, password, rollNumber, department, year, [phone, batch]` | 201: user, profile, tokens | 400 validation, 409 duplicate email or roll number |
| POST | `/auth/login` | none | `email, password` | 200: user, `accessToken`, `refreshToken` | 400, 401 wrong credentials, 403 deactivated |
| POST | `/auth/refresh` | none | `refreshToken` | 200: new token pair (old refresh token revoked) | 400, 401 invalid, expired or reused |
| POST | `/auth/logout` | Any | – | 200 | 401 |

Password rule: 8–64 characters with at least one letter and one digit. Public registration always creates a **student**. Faculty and admin accounts are created by an administrator.

**Logout and revocation.** Logout revokes every refresh token of the user and increments `tokenVersion`, so any access token issued earlier is rejected immediately. Presenting a refresh token that has already been rotated revokes all of that user's sessions (reuse detection).

Sample `POST /auth/login` response:
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "user": { "_id": "6af9…da", "name": "Asha Admin", "email": "admin@campus.edu", "role": "admin", "isActive": true },
    "accessToken": "eyJhbGciOi…",
    "refreshToken": "eyJhbGciOi…",
    "tokenType": "Bearer"
  }
}
```

## Users

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/users/me` | Any | Own account plus student or faculty profile |
| PATCH | `/users/me` | Any | Update `name` and `phone` only. Sending `email`, `role`, `password` or `isActive` returns 400 |
| PATCH | `/users/me/password` | Any | `currentPassword, newPassword`. Revokes all tokens |
| GET | `/users?role=&isActive=&search=` | A | List users |
| POST | `/users` | A | Create an administrator (`name, email, password`) |
| GET | `/users/:id` | A | User plus profile. 404 if not found |
| PATCH | `/users/:id` | A | `name, phone, isActive`. Deactivating forces sign-out |
| DELETE | `/users/:id` | A | Soft delete (deactivate). Attendance history is kept |

## Students

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/students?department=&year=&search=` | A, F | Faculty only see students enrolled in their own sections |
| POST | `/students` | A | `name, email, password, rollNumber, department, year, [batch, phone]`. Creates the user and the profile |
| GET | `/students/:id` | A, F, S | Includes enrolments. Students can read only their own record; faculty only students in their sections |
| PATCH | `/students/:id` | A | Profile fields plus `name`, `phone` |
| DELETE | `/students/:id` | A | 409 if attendance exists (deactivate the user instead) |

## Faculty

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/faculty?department=&search=` | A | List |
| POST | `/faculty` | A | `name, email, password, employeeId, department, [designation, specialization]` |
| GET | `/faculty/:id` | A, F (own record) | Includes assigned sections |
| PATCH | `/faculty/:id` | A | Profile fields plus `name`, `phone` |
| DELETE | `/faculty/:id` | A | 409 while still assigned to sections |

## Courses

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/courses?department=&semester=&search=` | Any | `search` uses the text index. Non-admins only see active courses |
| POST | `/courses` | A | `code` (e.g. CS201), `title, department, credits (1-6), semester (1-10), [description]` |
| GET | `/courses/:id` | Any | Includes sections and their faculty |
| PATCH | `/courses/:id` | A | Any course field, including `isActive` |
| DELETE | `/courses/:id` | A | 409 if enrolments exist |

## Sections

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/sections?course=&faculty=&academicYear=` | A, F | List |
| GET | `/sections/mine` | F | Sections assigned to the logged-in faculty member |
| POST | `/sections` | A | `course, name, academicYear (2025-26), [faculty, capacity, room]` |
| GET | `/sections/:id` | Any | Includes `enrolledCount` |
| GET | `/sections/:id/students` | A, F (assigned) | Class list |
| PATCH | `/sections/:id` | A | `name, academicYear, capacity, room`. Capacity cannot drop below the current enrolment |
| PATCH | `/sections/:id/faculty` | A | `{ faculty }`: assign a faculty member |
| DELETE | `/sections/:id` | A | 409 if enrolments or attendance exist |

## Enrolments

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/enrollments` | A | `{ student, section }`. The course comes from the section. 409 if already enrolled in the course or the section is full; 400 if a reference is invalid or the student is deactivated |
| GET | `/enrollments?student=&course=&section=&status=` | A | List |
| GET | `/enrollments/me` | S | Own courses, sections and faculty |
| PATCH | `/enrollments/:id` | A | `{ status: active, dropped or completed }` |
| DELETE | `/enrollments/:id` | A | 409 if attendance exists (set `dropped` instead) |

## Attendance

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/attendance` | F (assigned), A | Mark one class session (body below) |
| PATCH | `/attendance/:id` | F (assigned, within the edit window), A | Correct a record: `{ status, reason }` |
| GET | `/attendance?section=&course=&student=&date=&from=&to=&status=` | Any | Students always get only their own records; faculty only records from their own sections |
| GET | `/attendance/me/summary` | S | Subject-wise totals and percentage |
| GET | `/attendance/:id/audit` | Owner student, assigned F, A | Correction history |

`POST /attendance` body:
```json
{
  "section": "6af9…fd",
  "date": "2026-11-14",
  "period": 1,
  "records": [
    { "student": "6af9…35", "status": "present" },
    { "student": "6af9…37", "status": "absent" }
  ]
}
```
Statuses are `present`, `absent`, `late` and `excused`. `present` and `late` count as attended; `excused` is left out of the percentage.

Rules:
- 403 if the faculty member is not assigned to the section.
- 400 for a future date, a student listed twice, or a student not actively enrolled in the section (the response lists the offending IDs).
- 409 if attendance already exists for that session (section + date + period). A unique index guarantees this even under concurrent requests.
- Corrections need a 5–300 character `reason`. Faculty may correct only within `ATTENDANCE_EDIT_WINDOW_DAYS` (default 7); admins can correct at any time. Every correction writes an `AttendanceAudit` document.
- After marking or correcting, a student whose percentage drops below the threshold (after at least 3 classes) gets an `attendance:low` socket event.

Sample `GET /attendance/me/summary`:
```json
{
  "success": true,
  "data": {
    "threshold": 75,
    "overall": { "totalClasses": 30, "attended": 26 },
    "subjects": [
      { "courseCode": "CS201", "courseTitle": "Database Management Systems", "totalClasses": 10, "attended": 9, "absent": 1, "late": 1, "excused": 0, "percentage": 90, "belowThreshold": false }
    ]
  }
}
```

## Announcements

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/announcements` | A, F | `title, body, scope (university, course or section), course or section (depending on scope), [priority, expiresAt]` |
| GET | `/announcements?scope=&course=&section=&search=` | Any | Only announcements visible to the caller; expired ones are hidden |
| GET | `/announcements/:id` | Any (if visible) | 404 if not visible |
| PATCH | `/announcements/:id` | Author or A | `title, body, priority, expiresAt`. The scope cannot change (400) |
| DELETE | `/announcements/:id` | Author or A | |

Faculty may publish only to courses and sections they teach (403 otherwise) and cannot publish university-wide. Students see university announcements plus those for their enrolled courses and sections.

## Reports (aggregation pipelines)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/reports/attendance-summary?course=&section=&from=&to=&format=csv` | A, F | Per student and course: total classes, attended, absent, late, excused, % |
| GET | `/reports/low-attendance?threshold=75&course=&section=&format=csv` | A, F | Students below the threshold, lowest first |
| GET | `/reports/enrollment-counts?department=&semester=` | A | Per course: sections, capacity, active and total enrolments, fill rate. Plus per-department totals |
| GET | `/reports/section-summary?course=&academicYear=` | A, F | Per section: faculty, enrolled, classes held, average attendance |

Faculty results are limited to their own sections. Asking for another faculty member's section returns 403. `format=csv` returns a `text/csv` download.

---

## Real-time API

See [SOCKET_EVENTS.md](SOCKET_EVENTS.md).
