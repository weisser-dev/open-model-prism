import Setup from '../models/Setup.js';

let cachedSetupComplete = null;
let cacheTime = 0;
const CACHE_TTL = 10_000; // 10 seconds

export async function isSetupComplete() {
  const now = Date.now();
  if (cachedSetupComplete !== null && now - cacheTime < CACHE_TTL) {
    return cachedSetupComplete;
  }
  const setup = await Setup.findOne();
  cachedSetupComplete = setup?.completed === true;
  cacheTime = now;
  return cachedSetupComplete;
}

export function invalidateSetupCache() {
  cachedSetupComplete = null;
}

export function setupCheck(req, res, next) {
  isSetupComplete().then(complete => {
    if (!complete) {
      return res.status(503).json({ error: 'Setup not completed', setupRequired: true });
    }
    next();
  }).catch(next);
}
