const jwt = require('jsonwebtoken');
const ApiError = require('../utils/ApiError');
const { verifyAccessToken } = require('../utils/tokens');
const { User, Student, Faculty } = require('../models');
const { ROLES } = require('../config/constants');

// Verifies the JWT access token and attaches the user (and their student/faculty profile) to req.
async function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return next(ApiError.unauthorized('Missing or malformed Authorization header (expected: Bearer <token>)'));
  }

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch (err) {
    const msg = err instanceof jwt.TokenExpiredError ? 'Access token expired' : 'Invalid access token';
    return next(ApiError.unauthorized(msg));
  }

  const user = await User.findById(payload.sub).select('+tokenVersion');
  if (!user || !user.isActive) return next(ApiError.unauthorized('User no longer exists or is deactivated'));
  // Token was issued before the last logout / password change.
  if (user.tokenVersion !== payload.tv) return next(ApiError.unauthorized('Token has been revoked, please log in again'));

  req.user = user;
  if (user.role === ROLES.STUDENT) req.student = await Student.findOne({ user: user._id });
  if (user.role === ROLES.FACULTY) req.faculty = await Faculty.findOne({ user: user._id });
  return next();
}

// Role-based access control: authorize('admin', 'faculty')
function authorize(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!allowedRoles.includes(req.user.role)) {
      return next(ApiError.forbidden(`This action requires one of the roles: ${allowedRoles.join(', ')}`));
    }
    return next();
  };
}

module.exports = { authenticate, authorize };
