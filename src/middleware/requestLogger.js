const crypto = require('crypto');
const morgan = require('morgan');

// Gives every request an ID (returned as the X-Request-Id header and included in error responses)
// so a client error can be matched with the server log line.
function requestId(req, res, next) {
  req.id = req.headers['x-request-id'] || crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
}

morgan.token('id', (req) => req.id);
morgan.token('user', (req) => (req.user ? `${req.user.role}:${req.user._id}` : 'anonymous'));

const httpLogger = morgan(':id :method :url :status :res[content-length]B - :response-time ms [:user]');

module.exports = { requestId, httpLogger };
