/**
 * Admin tokenize endpoint — offline token estimation for debugging.
 *
 * GET  /api/admin/tokenize?text=...
 * POST /api/admin/tokenize  { messages, max_tokens, model }
 */
import { Router } from 'express';
import { adminAuth } from '../../middleware/auth.js';
import { estimateChatTokens, estimateStringTokens, checkContextFits } from '../../services/tokenService.js';
import { suggestForModel } from '../../data/modelRegistry.js';

const router = Router();
router.use(adminAuth);

// GET — quick single-string estimate
router.get('/', (req, res) => {
  const { text = '' } = req.query;
  if (typeof text !== 'string') {
    return res.status(400).json({ error: 'text must be a string' });
  }
  res.json({ tokens: estimateStringTokens(text), chars: text.length });
});

// POST — full chat message estimate with optional context-fit check
router.post('/', (req, res) => {
  const { messages, max_tokens = 0, model } = req.body;

  if (!Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array required' });
  }

  const { inputTokens, outputReserved, total } = estimateChatTokens(messages, max_tokens);

  const result = { inputTokens, outputReserved, total };

  if (model) {
    const entry = suggestForModel(model);
    if (entry?.contextWindow) {
      const { fits, headroom } = checkContextFits(messages, max_tokens, entry.contextWindow);
      result.model = model;
      result.contextWindow = entry.contextWindow;
      result.fits = fits;
      result.headroom = headroom;
    }
  }

  res.json(result);
});

export default router;
