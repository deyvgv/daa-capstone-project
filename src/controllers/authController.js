// Express 5 forwards rejected promises from async handlers to the error handler automatically,
// so controllers do not need try/catch blocks.
const authService = require('../services/authService');
const { sendSuccess } = require('../utils/response');

exports.register = async (req, res) => {
  const { user, profile, tokens } = await authService.registerStudent(req.body, req.ip);
  sendSuccess(res, { status: 201, message: 'Registration successful', data: { user, profile, ...tokens } });
};

exports.login = async (req, res) => {
  const { user, tokens } = await authService.login(req.body.email, req.body.password, req.ip);
  sendSuccess(res, { message: 'Login successful', data: { user, ...tokens } });
};

exports.refresh = async (req, res) => {
  const { tokens } = await authService.refresh(req.body.refreshToken, req.ip);
  sendSuccess(res, { message: 'Token refreshed', data: tokens });
};

exports.logout = async (req, res) => {
  await authService.logout(req.user._id);
  sendSuccess(res, { message: 'Logged out. All tokens for this account have been revoked.' });
};
