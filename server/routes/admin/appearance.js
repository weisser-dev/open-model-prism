/**
 * Appearance settings — theme, branding, custom colors.
 *
 * Stored in SystemConfig with key 'appearance'.
 *
 * Routes:
 *   GET  /          — read appearance settings (any authenticated user)
 *   PUT  /          — save appearance settings (admin only)
 */
import { Router } from 'express';
import SystemConfig from '../../models/SystemConfig.js';
import { adminOnly } from '../../middleware/rbac.js';
import logger from '../../utils/logger.js';

const router = Router();

const CONFIG_KEY = 'appearance';

const DEFAULTS = {
  theme: 'dark',                    // 'system' | 'dark' | 'light' | 'custom'
  brandName: '',                    // e.g. 'Acme Corp' → shows as 'Acme Corp — Model Prism'
  pageTitle: '',                    // custom browser tab title, empty = default
  // Custom theme colors (only used when theme === 'custom')
  custom: {
    primaryColor: '#228be6',        // buttons, active states, links
    accentColor: '#38bdf8',         // badges, highlights
    bodyBg: '#141517',              // main content area
    navBg: '#1a1b1e',              // sidebar
    headerBg: '#1a1b1e',           // mobile header
    cardBg: '#1a1b1e',             // cards, panels, modals, accordions
    inputBg: '#25262b',            // input fields, selects, expanded rows
    hoverBg: '#2c2e33',            // hover states, collapsed sections
    codeBg: '#0d0d14',             // code blocks, pre elements
    textColor: '#e6e6e6',          // primary text
    textDimmed: '#868e96',         // secondary text
    textMuted: '#5c5f66',          // muted/placeholder text
    borderColor: '#2c2e33',        // borders, dividers, grid lines
    successColor: '#40c057',
    warningColor: '#fab005',
    errorColor: '#fa5252',
    infoColor: '#4c6ef5',
    navText: 'rgba(255,255,255,0.7)', // sidebar text color
    navActive: '#228be6',          // active nav item
    navHoverBg: 'rgba(255,255,255,0.05)', // nav hover background
    btnText: '#ffffff',            // button text color
    scrollbar: '#3a3a3a',          // scrollbar thumb color
    chartGrid: '#333333',          // chart grid lines
    tooltipBg: '#1a1b1e',          // chart tooltip background
  },
  logoUrl: '',
};

async function getSettings() {
  const doc = await SystemConfig.findOne({ key: CONFIG_KEY }).lean();
  return { ...DEFAULTS, ...(doc?.value || {}), custom: { ...DEFAULTS.custom, ...(doc?.value?.custom || {}) } };
}

// GET / — read appearance (any user can read for rendering)
router.get('/', async (_req, res) => {
  try {
    res.json(await getSettings());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT / — save appearance (admin only)
router.put('/', adminOnly, async (req, res) => {
  try {
    const current = await getSettings();
    const allowed = ['theme', 'brandName', 'pageTitle', 'chatTitle', 'custom', 'logoUrl', 'logoData'];
    // Validate logoData size (max 100KB base64)
    if (req.body.logoData && req.body.logoData.length > 140000) {
      return res.status(400).json({ error: 'Logo too large (max 100KB)' });
    }
    const updates = { ...current };

    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        if (key === 'custom') {
          updates.custom = { ...current.custom, ...req.body.custom };
        } else {
          updates[key] = req.body[key];
        }
      }
    }

    await SystemConfig.findOneAndUpdate(
      { key: CONFIG_KEY },
      { $set: { value: updates } },
      { upsert: true },
    );

    logger.info('[appearance] Settings updated', { theme: updates.theme, brandName: updates.brandName });
    res.json(updates);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
