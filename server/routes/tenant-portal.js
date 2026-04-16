/**
 * Tenant Portal — self-service API for tenant-admin role.
 * Allows tenant-admins to view and update their own tenant's model config.
 */
import { Router } from 'express';
import mongoose from 'mongoose';
import Tenant from '../models/Tenant.js';
import Provider from '../models/Provider.js';

const router = Router();

/** Check the caller owns the tenant identified by req.params.id */
function assertOwns(req, res) {
  const { role, tenants: userTenants } = req.user || {};
  if (['admin', 'maintainer'].includes(role)) return true; // unrestricted
  if (role !== 'tenant-admin') {
    res.status(403).json({ error: 'Access denied' });
    return false;
  }
  const owned = (Array.isArray(userTenants) ? userTenants : []).map(String);
  if (!owned.includes(String(req.params.id))) {
    res.status(403).json({ error: 'Access denied — not your tenant' });
    return false;
  }
  return true;
}

/**
 * GET /api/tenant-portal/mine
 * Returns only the tenants the caller is assigned to (for tenant-admin),
 * or all tenants (for admin/maintainer).
 */
router.get('/mine', async (req, res) => {
  const { role, tenants: userTenants } = req.user || {};
  if (['admin', 'maintainer'].includes(role)) {
    const tenants = await Tenant.find().select('-apiKeyHash');
    return res.json(tenants);
  }
  if (!['tenant-admin', 'tenant-viewer'].includes(role)) {
    return res.status(403).json({ error: 'Access denied' });
  }
  const allowed = (Array.isArray(userTenants) ? userTenants : [])
    .map(id => { try { return new mongoose.Types.ObjectId(id); } catch { return null; } })
    .filter(Boolean);
  const tenants = await Tenant.find({ _id: { $in: allowed } }).select('-apiKeyHash');
  res.json(tenants);
});

/**
 * GET /api/tenant-portal/:id
 * Returns full tenant config (minus API key hash) if caller owns it.
 */
router.get('/:id', async (req, res) => {
  if (!assertOwns(req, res)) return;
  const tenant = await Tenant.findById(req.params.id).select('-apiKeyHash');
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
  res.json(tenant);
});

/**
 * PUT /api/tenant-portal/:id/model-config
 * Update only the modelConfig for a tenant the caller owns.
 * Body: { mode: 'all'|'whitelist'|'blacklist', list: string[] }
 */
router.put('/:id/model-config', async (req, res) => {
  if (!assertOwns(req, res)) return;
  const { mode, list } = req.body;
  const validModes = ['all', 'whitelist', 'blacklist'];
  if (mode && !validModes.includes(mode)) {
    return res.status(400).json({ error: 'Invalid mode — must be all, whitelist, or blacklist' });
  }
  const tenant = await Tenant.findById(req.params.id);
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

  if (mode !== undefined) tenant.modelConfig.mode = mode;
  if (Array.isArray(list)) tenant.modelConfig.list = list;
  await tenant.save();

  const obj = tenant.toObject();
  delete obj.apiKeyHash;
  res.json(obj);
});

/**
 * GET /api/tenant-portal/:id/models
 * Returns the models available to this tenant (from assigned providers,
 * filtered by modelConfig whitelist/blacklist).
 */
router.get('/:id/models', async (req, res) => {
  if (!assertOwns(req, res)) return;
  const tenant = await Tenant.findById(req.params.id).select('-apiKeyHash');
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

  const providers = await Provider.find({ _id: { $in: tenant.providerIds } });
  let models = [];
  for (const p of providers) {
    for (const m of p.discoveredModels || []) {
      models.push({ ...m.toObject(), providerId: p._id, providerName: p.name });
    }
  }

  // Apply modelConfig filter
  const { mode, list } = tenant.modelConfig || {};
  if (mode === 'whitelist' && list?.length) {
    models = models.filter(m => list.includes(m.id));
  } else if (mode === 'blacklist' && list?.length) {
    models = models.filter(m => !list.includes(m.id));
  }

  res.json(models);
});

export default router;
