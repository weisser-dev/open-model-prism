import { Router } from 'express';
import { adminAuth } from '../../middleware/auth.js';
import { adminOnly } from '../../middleware/rbac.js';
import LdapConfig from '../../models/LdapConfig.js';
import { encrypt } from '../../utils/encryption.js';
import { testLdapConnection } from '../../services/ldapAuth.js';

const router = Router();
router.use(adminAuth, adminOnly);

// Get LDAP config (bind password masked)
router.get('/', async (_req, res) => {
  const cfg = await LdapConfig.findOne();
  if (!cfg) return res.json({ enabled: false });
  const obj = cfg.toObject();
  if (obj.bindPassword) obj.bindPassword = '***';
  res.json(obj);
});

// Save LDAP config
router.put('/', async (req, res) => {
  const { enabled, url, bindDn, bindPassword, searchBase, searchFilter,
          defaultRole, groupMapping, tlsInsecure } = req.body;

  let cfg = await LdapConfig.findOne();
  if (!cfg) cfg = new LdapConfig();

  if (enabled !== undefined) cfg.enabled = enabled;
  if (url !== undefined) cfg.url = url;
  if (bindDn !== undefined) cfg.bindDn = bindDn;
  if (searchBase !== undefined) cfg.searchBase = searchBase;
  if (searchFilter !== undefined) cfg.searchFilter = searchFilter;
  if (defaultRole !== undefined) cfg.defaultRole = defaultRole;
  if (groupMapping !== undefined) cfg.groupMapping = groupMapping;
  if (tlsInsecure !== undefined) cfg.tlsInsecure = tlsInsecure;

  if (bindPassword && bindPassword !== '***') {
    cfg.bindPassword = encrypt(bindPassword);
  }

  await cfg.save();

  const obj = cfg.toObject();
  if (obj.bindPassword) obj.bindPassword = '***';
  res.json(obj);
});

// Test LDAP connection
router.post('/test', async (req, res) => {
  const { url, bindDn, bindPassword, tlsInsecure } = req.body;

  // Use stored password if caller sent placeholder
  let resolvedPw = bindPassword;
  if (!bindPassword || bindPassword === '***') {
    const stored = await LdapConfig.findOne();
    resolvedPw = stored?.bindPassword || '';
  }

  try {
    await testLdapConnection({ url, bindDn, bindPassword: resolvedPw, tlsInsecure });
    res.json({ success: true, message: 'LDAP bind successful' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

export default router;
