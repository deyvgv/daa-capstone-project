const mongoose = require('mongoose');

// Refresh tokens are stored as SHA-256 hashes so a database leak does not expose usable tokens.
// Each refresh rotates the token: the old one is revoked and a new one is issued.
const refreshTokenSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    revokedAt: Date,
    replacedByHash: String,
    createdByIp: String,
  },
  { timestamps: true }
);

// TTL index: MongoDB automatically deletes expired refresh tokens.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

refreshTokenSchema.virtual('isActive').get(function isActive() {
  return !this.revokedAt && this.expiresAt > new Date();
});

module.exports = mongoose.model('RefreshToken', refreshTokenSchema);
