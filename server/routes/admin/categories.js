import { Router } from 'express';
import RoutingCategory from '../../models/RoutingCategory.js';
import { PRESET_PROFILES } from '../../data/presetProfiles.js';
import { findModel } from '../../data/modelRegistry.js';
import { adminOrMaint, canViewCosts } from '../../middleware/rbac.js';
import { logConfigChange } from '../../services/auditService.js';

const router = Router();

// List all categories
router.get('/', canViewCosts, async (_req, res) => {
  const categories = await RoutingCategory.find().sort('order');
  res.json(categories);
});

// Create category
router.post('/', adminOrMaint, async (req, res) => {
  const { key, name, description, costTier, examples, defaultModel, fallbackModel, requiresVision, targetSystemPrompt } = req.body;
  if (!key || !name || !costTier) {
    return res.status(400).json({ error: 'Key, name, and costTier required' });
  }

  const existing = await RoutingCategory.findOne({ key });
  if (existing) {
    return res.status(400).json({ error: 'Category key already exists' });
  }

  const maxOrder = await RoutingCategory.findOne().sort('-order').select('order');
  const category = await RoutingCategory.create({
    key, name, description, costTier, examples,
    defaultModel, fallbackModel, requiresVision,
    ...(targetSystemPrompt !== undefined && { targetSystemPrompt }),
    isBuiltIn: false,
    order: (maxOrder?.order || 0) + 1,
  });

  res.status(201).json(category);
});

// Update category
router.put('/:id', adminOrMaint, async (req, res) => {
  const category = await RoutingCategory.findById(req.params.id);
  if (!category) return res.status(404).json({ error: 'Category not found' });
  const beforeState = category.toObject();

  const fields = ['name', 'description', 'costTier', 'examples', 'defaultModel', 'fallbackModel', 'requiresVision', 'order', 'targetSystemPrompt'];
  for (const field of fields) {
    if (req.body[field] !== undefined) category[field] = req.body[field];
  }
  if (req.body.key && !category.isBuiltIn) category.key = req.body.key;

  await category.save();
  logConfigChange({ user: req.user?.username, action: 'update', target: 'category', targetId: category._id, targetName: category.key || category.name, before: beforeState, after: category.toObject() });
  res.json(category);
});

// Delete category (built-in categories can be deleted; use /reset-defaults to restore)
router.delete('/:id', adminOrMaint, async (req, res) => {
  const category = await RoutingCategory.findById(req.params.id);
  if (!category) return res.status(404).json({ error: 'Category not found' });

  await category.deleteOne();
  res.json({ success: true });
});

// Seed built-in categories (skips existing)
router.post('/seed', adminOrMaint, async (_req, res) => {
  const { seedCategories } = await import('../../utils/categorySeeds.js');
  const result = await seedCategories();
  res.json(result);
});

// Reset system defaults — re-creates any deleted built-in categories
router.post('/reset-defaults', adminOrMaint, async (_req, res) => {
  const { seedCategories } = await import('../../utils/categorySeeds.js');
  const result = await seedCategories(); // skips existing, creates missing
  res.json(result);
});

// ── Preset Profiles ───────────────────────────────────────────────────────────

// List all preset profiles
router.get('/presets', canViewCosts, (_req, res) => {
  res.json(PRESET_PROFILES);
});

/**
 * Apply one or more preset profiles.
 * Body: { profileIds: string[], providerId?: string }
 *
 * For each category in the selected profiles, finds the best available model
 * from the provider's discovered models (matching the category's costTier),
 * ranked by benchmark intelligence score. Sets category.defaultModel if not
 * already set. Returns a summary of changes made.
 */
router.post('/apply-preset', adminOrMaint, async (req, res) => {
  const { profileIds = [], providerId } = req.body;
  if (!profileIds.length) {
    return res.status(400).json({ error: 'profileIds required' });
  }

  // Collect all category keys from selected profiles
  const selectedProfiles = PRESET_PROFILES.filter(p => profileIds.includes(p.id));
  if (!selectedProfiles.length) {
    return res.status(400).json({ error: 'No matching profiles found' });
  }

  // Get all category keys (union; empty = all)
  let categoryKeys = new Set();
  for (const p of selectedProfiles) {
    for (const k of p.categories) categoryKeys.add(k);
  }

  // Load discovered models from provider (if given) for tier-matching
  let modelsByTier = {}; // tier → [modelId, benchmarkScore]
  if (providerId) {
    const Provider = (await import('../../models/Provider.js')).default;
    const provider = await Provider.findById(providerId);
    if (provider?.discoveredModels?.length) {
      for (const m of provider.discoveredModels) {
        if (!m.tier) continue;
        const reg = findModel(m.id);
        const score = reg?.benchmarks?.intelligence ?? 50;
        if (!modelsByTier[m.tier]) modelsByTier[m.tier] = [];
        modelsByTier[m.tier].push({ id: m.id, score });
      }
      // Sort each tier by benchmark score descending
      for (const tier of Object.keys(modelsByTier)) {
        modelsByTier[tier].sort((a, b) => b.score - a.score);
      }
    }
  }

  // Fetch categories to update
  const query = categoryKeys.size > 0 ? { key: { $in: [...categoryKeys] } } : {};
  const categories = await RoutingCategory.find(query);

  let updated = 0;
  let skipped = 0;
  const assignments = [];

  for (const cat of categories) {
    // Skip if already has a defaultModel
    if (cat.defaultModel) { skipped++; continue; }

    // Find best model for this category's costTier
    const candidates = modelsByTier[cat.costTier] || [];
    const best = candidates[0]; // highest benchmark score
    if (!best) { skipped++; continue; }

    cat.defaultModel = best.id;
    await cat.save();
    updated++;
    assignments.push({ category: cat.key, tier: cat.costTier, model: best.id, score: best.score });
  }

  res.json({
    profiles: selectedProfiles.map(p => p.name),
    categoriesConsidered: categories.length,
    updated,
    skipped,
    assignments,
  });
});

export default router;
