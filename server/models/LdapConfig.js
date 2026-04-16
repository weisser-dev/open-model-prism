import mongoose from 'mongoose';

const groupMappingSchema = new mongoose.Schema({
  groupDn: { type: String, required: true },
  role: { type: String, enum: ['admin', 'maintainer', 'finops', 'tenant-viewer'], required: true },
}, { _id: false });

const ldapConfigSchema = new mongoose.Schema({
  enabled: { type: Boolean, default: false },
  url: String,          // ldap://host:389  or  ldaps://host:636
  bindDn: String,       // service account DN
  bindPassword: String, // encrypted with app ENCRYPTION_KEY
  searchBase: String,   // ou=users,dc=example,dc=com
  searchFilter: { type: String, default: '(uid={{username}})' },
  defaultRole: {
    type: String,
    enum: ['maintainer', 'finops', 'auditor', 'tenant-maintainer', 'tenant-admin', 'tenant-viewer', 'chat-user'],
    default: 'chat-user',
  },
  groupMapping: [groupMappingSchema], // first match wins
  tlsInsecure: { type: Boolean, default: false }, // skip cert verify
}, { timestamps: true });

export default mongoose.model('LdapConfig', ldapConfigSchema);
