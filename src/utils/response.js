// Consistent JSON response helpers. Every success response looks like:
// { success: true, message?, data, meta? }
function sendSuccess(res, { status = 200, message, data = null, meta } = {}) {
  const body = { success: true };
  if (message) body.message = message;
  body.data = data;
  if (meta) body.meta = meta;
  return res.status(status).json(body);
}

module.exports = { sendSuccess };
