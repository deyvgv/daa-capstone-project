const { validationResult } = require('express-validator');
const ApiError = require('../utils/ApiError');

// Runs an array of express-validator chains and turns failures into a 400 response.
// Usage in a route: router.post('/', validate(rules.create), controller.create)
function validate(chains) {
  return async (req, res, next) => {
    await Promise.all(chains.map((chain) => chain.run(req)));
    const result = validationResult(req);
    if (result.isEmpty()) return next();
    const details = result.array().map((e) => ({ field: e.path, location: e.location, message: e.msg }));
    return next(new ApiError(400, 'Validation failed', { code: 'VALIDATION_ERROR', details }));
  };
}

module.exports = validate;
