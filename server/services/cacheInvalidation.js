/**
 * Cross-pod cache invalidation.
 *
 * Strategy:
 *  1. Try MongoDB Change Streams on the watched collections.
 *     Requires a MongoDB Replica Set (oplog enabled).
 *  2. If Change Streams are unavailable (standalone MongoDB), fall back to
 *     periodic polling — re-check a lightweight "last-modified" timestamp
 *     stored in a sentinel document.
 *
 * When a change is detected, the registered invalidator callbacks are called
 * so each service can clear its in-memory cache.
 */

import mongoose from 'mongoose';
import logger from '../utils/logger.js';

// Registered callbacks: { collection → [fn, fn, …] }
const invalidators = new Map();

// Polling fallback state
const POLL_INTERVAL = 15_000;   // 15 s
const pollTimers    = new Map();
const lastSeen      = new Map();

/**
 * Register a callback to be called when `collection` changes.
 * @param {string} collection  Mongo collection name (e.g. 'routingrulesets')
 * @param {Function} fn        Invalidation callback
 */
export function onCollectionChange(collection, fn) {
  if (!invalidators.has(collection)) invalidators.set(collection, []);
  invalidators.get(collection).push(fn);
}

function fire(collection) {
  const cbs = invalidators.get(collection) || [];
  for (const cb of cbs) {
    try { cb(); } catch { /* ignore */ }
  }
}

// ── Change Streams ────────────────────────────────────────────────────────────

async function watchCollection(collection) {
  try {
    const col = mongoose.connection.collection(collection);
    const stream = col.watch([], { fullDocument: 'default' });

    stream.on('change', () => {
      logger.debug(`[cache-invalidation] change detected in ${collection}`);
      fire(collection);
    });

    stream.on('error', (err) => {
      logger.info(`[cache-invalidation] Change Stream unavailable for ${collection}, using polling fallback`, { error: err.message });
      stream.close().catch(() => {});
      startPolling(collection);
    });

    logger.info(`[cache-invalidation] Change Stream active for ${collection}`);
    return true;
  } catch (err) {
    logger.info(`[cache-invalidation] Change Stream unavailable for ${collection}, using polling fallback`);
    return false;
  }
}

// ── Polling fallback ──────────────────────────────────────────────────────────

function startPolling(collection) {
  if (pollTimers.has(collection)) return; // already polling

  lastSeen.set(collection, new Date());

  const timer = setInterval(async () => {
    try {
      const col  = mongoose.connection.collection(collection);
      const prev = lastSeen.get(collection) || new Date(0);

      // Look for any document updated more recently than our last check
      const recent = await col.findOne(
        { updatedAt: { $gt: prev } },
        { projection: { updatedAt: 1 }, sort: { updatedAt: -1 } },
      );

      if (recent?.updatedAt) {
        lastSeen.set(collection, recent.updatedAt);
        logger.debug(`[cache-invalidation] Poll detected change in ${collection}`);
        fire(collection);
      }
    } catch { /* ignore — DB may be temporarily unavailable */ }
  }, POLL_INTERVAL);

  timer.unref();
  pollTimers.set(collection, timer);
  logger.info(`[cache-invalidation] Polling fallback active for ${collection} every ${POLL_INTERVAL / 1000}s`);
}

// ── Startup ───────────────────────────────────────────────────────────────────

const WATCHED_COLLECTIONS = [
  'routingrulesets',
  'routingcategories',
  'tenants',
  'providers',
];

export async function startCacheInvalidation() {
  // Wait until the DB connection is open
  if (mongoose.connection.readyState !== 1) {
    await new Promise(resolve => mongoose.connection.once('open', resolve));
  }

  for (const col of WATCHED_COLLECTIONS) {
    const ok = await watchCollection(col);
    if (!ok) startPolling(col);
  }
}
