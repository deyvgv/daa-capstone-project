// Reads ?page, ?limit and ?sort from the query string and returns safe values.
// sort accepts a comma-separated list such as "-createdAt,name" (leading "-" = descending).
function getPagination(query, { defaultLimit = 20, maxLimit = 100, defaultSort = '-createdAt', allowedSort = [] } = {}) {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || defaultLimit, 1), maxLimit);

  const sort = {};
  String(query.sort || defaultSort)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((field) => {
      const dir = field.startsWith('-') ? -1 : 1;
      const name = field.replace(/^[-+]/, '');
      if (!allowedSort.length || allowedSort.includes(name)) sort[name] = dir;
    });
  if (!Object.keys(sort).length) sort.createdAt = -1;

  return { page, limit, skip: (page - 1) * limit, sort };
}

function buildMeta({ page, limit }, total) {
  return { page, limit, total, totalPages: Math.ceil(total / limit) || 0 };
}

// Runs a paginated find + count in parallel.
async function paginate(Model, filter, pagination, { populate, select, lean = true } = {}) {
  let q = Model.find(filter).sort(pagination.sort).skip(pagination.skip).limit(pagination.limit);
  if (select) q = q.select(select);
  if (populate) q = q.populate(populate);
  if (lean) q = q.lean();
  const [items, total] = await Promise.all([q, Model.countDocuments(filter)]);
  return { items, meta: buildMeta(pagination, total) };
}

function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { getPagination, buildMeta, paginate, escapeRegex };
