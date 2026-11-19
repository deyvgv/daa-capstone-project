const mongoose = require('mongoose');
const config = require('../config/env');
const ApiError = require('../utils/ApiError');

// 404 for unknown routes.
function notFound(req, res, next) {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
}

// Converts library errors (Mongoose, MongoDB, JSON parser) into ApiError instances.
function normalizeError(err) {
  if (err instanceof ApiError) return err;

  if (err instanceof mongoose.Error.ValidationError) {
    const details = Object.values(err.errors).map((e) => ({ field: e.path, message: e.message }));
    return new ApiError(400, 'Validation failed', { code: 'VALIDATION_ERROR', details });
  }
  if (err instanceof mongoose.Error.CastError) {
    return new ApiError(400, `Invalid value for ${err.path}: ${JSON.stringify(err.value)}`, { code: 'INVALID_ID' });
  }
  if (err && err.code === 11000) {
    const fields = Object.keys(err.keyValue || err.keyPattern || {});
    return new ApiError(409, `Duplicate value for: ${fields.join(', ')}`, { code: 'DUPLICATE', details: err.keyValue });
  }
  if (err && err.type === 'entity.parse.failed') {
    return new ApiError(400, 'Request body is not valid JSON', { code: 'INVALID_JSON' });
  }
  const wrapped = new ApiError(err.status || err.statusCode || 500, err.expose ? err.message : 'Internal server error');
  wrapped.original = err;
  return wrapped;
}

// Centralized error handler - the ONLY place that sends error responses.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const error = normalizeError(err);

  if (error.statusCode >= 500) {
    console.error(`[${req.id}]`, error.original || err);
  }

  const body = {
    success: false,
    error: {
      code: error.code,
      message: error.message,
      ...(error.details && { details: error.details }),
    },
    requestId: req.id,
  };
  if (!config.isProduction && error.statusCode >= 500) body.error.stack = (error.original || err).stack;

  res.status(error.statusCode).json(body);
}

module.exports = { notFound, errorHandler };
