# Socket.IO Real-Time API

Server URL: `http://localhost:5000` (same port as the REST API, default namespace `/`).

## Authentication

A socket must send a valid **access token** in the handshake. Unauthenticated or revoked connections are refused with a `connect_error` whose message starts with `UNAUTHORIZED`.

```js
import { io } from 'socket.io-client';
const socket = io('http://localhost:5000', { auth: { token: accessToken } });
socket.on('connect_error', (err) => console.log(err.message)); // "UNAUTHORIZED: token missing"
```

The `Authorization: Bearer <token>` header also works for non-browser clients.

## Rooms

On connection the server places the socket into rooms based on the user's data:

| Room | Members |
|---|---|
| `user:<userId>` | That user only (private notifications) |
| `role:<role>` | Every connected user with that role (`role:admin` gets every announcement and session summaries) |
| `university` | Every connected user |
| `course:<courseId>` | Students enrolled in the course and faculty teaching any of its sections |
| `section:<sectionId>` | Students and the faculty member of that section |

When an admin enrols a student, the student's open sockets are added to the new course and section rooms straight away.

## Server → client events

| Event | Sent to | Triggered by | Payload |
|---|---|---|---|
| `connected` | the connecting socket | connection | `{ message, user: { id, name, role }, rooms: [] }` |
| `announcement:new` | `university`, `course:<id>` or `section:<id>`, plus `role:admin` | `POST /api/announcements` | Full announcement document |
| `attendance:marked` | `user:<studentUserId>` (each student) | `POST /api/attendance` | `{ attendanceId, courseId, sectionId, date, period, status }` |
| `attendance:session-recorded` | `role:admin` | `POST /api/attendance` | `{ sectionId, courseId, date, period, count }` |
| `attendance:updated` | `user:<studentUserId>` | `PATCH /api/attendance/:id` | `{ attendanceId, studentId, sectionId, courseId, date, oldStatus, newStatus, changedBy }` |
| `attendance:low` | `user:<studentUserId>` | marking or correction that leaves the student below the threshold (after 3 or more classes) | `{ studentId, userId, rollNumber, courseId, percentage, threshold }` |
| `enrollment:created` | `user:<studentUserId>` | `POST /api/enrollments` | `{ enrollmentId, course, section }` |

## Client → server events

| Event | Payload | Ack |
|---|---|---|
| `rooms:refresh` | – | `({ rooms })`: recomputes the socket's rooms (e.g. after a faculty assignment changes) |

## How events flow

```
Controller ──emit──▶ appEvents (Node EventEmitter) ──▶ listeners.js ──▶ io.to(room).emit(...)
                                                  └──▶ console event log
```

Controllers never call Socket.IO directly. They emit domain events (`announcement.created`, `attendance.marked`, `attendance.updated`, `attendance.low`, `enrollment.created`), and the listeners decide who gets notified. Because of this, a notifier can be added (for example email) without touching the controllers. The emitter is created with `captureRejections: true`, so errors in async listeners go to the `error` handler and never crash the process.

## Trying it out

- Browser: `http://localhost:5000/socket-demo.html`
- CLI: `npm run socket:demo -- student003@campus.edu Password@123`
