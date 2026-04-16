import { Router } from 'express';
import crypto from 'crypto';
import { adminOrMaint } from '../../middleware/rbac.js';
import Webhook from '../../models/Webhook.js';
import { getDeliveryLog, deliver } from '../../services/webhookService.js';

const router = Router();

/**
 * Mask a webhook secret to its first 8 characters followed by '...'.
 * @param {string} secret
 * @returns {string}
 */
function maskSecret(secret) {
  if (!secret) return '';
  return secret.slice(0, 8) + '...';
}

/**
 * Return a plain object with the secret masked.
 * @param {import('mongoose').Document} doc
 * @returns {object}
 */
function withMaskedSecret(doc) {
  const obj = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };
  if (obj.secret) obj.secret = maskSecret(obj.secret);
  return obj;
}

// List webhooks
router.get('/', async (req, res) => {
  try {
    const filter = {};
    if (req.query.tenantId) filter.tenantId = req.query.tenantId;
    if (req.query.enabled !== undefined) filter.enabled = req.query.enabled === 'true';
    const webhooks = await Webhook.find(filter);
    res.json({ webhooks: webhooks.map(withMaskedSecret) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get single webhook
router.get('/:id', async (req, res) => {
  try {
    const webhook = await Webhook.findById(req.params.id);
    if (!webhook) return res.status(404).json({ error: 'Webhook not found' });
    res.json(withMaskedSecret(webhook));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create webhook
router.post('/', adminOrMaint, async (req, res) => {
  try {
    const { name, tenantId, url, events, enabled, retryPolicy, headers } = req.body;
    if (!name || !url) {
      return res.status(400).json({ error: 'name and url are required' });
    }

    const secret = req.body.secret || crypto.randomBytes(32).toString('hex');

    const webhook = await Webhook.create({
      name,
      tenantId,
      url,
      events,
      enabled,
      retryPolicy,
      headers,
      secret,
    });

    // Return full secret only on create
    res.status(201).json(webhook.toObject());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update webhook
router.patch('/:id', adminOrMaint, async (req, res) => {
  try {
    const webhook = await Webhook.findById(req.params.id);
    if (!webhook) return res.status(404).json({ error: 'Webhook not found' });

    const allowed = ['name', 'url', 'events', 'enabled', 'retryPolicy', 'headers'];
    for (const field of allowed) {
      if (req.body[field] !== undefined) webhook[field] = req.body[field];
    }

    await webhook.save();
    res.json(withMaskedSecret(webhook));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete webhook
router.delete('/:id', adminOrMaint, async (req, res) => {
  try {
    const webhook = await Webhook.findByIdAndDelete(req.params.id);
    if (!webhook) return res.status(404).json({ error: 'Webhook not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Send test event to a specific webhook
router.post('/:id/test', adminOrMaint, async (req, res) => {
  try {
    const webhook = await Webhook.findById(req.params.id);
    if (!webhook) return res.status(404).json({ error: 'Webhook not found' });

    await deliver(webhook, 'test', { message: 'Webhook test delivery' });
    res.json({ sent: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get delivery logs for a webhook
router.get('/:id/logs', async (req, res) => {
  try {
    const webhook = await Webhook.findById(req.params.id);
    if (!webhook) return res.status(404).json({ error: 'Webhook not found' });

    const limit = parseInt(req.query.limit) || 50;
    const logs = await getDeliveryLog(req.params.id, limit);
    res.json({ logs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Rotate webhook secret
router.post('/:id/rotate-secret', adminOrMaint, async (req, res) => {
  try {
    const webhook = await Webhook.findById(req.params.id);
    if (!webhook) return res.status(404).json({ error: 'Webhook not found' });

    webhook.secret = crypto.randomBytes(32).toString('hex');
    await webhook.save();

    res.json({ secret: webhook.secret });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
