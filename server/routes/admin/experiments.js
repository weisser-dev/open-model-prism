import { Router } from 'express';
import { adminOrMaint } from '../../middleware/rbac.js';
import Experiment from '../../models/Experiment.js';
import { analyzeExperiment, invalidateExperimentCache } from '../../services/experimentService.js';

const router = Router();

/**
 * GET / — List experiments.
 * Optional query params: tenantId, status.
 * Sorted by createdAt descending.
 */
router.get('/', async (req, res) => {
  try {
    const filter = {};
    if (req.query.tenantId) filter.tenantId = req.query.tenantId;
    if (req.query.status) filter.status = req.query.status;

    const experiments = await Experiment.find(filter)
      .sort({ createdAt: -1 })
      .lean();

    res.json({ experiments });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /:id — Get a single experiment by ID with full metrics.
 */
router.get('/:id', async (req, res) => {
  try {
    const experiment = await Experiment.findById(req.params.id).lean();
    if (!experiment) {
      return res.status(404).json({ error: 'Experiment not found' });
    }
    res.json(experiment);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST / — Create experiment.
 * Body: { name, tenantId, description, variants, targetCategories,
 *         startDate, endDate, minSampleSize }
 * Requires at least 2 variants. Initializes metrics with zeroed entries
 * per variant. Status defaults to 'draft'.
 */
router.post('/', adminOrMaint, async (req, res) => {
  try {
    const {
      name, tenantId, description, variants,
      targetCategories, startDate, endDate, minSampleSize,
    } = req.body;

    if (!Array.isArray(variants) || variants.length < 2) {
      return res.status(400).json({ error: 'At least 2 variants are required' });
    }

    const metrics = variants.map((variant) => ({
      variant: variant.name ?? variant,
      requests: 0,
      successes: 0,
      failures: 0,
      totalLatencyMs: 0,
      totalCostUsd: 0,
    }));

    const experiment = await Experiment.create({
      name,
      tenantId,
      description,
      variants,
      targetCategories,
      startDate,
      endDate,
      minSampleSize,
      metrics,
      status: 'draft',
    });

    res.status(201).json(experiment.toObject());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /:id — Update experiment.
 * Allowed fields: name, description, variants (only if draft),
 * targetCategories, startDate, endDate, minSampleSize, status.
 * Handles status transition side-effects.
 */
router.patch('/:id', adminOrMaint, async (req, res) => {
  try {
    const experiment = await Experiment.findById(req.params.id);
    if (!experiment) {
      return res.status(404).json({ error: 'Experiment not found' });
    }

    const allowed = [
      'name', 'description', 'targetCategories',
      'startDate', 'endDate', 'minSampleSize', 'status',
    ];

    // Variants may only be changed while the experiment is still a draft
    if (experiment.status === 'draft') {
      allowed.push('variants');
    }

    for (const field of allowed) {
      if (req.body[field] !== undefined) {
        experiment[field] = req.body[field];
      }
    }

    const statusChanged = req.body.status && req.body.status !== experiment.status;

    // Side-effects for status transitions
    if (req.body.status === 'active' && !experiment.startDate) {
      experiment.startDate = new Date();
    }
    if (req.body.status === 'completed' && !experiment.endDate) {
      experiment.endDate = new Date();
    }

    await experiment.save();

    if (statusChanged) {
      await invalidateExperimentCache();
    }

    res.json(experiment.toObject());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /:id — Delete experiment (only if draft or completed).
 */
router.delete('/:id', adminOrMaint, async (req, res) => {
  try {
    const experiment = await Experiment.findById(req.params.id);
    if (!experiment) {
      return res.status(404).json({ error: 'Experiment not found' });
    }

    if (!['draft', 'completed'].includes(experiment.status)) {
      return res.status(400).json({ error: 'Only draft or completed experiments can be deleted' });
    }

    await experiment.deleteOne();
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /:id/results — Analyze experiment and return results.
 */
router.get('/:id/results', async (req, res) => {
  try {
    const results = await analyzeExperiment(req.params.id);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /:id/start — Activate an experiment.
 * Sets status to 'active' and startDate to now if not already set.
 */
router.post('/:id/start', adminOrMaint, async (req, res) => {
  try {
    const experiment = await Experiment.findById(req.params.id);
    if (!experiment) {
      return res.status(404).json({ error: 'Experiment not found' });
    }

    experiment.status = 'active';
    if (!experiment.startDate) {
      experiment.startDate = new Date();
    }

    await experiment.save();
    await invalidateExperimentCache();

    res.json(experiment.toObject());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /:id/stop — Complete an experiment.
 * Sets status to 'completed' and endDate to now.
 */
router.post('/:id/stop', adminOrMaint, async (req, res) => {
  try {
    const experiment = await Experiment.findById(req.params.id);
    if (!experiment) {
      return res.status(404).json({ error: 'Experiment not found' });
    }

    experiment.status = 'completed';
    experiment.endDate = new Date();

    await experiment.save();
    await invalidateExperimentCache();

    res.json(experiment.toObject());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
