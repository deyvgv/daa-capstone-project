const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config/env');

// Access token: short-lived, sent as "Authorization: Bearer <token>" on every request.
function signAccessToken(user) {
  return jwt.sign({ sub: String(user._id), role: user.role, tv: user.tokenVersion || 0, type: 'access' }, config.jwt.accessSecret, {
    expiresIn: config.jwt.accessExpiresIn,
  });
}

// Refresh token: long-lived, used only on POST /api/auth/refresh to obtain a new token pair.
// jti makes every refresh token unique even if two are issued in the same second.
function signRefreshToken(user) {
  return jwt.sign({ sub: String(user._id), tv: user.tokenVersion || 0, type: 'refresh', jti: crypto.randomUUID() }, config.jwt.refreshSecret, {
    expiresIn: config.jwt.refreshExpiresIn,
  });
}

function verifyAccessToken(token) {
  const payload = jwt.verify(token, config.jwt.accessSecret);
  if (payload.type !== 'access') throw new jwt.JsonWebTokenError('Invalid token type');
  return payload;
}

function verifyRefreshToken(token) {
  const payload = jwt.verify(token, config.jwt.refreshSecret);
  if (payload.type !== 'refresh') throw new jwt.JsonWebTokenError('Invalid token type');
  return payload;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

module.exports = { signAccessToken, signRefreshToken, verifyAccessToken, verifyRefreshToken, hashToken };
