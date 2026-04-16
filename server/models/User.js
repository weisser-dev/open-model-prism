import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

export const ROLES = [
  'admin',              // Full system access — manage everything
  'maintainer',         // Config management — providers, tenants, routing, no user mgmt
  'finops',             // Financial visibility — costs, savings, quotas (read-only, no prompts)
  'auditor',            // Compliance — read-only global view with audit trail (Enterprise)
  'tenant-maintainer',  // Team lead — manage keys, overrides, budgets for assigned tenants
  'tenant-admin',       // Tenant config — model whitelist/blacklist for assigned tenants
  'tenant-viewer',      // Read-only — dashboard for assigned tenants
  'chat-user',          // End user — chat only, own usage stats (LDAP default)
];

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: String, // null for LDAP-only users
  role: { type: String, enum: ROLES, required: true, default: 'tenant-viewer' },
  // For tenant-viewer: which tenants they can see
  tenants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Tenant' }],
  source: { type: String, enum: ['local', 'ldap'], default: 'local' },
  active: { type: Boolean, default: true },
  lastLogin: Date,
}, { timestamps: true });

userSchema.statics.hashPassword = function (password) {
  return bcrypt.hash(password, 12);
};

userSchema.methods.verifyPassword = function (password) {
  if (!this.passwordHash) return Promise.resolve(false);
  return bcrypt.compare(password, this.passwordHash);
};

export default mongoose.model('User', userSchema);
