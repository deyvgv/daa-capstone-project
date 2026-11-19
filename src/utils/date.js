// Converts "2025-08-14" (or any date-like value) into a Date at 00:00 UTC so that every
// class session on the same day compares equal regardless of the client's time zone.
function toUtcDay(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function daysBetween(a, b) {
  return Math.floor((toUtcDay(b) - toUtcDay(a)) / 86400000);
}

module.exports = { toUtcDay, daysBetween };
