const jwt = require('jsonwebtoken');
const ApiError = require('../utils/ApiError');
const { User, Student, RefreshToken } = require('../models');
const { ROLES } = require('../config/constants');
const { signAccessToken, signRefreshToken, verifyRefreshToken, hashToken } = require('../utils/tokens');

async function issueTokens(user, ip) {
  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);
  const { exp } = jwt.decode(refreshToken);
  await RefreshToken.create({ user: user._id, tokenHash: hashToken(refreshToken), expiresAt: new Date(exp * 1000), createdByIp: ip });
  return { accessToken, refreshToken, tokenType: 'Bearer' };
}

// Public self-registration creates a STUDENT account with its academic profile.
// Faculty and admin accounts are created by an administrator.
async function registerStudent({ name, email, password, phone, rollNumber, department, year, batch }, ip) {
  if (await User.exists({ email: email.toLowerCase() })) throw ApiError.conflict('Email is already registered');
  if (await Student.exists({ rollNumber: rollNumber.toUpperCase() })) throw ApiError.conflict('Roll number is already registered');

  const user = await User.create({ name, email, password, phone, role: ROLES.STUDENT });
  let student;
  try {
    student = await Student.create({ user: user._id, rollNumber, department, year, batch });
  } catch (err) {
    await User.deleteOne({ _id: user._id }); // compensate: no orphan user without a profile
    throw err;
  }
  const tokens = await issueTokens(user, ip);
  return { user, profile: student, tokens };
}

async function login(email, password, ip) {
  const user = await User.findOne({ email: String(email).toLowerCase() }).select('+password +tokenVersion');
  // Same message for unknown email and wrong password, so attackers cannot enumerate accounts.
  if (!user || !(await user.comparePassword(password))) throw ApiError.unauthorized('Invalid email or password');
  if (!user.isActive) throw ApiError.forbidden('Account is deactivated. Contact the administrator.');

  user.lastLoginAt = new Date();
  await user.save();
  const tokens = await issueTokens(user, ip);
  return { user, tokens };
}

// Refresh-token rotation: the presented token is revoked and a new pair is issued.
// Re-using an already revoked token revokes every session of that user (token theft detection).
async function refresh(refreshToken, ip) {
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch (err) {
    throw ApiError.unauthorized(err instanceof jwt.TokenExpiredError ? 'Refresh token expired' : 'Invalid refresh token');
  }

  const stored = await RefreshToken.findOne({ tokenHash: hashToken(refreshToken) });
  if (!stored) throw ApiError.unauthorized('Refresh token not recognised');
  if (stored.revokedAt) {
    await RefreshToken.updateMany({ user: stored.user, revokedAt: null }, { revokedAt: new Date() });
    throw ApiError.unauthorized('Refresh token has already been used or revoked; all sessions were signed out');
  }

  const user = await User.findById(payload.sub).select('+tokenVersion');
  if (!user || !user.isActive || user.tokenVersion !== payload.tv) throw ApiError.unauthorized('Session is no longer valid');

  const tokens = await issueTokens(user, ip);
  stored.revokedAt = new Date();
  stored.replacedByHash = hashToken(tokens.refreshToken);
  await stored.save();
  return { user, tokens };
}

// Logout invalidates the refresh tokens AND every outstanding access token (tokenVersion bump).
async function logout(userId) {
  await Promise.all([
    RefreshToken.updateMany({ user: userId, revokedAt: null }, { revokedAt: new Date() }),
    User.updateOne({ _id: userId }, { $inc: { tokenVersion: 1 } }),
  ]);
}

module.exports = { registerStudent, login, refresh, logout, issueTokens };
