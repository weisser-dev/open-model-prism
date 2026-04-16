import { Router } from 'express';
import Quota from '../../models/Quota.js';
import Tenant from '../../models/Tenant.js';
import { checkQuotas, resetExpiredQuotas, createDefaultQuotas } from '../../services/quotaService.js';
import { adminOrMaint, canViewCosts } from '../../middleware/rbac.js';

const router = Router();

// List all quotas (optional filters: tenantId, quotaType, enabled)
router.get('/', canViewCosts, async (req, res) => {
  try {
    const filter = {};
    if (req.query.tenantId) filter.tenantId = req.query.tenantId;
    if (req.query.quotaType) filter.quotaType = req.query.quotaType;
    if (req.query.enabled !== undefined) filter.enabled = req.query.enabled === 'true';
    const quotas = await Quota.find(filter);
    res.json({ quotas });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all quotas for a specific tenant with current status
router.get('/tenant/:tenantId', canViewCosts, async (req, res) => {
  try {
    const { tenantId } = req.params;
    const tenant = await Tenant.findById(tenantId);
    if (!tenant) return res.status(404).json({ error: 'Not found' });

    const status = await checkQuotas(tenantId);
    const quotas = await Quota.find({ tenantId });

    const merged = quotas.map(q => {
      const doc = q.toObject();
      const match = status.find(s => String(s._id || s.quotaId) === String(doc._id));
      return { ...doc, ...(match || {}) };
    });

    res.json({ quotas: merged });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create a new quota
router.post('/', adminOrMaint, async (req, res) => {
  try {
    const { tenantId, quotaType, limit, enforcement, period } = req.body;

    const tenant = await Tenant.findById(tenantId);
    if (!tenant) return res.status(404).json({ error: 'Not found' });

    const now = new Date();
    let resetAt;
    if (period === 'daily') {
      resetAt = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1); // end of today (midnight)
    } else if (period === 'monthly') {
      resetAt = new Date(now.getFullYear(), now.getMonth() + 1, 1); // end of month (first of next month)
    }

    const quota = await Quota.create({
      tenantId,
      quotaType,
      limit,
      enforcement,
      period,
      resetAt,
    });

    res.status(201).json(quota);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update a quota
router.patch('/:id', adminOrMaint, async (req, res) => {
  try {
    const { limit, enforcement, enabled, currentUsage } = req.body;
    const quota = await Quota.findById(req.params.id);
    if (!quota) return res.status(404).json({ error: 'Not found' });

    if (limit !== undefined) quota.limit = limit;
    if (enforcement !== undefined) quota.enforcement = enforcement;
    if (enabled !== undefined) quota.enabled = enabled;
    if (currentUsage !== undefined) quota.currentUsage = currentUsage;

    await quota.save();
    res.json(quota);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a quota
router.delete('/:id', adminOrMaint, async (req, res) => {
  try {
    const quota = await Quota.findById(req.params.id);
    if (!quota) return res.status(404).json({ error: 'Not found' });
    await Quota.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Manually trigger expired quota resets
router.post('/reset', adminOrMaint, async (_req, res) => {
  try {
    const count = await resetExpiredQuotas();
    res.json({ reset: count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create default quotas for a tenant
router.post('/tenant/:tenantId/defaults', adminOrMaint, async (req, res) => {
  try {
    const { tenantId } = req.params;
    const tenant = await Tenant.findById(tenantId);
    if (!tenant) return res.status(404).json({ error: 'Not found' });

    const { tokensMonthly, requestsDaily, requestsMonthly, costMonthly } = req.body;
    const quotas = await createDefaultQuotas(tenantId, {
      tokensMonthly,
      requestsDaily,
      requestsMonthly,
      costMonthly,
    });

    res.status(201).json({ quotas });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
